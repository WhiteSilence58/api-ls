const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class ScoreboardDB {
    constructor(dbPath = './data/scoreboard.db') {
        // Ensure data directory exists
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.initTables();
    }

    initTables() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS scoreboard_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        match_ids TEXT NOT NULL,
        rotation_interval INTEGER DEFAULT 15,
        canvas_width INTEGER DEFAULT 320,
        canvas_height INTEGER DEFAULT 80,
        theme TEXT DEFAULT 'dark',
        font_size TEXT DEFAULT 'medium',
        show_league BOOLEAN DEFAULT 1,
        show_minute BOOLEAN DEFAULT 1,
        flash_on_goal BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS stream_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_id INTEGER,
        stream_key TEXT UNIQUE NOT NULL,
        rtmp_url TEXT NOT NULL,
        hls_url TEXT,
        pid INTEGER,
        status TEXT DEFAULT 'stopped',
        started_at DATETIME,
        stopped_at DATETIME,
        FOREIGN KEY (config_id) REFERENCES scoreboard_configs(id)
      );

      CREATE TABLE IF NOT EXISTS match_cache (
        match_id INTEGER PRIMARY KEY,
        home_team TEXT,
        away_team TEXT,
        league TEXT,
        data TEXT,
        cached_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_stream_status ON stream_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_stream_key ON stream_sessions(stream_key);
    `);
    }

    // Config Methods
    createConfig(config) {
        const stmt = this.db.prepare(`
      INSERT INTO scoreboard_configs 
      (name, match_ids, rotation_interval, canvas_width, canvas_height, theme, font_size, show_league, show_minute, flash_on_goal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        const result = stmt.run(
            config.name,
            JSON.stringify(config.matchIds),
            config.rotationInterval || 15,
            config.canvasWidth || 320,
            config.canvasHeight || 80,
            config.theme || 'dark',
            config.fontSize || 'medium',
            config.showLeague ? 1 : 0,
            config.showMinute ? 1 : 0,
            config.flashOnGoal ? 1 : 0
        );

        return result.lastInsertRowid;
    }

    getConfig(id) {
        const stmt = this.db.prepare('SELECT * FROM scoreboard_configs WHERE id = ?');
        const row = stmt.get(id);
        if (row) {
            row.matchIds = JSON.parse(row.match_ids);
        }
        return row;
    }

    getAllConfigs() {
        const stmt = this.db.prepare('SELECT * FROM scoreboard_configs ORDER BY created_at DESC');
        const rows = stmt.all();
        return rows.map(row => {
            row.matchIds = JSON.parse(row.match_ids);
            return row;
        });
    }

    updateConfig(id, config) {
        const stmt = this.db.prepare(`
      UPDATE scoreboard_configs 
      SET name = ?, match_ids = ?, rotation_interval = ?, canvas_width = ?, canvas_height = ?, 
          theme = ?, font_size = ?, show_league = ?, show_minute = ?, flash_on_goal = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

        return stmt.run(
            config.name,
            JSON.stringify(config.matchIds),
            config.rotationInterval,
            config.canvasWidth,
            config.canvasHeight,
            config.theme,
            config.fontSize,
            config.showLeague ? 1 : 0,
            config.showMinute ? 1 : 0,
            config.flashOnGoal ? 1 : 0,
            id
        );
    }

    deleteConfig(id) {
        const stmt = this.db.prepare('DELETE FROM scoreboard_configs WHERE id = ?');
        return stmt.run(id);
    }

    // Stream Session Methods
    createStreamSession(configId, streamKey, rtmpUrl) {
        const stmt = this.db.prepare(`
      INSERT INTO stream_sessions (config_id, stream_key, rtmp_url, status, started_at)
      VALUES (?, ?, ?, 'running', CURRENT_TIMESTAMP)
    `);
        return stmt.run(configId, streamKey, rtmpUrl).lastInsertRowid;
    }

    updateStreamPID(sessionId, pid) {
        const stmt = this.db.prepare('UPDATE stream_sessions SET pid = ? WHERE id = ?');
        return stmt.run(pid, sessionId);
    }

    stopStreamSession(sessionId) {
        const stmt = this.db.prepare(`
      UPDATE stream_sessions 
      SET status = 'stopped', stopped_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
        return stmt.run(sessionId);
    }

    getActiveStreams() {
        const stmt = this.db.prepare(`
      SELECT s.*, c.name as config_name 
      FROM stream_sessions s
      LEFT JOIN scoreboard_configs c ON s.config_id = c.id
      WHERE s.status = 'running'
    `);
        return stmt.all();
    }

    getStreamByKey(streamKey) {
        const stmt = this.db.prepare('SELECT * FROM stream_sessions WHERE stream_key = ?');
        return stmt.get(streamKey);
    }

    // Match Cache Methods
    cacheMatch(matchId, data) {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO match_cache (match_id, home_team, away_team, league, data)
      VALUES (?, ?, ?, ?, ?)
    `);
        return stmt.run(matchId, data.home, data.away, data.league, JSON.stringify(data));
    }

    getCachedMatch(matchId) {
        const stmt = this.db.prepare('SELECT * FROM match_cache WHERE match_id = ?');
        const row = stmt.get(matchId);
        if (row) {
            row.data = JSON.parse(row.data);
        }
        return row;
    }

    close() {
        this.db.close();
    }
}

module.exports = ScoreboardDB;