require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const ScoreboardDB = require('./database');
const MackolikAPI = require('./mackolik');
const ScoreboardRenderer = require('./scoreboard');
const FFmpegManager = require('./ffmpeg-manager');

const app = express();
const PORT = process.env.PORT || 3000;
const HLS_DIR = process.env.HLS_DIR || '/var/www/html/streams';
const OUTPUT_IMAGE = process.env.OUTPUT_IMAGE || '/tmp/scoreboard.png';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('admin-ui'));

// Serve HLS streams
app.use('/streams', express.static(HLS_DIR, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.m3u8')) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.endsWith('.ts')) {
            res.setHeader('Content-Type', 'video/mp2t');
            res.setHeader('Cache-Control', 'max-age=10');
        }
    }
}));

// Initialize services
const db = new ScoreboardDB();
const mackolik = new MackolikAPI();
const ffmpegManager = new FFmpegManager(HLS_DIR);

// Active scoreboard workers
const activeWorkers = new Map();

// ==================== API ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        activeStreams: ffmpegManager.getAllStreams().length,
        activeWorkers: activeWorkers.size
    });
});

// ==================== MATCHES ====================

// Get all live matches
app.get('/api/matches/live', async (req, res) => {
    try {
        const matches = await mackolik.getLiveMatches();
        res.json({ success: true, matches });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get live matches only (isLive = true)
app.get('/api/matches/live-only', async (req, res) => {
    try {
        const matches = await mackolik.getLiveMatchesOnly();
        res.json({ success: true, matches });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get matches by league
app.get('/api/matches/league/:league', async (req, res) => {
    try {
        const { league } = req.params;
        const matches = await mackolik.getMatchesByLeague(league);
        res.json({ success: true, matches });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get match by ID
app.get('/api/matches/:id', async (req, res) => {
    try {
        const match = await mackolik.getMatchById(parseInt(req.params.id));
        if (match) {
            res.json({ success: true, match });
        } else {
            res.status(404).json({ success: false, error: 'Match not found' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==================== SCOREBOARD CONFIGS ====================

// Get all configs
app.get('/api/configs', (req, res) => {
    try {
        const configs = db.getAllConfigs();
        res.json({ success: true, configs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get config by ID
app.get('/api/configs/:id', (req, res) => {
    try {
        const config = db.getConfig(parseInt(req.params.id));
        if (config) {
            res.json({ success: true, config });
        } else {
            res.status(404).json({ success: false, error: 'Config not found' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Create new config
app.post('/api/configs', (req, res) => {
    try {
        const id = db.createConfig(req.body);
        const config = db.getConfig(id);
        res.json({ success: true, config });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Update config
app.put('/api/configs/:id', (req, res) => {
    try {
        db.updateConfig(parseInt(req.params.id), req.body);
        const config = db.getConfig(parseInt(req.params.id));
        res.json({ success: true, config });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delete config
app.delete('/api/configs/:id', (req, res) => {
    try {
        db.deleteConfig(parseInt(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==================== STREAM CONTROL ====================

// Start stream
app.post('/api/stream/start', async (req, res) => {
    try {
        const { configId, streamKey, baseUrl } = req.body;

        if (!configId || !streamKey) {
            return res.status(400).json({
                success: false,
                error: 'configId and streamKey are required'
            });
        }

        // Check if already running
        if (ffmpegManager.isStreamRunning(streamKey)) {
            return res.status(400).json({
                success: false,
                error: 'Stream is already running'
            });
        }

        // Get config
        const config = db.getConfig(configId);
        if (!config) {
            return res.status(404).json({
                success: false,
                error: 'Config not found'
            });
        }

        // Create renderer
        const renderer = new ScoreboardRenderer({
            width: config.canvas_width,
            height: config.canvas_height,
            theme: config.theme,
            fontSize: config.font_size,
            showLeague: config.show_league,
            showMinute: config.show_minute,
            flashOnGoal: config.flash_on_goal,
            outputPath: OUTPUT_IMAGE
        });

        // Start FFmpeg stream
        const streamInfo = ffmpegManager.startStream({
            streamKey,
            inputImage: OUTPUT_IMAGE,
            fps: 1,
            preset: 'ultrafast',
            bitrate: '300k',
            segmentDuration: 4,
            playlistSize: 5
        });

        // Save session to DB
        const sessionId = db.createStreamSession(
            configId,
            streamKey,
            streamInfo.playlistUrl
        );
        db.updateStreamPID(sessionId, streamInfo.pid);

        // Start worker
        const worker = createScoreboardWorker(config, renderer);
        activeWorkers.set(streamKey, { worker, renderer, config, sessionId });

        const fullUrl = baseUrl
            ? `${baseUrl}${streamInfo.playlistUrl}`
            : streamInfo.playlistUrl;

        res.json({
            success: true,
            stream: {
                sessionId,
                streamKey,
                pid: streamInfo.pid,
                playlistUrl: fullUrl,
                playlistPath: streamInfo.playlistPath
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Stop stream
app.post('/api/stream/stop', (req, res) => {
    try {
        const { streamKey } = req.body;

        if (!streamKey) {
            return res.status(400).json({
                success: false,
                error: 'streamKey is required'
            });
        }

        // Stop FFmpeg
        ffmpegManager.stopStream(streamKey);

        // Stop worker
        const workerData = activeWorkers.get(streamKey);
        if (workerData) {
            clearInterval(workerData.worker);
            db.stopStreamSession(workerData.sessionId);
            activeWorkers.delete(streamKey);
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get stream status
app.get('/api/stream/status/:streamKey', (req, res) => {
    try {
        const { streamKey } = req.params;
        const status = ffmpegManager.getStreamStatus(streamKey);
        const workerActive = activeWorkers.has(streamKey);

        res.json({
            success: true,
            status: {
                ...status,
                workerActive
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get all active streams
app.get('/api/stream/all', (req, res) => {
    try {
        const streams = ffmpegManager.getAllStreams();
        res.json({ success: true, streams });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get stream segments (debugging)
app.get('/api/stream/segments/:streamKey', (req, res) => {
    try {
        const { streamKey } = req.params;
        const segments = ffmpegManager.getSegments(streamKey);
        res.json({ success: true, segments });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==================== SCOREBOARD WORKER ====================

function createScoreboardWorker(config, renderer) {
    let lastScoreKey = '';
    let currentMatchIndex = 0;
    const matchIds = config.matchIds || [];

    const updateScoreboard = async () => {
        try {
            if (matchIds.length === 0) {
                renderer.renderOffline();
                return;
            }

            // Get current match
            const matchId = matchIds[currentMatchIndex];
            const match = await mackolik.getMatchById(matchId);

            if (match) {
                // Check for goal
                const newScoreKey = `${match.id}|${match.goalsHome}|${match.goalsAway}`;
                renderer.checkGoal(match, lastScoreKey);
                lastScoreKey = newScoreKey;

                // Render
                renderer.render(match);
            } else {
                renderer.renderOffline();
            }

            // Rotate to next match
            if (matchIds.length > 1) {
                currentMatchIndex = (currentMatchIndex + 1) % matchIds.length;
            }
        } catch (err) {
            console.error('Worker error:', err.message);
            renderer.renderOffline();
        }
    };

    // Initial render
    updateScoreboard();

    // Schedule updates
    return setInterval(updateScoreboard, (config.rotation_interval || 15) * 1000);
}

// ==================== START SERVER ====================

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════╗
║   🎯 Scoreboard System v2.0 - HLS Edition         ║
╠════════════════════════════════════════════════════╣
║   🌐 Server:     http://localhost:${PORT}           ║
║   📺 HLS Dir:    ${HLS_DIR.padEnd(30)} ║
║   🖼️  Output:     ${OUTPUT_IMAGE.padEnd(30)} ║
╚════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    ffmpegManager.stopAllStreams();
    db.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Shutting down...');
    ffmpegManager.stopAllStreams();
    db.close();
    process.exit(0);
});