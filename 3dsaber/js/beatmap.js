// ============ Beat Saber map parsing: Info.dat + difficulty files ============
// Supports v2.x, v3.x and v4.x beatmaps, Chroma colors, and Noodle Extensions:
// coordinates, per-object NJS/offset, tracks, full animations, custom events
// (AnimateTrack / AssignPathAnimation / AssignTrackParent / AssignPlayerToTrack),
// fake notes/bombs/walls, world + local rotation.
// Pure JS (no DOM) so it can be tested headlessly.

export const CUT_DIR = {
    UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3,
    UP_LEFT: 4, UP_RIGHT: 5, DOWN_LEFT: 6, DOWN_RIGHT: 7, ANY: 8,
};

// Direction the PLAYER swings to cut the note (unit vectors, screen space)
export const DIR_VECTORS = {
    0: [0, 1], 1: [0, -1], 2: [-1, 0], 3: [1, 0],
    4: [-0.707, 0.707], 5: [0.707, 0.707], 6: [-0.707, -0.707], 7: [0.707, -0.707],
    8: [0, 0],
};

const DIFF_ORDER = { Easy: 1, Normal: 3, Hard: 5, Expert: 7, ExpertPlus: 9 };

function normColor(c) {
    if (!Array.isArray(c) || c.length < 3) return null;
    return [Number(c[0]) || 0, Number(c[1]) || 0, Number(c[2]) || 0];
}

// ---------- Noodle helpers ----------
const PROP_ALIASES = {
    offsetPosition: ['offsetPosition', 'position', '_position'],
    definitePosition: ['definitePosition', '_definitePosition'],
    rotation: ['rotation', 'offsetWorldRotation', 'worldRotation', '_rotation'],
    localRotation: ['localRotation', '_localRotation'],
    scale: ['scale', '_scale'],
    dissolve: ['dissolve', '_dissolve'],
    dissolveArrow: ['dissolveArrow', '_dissolveArrow'],
    color: ['color', '_color'],
    interactable: ['interactable', '_interactable'],
};

function resolvePts(v, defs) {
    if (typeof v === 'string') return defs[v] ?? null;    // named point definition
    return v ?? null;
}

// Normalize an animation object (v2 underscore keys or v3 keys) into canonical props
function normAnim(a, defs) {
    if (!a) return null;
    const out = {};
    let any = false;
    for (const prop in PROP_ALIASES) {
        for (const alias of PROP_ALIASES[prop]) {
            if (a[alias] !== undefined) {
                const pts = resolvePts(a[alias], defs);
                if (pts !== null) { out[prop] = pts; any = true; }
                break;
            }
        }
    }
    return any ? out : null;
}

function normTrack(t) {
    if (t == null) return null;
    return Array.isArray(t) ? t.map(String) : [String(t)];
}

// Static world rotation: number (y-axis degrees) or [x,y,z]
function normWorldRot(r) {
    if (r == null) return null;
    if (typeof r === 'number') return [0, r, 0];
    if (Array.isArray(r)) return [r[0] || 0, r[1] || 0, r[2] || 0];
    return null;
}

// Point definitions: v2 [{_name,_points}], v3 {name: points}
function parsePointDefs(cd, v2) {
    const defs = {};
    if (!cd) return defs;
    if (v2 && Array.isArray(cd._pointDefinitions)) {
        for (const d of cd._pointDefinitions) if (d._name) defs[d._name] = d._points;
    } else if (cd.pointDefinitions && typeof cd.pointDefinitions === 'object') {
        Object.assign(defs, cd.pointDefinitions);
    }
    return defs;
}

