// ============ Persistent settings + high scores ============

const DEFAULTS = {
    musicVolume: 0.75,
    sfxVolume: 0.9,
    leftColor: '#ff2d55',
    rightColor: '#2d7dff',
    noteSpeed: 1.0,       // note speed multiplier
    noFail: false,
    bloom: true,
    bloomStrength: 0.5,   // glow intensity
    aimAssist: 0.6,       // 0 = off, 1 = strong magnetism
    wallDistortion: true, // real-time energy-field shader on walls
    cursorSpeed: 1.0,
};

class Settings {
    constructor() {
        this.data = { ...DEFAULTS };
        try {
            const saved = JSON.parse(localStorage.getItem('saber3d_settings') || '{}');
            Object.assign(this.data, saved);
        } catch (e) { /* fresh start */ }
    }
    get(key) { return this.data[key]; }
    set(key, value) {
        this.data[key] = value;
        localStorage.setItem('saber3d_settings', JSON.stringify(this.data));
    }
}

export const settings = new Settings();

export function getHighScore(mapId, characteristic, difficulty) {
    try {
        return JSON.parse(localStorage.getItem(`saber3d_hs_${mapId}_${characteristic}_${difficulty}`));
    } catch (e) { return null; }
}

export function setHighScore(mapId, characteristic, difficulty, result) {
    const prev = getHighScore(mapId, characteristic, difficulty);
    if (prev && prev.score >= result.score) return false;
    localStorage.setItem(`saber3d_hs_${mapId}_${characteristic}_${difficulty}`, JSON.stringify({
        score: result.score,
        accuracy: result.accuracy,
        rank: result.rank,
        maxCombo: result.maxCombo,
    }));
    return true;
}

export function getBestForMap(mapId) {
    let best = null;
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(`saber3d_hs_${mapId}_`)) {
            try {
                const v = JSON.parse(localStorage.getItem(k));
                if (!best || v.score > best.score) best = v;
            } catch (e) { /* skip */ }
        }
    }
    return best;
}
