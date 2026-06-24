import { getRandomWord, easyWords, normalWords, hardWords, superHardWords, insaneWords, crazyWords, longWords, impossibleWords } from './words.js';

const wordDisplay = document.getElementById('word-display');
const inputField = document.getElementById('type-input');
const lastWpmEl = document.getElementById('last-wpm');
const bestWpmEl = document.getElementById('best-wpm');
const resultsOverlay = document.getElementById('results-overlay');
const resWpmEl = document.getElementById('res-wpm');
const resTimeEl = document.getElementById('res-time');
const nextBtn = document.getElementById('next-btn');
const changeWordBtn = document.getElementById('change-word-btn');
const customWordBtn = document.getElementById('custom-word-btn');
const customOverlay = document.getElementById('custom-overlay');
const customWordInput = document.getElementById('custom-word-input');
const setCustomBtn = document.getElementById('set-custom-btn');
const cancelCustomBtn = document.getElementById('cancel-custom-btn');
const toggleDifficultyBtn = document.getElementById('toggle-difficulty');
const toggleSpellingBeeBtn = document.getElementById('toggle-spelling-bee');
const toggleCorrectionsBtn = document.getElementById('toggle-corrections');
const revealWordBtn = document.getElementById('reveal-word-btn');
const replayAudioBtn = document.getElementById('replay-audio-btn');
const toggleTimedBtn = document.getElementById('toggle-timed');
const appContainer = document.getElementById('app');
const timedStat = document.getElementById('timed-stat');
const timedRemainingEl = document.getElementById('timed-remaining');
const submitWpmBtn = document.getElementById('submit-wpm-btn');

const settingsToggle = document.getElementById('settings-toggle');
const settingsBody = document.getElementById('settings-body');
const volumeSlider = document.getElementById('volume-slider');
const bgSlider = document.getElementById('bg-slider');
const themeToggle = document.getElementById('theme-toggle');
const autoSubmitCheckbox = document.getElementById('auto-submit-checkbox');
const autoNextCheckbox = document.getElementById('auto-next-checkbox');

let masterVolume = parseFloat(localStorage.getItem('masterVolume') ?? '0.1');
let bgBrightness = parseFloat(localStorage.getItem('bgBrightness') ?? '1');
let currentThemeLight = localStorage.getItem('themeLight') === 'true';

if (volumeSlider) volumeSlider.value = masterVolume;
if (bgSlider) bgSlider.value = bgBrightness;
if (themeToggle) themeToggle.textContent = currentThemeLight ? 'Dark' : 'Light';
if (currentThemeLight) document.documentElement.classList.add('light-theme');
document.documentElement.style.setProperty('--bg-brightness', bgBrightness);
document.body.style.backgroundColor = currentThemeLight ? 'var(--bg-light)' : 'var(--bg-color)';

let targetWord = '';
let startTime = null;
let isFinished = false;
let isSpellingBee = false;
let isWordCorrectionsOn = false;
let bestWpm = parseFloat(localStorage.getItem('bestWordWpm') ?? '0');

const modes = ['Easy', 'Wet', 'Normal', 'Hard', 'Super Hard', 'Insane', 'Crazy', 'Master', 'Impossible'];
let currentModeIndex = 2;

let autoSubmitScores = localStorage.getItem('autoSubmitScores') === 'true';
if (autoSubmitCheckbox) {
    autoSubmitCheckbox.checked = autoSubmitScores;
    autoSubmitCheckbox.addEventListener('change', (e) => {
        autoSubmitScores = !!e.target.checked;
        localStorage.setItem('autoSubmitScores', autoSubmitScores);
    });
}

let autoNext = localStorage.getItem('autoNext') === 'true';
if (autoNextCheckbox) {
    autoNextCheckbox.checked = autoNext;
    autoNextCheckbox.addEventListener('change', (e) => {
        autoNext = !!e.target.checked;
        localStorage.setItem('autoNext', autoNext);
    });
}

let timedMode = false;
let consecutiveSuccesses = 0;

let audioCtx = null;

function getAudioCtx() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
}

function playSound(freq, type = 'sine', duration = 0.1, volume = 0.1) {
    if (masterVolume <= 0) return;
    try {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        const adjusted = Math.max(0, Math.min(1, volume * masterVolume));
        gain.gain.setValueAtTime(adjusted, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + Math.max(0.02, duration));
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch {}
}

function speakWord(word) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.rate = 0.8;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
}