// Custom events: AnimateTrack / AssignPathAnimation / AssignTrackParent / AssignPlayerToTrack
function parseCustomEvents(list, clock, defs, v2) {
    const out = [];
    for (const ev of (list || [])) {
        const type = v2 ? ev._type : ev.t;
        const beat = v2 ? ev._time : ev.b;
        const d = (v2 ? ev._data : ev.d) || {};
        if (!type || beat === undefined) continue;

        const durBeats = (v2 ? d._duration : d.duration) || 0;
        const time = clock.toSeconds(beat);
        const parsed = {
            time,
            duration: Math.max(0, clock.toSeconds(beat + durBeats) - time),
            type,
            easing: (v2 ? d._easing : d.easing) || null,
            tracks: normTrack(v2 ? d._track : d.track) || [],
            props: {},
            parent: null,
            children: null,
        };

        if (type === 'AssignTrackParent') {
            parsed.parent = String((v2 ? d._parentTrack : d.parentTrack) ?? '');
            parsed.children = (normTrack(v2 ? d._childrenTracks : d.childrenTracks) || []);
        } else {
            const anim = normAnim(d, defs);
            if (anim) parsed.props = anim;
        }
        out.push(parsed);
    }
    return out;
}

// Sample a point list at time t (0..1) — thin re-export used by tests;
// the full sampler (easings/splines) lives in noodle.js.
export function samplePoints(points, t, dims) {
    if (!points || !points.length) return null;
    if (typeof points[0] === 'number') return points.slice(0, dims);
    const pts = points;
    if (t <= pts[0][dims]) return pts[0].slice(0, dims);
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const ta = a[dims], tb = b[dims];
        if (t >= ta && t <= tb) {
            const f = tb > ta ? (t - ta) / (tb - ta) : 1;
            const out = [];
            for (let d = 0; d < dims; d++) out.push(a[d] + (b[d] - a[d]) * f);
            return out;
        }
    }
    return pts[pts.length - 1].slice(0, dims);
}

// ---------- Info.dat ----------
export function parseInfo(json) {
    const info = typeof json === 'string' ? JSON.parse(json) : json;
    const version = info.version || info._version || '2.0.0';
    const major = parseInt(version.split('.')[0], 10);

    if (major >= 4) {
        const diffs = (info.difficultyBeatmaps || []).map(d => ({
            characteristic: d.characteristic || 'Standard',
            difficulty: d.difficulty || 'Normal',
            label: (d.customData && d.customData.difficultyLabel) || d.difficulty,
            filename: d.beatmapDataFilename,
            lightshowFilename: d.lightshowDataFilename || null,
            njs: d.noteJumpMovementSpeed || 10,
            offset: d.noteJumpStartBeatOffset || 0,
            requirements: (d.customData && d.customData.requirements) || [],
        }));
        return {
            version,
            songName: (info.song && info.song.title) || 'Unknown',
            songAuthor: (info.song && info.song.author) || '',
            levelAuthor: (info.difficultyBeatmaps && info.difficultyBeatmaps[0] &&
                info.difficultyBeatmaps[0].beatmapAuthors &&
                (info.difficultyBeatmaps[0].beatmapAuthors.mappers || []).join(', ')) || '',
            bpm: (info.audio && info.audio.bpm) || 120,
            songFilename: (info.audio && info.audio.songFilename) || 'song.ogg',
            coverFilename: info.coverImageFilename || null,
            environment: (info.environmentNames && info.environmentNames[0]) || 'DefaultEnvironment',
            difficulties: sortDiffs(diffs),
        };
    }

    // v2
    const sets = info._difficultyBeatmapSets || [];
    const diffs = [];
    for (const set of sets) {
        const char = set._beatmapCharacteristicName || 'Standard';
        for (const d of (set._difficultyBeatmaps || [])) {
            diffs.push({
                characteristic: char,
                difficulty: d._difficulty || 'Normal',
                label: (d._customData && d._customData._difficultyLabel) || d._difficulty,
                filename: d._beatmapFilename,
                lightshowFilename: null,
                njs: d._noteJumpMovementSpeed || 10,
                offset: d._noteJumpStartBeatOffset || 0,
                requirements: (d._customData && d._customData._requirements) || [],
            });
        }
    }
    return {
        version,
        songName: info._songName || 'Unknown',
        songAuthor: info._songAuthorName || '',
        levelAuthor: info._levelAuthorName || '',
        bpm: info._beatsPerMinute || 120,
        songFilename: info._songFilename || 'song.egg',
        coverFilename: info._coverImageFilename || null,
        environment: info._environmentName || 'DefaultEnvironment',
        difficulties: sortDiffs(diffs),
    };
}

