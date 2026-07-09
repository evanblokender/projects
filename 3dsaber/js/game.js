// ============ SABER//3D engine + gameplay ============
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIR_VECTORS, reactionTime } from './beatmap.js';
import { TrackSystem, UNIT, setUnityRotation } from './noodle.js';
import { audio } from './audio.js';
import { gamepad } from './input.js';
import { settings } from './settings.js';

// ---------- World constants ----------
const HIT_Z = -1.6;
const COL_STEP = 0.65;
const LAYER_BASE = 0.75;
const LAYER_STEP = 0.55;
const SPAWN_LEAD_Y = 0.35;

const colX = (c) => (c - 1.5) * COL_STEP;
const layerY = (l) => LAYER_BASE + l * LAYER_STEP;

function idealScore(n) {
    // max cut = 115; multiplier ramp: 2 hits @x1, 4 @x2, 8 @x4, rest @x8
    let s = 0;
    const steps = [[2, 1], [4, 2], [8, 4]];
    for (const [count, mult] of steps) {
        const take = Math.min(n, count);
        s += take * 115 * mult;
        n -= take;
        if (n <= 0) return s;
    }
    return s + n * 115 * 8;
}

// ---------- Textures ----------
function makeArrowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 12;
    ctx.beginPath();                    // chevron pointing UP
    ctx.moveTo(64, 22);
    ctx.lineTo(108, 74);
    ctx.lineTo(86, 92);
    ctx.lineTo(64, 62);
    ctx.lineTo(42, 92);
    ctx.lineTo(20, 74);
    ctx.closePath();
    ctx.fill();
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
}

function makeDotTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(64, 64, 26, 0, Math.PI * 2);
    ctx.fill();
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
}

// ---------- Wall distortion shader (real-time energy-field look) ----------
const WALL_VERT = /* glsl */`
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const WALL_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform sampler2D uScene;
uniform vec2 uResolution;
varying vec3 vWorldPos;
varying vec3 vNormal;

float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fres = pow(1.0 - abs(dot(viewDir, normalize(vNormal))), 2.0);
    // two layers of drifting noise drive the warp
    float n1 = noise(vWorldPos * 1.6 + vec3(0.0, uTime * 0.5, uTime * 1.2));
    float n2 = noise(vWorldPos * 3.8 - vec3(uTime * 0.9, 0.0, uTime * 0.6));
    // screen-space refraction: sample and warp whatever is BEHIND the wall
    vec2 suv = gl_FragCoord.xy / uResolution;
    vec2 warp = vec2(n1 - 0.5, n2 - 0.5) * (0.05 + fres * 0.035);
    vec3 refr = texture2D(uScene, clamp(suv + warp, vec2(0.002), vec2(0.998))).rgb;
    float swirl = 0.5 + 0.5 * sin(6.28318 * (n1 + n2 * 0.5) + uTime * 0.7);
    vec3 col = refr * (0.82 + swirl * 0.12) + uColor * (0.10 + fres * 0.5 + swirl * 0.08);
    float alpha = uOpacity * clamp(0.88 + fres * 0.12, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
}`;

function makeWallMaterial(color, distortion, engine) {
    if (!distortion || !engine || !engine.refractionRT) {
        return new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.16, depthWrite: false,
            blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        });
    }
    return new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: color.clone() },
            uOpacity: { value: 1.0 },              // dissolve factor
            uTime: { value: 0 },
            uScene: { value: engine.refractionRT.texture },
            uResolution: { value: engine.resolution },
        },
        vertexShader: WALL_VERT,
        fragmentShader: WALL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
}

// ---------- Light group (responds to beatmap lighting events) ----------
class LightGroup {
    constructor(materials, baseIntensity = 2.2) {
        this.materials = materials;        // emissive materials to drive
        this.color = new THREE.Color(0x2d7dff);
        this.level = 0;                    // current brightness 0..~3
        this.target = 0;                   // level to decay toward
        this.decay = 0;                    // per-second decay for flash/fade
        this.base = baseIntensity;
    }

    trigger(value, float = 1, chromaColor = null, gradient = null) {
        if (gradient) {                        // Chroma light gradient
            this.grad = {
                start: new THREE.Color(gradient.start[0], gradient.start[1], gradient.start[2]),
                end: new THREE.Color(gradient.end[0], gradient.end[1], gradient.end[2]),
                dur: gradient.duration, age: 0,
            };
            chromaColor = gradient.start;
        } else {
            this.grad = null;
        }
        let col = null, mode = 'off';
        if (value === 0) { mode = 'off'; }
        else if (value <= 4) { col = new THREE.Color(0x2d7dff); mode = ['on', 'flash', 'fade', 'on'][(value - 1) % 4]; }
        else if (value <= 8) { col = new THREE.Color(0xff2d55); mode = ['on', 'flash', 'fade', 'on'][(value - 5) % 4]; }
        else { col = new THREE.Color(0xffffff); mode = ['on', 'flash', 'fade', 'on'][(value - 9) % 4]; }
        if (chromaColor) col = new THREE.Color(chromaColor[0], chromaColor[1], chromaColor[2]);

        const f = Math.max(0, float);
        switch (mode) {
            case 'off':   this.level = 0; this.target = 0; this.decay = 0; break;
            case 'on':    this.color.copy(col); this.level = f; this.target = f; this.decay = 0; break;
            case 'flash': this.color.copy(col); this.level = f * 1.45; this.target = f; this.decay = 5; break;
            case 'fade':  this.color.copy(col); this.level = f * 1.25; this.target = 0; this.decay = 2.4; break;
        }
    }

    update(dt) {
        if (this.decay > 0 && this.level !== this.target) {
            this.level += (this.target - this.level) * Math.min(1, this.decay * dt * 3);
            if (Math.abs(this.level - this.target) < 0.01) this.level = this.target;
        }
        if (this.grad) {                       // gradient sweep
            this.grad.age += dt;
            const f = Math.min(1, this.grad.age / this.grad.dur);
            this.color.lerpColors(this.grad.start, this.grad.end, f);
            if (f >= 1) this.grad = null;
        }
        const intensity = this.level * this.base;
        for (const m of this.materials) {
            m.emissive.copy(this.color);
            m.emissiveIntensity = intensity;
        }
    }
}

