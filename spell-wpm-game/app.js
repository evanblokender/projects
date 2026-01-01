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
const toggleMultiplayerBtn = document.getElementById('toggle-multiplayer');
const toggleTimedBtn = document.getElementById('toggle-timed');
const appContainer = document.getElementById('app');
const timedStat = document.getElementById('timed-stat');
const timedRemainingEl = document.getElementById('timed-remaining');

const submitWpmBtn = document.getElementById('submit-wpm-btn');
// multiplayer/room removed; keep single-player only
let multiplayer = false;
let room = null;

/* Settings elements */
const settingsToggle = document.getElementById('settings-toggle');
const settingsBody = document.getElementById('settings-body');
const volumeSlider = document.getElementById('volume-slider');
const bgSlider = document.getElementById('bg-slider');
const themeToggle = document.getElementById('theme-toggle');
const autoSubmitCheckbox = document.getElementById('auto-submit-checkbox');

let masterVolume = parseFloat(localStorage.getItem('masterVolume')) || 0.1;
let bgBrightness = parseFloat(localStorage.getItem('bgBrightness')) || 1;
let currentThemeLight = (localStorage.getItem('themeLight') === 'true') || false;

/* Apply initial UI values after DOM ready */
if (volumeSlider) volumeSlider.value = masterVolume;
if (bgSlider) bgSlider.value = bgBrightness;
if (themeToggle) themeToggle.textContent = currentThemeLight ? 'Dark' : 'Light';
if (currentThemeLight) document.documentElement.classList.add('light-theme');
document.documentElement.style.setProperty('--bg-brightness', bgBrightness);
document.body.style.backgroundColor = currentThemeLight ? 'var(--bg-light)' : 'var(--bg-color)';

let targetWord = "";
let startTime = null;
let isFinished = false;
let isSpellingBee = false;
let isWordCorrectionsOn = false;
let bestWpm = parseFloat(localStorage.getItem('bestWordWpm')) || 0;
const modes = ['Easy', 'Wet', 'Normal', 'Hard', 'Super Hard', 'Insane', 'Crazy', 'Master', 'Impossible'];
let currentModeIndex = 2; // Default to Normal (index shifted because Wet inserted)

// Auto-submit setting (persisted)
let autoSubmitScores = (localStorage.getItem('autoSubmitScores') === 'true') || false;
if (autoSubmitCheckbox) {
    autoSubmitCheckbox.checked = autoSubmitScores;
    autoSubmitCheckbox.addEventListener('change', (e) => {
        autoSubmitScores = !!e.target.checked;
        localStorage.setItem('autoSubmitScores', autoSubmitScores);
    });
}

// Auto-next setting (skip results overlay and start next word automatically)
const autoNextCheckbox = document.getElementById('auto-next-checkbox');
let autoNext = (localStorage.getItem('autoNext') === 'true') || false;
if (autoNextCheckbox) {
    autoNextCheckbox.checked = autoNext;
    autoNextCheckbox.addEventListener('change', (e) => {
        autoNext = !!e.target.checked;
        localStorage.setItem('autoNext', autoNext);
    });
}