function sortDiffs(diffs) {
    return diffs.sort((a, b) => {
        if (a.characteristic !== b.characteristic) {
            return a.characteristic === 'Standard' ? -1 : b.characteristic === 'Standard' ? 1
                : a.characteristic.localeCompare(b.characteristic);
        }
        return (DIFF_ORDER[a.difficulty] || 0) - (DIFF_ORDER[b.difficulty] || 0);
    });
}

// ---------- Beat <-> seconds with BPM changes ----------
export class BeatClock {
    constructor(baseBpm, bpmEvents = []) {
        this.segments = [{ beat: 0, bpm: baseBpm, time: 0 }];
        const sorted = [...bpmEvents].sort((a, b) => a.beat - b.beat);
        for (const ev of sorted) {
            if (ev.beat <= 0) { this.segments[0].bpm = ev.bpm; continue; }
            const prev = this.segments[this.segments.length - 1];
            const time = prev.time + (ev.beat - prev.beat) * 60 / prev.bpm;
            this.segments.push({ beat: ev.beat, bpm: ev.bpm, time });
        }
    }
    toSeconds(beat) {
        let seg = this.segments[0];
        for (let i = this.segments.length - 1; i >= 0; i--) {
            if (this.segments[i].beat <= beat) { seg = this.segments[i]; break; }
        }
        return seg.time + (beat - seg.beat) * 60 / seg.bpm;
    }
    bpmAt(beat) {
        let seg = this.segments[0];
        for (let i = this.segments.length - 1; i >= 0; i--) {
            if (this.segments[i].beat <= beat) { seg = this.segments[i]; break; }
        }
        return seg.bpm;
    }
}

// ---------- Difficulty file ----------
// Returns { notes, bombs, walls, events, customEvents, clock }
export function parseDifficulty(json, baseBpm, lightshowJson = null) {
    const map = typeof json === 'string' ? JSON.parse(json) : json;
    const version = map.version || map._version || '2.0.0';
    const major = parseInt(version.split('.')[0], 10);

    if (major >= 4) return parseV4(map, baseBpm, lightshowJson);
    if (major === 3) return parseV3(map, baseBpm);
    return parseV2(map, baseBpm);
}

// --- v2 ---
function parseV2(map, baseBpm) {
    const bpmEvents = [];
    for (const ev of (map._events || [])) {
        if (ev._type === 100 && ev._floatValue > 0) bpmEvents.push({ beat: ev._time, bpm: ev._floatValue });
    }
    const clock = new BeatClock(baseBpm, bpmEvents);
    const mapCd = map._customData || {};
    const defs = parsePointDefs(mapCd, true);

    const notes = [];
    const bombs = [];
    for (const n of (map._notes || [])) {
        const cd = n._customData || {};
        let x = n._lineIndex, y = n._lineLayer;
        if (Array.isArray(cd._position)) {          // Noodle: [lineIndex-2, lineLayer]
            x = cd._position[0] + 2;
            y = cd._position[1];
        }
        const time = clock.toSeconds(n._time);
        const common = {
            time, x, y,
            njs: cd._noteJumpMovementSpeed || null,
            spawnOffset: cd._noteJumpStartBeatOffset ?? null,
            decorative: !!cd._fake || cd._interactable === false,
            localRot: Array.isArray(cd._localRotation) ? cd._localRotation : null,
            worldRot: normWorldRot(cd._rotation),
            track: normTrack(cd._track),
            anim: normAnim(cd._animation, defs),
        };
        if (n._type === 3) {
            bombs.push(common);
        } else if (n._type === 0 || n._type === 1) {
            notes.push({
                ...common,
                color: n._type,
                dir: n._cutDirection ?? 8,
                chroma: normColor(cd._color),
            });
        }
    }

    const walls = [];
    for (const o of (map._obstacles || [])) {
        const cd = o._customData || {};
        let x = o._lineIndex, y, h;
        if (o._type === 2) { y = o._lineLayer || 0; h = o._height || 5; }
        else if (o._type === 1) { y = 2; h = 3; }   // crouch
        else { y = 0; h = 5; }                       // full height
        let w = o._width || 1;
        if (Array.isArray(cd._position)) { x = cd._position[0] + 2; y = cd._position[1]; }
        if (Array.isArray(cd._scale)) { w = cd._scale[0] || w; h = cd._scale[1] || h; }
        walls.push({
            time: clock.toSeconds(o._time),
            duration: Math.max(0, clock.toSeconds(o._time + (o._duration || 0)) - clock.toSeconds(o._time)),
            x, y, w, h,
            chroma: normColor(cd._color),
            decorative: !!cd._fake || cd._interactable === false,
            localRot: Array.isArray(cd._localRotation) ? cd._localRotation : null,
            worldRot: normWorldRot(cd._rotation),
            track: normTrack(cd._track),
            anim: normAnim(cd._animation, defs),
        });
    }

    const events = [];
    for (const ev of (map._events || [])) {
        if (ev._type === 100 || ev._type === 14 || ev._type === 15) continue;
        const cd = ev._customData || {};
        events.push({
            time: clock.toSeconds(ev._time),
            type: ev._type,
            value: ev._value,
            float: ev._floatValue ?? 1,
            chroma: normColor(cd._color),
        });
    }

    const customEvents = parseCustomEvents(mapCd._customEvents, clock, defs, true);
    return finish({ notes, bombs, walls, events, customEvents, clock });
}

