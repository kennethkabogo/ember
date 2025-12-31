/**
 * Ember V4: Solver Edition
 * Professional Arbitrage Monitor Logic
 */

let provider, signer, jarContract, firepitContract;

// CONFIG
const REFRESH_INTERVAL = 12000; // 12s (approx block time)
const UNI_ADDRESS = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
let NOTIFY_ENABLED = false;

// STATE
let appState = {
    jarValue: 0,
    costToBurn: 0,
    netProfit: 0,
    dailyGrowth: 0,
    profitable: false,
    scenarios: null, // Store backend strategies
    activeMode: 'standard' // standard, fast, instant
};

// DOM Elements
const els = {
    heroCard: document.getElementById('heroCard'),
    totalValue: document.getElementById('totalValue'),
    progressBar: document.getElementById('progressBar'),
    uniCost: document.getElementById('uniCost'),
    netProfit: document.getElementById('netProfit'),
    statusBanner: document.getElementById('statusBanner'),
    executeBtn: document.getElementById('executeBtn'),

    // Gas
    gasBtns: document.querySelectorAll('.gas-btn'),

    // Timeline
    proj1d: document.getElementById('proj1d'),
    proj7d: document.getElementById('proj7d'),
    proj30d: document.getElementById('proj30d'),

    // Assets
    tokenList: document.getElementById('tokenList'),
    dustBadge: document.getElementById('dustBadge'),
    expectedOutput: document.getElementById('expectedOutput'),

    // Notifications
    notifyToggle: document.getElementById('notifyToggle')
};

// --- INIT ---
async function init() {
    console.log("🔥 Ember Solver V4 initializing...");
    lucide.createIcons();

    setupNotifications();
    setupEventListeners();
    setupGasToggles();

    // Initial Load
    await refreshData();
    setInterval(refreshData, REFRESH_INTERVAL);
}

function setupGasToggles() {
    els.gasBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            els.gasBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            appState.activeMode = btn.dataset.mode;
            if (appState.scenarios) updateActiveModeData(); // Refresh View
        });
    });
}

function setupNotifications() {
    els.notifyToggle.addEventListener('change', (e) => {
        NOTIFY_ENABLED = e.target.checked;
        if (NOTIFY_ENABLED && Notification.permission !== 'granted') {
            Notification.requestPermission();
        }
    });
}

function setupEventListeners() {
    document.getElementById('connectWallet').addEventListener('click', connectWallet);
    els.executeBtn.addEventListener('click', () => {
        if (!signer) {
            connectWallet();
        } else {
            showConfirmModal();
        }
    });

    // Close modal
    document.getElementById('cancelBtn').addEventListener('click', () => {
        document.getElementById('confirmModal').style.display = 'none';
    });
    document.getElementById('confirmBtn').addEventListener('click', executeTrade);
}

async function connectWallet() {
    if (typeof window.ethereum !== 'undefined') {
        try {
            await window.ethereum.request({ method: 'eth_requestAccounts' });
            provider = new ethers.providers.Web3Provider(window.ethereum);
            signer = provider.getSigner();

            const address = await signer.getAddress();
            document.getElementById('connectWallet').textContent = `${address.substring(0, 6)}...${address.substring(38)}`;
            updateButtonState();
        } catch (error) {
            console.error("User denied account access");
        }
    } else {
        alert("Please install MetaMask!");
    }
}

async function refreshData() {
    try {
        // Fetch all data in parallel
        const [balanceRes, profitRes, impactRes] = await Promise.all([
            fetch('/api/jar-balance'),
            fetch('/api/profitability'),
            fetch('/api/stats/impact')
        ]);

        const balanceData = await balanceRes.json();
        const profitData = await profitRes.json();
        const impactData = await impactRes.json();

        // Check if gas scenarios exist (backend support)
        if (profitData.scenarios) {
            appState.scenarios = profitData.scenarios;
        }

        updateState(balanceData, profitData, impactData);
        renderUI(balanceData);

    } catch (e) {
        console.error("Refresh failed:", e);
    }
}

function updateState(balance, profit, impact) {
    appState.jarValue = balance.totalValueUSD || 0;

    // Estimate Growth
    const burned7d = parseFloat(impact.totalValueBurnedUSD.replace(/[^0-9.-]+/g, "")) || 0;
    appState.dailyGrowth = (burned7d / 7) || 100;

    updateActiveModeData();
}

function updateActiveModeData() {
    if (!appState.scenarios) return;

    const scenario = appState.scenarios[appState.activeMode];
    appState.costToBurn = scenario.costUSD || 0;
    appState.netProfit = scenario.netProfitUSD || 0;
    appState.profitable = appState.netProfit > 0;

    // Re-render relevant parts if not first load
    // But since renderUI is called after this in refresh, we are good.
    // If called from button click, we need to manually trigger render of values.
    renderValuesOnly();
}

