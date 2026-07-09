// ============ SABER//3D bootstrap ============
import { Engine } from './game.js';
import { Menu } from './menu.js';
import { audio } from './audio.js';
import { gamepad, cursor, Buttons } from './input.js';
import { settings } from './settings.js';

const engine = new Engine(document.getElementById('game-container'));
engine.setBloom(settings.get('bloom'));
engine.setBloomStrength(settings.get('bloomStrength'));
const menu = new Menu(engine);

// Audio context needs a user gesture; also load SFX lazily on first interaction
let audioReady = false;
function ensureAudio() {
    if (audioReady) return;
    audioReady = true;
    audio.init();
    audio.setVolumes(settings.get('musicVolume'), settings.get('sfxVolume'));
    audio.loadSfx('hit', 'hitsound.mp3');
    audio.loadSfx('miss', 'misssound.mp3');
}
window.addEventListener('pointerdown', ensureAudio, { once: false });
window.addEventListener('keydown', ensureAudio, { once: false });

menu.showHome();

let lastTime = performance.now();
function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    // Engine polls the gamepad inside gameplay; cursor polls it in menus.
    if (menu.gameplay && !menu.gameplay.paused && !menu.gameplay.finished) {
        gamepad.poll();
        if (gamepad.justPressed(Buttons.START)) {
            menu.pauseGame();
        }
        ensureAudioFromGamepad();
    } else {
        cursor.update(dt);
        if (menu.gameplay && menu.gameplay.paused && gamepad.justPressed(Buttons.START)) {
            menu.resumeGame();
        }
        if (gamepad.connected) ensureAudioFromGamepad();
    }

    engine.update();
}

// Gamepad button also counts as the user gesture for audio (browsers allow this
// only after some page interaction; harmless to try)
function ensureAudioFromGamepad() {
    if (!audioReady && gamepad.curr.some(Boolean)) ensureAudio();
}

loop();
