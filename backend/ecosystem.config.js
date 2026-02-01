module.exports = {
    apps: [{
        name: 'scoreboard-api',
        script: './backend/server.js',

        // Instances
        instances: 1,
        exec_mode: 'fork',

        // Environment
        env: {
            NODE_ENV: 'development',
            PORT: 3000
        },
        env_production: {
            NODE_ENV: 'production',
            PORT: 5350
        },

        // Logging
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        error_file: './logs/error.log',
        out_file: './logs/out.log',
        log_file: './logs/combined.log',

        // Auto-restart
        watch: false,
        max_memory_restart: '500M',

        // Restart policy
        autorestart: true,
        max_restarts: 10,
        min_uptime: '10s',
        restart_delay: 4000,

        // Process management
        kill_timeout: 5000,
        listen_timeout: 10000,

        // Cron restart (optional - jeden Tag um 3 Uhr neu starten)
        cron_restart: '0 3 * * *',

        // Merge logs
        merge_logs: true,

        // Time
        time: true
    }]
};