function computeTimeForWord(word) {
    const mode = modes[currentModeIndex];
    let baseMs;
    switch (mode) {
        case 'Easy': baseMs = 8000; break;
        case 'Normal': baseMs = 9000; break;
        case 'Hard': baseMs = 11000; break;
        case 'Super Hard': baseMs = 13000; break;
        case 'Insane': baseMs = 15000; break;
        case 'Crazy': baseMs = 17000; break;
        case 'Master': baseMs = word && word.length > 50 ? 50000 : 25000; break;
        case 'Impossible': baseMs = word && word.length > 400 ? 300000 : 150000; break;
        default: baseMs = 9000;
    }
    if (isSpellingBee) baseMs = Math.round(baseMs * 1.75);
    const multiplier = Math.max(0.4, 1 - consecutiveSuccesses * 0.05);
    return Math.round(baseMs * multiplier);
}

let timedTimer = null;
let timedInterval = null;

function startTimedCountdown() {
    if (!timedMode) return;
    if (timedTimer) clearTimeout(timedTimer);
    if (timedInterval) clearInterval(timedInterval);

    const totalMs = computeTimeForWord(targetWord);
    const endAt = performance.now() + totalMs;

    if (timedStat) timedStat.style.display = 'flex';
    if (timedRemainingEl) timedRemainingEl.textContent = (totalMs / 1000).toFixed(2) + 's';

    timedInterval = setInterval(() => {
        const remaining = Math.max(0, endAt - performance.now());
        if (timedRemainingEl) timedRemainingEl.textContent = (remaining / 1000).toFixed(2) + 's';
    }, 50);

    timedTimer = setTimeout(() => {
        if (timedRemainingEl) timedRemainingEl.textContent = '0.00s';
        playSound(120, 'sawtooth', 0.2, 0.08);
        inputField.value = '';
        consecutiveSuccesses = 0;
        updateFeedback();
        stopTimedCountdown();
    }, totalMs);
}

function stopTimedCountdown() {
    if (timedTimer) { clearTimeout(timedTimer); timedTimer = null; }
    if (timedInterval) { clearInterval(timedInterval); timedInterval = null; }
    if (timedStat) timedStat.style.display = 'none';
}

function getFontSizeForWord(word) {
    const len = word.length;
    if (len <= 6) return '3.5rem';
    if (len <= 10) return '3rem';
    if (len <= 16) return '2.4rem';
    if (len <= 25) return '1.9rem';
    if (len <= 40) return '1.4rem';
    if (len <= 70) return '1.1rem';
    if (len <= 120) return '0.85rem';
    return '0.65rem';
}

function initGame(customWord = null) {
    const mode = modes[currentModeIndex];
    targetWord = customWord || getRandomWord(mode);

    if (isSpellingBee) {
        speakWord(targetWord);
        replayAudioBtn.classList.remove('hidden');
    } else {
        replayAudioBtn.classList.add('hidden');
    }

    inputField.value = '';
    renderWord();
    focusInput();
    startTime = null;
    isFinished = false;
    wordDisplay.classList.remove('started');
    resultsOverlay.classList.add('hidden');
    bestWpmEl.textContent = Math.round(bestWpm);

    stopTimedCountdown();
    if (timedMode) {
        startTimedCountdown();
    }
}

function focusInput() {
    inputField.focus({ preventScroll: true });
}

function renderWord() {
    wordDisplay.innerHTML = '';
    wordDisplay.style.fontSize = getFontSizeForWord(targetWord);

    const frag = document.createDocumentFragment();
    targetWord.split('').forEach((char) => {
        const span = document.createElement('span');
        if (isSpellingBee) {
            span.innerText = char === ' ' ? '\u00A0' : '_';
            span.classList.add('hidden-char');
        } else {
            span.innerText = char === ' ' ? '\u00A0' : char;
        }
        frag.appendChild(span);
    });
    wordDisplay.appendChild(frag);
    updateFeedback();
}

