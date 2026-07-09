// ============ Noodle Extensions / Heck animation engine ============
// Point definitions with easings + Catmull-Rom splines, track animations
// (AnimateTrack, AssignPathAnimation, AssignTrackParent, AssignPlayerToTrack),
// and per-object animation combination.
import * as THREE from 'three';

export const UNIT = 0.6;            // Noodle grid unit in meters
const DEG = Math.PI / 180;

// ---------- Easings ----------
function bounceOut(x) {
    const n1 = 7.5625, d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
}
const C1 = 1.70158, C2 = C1 * 1.525, C3 = C1 + 1;
const C4 = (2 * Math.PI) / 3, C5 = (2 * Math.PI) / 4.5;

export const EASINGS = {
    easeLinear: x => x,
    easeStep: x => (x >= 1 ? 1 : 0),
    easeInQuad: x => x * x,
    easeOutQuad: x => 1 - (1 - x) * (1 - x),
    easeInOutQuad: x => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
    easeInCubic: x => x ** 3,
    easeOutCubic: x => 1 - Math.pow(1 - x, 3),
    easeInOutCubic: x => (x < 0.5 ? 4 * x ** 3 : 1 - Math.pow(-2 * x + 2, 3) / 2),
    easeInQuart: x => x ** 4,
    easeOutQuart: x => 1 - Math.pow(1 - x, 4),
    easeInOutQuart: x => (x < 0.5 ? 8 * x ** 4 : 1 - Math.pow(-2 * x + 2, 4) / 2),
    easeInQuint: x => x ** 5,
    easeOutQuint: x => 1 - Math.pow(1 - x, 5),
    easeInOutQuint: x => (x < 0.5 ? 16 * x ** 5 : 1 - Math.pow(-2 * x + 2, 5) / 2),
    easeInSine: x => 1 - Math.cos((x * Math.PI) / 2),
    easeOutSine: x => Math.sin((x * Math.PI) / 2),
    easeInOutSine: x => -(Math.cos(Math.PI * x) - 1) / 2,
    easeInExpo: x => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
    easeOutExpo: x => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    easeInOutExpo: x => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
    easeInCirc: x => 1 - Math.sqrt(1 - x * x),
    easeOutCirc: x => Math.sqrt(1 - Math.pow(x - 1, 2)),
    easeInOutCirc: x => (x < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * x, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * x + 2, 2)) + 1) / 2),
    easeInBack: x => C3 * x ** 3 - C1 * x * x,
    easeOutBack: x => 1 + C3 * Math.pow(x - 1, 3) + C1 * Math.pow(x - 1, 2),
    easeInOutBack: x => (x < 0.5
        ? (Math.pow(2 * x, 2) * ((C2 + 1) * 2 * x - C2)) / 2
        : (Math.pow(2 * x - 2, 2) * ((C2 + 1) * (x * 2 - 2) + C2) + 2) / 2),
    easeInElastic: x => (x === 0 ? 0 : x === 1 ? 1 : -Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * C4)),
    easeOutElastic: x => (x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * C4) + 1),
    easeInOutElastic: x => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5
        ? -(Math.pow(2, 20 * x - 10) * Math.sin((20 * x - 11.125) * C5)) / 2
        : (Math.pow(2, -20 * x + 10) * Math.sin((20 * x - 11.125) * C5)) / 2 + 1),
    easeInBounce: x => 1 - bounceOut(1 - x),
    easeOutBounce: bounceOut,
    easeInOutBounce: x => (x < 0.5 ? (1 - bounceOut(1 - 2 * x)) / 2 : (1 + bounceOut(2 * x - 1)) / 2),
};

function ease(name, x) {
    const fn = name && EASINGS[name];
    return fn ? fn(x) : x;
}