// --- v3 ---
function parseV3(map, baseBpm) {
    const bpmEvents = (map.bpmEvents || []).map(e => ({ beat: e.b, bpm: e.m }));
    const clock = new BeatClock(baseBpm, bpmEvents);
    const mapCd = map.customData || {};
    const defs = parsePointDefs(mapCd, false);

    const v3Common = (o, forceDecorative = false) => {
        const cd = o.customData || {};
        let x = o.x, y = o.y;
        if (Array.isArray(cd.coordinates)) { x = cd.coordinates[0] + 2; y = cd.coordinates[1]; }
        return {
            time: clock.toSeconds(o.b),
            x, y,
            njs: cd.noteJumpMovementSpeed || null,
            spawnOffset: cd.noteJumpStartBeatOffset ?? null,
            decorative: forceDecorative || cd.uninteractable === true,
            localRot: Array.isArray(cd.localRotation) ? cd.localRotation : null,
            worldRot: normWorldRot(cd.worldRotation),
            track: normTrack(cd.track),
            anim: normAnim(cd.animation, defs),
        };
    };

    const notes = [];
    const pushNote = (n, forceDec = false) => notes.push({
        ...v3Common(n, forceDec),
        color: n.c,
        dir: n.d ?? 8,
        chroma: normColor((n.customData || {}).color),
    });
    for (const n of (map.colorNotes || [])) pushNote(n);
    for (const n of (mapCd.fakeColorNotes || [])) pushNote(n, true);

    // Chains: links as small dot notes
    for (const c of (map.burstSliders || [])) {
        const base = v3Common(c);
        const headTime = base.time;
        const tailTime = clock.toSeconds(c.tb);
        const count = Math.max(1, (c.sc || 1) - 1);
        const squish = c.s || 0.5;
        for (let i = 1; i <= count; i++) {
            const t = (i / count) * squish;
            notes.push({
                ...base,
                time: headTime + (tailTime - headTime) * t,
                x: base.x + ((c.tx ?? base.x) - base.x) * t,
                y: base.y + ((c.ty ?? base.y) - base.y) * t,
                color: c.c,
                dir: 8,
                chroma: normColor((c.customData || {}).color),
                chainLink: true,
            });
        }
    }

    const bombs = [];
    for (const b of (map.bombNotes || [])) bombs.push(v3Common(b));
    for (const b of (mapCd.fakeBombNotes || [])) bombs.push(v3Common(b, true));

    const walls = [];
    const pushWall = (o, forceDec = false) => {
        const cd = o.customData || {};
        const base = v3Common(o, forceDec);
        let w = o.w || 1, h = o.h || 1;
        if (Array.isArray(cd.size)) { w = cd.size[0] || w; h = cd.size[1] || h; }
        walls.push({
            ...base,
            duration: Math.max(0, clock.toSeconds(o.b + (o.d || 0)) - base.time),
            w, h,
            chroma: normColor(cd.color),
        });
    };
    for (const o of (map.obstacles || [])) pushWall(o);
    for (const o of (mapCd.fakeObstacles || [])) pushWall(o, true);

    const events = (map.basicBeatmapEvents || []).map(ev => {
        const cd = ev.customData || {};
        return {
            time: clock.toSeconds(ev.b),
            type: ev.et,
            value: ev.i,
            float: ev.f ?? 1,
            chroma: normColor(cd.color),
        };
    });

    const customEvents = parseCustomEvents(mapCd.customEvents, clock, defs, false);
    return finish({ notes, bombs, walls, events, customEvents, clock });
}

