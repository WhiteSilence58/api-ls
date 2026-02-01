const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');

class ScoreboardRenderer {
    constructor(config = {}) {
        this.width = config.width || 320;
        this.height = config.height || 80;
        this.theme = config.theme || 'dark';
        this.fontSize = config.fontSize || 'medium';
        this.showLeague = config.showLeague !== false;
        this.showMinute = config.showMinute !== false;
        this.flashOnGoal = config.flashOnGoal !== false;

        this.outputPath = config.outputPath || '/tmp/scoreboard.png';
        this.isFlashing = false;
        this.flashUntil = 0;
    }

    getTheme() {
        const themes = {
            dark: {
                bgGradientStart: 'rgba(15, 23, 42, 0.95)',
                bgGradientEnd: 'rgba(30, 41, 59, 0.95)',
                borderNormal: '#3b82f6',
                borderFlash: '#22c55e',
                textPrimary: 'rgba(241, 245, 249, 0.98)',
                textSecondary: 'rgba(148, 163, 184, 0.95)',
                liveIndicator: '#ef4444',
                goalFlash: '#fbbf24'
            },
            light: {
                bgGradientStart: 'rgba(241, 245, 249, 0.98)',
                bgGradientEnd: 'rgba(226, 232, 240, 0.98)',
                borderNormal: '#2563eb',
                borderFlash: '#16a34a',
                textPrimary: 'rgba(15, 23, 42, 0.95)',
                textSecondary: 'rgba(71, 85, 105, 0.90)',
                liveIndicator: '#dc2626',
                goalFlash: '#f59e0b'
            },
            neon: {
                bgGradientStart: 'rgba(0, 0, 0, 0.92)',
                bgGradientEnd: 'rgba(17, 24, 39, 0.92)',
                borderNormal: '#06b6d4',
                borderFlash: '#10b981',
                textPrimary: '#f0f9ff',
                textSecondary: '#67e8f9',
                liveIndicator: '#f43f5e',
                goalFlash: '#facc15'
            }
        };

        return themes[this.theme] || themes.dark;
    }

    getFontSizes() {
        const sizes = {
            small: { league: 10, minute: 12, team: 14, score: 22, goal: 10 },
            medium: { league: 12, minute: 14, team: 16, score: 26, goal: 12 },
            large: { league: 14, minute: 16, team: 18, score: 30, goal: 14 }
        };

        return sizes[this.fontSize] || sizes.medium;
    }

    trim(text, maxLength) {
        const str = String(text || '');
        return str.length > maxLength ? str.slice(0, maxLength - 1) + '…' : str;
    }

    checkGoal(match, lastScoreKey) {
        const currentKey = `${match.id}|${match.goalsHome}|${match.goalsAway}`;

        if (this.flashOnGoal && lastScoreKey && lastScoreKey !== currentKey) {
            const oldParts = lastScoreKey.split('|');
            const oldHome = parseInt(oldParts[1], 10);
            const oldAway = parseInt(oldParts[2], 10);

            const newHome = match.goalsHome !== null ? match.goalsHome : oldHome;
            const newAway = match.goalsAway !== null ? match.goalsAway : oldAway;

            if ((Number.isFinite(oldHome) && newHome > oldHome) ||
                (Number.isFinite(oldAway) && newAway > oldAway)) {
                this.flashUntil = Date.now() + 3000; // 3 seconds flash
                return true;
            }
        }

        return false;
    }

    render(match) {
        const canvas = createCanvas(this.width, this.height);
        const ctx = canvas.getContext('2d');
        const theme = this.getTheme();
        const fonts = this.getFontSizes();

        ctx.clearRect(0, 0, this.width, this.height);

        // Check if flashing
        const isFlashing = Date.now() < this.flashUntil;

        // No match - show offline
        if (!match) {
            ctx.fillStyle = 'rgba(20, 20, 30, 0.90)';
            ctx.fillRect(0, 0, this.width, this.height);

            ctx.fillStyle = theme.textSecondary;
            ctx.font = `bold ${fonts.score}px Arial`;
            ctx.textAlign = 'center';
            ctx.fillText('⚫ OFFLINE', this.width / 2, this.height / 2);

            fs.writeFileSync(this.outputPath, canvas.toBuffer('image/png'));
            return;
        }

        // Background gradient
        const gradient = ctx.createLinearGradient(0, 0, this.width, 0);
        gradient.addColorStop(0, theme.bgGradientStart);
        gradient.addColorStop(1, theme.bgGradientEnd);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, this.width, this.height);

        // Border
        ctx.strokeStyle = isFlashing ? theme.borderFlash : theme.borderNormal;
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, this.width, this.height);

        let currentY = 15;

        // League name
        if (this.showLeague) {
            ctx.fillStyle = theme.textSecondary;
            ctx.font = `bold ${fonts.league}px Arial`;
            ctx.textAlign = 'center';
            ctx.fillText(this.trim(match.league, 30), this.width / 2, currentY);
            currentY += fonts.league + 8;
        }

        // Live indicator + Minute
        if (this.showMinute && match.minute) {
            // Red dot
            ctx.fillStyle = theme.liveIndicator;
            ctx.beginPath();
            ctx.arc(this.width / 2 - 35, currentY - 3, 3, 0, Math.PI * 2);
            ctx.fill();

            // LIVE text
            ctx.fillStyle = theme.liveIndicator;
            ctx.font = `bold ${fonts.minute - 2}px Arial`;
            ctx.textAlign = 'center';
            ctx.fillText('LIVE', this.width / 2 + 40, currentY);

            // Minute
            ctx.fillStyle = theme.textPrimary;
            ctx.font = `bold ${fonts.minute}px Arial`;
            ctx.fillText(match.minute, this.width / 2, currentY);

            currentY += fonts.minute + 10;
        } else {
            currentY += 5;
        }

        // Teams and Score
        const teamY = currentY + fonts.team;
        const scoreHome = match.goalsHome !== null ? String(match.goalsHome) : '-';
        const scoreAway = match.goalsAway !== null ? String(match.goalsAway) : '-';

        // Home team (right-aligned)
        ctx.fillStyle = theme.textPrimary;
        ctx.font = `bold ${fonts.team}px Arial`;
        ctx.textAlign = 'right';
        ctx.fillText(this.trim(match.home, 12), this.width / 2 - 45, teamY);

        // Away team (left-aligned)
        ctx.textAlign = 'left';
        ctx.fillText(this.trim(match.away, 12), this.width / 2 + 45, teamY);

        // Score (centered)
        ctx.fillStyle = isFlashing ? theme.borderFlash : theme.textPrimary;
        ctx.font = `bold ${fonts.score}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillText(`${scoreHome}:${scoreAway}`, this.width / 2, teamY);

        // Goal flash indicator
        if (isFlashing) {
            ctx.fillStyle = theme.goalFlash;
            ctx.font = `bold ${fonts.goal}px Arial`;
            ctx.textAlign = 'center';
            ctx.fillText('⚽ GOAL!', this.width / 2, this.height - 8);
        }

        // Save to file
        fs.writeFileSync(this.outputPath, canvas.toBuffer('image/png'));

        console.log(`✓ Rendered: ${match.home} ${scoreHome}:${scoreAway} ${match.away} [${match.minute || 'FT'}]`);
    }

    renderOffline() {
        this.render(null);
    }
}

module.exports = ScoreboardRenderer;