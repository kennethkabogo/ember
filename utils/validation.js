/**
 * Security-focused input validation utilities
 * All user inputs must be validated before processing
 */

const { NETWORK } = require('../contracts/constants');

/**
 * Validate Ethereum address format
 * @param {string} address - Address to validate
 * @returns {string} Lowercase validated address
 * @throws {Error} If address is invalid
 */
function validateEthereumAddress(address) {
    if (!address || typeof address !== 'string') {
        throw new Error('Address must be a string');
    }

    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!addressRegex.test(address)) {
        throw new Error('Invalid Ethereum address format');
    }

    return address.toLowerCase();
}

/**
 * Validate chain ID
 * @param {number} chainId - Chain ID to validate
 * @throws {Error} If not Ethereum mainnet
 */
function validateChainId(chainId) {
    if (chainId !== NETWORK.MAINNET_CHAIN_ID) {
        throw new Error(`Invalid network. Please connect to ${NETWORK.NAME} (Chain ID: ${NETWORK.MAINNET_CHAIN_ID})`);
    }
}

/**
 * Validate numeric value
 * @param {any} value - Value to validate
 * @param {string} name - Name of the value for error messages
 * @returns {number} Validated number
 * @throws {Error} If value is not a valid positive number
 */
function validatePositiveNumber(value, name = 'value') {
    const num = Number(value);

    if (isNaN(num) || !isFinite(num)) {
        throw new Error(`${name} must be a valid number`);
    }

    if (num <= 0) {
        throw new Error(`${name} must be positive`);
    }

    return num;
}

/**
 * Validate array of addresses
 * @param {Array} addresses - Array of addresses to validate
 * @param {number} maxLength - Maximum allowed length
 * @returns {Array} Validated addresses
 * @throws {Error} If array is invalid
 */
function validateAddressArray(addresses, maxLength) {
    if (!Array.isArray(addresses)) {
        throw new Error('Addresses must be an array');
    }

    if (addresses.length === 0) {
        throw new Error('Addresses array cannot be empty');
    }

    if (addresses.length > maxLength) {
        throw new Error(`Too many addresses. Maximum: ${maxLength}`);
    }

    return addresses.map(addr => validateEthereumAddress(addr));
}

/**
 * Sanitize response data to prevent information leakage
 * @param {any} data - Data to sanitize
 * @returns {any} Sanitized data
 */
function sanitizeResponse(data) {
    // Remove any potential error stack traces in production
    if (process.env.NODE_ENV === 'production' && data.error) {
        return {
            ...data,
            error: data.error.message || 'An error occurred'
        };
    }

    return data;
}

module.exports = {
    validateEthereumAddress,
    validateChainId,
    validatePositiveNumber,
    validateAddressArray,
    sanitizeResponse
};