function updateFeedback() {
    const spans = wordDisplay.querySelectorAll('span');
    const typed = inputField.value;

    spans.forEach((span, i) => {
        span.classList.remove('correct', 'incorrect', 'current', 'hidden-char');

        if (i < typed.length) {
            const isCorrect = typed[i] === targetWord[i];
            if (isSpellingBee) {
                span.innerText = (!isCorrect && isWordCorrectionsOn)
                    ? (targetWord[i] === ' ' ? '\u00A0' : targetWord[i])
                    : (typed[i] === ' ' ? '\u00A0' : typed[i]);
            } else {
                span.innerText = typed[i] === ' ' ? '\u00A0' : typed[i];
            }
            span.classList.add(isCorrect ? 'correct' : 'incorrect');
        } else {
            if (isSpellingBee) {
                span.innerText = targetWord[i] === ' ' ? '\u00A0' : '_';
                span.classList.add('hidden-char');
            } else {
                span.innerText = targetWord[i] === ' ' ? '\u00A0' : targetWord[i];
            }
            if (i === typed.length) {
                span.classList.add('current');
                span.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    });
}

function calculateWpm(durationMs) {
    const minutes = durationMs / 1000 / 60;
    return (targetWord.length / 5) / minutes;
}

function handleInput(e) {
    if (isFinished || inputField.disabled) return;

    if (!startTime && inputField.value.length > 0) {
        startTime = performance.now();
        wordDisplay.classList.add('started');
    }

    const typed = inputField.value;

    if (modes[currentModeIndex] === 'Insane') {
        for (let i = 0; i < typed.length; i++) {
            if (typed[i] !== targetWord[i]) {
                playSound(150, 'sawtooth', 0.2, 0.05);
                inputField.value = '';
                startTime = null;
                wordDisplay.classList.remove('started');
                updateFeedback();
                return;
            }
        }
    }

    updateFeedback();

    if (e.inputType !== 'deleteContentBackward') {
        playSound(440 + typed.length * 20, 'square', 0.05, 0.02);
    }

    if (typed === targetWord) finishGame();
}

function finishGame() {
    isFinished = true;
    const duration = performance.now() - startTime;
    const wpm = calculateWpm(duration);

    playSound(880, 'sine', 0.2, 0.1);
    setTimeout(() => playSound(1320, 'sine', 0.3, 0.1), 100);

    lastWpmEl.textContent = Math.round(wpm);
    resWpmEl.textContent = Math.round(wpm);
    resTimeEl.textContent = (duration / 1000).toFixed(2) + 's';

    if (wpm > bestWpm) {
        bestWpm = wpm;
        localStorage.setItem('bestWordWpm', bestWpm);
        bestWpmEl.textContent = Math.round(bestWpm);
    }

    consecutiveSuccesses++;
    stopTimedCountdown();
    resultsOverlay.classList.remove('hidden');

    if (autoNext) {
        setTimeout(() => {
            resultsOverlay.classList.add('hidden');
            initGame();
        }, 1200);
    }
}

inputField.addEventListener('input', handleInput);

inputField.addEventListener('paste', (e) => {
    e.preventDefault();
    playSound(220, 'sine', 0.05, 0.05);
});

inputField.addEventListener('drop', (e) => {
    e.preventDefault();
    playSound(220, 'sine', 0.05, 0.05);
});

inputField.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const pasteKey = (isMac && e.metaKey && e.key.toLowerCase() === 'v') ||
                     (!isMac && e.ctrlKey && e.key.toLowerCase() === 'v');
    const shiftInsert = e.shiftKey && e.key === 'Insert';
    if (pasteKey || shiftInsert) {
        e.preventDefault();
        playSound(220, 'sine', 0.05, 0.05);
    }
});

inputField.addEventListener('contextmenu', (e) => e.preventDefault());

nextBtn.addEventListener('click', () => initGame());
changeWordBtn.addEventListener('click', () => initGame());

toggleSpellingBeeBtn.addEventListener('click', () => {
    isSpellingBee = !isSpellingBee;
    toggleSpellingBeeBtn.textContent = `Spelling Bee: ${isSpellingBee ? 'ON' : 'OFF'}`;
    toggleCorrectionsBtn.classList.toggle('hidden', !isSpellingBee);
    revealWordBtn.classList.toggle('hidden', !isSpellingBee);
    initGame();
});

