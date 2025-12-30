/**
 * Privacy-focused price feed utilities
 * No user data is transmitted to external APIs
 */

const axios = require('axios');
const { CONTRACTS } = require('../contracts/constants');

// Cache prices to reduce external API calls
const priceCache = new Map();
const CACHE_DURATION = 60000; // 60 seconds

/**
 * Get prices for multiple tokens in a single batch request
 * @param {Array<string>} tokenAddresses - Array of token addresses
 * @returns {Promise<Object>} Map of address to price
 */
async function getMultipleTokenPrices(tokenAddresses) {
    const prices = {};
    const toFetch = [];
    const now = Date.now();

    // Check cache first
    tokenAddresses.forEach(address => {
        const addr = address.toLowerCase();
        const cached = priceCache.get(addr);
        if (cached && (now - cached.timestamp < CACHE_DURATION)) {
            prices[addr] = cached.price;
        } else {
            toFetch.push(addr);
        }
    });

    if (toFetch.length === 0) return prices;

    try {
        // CoinGecko Batch API
        const response = await axios.get(
            `https://api.coingecko.com/api/v3/simple/token_price/ethereum`,
            {
                params: {
                    contract_addresses: toFetch.join(','),
                    vs_currencies: 'usd'
                },
                timeout: 5000
            }
        );

        const data = response.data;
        toFetch.forEach(addr => {
            const price = data[addr]?.usd;
            if (price !== undefined) {
                prices[addr] = price;
                priceCache.set(addr, { price, timestamp: now });
            } else {
                // Keep old price if fetch fails
                const cached = priceCache.get(addr);
                if (cached) prices[addr] = cached.price;
            }
        });
    } catch (error) {
        console.error('Batch price fetch failed:', error.message);
        // Fallback to cache for everything
        toFetch.forEach(addr => {
            const cached = priceCache.get(addr);
            if (cached) prices[addr] = cached.price;
        });
    }

    return prices;
}

/**
 * Get single token price (uses batch logic internally)
 */
async function getTokenPrice(tokenAddress) {
    const prices = await getMultipleTokenPrices([tokenAddress]);
    return prices[tokenAddress.toLowerCase()] || 0;
}

/**
 * Get UNI token price
 */
async function getUniPrice() {
    return getTokenPrice(CONTRACTS.UNI_TOKEN);
}

/**
 * Clear price cache
 */
function clearPriceCache() {
    priceCache.clear();
}

module.exports = {
    getTokenPrice,
    getMultipleTokenPrices,
    getUniPrice,
    clearPriceCache
};
