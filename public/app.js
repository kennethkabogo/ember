/**
 * Secure frontend application for Token Jar Arbitrage
 * All transactions signed locally, zero data transmission
 */

// Contract addresses and ABIs
const CONTRACTS = {
    FIREPIT: '0x0d5cd355e2abeb8fb1552f56c965b867346d6721',
    TOKEN_JAR: '0xf38521f130fccf29db1961597bc5d2b60f995f85',
    UNI_TOKEN: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'
};

const FIREPIT_ABI = [
    'function release(uint256 _nonce, address[] calldata assets, address recipient) external',
    'function threshold() view returns (uint256)',
    'function TOKEN_JAR() view returns (address)'
];

const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)'
];

// Global state
const DEBUG_MODE = false; // Set to false for production
let provider = null;
let signer = null;
let userAddress = null;
let chainId = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    loadJarData();
    startAutoRefresh();
});

function initializeApp() {
    console.log('🔒 Token Jar Arbitrage - Privacy Mode Active');
    console.log('🚫 No tracking, No logging, No data collection');
}

function setupEventListeners() {
    document.getElementById('connectWallet').addEventListener('click', connectWallet);
    document.getElementById('executeBtn').addEventListener('click', prepareTransaction);
    document.getElementById('cancelBtn').addEventListener('click', closeModal);
    document.getElementById('confirmBtn').addEventListener('click', executeTransaction);
}

// Wallet Connection
async function connectWallet() {
    try {
        if (typeof window.ethereum === 'undefined') {
            alert('Please install MetaMask or another Web3 wallet');
            return;
        }

        // Request account access
        const accounts = await window.ethereum.request({
            method: 'eth_requestAccounts'
        });

        userAddress = accounts[0];

        // Initialize ethers provider
        if (!window.ethers) {
            throw new Error('Ethers.js library not loaded. Please refresh the page.');
        }

        // Use the global window.ethers object directly
        provider = new window.ethers.providers.Web3Provider(window.ethereum);
        signer = provider.getSigner();

        // Get chain ID
        const network = await provider.getNetwork();
        chainId = network.chainId;

        // Verify we're on mainnet
        if (chainId !== 1) {
            alert('Please connect to Ethereum Mainnet');
            return;
        }

        // Update UI
        updateWalletUI();
        updateNetworkStatus();

        // Listen for account changes
        window.ethereum.on('accountsChanged', handleAccountsChanged);
        window.ethereum.on('chainChanged', handleChainChanged);

    } catch (error) {
        console.error('Wallet connection error:', error);
        alert('Failed to connect wallet: ' + error.message);
    }
}

function updateWalletUI() {
    const walletBtn = document.getElementById('connectWallet');
    const executeBtn = document.getElementById('executeBtn');

    if (userAddress) {
        const shortAddress = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
        walletBtn.textContent = shortAddress;
        walletBtn.classList.add('connected');
        executeBtn.disabled = false;
        executeBtn.textContent = 'Simulate Transaction';
    }
}

function updateNetworkStatus() {
    // Network status integrated into wallet button state in new design
}

function handleAccountsChanged(accounts) {
    if (accounts.length === 0) {
        // User disconnected wallet
        userAddress = null;
        provider = null;
        signer = null;
        location.reload();
    } else {
        userAddress = accounts[0];
        updateWalletUI();
    }
}

function handleChainChanged() {
    location.reload();
}

// Load Jar Data
async function loadJarData() {
    try {
        const response = await fetch('/api/jar-balance');
        const data = await response.json();

        if (data.success) {
            updateJarUI(data);
            loadProfitability();
        }
    } catch (error) {
        console.error('Error loading jar data:', error);
    }
}

