// ============ Menu system: screens, BeatSaver browser, pause/results ============
import { audio } from './audio.js';
import { gamepad, cursor } from './input.js';
import { settings, getHighScore, setHighScore, getBestForMap } from './settings.js';
import { searchMaps, downloadMap, getSavedMaps, getSavedMap, deleteSavedMap } from './beatsaver.js';
import { parseDifficulty } from './beatmap.js';
import { generateBuiltinBeatmap, BUILTIN_SONG } from './builtin.js';
import { Gameplay } from './game.js';

const $ = (id) => document.getElementById(id);

export function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    $('toast-container').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 2600);
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDuration(sec) {
    if (!sec) return '';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

export class Menu {
    constructor(engine) {
        this.engine = engine;
        this.root = $('ui-root');
        this.gameplay = null;
        this.currentLevel = null;   // remembered for retry
        this.builtinBuffer = null;
        this.browseState = { query: '', sort: 'Rating', page: 0 };

        gamepad.on('connect', () => {
            this.updateControllerChip();
            const ps = gamepad.isPlayStation;
            $('hint-confirm').textContent = ps ? '✕' : 'A';
            $('hint-back').textContent = ps ? '○' : 'B';
            toast(`Controller connected${ps ? ' (PlayStation)' : ''}`, 'success');
        });
        gamepad.on('disconnect', () => {
            this.updateControllerChip();
            toast('Controller disconnected', 'error');
            if (this.gameplay && !this.gameplay.paused && !this.gameplay.finished) this.pauseGame();
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.gameplay && !this.gameplay.finished) {
                this.gameplay.paused ? this.resumeGame() : this.pauseGame();
            }
        });

        // click sounds for all UI buttons
        this.root.addEventListener('click', (e) => {
            if (e.target.closest('button, .btn, .song-row, .toggle, .diff-btn')) audio.playClick();
        });
    }

    updateControllerChip() {
        const chip = $('controller-chip');
        if (!chip) return;
        chip.classList.toggle('connected', gamepad.connected);
        chip.querySelector('span:last-child').textContent =
            gamepad.connected ? (gamepad.isPlayStation ? 'PlayStation controller' : 'Controller ready') : 'Connect a controller';
    }

    enterMenuMode(backFn = null) {
        cursor.speed = settings.get('cursorSpeed');
        cursor.enable();
        cursor.onBack = backFn;
        $('hint-bar').classList.toggle('hidden', !gamepad.connected);
    }

    // ============ HOME ============
    showHome() {
        this.root.innerHTML = `
        <div class="screen">
            <div id="controller-chip"><span class="dot"></span><span>Connect a controller</span></div>
            <h1 id="title">SABER//3D</h1>
            <div id="subtitle">Rhythm · Slash · Flow</div>
            <div class="menu-buttons">
                <button class="btn primary" id="btn-play">Play</button>
                <button class="btn" id="btn-custom">Custom Levels</button>
                <button class="btn" id="btn-settings">Settings</button>
            </div>
        </div>`;
        this.updateControllerChip();
        this.enterMenuMode(null);
        $('btn-play').onclick = () => this.showSongs();
        $('btn-custom').onclick = () => this.showBrowse();
        $('btn-settings').onclick = () => this.showSettings();
    }

    // ============ SONG LIST (Play) ============
    async showSongs() {
        this.root.innerHTML = `
        <div class="screen panel-screen">
            <div class="panel">
                <div class="panel-header">
                    <div class="panel-title">SELECT SONG</div>
                    <button class="btn small" id="btn-back">← Back</button>
                </div>
                <div class="panel-body" id="song-list"><div class="loading-spinner"></div></div>
            </div>
        </div>`;
        this.enterMenuMode(() => this.showHome());
        $('btn-back').onclick = () => this.showHome();

        const list = $('song-list');
        const saved = await getSavedMaps().catch(() => []);
        list.innerHTML = '';

        // Built-in track
        list.appendChild(this.songRow({
            cover: null,
            name: BUILTIN_SONG.songName,
            artist: BUILTIN_SONG.songAuthor,
            mapper: BUILTIN_SONG.mapper,
            badges: '<span class="badge builtin">Built-in</span>',
            best: getBestForMap(BUILTIN_SONG.id),
            onClick: () => this.showDifficultyModal(BUILTIN_SONG, null),
        }));

        for (const rec of saved) {
            const coverUrl = rec.coverBlob ? URL.createObjectURL(rec.coverBlob) : (rec.meta?.coverURL || null);
            const badges =
                (rec.meta?.hasChroma ? '<span class="badge chroma">Chroma</span>' : '') +
                (rec.meta?.hasNoodle ? '<span class="badge noodle">Noodle</span>' : '');
            list.appendChild(this.songRow({
                cover: coverUrl,
                name: rec.info.songName,
                artist: rec.info.songAuthor,
                mapper: rec.info.levelAuthor || rec.meta?.mapper || '',
                badges,
                best: getBestForMap(rec.id),
                onClick: () => this.showDifficultyModal(null, rec),
                onDelete: async () => {
                    await deleteSavedMap(rec.id);
                    toast('Map deleted');
                    this.showSongs();
                },
            }));
        }

        if (saved.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'browse-msg';
            hint.innerHTML = 'Download more songs in <b>Custom Levels</b> — thousands of community maps from BeatSaver.';
            list.appendChild(hint);
        }
    }

    songRow({ cover, name, artist, mapper, badges, best, onClick, onDelete }) {
        const row = document.createElement('div');
        row.className = 'song-row';
        row.innerHTML = `
            ${cover ? `<img class="song-cover" src="${cover}" alt="">` : '<div class="song-cover"></div>'}
            <div class="song-meta">
                <div class="song-name">${esc(name)}</div>
                <div class="song-artist">${esc(artist)}</div>
                <div class="song-mapper">${esc(mapper)}</div>
            </div>
            <div class="song-right">
                <div class="badges">${badges || ''}</div>
                ${best ? `<div class="song-hs">Best <b>${best.score.toLocaleString()}</b> · ${best.rank}</div>` : ''}
                ${onDelete ? '<button class="btn small danger row-delete">Delete</button>' : ''}
            </div>`;
        row.onclick = (e) => {
            if (e.target.closest('.row-delete')) return;
            onClick();
        };
        if (onDelete) row.querySelector('.row-delete').onclick = (e) => { e.stopPropagation(); onDelete(); };
        return row;
    }

    // ============ DIFFICULTY MODAL ============
    showDifficultyModal(builtinSong, record) {
        const info = builtinSong || record.info;
        const diffs = info.difficulties;
        const chars = [...new Set(diffs.map(d => d.characteristic))];
        let activeChar = chars.includes('Standard') ? 'Standard' : chars[0];

        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        const render = () => {
            const list = diffs.filter(d => d.characteristic === activeChar);
            backdrop.innerHTML = `
            <div class="modal">
                <h2>${esc(info.songName)}</h2>
                <div class="sub">${esc(info.songAuthor)}${info.levelAuthor ? ' · mapped by ' + esc(info.levelAuthor) : ''}</div>
                ${chars.length > 1 ? `<div class="char-tabs">${chars.map(c =>
                    `<button class="sort-btn ${c === activeChar ? 'active' : ''}" data-char="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
                <div class="diff-list">
                    ${list.map((d, i) => {
                        const hs = getHighScore(builtinSong ? builtinSong.id : record.id, d.characteristic, d.difficulty);
                        return `<button class="diff-btn diff-${esc(d.difficulty)}" data-i="${i}">
                            <span>${esc(d.label || d.difficulty)}</span>
                            <span class="diff-stats">NJS ${d.njs}${hs ? ` · Best ${hs.score.toLocaleString()} (${hs.rank})` : ''}</span>
                        </button>`;
                    }).join('')}
                </div>
                <button class="btn small modal-close">Cancel</button>
            </div>`;
            backdrop.querySelectorAll('[data-char]').forEach(b => {
                b.onclick = () => { activeChar = b.dataset.char; render(); };
            });
            backdrop.querySelectorAll('.diff-btn').forEach(b => {
                b.onclick = () => {
                    const d = list[Number(b.dataset.i)];
                    backdrop.remove();
                    audio.playClick(880);
                    this.startLevel(builtinSong, record, d);
                };
            });
        };
        render();
        const prevBack = cursor.onBack;
        const close = () => { backdrop.remove(); cursor.onBack = prevBack; };
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop || e.target.closest('.modal-close')) close();
        });
        document.body.appendChild(backdrop);
        cursor.onBack = close;
    }

    // ============ START / END LEVEL ============
    async startLevel(builtinSong, record, diff) {
        if (!gamepad.connected) {
            toast('Connect a controller to play — sabers are the thumbsticks', 'error');
            return;
        }
        this.root.innerHTML = '<div class="screen"><div class="loading-spinner"></div></div>';
        try {
            let mapData, songBuffer, songName, bpm, mapId;

            if (builtinSong) {
                if (!this.builtinBuffer) {
                    const res = await fetch('background_music.mp3');
                    this.builtinBuffer = await audio.decode(await res.arrayBuffer());
                }
                songBuffer = this.builtinBuffer;
                mapData = generateBuiltinBeatmap(songBuffer.duration, diff.difficulty);
                songName = `${BUILTIN_SONG.songName} — ${BUILTIN_SONG.songAuthor}`;
                bpm = BUILTIN_SONG.bpm;
                mapId = BUILTIN_SONG.id;
            } else {
                songBuffer = await audio.decode(record.songBuf);
                const raw = record.diffFiles[diff.filename];
                if (!raw) throw new Error('Difficulty file missing from download');
                const lightshow = diff.lightshowFilename ? record.diffFiles[diff.lightshowFilename] : null;
                mapData = parseDifficulty(raw, record.info.bpm, lightshow);
                songName = `${record.info.songName} — ${record.info.songAuthor}`;
                bpm = record.info.bpm;
                mapId = record.id;
            }

            this.currentLevel = { builtinSong, record, diff };
            this.root.innerHTML = '';
            cursor.disable();
            $('hint-bar').classList.add('hidden');
            $('hud').classList.remove('hidden');

            this.gameplay = new Gameplay(this.engine, mapData, songBuffer, {
                songName,
                njs: diff.njs,
                offsetBeats: diff.offset,
                bpm,
                mapId,
                onEnd: (results) => this.endLevel(results, mapId, diff),
            });
            this.engine.gameplay = this.gameplay;
        } catch (err) {
            console.error(err);
            toast('Failed to start level: ' + err.message, 'error');
            this.showSongs();
        }
    }

    endLevel(results, mapId, diff) {
        const isNewBest = !results.failed && setHighScore(mapId, diff.characteristic, diff.difficulty, results);
        this.engine.gameplay = null;
        if (this.gameplay) { this.gameplay.destroy(); this.gameplay = null; }
        $('hud').classList.add('hidden');
        this.showResults(results, isNewBest);
    }

    showResults(r, isNewBest) {
        this.root.innerHTML = `
        <div class="screen">
            <div class="modal" style="width:min(520px,92vw)">
                ${r.failed
                    ? '<div class="result-title failed">LEVEL FAILED</div>'
                    : `<div class="result-rank">${r.rank}</div>
                       <div class="result-title">${r.fullCombo ? 'FULL COMBO!' : 'LEVEL CLEARED'}</div>`}
                <div class="result-grid">
                    <div class="result-stat"><div class="val ${isNewBest ? 'new-hs' : ''}">${r.score.toLocaleString()}</div><div class="lbl">${isNewBest ? 'New Best!' : 'Score'}</div></div>
                    <div class="result-stat"><div class="val">${(r.accuracy * 100).toFixed(1)}%</div><div class="lbl">Accuracy</div></div>
                    <div class="result-stat"><div class="val">${r.maxCombo}</div><div class="lbl">Max Combo</div></div>
                    <div class="result-stat"><div class="val">${r.hits} / ${r.hits + r.misses}</div><div class="lbl">Notes Hit</div></div>
                </div>
                <div class="menu-buttons" style="width:100%">
                    <button class="btn primary" id="btn-retry">Retry</button>
                    <button class="btn" id="btn-continue">Song Select</button>
                    <button class="btn" id="btn-home">Main Menu</button>
                </div>
            </div>
        </div>`;
        this.enterMenuMode(() => this.showSongs());
        $('btn-retry').onclick = () => {
            const { builtinSong, record, diff } = this.currentLevel;
            this.startLevel(builtinSong, record, diff);
        };
        $('btn-continue').onclick = () => this.showSongs();
        $('btn-home').onclick = () => this.showHome();
    }

    // ============ PAUSE ============
    pauseGame() {
        if (!this.gameplay || this.gameplay.finished) return;
        this.gameplay.pause();
        this.root.innerHTML = `
        <div class="screen">
            <div class="modal" style="width:min(400px,90vw)">
                <div class="result-title">PAUSED</div>
                <div class="menu-buttons" style="width:100%">
                    <button class="btn primary" id="btn-resume">Resume</button>
                    <button class="btn" id="btn-restart">Restart</button>
                    <button class="btn danger" id="btn-quit">Quit to Menu</button>
                </div>
            </div>
        </div>`;
        this.enterMenuMode(() => this.resumeGame());
        $('btn-resume').onclick = () => this.resumeGame();
        $('btn-restart').onclick = () => {
            this.abortGameplay();
            const { builtinSong, record, diff } = this.currentLevel;
            this.startLevel(builtinSong, record, diff);
        };
        $('btn-quit').onclick = () => {
            this.abortGameplay();
            this.showHome();
        };
    }

    resumeGame() {
        if (!this.gameplay) return;
        this.root.innerHTML = '';
        cursor.disable();
        $('hint-bar').classList.add('hidden');
        this.gameplay.resume();
    }

    abortGameplay() {
        if (this.gameplay) {
            audio.resume();
            this.gameplay.destroy();
            this.gameplay = null;
        }
        this.engine.gameplay = null;
        $('hud').classList.add('hidden');
        $('countdown').classList.add('hidden');
    }

    // ============ CUSTOM LEVELS (BeatSaver) ============
    showBrowse() {
        const st = this.browseState;
        this.root.innerHTML = `
        <div class="screen panel-screen">
            <div class="panel">
                <div class="panel-header">
                    <div class="panel-title">CUSTOM LEVELS</div>
                    <div class="browse-controls">
                        <input class="search-box" id="search-input" type="text"
                               placeholder="Search BeatSaver… (song, artist, mapper)" value="${esc(st.query)}">
                        <button class="sort-btn ${st.sort === 'Rating' ? 'active' : ''}" data-sort="Rating">Top Rated</button>
                        <button class="sort-btn ${st.sort === 'Latest' ? 'active' : ''}" data-sort="Latest">Latest</button>
                        <button class="sort-btn ${st.sort === 'Relevance' ? 'active' : ''}" data-sort="Relevance">Relevance</button>
                    </div>
                    <button class="btn small" id="btn-back">← Back</button>
                </div>
                <div class="panel-body" id="browse-results"><div class="loading-spinner"></div></div>
            </div>
        </div>`;
        this.enterMenuMode(() => this.showHome());
        $('btn-back').onclick = () => this.showHome();

        const input = $('search-input');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                st.query = input.value;
                st.page = 0;
                this.loadBrowseResults();
            }
        });
        this.root.querySelectorAll('[data-sort]').forEach(b => {
            b.onclick = () => {
                st.sort = b.dataset.sort;
                st.page = 0;
                this.root.querySelectorAll('[data-sort]').forEach(x => x.classList.toggle('active', x === b));
                this.loadBrowseResults();
            };
        });

        this.loadBrowseResults();
    }

    async loadBrowseResults() {
        const st = this.browseState;
        const box = $('browse-results');
        if (!box) return;
        box.innerHTML = '<div class="loading-spinner"></div>';
        try {
            const maps = await searchMaps({ query: st.query, page: st.page, sort: st.sort });
            if (!box.isConnected) return;
            if (maps.length === 0) {
                box.innerHTML = '<div class="browse-msg">No maps found. Try a different search.</div>';
                return;
            }
            box.innerHTML = '<div class="map-grid"></div>' + `
                <div class="pager">
                    ${st.page > 0 ? '<button class="btn small" id="pg-prev">← Prev</button>' : ''}
                    <button class="btn small" id="pg-next">Next →</button>
                </div>`;
            const grid = box.querySelector('.map-grid');
            for (const m of maps) grid.appendChild(await this.mapCard(m));
            const prev = $('pg-prev'), next = $('pg-next');
            if (prev) prev.onclick = () => { st.page--; this.loadBrowseResults(); box.scrollTop = 0; };
            if (next) next.onclick = () => { st.page++; this.loadBrowseResults(); box.scrollTop = 0; };
        } catch (err) {
            console.error(err);
            box.innerHTML = `<div class="browse-msg">Couldn't reach BeatSaver.<br><small>${esc(err.message)}</small></div>`;
        }
    }

    async mapCard(m) {
        const card = document.createElement('div');
        card.className = 'map-card';
        const diffNames = [...new Set(m.diffs.map(d => d.difficulty))];
        card.innerHTML = `
            <div class="map-card-top">
                <img class="song-cover" src="${esc(m.coverURL || '')}" loading="lazy" alt="">
                <div class="map-card-info">
                    <div class="map-card-name" title="${esc(m.name)}">${esc(m.songName)}</div>
                    <div class="map-card-author">${esc(m.songAuthor)}</div>
                    <div class="map-card-mapper">${esc(m.mapper)}</div>
                    <div class="map-card-stats">
                        <span class="up">▲ ${m.upvotes}</span>
                        <span>${fmtDuration(m.duration)}</span>
                        <span>${diffNames.length} diff${diffNames.length !== 1 ? 's' : ''}</span>
                    </div>
                </div>
            </div>
            <div class="map-card-bottom">
                <div class="badges">
                    ${m.hasChroma ? '<span class="badge chroma">Chroma</span>' : ''}
                    ${m.hasNoodle ? '<span class="badge noodle">Noodle</span>' : ''}
                </div>
                <button class="dl-btn">Download</button>
            </div>`;

        const btn = card.querySelector('.dl-btn');
        const saved = await getSavedMap(m.id).catch(() => null);
        if (saved) this.markDownloaded(btn, m.id);
        else {
            btn.onclick = async () => {
                btn.disabled = true;
                const bottom = card.querySelector('.map-card-bottom');
                const bar = document.createElement('div');
                bar.className = 'dl-progress';
                bar.innerHTML = '<div class="dl-progress-fill"></div>';
                bottom.insertBefore(bar, btn);
                const fill = bar.querySelector('.dl-progress-fill');
                try {
                    await downloadMap(m, (p, label) => {
                        fill.style.width = (p * 100) + '%';
                        btn.textContent = label;
                    });
                    bar.remove();
                    this.markDownloaded(btn, m.id);
                    toast(`"${m.songName}" downloaded`, 'success');
                    audio.playClick(990);
                } catch (err) {
                    console.error(err);
                    bar.remove();
                    btn.disabled = false;
                    btn.textContent = 'Retry';
                    toast('Download failed: ' + err.message, 'error');
                }
            };
        }
        return card;
    }

    markDownloaded(btn, mapId) {
        btn.disabled = false;
        btn.textContent = 'Play ▶';
        btn.classList.add('downloaded');
        btn.onclick = async () => {
            const rec = await getSavedMap(mapId);
            if (rec) this.showDifficultyModal(null, rec);
        };
    }

    // ============ SETTINGS ============
    showSettings() {
        const s = settings;
        this.root.innerHTML = `
        <div class="screen panel-screen">
            <div class="panel" style="max-width:720px">
                <div class="panel-header">
                    <div class="panel-title">SETTINGS</div>
                    <button class="btn small" id="btn-back">← Back</button>
                </div>
                <div class="panel-body" id="settings-body"></div>
            </div>
        </div>`;
        this.enterMenuMode(() => this.showHome());
        $('btn-back').onclick = () => this.showHome();

        const body = $('settings-body');

        const slider = (key, label, sub, min, max, step, fmt) => {
            const row = document.createElement('div');
            row.className = 'setting-row';
            row.innerHTML = `
                <div class="setting-label">${label}<small>${sub}</small></div>
                <div class="setting-control">
                    <input type="range" min="${min}" max="${max}" step="${step}" value="${s.get(key)}">
                    <div class="setting-value">${fmt(s.get(key))}</div>
                </div>`;
            const input = row.querySelector('input');
            input.oninput = () => {
                const v = Number(input.value);
                s.set(key, v);
                row.querySelector('.setting-value').textContent = fmt(v);
                if (key === 'musicVolume' || key === 'sfxVolume') {
                    audio.setVolumes(s.get('musicVolume'), s.get('sfxVolume'));
                }
                if (key === 'cursorSpeed') cursor.speed = v;
                if (key === 'bloomStrength') this.engine.setBloomStrength(v);
            };
            body.appendChild(row);
        };

        const toggle = (key, label, sub, onChange) => {
            const row = document.createElement('div');
            row.className = 'setting-row';
            row.innerHTML = `
                <div class="setting-label">${label}<small>${sub}</small></div>
                <div class="setting-control"><div class="toggle ${s.get(key) ? 'on' : ''}"></div></div>`;
            const t = row.querySelector('.toggle');
            t.onclick = () => {
                const v = !s.get(key);
                s.set(key, v);
                t.classList.toggle('on', v);
                if (onChange) onChange(v);
                audio.playClick(v ? 880 : 440);
            };
            body.appendChild(row);
        };

        const color = (key, label, sub) => {
            const row = document.createElement('div');
            row.className = 'setting-row';
            row.innerHTML = `
                <div class="setting-label">${label}<small>${sub}</small></div>
                <div class="setting-control"><input type="color" value="${s.get(key)}"></div>`;
            row.querySelector('input').oninput = (e) => s.set(key, e.target.value);
            body.appendChild(row);
        };

        const pct = (v) => Math.round(v * 100) + '%';
        slider('musicVolume', 'Music Volume', 'Song playback level', 0, 1, 0.05, pct);
        slider('sfxVolume', 'Effects Volume', 'Hit sounds and UI', 0, 1, 0.05, pct);
        slider('noteSpeed', 'Note Speed', 'Multiplier on map note-jump speed', 0.7, 1.5, 0.05, (v) => v.toFixed(2) + 'x');
        slider('aimAssist', 'Aim Assist', 'Sabers magnetize toward matching notes', 0, 1, 0.1, pct);
        slider('cursorSpeed', 'Cursor Speed', 'Right-stick menu cursor sensitivity', 0.5, 2, 0.1, (v) => v.toFixed(1) + 'x');
        color('leftColor', 'Left Saber Color', 'Also tints left-hand notes');
        color('rightColor', 'Right Saber Color', 'Also tints right-hand notes');
        toggle('noFail', 'No Fail', 'Never fail a song — chill mode', null);
        toggle('bloom', 'Glow / Bloom', 'Fancy graphics. Turn off on slow devices', (v) => this.engine.setBloom(v));
        slider('bloomStrength', 'Glow Intensity', 'How strong the bloom glow is', 0, 1.2, 0.05, (v) => v.toFixed(2));
    }
}