// Timed mode progression
let timedMode = false;
let baseTimeMs = 3000; // base time per word length factor
let consecutiveSuccesses = 0;

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(freq, type = 'sine', duration = 0.1, volume = 0.1) {
    // use masterVolume multiplier
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    const adjusted = Math.max(0, Math.min(1, (volume || 0.1) * (masterVolume || 0.001)));
    gain.gain.setValueAtTime(adjusted, audioCtx.currentTime);
    // quick fade out
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + Math.max(0.02, duration));
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
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
    // Base per-mode timing (ms). We'll apply a dynamic speed-up multiplier
    // based on consecutiveSuccesses so the timer gets faster as you chain correct words.
    const mode = modes[currentModeIndex];
    let baseMs;
    switch (mode) {
        case 'Easy':
            baseMs = 8000; // 8s
            break;
        case 'Normal':
            baseMs = 9000; // 9s
            break;
        case 'Hard':
            baseMs = 11000; // 11s
            break;
        case 'Super Hard':
            baseMs = 13000; // 13s
            break;
        case 'Insane':
            baseMs = 15000; // 15s
            break;
        case 'Crazy':
            baseMs = 17000; // 17s
            break;
        case 'Master': {
            // Normal master difficulty words: 25s; very long (>50 letters) master words: 50s
            if (!word) {
                baseMs = 25000;
            } else {
                const len = word.length;
                baseMs = len > 50 ? 50000 : 25000;
            }
            break;
        }
        case 'Impossible': {
            // Default impossible timing remains 2.5 minutes, but extremely long impossible words (>400 chars) get 5 minutes
            if (word && word.length > 400) {
                baseMs = 300000; // 5 minutes
            } else {
                baseMs = 150000; // 2.5 minutes
            }
            break;
        }
        default:
            baseMs = 9000;
    }

    // If Spelling Bee mode is active, give 1.75x more base time
    if (isSpellingBee) {
        baseMs = Math.round(baseMs * 1.75);
    }

    // Dynamic speed-up:
    // Each consecutive success reduces allowed time by 5% (0.05) multiplicatively,
    // up to a floor of 40% of the base time (i.e., max 60% faster).
    // consecutiveSuccesses is maintained globally and synced in multiplayer.
    const perSuccessReduction = 0.05;
    const minMultiplier = 0.4;
    const multiplier = Math.max(minMultiplier, 1 - (consecutiveSuccesses * perSuccessReduction));
    return Math.round(baseMs * multiplier);
}

let timedTimer = null;
let timedInterval = null;

function startTimedCountdown() {
    if (!timedMode) return;
    // clear any existing timers
    if (timedTimer) clearTimeout(timedTimer);
    if (timedInterval) clearInterval(timedInterval);

    const totalMs = computeTimeForWord(targetWord);
    const endAt = performance.now() + totalMs;

    // show the UI stat
    if (timedStat) timedStat.style.display = 'flex';
    if (timedRemainingEl) timedRemainingEl.textContent = (totalMs / 1000).toFixed(2) + 's';

    // update visible countdown every 50ms
    timedInterval = setInterval(() => {
        const remaining = Math.max(0, endAt - performance.now());
        if (timedRemainingEl) timedRemainingEl.textContent = (remaining / 1000).toFixed(2) + 's';
    }, 50);

    timedTimer = setTimeout(() => {
        // ensure display shows 0
        if (timedRemainingEl) timedRemainingEl.textContent = '0.00s';
        // timed out - fail feedback
        playSound(120, 'sawtooth', 0.2, 0.08);
        inputField.value = "";
        updateFeedback();
        // cleanup
        stopTimedCountdown();
    }, totalMs);
}

function stopTimedCountdown() {
    if (timedTimer) {
        clearTimeout(timedTimer);
        timedTimer = null;
    }
    if (timedInterval) {
        clearInterval(timedInterval);
        timedInterval = null;
    }
    if (timedStat) timedStat.style.display = 'none';
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

    inputField.value = "";
    renderWord();
    inputField.focus();
    startTime = null;
    isFinished = false;
    wordDisplay.classList.remove('started');
    resultsOverlay.classList.add('hidden');
    bestWpmEl.textContent = Math.round(bestWpm);

    // start timed UI/timers
    stopTimedCountdown();
    if (timedMode) {
        startTimedCountdown();
    } else {
        // ensure timer stat hidden when not timed
        if (timedStat) timedStat.style.display = 'none';
    }
}

function renderWord() {
    wordDisplay.innerHTML = '';
    wordDisplay.style.fontSize = `3rem`;

    targetWord.split('').forEach((char, index) => {
        const span = document.createElement('span');
        if (isSpellingBee) {
            span.innerText = char === ' ' ? '\u00A0' : '_';
            span.classList.add('hidden-char');
        } else {
            span.innerText = char === ' ' ? '\u00A0' : char;
        }
        wordDisplay.appendChild(span);
    });
    updateFeedback();
}

