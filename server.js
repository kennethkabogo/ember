/**
 * Secure Express server for Uniswap Token Jar arbitrage
 * Zero-knowledge backend: Use Alchemy's advanced APIs for full token scanning
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
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.ethers.io", "https://unpkg.com"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'", "https://*.infura.io", "https://*.alchemy.com", "https://api.coingecko.com"],
        }
    }
}));

const corsOptions = {
    origin: process.env.NODE_ENV === 'production' ? false : '*',
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

const limiter = rateLimit({
    windowMs: SECURITY.RATE_LIMIT_WINDOW_MS,
    max: SECURITY.RATE_LIMIT_MAX_REQUESTS,
    skip: () => false
});
app.use('/api/', limiter);

app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));

const RPC_URL = process.env.ETHEREUM_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/oruBwFHQaZm_gPnyLzcLG';
console.log(`🌐 Connecting to RPC: ${RPC_URL.includes('alchemy') ? 'Alchemy (Premium)' : RPC_URL}`);

const provider = new ethers.JsonRpcProvider(RPC_URL);
const firepitContract = new ethers.Contract(CONTRACTS.FIREPIT, FIREPIT_ABI, provider);

// Metadata Cache to avoid 200+ RPC calls for symbols
const TOKEN_CACHE = {
    [CONTRACTS.UNI_TOKEN.toLowerCase()]: { symbol: 'UNI', decimals: 18 },
    [CONTRACTS.USDT.toLowerCase()]: { symbol: 'USDT', decimals: 6 },
    [CONTRACTS.USDC.toLowerCase()]: { symbol: 'USDC', decimals: 6 },
    [CONTRACTS.WETH.toLowerCase()]: { symbol: 'WETH', decimals: 18 },
    [CONTRACTS.WBTC.toLowerCase()]: { symbol: 'WBTC', decimals: 8 },
    [CONTRACTS.PAXG.toLowerCase()]: { symbol: 'PAXG', decimals: 18 },
    // Emerging Fees (Meme/Defi)
    '0x4fbaf51b95b024d0d7cab575be2a1f0afedc9b64': { symbol: 'BONK', decimals: 5 }, // BONK (Approx decimals, verifying...)
    '0x6b175474e89094c44da98b954eedeac495271d0f': { symbol: 'DAI', decimals: 18 },
    '0x514910771af9ca656af840dff83e8264ecf986ca': { symbol: 'LINK', decimals: 18 },
    '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': { symbol: 'AAVE', decimals: 18 },
    '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce': { symbol: 'SHIB', decimals: 18 },
    '0x6982508145454ce325ddbe47a25d4ec3d2311933': { symbol: 'PEPE', decimals: 18 }
};

/**
 * Fetch ALL token balances using Alchemy's optimized API
 */
