const API_BASE = window.location.origin;
let selectedMatches = new Set();
let currentConfigId = null;
let statusCheckInterval = null;

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    startStatusChecking();
});

async function initializeApp() {
    await loadLiveMatches();
    await loadConfigs();
    await loadActiveStreams();
    checkServerHealth();
}

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
    // Matches
    document.getElementById('refresh-matches').addEventListener('click', loadLiveMatches);
    document.getElementById('league-filter').addEventListener('change', filterMatches);
    document.getElementById('live-only').addEventListener('change', filterMatches);

    // Config form
    document.getElementById('config-form').addEventListener('submit', saveConfiguration);

    // Stream control
    document.getElementById('start-stream').addEventListener('click', startStream);
    document.getElementById('stop-stream').addEventListener('click', stopStream);

    // Auto-refresh matches every 30 seconds
    setInterval(loadLiveMatches, 30000);
}

// ==================== SERVER HEALTH CHECK ====================

async function checkServerHealth() {
    try {
        const res = await fetch(`${API_BASE}/api/health`);
        const data = await res.json();

        if (data.status === 'ok') {
            updateStatusIndicator('online', `🟢 Online (${data.activeStreams} streams)`);
            document.getElementById('active-streams').textContent =
                `Active Streams: ${data.activeStreams}`;
        }
    } catch (err) {
        updateStatusIndicator('offline', '⚫ Offline');
        console.error('Health check failed:', err);
    }
}

function updateStatusIndicator(status, text) {
    const indicator = document.getElementById('status-indicator');
    indicator.className = `status ${status}`;
    indicator.textContent = text;
}

// ==================== LOAD MATCHES ====================

async function loadLiveMatches() {
    try {
        const liveOnly = document.getElementById('live-only').checked;
        const endpoint = liveOnly ? '/api/matches/live-only' : '/api/matches/live';

        const res = await fetch(`${API_BASE}${endpoint}`);
        const data = await res.json();

        if (data.success) {
            renderMatches(data.matches);
        }
    } catch (err) {
        showError('Failed to load matches: ' + err.message);
    }
}

function renderMatches(matches) {
    const container = document.getElementById('matches-list');

    if (matches.length === 0) {
        container.innerHTML = '<p class="empty-state">No matches found</p>';
        return;
    }

    container.innerHTML = matches.map(match => `
    <div class="match-card ${selectedMatches.has(match.id) ? 'selected' : ''}" 
         data-match-id="${match.id}">
      <div class="match-header">
        <span class="league-badge">${escapeHtml(match.league)}</span>
        ${match.isLive ? '<span class="live-badge">🔴 LIVE</span>' : ''}
        ${match.minute ? `<span class="minute">${escapeHtml(match.minute)}</span>` : ''}
      </div>
      <div class="match-teams">
        <div class="team">${escapeHtml(match.home)}</div>
        <div class="score">
          ${match.goalsHome !== null ? match.goalsHome : '-'}
          :
          ${match.goalsAway !== null ? match.goalsAway : '-'}
        </div>
        <div class="team">${escapeHtml(match.away)}</div>
      </div>
      <div class="match-actions">
        <button class="btn btn-sm toggle-select" onclick="toggleMatchSelection(${match.id})">
          ${selectedMatches.has(match.id) ? '✓ Selected' : '+ Select'}
        </button>
      </div>
    </div>
  `).join('');
}

function toggleMatchSelection(matchId) {
    if (selectedMatches.has(matchId)) {
        selectedMatches.delete(matchId);
    } else {
        selectedMatches.add(matchId);
    }

    updateSelectedMatches();
    loadLiveMatches(); // Re-render to update selection state
}

