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

// Show or update the in-flight card at the top of the log
function updateInFlightCard(current) {
    const container = document.getElementById('attack-log');
    let card = document.getElementById('in-flight-card');

    // Hide card if no attack in flight, or if it's already resolved in the log
    if (!current || !current.id || _renderedIds.has(current.id)) {
        if (card) card.remove();
        return;
    }

    // Remove empty-state placeholder so the card has somewhere to live
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();

    // Create card on first appearance, reuse on subsequent polls
    if (!card) {
        card = document.createElement('div');
        card.id = 'in-flight-card';
        card.className = 'log-entry in-flight';
        container.prepend(card);
    }

    card.innerHTML = `
        <div class="log-header">
            <span class="log-id">${current.id}</span>
            <span class="log-category">${current.category}</span>
            <span class="log-status in-flight">⚡ ATTACKING</span>
        </div>
        <div class="log-prompt">${current.prompt.substring(0, 150)}…</div>
        <div class="in-flight-bar"><div class="in-flight-bar-fill"></div></div>`;
}

// Run all attacks
async function runAllAttacks() {
    const btn = document.getElementById('run-all-btn');
    const stopBtn = document.getElementById('stop-btn');
    btn.disabled = true;
    btn.textContent = 'Running...';
    stopBtn.style.display = 'inline-block';

    // Poll the in-flight attack every 500ms → live pending card
    const currentPollInterval = setInterval(async () => {
        try {
            const resp = await fetch('/api/attacks/current');
            const current = await resp.json();
            updateInFlightCard(current);
        } catch {}
    }, 500);

    // Poll the completed log every 2s so results appear as they arrive
    const pollInterval = setInterval(() => {
        refreshLog();
    }, 2000);

    try {
        const resp = await fetch('/api/attacks/run-all', { method: 'POST' });
        await resp.json();
    } catch (e) {
        console.error('Run all failed:', e);
    } finally {
        clearInterval(currentPollInterval);
        clearInterval(pollInterval);
        updateInFlightCard(null); // clear any lingering pending card
        await refreshLog();
        btn.disabled = false;
        btn.textContent = 'Run All Attacks';
        stopBtn.style.display = 'none';
    }
}

// Stop attacks mid-run
async function stopAttacks() {
    try {
        await fetch('/api/attacks/stop', { method: 'POST' });
    } catch (e) {
        console.error('Stop failed:', e);
    }
}

// Clear attack log
async function clearLog() {
    if (!confirm('Clear all attack results?')) return;
    try {
        await fetch('/api/attacks/log', { method: 'DELETE' });
        await refreshLog();
        updateStats();
    } catch (e) {
        console.error('Failed to clear log:', e);
    }
}

// Track which attack IDs are already rendered
const _renderedIds = new Set();

function _renderEntry(entry) {
    const status = entry.status || (entry.blocked ? 'blocked' : 'bypassed');
    const label = status === 'blocked' ? 'BLOCKED' : status === 'error' ? 'NO RESPONSE' : 'BYPASSED';
    const div = document.createElement('div');
    div.className = `log-entry ${status}`;
    div.innerHTML = `
        <div class="log-header">
            <span class="log-id">${entry.id}</span>
            <span class="log-category">${entry.category}</span>
            <span class="log-status ${status}">${label}</span>
        </div>
        <div class="log-prompt">${entry.prompt.substring(0, 150)}...</div>
        <div class="log-response">${entry.response}</div>`;
    return div;
}

// Refresh attack log
async function refreshLog() {
    try {
        const resp = await fetch('/api/attacks/log');
        const log = await resp.json();
        const container = document.getElementById('attack-log');

        if (log.length === 0) {
            // Only show empty state if there's no in-flight card — otherwise we'd
            // wipe the pending card every 2s and cause it to flicker.
            if (!document.getElementById('in-flight-card')) {
                container.innerHTML = '<p class="empty-state">No attacks have been run yet.</p>';
                _renderedIds.clear();
            }
            updateStats();
            return;
        }

        // Remove empty state if present
        const empty = container.querySelector('.empty-state');
        if (empty) empty.remove();

        // Prepend only new entries (newest first), each gets the slide-in animation
        const newEntries = log.filter(e => !_renderedIds.has(e.id));
        newEntries.reverse().forEach(entry => {
            _renderedIds.add(entry.id);
            container.prepend(_renderEntry(entry));
        });

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

        const scored = log.filter(e => (e.status || '') !== 'error');
        const total = scored.length;
        const blocked = scored.filter(e => e.blocked).length;
        const bypassed = total - blocked;
        const errors = log.length - scored.length;
        const rate = total > 0 ? Math.round((blocked / total) * 100) + '%' : '--';

        document.getElementById('stat-total').textContent = log.length + (errors > 0 ? ` (${errors} no-response)` : '');
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
