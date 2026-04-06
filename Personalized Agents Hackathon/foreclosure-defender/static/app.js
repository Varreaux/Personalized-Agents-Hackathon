// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
    });
});

// Health check
async function checkHealth() {
    try {
        const resp = await fetch('/api/health');
        const data = await resp.json();
        const badge = document.getElementById('health-status');
        badge.textContent = data.status === 'ok' ? 'OpenClaw Connected' : 'Degraded';
        badge.className = 'health-badge ' + (data.status === 'ok' ? 'ok' : 'degraded');
    } catch {
        const badge = document.getElementById('health-status');
        badge.textContent = 'Disconnected';
        badge.className = 'health-badge';
    }
}

// Load attack prompts
async function loadAttacks() {
    try {
        const resp = await fetch('/api/attacks/list');
        const attacks = await resp.json();
        const container = document.getElementById('attack-list');
        container.innerHTML = attacks.map(atk => `
            <div class="attack-card">
                <div class="attack-info">
                    <h4>${atk.id}</h4>
                    <div class="category">${atk.category}</div>
                    <div class="prompt-text">${atk.prompt}</div>
                </div>
                <button class="btn btn-primary" onclick="runSingleAttack('${atk.id}')">Run</button>
            </div>
        `).join('');
    } catch (e) {
        document.getElementById('attack-list').innerHTML =
            '<p class="empty-state">Failed to load attack prompts.</p>';
    }
}

// Run a single attack
async function runSingleAttack(attackId) {
    try {
        const resp = await fetch('/api/attacks/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attack_id: attackId })
        });
        const result = await resp.json();
        refreshLog();
        updateStats();
    } catch (e) {
        console.error('Attack failed:', e);
    }
}

// Run all attacks
async function runAllAttacks() {
    const btn = document.getElementById('run-all-btn');
    btn.disabled = true;
    btn.textContent = 'Running...';

    try {
        const resp = await fetch('/api/attacks/run-all', { method: 'POST' });
        const results = await resp.json();
        refreshLog();
        updateStats();
    } catch (e) {
        console.error('Run all failed:', e);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Run All Attacks';
    }
}

// Refresh attack log
async function refreshLog() {
    try {
        const resp = await fetch('/api/attacks/log');
        const log = await resp.json();
        const container = document.getElementById('attack-log');

        if (log.length === 0) {
            container.innerHTML = '<p class="empty-state">No attacks have been run yet.</p>';
            return;
        }

        container.innerHTML = log.slice().reverse().map(entry => `
            <div class="log-entry ${entry.blocked ? 'blocked' : 'bypassed'}">
                <div class="log-header">
                    <span class="log-id">${entry.id}</span>
                    <span class="log-category">${entry.category}</span>
                    <span class="log-status ${entry.blocked ? 'blocked' : 'bypassed'}">
                        ${entry.blocked ? 'BLOCKED' : 'BYPASSED'}
                    </span>
                </div>
                <div class="log-prompt">${entry.prompt.substring(0, 150)}...</div>
                <div class="log-response">${entry.response}</div>
            </div>
        `).join('');

        updateStats();
    } catch (e) {
        console.error('Failed to refresh log:', e);
    }
}

// Update dashboard stats
async function updateStats() {
    try {
        const resp = await fetch('/api/attacks/log');
        const log = await resp.json();

        const total = log.length;
        const blocked = log.filter(e => e.blocked).length;
        const bypassed = total - blocked;
        const rate = total > 0 ? Math.round((blocked / total) * 100) + '%' : '--';

        document.getElementById('stat-total').textContent = total;
        document.getElementById('stat-blocked').textContent = blocked;
        document.getElementById('stat-bypassed').textContent = bypassed;
        document.getElementById('stat-rate').textContent = rate;
    } catch (e) {
        console.error('Failed to update stats:', e);
    }
}

// Chat functionality
async function sendChat() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    const container = document.getElementById('chat-messages');

    // Add user message
    container.innerHTML += `<div class="chat-msg user">${message}</div>`;
    input.value = '';
    container.scrollTop = container.scrollHeight;

    try {
        const resp = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });
        const data = await resp.json();
        container.innerHTML += `<div class="chat-msg agent">${data.response}</div>`;
    } catch (e) {
        container.innerHTML += `<div class="chat-msg system">Error: Could not reach the agent.</div>`;
    }

    container.scrollTop = container.scrollHeight;
}

// Load mortgage data
async function loadMortgageData() {
    try {
        const resp = await fetch('/api/mortgage/data');
        const data = await resp.json();
        const container = document.getElementById('mortgage-data');

        const propertiesHtml = data.properties.map(prop => `
            <div class="property-card">
                <h4>${prop.address} <span class="status-badge ${prop.status}">${prop.status.replace('_', ' ')}</span></h4>
                <div class="property-details">
                    <dl>
                        <dt>Owner</dt><dd>${prop.owner}</dd>
                        <dt>Loan Amount</dt><dd>$${prop.loan_amount.toLocaleString()}</dd>
                        <dt>Current Balance</dt><dd>$${prop.current_balance.toLocaleString()}</dd>
                    </dl>
                    <dl>
                        <dt>Monthly Payment</dt><dd>$${prop.monthly_payment.toLocaleString()}</dd>
                        <dt>Interest Rate</dt><dd>${prop.interest_rate}%</dd>
                        <dt>Loan Type</dt><dd>${prop.loan_type}</dd>
                    </dl>
                    <dl>
                        <dt>Origination</dt><dd>${prop.origination_date}</dd>
                        <dt>Payments Behind</dt><dd>${prop.payments_behind}</dd>
                    </dl>
                </div>
            </div>
        `).join('');

        container.innerHTML = propertiesHtml;
    } catch (e) {
        document.getElementById('mortgage-data').innerHTML =
            '<p class="empty-state">Failed to load mortgage data.</p>';
    }
}

// Initialize
checkHealth();
loadAttacks();
loadMortgageData();
refreshLog();

// Periodic health check
setInterval(checkHealth, 30000);