// ---------- Engine ----------
export class Engine {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x05050c, 0.028);

        this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 300);
        this.camera.position.set(0, 1.85, 4.0);
        this.camera.lookAt(0, 1.15, -8);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.setSize(innerWidth, innerHeight);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.95;
        container.appendChild(this.renderer.domElement);

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.45, 0.35);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());

        // Half-res scene capture for refractive walls (they warp what's behind them)
        const dbs = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        this.resolution = dbs.clone();
        this.refractionRT = new THREE.WebGLRenderTarget(
            Math.max(2, dbs.x >> 1), Math.max(2, dbs.y >> 1),
            { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
        );

        this.arrowTex = makeArrowTexture();
        this.dotTex = makeDotTexture();
        this.clockTime = performance.now() / 1000;
        this.attractTimer = 0;
        this.gameplay = null;

        this.buildEnvironment();
        addEventListener('resize', () => this.onResize());
    }

    onResize() {
        this.camera.aspect = innerWidth / innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(innerWidth, innerHeight);
        this.composer.setSize(innerWidth, innerHeight);
        const dbs = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        this.resolution.copy(dbs);
        this.refractionRT.setSize(Math.max(2, dbs.x >> 1), Math.max(2, dbs.y >> 1));
    }

    buildEnvironment() {
        const s = this.scene;
        s.add(new THREE.AmbientLight(0x334, 1.2));
        const key = new THREE.DirectionalLight(0x8899ff, 0.8);
        key.position.set(3, 8, 4);
        s.add(key);

        // Floor
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(60, 140),
            new THREE.MeshStandardMaterial({ color: 0x07070f, roughness: 0.35, metalness: 0.8 })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.z = -40;
        s.add(floor);

        const grid = new THREE.GridHelper(140, 70, 0x222244, 0x14142a);
        grid.position.y = 0.005;
        grid.position.z = -40;
        s.add(grid);

        // Runway edge strips (react to center-light events)
        const stripGeo = new THREE.BoxGeometry(0.09, 0.02, 120);
        this.centerMats = [];
        for (const x of [-1.7, 1.7]) {
            const m = new THREE.MeshStandardMaterial({ color: 0x111122, emissive: 0x2d7dff, emissiveIntensity: 0.8 });
            const strip = new THREE.Mesh(stripGeo, m);
            strip.position.set(x, 0.02, -50);
            s.add(strip);
            this.centerMats.push(m);
        }

        // Big glow panel far back
        const backMat = new THREE.MeshStandardMaterial({ color: 0x05050c, emissive: 0x7c5cff, emissiveIntensity: 0.4 });
        const back = new THREE.Mesh(new THREE.PlaneGeometry(30, 14), backMat);
        back.position.set(0, 6, -95);
        s.add(back);
        this.centerMats.push(backMat);

        // Side light towers (types 2 & 3)
        this.leftMats = [];
        this.rightMats = [];
        const towerGeo = new THREE.BoxGeometry(0.14, 9, 0.14);
        for (let i = 0; i < 6; i++) {
            const z = -12 - i * 13;
            for (const side of [-1, 1]) {
                const m = new THREE.MeshStandardMaterial({ color: 0x0a0a18, emissive: 0x2d7dff, emissiveIntensity: 0 });
                const tower = new THREE.Mesh(towerGeo, m);
                tower.position.set(side * (5 + i * 0.6), 4.5, z);
                s.add(tower);
                (side < 0 ? this.leftMats : this.rightMats).push(m);
            }
        }

        // Back laser fan (type 0)
        this.backMats = [];
        this.backLasers = [];
        const laserGeo = new THREE.BoxGeometry(0.07, 26, 0.07);
        for (let i = 0; i < 9; i++) {
            const m = new THREE.MeshStandardMaterial({ color: 0x0a0a18, emissive: 0xff2d55, emissiveIntensity: 0 });
            const beam = new THREE.Mesh(laserGeo, m);
            const spread = (i - 4) / 4;
            beam.position.set(spread * 12, 10, -88);
            beam.rotation.z = spread * 0.55;
            s.add(beam);
            this.backMats.push(m);
            this.backLasers.push(beam);
        }

        // Ring stack (type 1 lights, type 8 spin, type 9 zoom)
        this.rings = [];
        this.ringMats = [];
        for (let i = 0; i < 9; i++) {
            const m = new THREE.MeshStandardMaterial({ color: 0x0c0c1c, emissive: 0x7c5cff, emissiveIntensity: 0.3 });
            const ring = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.09, 4, 8), m);
            ring.position.z = -14 - i * 8;
            ring.position.y = 3.4;
            ring.rotation.z = Math.PI / 8;
            ring.userData = { baseZ: ring.position.z, spinTarget: Math.PI / 8, zoomOffset: 0 };
            this.scene.add(ring);
            this.rings.push(ring);
            this.ringMats.push(m);
        }

        // Stars
        const starGeo = new THREE.BufferGeometry();
        const starPos = [];
        for (let i = 0; i < 500; i++) {
            const r = 60 + Math.random() * 60;
            const a = Math.random() * Math.PI * 2;
            starPos.push(Math.cos(a) * r, 6 + Math.random() * 50, -30 - Math.random() * 90);
        }
        starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
        s.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x8888bb, size: 0.14, sizeAttenuation: true })));

        // Light groups keyed by basic event type
        this.lightGroups = {
            0: new LightGroup(this.backMats, 1.5),
            1: new LightGroup(this.ringMats, 1.0),
            2: new LightGroup(this.leftMats, 1.4),
            3: new LightGroup(this.rightMats, 1.4),
            4: new LightGroup(this.centerMats, 0.9),
        };
        this.lightGroups[4].trigger(1, 0.8);
        this.lightGroups[1].trigger(1, 0.4);
        this.laserSpeed = { left: 0.4, right: 0.4 };
        this.ringSpinVel = 0;
    }

    handleEvent(ev) {
        const g = this.lightGroups[ev.type];
        if (g) { g.trigger(ev.value, ev.float, ev.chroma, ev.gradient); return; }
        const c = ev.custom || null;
        if (ev.type === 8) {                       // ring spin (Chroma: precise rotation/step)
            if (c && (c.rotation !== null || c.step !== null)) {
                const dir = c.direction === 0 ? 1 : c.direction === 1 ? -1 : (Math.random() < 0.5 ? 1 : -1);
                const rot = THREE.MathUtils.degToRad(c.rotation ?? 45) * dir;
                const step = THREE.MathUtils.degToRad(c.step ?? 0) * dir;
                this.rings.forEach((ring, i) => { ring.userData.spinTarget += rot + step * i; });
            } else {
                for (const ring of this.rings) {
                    ring.userData.spinTarget += (Math.random() - 0.5) * 1.6;
                }
            }
        } else if (ev.type === 9) {                // ring zoom (Chroma: step = spacing)
            if (c && c.step !== null) {
                this.rings.forEach((ring, i) => { ring.userData.zoomOffset = c.step * i; });
            } else {
                const zoomed = this.rings[0].userData.zoomOffset === 0;
                this.rings.forEach((ring, i) => { ring.userData.zoomOffset = zoomed ? i * 3.2 : 0; });
            }
        } else if (ev.type === 12) {
            const speed = c && c.speed !== null ? c.speed : ev.value;
            this.laserSpeed.left = 0.25 + speed * 0.28;
        } else if (ev.type === 13) {
            const speed = c && c.speed !== null ? c.speed : ev.value;
            this.laserSpeed.right = 0.25 + speed * 0.28;
        }
    }

    setBloom(on) { this.bloom.enabled = on; }
    setBloomStrength(v) { this.bloom.strength = v; }

    updateEnvironment(dt, t) {
        for (const key in this.lightGroups) this.lightGroups[key].update(dt);

        // lazy laser sway
        this.backLasers.forEach((beam, i) => {
            const spread = (i - 4) / 4;
            beam.rotation.z = spread * 0.55 + Math.sin(t * this.laserSpeed.left + i * 1.3) * 0.35;
        });

        this.rings.forEach((ring, i) => {
            ring.rotation.z += (ring.userData.spinTarget - ring.rotation.z) * Math.min(1, dt * 3.2);
            const targetZ = ring.userData.baseZ - ring.userData.zoomOffset;
            ring.position.z += (targetZ - ring.position.z) * Math.min(1, dt * 2.4);
        });
    }

    // Ambient light show while in menus
    updateAttract(dt, t) {
        this.attractTimer -= dt;
        if (this.attractTimer <= 0) {
            this.attractTimer = 1.6 + Math.random() * 1.6;
            const types = [0, 1, 2, 3, 4];
            const type = types[Math.floor(Math.random() * types.length)];
            const value = [1, 2, 3, 5, 6, 7][Math.floor(Math.random() * 6)];
            this.handleEvent({ type, value, float: 0.35 + Math.random() * 0.4, chroma: null });
            if (Math.random() < 0.22) this.handleEvent({ type: 8, value: 0, float: 1, chroma: null });
        }
        this.camera.position.x = Math.sin(t * 0.11) * 0.35;
        this.camera.position.y = 1.85 + Math.sin(t * 0.17) * 0.1;
        this.camera.lookAt(0, 1.4, -12);
    }

    update() {
        const now = performance.now() / 1000;
        const dt = Math.min(0.05, now - this.clockTime);
        this.clockTime = now;

        if (this.gameplay) {
            this.gameplay.update(dt);
        } else {
            this.updateAttract(dt, now);
        }
        this.updateEnvironment(dt, now);

        // Refraction pre-pass: capture the scene without distortion walls so
        // the wall shader can warp what's behind them (like the real game).
        if (this.gameplay && this.gameplay.liveWalls) {
            const dWalls = [];
            for (const w of this.gameplay.liveWalls) {
                if (w.userData.mat && w.userData.mat.isShaderMaterial && w.visible) dWalls.push(w);
            }
            if (dWalls.length) {
                for (const w of dWalls) w.visible = false;
                this.renderer.setRenderTarget(this.refractionRT);
                this.renderer.render(this.scene, this.camera);
                this.renderer.setRenderTarget(null);
                for (const w of dWalls) w.visible = true;
            }
        }

        this.composer.render();
        return dt;
    }
}

