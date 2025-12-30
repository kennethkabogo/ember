/**
 * Privacy-focused price feed utilities
 * No user data is transmitted to external APIs
 */

const axios = require('axios');
const { CONTRACTS } = require('../contracts/constants');

// Cache prices to reduce external API calls
const priceCache = new Map();
const CACHE_DURATION = 30000; // 30 seconds

/**
 * Get token price from CoinGecko (no API key required for basic usage)
 * @param {string} tokenAddress - Token contract address
 * @returns {Promise<number>} Price in USD
 */
async function getTokenPrice(tokenAddress) {
    const cacheKey = tokenAddress.toLowerCase();
    const cached = priceCache.get(cacheKey);

    // Return cached price if still valid
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.price;
    }

    try {
        // CoinGecko API - no authentication required for basic usage
        const response = await axios.get(
            `https://api.coingecko.com/api/v3/simple/token_price/ethereum`,
            {
                params: {
                    contract_addresses: tokenAddress,
                    vs_currencies: 'usd'
                },
                timeout: 5000,
                headers: {
                    'Accept': 'application/json',
                    // No user-agent to prevent tracking
                }
            }
        );

        const price = response.data[tokenAddress.toLowerCase()]?.usd;

        if (!price) {
            throw new Error('Price not available');
        }

        // Cache the price
        priceCache.set(cacheKey, {
            price,
            timestamp: Date.now()
        });

        return price;
    } catch (error) {
        console.error(`Error fetching price for ${tokenAddress}:`, error.message);

        // Return cached price even if expired, or throw
        if (cached) {
            return cached.price;
        }

        throw new Error('Unable to fetch token price');
    }
}

/**
 * Get prices for multiple tokens
 * @param {Array<string>} tokenAddresses - Array of token addresses
 * @returns {Promise<Object>} Map of address to price
 */
async function getMultipleTokenPrices(tokenAddresses) {
    const prices = {};

    // Fetch prices in parallel
    const pricePromises = tokenAddresses.map(async (address) => {
        try {
            const price = await getTokenPrice(address);
            prices[address.toLowerCase()] = price;
        } catch (error) {
            console.error(`Failed to get price for ${address}`);
            prices[address.toLowerCase()] = null;
        }
    });

    await Promise.all(pricePromises);

    return prices;
}

/**
 * Get UNI token price
 * @returns {Promise<number>} UNI price in USD
 */
async function getUniPrice() {
    return getTokenPrice(CONTRACTS.UNI_TOKEN);
}

/**
 * Clear price cache (useful for testing)
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