// --- v4 (split object/metadata arrays; lighting lives in the lightshow file) ---
function parseV4(map, baseBpm, lightshowJson) {
    const clock = new BeatClock(baseBpm, []);
    const nd = map.colorNotesData || [];
    const bd = map.bombNotesData || [];
    const od = map.obstaclesData || [];

    const notes = (map.colorNotes || []).map(n => {
        const d = nd[n.i || 0] || {};
        return {
            time: clock.toSeconds(n.b),
            x: d.x ?? 1, y: d.y ?? 0,
            color: d.c ?? 0,
            dir: d.d ?? 8,
            chroma: null, njs: null,
            spawnOffset: null, decorative: false, localRot: null, worldRot: null,
            track: null, anim: null,
        };
    });

    const bombs = (map.bombNotes || []).map(b => {
        const d = bd[b.i || 0] || {};
        return {
            time: clock.toSeconds(b.b), x: d.x ?? 1, y: d.y ?? 0,
            decorative: false, track: null, anim: null, worldRot: null,
        };
    });

    const walls = (map.obstacles || []).map(o => {
        const d = od[o.i || 0] || {};
        return {
            time: clock.toSeconds(o.b),
            duration: Math.max(0, (d.d || 0) * 60 / baseBpm),
            x: d.x ?? 0, y: d.y ?? 0, w: d.w || 1, h: d.h || 1,
            chroma: null, decorative: false, localRot: null, worldRot: null,
            track: null, anim: null,
        };
    });

    let events = [];
    if (lightshowJson) {
        try {
            const ls = typeof lightshowJson === 'string' ? JSON.parse(lightshowJson) : lightshowJson;
            const evData = ls.basicEventsData || [];
            events = (ls.basicEvents || []).map(ev => {
                const d = ev.i !== undefined && evData.length ? (evData[ev.i] || {}) : ev;
                return {
                    time: clock.toSeconds(ev.b),
                    type: d.t ?? ev.t ?? 0,
                    value: d.i ?? ev.i ?? 0,
                    float: d.f ?? ev.f ?? 1,
                    chroma: null,
                };
            });
        } catch (e) { /* lightshow optional */ }
    }

    return finish({ notes, bombs, walls, events, customEvents: [], clock });
}

function finish(data) {
    data.notes.sort((a, b) => a.time - b.time);
    data.bombs.sort((a, b) => a.time - b.time);
    data.walls.sort((a, b) => a.time - b.time);
    data.events.sort((a, b) => a.time - b.time);
    data.customEvents.sort((a, b) => a.time - b.time);
    return data;
}

// Standard half-jump-duration calculation → seconds of look-ahead for a note
export function reactionTime(njs, offsetBeats, bpm) {
    const spb = 60 / bpm;
    let hjd = 4;
    while (njs * spb * hjd > 17.999) hjd /= 2;
    hjd += offsetBeats;
    if (hjd < 0.25) hjd = 0.25;
    return hjd * spb;
}