function renderValuesOnly() {
    // 1. Hero Card Value
    els.totalValue.textContent = `$${appState.jarValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    els.uniCost.textContent = `$${appState.costToBurn.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

    // 2. Net Profit & Coloring
    const isProfit = appState.netProfit > 0;
    const isClose = !isProfit && (appState.netProfit > -(appState.costToBurn * 0.1));

    els.netProfit.textContent = (appState.netProfit >= 0 ? '+' : '') + `$${appState.netProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    els.netProfit.style.color = isProfit ? 'var(--accent-green)' : (isClose ? 'var(--accent-yellow)' : 'var(--accent-red)');

    // 3. Status Classes
    els.heroCard.className = 'hero-card ' + (isProfit ? 'status-green' : (isClose ? 'status-yellow' : 'status-red'));

    // 4. Progress Bar
    const percent = Math.min(100, (appState.jarValue / appState.costToBurn) * 100) || 0;
    els.progressBar.style.width = `${percent}%`;
    els.progressBar.style.backgroundColor = isProfit ? 'var(--accent-green)' : (isClose ? 'var(--accent-yellow)' : 'var(--accent-red)');

    // 5. Status Banner
    let statusIcon = 'alert-triangle';
    let statusText = 'NOT PROFITABLE YET';

    if (isProfit) {
        statusIcon = 'check-circle';
        statusText = 'PROFITABLE - READY TO CLAIM';
        els.statusBanner.style.background = 'var(--accent-green-dim)';
        els.statusBanner.style.color = 'var(--accent-green)';
    } else if (isClose) {
        statusIcon = 'zap';
        statusText = 'APPROACHING BREAK-EVEN';
        els.statusBanner.style.background = 'var(--accent-yellow-dim)';
        els.statusBanner.style.color = 'var(--accent-yellow)';
    } else {
        els.statusBanner.style.background = 'var(--accent-red-dim)';
        els.statusBanner.style.color = 'var(--accent-red)';
    }

    els.statusBanner.innerHTML = `<i data-lucide="${statusIcon}"></i><span>${statusText}</span>`;
    lucide.createIcons();

    updateButtonState();
    renderProjections();
}

function updateButtonState() {
    els.executeBtn.disabled = !appState.profitable;
    if (signer) {
        els.executeBtn.textContent = appState.profitable ? "Burn & Claim (Ready)" : "Not Profitable";
    }
}

function renderUI(balanceData) {
    if (appState.scenarios) {
        renderValuesOnly();
    }

    // 8. Assets List
    renderAssets(balanceData.tokens);

    // Notification Check
    if (NOTIFY_ENABLED && appState.profitable) {
        new Notification("Ember Alert", { body: `Profitable! Net: $${appState.netProfit.toFixed(2)}` });
        NOTIFY_ENABLED = false; // Alert once
        els.notifyToggle.checked = false;
    }
}

function renderProjections() {
    // 7. Timeline Projections (Simple Interest)
    // Formula: Current + (Daily * Days) - Cost
    const project = (days) => {
        const futureVal = appState.jarValue + (appState.dailyGrowth * days);
        const futureProfit = futureVal - appState.costToBurn; // Cost might rise too, but let's assume static
        return (futureProfit >= 0 ? '+' : '') + `$${futureProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    };

    els.proj1d.textContent = project(1);
    els.proj7d.textContent = project(7);
    els.proj30d.textContent = project(30);

    // Color timeline
    [els.proj1d, els.proj7d, els.proj30d].forEach(el => {
        el.style.color = el.textContent.includes('+') ? 'var(--accent-green)' : 'var(--text-tertiary)';
    });
}

function renderAssets(tokens) {
    els.tokenList.innerHTML = '';

    // Filter Dust (< $0.01)
    const visible = tokens.filter(t => t.valueUSD > 0.01);
    const dustCount = tokens.length - visible.length;

    // Update Badge
    if (dustCount > 0) {
        els.dustBadge.style.display = 'inline-block';
        els.dustBadge.textContent = `Filtered ${dustCount} dust tokens`;
    } else {
        els.dustBadge.style.display = 'none';
    }

    // Update Expected Output Text
    els.expectedOutput.textContent = `${visible.length} Major Assets + ${dustCount} Dust`;

    if (visible.length === 0) {
        els.tokenList.innerHTML = `
            <div class="empty-state">
                <i data-lucide="inbox"></i>
                <p>Jar is empty<br><span style="font-size:11px; color:var(--text-tertiary)">(Only dust remains)</span></p>
            </div>
        `;
    } else {
        visible.forEach(t => {
            const div = document.createElement('div');
            div.className = 'token-item';
            const bal = parseFloat(t.balance) / (10 ** t.decimals);
            div.innerHTML = `
                <div class="token-info">
                    <div class="token-icon">${t.symbol[0]}</div>
                    <div>
                        <div class="token-symbol">${t.symbol}</div>
                        <div class="token-balance">${bal.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                    </div>
                </div>
                <div class="token-value">$${t.valueUSD.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            `;
            els.tokenList.appendChild(div);
        });
    }
    lucide.createIcons();
}

async function showConfirmModal() {
    const details = document.getElementById('confirmDetails');
    details.innerHTML = `
        <p>You are about to burn <strong>4,000 UNI</strong> to claim <strong>$${appState.jarValue.toFixed(2)}</strong> in assets.</p>
        <br>
        <p>Est. Gas: <span style="color:var(--text-primary)">$${(appState.costToBurn - (4000 * 6)).toFixed(2)}</span></p>
        <p>Net Profit: <span style="color:var(--accent-green)">$${appState.netProfit.toFixed(2)}</span></p>
    `;
    document.getElementById('confirmModal').style.display = 'flex';
}

async function executeTrade() {
    alert("Simulation: Transaction sent to mempool! (Read-only mode)");
    document.getElementById('confirmModal').style.display = 'none';
}

// Start
init();
