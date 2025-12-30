/**
 * Profit calculation utilities for Token Jar arbitrage
 */

const { ethers } = require('ethers');
const { SECURITY } = require('../contracts/constants');

/**
 * Calculate expected profit from burning UNI
 * @param {string} uniAmount - Amount of UNI to burn (in wei)
 * @param {number} uniPrice - UNI price in USD
 * @param {Array} jarTokens - Array of {address, balance, price}
 * @param {string} threshold - Threshold amount of UNI required (in wei)
 * @param {number} gasPrice - Current gas price in gwei
 * @returns {Object} Profit calculation details
 */
 */
async function calculateProfit(uniAmount, uniPrice, jarTokens, threshold, gasPrice) {
    // Calculate gas costs
    const TRANSFER_GAS_COST = 60000; // Approx gas per token transfer
    const BASE_GAS_COST = 100000;    // Approx base gas for transaction

    // Conversions
    const uniAmountEth = parseFloat(ethers.formatEther(uniAmount));
    const thresholdEth = parseFloat(ethers.formatEther(threshold));
    const uniCostUSD = uniAmountEth * uniPrice;

    const ethPrice = (jarTokens.find(t => t.symbol === 'WETH')?.price || 2000); // Fallback ETH price
    const gasPriceEth = gasPrice / 1e9;
    const transferCostUSD = (TRANSFER_GAS_COST * gasPriceEth) * ethPrice;

    // Filter tokens: Keep only if Value > Transfer Cost
    const optimalTokens = [];
    const dustTokens = [];
    let optimizedJarValueUSD = 0;

    for (const token of jarTokens) {
        const balanceEth = parseFloat(ethers.formatUnits(token.balance, token.decimals || 18));
        const valueUSD = balanceEth * token.price;

        if (valueUSD > transferCostUSD) {
            optimalTokens.push({
                ...token,
                balanceEth,
                valueUSD,
                netValueUSD: valueUSD - transferCostUSD
            });
            optimizedJarValueUSD += valueUSD;
        } else {
            dustTokens.push({
                ...token,
                balanceEth,
                valueUSD,
                costToClaimUSD: transferCostUSD
            });
        }
    }

    // Recalculate Total Estimated Gas based on OPTIMAL tokens only
    const estimatedGas = BASE_GAS_COST + (optimalTokens.length * TRANSFER_GAS_COST);
    const totalGasCostEth = (estimatedGas * gasPrice) / 1e9;
    const totalGasCostUSD = totalGasCostEth * ethPrice;

    // Calculate profit
    const grossProfit = optimizedJarValueUSD - uniCostUSD;
    const netProfit = grossProfit - totalGasCostUSD;
    const profitPercentage = uniCostUSD > 0 ? (netProfit / uniCostUSD) * 100 : 0;

    // Calculate minimum output with slippage protection
    const minimumOutputUSD = optimizedJarValueUSD * (1 - SECURITY.DEFAULT_SLIPPAGE_TOLERANCE / 100);

    return {
        uniAmount: uniAmountEth,
        uniCostUSD,
        totalJarValueUSD: optimizedJarValueUSD, // Value of claimable tokens only
        gasCostUSD: totalGasCostUSD,
        grossProfit,
        netProfit,
        profitPercentage,
        minimumOutputUSD,
        isProfitable: netProfit > 0,
        meetsThreshold: uniAmountEth >= thresholdEth,
        tokenBreakdown: optimalTokens,     // Only show profitable tokens
        dustTokens,                        // Return dust for UI feedback
        estimatedGas,
        allTokensCount: jarTokens.length,  // Total count for comparison
        filteredCount: dustTokens.length,
        savedGasUSD: dustTokens.length * transferCostUSD
    };
}

/**
 * Calculate optimal UNI amount to burn
 * @param {Array} jarTokens - Array of tokens in jar
 * @param {number} uniPrice - UNI price in USD
 * @param {string} threshold - Minimum UNI threshold (in wei)
 * @param {number} gasPrice - Current gas price in gwei
 * @returns {Object} Optimal burn amount and expected profit
 */
function calculateOptimalBurn(jarTokens, uniPrice, threshold, gasPrice) {
    const thresholdEth = parseFloat(ethers.formatEther(threshold));

    // Optimal burn is the threshold (minimum required)
    const optimalBurnWei = threshold; // Keep as BigInt/String from input

    // Calculate profit using the Gas Arbitration logic above
    const profit = calculateProfit(
        optimalBurnWei,
        uniPrice,
        jarTokens,
        threshold,
        gasPrice
    );

    return {
        optimalBurnAmount: thresholdEth,
        optimalBurnWei: optimalBurnWei.toString(),
        ...profit
    };
}

/**
 * Format profit data for display
 * @param {Object} profitData - Profit calculation result
 * @returns {Object} Formatted data
 */
function formatProfitData(profitData) {
    return {
        uniAmount: profitData.uniAmount.toFixed(2),
        uniCostUSD: `$${profitData.uniCostUSD.toFixed(2)}`,
        totalJarValueUSD: `$${profitData.totalJarValueUSD.toFixed(2)}`,
        gasCostUSD: `$${profitData.gasCostUSD.toFixed(2)}`,
        grossProfit: `$${profitData.grossProfit.toFixed(2)}`,
        netProfit: `$${profitData.netProfit.toFixed(2)}`,
        profitPercentage: `${profitData.profitPercentage.toFixed(2)}%`,
        minimumOutputUSD: `$${profitData.minimumOutputUSD.toFixed(2)}`,
        isProfitable: profitData.isProfitable,
        meetsThreshold: profitData.meetsThreshold,
        tokenBreakdown: profitData.tokenBreakdown.map(t => ({
            address: t.address,
            symbol: t.symbol,
            balance: t.balanceEth.toFixed(6),
            valueUSD: `$${t.valueUSD.toFixed(2)}`
        })),
        dustCount: profitData.filteredCount,
        savedGas: `$${profitData.savedGasUSD.toFixed(2)}`,
        filtered: profitData.filteredCount > 0
    };
}

module.exports = {
    calculateProfit,
    calculateOptimalBurn,
    formatProfitData
};