toggleCorrectionsBtn.addEventListener('click', () => {
    isWordCorrectionsOn = !isWordCorrectionsOn;
    toggleCorrectionsBtn.textContent = `Corrections: ${isWordCorrectionsOn ? 'ON' : 'OFF'}`;
    updateFeedback();
});

replayAudioBtn.addEventListener('click', () => {
    speakWord(targetWord);
    focusInput();
});

revealWordBtn.addEventListener('click', () => {
    if (!isSpellingBee) return;
    const spans = wordDisplay.querySelectorAll('span');
    spans.forEach((span, i) => {
        span.innerText = targetWord[i] === ' ' ? '\u00A0' : targetWord[i];
        span.classList.remove('hidden-char', 'current', 'incorrect');
        span.classList.add('correct');
    });
    revealWordBtn.classList.add('hidden');
    focusInput();
});

const modeClassMap = {
    'Easy': 'mode-easy',
    'Hard': 'mode-hard',
    'Super Hard': 'mode-super',
    'Insane': 'mode-insane',
    'Crazy': 'mode-crazy',
    'Master': 'mode-long',
    'Impossible': 'mode-impossible',
};

toggleDifficultyBtn.addEventListener('click', () => {
    Object.values(modeClassMap).forEach(c => appContainer.classList.remove(c));
    currentModeIndex = (currentModeIndex + 1) % modes.length;
    const modeName = modes[currentModeIndex];
    if (modeClassMap[modeName]) appContainer.classList.add(modeClassMap[modeName]);
    toggleDifficultyBtn.textContent = `Mode: ${modeName}`;
    focusInput();
    initGame();
});

customWordBtn.addEventListener('click', () => {
    customOverlay.classList.remove('hidden');
    customWordInput.value = '';
    setTimeout(() => customWordInput.focus(), 100);
});

cancelCustomBtn.addEventListener('click', () => {
    customOverlay.classList.add('hidden');
    focusInput();
});

setCustomBtn.addEventListener('click', () => {
    const val = customWordInput.value.trim().toLowerCase();
    if (val.length > 0) {
        customOverlay.classList.add('hidden');
        initGame(val);
    }
});

customWordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') setCustomBtn.click();
    if (e.key === 'Escape') cancelCustomBtn.click();
});

toggleTimedBtn.addEventListener('click', () => {
    timedMode = !timedMode;
    toggleTimedBtn.textContent = `Timed: ${timedMode ? 'ON' : 'OFF'}`;
    consecutiveSuccesses = 0;
    initGame();
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !resultsOverlay.classList.contains('hidden')) {
        initGame();
    }
});

document.addEventListener('click', (e) => {
    if (resultsOverlay.classList.contains('hidden') && customOverlay.classList.contains('hidden')) {
        const inSettings = settingsBody && (settingsBody.contains(e.target) || settingsToggle.contains(e.target));
        if (!inSettings && !inputField.disabled) focusInput();
    }
});

document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !isFinished) focusInput();
});

if (settingsToggle && settingsBody) {
    settingsBody.addEventListener('click', (e) => e.stopPropagation());

    settingsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = settingsToggle.getAttribute('aria-expanded') === 'true';
        settingsToggle.setAttribute('aria-expanded', (!expanded).toString());
        settingsBody.hidden = !settingsBody.hidden;
    });

    document.addEventListener('click', (e) => {
        const clickedInside = settingsBody.contains(e.target) || settingsToggle.contains(e.target);
        if (!clickedInside && !settingsBody.hidden) {
            settingsBody.hidden = true;
            settingsToggle.setAttribute('aria-expanded', 'false');
        }
    });
}

if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
        masterVolume = parseFloat(e.target.value);
        localStorage.setItem('masterVolume', masterVolume);
    });
    volumeSlider.value = masterVolume;
}

if (bgSlider) {
    bgSlider.addEventListener('input', (e) => {
        bgBrightness = parseFloat(e.target.value);
        localStorage.setItem('bgBrightness', bgBrightness);
        document.documentElement.style.setProperty('--bg-brightness', bgBrightness);
        document.body.style.opacity = 0.95 + (bgBrightness - 0.5) * 0.1;
    });
    bgSlider.value = bgBrightness;
}

if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        currentThemeLight = !currentThemeLight;
        localStorage.setItem('themeLight', currentThemeLight);
        document.documentElement.classList.toggle('light-theme', currentThemeLight);
        document.body.style.backgroundColor = currentThemeLight ? 'var(--bg-light)' : 'var(--bg-color)';
        themeToggle.textContent = currentThemeLight ? 'Dark' : 'Light';
    });
}

