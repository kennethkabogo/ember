# Unifire

A privacy-focused, gas-optimized interface for the Uniswap Token Jar.

## Overview

Unifire is a deterministic solver for Uniswap fee arbitrage. It monitors the Token Jar contract (`0xf385...95f85`) and calculates the optimal moment to burn UNI tokens in exchange for accumulated protocol fees.

**Key Features:**

*   **Gas Arbitration:** Algorithmically filters "dust" tokens (where transfer cost > value) to maximize net profit.
*   **Privacy First:** Zero data collection. No third-party APIs for arbitration logic. All transactions are signed locally.
*   **Read-Only Backend:** The server acts as a blinded proxy for blockchain data, ensuring no private keys ever touch the application layer.
*   **MEV awareness:** Includes transaction simulation and slippage protection.

## Setup

1.  **Install Dependencies**
    ```bash
    npm install
    ```

2.  **Configuration**
    Copy `.env.example` to `.env` and add your Ethereum RPC URL (Alchemy/Infura recommended for privacy).
    ```bash
    cp .env.example .env
    ```

3.  **Run Application**
    ```bash
    npm start
    ```
    Access the interface at `http://localhost:3000`.

## Architecture

*   **Contract:** Interactions with the `Firepit` releaser contract (`0x0d5c...6721`).
*   **Solver:** Client-side JavaScript logic optimizes the asset array to strictly include profitable tokens.
*   **Security:** Enforced via Helmet, CORS, and Rate Limiting. No external tracking scripts.

## License

MIT