function updateJarUI(data) {
    // Update stats
    document.getElementById('totalValue').textContent = `$${data.totalValueUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Update token list
    const tokenList = document.getElementById('tokenList');
    tokenList.innerHTML = '';

    if (data.tokens.length === 0) {
        tokenList.innerHTML = '<div class="token-item" style="justify-content: center; color: var(--text-secondary);">Jar is empty</div>';
        return;
    }

    data.tokens.forEach(token => {
        const balance = parseFloat(window.ethers.utils.formatUnits(token.balance, token.decimals));
        const value = balance * token.price;

        // Only show significant tokens to keep UI clean
        if (value < 0.01) return;

        const tokenEl = document.createElement('div');
        tokenEl.className = 'token-item';
        tokenEl.innerHTML = `
      <div class="token-left">
        <span class="token-symbol">${token.symbol}</span>
        <span class="token-balance">${balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
      </div>
      <div class="token-value">$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
    `;
        tokenList.appendChild(tokenEl);
    });
}

// Load Profitability
async function loadProfitability() {
    try {
        const response = await fetch('/api/profitability');
        const data = await response.json();

        if (data.success) {
            updateProfitabilityUI(data);
        }
    } catch (error) {
        console.error('Error loading profitability:', error);
    }
}

function updateProfitabilityUI(data) {
    // Update calculator values
    document.getElementById('uniAmount').textContent = `${parseFloat(data.uniAmount).toLocaleString()} UNI`;
    document.getElementById('uniCost').textContent = data.uniCostUSD;
    // Gas cost removed from top grid, moved to calculation area or tooltip logic if needed, 
    // but here we are replacing "Gas Estimate" with "Break Even Price" in the grid.
    // So we update the new element ID:
    document.getElementById('breakEvenPrice').textContent = data.breakEvenUniPrice;

    document.getElementById('netProfit').textContent = data.netProfit;

    // Update profit styling
    const netProfitEl = document.getElementById('netProfit');
    const executeBtn = document.getElementById('executeBtn');

    if (data.isProfitable === 'true') {
        netProfitEl.className = 'profit-val positive';

        if (executeBtn.textContent === 'Simulate Transaction') {
            executeBtn.style.background = 'var(--success)';
        }
    } else {
        netProfitEl.className = 'profit-val negative';
        executeBtn.style.background = 'var(--primary)';
    }

    // Update Dust Filter Badge
    const dustBadge = document.getElementById('dustBadge');
    const dustText = document.getElementById('dustText');

    if (data.filtered) {
        dustBadge.style.display = 'flex';
        dustText.textContent = `Filtered ${data.dustCount} dust tokens (Saved ${data.savedGas})`;

        // Store optimal tokens for execution
        window.optimalTokens = data.optimalTokens;
    } else {
        dustBadge.style.display = 'none';
        window.optimalTokens = null;
    }
}

// Transaction Preparation
async function prepareTransaction() {
    if (!signer) {
        alert('Please connect your wallet first');
        return;
    }

    try {
        // Get current data
        const jarResponse = await fetch('/api/jar-balance');
        const jarData = await jarResponse.json();

        const thresholdResponse = await fetch('/api/threshold');
        const thresholdData = await thresholdResponse.json();

        // Fetch latest profitability data for optimal token list
        const profitabilityResponse = await fetch('/api/profitability');
        const profitabilityData = await profitabilityResponse.json();

        if (!jarData.success || !thresholdData.success || !profitabilityData.success) {
            alert('Failed to fetch transaction data');
            return;
        }

        // Prepare transaction parameters
        // Use filtered (optimal) list if available, otherwise all
        const tokenAddresses = profitabilityData.optimalTokens || jarData.tokens.map(t => t.address);

        if (tokenAddresses.length === 0) {
            alert('No profitable tokens to claim!');
            return;
        }

        const nonce = Date.now(); // Simple nonce based on timestamp

        // Simulate transaction
        const simulationResult = await simulateTransaction(
            nonce,
            tokenAddresses,
            userAddress,
            thresholdData.threshold
        );

        if (simulationResult.success) {
            showConfirmationModal(simulationResult);
        } else {
            alert('Transaction simulation failed: ' + simulationResult.error);
        }

    } catch (error) {
        console.error('Transaction preparation error:', error);
        alert('Failed to prepare transaction: ' + error.message);
    }
}

// Transaction Simulation
async function simulateTransaction(nonce, assets, recipient, threshold) {
    try {
        const firepitContract = new window.ethers.Contract(CONTRACTS.FIREPIT, FIREPIT_ABI, provider);
        const uniContract = new window.ethers.Contract(CONTRACTS.UNI_TOKEN, ERC20_ABI, provider);

        // Check UNI balance
        const uniBalance = await uniContract.balanceOf(userAddress);

        if (DEBUG_MODE) {
            console.log('🚧 DEBUG MODE: Bypassing balance check & gas estimation');
            return {
                success: true,
                nonce,
                assets,
                recipient,
                threshold,
                gasEstimate: '250000', // Mock gas
                needsApproval: true    // Mock approval requirement
            };
        }

        if (uniBalance.lt(threshold)) {
            return {
                success: false,
                error: `Insufficient UNI balance. Required: ${window.ethers.utils.formatEther(threshold)} UNI`
            };
        }

        // Check allowance
        const allowance = await uniContract.allowance(userAddress, CONTRACTS.FIREPIT);
        const needsApproval = allowance.lt(threshold);

        // Estimate gas
        let gasEstimate;
        try {
            gasEstimate = await firepitContract.estimateGas.release(nonce, assets, recipient);
        } catch (error) {
            return {
                success: false,
                error: 'Transaction would fail: ' + error.message
            };
        }

        return {
            success: true,
            nonce,
            assets,
            recipient,
            threshold,
            gasEstimate: gasEstimate.toString(),
            needsApproval
        };

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// Show Confirmation Modal
function showConfirmationModal(simulationResult) {
    const modal = document.getElementById('confirmModal');
    const details = document.getElementById('confirmDetails');

    const thresholdEth = window.ethers.utils.formatEther(simulationResult.threshold);

    details.innerHTML = `
    <div class="profit-row">
      <span class="profit-label">UNI to Burn</span>
      <span class="profit-val">${thresholdEth}</span>
    </div>
    <div class="profit-row">
      <span class="profit-label">Assets to Claim</span>
      <span class="profit-val">${simulationResult.assets.length}</span>
    </div>
    <div class="profit-row">
      <span class="profit-label">Est. Gas</span>
      <span class="profit-val">${simulationResult.gasEstimate}</span>
    </div>
    ${simulationResult.needsApproval ? '<p style="color: var(--warning); font-size: 13px; text-align: center; margin-top: 12px;">Approve transaction required first</p>' : ''}
  `;

    modal.classList.add('active');

    // Store simulation result for execution
    window.pendingTransaction = simulationResult;
}

function closeModal() {
    document.getElementById('confirmModal').classList.remove('active');
    window.pendingTransaction = null;
}

// Execute Transaction
async function executeTransaction() {
    if (!window.pendingTransaction) {
        return;
    }

    const tx = window.pendingTransaction;

    try {
        const uniContract = new window.ethers.Contract(CONTRACTS.UNI_TOKEN, ERC20_ABI, signer);
        const firepitContract = new window.ethers.Contract(CONTRACTS.FIREPIT, FIREPIT_ABI, signer);

        // Step 1: Approve if needed
        if (tx.needsApproval) {
            console.log('Requesting approval...');
            const approveTx = await uniContract.approve(CONTRACTS.FIREPIT, tx.threshold);
            await approveTx.wait();
            console.log('Approval confirmed');
        }

        // Step 2: Execute release
        console.log('Executing release...');
        const releaseTx = await firepitContract.release(tx.nonce, tx.assets, tx.recipient);

        closeModal();
        alert('Transaction submitted! Hash: ' + releaseTx.hash);

        // Wait for confirmation
        await releaseTx.wait();
        alert('Transaction confirmed! ✅');

        // Refresh data
        loadJarData();

    } catch (error) {
        console.error('Transaction execution error:', error);
        alert('Transaction failed: ' + error.message);
    }
}



// --- AUDIO ALERT SYSTEM ---
let audioEnabled = false;
let hasPlayedAlert = false;

document.getElementById('audioToggle').addEventListener('click', () => {
    audioEnabled = !audioEnabled;
    const btn = document.getElementById('audioToggle');
    btn.textContent = audioEnabled ? '🔊' : '🔇';

    // Test sound on enable
    if (audioEnabled) playSound(true);
});

function playSound(isTest = false) {
    if (!audioEnabled && !isTest) return;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(isTest ? 440 : 880, ctx.currentTime); // A4 (test) or A5 (alert)
    osc.frequency.exponentialRampToValueAtTime(isTest ? 880 : 1760, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.5);
}

// --- HISTORY SYSTEM ---
async function loadHistory() {
    try {
        const response = await fetch('/api/history');
        const data = await response.json();
        const list = document.getElementById('activityList');

        if (data.success && data.events.length > 0) {
            list.innerHTML = '';
            data.events.forEach(evt => {
                const row = document.createElement('div');
                row.className = 'token-item';
                row.innerHTML = `
                    <div style="display:flex; flex-direction:column;">
                        <span style="color:var(--text-primary); font-size:14px;">Claimed ${evt.assetCount} Assets</span>
                        <a href="https://etherscan.io/tx/${evt.hash}" target="_blank" style="color:var(--text-secondary); font-size:12px; text-decoration:none;">
                            ${new Date(evt.timestamp).toLocaleString()} ↗
                        </a>
                    </div>
                    <div style="color:var(--success);">Success</div>
                `;
                list.appendChild(row);
            });
        } else {
            list.innerHTML = '<div class="token-item" style="justify-content: center; color: var(--text-secondary);">No recent activity (Jar is filling...)</div>';
        }
    } catch (e) {
        console.error("History error", e);
    }
}

// Update refresh loop to include history
function startAutoRefresh() {
    loadHistory(); // Initial load
    setInterval(() => {
        loadJarData();
        loadHistory(); // Refresh history
    }, 30000);
}

// Hook into profit UI for sound
const originalUpdateProfit = updateProfitabilityUI;
updateProfitabilityUI = function (data) {
    originalUpdateProfit(data);

    if (data.isProfitable === 'true') {
        if (!hasPlayedAlert) {
            playSound();
            hasPlayedAlert = true; // Play once per opportunity
        }
    } else {
        hasPlayedAlert = false; // Reset when not profitable
    }
};