// ---------- Point sampler ----------
// points: number | [v...] (static) | [[v..., time, ...flags], ...]
// Supports per-segment easing flags and splineCatmullRom (dims >= 3).
export function samplePts(points, t, dims) {
    if (points == null) return null;
    if (typeof points === 'number') return [points];
    if (!points.length) return null;
    if (typeof points[0] === 'number') return points.slice(0, dims);

    const pts = points;
    const timeOf = (p) => p[dims] ?? 0;
    if (t <= timeOf(pts[0])) return pts[0].slice(0, dims);
    const last = pts[pts.length - 1];
    if (t >= timeOf(last)) return last.slice(0, dims);

    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const ta = timeOf(a), tb = timeOf(b);
        if (t < ta || t > tb) continue;
        let f = tb > ta ? (t - ta) / (tb - ta) : 1;

        // flags live on the segment's end point
        let easingName = null, spline = false;
        for (let k = dims + 1; k < b.length; k++) {
            if (typeof b[k] !== 'string') continue;
            if (b[k].startsWith('ease')) easingName = b[k];
            if (b[k] === 'splineCatmullRom') spline = true;
        }
        f = ease(easingName, f);

        const out = [];
        if (spline && dims >= 3) {
            const p0 = pts[Math.max(0, i - 1)], p3 = pts[Math.min(pts.length - 1, i + 2)];
            for (let d = 0; d < dims; d++) {
                const v0 = p0[d], v1 = a[d], v2 = b[d], v3 = p3[d];
                out.push(0.5 * ((2 * v1) + (-v0 + v2) * f +
                    (2 * v0 - 5 * v1 + 4 * v2 - v3) * f * f +
                    (-v0 + 3 * v1 - 3 * v2 + v3) * f * f * f));
            }
        } else {
            for (let d = 0; d < dims; d++) out.push(a[d] + (b[d] - a[d]) * f);
        }
        return out;
    }
    return last.slice(0, dims);
}

const PROP_DIMS = {
    offsetPosition: 3, definitePosition: 3, rotation: 3, localRotation: 3,
    scale: 3, dissolve: 1, dissolveArrow: 1, color: 4, interactable: 1, time: 1,
    attenuation: 1, fogOffset: 1, startY: 1, height: 1,
};

// Unity is left-handed (+z forward); we mirror z, so rotations about
// x and y flip sign. Unity euler order ZXY (extrinsic) == YXZ intrinsic.
export function setUnityRotation(target, rx, ry, rz) {
    target.rotation.order = 'YXZ';
    target.rotation.set(-rx * DEG, -ry * DEG, rz * DEG);
}
const ADDITIVE = { offsetPosition: true, rotation: true, localRotation: true };
const MULTIPLICATIVE = { scale: true, dissolve: true, dissolveArrow: true };

// ---------- Track system ----------
class Track {
    constructor(name, root) {
        this.name = name;
        this.values = {};      // static values from AnimateTrack (arrays)
        this.paths = {};       // path animations from AssignPathAnimation (point lists)
        this.posScale = UNIT;  // noodle grid units for beatmap objects; 1 (meters) for env/player
        this.group = new THREE.Group();
        this.group.name = 'track:' + name;
        root.add(this.group);
    }
}

export class TrackSystem {
    /**
     * @param scene THREE.Scene
     * @param customEvents parsed [{time, duration, type, tracks, target, easing, props, parent, children}]
     * @param rigs {Root, Head, LeftHand, RightHand} THREE.Groups (or a single Group = Root)
     */
    constructor(scene, customEvents = [], rigs = null) {
        this.scene = scene;
        this.root = new THREE.Group();
        this.root.name = 'noodle-tracks';
        scene.add(this.root);
        this.tracks = new Map();
        this.events = [...customEvents].sort((a, b) => a.time - b.time);
        this.evIdx = 0;
        this.active = [];               // running AnimateTracks
        this.rigs = (rigs && rigs.isObject3D) ? { Root: rigs } : (rigs || {});
        this.playerTargets = {};        // Root/Head/LeftHand/RightHand -> track name
        this.fogTrackName = null;
    }

    track(name) {
        if (!this.tracks.has(name)) this.tracks.set(name, new Track(name, this.root));
        return this.tracks.get(name);
    }

    // Parent container for an object with these track names (first track wins)
    containerFor(trackNames) {
        if (!trackNames || !trackNames.length) return null;
        return this.track(trackNames[0]).group;
    }

    _start(ev) {
        if (ev.type === 'AnimateTrack' || ev.type === 'AnimateComponent') {
            for (const name of ev.tracks) {
                const tr = this.track(name);
                if (ev.duration <= 0.001) {
                    for (const prop in ev.props) {
                        const v = samplePts(ev.props[prop], 1, PROP_DIMS[prop] || 1);
                        if (v) tr.values[prop] = v;
                    }
                } else {
                    this.active.push({ ev, tr });
                }
            }
        } else if (ev.type === 'AssignPathAnimation') {
            for (const name of ev.tracks) {
                const tr = this.track(name);
                for (const prop in ev.props) tr.paths[prop] = ev.props[prop];
            }
        } else if (ev.type === 'AssignTrackParent') {
            const parent = this.track(ev.parent);
            for (const child of (ev.children || [])) {
                parent.group.add(this.track(child).group);
            }
        } else if (ev.type === 'AssignPlayerToTrack') {
            const name = ev.tracks[0] || null;
            if (name) {
                const target = ev.target || 'Root';
                this.playerTargets[target] = name;
                this.track(name).posScale = 1;   // player transforms are in meters
            }
        } else if (ev.type === 'AssignFogTrack') {
            this.fogTrackName = ev.tracks[0] || null;
        }
    }

