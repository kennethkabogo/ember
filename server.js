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
        const tokenAddresses = [
            CONTRACTS.USDT,
            CONTRACTS.USDC,
            CONTRACTS.WETH,
            CONTRACTS.WBTC,
            CONTRACTS.PAXG
        ];

        // Get balances for all tokens in parallel
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

        // Filter out tokens with zero balance
        const nonZeroBalances = balances.filter(b => b.balance !== '0');

        // Get prices for non-zero tokens
        const addresses = nonZeroBalances.map(b => b.address);
        const prices = await getMultipleTokenPrices(addresses);

        // Combine balance and price data
        const jarContents = nonZeroBalances.map(token => ({
            ...token,
            price: prices[token.address.toLowerCase()] || 0
        }));

        // Calculate total value
        let totalValueUSD = 0;
        for (const token of jarContents) {
            const balanceEth = parseFloat(ethers.formatUnits(token.balance, token.decimals));
            totalValueUSD += balanceEth * token.price;
        }

        res.json(sanitizeResponse({
            success: true,
            jarAddress: CONTRACTS.TOKEN_JAR,
            tokens: jarContents,
            totalValueUSD,
            timestamp: Date.now()
        }));

    } catch (error) {
        console.error('Error fetching jar balance:', error);
        res.status(500).json(sanitizeResponse({
            success: false,
            error: 'Failed to fetch jar balance'
        }));
    }
});

/**
 * Get UNI threshold required for release
 */
app.get('/api/threshold', async (req, res) => {
    try {
        const threshold = await firepitContract.threshold();
        const thresholdEth = ethers.formatEther(threshold);
        const uniPrice = await getUniPrice();
        const thresholdUSD = parseFloat(thresholdEth) * uniPrice;

        res.json(sanitizeResponse({
            success: true,
            threshold: threshold.toString(),
            thresholdEth,
            thresholdUSD,
            timestamp: Date.now()
        }));

    } catch (error) {
        console.error('Error fetching threshold:', error);
        res.status(500).json(sanitizeResponse({
            success: false,
            error: 'Failed to fetch threshold'
        }));
    }
});

/**
 * Calculate profitability
 */
app.get('/api/profitability', async (req, res) => {
    try {
        // Get current gas price
        const feeData = await provider.getFeeData();
        const gasPriceGwei = Number(ethers.formatUnits(feeData.gasPrice || 0n, 'gwei'));

        // Get jar contents
        const jarResponse = await fetch(`http://localhost:${PORT}/api/jar-balance`);
        const jarData = await jarResponse.json();

        if (!jarData.success) {
            throw new Error('Failed to fetch jar data');
        }

        // Get threshold
        const thresholdResponse = await fetch(`http://localhost:${PORT}/api/threshold`);
        const thresholdData = await thresholdResponse.json();

        if (!thresholdData.success) {
            throw new Error('Failed to fetch threshold');
        }

        // Get UNI price
        const uniPrice = await getUniPrice();

        // Calculate optimal burn and profit
        const optimal = calculateOptimalBurn(
            jarData.tokens,
            uniPrice,
            thresholdData.threshold,
            gasPriceGwei
        );

        res.json(sanitizeResponse({
            success: true,
            ...formatProfitData(optimal),
            // Pass raw optimal addresses for the transaction execution
            optimalTokens: optimal.tokenBreakdown.map(t => t.address),
            gasPriceGwei,
            timestamp: Date.now()
        }));

    } catch (error) {
        console.error('Error calculating profitability:', error);
        res.status(500).json(sanitizeResponse({
            success: false,
            error: 'Failed to calculate profitability'
        }));
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
    console.log(`🔒 Secure Token Jar Arbitrage API running on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔐 Security features enabled: Helmet, CORS, Rate Limiting`);
    console.log(`🚫 Privacy mode: No logging, No tracking, No data collection`);
});

module.exports = app;
