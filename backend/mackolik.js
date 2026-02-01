const fetch = require('node-fetch');

class MackolikAPI {
    constructor(timeout = 8000) {
        this.timeout = timeout;
        this.baseUrl = 'https://vd.mackolik.com/livedata';
    }

    async fetchWithTimeout(url, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeout);

        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeout);

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }

            return await res.json();
        } catch (err) {
            clearTimeout(timeout);
            throw err;
        }
    }

    async getLiveMatches() {
        try {
            const data = await this.fetchWithTimeout(`${this.baseUrl}?group=0`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://www.mackolik.com/',
                    'Accept': 'application/json'
                }
            });

            const mRows = data.m || [];
            const eRows = data.e || [];
            const allRows = [...mRows, ...eRows];

            return allRows.map(row => this.parseMatch(row)).filter(Boolean);
        } catch (err) {
            console.error('Mackolik API Error:', err.message);
            return [];
        }
    }

    parseMatch(row) {
        if (!Array.isArray(row) || row.length < 10) return null;

        const home = row[2];
        const away = row[4];
        if (typeof home !== 'string' || typeof away !== 'string') return null;

        const matchId = row[0];
        const status = row[5];
        const isLive = status === 1 || status === '1';
        const isFinished = status === 3 || status === '3';

        // Minute parsing
        let minute = '';
        const minuteField = row[6];
        if (typeof minuteField === 'string') {
            const m = minuteField.trim();
            if (/^\d{1,3}$/.test(m)) {
                minute = `${m}'`;
            } else if (['MS', 'IY', 'HT', 'İY'].includes(m)) {
                minute = m;
            }
        }

        // Score parsing - MULTIPLE METHODS
        let goalsHome = null;
        let goalsAway = null;

        // METHOD 1: Finished games have score in row[7] as "2-1"
        if (typeof row[7] === 'string' && row[7].includes('-')) {
            const scoreMatch = row[7].trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
            if (scoreMatch) {
                goalsHome = parseInt(scoreMatch[1], 10);
                goalsAway = parseInt(scoreMatch[2], 10);
            }
        }

        // METHOD 2: Live games - check for score object (usually around position 15)
        if ((goalsHome === null || goalsAway === null) && row[15] && typeof row[15] === 'object') {
            const scoreObj = row[15];
            // h1 = home first half, h2 = home second half
            // k1 = away first half (konuk), k2 = away second half
            if ('h1' in scoreObj && 'k1' in scoreObj) {
                const h1 = parseInt(scoreObj.h1, 10) || 0;
                const h2 = parseInt(scoreObj.h2, 10) || 0;
                const k1 = parseInt(scoreObj.k1, 10) || 0;
                const k2 = parseInt(scoreObj.k2, 10) || 0;
                goalsHome = h1 + h2;
                goalsAway = k1 + k2;
            }
        }

        // METHOD 3: Sometimes scores are at the end before league array
        if (goalsHome === null && row.length > 30) {
            // Search backwards for two consecutive small integers
            for (let i = row.length - 2; i >= 0; i--) {
                const val = row[i];
                if (Array.isArray(val)) break; // Stop at league array

                const prev = row[i - 1];
                if (typeof val === 'number' && typeof prev === 'number') {
                    if (val >= 0 && val <= 15 && prev >= 0 && prev <= 15) {
                        goalsHome = prev;
                        goalsAway = val;
                        break;
                    }
                }
            }
        }

        // Fallback for live games
        if ((goalsHome === null || goalsAway === null) && isLive) {
            goalsHome = 0;
            goalsAway = 0;
        }

        // League parsing
        let league = '';
        const leagueArray = row.find(item => Array.isArray(item) && item.length > 2);
        if (leagueArray) {
            for (const x of leagueArray) {
                if (typeof x === 'string') {
                    const leagueMap = {
                        'TSL': 'Süper Lig',
                        'T1L': 'TFF 1. Lig',
                        'İNP': 'Premier League',
                        'INP': 'Premier League',
                        'İS1': 'LaLiga',
                        'IS1': 'LaLiga',
                        'İTA': 'Serie A',
                        'ITA': 'Serie A',
                        'AL1': 'Bundesliga',
                        'FR1': 'Ligue 1',
                        'UEL': 'UEFA Europa League',
                        'UCL': 'UEFA Champions League'
                    };

                    if (leagueMap[x]) {
                        league = leagueMap[x];
                        break;
                    } else if (!league && x.length > 3 && x.length < 40) {
                        if (x.toLowerCase().includes('lig') || x.toLowerCase().includes('league')) {
                            league = x;
                        }
                    }
                }
            }
        }

        return {
            id: matchId,
            home: home.trim(),
            away: away.trim(),
            goalsHome,
            goalsAway,
            minute: minute || '',
            league: league || 'Live',
            status,
            isLive,
            isFinished,
            rawData: row // Store for debugging
        };
    }

    async getMatchById(matchId) {
        const matches = await this.getLiveMatches();
        return matches.find(m => m.id === matchId);
    }

    async getMatchesByLeague(leagueName) {
        const matches = await this.getLiveMatches();
        const normalized = leagueName.toLowerCase();
        return matches.filter(m => m.league.toLowerCase().includes(normalized));
    }

    async getLiveMatchesOnly() {
        const matches = await this.getLiveMatches();
        return matches.filter(m => m.isLive);
    }
}

module.exports = MackolikAPI;