    update(t) {
        while (this.evIdx < this.events.length && this.events[this.evIdx].time <= t) {
            this._start(this.events[this.evIdx++]);
        }

        for (let i = this.active.length - 1; i >= 0; i--) {
            const a = this.active[i];
            let p = (t - a.ev.time) / a.ev.duration;
            const loops = 1 + (a.ev.repeat || 0);
            const done = p >= loops;
            p = done ? 1 : Math.max(p, 0) % 1;           // repeat wraps each loop
            const ep = ease(a.ev.easing, p);
            for (const prop in a.ev.props) {
                const v = samplePts(a.ev.props[prop], ep, PROP_DIMS[prop] || 1);
                if (v) a.tr.values[prop] = v;
            }
            if (done) this.active.splice(i, 1);
        }

        // apply track transforms to groups
        for (const tr of this.tracks.values()) {
            const v = tr.values;
            if (v.offsetPosition) tr.group.position.set(v.offsetPosition[0] * tr.posScale, v.offsetPosition[1] * tr.posScale, -v.offsetPosition[2] * tr.posScale);
            if (v.rotation) setUnityRotation(tr.group, v.rotation[0], v.rotation[1], v.rotation[2]);
            if (v.localRotation) setUnityRotation(tr.group, v.localRotation[0], v.localRotation[1], v.localRotation[2]);
            if (v.scale) tr.group.scale.set(v.scale[0] || 1, v.scale[1] || 1, v.scale[2] || 1);
        }

        // player / head / saber movement (AssignPlayerToTrack targets)
        for (const target in this.playerTargets) {
            const rig = this.rigs[target];
            if (!rig) continue;
            const tr = this.track(this.playerTargets[target]);
            const v = tr.values;
            const s = tr.posScale;
            if (v.offsetPosition) rig.position.set(v.offsetPosition[0] * s, v.offsetPosition[1] * s, -v.offsetPosition[2] * s);
            if (v.rotation) setUnityRotation(rig, v.rotation[0], v.rotation[1], v.rotation[2]);
            if (v.localRotation) setUnityRotation(rig, v.localRotation[0], v.localRotation[1], v.localRotation[2]);
        }
    }

    // latest fog values (Chroma AssignFogTrack / AnimateComponent)
    fogValues() {
        if (this.fogTrackName) {
            const v = this.track(this.fogTrackName).values;
            if (v.attenuation !== undefined || v.startY !== undefined || v.height !== undefined) return v;
        }
        for (const tr of this.tracks.values()) {
            if (tr.values.attenuation !== undefined) return tr.values;
        }
        return null;
    }

    // Combine an object's own animation with its tracks' path animations and
    // static values, at object lifetime progress lifeP (0 spawn, 0.5 hit, 1 gone).
    combine(objAnim, trackNames, lifeP) {
        const out = {};
        const addSource = (prop, v) => {
            if (!v) return;
            if (out[prop] === undefined) { out[prop] = v.slice ? v.slice() : v; return; }
            if (ADDITIVE[prop]) for (let d = 0; d < v.length; d++) out[prop][d] += v[d];
            else if (MULTIPLICATIVE[prop]) for (let d = 0; d < v.length; d++) out[prop][d] *= v[d];
            else out[prop] = v;
        };
        const props = ['offsetPosition', 'definitePosition', 'rotation', 'localRotation', 'scale', 'dissolve', 'dissolveArrow', 'color', 'interactable', 'time'];
        for (const prop of props) {
            const dims = PROP_DIMS[prop];
            if (objAnim && objAnim[prop]) addSource(prop, samplePts(objAnim[prop], lifeP, dims));
            if (trackNames) {
                for (const name of trackNames) {
                    const tr = this.tracks.get(name);
                    if (!tr) continue;
                    if (tr.paths[prop]) addSource(prop, samplePts(tr.paths[prop], lifeP, dims));
                    if (tr.values[prop] && prop !== 'offsetPosition' && prop !== 'rotation' && prop !== 'localRotation' && prop !== 'scale') {
                        // transform-ish props already applied via the track group
                        addSource(prop, tr.values[prop]);
                    }
                }
            }
        }
        return out;
    }

    destroy() {
        this.scene.remove(this.root);
        for (const target in this.rigs) {
            const rig = this.rigs[target];
            if (!rig) continue;
            rig.position.set(0, 0, 0);
            rig.rotation.set(0, 0, 0);
        }
        this.tracks.clear();
        this.active = [];
        this.playerTargets = {};
    }
}