if (submitWpmBtn) {
    submitWpmBtn.addEventListener('click', () => {
        playSound(1200, 'triangle', 0.12, 0.06);
        resultsOverlay.classList.add('hidden');
    });
}

const DEV_CODE = 'INEEDSPELLBEEANSWERINEEDNOW!!';
const devKeyBtn = document.getElementById('dev-key-btn');
const devModal = document.getElementById('dev-modal');
const devCloseBtn = document.getElementById('dev-close-btn');
const devUnlockBtn = document.getElementById('dev-unlock-btn');
const devCodeInput = document.getElementById('dev-code-input');
const devError = document.getElementById('dev-error');
const devWordlists = document.getElementById('dev-wordlists');
const devModeSelect = document.getElementById('dev-mode-select');
const devListOutput = document.getElementById('dev-list-output');

const devLists = {
    'Easy': easyWords,
    'Wet': ['wet'],
    'Normal': normalWords,
    'Hard': hardWords,
    'Super Hard': superHardWords,
    'Insane': insaneWords,
    'Crazy': crazyWords,
    'Master': longWords,
    'Impossible': impossibleWords
};

function openDevModal() {
    if (!devModal) return;
    devModal.classList.remove('hidden');
    devModal.setAttribute('aria-hidden', 'false');
    if (devError) devError.textContent = '';
    if (devCodeInput) devCodeInput.value = '';
    if (devWordlists) devWordlists.hidden = true;
    if (devCodeInput) devCodeInput.focus();
}

function closeDevModal() {
    if (!devModal) return;
    devModal.classList.add('hidden');
    devModal.setAttribute('aria-hidden', 'true');
    if (devError) devError.textContent = '';
    if (devWordlists) devWordlists.hidden = true;
}

devKeyBtn && devKeyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDevModal();
});

devCloseBtn && devCloseBtn.addEventListener('click', () => closeDevModal());

(function populateDevModes() {
    if (!devModeSelect) return;
    Object.keys(devLists).forEach(mode => {
        const opt = document.createElement('option');
        opt.value = mode;
        opt.textContent = mode;
        devModeSelect.appendChild(opt);
    });
})();

function showWordListForMode(mode) {
    if (!devListOutput || !devWordlists) return;
    devListOutput.textContent = (devLists[mode] || []).join('\n');
    devWordlists.hidden = false;
}

devUnlockBtn && devUnlockBtn.addEventListener('click', () => {
    const val = (devCodeInput.value || '').trim();
    if (val === DEV_CODE) {
        devError.textContent = 'Access granted.';
        devError.style.color = 'var(--correct-color)';
        showWordListForMode(devModeSelect.value || 'Normal');
    } else if (val.toLowerCase() === 'william') {
        devError.textContent = 'Secret Wet mode activated.';
        devError.style.color = 'var(--accent-color)';
        const wetIndex = modes.indexOf('Wet');
        if (wetIndex >= 0) {
            currentModeIndex = wetIndex;
            toggleDifficultyBtn.textContent = 'Mode: Wet';
            initGame();
        }
        showWordListForMode('Wet');
    } else {
        devError.textContent = 'Incorrect code.';
        devError.style.color = 'var(--error-color)';
        if (devWordlists) devWordlists.hidden = true;
    }
});

devModeSelect && devModeSelect.addEventListener('change', () => {
    if (devWordlists && !devWordlists.hidden) showWordListForMode(devModeSelect.value);
});

if (devModal) {
    const devCard = devModal.querySelector('.dev-card');
    if (devCard) devCard.addEventListener('click', (e) => e.stopPropagation());

    document.addEventListener('click', (e) => {
        if (!devModal.classList.contains('hidden')) {
            const clickedInsideModal = devCard && devCard.contains(e.target);
            const clickedDevBtn = devKeyBtn && devKeyBtn.contains(e.target);
            if (!clickedInsideModal && !clickedDevBtn) closeDevModal();
        }
    });

    devModal.addEventListener('click', (e) => e.stopPropagation());
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && devModal && !devModal.classList.contains('hidden')) closeDevModal();
});

initGame();
