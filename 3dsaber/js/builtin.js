// ============ Built-in level: procedural beatmap for the bundled track ============
// Deterministic, flow-aware pattern generation — no random spam, no speed-up gimmick.

function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Cut directions that "flow" from the previous one (down-swing follows up-swing, etc.)
const FLOW_NEXT = {
    0: [1, 6, 7],       // after up -> down-ish
    1: [0, 4, 5],       // after down -> up-ish
    2: [3, 5, 7],
    3: [2, 4, 6],
    4: [1, 7, 3],
    5: [1, 6, 2],
    6: [0, 5, 3],
    7: [0, 4, 2],
    8: [0, 1, 2, 3, 8],
};

// Sensible hand positions: left hand favors columns 0-1, right favors 2-3
function pickColumn(rand, hand, prevCol) {
    const prefs = hand === 0 ? [0, 1, 1, 2] : [3, 2, 2, 1];
    let col = prefs[Math.floor(rand() * prefs.length)];
    if (col === prevCol && rand() < 0.5) col = Math.max(0, Math.min(3, col + (rand() < 0.5 ? -1 : 1)));
    return col;
}

export function generateBuiltinBeatmap(durationSec, difficulty = 'Normal') {
    const bpm = 120;
    const spb = 60 / bpm;
    const rand = mulberry32(difficulty === 'Easy' ? 11 : difficulty === 'Normal' ? 42 : 1337);

    const density = { Easy: 2, Normal: 1, Hard: 0.75 }[difficulty] || 1; // beats between notes
    const doubleChance = { Easy: 0.04, Normal: 0.1, Hard: 0.18 }[difficulty] || 0.1;
    const dotChance = { Easy: 0.35, Normal: 0.2, Hard: 0.12 }[difficulty] || 0.2;

    const startBeat = 4;
    const endBeat = Math.floor((durationSec - 3) / spb);

    const notes = [];
    const events = [];
    let hand = Math.round(rand());          // alternate hands
    const lastDir = [1, 1];                  // per hand
    const lastCol = [1, 2];

    let beat = startBeat;
    let bar = 0;
    while (beat < endBeat) {
        bar = Math.floor((beat - startBeat) / 8);

        // breathing room: skip half a bar every 8 bars
        if ((beat - startBeat) % 64 >= 60) { beat += density; continue; }

        const makeNote = (h) => {
            const col = pickColumn(rand, h, lastCol[h]);
            lastCol[h] = col;
            const layer = rand() < 0.65 ? 0 : rand() < 0.75 ? 1 : 2;
            let dir;
            if (rand() < dotChance) dir = 8;
            else {
                const opts = FLOW_NEXT[lastDir[h]];
                dir = opts[Math.floor(rand() * opts.length)];
            }
            if (dir !== 8) lastDir[h] = dir;
            notes.push({ time: beat * spb, x: col, y: layer, color: h, dir, chroma: null, njs: null });
        };

        makeNote(hand);
        if (rand() < doubleChance) makeNote(1 - hand);
        hand = 1 - hand;

        // small rhythmic variation on harder difficulties
        let step = density;
        if (difficulty === 'Hard' && rand() < 0.12) step = density / 2;
        if (rand() < 0.12) step = density * 2;
        beat += step;
    }

    // Light show: pulse center + alternate lasers every bar, ring spin every 4 bars
    for (let b = 0; b < endBeat; b += 2) {
        const t = b * spb;
        const blue = (b / 2) % 2 === 0;
        events.push({ time: t, type: 0, value: blue ? 3 : 7, float: 1, chroma: null });   // back lasers fade
        if (b % 4 === 0) {
            events.push({ time: t, type: blue ? 2 : 3, value: blue ? 2 : 6, float: 1, chroma: null }); // side flash
            events.push({ time: t, type: 4, value: blue ? 1 : 5, float: 0.8, chroma: null });          // center on
        }
        if (b % 16 === 0) events.push({ time: t, type: 8, value: 0, float: 1, chroma: null });          // ring spin
        events.push({ time: t, type: 1, value: blue ? 3 : 7, float: 0.7, chroma: null });               // ring lights
    }

    return {
        notes,
        bombs: [],
        walls: [],
        events: events.sort((a, b) => a.time - b.time),
        clock: null,
    };
}

export const BUILTIN_SONG = {
    id: '__builtin__',
    songName: 'Neon Circuit',
    songAuthor: 'Built-in Track',
    mapper: 'SABER//3D',
    bpm: 120,
    builtin: true,
    difficulties: [
        { characteristic: 'Standard', difficulty: 'Easy', label: 'Easy', njs: 10, offset: 0 },
        { characteristic: 'Standard', difficulty: 'Normal', label: 'Normal', njs: 12, offset: 0 },
        { characteristic: 'Standard', difficulty: 'Hard', label: 'Hard', njs: 15, offset: 0 },
    ],
};