function updateFeedback() {
    const spans = wordDisplay.querySelectorAll('span');
    const typed = inputField.value;
    
    let currentSpan = null;
    spans.forEach((span, i) => {
        span.classList.remove('correct', 'incorrect', 'current', 'hidden-char');

        if (i < typed.length) {
            const isCorrect = typed[i] === targetWord[i];

            // Show what the user actually typed for clarity. In Spelling Bee mode,
            // allow the correction toggle to reveal the true letter when incorrect.
            if (isSpellingBee) {
                if (!isCorrect && isWordCorrectionsOn) {
                    span.innerText = targetWord[i] === ' ' ? '\u00A0' : targetWord[i];
                } else {
                    span.innerText = typed[i] === ' ' ? '\u00A0' : typed[i];
                }
            } else {
                // Normal mode: display the typed character so users don't feel like their input was "reset"
                span.innerText = typed[i] === ' ' ? '\u00A0' : typed[i];
            }

            span.classList.add(isCorrect ? 'correct' : 'incorrect');
        } else {
            if (isSpellingBee) {
                span.innerText = targetWord[i] === ' ' ? '\u00A0' : '_';
                span.classList.add('hidden-char');
            } else {
                // show the upcoming target character for context when not typed yet
                span.innerText = targetWord[i] === ' ' ? '\u00A0' : targetWord[i];
            }

            if (i === typed.length) {
                span.classList.add('current');
                currentSpan = span;
            }
        }
    });

    if (currentSpan) {
        currentSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function calculateWpm(durationMs) {
    const minutes = durationMs / 1000 / 60;
    const wpm = (targetWord.length / 5) / minutes;
    return wpm;
}

function handleInput(e) {
    if (isFinished) return;
    if (inputField.disabled) return;

    if (!startTime && inputField.value.length > 0) {
        startTime = performance.now();
        wordDisplay.classList.add('started');
    }

    const typed = inputField.value;

    if (modes[currentModeIndex] === 'Insane') {
        for (let i = 0; i < typed.length; i++) {
            if (typed[i] !== targetWord[i]) {
                playSound(150, 'sawtooth', 0.2, 0.05);
                inputField.value = "";
                startTime = null;
                wordDisplay.classList.remove('started');
                updateFeedback();
                return;
            }
        }
    }

    updateFeedback();
    
    if (e.inputType !== 'deleteContentBackward') {
        playSound(440 + (typed.length * 20), 'square', 0.05, 0.02);
    }

    if (typed === targetWord) {
        finishGame();
    }
}

function finishGame() {
    isFinished = true;
    const endTime = performance.now();
    const duration = endTime - startTime;
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

    // multiplayer reporting
    // timed progression for single player
    consecutiveSuccesses++;

    // Auto-submit if setting enabled
    if (autoSubmitScores) {
        submitScoreToLeaderboard(wpm, false);
    }

    resultsOverlay.classList.remove('hidden');
    stopTimedCountdown();

    // If auto-next is enabled, automatically hide results and start the next word after a short delay.
    // Works for Spelling Bee and regular modes alike because it simply advances the game state.
    if (autoNext) {
        // give a small moment so the user perceives the result (1.2s)
        setTimeout(() => {
            resultsOverlay.classList.add('hidden');
            // start next word (preserve any custom behavior by calling initGame with no custom word)
            initGame();
        }, 1200);
    }
}

inputField.addEventListener('input', handleInput);

// Prevent copy/paste and dropping text into the typing field
if (inputField) {
    // block paste via context menu or keyboard
    inputField.addEventListener('paste', (e) => {
        e.preventDefault();
        // optional subtle feedback sound
        playSound(220, 'sine', 0.05, 0.05);
    });

    // block dropping text into the input
    inputField.addEventListener('drop', (e) => {
        e.preventDefault();
        playSound(220, 'sine', 0.05, 0.05);
    });

    // block Ctrl/Cmd+V and Shift+Insert paste keyboard shortcuts
    inputField.addEventListener('keydown', (e) => {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const pasteKey = (isMac && e.metaKey && e.key.toLowerCase() === 'v') ||
                         (!isMac && e.ctrlKey && e.key.toLowerCase() === 'v');
        const shiftInsert = e.shiftKey && e.key === 'Insert';
        if (pasteKey || shiftInsert) {
            e.preventDefault();
            playSound(220, 'sine', 0.05, 0.05);
        }
    });

    // optionally prevent context menu to discourage paste via right-click (keeps UX simple)
    inputField.addEventListener('contextmenu', (e) => {
        // allow context menu globally, but prevent it specifically on the typing input
        e.preventDefault();
    });
}

nextBtn.addEventListener('click', () => {
    initGame();
});

changeWordBtn.addEventListener('click', () => {
    initGame();
});

toggleSpellingBeeBtn.addEventListener('click', () => {
    isSpellingBee = !isSpellingBee;
    toggleSpellingBeeBtn.textContent = `Spelling Bee: ${isSpellingBee ? 'ON' : 'OFF'}`;
    
    if (isSpellingBee) {
        toggleCorrectionsBtn.classList.remove('hidden');
        revealWordBtn.classList.remove('hidden');
    } else {
        toggleCorrectionsBtn.classList.add('hidden');
        revealWordBtn.classList.add('hidden');
    }
    
    initGame(); 
});

toggleCorrectionsBtn.addEventListener('click', () => {
    isWordCorrectionsOn = !isWordCorrectionsOn;
    toggleCorrectionsBtn.textContent = `Corrections: ${isWordCorrectionsOn ? 'ON' : 'OFF'}`;
    updateFeedback();
});

replayAudioBtn.addEventListener('click', () => {
    speakWord(targetWord);
    inputField.focus();
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
    inputField.focus();
});

toggleDifficultyBtn.addEventListener('click', () => {
    appContainer.classList.remove('mode-easy', 'mode-hard', 'mode-super', 'mode-insane', 'mode-crazy', 'mode-long', 'mode-impossible');
    currentModeIndex = (currentModeIndex + 1) % modes.length;
    
    const modeName = modes[currentModeIndex];
    if (modeName === 'Easy') appContainer.classList.add('mode-easy');
    if (modeName === 'Hard') appContainer.classList.add('mode-hard');
    if (modeName === 'Super Hard') appContainer.classList.add('mode-super');
    if (modeName === 'Insane') appContainer.classList.add('mode-insane');
    if (modeName === 'Crazy') appContainer.classList.add('mode-crazy');
    if (modeName === 'Master') appContainer.classList.add('mode-long');
    if (modeName === 'Impossible') appContainer.classList.add('mode-impossible');
    
    toggleDifficultyBtn.textContent = `Mode: ${modeName}`;
    inputField.focus();
    
    initGame();
});

customWordBtn.addEventListener('click', () => {
    customOverlay.classList.remove('hidden');
    customWordInput.value = "";
    setTimeout(() => customWordInput.focus(), 100);
});

cancelCustomBtn.addEventListener('click', () => {
    customOverlay.classList.add('hidden');
    inputField.focus();
});

setCustomBtn.addEventListener('click', () => {
    const val = customWordInput.value.trim().toLowerCase();
    if (val.length > 0) {
        customOverlay.classList.add('hidden');
        initGame(val);
    }
});

customWordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        setCustomBtn.click();
    }
    if (e.key === 'Escape') {
        cancelCustomBtn.click();
    }
});