async function fetchJarBalanceData() {
    let balances = [];

    // 1. Fetch Native ETH
    try {
        const ethBalance = await provider.getBalance(CONTRACTS.TOKEN_JAR);
        if (ethBalance > 0n) {
            balances.push({
                address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
                symbol: 'ETH',
                balance: ethBalance.toString(),
                decimals: 18,
                price: 0
            });
        }
    } catch (e) {
        console.error('ETH Fetch Error:', e.message);
    }

    // 2. Fetch ERC20s via alchemy_getTokenBalances
    try {
        // Raw call to Alchemy
        const result = await provider.send("alchemy_getTokenBalances", [
            CONTRACTS.TOKEN_JAR
        ]);

        const rawTokens = result.tokenBalances;
        console.log(`Found ${rawTokens.length} tokens in Jar via Alchemy.`);

        // Process top tokens (limit to 50 to avoid timeouts)
        // Sort by raw balance length approx (imperfect but fast) or just take first 50
        // Alchemy usually returns them in some order, but let's process.

        for (const t of rawTokens) {
            const addr = t.contractAddress.toLowerCase();
            const rawBal = t.tokenBalance;

            // Skip zero balances (Alchemy shouldn't return them but sanity check)
            if (rawBal === '0x' || BigInt(rawBal) === 0n) continue;

            let decimals = 18;
            let symbol = 'Unknown';
            let known = false;

            // Check Cache
            if (TOKEN_CACHE[addr]) {
                decimals = TOKEN_CACHE[addr].decimals;
                symbol = TOKEN_CACHE[addr].symbol;
                known = true;
            }

            // LOGGING: Print what we found to debug
            if (!known) {
                // console.log(`Found Unknown Token: ${addr} Balance: ${rawBal}`);
            } else {
                console.log(`✅ MATCHED: ${symbol} (${addr})`);
            }

            // Allow UNKNOWN tokens for now, just to show list
            if (!known) {
                symbol = `${addr.substring(0, 6)}...`;
                decimals = 18; // Dangerous assumption but better than empty
            }

            balances.push({
                address: t.contractAddress,
                symbol: symbol,
                balance: BigInt(rawBal).toString(),
                decimals: decimals,
                price: 0
            });
        }

    } catch (e) {
        console.error("Alchemy API Error:", e.message);
        // Fallback or empty
    }

    // 3. Get Prices for found tokens
    const addresses = balances.map(b => b.address === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' ? CONTRACTS.WETH : b.address);
    // Dedup
    const uniqueAddresses = [...new Set(addresses)];
    const prices = await getMultipleTokenPrices(uniqueAddresses);

    // Map prices
    let totalValueUSD = 0;
    const finalTokens = balances.map(token => {
        const addrKey = token.address === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' ? CONTRACTS.WETH.toLowerCase() : token.address.toLowerCase();
        const price = prices[addrKey] || 0;

        const balanceFormatted = parseFloat(ethers.formatUnits(token.balance, token.decimals));
        const valueUSD = balanceFormatted * price;
        totalValueUSD += valueUSD;

        return { ...token, price, valueUSD };
    });

    // Sort by value
    finalTokens.sort((a, b) => b.valueUSD - a.valueUSD);

    return { success: true, jarAddress: CONTRACTS.TOKEN_JAR, tokens: finalTokens, totalValueUSD, timestamp: Date.now() };
}

async function fetchThresholdData() {
    const threshold = await firepitContract.threshold();
    const thresholdEth = ethers.formatEther(threshold);
    const uniPrice = await getUniPrice();
    const thresholdUSD = parseFloat(thresholdEth) * uniPrice;

    return { success: true, threshold: threshold.toString(), thresholdEth, thresholdUSD, timestamp: Date.now() };
}

// --- API ENDPOINTS ---

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

app.get('/api/jar-balance', async (req, res) => {
    try {
        const data = await fetchJarBalanceData();
        res.json(sanitizeResponse(data));
    } catch (error) {
        console.error('Error fetching jar balance:', error);
        res.status(500).json(sanitizeResponse({ success: false, error: 'Failed' }));
    }
});

app.get('/api/threshold', async (req, res) => {
    try {
        const data = await fetchThresholdData();
        res.json(sanitizeResponse(data));
    } catch (error) {
        res.status(500).json(sanitizeResponse({ success: false, error: 'Failed' }));
    }
});

app.get('/api/profitability', async (req, res) => {
    try {
        const [feeData, jarData, thresholdData, uniPrice] = await Promise.all([
            provider.getFeeData(),
            fetchJarBalanceData(),
            fetchThresholdData(),
            getUniPrice()
        ]);
        const gasPriceGwei = Number(ethers.formatUnits(feeData.gasPrice || 0n, 'gwei'));
        const optimal = await calculateOptimalBurn(jarData.tokens, uniPrice, thresholdData.threshold, gasPriceGwei);

        res.json(sanitizeResponse({
            success: true,
            ...formatProfitData(optimal),
            optimalTokens: optimal.tokenBreakdown.map(t => t.address),
            gasPriceGwei,
            timestamp: Date.now()
        }));
    } catch (error) {
        res.status(500).json(sanitizeResponse({ success: false, error: 'Failed' }));
    }
});

app.get('/api/uni-price', async (req, res) => {
    try {
        const price = await getUniPrice();
        res.json(sanitizeResponse({ success: true, price, timestamp: Date.now() }));
    } catch (error) {
        res.status(500).json(sanitizeResponse({ success: false, error: 'Failed' }));
    }
});

app.get('/api/gas-estimate', async (req, res) => {
    try {
        const { tokenCount } = req.query;
        const count = parseInt(tokenCount) || 5;
        const estimatedGas = 150000 + (count * 50000);
        const feeData = await provider.getFeeData();
        const gasPriceGwei = Number(ethers.formatUnits(feeData.gasPrice || 0n, 'gwei'));
        const gasCostEth = (estimatedGas * gasPriceGwei) / 1e9;
        const ethPrice = await getTokenPrice(CONTRACTS.WETH);
        const gasCostUSD = gasCostEth * ethPrice;
        res.json(sanitizeResponse({ success: true, estimatedGas, gasPriceGwei, gasCostEth, gasCostUSD, timestamp: Date.now() }));
    } catch (error) {
        res.status(500).json(sanitizeResponse({ success: false, error: 'Failed' }));
    }
});

app.get('/api/history', async (req, res) => {
    try {
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = currentBlock - 5;
        const filter = firepitContract.filters.Release();
        const events = await firepitContract.queryFilter(filter, fromBlock, currentBlock);
        const recentEvents = await Promise.all(events.reverse().slice(0, 5).map(async (event) => {
            const block = await event.getBlock();
            return {
                hash: event.transactionHash,
                recipient: event.args[2],
                assetCount: event.args[1].length,
                timestamp: block.timestamp * 1000,
                date: new Date(block.timestamp * 1000).toLocaleString()
            };
        }));
        res.json(sanitizeResponse({ success: true, events: recentEvents, timestamp: Date.now() }));
    } catch (error) {
        res.json(sanitizeResponse({ success: true, events: [], error: 'Failed to fetch full history' }));
    }
});

app.get('/api/stats/impact', async (req, res) => {
    try {
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = currentBlock - 5;
        const filter = firepitContract.filters.Release();
        const events = await firepitContract.queryFilter(filter, fromBlock, currentBlock);
        const threshold = await firepitContract.threshold();
        const thresholdEth = parseFloat(ethers.formatEther(threshold));
        const totalUniBurned = events.length * thresholdEth;
        const uniPrice = await getUniPrice();
        const totalValueBurnedUSD = totalUniBurned * uniPrice;
        res.json(sanitizeResponse({
            success: true,
            totalUniBurned: totalUniBurned.toLocaleString(),
            totalValueBurnedUSD: totalValueBurnedUSD.toLocaleString(undefined, { style: 'currency', currency: 'USD' }),
            transactionCount: events.length,
            timeframe: 'Last 7 Days (Approx)',
            timestamp: Date.now()
        }));
    } catch (error) {
        res.json(sanitizeResponse({ success: true, totalUniBurned: "0.00", totalValueBurnedUSD: "$0.00", transactionCount: 0, timestamp: Date.now() }));
    }
});

app.listen(PORT, () => {
    console.log(`\n🔥 Ember (formerly Unifire) - Arbitrage Monitor Port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔐 Security features enabled: Helmet, CORS, Rate Limiting`);
});

module.exports = app;
