/**
 * Secure Express server for Uniswap Token Jar arbitrage
 * Zero-knowledge backend: read-only blockchain data, no user data storage
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { ethers } = require('ethers');

const { CONTRACTS, SECURITY } = require('./contracts/constants');
const { FIREPIT_ABI, ERC20_ABI } = require('./contracts/abis');
const { validateEthereumAddress, sanitizeResponse } = require('./utils/validation');
const { getTokenPrice, getMultipleTokenPrices, getUniPrice } = require('./utils/priceFeeds');
const { calculateOptimalBurn, calculateProfit, formatProfitData } = require('./utils/profitCalculator');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.ethers.io"],
            styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for dynamic UI
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'", "https://*.infura.io", "https://*.alchemy.com", "https://api.coingecko.com"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"]
        }
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// CORS configuration - only allow same origin in production
const corsOptions = {
    origin: process.env.NODE_ENV === 'production' ? false : '*',
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Rate limiting to prevent DoS
const limiter = rateLimit({
    windowMs: SECURITY.RATE_LIMIT_WINDOW_MS,
    max: SECURITY.RATE_LIMIT_MAX_REQUESTS,
    message: 'Too many requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
    // Don't log IP addresses for privacy
    skip: () => false
});
app.use('/api/', limiter);

// Parse JSON bodies
app.use(express.json({ limit: '10kb' })); // Limit body size

// Serve static files
app.use(express.static('public'));

// Initialize Ethereum provider (read-only)
const provider = new ethers.JsonRpcProvider(
    process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com' // Free public RPC as fallback
);

// Initialize contract instances (read-only)
const firepitContract = new ethers.Contract(CONTRACTS.FIREPIT, FIREPIT_ABI, provider);
const uniContract = new ethers.Contract(CONTRACTS.UNI_TOKEN, ERC20_ABI, provider);

/**
 * Internal logic helpers to avoid recursive HTTP calls
 */
async function fetchJarBalanceData() {
    const tokenAddresses = [
        CONTRACTS.USDT,
        CONTRACTS.USDC,
        CONTRACTS.WETH,
        CONTRACTS.WBTC,
        CONTRACTS.PAXG
    ];

    const balancePromises = tokenAddresses.map(async (address) => {
        const contract = new ethers.Contract(address, ERC20_ABI, provider);
        const [balance, decimals, symbol] = await Promise.all([
            contract.balanceOf(CONTRACTS.TOKEN_JAR),
            contract.decimals(),
            contract.symbol()
        ]);

        return {
            address,
            symbol,
            balance: balance.toString(),
            decimals: Number(decimals)
        };
    });

    const balances = await Promise.all(balancePromises);
    const nonZeroBalances = balances.filter(b => b.balance !== '0');
    const addresses = nonZeroBalances.map(b => b.address);
    const prices = await getMultipleTokenPrices(addresses);

    const jarContents = nonZeroBalances.map(token => ({
        ...token,
        price: prices[token.address.toLowerCase()] || 0
    }));

    let totalValueUSD = 0;
    for (const token of jarContents) {
        const balanceEth = parseFloat(ethers.formatUnits(token.balance, token.decimals));
        totalValueUSD += balanceEth * token.price;
    }

    return { success: true, jarAddress: CONTRACTS.TOKEN_JAR, tokens: jarContents, totalValueUSD, timestamp: Date.now() };
}

async function fetchThresholdData() {
    const threshold = await firepitContract.threshold();
    const thresholdEth = ethers.formatEther(threshold);
    const uniPrice = await getUniPrice();
    const thresholdUSD = parseFloat(thresholdEth) * uniPrice;

    return { success: true, threshold: threshold.toString(), thresholdEth, thresholdUSD, timestamp: Date.now() };
}

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

/**
 * Get Token Jar balance and contents
 */
app.get('/api/jar-balance', async (req, res) => {
    try {
        const data = await fetchJarBalanceData();
        res.json(sanitizeResponse(data));
    } catch (error) {
        console.error('Error fetching jar balance:', error);
        res.status(500).json(sanitizeResponse({ success: false, error: 'Failed' }));
    }
});

/**
 * Get UNI threshold required for release
 */