toggleMultiplayerBtn && toggleMultiplayerBtn.parentNode && toggleMultiplayerBtn.parentNode.removeChild(toggleMultiplayerBtn);

// Timed toggle
toggleTimedBtn.addEventListener('click', () => {
    timedMode = !timedMode;
    toggleTimedBtn.textContent = `Timed: ${timedMode ? 'ON' : 'OFF'}`;
    consecutiveSuccesses = 0;
    initGame();
});

// Restart on Enter in results
window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !resultsOverlay.classList.contains('hidden')) {
        if (multiplayer && room) {
            initGame(null, true);
        } else {
            initGame();
        }
    }
});

document.addEventListener('click', (e) => {
    if (resultsOverlay.classList.contains('hidden') && customOverlay.classList.contains('hidden')) {
        if (!inputField.disabled) inputField.focus();
    }
});

document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

// Initialize single-player by default
initGame();

/* Settings event wiring */

// toggle open/close with robust outside-click handling so the panel stays open while interacting with it
if (settingsToggle && settingsBody) {
    // prevent clicks inside the settings from bubbling and triggering global handlers
    settingsBody.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // open/close toggle — stop propagation so the following document listener won't immediately close it
    settingsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = settingsToggle.getAttribute('aria-expanded') === 'true';
        settingsToggle.setAttribute('aria-expanded', (!expanded).toString());
        settingsBody.hidden = !settingsBody.hidden;
    });

    // close settings when clicking anywhere outside the panel
    document.addEventListener('click', (e) => {
        const clickedInside = settingsBody.contains(e.target) || settingsToggle.contains(e.target);
        if (!clickedInside && settingsBody && !settingsBody.hidden) {
            settingsBody.hidden = true;
            settingsToggle.setAttribute('aria-expanded', 'false');
        }
    });
}