// ---------- Saber ----------
const BLADE_LEN = 1.05;

class Saber {
    constructor(scene, colorHex, homeX) {
        this.color = new THREE.Color(colorHex);
        this.homeX = homeX;
        this.group = new THREE.Group();

        const handle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.035, 0.042, 0.24, 12),
            new THREE.MeshStandardMaterial({ color: 0x222230, roughness: 0.4, metalness: 0.9 })
        );
        this.group.add(handle);

        this.bladeMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: this.color,
            emissiveIntensity: 2.0,
            roughness: 0.3,
        });
        this.blade = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.02, BLADE_LEN, 10), this.bladeMat);
        this.blade.position.y = 0.14 + BLADE_LEN / 2;
        this.group.add(this.blade);

        const glowMat = new THREE.MeshBasicMaterial({
            color: this.color, transparent: true, opacity: 0.14,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.055, BLADE_LEN * 1.02, 10), glowMat);
        glow.position.copy(this.blade.position);
        this.group.add(glow);

        // Tilt blade slightly forward so it points up + away
        this.group.rotation.x = -0.5;
        this.group.position.set(homeX, 1.1, HIT_Z + 0.25);
        scene.add(this.group);

        this.pos = new THREE.Vector2(homeX, 1.1);   // logical xy
        this.vel = new THREE.Vector2();
        this.smoothVel = new THREE.Vector2();

        // Trail
        this.trailLen = 14;
        this.trailPts = [];                          // [{tip:Vector3, base:Vector3}]
        const geo = new THREE.BufferGeometry();
        const verts = new Float32Array((this.trailLen - 1) * 6 * 3);
        const cols = new Float32Array((this.trailLen - 1) * 6 * 3);
        geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        this.trailMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            vertexColors: true, transparent: true, opacity: 0.5,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }));
        this.trailMesh.frustumCulled = false;
        scene.add(this.trailMesh);
    }

    setColor(hex) {
        this.color.set(hex);
        this.bladeMat.emissive.copy(this.color);
    }

    // stick: {x: -1..1, y: -1..1 (down positive)}
    move(stick, dt) {
        const targetX = this.homeX * 0.25 + stick.x * 1.45;
        const targetY = 1.25 - stick.y * 1.0;
        const k = 1 - Math.exp(-22 * dt);           // snappy, still smooth
        const oldX = this.pos.x, oldY = this.pos.y;
        this.pos.x += (targetX - this.pos.x) * k;
        this.pos.y += (targetY - this.pos.y) * k;

        if (dt > 0) {
            this.vel.set((this.pos.x - oldX) / dt, (this.pos.y - oldY) / dt);
            this.smoothVel.lerp(this.vel, Math.min(1, dt * 18));
        }

        this.group.position.set(this.pos.x, this.pos.y, HIT_Z + 0.25);
        // lean into the swing
        this.group.rotation.z = THREE.MathUtils.clamp(-this.smoothVel.x * 0.06, -0.7, 0.7);
        this.group.rotation.x = -0.5 + THREE.MathUtils.clamp(this.smoothVel.y * 0.05, -0.5, 0.5);

        this.pushTrail();
    }

    tipWorld() {
        const v = new THREE.Vector3(0, 0.14 + BLADE_LEN, 0);
        return this.group.localToWorld(v);
    }
    baseWorld() {
        const v = new THREE.Vector3(0, 0.14, 0);
        return this.group.localToWorld(v);
    }

    pushTrail() {
        this.trailPts.unshift({ tip: this.tipWorld(), base: this.baseWorld() });
        if (this.trailPts.length > this.trailLen) this.trailPts.pop();

        const pos = this.trailMesh.geometry.attributes.position.array;
        const col = this.trailMesh.geometry.attributes.color.array;
        let vi = 0;
        for (let i = 0; i < this.trailPts.length - 1; i++) {
            const a = this.trailPts[i], b = this.trailPts[i + 1];
            const fade = 1 - i / this.trailLen;
            const c = this.color;
            const quad = [a.base, a.tip, b.tip, a.base, b.tip, b.base];
            for (const p of quad) {
                pos[vi] = p.x; pos[vi + 1] = p.y; pos[vi + 2] = p.z;
                col[vi] = c.r * fade; col[vi + 1] = c.g * fade; col[vi + 2] = c.b * fade;
                vi += 3;
            }
        }
        for (; vi < pos.length; vi++) { pos[vi] = 0; col[vi] = 0; }
        this.trailMesh.geometry.attributes.position.needsUpdate = true;
        this.trailMesh.geometry.attributes.color.needsUpdate = true;
    }

    // shortest distance from point to blade segment (in world space)
    distanceTo(point) {
        const a = this.baseWorld(), b = this.tipWorld();
        const ab = b.clone().sub(a);
        const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
        return a.add(ab.multiplyScalar(t)).distanceTo(point);
    }

    dispose(scene) {
        if (this.group.parent) this.group.parent.remove(this.group);
        scene.remove(this.trailMesh);
    }
}