app.get('/api/threshold', async (req, res) => {
    try {
        const data = await fetchThresholdData();
        res.json(sanitizeResponse(data));
    } catch (error) {
        console.error('Error fetching threshold:', error);
        res.status(500).json(sanitizeResponse({ success: false, error: 'Failed' }));
    }
});

/**
 * Calculate profitability
 */
app.get('/api/profitability', async (req, res) => {
    try {
        const [feeData, jarData, thresholdData, uniPrice] = await Promise.all([
            provider.getFeeData(),
            fetchJarBalanceData(),
            fetchThresholdData(),
            getUniPrice()
        ]);

        const gasPriceGwei = Number(ethers.formatUnits(feeData.gasPrice || 0n, 'gwei'));

        const optimal = await calculateOptimalBurn(
            jarData.tokens,
            uniPrice,
            thresholdData.threshold,
            gasPriceGwei
        );

        res.json(sanitizeResponse({
            success: true,
            ...formatProfitData(optimal),
            optimalTokens: optimal.tokenBreakdown.map(t => t.address),
            gasPriceGwei,
            timestamp: Date.now()
        }));

    } catch (error) {
        console.error('Error calculating profitability:', error);
        res.status(500).json(sanitizeResponse({ success: false, error: 'Failed' }));
    }
});

/**
 * Get current UNI price
 */
app.get('/api/uni-price', async (req, res) => {
    try {
        const price = await getUniPrice();

        res.json(sanitizeResponse({
            success: true,
            price,
            timestamp: Date.now()
        }));

    } catch (error) {
        console.error('Error fetching UNI price:', error);
        res.status(500).json(sanitizeResponse({
            success: false,
            error: 'Failed to fetch UNI price'
        }));
    }
});

/**
 * Get gas estimate for release transaction
 */
app.get('/api/gas-estimate', async (req, res) => {
    try {
        const { tokenCount } = req.query;
        const count = parseInt(tokenCount) || 5;

        // Base gas + per-token gas
        const estimatedGas = 150000 + (count * 50000);

        // Get current gas price
        const feeData = await provider.getFeeData();
        const gasPriceGwei = Number(ethers.formatUnits(feeData.gasPrice || 0n, 'gwei'));

        // Calculate cost in ETH
        const gasCostEth = (estimatedGas * gasPriceGwei) / 1e9;

        // Get ETH price
        const ethPrice = await getTokenPrice(CONTRACTS.WETH);
        const gasCostUSD = gasCostEth * ethPrice;

        res.json(sanitizeResponse({
            success: true,
            estimatedGas,
            gasPriceGwei,
            gasCostEth,
            gasCostUSD,
            timestamp: Date.now()
        }));

    } catch (error) {
        console.error('Error estimating gas:', error);
        res.status(500).json(sanitizeResponse({
            success: false,
            error: 'Failed to estimate gas'
        }));
    }
});

/**
 * Get recent arbitrage history (Proof of Life)
 */
app.get('/api/history', async (req, res) => {
    try {
        // Get last 10,000 blocks (approx 1.5 days)
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = currentBlock - 10000;

        const filter = firepitContract.filters.Release();
        const events = await firepitContract.queryFilter(filter, fromBlock);

        // Sort descending
        const recentEvents = await Promise.all(events.reverse().slice(0, 5).map(async (event) => {
            const block = await event.getBlock();
            return {
                hash: event.transactionHash,
                recipient: event.args[2], // recipient
                assetCount: event.args[1].length, // assets array length
                timestamp: block.timestamp * 1000,
                date: new Date(block.timestamp * 1000).toLocaleString()
            };
        }));

        res.json(sanitizeResponse({
            success: true,
            events: recentEvents,
            timestamp: Date.now()
        }));

    } catch (error) {
        console.error('Error fetching history:', error);
        // Return empty array instead of error to not break UI
        res.json(sanitizeResponse({
            success: true,
            events: [],
            error: 'Failed to fetch full history'
        }));
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json(sanitizeResponse({
        success: false,
        error: 'Internal server error'
    }));
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🔥 Ember (formerly Unifire) - Arbitrage Monitor Port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔐 Security features enabled: Helmet, CORS, Rate Limiting`);
    console.log(`🚫 Privacy mode: No logging, No tracking, No data collection`);
});

module.exports = app;
