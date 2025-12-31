// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

interface IFirepit {
    function burn(uint256 amount) external;
}

/**
 * @title EmberSolver
 * @notice Atomic Arbitrage Solver for Uniswap Firepit
 * @dev Flashloans UNI -> Burns -> Claims Dust -> Swaps to WETH -> Repays Loan -> Profit
 */
contract EmberSolver is Ownable, ReentrancyGuard {
    
    // --- Configuration ---
    address public constant UNI = 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984;
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public constant FIREPIT = 0x8b799381ac40b838BBA4131ffB26197C432A79C9; // Placeholder (Verify actual on mainnet)
    
    ISwapRouter public immutable router;

    constructor(address _router) Ownable(msg.sender) {
        router = ISwapRouter(_router);
    }

    // --- Events ---
    event Solved(uint256 uniBurned, uint256 grossProfit, uint256 netProfit);

    /**
     * @notice Checks if the contract is capable of solving (Profit > Check)
     * @dev Off-chain agents call this to simulate before executing
     */
    function quote(uint256 uniAmount, address[] calldata tokens) external view returns (bool profitable, uint256 estEth) {
        // Simulation logic would go here (or use eth_call)
        return (false, 0);
    }

    /**
     * @notice Main Entry Point: Execute the Arb
     * @param uniAmount Amount of UNI to burn
     * @param tokens List of token addresses found in the jar (from Alchemy)
     * @param minProfitETH Minimum profit required to revert if checks fail
     */
    function execute(
        uint256 uniAmount, 
        address[] calldata tokens, 
        uint256 minProfitETH
    ) external onlyOwner nonReentrant {
        
        // 1. Get UNI (Flash Loan Logic Placeholder - assumes caller has approved or sends UNI)
        // In V2, we implement Balancer/Aave Flash Loan here.
        // For now, we assume this contract was funded or pulls from owner.
        bool success = IERC20(UNI).transferFrom(msg.sender, address(this), uniAmount);
        require(success, "UNI Transfer Failed");

        // 2. Burn UNI to Trigger Claim
        IERC20(UNI).approve(FIREPIT, uniAmount);
        IFirepit(FIREPIT).burn(uniAmount);

        // 3. Sweep & Swap Loop
        uint256 startEthBal = IERC20(WETH).balanceOf(address(this));
        
        for (uint i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            if (token == WETH) continue; // Skip WETH
            
            uint256 bal = IERC20(token).balanceOf(address(this));
            if (bal > 0) {
                _swapToWeth(token, bal);
            }
        }

        // 4. Calculate Net
        uint256 endEthBal = IERC20(WETH).balanceOf(address(this));
        uint256 profit = endEthBal - startEthBal;

        require(profit >= minProfitETH, "Profit below threshold");

        // 5. Send Profit to Owner
        IERC20(WETH).transfer(owner(), profit);
        
        emit Solved(uniAmount, profit, profit);
    }

    /**
     * @dev Interaction with Uniswap Router to sell dust for WETH
     */
    function _swapToWeth(address tokenIn, uint256 amountIn) internal {
        // Approve
        IERC20(tokenIn).approve(address(router), amountIn);

        // V3 Exact Input Single
        ISwapRouter.ExactInputSingleParams memory params =
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: WETH,
                fee: 3000, // TODO: V2 Use Quoter to find best pool (500, 3000, 10000)
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: 0, // DANGEROUS in production (Needs slippage calc)
                sqrtPriceLimitX96: 0
            });

        try router.exactInputSingle(params) {
            // Success
        } catch {
            // If swap fails (no pool), we just keep the dust token
        }
    }

    /**
     * @notice Rescue function if tokens get stuck
     */
    function withdraw(address token) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        IERC20(token).transfer(owner(), bal);
    }
    
    // Accept ETH from WETH withdrawals or Firepit (if it sends ETH)
    receive() external payable {}
}