async function updateSelectedMatches() {
    const count = selectedMatches.size;
    document.getElementById('selected-count').textContent = count;

    const container = document.getElementById('selected-list');

    if (count === 0) {
        container.innerHTML = '<p class="empty-state">No matches selected</p>';
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/matches/live`);
        const data = await res.json();

        if (data.success) {
            const selectedMatchData = data.matches.filter(m => selectedMatches.has(m.id));

            container.innerHTML = selectedMatchData.map(match => `
        <div class="selected-match-item">
          <span>${escapeHtml(match.home)} vs ${escapeHtml(match.away)}</span>
          <button class="btn btn-sm btn-danger" onclick="toggleMatchSelection(${match.id})">×</button>
        </div>
      `).join('');
        }
    } catch (err) {
        console.error('Failed to update selected matches:', err);
    }
}

function filterMatches() {
    const leagueFilter = document.getElementById('league-filter').value.toLowerCase();
    const matchCards = document.querySelectorAll('.match-card');

    matchCards.forEach(card => {
        const leagueBadge = card.querySelector('.league-badge');
        const league = leagueBadge ? leagueBadge.textContent.toLowerCase() : '';

        const matchesLeague = !leagueFilter || league.includes(leagueFilter);

        card.style.display = matchesLeague ? 'block' : 'none';
    });
}

// ==================== CONFIGURATION ====================

async function saveConfiguration(e) {
    e.preventDefault();

    if (selectedMatches.size === 0) {
        showError('Please select at least one match');
        return;
    }

    const config = {
        name: document.getElementById('config-name').value,
        matchIds: Array.from(selectedMatches),
        rotationInterval: parseInt(document.getElementById('rotation-interval').value),
        canvasWidth: parseInt(document.getElementById('canvas-width').value),
        canvasHeight: parseInt(document.getElementById('canvas-height').value),
        theme: document.getElementById('theme').value,
        fontSize: document.getElementById('font-size').value,
        showLeague: document.getElementById('show-league').checked,
        showMinute: document.getElementById('show-minute').checked,
        flashOnGoal: document.getElementById('flash-goal').checked
    };

    try {
        const endpoint = currentConfigId
            ? `${API_BASE}/api/configs/${currentConfigId}`
            : `${API_BASE}/api/configs`;

        const method = currentConfigId ? 'PUT' : 'POST';

        const res = await fetch(endpoint, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        const data = await res.json();

        if (data.success) {
            showSuccess('Configuration saved successfully!');
            currentConfigId = data.config.id;
            await loadConfigs();
        } else {
            showError('Failed to save configuration: ' + data.error);
        }
    } catch (err) {
        showError('Failed to save configuration: ' + err.message);
    }
}

async function loadConfigs() {
    try {
        const res = await fetch(`${API_BASE}/api/configs`);
        const data = await res.json();

        if (data.success) {
            const select = document.getElementById('config-select');

            select.innerHTML = '<option value="">-- Select Config --</option>' +
                data.configs.map(config =>
                    `<option value="${config.id}">${escapeHtml(config.name)} (${config.matchIds.length} matches)</option>`
                ).join('');
        }
    } catch (err) {
        console.error('Failed to load configs:', err);
    }
}

// ==================== STREAM CONTROL ====================

async function startStream() {
    const configId = document.getElementById('config-select').value;
    const streamKey = document.getElementById('stream-key').value.trim();
    const baseUrl = document.getElementById('base-url').value.trim();

    if (!configId) {
        showError('Please select a configuration');
        return;
    }

    if (!streamKey) {
        showError('Please enter a stream key');
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/stream/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ configId: parseInt(configId), streamKey, baseUrl })
        });

        const data = await res.json();

        if (data.success) {
            showSuccess('Stream started successfully!');
            displayStreamInfo(data.stream);
            toggleStreamButtons(true);
            await loadActiveStreams();
        } else {
            showError('Failed to start stream: ' + data.error);
        }
    } catch (err) {
        showError('Failed to start stream: ' + err.message);
    }
}

async function stopStream() {
    const streamKey = document.getElementById('stream-key').value.trim();

    if (!streamKey) {
        showError('Please enter a stream key');
        return;
    }

    if (!confirm(`Stop stream "${streamKey}"?`)) {
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/stream/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ streamKey })
        });

        const data = await res.json();

        if (data.success) {
            showSuccess('Stream stopped successfully!');
            hideStreamInfo();
            toggleStreamButtons(false);
            await loadActiveStreams();
        } else {
            showError('Failed to stop stream: ' + data.error);
        }
    } catch (err) {
        showError('Failed to stop stream: ' + err.message);
    }
}

function displayStreamInfo(stream) {
    const infoDiv = document.getElementById('stream-info');
    infoDiv.classList.remove('hidden');

    document.getElementById('stream-pid').textContent = stream.pid;
    document.getElementById('playlist-url').textContent = stream.playlistUrl;

    // Xtream UI format: http://server:port/live/username/password/stream_id.m3u8
    const xtreamUrl = stream.playlistUrl.replace('/streams/', '/live/USERNAME/PASSWORD/');
    document.getElementById('xtream-url').textContent = xtreamUrl;
}

function hideStreamInfo() {
    document.getElementById('stream-info').classList.add('hidden');
}

function toggleStreamButtons(isRunning) {
    document.getElementById('start-stream').disabled = isRunning;
    document.getElementById('stop-stream').disabled = !isRunning;
}

// ==================== ACTIVE STREAMS ====================

async function loadActiveStreams() {
    try {
        const res = await fetch(`${API_BASE}/api/stream/all`);
        const data = await res.json();

        if (data.success) {
            renderActiveStreams(data.streams);
        }
    } catch (err) {
        console.error('Failed to load active streams:', err);
    }
}

function renderActiveStreams(streams) {
    const container = document.getElementById('active-streams-list');

    if (streams.length === 0) {
        container.innerHTML = '<p class="empty-state">No active streams</p>';
        return;
    }

    container.innerHTML = streams.map(stream => {
        const uptime = formatUptime(stream.uptime);
        return `
      <div class="stream-item">
        <div class="stream-header">
          <span class="stream-key">${escapeHtml(stream.streamKey)}</span>
          <span class="badge badge-success">🟢 LIVE</span>
        </div>
        <div class="stream-details">
          <div><strong>PID:</strong> ${stream.pid}</div>
          <div><strong>Uptime:</strong> ${uptime}</div>
          <div><strong>URL:</strong> <code>${escapeHtml(stream.playlistUrl)}</code></div>
        </div>
        <div class="stream-actions">
          <button class="btn btn-sm btn-primary" onclick="copyToClipboard('${stream.playlistUrl}', true)">
            📋 Copy URL
          </button>
          <button class="btn btn-sm btn-danger" onclick="stopStreamByKey('${stream.streamKey}')">
            ⏹️ Stop
          </button>
        </div>
      </div>
    `;
    }).join('');
}

async function stopStreamByKey(streamKey) {
    document.getElementById('stream-key').value = streamKey;
    await stopStream();
}

// ==================== STATUS CHECKING ====================

function startStatusChecking() {
    statusCheckInterval = setInterval(async () => {
        await checkServerHealth();
        await loadActiveStreams();
    }, 5000); // Check every 5 seconds
}

// ==================== UTILITY FUNCTIONS ====================

function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function copyToClipboard(elementIdOrText, isText = false) {
    const text = isText ? elementIdOrText : document.getElementById(elementIdOrText).textContent;

    navigator.clipboard.writeText(text).then(() => {
        showSuccess('Copied to clipboard!');
    }).catch(err => {
        showError('Failed to copy: ' + err.message);
    });
}

function showSuccess(message) {
    showNotification(message, 'success');
}

function showError(message) {
    showNotification(message, 'error');
}

function showNotification(message, type = 'info') {
    // Remove existing notifications
    const existing = document.querySelector('.notification');
    if (existing) {
        existing.remove();
    }

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}