// ---------- Particles ----------
class ParticleBurst {
    constructor(scene, position, color, count = 18) {
        this.scene = scene;
        this.life = 0.55;
        this.age = 0;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(count * 3);
        this.vels = [];
        for (let i = 0; i < count; i++) {
            pos[i * 3] = position.x; pos[i * 3 + 1] = position.y; pos[i * 3 + 2] = position.z;
            this.vels.push(new THREE.Vector3(
                (Math.random() - 0.5) * 5, (Math.random() - 0.2) * 5, (Math.random() - 0.3) * 5
            ));
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.mat = new THREE.PointsMaterial({
            color, size: 0.07, transparent: true, opacity: 1,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        this.points = new THREE.Points(geo, this.mat);
        scene.add(this.points);
    }
    update(dt) {
        this.age += dt;
        const pos = this.points.geometry.attributes.position.array;
        for (let i = 0; i < this.vels.length; i++) {
            const v = this.vels[i];
            v.y -= 7 * dt;
            pos[i * 3] += v.x * dt; pos[i * 3 + 1] += v.y * dt; pos[i * 3 + 2] += v.z * dt;
        }
        this.points.geometry.attributes.position.needsUpdate = true;
        this.mat.opacity = 1 - this.age / this.life;
        if (this.age >= this.life) { this.scene.remove(this.points); return false; }
        return true;
    }
}

// ---------- Gameplay session ----------
export class Gameplay {
    /**
     * @param engine Engine
     * @param mapData parsed difficulty {notes,bombs,walls,events}
     * @param songBuffer AudioBuffer
     * @param opts {songName, njs, offsetBeats, bpm, mapId, diffKey, onEnd(results), onFail()}
     */
    constructor(engine, mapData, songBuffer, opts) {
        this.engine = engine;
        this.scene = engine.scene;
        this.map = mapData;
        this.songBuffer = songBuffer;
        this.opts = opts;

        const speedMult = settings.get('noteSpeed');
        this.speedMult = speedMult;
        this.bpm = opts.bpm || 120;
        this.njs = Math.max(8, Math.min(20, (opts.njs || 12))) * speedMult;
        this.rt = Math.max(1.15, reactionTime(this.njs, opts.offsetBeats || 0, this.bpm) / speedMult);
        this.aimAssist = settings.get('aimAssist');

        this.saberLeft = new Saber(this.scene, settings.get('leftColor'), -0.55);
        this.saberRight = new Saber(this.scene, settings.get('rightColor'), 0.55);

        // Noodle player rigs: Root moves everything; Head moves the camera;
        // LeftHand/RightHand move the sabers (AssignPlayerToTrack targets).
        this.playerRig = new THREE.Group();
        this.headRig = new THREE.Group();
        this.leftHandRig = new THREE.Group();
        this.rightHandRig = new THREE.Group();
        this.playerRig.add(this.headRig, this.leftHandRig, this.rightHandRig);
        this.scene.add(this.playerRig);
        this._camHome = {
            pos: engine.camera.position.clone(),
            quat: engine.camera.quaternion.clone(),
            parent: engine.camera.parent,
        };
        this.headRig.add(engine.camera);
        this.leftHandRig.add(this.saberLeft.group);    // sabers travel with the player
        this.rightHandRig.add(this.saberRight.group);
        this.tracks = new TrackSystem(this.scene, mapData.customEvents || [], {
            Root: this.playerRig,
            Head: this.headRig,
            LeftHand: this.leftHandRig,
            RightHand: this.rightHandRig,
        });
        this._tmpV = new THREE.Vector3();
        this._baseFogDensity = this.scene.fog ? this.scene.fog.density : 0.028;

        // Spawn queues sorted by SPAWN time (not hit time) so Noodle objects with
        // large spawn offsets appear exactly when they should, never late.
        const bySpawn = (arr) => arr
            .map(o => ({ o, at: o.time - this.noteRt(o) }))
            .sort((a, b) => a.at - b.at);
        this.noteQueue = bySpawn(mapData.notes);
        this.bombQueue = bySpawn(mapData.bombs);
        this.wallQueue = bySpawn(mapData.walls);

        // Chroma environment geometry — the "custom models" in model maps
        this.spawnEnvironment(mapData.environment);

        this.noteIdx = 0; this.bombIdx = 0; this.wallIdx = 0; this.eventIdx = 0;
        this.liveNotes = [];
        this.liveBombs = [];
        this.liveWalls = [];
        this.slices = [];
        this.particles = [];

        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.multiplier = 1;
        this.multProgress = 0;
        this.hits = 0;
        this.misses = 0;
        this.processed = 0;
        this.energy = 0.5;
        this.failed = false;
        this.finished = false;
        this.paused = false;

        this.noFail = settings.get('noFail');
        this._matCache = {};

        // HUD refs
        this.$ = (id) => document.getElementById(id);
        this.$('hud-song-name').textContent = opts.songName || '';
        this.$('hud-nofail-tag').classList.toggle('hidden', !this.noFail);
        this.updateHud();

        audio.onSongEnd = () => { if (!this.failed) this.finish(); };
        audio.startSong(songBuffer, -2.2);
    }

    // ----- materials -----
    noteMaterial(color, chroma) {
        const base = color === 0 ? settings.get('leftColor') : settings.get('rightColor');
        const c = chroma
            ? new THREE.Color(Math.min(1, chroma[0]), Math.min(1, chroma[1]), Math.min(1, chroma[2]))
            : new THREE.Color(base);
        const key = c.getHexString();
        if (!this._matCache[key]) {
            this._matCache[key] = new THREE.MeshStandardMaterial({
                color: c, roughness: 0.32, metalness: 0.15,
                emissive: c, emissiveIntensity: 0.28,
            });
        }
        return this._matCache[key];
    }

    // Per-note speed / reaction time (Noodle per-object njs + spawn offset)
    noteSpeed(n) {
        return n.njs ? Math.max(6, Math.min(24, n.njs)) * this.speedMult : this.njs;
    }
    noteRt(n) {
        let rt = this.rt * (this.njs / this.noteSpeed(n));
        if (n.spawnOffset != null) rt = Math.max(0.3, rt + n.spawnOffset * (60 / this.bpm));
        return rt;
    }
    // Notes way outside the reachable grid are scenery on Noodle maps
    isReachable(n) {
        return n.x >= -0.6 && n.x <= 3.6 && n.y >= -0.6 && n.y <= 2.9;
    }

    // ----- Chroma environment geometry ("custom models") -----
    envGeometry(type) {
        if (!this._envGeoCache) this._envGeoCache = {};
        const key = String(type);
        if (!this._envGeoCache[key]) {
            let g;
            switch (key) {
                case 'Sphere':   g = new THREE.SphereGeometry(0.5, 16, 12); break;
                case 'Capsule':  g = new THREE.CapsuleGeometry(0.5, 1, 4, 12); break;
                case 'Cylinder': g = new THREE.CylinderGeometry(0.5, 0.5, 1, 16); break;
                case 'Plane':    g = new THREE.PlaneGeometry(10, 10); break;
                case 'Quad':     g = new THREE.PlaneGeometry(1, 1); break;
                case 'Triangle': {
                    const shape = new THREE.Shape();
                    shape.moveTo(0, 0.577);
                    shape.lineTo(-0.5, -0.289);
                    shape.lineTo(0.5, -0.289);
                    shape.closePath();
                    g = new THREE.ShapeGeometry(shape);
                    break;
                }
                default:         g = new THREE.BoxGeometry(1, 1, 1); break; // Cube
            }
            this._envGeoCache[key] = g;
        }
        return this._envGeoCache[key];
    }

    envMaterial(shader, colorArr) {
        if (!this._envMatCache) this._envMatCache = {};
        const c = colorArr
            ? new THREE.Color(Math.min(2, colorArr[0]), Math.min(2, colorArr[1]), Math.min(2, colorArr[2]))
            : new THREE.Color(0x8899bb);
        const key = shader + '|' + c.getHexString();
        if (!this._envMatCache[key]) {
            let m;
            if (/OpaqueLight/i.test(shader)) {
                m = new THREE.MeshStandardMaterial({
                    color: c.clone().multiplyScalar(0.15), emissive: c, emissiveIntensity: 1.6,
                });
            } else if (/TransparentLight|BillieWater|Water/i.test(shader)) {
                m = new THREE.MeshBasicMaterial({
                    color: c, transparent: true, opacity: 0.5,
                    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
                });
            } else {           // Standard / BTSPillar / InterscopeConcrete / etc.
                m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.35 });
            }
            this._envMatCache[key] = m;
        }
        return this._envMatCache[key];
    }

    _envTransform(target, e) {
        const pos = e.position || e.localPosition || [0, 0, 0];
        // Chroma env positions are Unity meters, +z forward → our -z
        target.position.set(pos[0] || 0, pos[1] || 0, -(pos[2] || 0));
        const rot = e.rotation || e.localRotation || [0, 0, 0];
        target.rotation.set(
            THREE.MathUtils.degToRad(rot[0] || 0),
            -THREE.MathUtils.degToRad(rot[1] || 0),
            THREE.MathUtils.degToRad(rot[2] || 0)
        );
        const sc = e.scale || [1, 1, 1];
        target.scale.set(sc[0] || 0.0001, sc[1] || 0.0001, sc[2] || 0.0001);
    }

    spawnEnvironment(list) {
        this.envMeshes = [];
        if (!list || !list.length) return;

        // No cap — model maps need every piece. Static (untracked) geometry is
        // merged per material into single draw calls so huge models stay fast.
        const staticBuckets = new Map();   // matKey -> {material, geometries[]}
        const helper = new THREE.Object3D();

        for (const e of list) {
            const material = this.envMaterial(e.shader, e.color);
            if (e.track && e.track.length) {
                // animated pieces stay individual so their track can move them
                const mesh = new THREE.Mesh(this.envGeometry(e.type), material);
                this._envTransform(mesh, e);
                this.tracks.containerFor(e.track).add(mesh);
                this.envMeshes.push(mesh);
            } else {
                this._envTransform(helper, e);
                helper.updateMatrix();
                const geo = this.envGeometry(e.type).clone().applyMatrix4(helper.matrix);
                const key = material.uuid;
                if (!staticBuckets.has(key)) staticBuckets.set(key, { material, geometries: [] });
                staticBuckets.get(key).geometries.push(geo);
            }
        }

        for (const { material, geometries } of staticBuckets.values()) {
            try {
                const merged = mergeGeometries(geometries, false);
                if (!merged) throw new Error('merge failed');
                const mesh = new THREE.Mesh(merged, material);
                this.scene.add(mesh);
                this.envMeshes.push(mesh);
            } catch (err) {
                // merge can fail on exotic attribute sets — fall back to individual meshes
                for (const geo of geometries) {
                    const mesh = new THREE.Mesh(geo, material);
                    this.scene.add(mesh);
                    this.envMeshes.push(mesh);
                }
            }
        }
    }

    // Wrap an object so world rotation + tracks compose correctly, and attach
    // it to its track's group (or the scene).
    attachObject(group, obj) {
        const wrapper = new THREE.Group();
        if (obj.worldRot) {
            wrapper.rotation.set(
                THREE.MathUtils.degToRad(obj.worldRot[0]),
                -THREE.MathUtils.degToRad(obj.worldRot[1]),
                THREE.MathUtils.degToRad(obj.worldRot[2])
            );
        }
        wrapper.userData.baseRot = wrapper.rotation.clone();
        wrapper.add(group);
        const container = (obj.track && this.tracks.containerFor(obj.track)) || this.scene;
        container.add(wrapper);
        return wrapper;
    }

    removeObj(g) {
        const w = g.userData.wrapper;
        if (w && w.parent) w.parent.remove(w);
        else if (g.parent) g.parent.remove(g);
    }

    spawnNote(n) {
        const size = n.chainLink ? 0.3 : 0.48;
        const group = new THREE.Group();
        let mat = this.noteMaterial(n.color, n.chroma);
        if (n.anim || n.track) {                 // needs its own material for dissolve/color
            mat = mat.clone();
            mat.transparent = true;
        }
        const box = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat);
        group.add(box);

        const tex = (n.dir === 8 || n.chainLink) ? this.engine.dotTex : this.engine.arrowTex;
        const faceMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
        const face = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.86, size * 0.86), faceMat);
        face.position.z = size / 2 + 0.012;
        // arrow texture points up; rotate so it points along the swing direction
        const v = DIR_VECTORS[n.dir] || [0, 0];
        if (n.dir !== 8) face.rotation.z = Math.atan2(-v[0], v[1]);
        group.add(face);

        group.userData = {
            note: n,
            targetY: layerY(n.y),
            x: colX(n.x),
            mat,
            faceMat,
            baseColor: mat.color.clone(),
            speed: this.noteSpeed(n),
            rt: this.noteRt(n),
            decorative: n.decorative || (!n.anim && !this.isReachable(n)),
            wp: new THREE.Vector3(),
            rp: new THREE.Vector3(),
        };
        if (n.localRot) {
            group.userData.localRot = new THREE.Euler(
                THREE.MathUtils.degToRad(n.localRot[0] || 0),
                THREE.MathUtils.degToRad(n.localRot[1] || 0),
                THREE.MathUtils.degToRad(n.localRot[2] || 0)
            );
        }
        group.userData.wrapper = this.attachObject(group, n);
        this.liveNotes.push(group);
    }

    spawnBomb(b) {
        const mat = new THREE.MeshStandardMaterial({
            color: 0x14141a, roughness: 0.5, metalness: 0.6,
            emissive: 0xff2020, emissiveIntensity: 0.5, flatShading: true,
            transparent: !!(b.anim || b.track),
        });
        const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), mat);
        mesh.userData = {
            bomb: b, targetY: layerY(b.y), x: colX(b.x), mat,
            speed: this.noteSpeed(b), rt: this.noteRt(b),
            decorative: !!b.decorative,
            wp: new THREE.Vector3(),
            rp: new THREE.Vector3(),
        };
        mesh.userData.wrapper = this.attachObject(mesh, b);
        this.liveBombs.push(mesh);
    }

    spawnWall(w) {
        // Wall art uses huge/tiny/negative sizes — preserve them, just keep sane bounds
        const width = Math.min(60, Math.max(0.03, Math.abs(w.w))) * COL_STEP;
        const height = Math.min(60, Math.max(0.03, Math.abs(w.h))) * LAYER_STEP;
        const length = Math.min(300, Math.max(0.05, w.duration * this.noteSpeed(w)));
        const color = w.chroma
            ? new THREE.Color(Math.min(1, w.chroma[0]), Math.min(1, w.chroma[1]), Math.min(1, w.chroma[2]))
            : new THREE.Color(0xff2d55);
        const mat = makeWallMaterial(color, settings.get('wallDistortion'), this.engine);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, length), mat);
        const edge = new THREE.LineSegments(
            new THREE.EdgesGeometry(mesh.geometry),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 })
        );
        mesh.add(edge);
        mesh.userData = {
            wall: w,
            // left edge at column x, extending `w.w` columns (negative w extends left)
            x: colX(w.x) - COL_STEP / 2 + (w.w * COL_STEP) / 2,
            y: 0.1 + w.y * LAYER_STEP + (w.h >= 0 ? height : -height) / 2,
            width, height, length,
            mat,
            edgeMat: edge.material,
            speed: this.noteSpeed(w),
            rt: this.noteRt(w),
            decorative: !!w.decorative,
            baseOpacity: 0.16,
            wp: new THREE.Vector3(),
            rp: new THREE.Vector3(),
        };
        if (w.localRot) {
            mesh.rotation.set(
                THREE.MathUtils.degToRad(w.localRot[0] || 0),
                THREE.MathUtils.degToRad(w.localRot[1] || 0),
                THREE.MathUtils.degToRad(w.localRot[2] || 0)
            );
        }
        mesh.userData.wrapper = this.attachObject(mesh, w);
        this.liveWalls.push(mesh);
    }

    // ----- game update -----
    update(dt) {
        if (this.paused || this.finished) return;

        const t = audio.songTime;

        // countdown display
        const cd = this.$('countdown');
        if (t < 0) {
            const n = Math.ceil(-t);
            const label = n > 3 ? 'READY' : String(n);
            if (cd.textContent !== label) {
                cd.textContent = label;
                cd.classList.remove('hidden', 'tick');
                void cd.offsetWidth;
                cd.classList.add('tick');
            }
        } else if (!cd.classList.contains('hidden')) {
            if (t < 0.8 && cd.textContent !== 'GO!') {
                cd.textContent = 'GO!';
                cd.classList.remove('tick'); void cd.offsetWidth; cd.classList.add('tick');
                setTimeout(() => cd.classList.add('hidden'), 900);
            } else if (t >= 0.8 && cd.textContent !== 'GO!') {
                cd.classList.add('hidden');
            }
        }

        // sabers
        gamepad.poll();
        this.saberLeft.move(gamepad.leftStick, dt);
        this.saberRight.move(gamepad.rightStick, dt);

        // spawn objects whose spawn time has arrived (queues pre-sorted by spawn time)
        while (this.noteIdx < this.noteQueue.length && this.noteQueue[this.noteIdx].at <= t) {
            this.spawnNote(this.noteQueue[this.noteIdx++].o);
        }
        while (this.bombIdx < this.bombQueue.length && this.bombQueue[this.bombIdx].at <= t) {
            this.spawnBomb(this.bombQueue[this.bombIdx++].o);
        }
        while (this.wallIdx < this.wallQueue.length && this.wallQueue[this.wallIdx].at <= t) {
            this.spawnWall(this.wallQueue[this.wallIdx++].o);
        }
        while (this.eventIdx < this.map.events.length && this.map.events[this.eventIdx].time <= t) {
            this.engine.handleEvent(this.map.events[this.eventIdx++]);
        }

        // Noodle: custom events, track animations, player movement
        this.tracks.update(t);

        this.moveNotes(t, dt);
        this.moveBombs(t);
        this.moveWalls(t, dt);

        this.slices = this.slices.filter(s => s.update(dt));
        this.particles = this.particles.filter(p => p.update(dt));

        // progress bar
        const dur = audio.songDuration || 1;
        this.$('hud-progress-fill').style.width = Math.min(100, Math.max(0, t / dur * 100)) + '%';
    }

    noteZ(time, t, speed) { return HIT_Z - (time - t) * (speed || this.njs); }

    // Apply combined Noodle effects (object anim + track paths + track values)
    applyNoodleFx(g, ud, fx) {
        if (fx.offsetPosition) {
            g.position.x += fx.offsetPosition[0] * UNIT;
            g.position.y += fx.offsetPosition[1] * UNIT;
            g.position.z -= fx.offsetPosition[2] * UNIT;
        }
        if (fx.localRotation) {
            g.rotation.x += THREE.MathUtils.degToRad(fx.localRotation[0]);
            g.rotation.y -= THREE.MathUtils.degToRad(fx.localRotation[1]);
            g.rotation.z += THREE.MathUtils.degToRad(fx.localRotation[2]);
        }
        if (fx.rotation && ud.wrapper) {
            const b = ud.wrapper.userData.baseRot;
            ud.wrapper.rotation.set(
                (b ? b.x : 0) + THREE.MathUtils.degToRad(fx.rotation[0]),
                (b ? b.y : 0) - THREE.MathUtils.degToRad(fx.rotation[1]),
                (b ? b.z : 0) + THREE.MathUtils.degToRad(fx.rotation[2])
            );
        }
        if (fx.scale) {
            g.scale.x *= fx.scale[0] || 1;
            g.scale.y *= fx.scale[1] || 1;
            g.scale.z *= fx.scale[2] || 1;
        }
        if (fx.dissolve !== undefined && ud.mat && ud.mat.transparent) {
            ud.mat.opacity = THREE.MathUtils.clamp(fx.dissolve[0], 0, 1) * (ud.baseOpacity ?? 1);
        }
        if (fx.dissolveArrow !== undefined && ud.faceMat) {
            ud.faceMat.opacity = THREE.MathUtils.clamp(fx.dissolveArrow[0], 0, 1);
        }
        if (fx.color && ud.mat && ud.mat.color) {   // shader walls sync uniforms separately
            ud.mat.color.setRGB(Math.min(1, fx.color[0]), Math.min(1, fx.color[1]), Math.min(1, fx.color[2]));
            if (ud.mat.emissive) ud.mat.emissive.copy(ud.mat.color);
            if (fx.color[3] !== undefined && ud.mat.transparent) {
                ud.mat.opacity = Math.min(ud.mat.opacity, THREE.MathUtils.clamp(fx.color[3], 0, 1));
            }
        }
    }

    moveNotes(t, dt) {
        // pass 1: transforms (position, jump-in, Noodle animation)
        for (const g of this.liveNotes) {
            const ud = g.userData;
            const n = ud.note;
            const p = 1 - (n.time - t) / ud.rt;      // 0 spawn → 1 hit
            const lifeP = THREE.MathUtils.clamp(p * 0.5, 0, 1);   // 0.5 = hit plane
            const fx = (n.anim || n.track) ? this.tracks.combine(n.anim, n.track, lifeP) : null;

            if (fx && fx.definitePosition) {
                // full flight path defined by the map
                g.position.set(
                    fx.definitePosition[0] * UNIT,
                    fx.definitePosition[1] * UNIT,
                    HIT_Z - fx.definitePosition[2] * UNIT
                );
                g.rotation.set(0, 0, 0);
                if (ud.localRot) g.rotation.copy(ud.localRot);
                g.scale.setScalar(1);
            } else {
                // Noodle "time" property remaps the note's own life progress
                let z;
                if (fx && fx.time) {
                    z = HIT_Z - (0.5 - fx.time[0]) * 2 * ud.rt * ud.speed;
                } else {
                    z = this.noteZ(n.time, t, ud.speed);
                }
                g.position.set(ud.x, 0, z);
                const rise = THREE.MathUtils.clamp(p / 0.4, 0, 1);
                const easedRise = 1 - Math.pow(1 - rise, 3);
                g.position.y = THREE.MathUtils.lerp(ud.targetY - SPAWN_LEAD_Y, ud.targetY, easedRise);
                if (ud.localRot) {
                    g.rotation.copy(ud.localRot);
                    g.rotation.z += (1 - easedRise) * 0.8;
                } else {
                    g.rotation.set(0, 0, (1 - easedRise) * 0.8);
                }
                g.scale.setScalar(0.5 + easedRise * 0.5);
            }

            if (fx) this.applyNoodleFx(g, ud, fx);
            ud.fx = fx;
            g.getWorldPosition(ud.wp);
            // hit logic runs relative to the player rig, so AssignPlayerToTrack
            // camera movement never breaks the hittable window
            ud.rp.copy(ud.wp);
            this.playerRig.worldToLocal(ud.rp);
        }

        // pass 2: gentle aim assist pulls sabers toward the nearest matching note
        this.applyAimAssist();

        // pass 3: hits and misses (rig-relative positions — the player may have
        // been moved/rotated by AssignPlayerToTrack, and notes by tracks)
        for (let i = this.liveNotes.length - 1; i >= 0; i--) {
            const g = this.liveNotes[i];
            const ud = g.userData;
            const n = ud.note;
            const rz = ud.rp.z;
            const lifeOver = (t - n.time) / ud.rt;   // >1 = well past despawn

            if (ud.decorative) {                     // scenery: never hit, never punish
                if (lifeOver > 2.5 || (lifeOver > 1.2 && rz > HIT_Z + 2)) {
                    this.removeObj(g); this.liveNotes.splice(i, 1);
                }
                continue;
            }

            // animated interactable=false: temporarily unhittable, still no punish
            const uninteractableNow = ud.fx && ud.fx.interactable && ud.fx.interactable[0] < 0.5;

            if (!uninteractableNow && rz > HIT_Z - 1.0 && rz < HIT_Z + 1.0) {
                const saber = n.color === 0 ? this.saberLeft : this.saberRight;
                const wrongSaber = n.color === 0 ? this.saberRight : this.saberLeft;
                if (saber.distanceTo(ud.wp) < 0.6) {
                    this.hitNote(g, saber, i);
                    continue;
                }
                // wrong saber only counts against you on a deliberate fast swing
                if (wrongSaber.distanceTo(ud.wp) < 0.22 && wrongSaber.smoothVel.length() > 1.6) {
                    this.badCut(g, i);
                    continue;
                }
            }

            if (rz > HIT_Z + 1.3 || (t - n.time) > 0.45) this.miss(g, i);
        }
    }

    applyAimAssist() {
        if (this.aimAssist <= 0) return;
        for (const saber of [this.saberLeft, this.saberRight]) {
            const want = saber === this.saberLeft ? 0 : 1;
            let best = null, bestD = 1.1;
            for (const g of this.liveNotes) {
                const ud = g.userData;
                if (ud.decorative || ud.note.color !== want) continue;
                if (ud.rp.z < HIT_Z - 1.6 || ud.rp.z > HIT_Z + 1.0) continue;
                // sabers are rig children, so group.position is rig-space like rp
                const d = Math.hypot(ud.rp.x - saber.group.position.x, ud.rp.y - saber.group.position.y);
                if (d < bestD) { bestD = d; best = g; }
            }
            if (best) {
                const k = this.aimAssist * 0.45 * Math.max(0, 1 - bestD / 1.1);
                saber.group.position.x += (best.userData.rp.x - saber.group.position.x) * k;
                saber.group.position.y += (best.userData.rp.y - saber.group.position.y) * k;
            }
        }
    }

    hitNote(g, saber, idx) {
        const n = g.userData.note;
        const vel = saber.smoothVel;
        const speed = vel.length();

        // Friendly scoring: any contact scores; direction + a real flick earn the bonus
        let judgement = 'OK', points = 80;
        const dv = DIR_VECTORS[n.dir] || [0, 0];
        const dot = speed > 0.3 ? (vel.x * dv[0] + vel.y * dv[1]) / speed : 0;
        const dirOk = n.dir === 8 || n.chainLink || dot > 0.45;
        if (dirOk && speed > 1.1) { judgement = 'PERFECT'; points = 115; }
        else if (speed > 0.35) { judgement = 'GOOD'; points = 100; }

        this.score += points * this.multiplier;
        this.combo++;
        this.hits++;
        this.processed++;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        this.bumpMultiplier();
        this.energy = Math.min(1, this.energy + 0.009);

        audio.playHit(judgement === 'PERFECT' ? 1.0 : 0.85);
        gamepad.rumble(60, 0.5, 0.2);

        this.showJudgement(judgement);
        this.sliceEffect(g, saber);
        this.particles.push(new ParticleBurst(this.scene, g.userData.wp.clone(), g.userData.mat.color));
        this.removeObj(g);
        this.liveNotes.splice(idx, 1);
        this.updateHud(true);
    }

    badCut(g, idx) {
        this.combo = 0;
        this.multiplier = 1;
        this.multProgress = 0;
        this.processed++;
        this.misses++;
        this.addEnergy(-0.05);
        audio.playSfx('miss', 0.6);
        this.showJudgement('WRONG SABER', '#ff5a5a');
        this.removeObj(g);
        this.liveNotes.splice(idx, 1);
        this.updateHud();
    }

    miss(g, idx) {
        this.combo = 0;
        this.multiplier = 1;
        this.multProgress = 0;
        this.processed++;
        this.misses++;
        this.addEnergy(-0.07);
        audio.playSfx('miss', 0.55);
        this.showJudgement('MISS', '#ff5a5a');
        this.removeObj(g);
        this.liveNotes.splice(idx, 1);
        this.updateHud();
    }

    moveBombs(t) {
        for (let i = this.liveBombs.length - 1; i >= 0; i--) {
            const m = this.liveBombs[i];
            const ud = m.userData;
            const b = ud.bomb;
            const p = 1 - (b.time - t) / ud.rt;
            const lifeP = THREE.MathUtils.clamp(p * 0.5, 0, 1);
            const fx = (b.anim || b.track) ? this.tracks.combine(b.anim, b.track, lifeP) : null;

            if (fx && fx.definitePosition) {
                m.position.set(fx.definitePosition[0] * UNIT, fx.definitePosition[1] * UNIT, HIT_Z - fx.definitePosition[2] * UNIT);
            } else {
                m.position.set(ud.x, ud.targetY, this.noteZ(b.time, t, ud.speed));
            }
            m.rotation.x += 0.03; m.rotation.y += 0.05;
            m.scale.setScalar(1);
            if (fx) this.applyNoodleFx(m, ud, fx);
            m.getWorldPosition(ud.wp);
            ud.rp.copy(ud.wp);
            this.playerRig.worldToLocal(ud.rp);

            if (!ud.decorative && ud.rp.z > HIT_Z - 0.8 && ud.rp.z < HIT_Z + 0.8) {
                const touching = (s) => s.distanceTo(ud.wp) < 0.22 && s.smoothVel.length() > 0.6;
                if (touching(this.saberLeft) || touching(this.saberRight)) {
                    this.combo = 0;
                    this.multiplier = 1;
                    this.multProgress = 0;
                    this.addEnergy(-0.13);
                    audio.playSfx('miss', 0.9, 0.7);
                    gamepad.rumble(220, 1, 1);
                    this.showJudgement('BOMB!', '#ff2d2d');
                    this.particles.push(new ParticleBurst(this.scene, ud.wp.clone(), new THREE.Color(0xff3020), 26));
                    this.removeObj(m);
                    this.liveBombs.splice(i, 1);
                    this.updateHud();
                    continue;
                }
            }
            const bLifeOver = (t - b.time) / ud.rt;
            if (bLifeOver > 2.5 || (bLifeOver > 1.2 && ud.rp.z > HIT_Z + 1.4)) {
                this.removeObj(m);
                this.liveBombs.splice(i, 1);
            }
        }
    }

    moveWalls(t, dt) {
        for (let i = this.liveWalls.length - 1; i >= 0; i--) {
            const m = this.liveWalls[i];
            const ud = m.userData;
            const w = ud.wall;
            const life = ud.rt * 2 + w.duration;
            const lifeP = THREE.MathUtils.clamp((t - (w.time - ud.rt)) / life, 0, 1);
            const fx = (w.anim || w.track) ? this.tracks.combine(w.anim, w.track, lifeP) : null;

            const headZ = this.noteZ(w.time, t, ud.speed);
            if (fx && fx.definitePosition) {
                // NE anchors wall definitePosition at the front-bottom-left corner
                m.position.set(
                    fx.definitePosition[0] * UNIT + ud.width / 2,
                    fx.definitePosition[1] * UNIT + ud.height / 2,
                    HIT_Z - fx.definitePosition[2] * UNIT - ud.length / 2
                );
            } else {
                m.position.set(ud.x, ud.y, headZ - ud.length / 2);
            }
            m.scale.setScalar(1);
            if (fx) this.applyNoodleFx(m, ud, fx);

            // shader-wall uniforms: animated distortion + Noodle dissolve/color
            if (ud.mat.isShaderMaterial) {
                ud.mat.uniforms.uTime.value = this.engine.clockTime;
                const dis = fx && fx.dissolve !== undefined ? THREE.MathUtils.clamp(fx.dissolve[0], 0, 1) : 1;
                ud.mat.uniforms.uOpacity.value = dis;
                if (fx && fx.color) {
                    ud.mat.uniforms.uColor.value.setRGB(
                        Math.min(1, fx.color[0]), Math.min(1, fx.color[1]), Math.min(1, fx.color[2]));
                }
            }
            if (fx && fx.dissolve !== undefined && ud.edgeMat) {
                ud.edgeMat.opacity = THREE.MathUtils.clamp(fx.dissolve[0], 0, 1) * 0.7;
            }
            if (fx && fx.color && ud.edgeMat) {
                ud.edgeMat.color.setRGB(
                    Math.min(1, fx.color[0]), Math.min(1, fx.color[1]), Math.min(1, fx.color[2]));
            }
            m.getWorldPosition(ud.wp);

            // saber inside a real wall drains energy a bit (never for wall art)
            if (!ud.decorative) {
                const inside = (saber) => {
                    const p = saber.tipWorld();
                    return Math.abs(p.x - ud.wp.x) < m.geometry.parameters.width / 2 &&
                           Math.abs(p.y - ud.wp.y) < m.geometry.parameters.height / 2 &&
                           Math.abs(p.z - ud.wp.z) < ud.length / 2;
                };
                if (inside(this.saberLeft) || inside(this.saberRight)) {
                    this.addEnergy(-0.15 * dt);
                    gamepad.rumble(50, 0.3, 0.6);
                }
            }

            if (lifeP >= 1 && headZ - ud.length > HIT_Z + 3) {
                this.removeObj(m);
                this.liveWalls.splice(i, 1);
            }
        }
    }

    sliceEffect(g, saber) {
        const n = g.userData.note;
        const mat = g.userData.mat;
        const vel = saber.smoothVel.clone();
        if (vel.lengthSq() < 0.01) vel.set(0, -1);
        vel.normalize();
        const perp = new THREE.Vector2(-vel.y, vel.x);
        const self = this;

        class SliceHalf {
            constructor(offsetSign) {
                const geo = new THREE.BoxGeometry(0.46, 0.2, 0.46);
                this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
                    color: mat.color, emissive: mat.color, emissiveIntensity: 0.5,
                    transparent: true, opacity: 1, roughness: 0.35,
                }));
                this.mesh.position.copy(g.userData.wp).add(
                    new THREE.Vector3(perp.x * 0.12 * offsetSign, perp.y * 0.12 * offsetSign, 0)
                );
                this.mesh.rotation.z = Math.atan2(vel.y, vel.x);
                this.vel3 = new THREE.Vector3(
                    perp.x * 1.6 * offsetSign + vel.x * 1.4,
                    perp.y * 1.6 * offsetSign + vel.y * 1.4 + 1.2,
                    3.2
                );
                this.spin = (Math.random() - 0.5) * 9;
                this.age = 0; this.life = 0.6;
                self.scene.add(this.mesh);
            }
            update(dt) {
                this.age += dt;
                this.vel3.y -= 9 * dt;
                this.mesh.position.addScaledVector(this.vel3, dt);
                this.mesh.rotation.x += this.spin * dt;
                this.mesh.material.opacity = 1 - this.age / this.life;
                if (this.age >= this.life) { self.scene.remove(this.mesh); return false; }
                return true;
            }
        }
        this.slices.push(new SliceHalf(1), new SliceHalf(-1));
    }

    bumpMultiplier() {
        if (this.multiplier >= 8) return;
        this.multProgress++;
        const need = this.multiplier * 2;
        if (this.multProgress >= need) {
            this.multiplier *= 2;
            this.multProgress = 0;
        }
    }

    addEnergy(d) {
        this.energy = Math.max(0, Math.min(1, this.energy + d));
        if (this.energy <= 0 && !this.noFail && !this.failed) {
            this.failed = true;
            this.finish();
        }
    }

    showJudgement(text, color = '') {
        const el = this.$('hud-judgement');
        el.textContent = text;
        el.style.color = color || (text === 'PERFECT' ? '#ffd76a' : '#cfd6ff');
        el.classList.remove('show');
        void el.offsetWidth;
        el.classList.add('show');
    }

    get accuracy() {
        const max = idealScore(this.processed);
        return max > 0 ? this.score / max : 1;
    }

    get rank() {
        const a = this.accuracy;
        if (this.processed === 0) return '—';
        return a >= 0.9 ? 'SS' : a >= 0.8 ? 'S' : a >= 0.65 ? 'A' : a >= 0.5 ? 'B' : a >= 0.35 ? 'C' : 'D';
    }

    updateHud(comboPulse = false) {
        this.$('hud-score').textContent = this.score.toLocaleString();
        this.$('hud-acc').textContent = (this.accuracy * 100).toFixed(1) + '%';
        this.$('hud-rank').textContent = this.rank;
        this.$('hud-combo').textContent = this.combo;
        this.$('hud-mult').textContent = 'x' + this.multiplier;
        const need = this.multiplier >= 8 ? 1 : this.multiplier * 2;
        const frac = this.multiplier >= 8 ? 1 : this.multProgress / need;
        this.$('mult-ring-fg').style.strokeDashoffset = 163.4 * (1 - frac);
        const fill = this.$('hud-energy-fill');
        fill.style.height = (this.energy * 100) + '%';
        fill.classList.toggle('low', this.energy < 0.25);
        if (comboPulse) {
            const c = this.$('hud-combo');
            c.classList.remove('pulse'); void c.offsetWidth; c.classList.add('pulse');
        }
    }

    pause() {
        if (this.finished) return;
        this.paused = true;
        audio.pause();
    }

    resume() {
        this.paused = false;
        audio.resume();
    }

    restartWith() {  // used by menu to rebuild
        this.destroy();
    }

    finish() {
        if (this.finished) return;
        this.finished = true;
        audio.stopSong();
        const results = {
            score: this.score,
            accuracy: this.accuracy,
            rank: this.failed ? 'F' : this.rank,
            maxCombo: this.maxCombo,
            hits: this.hits,
            misses: this.misses,
            failed: this.failed,
            fullCombo: this.misses === 0 && this.processed > 0,
        };
        setTimeout(() => this.opts.onEnd(results), this.failed ? 300 : 600);
    }

    destroy() {
        audio.onSongEnd = null;
        audio.stopSong();
        for (const g of this.liveNotes) this.removeObj(g);
        for (const m of this.liveBombs) this.removeObj(m);
        for (const m of this.liveWalls) this.removeObj(m);
        for (const s of this.slices) if (s.mesh) this.scene.remove(s.mesh);
        for (const p of this.particles) this.scene.remove(p.points);
        for (const m of (this.envMeshes || [])) if (m.parent) m.parent.remove(m);
        this.envMeshes = [];
        this.saberLeft.dispose(this.scene);
        this.saberRight.dispose(this.scene);
        this.liveNotes = []; this.liveBombs = []; this.liveWalls = [];
        this.slices = []; this.particles = [];

        // restore camera from the player rig
        if (this.playerRig) {
            const cam = this.engine.camera;
            if (this._camHome.parent) this._camHome.parent.add(cam);
            else { this.playerRig.remove(cam); }
            cam.position.copy(this._camHome.pos);
            cam.quaternion.copy(this._camHome.quat);
            this.scene.remove(this.playerRig);
        }
        this.tracks.destroy();
    }
}