/* Developer-key protected panel
   - clicking "Dev" opens a modal prompting for a secret code
   - correct code reveals a dropdown and full wordlist output per mode
*/
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
    devModal.classList.remove('hidden');
    devModal.setAttribute('aria-hidden', 'false');
    devError.textContent = '';
    devCodeInput.value = '';
    devWordlists.hidden = true;
    devCodeInput.focus();
}

function closeDevModal() {
    devModal.classList.add('hidden');
    devModal.setAttribute('aria-hidden', 'true');
    devError.textContent = '';
    devWordlists.hidden = true;
}

devKeyBtn && devKeyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDevModal();
});

/* Leaderboard/room quick-open removed */

devCloseBtn && devCloseBtn.addEventListener('click', () => {
    closeDevModal();
});

// populate mode select
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
    const list = devLists[mode] || [];
    // present as one-per-line with minimal escaping
    devListOutput.textContent = list.join('\n');
    devWordlists.hidden = false;
}

devUnlockBtn && devUnlockBtn.addEventListener('click', () => {
    const val = (devCodeInput.value || '').trim();
    if (val === DEV_CODE) {
        devError.textContent = 'Access granted.';
        devError.style.color = 'var(--correct-color)';
        showWordListForMode(devModeSelect.value || 'Normal');
    } else if (val.toLowerCase() === 'william') {
        // Secret unlock: jump to Wet mode
        devError.textContent = 'Secret Wet mode activated.';
        devError.style.color = 'var(--accent-color)';
        // set current mode to Wet
        const wetIndex = modes.indexOf('Wet');
        if (wetIndex >= 0) {
            currentModeIndex = wetIndex;
            toggleDifficultyBtn.textContent = `Mode: Wet`;
            // apply any Wet-specific classes (none needed beyond default)
            initGame();
        }
        // Reveal the Wet wordlist in the Dev UI
        showWordListForMode('Wet');
    } else {
        devError.textContent = 'Incorrect code.';
        devError.style.color = 'var(--error-color)';
        devWordlists.hidden = true;
    }
});

// allow switching mode when unlocked
devModeSelect && devModeSelect.addEventListener('change', () => {
    if (devWordlists && !devWordlists.hidden) {
        showWordListForMode(devModeSelect.value);
    }
});

// Keep dev modal open while interacting and close it only when clicking outside the card.
// Stop propagation for clicks inside the modal card so outside handlers won't close it.
if (devModal) {
    const devCard = devModal.querySelector('.dev-card');
    if (devCard) {
        devCard.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    // Close modal when clicking outside the card (but allow the Dev button to toggle it)
    document.addEventListener('click', (e) => {
        if (!devModal.classList.contains('hidden')) {
            const clickedInsideModal = devCard && devCard.contains(e.target);
            const clickedDevBtn = devKeyBtn && devKeyBtn.contains(e.target);
            if (!clickedInsideModal && !clickedDevBtn) {
                closeDevModal();
            }
        }
    });

    // Also ensure that opening the modal focuses its input without being immediately closed by other click handlers
    devModal.addEventListener('click', (e) => {
        // if user clicks the backdrop, don't let other global handlers interfere (we handle outside clicks above)
        e.stopPropagation();
    });
}

// keyboard shortcuts: Esc closes modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && devModal && !devModal.classList.contains('hidden')) {
        closeDevModal();
    }
});

// volume control
if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
        masterVolume = parseFloat(e.target.value);
        localStorage.setItem('masterVolume', masterVolume);
    });
    // ensure slider reflects initial
    volumeSlider.value = masterVolume;
}

// background brightness control
if (bgSlider) {
    bgSlider.addEventListener('input', (e) => {
        bgBrightness = parseFloat(e.target.value);
        localStorage.setItem('bgBrightness', bgBrightness);
        document.documentElement.style.setProperty('--bg-brightness', bgBrightness);
        // subtle effect: blend page background between dark and light based on brightness
        document.body.style.opacity = 0.95 + (bgBrightness - 0.5) * 0.1;
    });
    bgSlider.value = bgBrightness;
}

 // theme toggle
if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        currentThemeLight = !currentThemeLight;
        localStorage.setItem('themeLight', currentThemeLight);
        if (currentThemeLight) {
            document.documentElement.classList.add('light-theme');
            document.body.style.backgroundColor = 'var(--bg-light)';
            themeToggle.textContent = 'Dark';
        } else {
            document.documentElement.classList.remove('light-theme');
            document.body.style.backgroundColor = 'var(--bg-color)';
            themeToggle.textContent = 'Light';
        }
    });
}

/* Leaderboard implementation (continued) */

function getCurrentModeName() {
    return modes[currentModeIndex];
}

function normalizeWordKey(word) {
    return (word || '').toLowerCase();
}

function fetchSharedLeaderboard() {
    if (!room || !room.roomState) return {};
    return room.roomState.leaderboard || {};
}

function updateSharedLeaderboard(newState) {
    if (!room) return;
    room.updateRoomState({
        leaderboard: {
            ...room.roomState.leaderboard,
            ...newState
        }
    });
}

function loadLocalLeaderboard() {
    try {
        return JSON.parse(localStorage.getItem('localLeaderboard') || '{}');
    } catch (e) {
        return {};
    }
}

function saveLocalLeaderboard(obj) {
    localStorage.setItem('localLeaderboard', JSON.stringify(obj || {}));
}

function pushLeaderboardEntry(modeName, word, entry) {
    // attach the original word to the entry so we can display the actual spelled word later
    const entryWithWord = { ...entry, word: word || '' };

    if (multiplayer && room) {
        // update room.roomState.leaderboard safely
        const lb = fetchSharedLeaderboard();
        const modeObj = lb[modeName] ? { ...lb[modeName] } : {};
        const wordKey = normalizeWordKey(word);
        const list = modeObj[wordKey] ? [...modeObj[wordKey]] : [];
        list.push(entryWithWord);
        // trim to last 200 entries for safety
        modeObj[wordKey] = list.slice(-200);
        updateSharedLeaderboard({ [modeName]: { ...(lb[modeName] || {}), [wordKey]: modeObj[wordKey] } });
    } else {
        const local = loadLocalLeaderboard();
        const modeObj = local[modeName] || {};
        const key = normalizeWordKey(word);
        const arr = modeObj[key] ? [...modeObj[key]] : [];
        arr.push(entryWithWord);
        modeObj[key] = arr.slice(-200);
        local[modeName] = modeObj;
        saveLocalLeaderboard(local);
    }
}

function renderLeaderboard(modeName = getCurrentModeName(), word = targetWord) {
    const key = normalizeWordKey(word || '');
    lbModeEl.textContent = modeName;

    let entries = [];
    if (multiplayer && room && room.roomState && room.roomState.leaderboard && room.roomState.leaderboard[modeName]) {
        entries = room.roomState.leaderboard[modeName][key] || [];
    } else {
        const local = loadLocalLeaderboard();
        entries = (local[modeName] && local[modeName][key]) || [];
    }

    if (!entries || entries.length === 0) {
        leaderboardOutput.textContent = 'No entries yet.';
        return;
    }

    // Sort descending by wpm, then timestamp
    const sorted = entries.slice().sort((a,b) => {
        if (b.wpm !== a.wpm) return b.wpm - a.wpm;
        return (b.ts || 0) - (a.ts || 0);
    });

    // create textual table (rank · wpm · user)
    const lines = sorted.map((e, i) => {
        const who = e.username || e.clientId || 'anon';
        const time = e.ts ? new Date(e.ts).toLocaleString() : '-';
        return `${i+1}. ${Math.round(e.wpm)} WPM — ${who} · ${time}`;
    });

    leaderboardOutput.textContent = lines.join('\n');
}



if (submitWpmBtn) {
    submitWpmBtn.addEventListener('click', async () => {
        // Submit button kept but no leaderboard; play confirmation and close overlay
        playSound(1200, 'triangle', 0.12, 0.06);
        resultsOverlay.classList.add('hidden');
    });
}

