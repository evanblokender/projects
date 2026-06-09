import { getRandomWord } from "./words.js";

const $ = (id) => document.getElementById(id);
const elements = {
    soloView: $("solo-view"),
    arenaView: $("arena-view"),
    soloNav: $("solo-nav"),
    arenaNav: $("arena-nav"),
    brandHome: $("brand-home"),
    accountBtn: $("account-btn"),
    accountChip: $("account-chip"),
    accountName: $("account-name"),
    accountAvatar: $("account-avatar"),
    logoutBtn: $("logout-btn"),
    settingsToggle: $("settings-toggle"),
    settingsPanel: $("settings-panel"),
    settingsClose: $("settings-close"),
    volumeSlider: $("volume-slider"),
    autoNextCheckbox: $("auto-next-checkbox"),
    contrastCheckbox: $("contrast-checkbox"),
    apiUrlInput: $("api-url-input"),
    saveApiBtn: $("save-api-btn"),
    serverStatus: $("server-status"),
    wordDisplay: $("word-display"),
    typeInput: $("type-input"),
    difficultyBtn: $("difficulty-btn"),
    timedBtn: $("timed-btn"),
    beeBtn: $("bee-btn"),
    randomBtn: $("random-btn"),
    replayAudioBtn: $("replay-audio-btn"),
    timerWrap: $("timer-wrap"),
    timerBar: $("timer-bar"),
    roundKicker: $("round-kicker"),
    lastWpm: $("last-wpm"),
    bestWpm: $("best-wpm"),
    streakValue: $("streak-value"),
    challengeCount: $("challenge-count"),
    challengeLabel: $("challenge-label"),
    challengeBar: $("challenge-bar"),
    customWordBtn: $("custom-word-btn"),
    customModal: $("custom-modal"),
    customWordInput: $("custom-word-input"),
    setCustomBtn: $("set-custom-btn"),
    resultsModal: $("results-modal"),
    resultTitle: $("result-title"),
    resultWpm: $("result-wpm"),
    resultTime: $("result-time"),
    nextBtn: $("next-btn"),
    authModal: $("auth-modal"),
    authTitle: $("auth-title"),
    authSubtitle: $("auth-subtitle"),
    authForm: $("auth-form"),
    authUsername: $("auth-username"),
    authPassword: $("auth-password"),
    authSubmit: $("auth-submit"),
    authSwitch: $("auth-switch"),
    authError: $("auth-error"),
    quickPlayBtn: $("quick-play-btn"),
    refreshRoomsBtn: $("refresh-rooms-btn"),
    roomList: $("room-list"),
    roomNameInput: $("room-name-input"),
    roomModeSelect: $("room-mode-select"),
    privateRoomCheckbox: $("private-room-checkbox"),
    createRoomBtn: $("create-room-btn"),
    joinCodeInput: $("join-code-input"),
    joinCodeBtn: $("join-code-btn"),
    arenaHome: $("arena-home"),
    roomView: $("room-view"),
    leaveRoomBtn: $("leave-room-btn"),
    roomPrivacy: $("room-privacy"),
    activeRoomName: $("active-room-name"),
    inviteCodeWrap: $("invite-code-wrap"),
    copyCodeBtn: $("copy-code-btn"),
    startMatchBtn: $("start-match-btn"),
    lobbyState: $("lobby-state"),
    lobbyPlayerList: $("lobby-player-list"),
    lobbyMessage: $("lobby-message"),
    matchState: $("match-state"),
    matchPosition: $("match-position"),
    matchClock: $("match-clock"),
    matchProgress: $("match-progress"),
    matchWord: $("match-word"),
    matchInput: $("match-input"),
    matchFeedback: $("match-feedback"),
    standingsList: $("standings-list"),
    toast: $("toast")
};

const modes = ["Easy", "Wet", "Normal", "Hard", "Super Hard", "Insane", "Crazy", "Master", "Impossible"];
const state = {
    modeIndex: 2,
    word: "",
    startedAt: 0,
    finished: false,
    timed: false,
    spellingBee: false,
    timerId: null,
    timerFrame: null,
    streak: 0,
    cleanChallenge: Number(localStorage.getItem("cleanChallenge") || 0),
    bestWpm: Number(localStorage.getItem("bestWordWpm") || 0),
    volume: Number(localStorage.getItem("masterVolume") || 0.12),
    autoNext: localStorage.getItem("autoNext") === "true",
    apiUrl: normalizeApiUrl(localStorage.getItem("spellrushApiUrl") || "https://type-backend-production-509b.up.railway.app"),
    token: localStorage.getItem("spellrushToken") || "",
    user: readJson("spellrushUser"),
    authMode: "login",
    socket: null,
    room: null,
    match: null,
    matchWord: "",
    matchStartedAt: 0,
    matchClockId: null
};

let audioContext;
let toastTimer;

function readJson(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
        return null;
    }
}

function normalizeApiUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
}

function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2600);
}

function showModal(element) {
    element.classList.remove("hidden");
}

function hideModal(element) {
    element.classList.add("hidden");
}

function setView(name) {
    const arena = name === "arena";
    elements.soloView.classList.toggle("active", !arena);
    elements.arenaView.classList.toggle("active", arena);
    elements.soloNav.classList.toggle("active", !arena);
    elements.arenaNav.classList.toggle("active", arena);
    if (arena) {
        ensureMultiplayerReady();
    } else {
        setTimeout(() => elements.typeInput.focus(), 30);
    }
}

function getAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

function playSound(frequency, type = "sine", duration = 0.08, volume = 0.08) {
    if (state.volume <= 0) {
        return;
    }
    const context = getAudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    gain.gain.setValueAtTime(Math.max(0.001, volume * state.volume));
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
}

function speakWord(word) {
    if (!window.speechSynthesis) {
        return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.rate = 0.78;
    window.speechSynthesis.speak(utterance);
}

function getTimeLimit() {
    const limits = [7500, 5000, 9000, 10500, 12500, 14500, 16500, 26000, 150000];
    return limits[state.modeIndex];
}

function renderCharacters(container, word, typed, hiddenWord = false) {
    container.replaceChildren();
    [...word].forEach((character, index) => {
        const span = document.createElement("span");
        const entered = typed[index];
        const visibleCharacter = character === " " ? "\u00a0" : character;
        if (index < typed.length) {
            span.textContent = entered === " " ? "\u00a0" : entered;
            span.className = entered === character ? "correct" : "incorrect";
        } else {
            span.textContent = hiddenWord ? "_" : visibleCharacter;
            if (hiddenWord) {
                span.classList.add("hidden-char");
            }
            if (index === typed.length) {
                span.classList.add("current");
            }
        }
        container.appendChild(span);
    });
}

function updateChallenge() {
    const count = Math.min(10, state.cleanChallenge);
    const percent = count * 10;
    elements.challengeCount.textContent = count;
    elements.challengeLabel.textContent = `${percent}%`;
    elements.challengeBar.style.width = `${percent}%`;
}

function stopSoloTimer() {
    clearTimeout(state.timerId);
    cancelAnimationFrame(state.timerFrame);
    state.timerId = null;
    state.timerFrame = null;
    elements.timerWrap.classList.add("hidden");
}

function startSoloTimer() {
    stopSoloTimer();
    if (!state.timed) {
        return;
    }
    const duration = getTimeLimit();
    const endsAt = performance.now() + duration;
    elements.timerWrap.classList.remove("hidden");
    const update = () => {
        const ratio = Math.max(0, (endsAt - performance.now()) / duration);
        elements.timerBar.style.transform = `scaleX(${ratio})`;
        elements.timerBar.style.background = ratio < 0.25 ? "var(--danger)" : "var(--primary)";
        if (ratio > 0) {
            state.timerFrame = requestAnimationFrame(update);
        }
    };
    update();
    state.timerId = setTimeout(() => {
        state.streak = 0;
        state.cleanChallenge = 0;
        localStorage.setItem("cleanChallenge", "0");
        elements.streakValue.textContent = "0";
        updateChallenge();
        playSound(130, "sawtooth", 0.22);
        showToast("Time expired. Streak reset.");
        initSolo();
    }, duration);
}

function initSolo(customWord = "") {
    stopSoloTimer();
    state.word = customWord || getRandomWord(modes[state.modeIndex]);
    state.startedAt = 0;
    state.finished = false;
    elements.typeInput.value = "";
    elements.typeInput.disabled = false;
    elements.typeInput.readOnly = false;
    elements.roundKicker.textContent = customWord ? "Custom practice" : `${modes[state.modeIndex]} difficulty`;
    renderCharacters(elements.wordDisplay, state.word, "", state.spellingBee);
    elements.replayAudioBtn.classList.toggle("hidden", !state.spellingBee);
    if (state.spellingBee) {
        speakWord(state.word);
    }
    startSoloTimer();
    setTimeout(() => elements.typeInput.focus(), 20);
}

function advanceSolo() {
    hideModal(elements.resultsModal);
    initSolo();
}

function calculateWpm(word, duration) {
    return (word.length / 5) / (duration / 60000);
}

function finishSolo() {
    if (state.finished) {
        return;
    }
    state.finished = true;
    elements.typeInput.readOnly = true;
    stopSoloTimer();
    const duration = Math.max(80, performance.now() - state.startedAt);
    const wpm = calculateWpm(state.word, duration);
    state.streak += 1;
    state.cleanChallenge = Math.min(10, state.cleanChallenge + 1);
    localStorage.setItem("cleanChallenge", String(state.cleanChallenge));
    elements.lastWpm.textContent = Math.round(wpm);
    elements.streakValue.textContent = state.streak;
    if (wpm > state.bestWpm) {
        state.bestWpm = wpm;
        localStorage.setItem("bestWordWpm", String(wpm));
        elements.bestWpm.textContent = Math.round(wpm);
    }
    updateChallenge();
    elements.resultWpm.textContent = Math.round(wpm);
    elements.resultTime.textContent = `Finished in ${(duration / 1000).toFixed(2)} seconds`;
    elements.resultTitle.textContent = state.streak >= 5 ? `${state.streak} word streak` : "Clean finish";
    playSound(880, "sine", 0.18, 0.12);
    setTimeout(() => playSound(1320, "sine", 0.22, 0.08), 90);
    showToast(`Word completed | ${Math.round(wpm)} WPM`);
    if (state.autoNext) {
        setTimeout(initSolo, 650);
    } else {
        showModal(elements.resultsModal);
    }
}

function verifySoloCompletion() {
    if (!state.finished && elements.typeInput.value === state.word) {
        finishSolo();
    }
}

function handleSoloInput(event) {
    if (state.finished) {
        return;
    }
    if (!state.startedAt && elements.typeInput.value) {
        state.startedAt = performance.now();
    }
    const typed = elements.typeInput.value;
    const hasError = [...typed].some((character, index) => character !== state.word[index]);
    if (hasError && modes[state.modeIndex] === "Insane") {
        elements.typeInput.value = "";
        state.startedAt = 0;
        state.streak = 0;
        elements.streakValue.textContent = "0";
        playSound(130, "sawtooth", 0.16);
    }
    renderCharacters(elements.wordDisplay, state.word, elements.typeInput.value, state.spellingBee);
    if (event.inputType !== "deleteContentBackward") {
        playSound(390 + Math.min(300, elements.typeInput.value.length * 14), "square", 0.035, 0.035);
    }
    verifySoloCompletion();
    queueMicrotask(verifySoloCompletion);
}

function updateAccountUi() {
    const loggedIn = Boolean(state.user && state.token);
    elements.accountBtn.classList.toggle("hidden", loggedIn);
    elements.accountChip.classList.toggle("hidden", !loggedIn);
    if (loggedIn) {
        elements.accountName.textContent = state.user.username;
        elements.accountAvatar.textContent = state.user.username.charAt(0).toUpperCase();
    }
}

function openAuth(mode = "login") {
    state.authMode = mode;
    const register = mode === "register";
    elements.authTitle.textContent = register ? "Create your racer" : "Welcome back";
    elements.authSubtitle.textContent = register
        ? "Use 3–18 letters, numbers, or underscores. Passwords need at least 8 characters."
        : "Sign in to join live races and keep your wins.";
    elements.authSubmit.textContent = register ? "Create account" : "Sign in";
    elements.authSwitch.textContent = register ? "Already registered? Sign in" : "New here? Create an account";
    elements.authPassword.autocomplete = register ? "new-password" : "current-password";
    elements.authError.textContent = "";
    showModal(elements.authModal);
    setTimeout(() => elements.authUsername.focus(), 20);
}

async function api(path, options = {}) {
    if (!state.apiUrl) {
        throw new Error("Add your Railway API URL in settings first.");
    }
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (state.token) {
        headers.Authorization = `Bearer ${state.token}`;
    }
    const response = await fetch(`${state.apiUrl}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401 && state.token) {
            logout(false);
        }
        throw new Error(payload.error || "The server could not complete that request.");
    }
    return payload;
}

async function submitAuth(event) {
    event.preventDefault();
    elements.authError.textContent = "";
    elements.authSubmit.disabled = true;
    try {
        const payload = await api(`/api/auth/${state.authMode}`, {
            method: "POST",
            body: JSON.stringify({
                username: elements.authUsername.value.trim(),
                password: elements.authPassword.value
            })
        });
        state.token = payload.token;
        state.user = payload.user;
        localStorage.setItem("spellrushToken", state.token);
        localStorage.setItem("spellrushUser", JSON.stringify(state.user));
        updateAccountUi();
        hideModal(elements.authModal);
        connectSocket();
        showToast(`Signed in as ${state.user.username}`);
        loadRooms();
    } catch (error) {
        elements.authError.textContent = error.message;
    } finally {
        elements.authSubmit.disabled = false;
    }
}

function logout(notify = true) {
    state.socket?.disconnect();
    state.socket = null;
    state.room = null;
    state.match = null;
    state.token = "";
    state.user = null;
    localStorage.removeItem("spellrushToken");
    localStorage.removeItem("spellrushUser");
    updateAccountUi();
    showArenaHome();
    if (notify) {
        showToast("Signed out.");
    }
}

async function checkServer() {
    elements.serverStatus.className = "server-status";
    elements.serverStatus.textContent = "Checking connection…";
    try {
        const response = await fetch(`${state.apiUrl}/health`);
        if (!response.ok) {
            throw new Error();
        }
        elements.serverStatus.classList.add("online");
        elements.serverStatus.textContent = "Connected to SpellRush server";
        return true;
    } catch {
        elements.serverStatus.textContent = "Server unavailable";
        return false;
    }
}

function ensureMultiplayerReady() {
    checkServer();
    if (!state.user) {
        elements.roomList.innerHTML = '<div class="empty-state">Sign in to browse and join live rooms.</div>';
        return;
    }
    connectSocket();
    loadRooms();
}

function connectSocket() {
    if (!state.token || !window.io || state.socket?.connected) {
        return;
    }
    state.socket?.disconnect();
    state.socket = window.io(state.apiUrl, {
        auth: { token: state.token },
        transports: ["websocket", "polling"]
    });
    state.socket.on("connect", () => {
        elements.serverStatus.classList.add("online");
        elements.serverStatus.textContent = "Connected to SpellRush server";
    });
    state.socket.on("connect_error", (error) => {
        elements.serverStatus.classList.remove("online");
        elements.serverStatus.textContent = "Realtime connection failed";
        if (error.message === "Unauthorized") {
            logout(false);
            openAuth();
        }
    });
    state.socket.on("rooms:update", renderRooms);
    state.socket.on("room:state", receiveRoomState);
    state.socket.on("room:left", showArenaHome);
    state.socket.on("match:started", startMatch);
    state.socket.on("match:word", receiveMatchWord);
    state.socket.on("match:standings", renderStandings);
    state.socket.on("match:ended", endMatch);
    state.socket.on("error:message", (message) => showToast(message));
}

async function loadRooms() {
    if (!state.user) {
        return;
    }
    try {
        const payload = await api("/api/rooms");
        renderRooms(payload.rooms);
    } catch (error) {
        elements.roomList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
}

function escapeHtml(value) {
    const node = document.createElement("div");
    node.textContent = value;
    return node.innerHTML;
}

function renderRooms(rooms = []) {
    if (!rooms.length) {
        elements.roomList.innerHTML = '<div class="empty-state">No public rooms yet. Start the first race.</div>';
        return;
    }
    elements.roomList.innerHTML = rooms.map((room) => `
        <article class="room-item">
            <div>
                <h3>${escapeHtml(room.name)}</h3>
                <p>${escapeHtml(room.mode)} · ${room.status === "lobby" ? "Waiting to start" : "Race in progress"}</p>
            </div>
            <span class="room-count">${room.playerCount}/${room.maxPlayers}</span>
            <button class="secondary join-room" data-room="${room.id}" ${room.status !== "lobby" || room.playerCount >= room.maxPlayers ? "disabled" : ""}>Join race</button>
        </article>
    `).join("");
}

function requireAccount() {
    if (state.user) {
        return true;
    }
    openAuth();
    return false;
}

function socketEmit(event, payload = {}) {
    if (!requireAccount()) {
        return;
    }
    connectSocket();
    if (!state.socket?.connected) {
        showToast("Connecting to the arena. Try again in a moment.");
        return;
    }
    state.socket.emit(event, payload);
}

function showArenaHome() {
    state.room = null;
    state.match = null;
    clearInterval(state.matchClockId);
    elements.arenaHome.classList.remove("hidden");
    elements.roomView.classList.add("hidden");
    elements.matchState.classList.add("hidden");
    elements.lobbyState.classList.remove("hidden");
    loadRooms();
}

function receiveRoomState(room) {
    state.room = room;
    elements.arenaHome.classList.add("hidden");
    elements.roomView.classList.remove("hidden");
    elements.activeRoomName.textContent = room.name;
    elements.roomPrivacy.textContent = room.private ? "Private room" : `${room.mode} public room`;
    elements.inviteCodeWrap.classList.toggle("hidden", !room.private);
    elements.copyCodeBtn.textContent = room.code || "";
    const isHost = room.hostId === state.user.id;
    elements.startMatchBtn.classList.toggle("hidden", !isHost || room.status !== "lobby");
    elements.lobbyMessage.textContent = isHost
        ? "You are the host. Start when everyone is ready."
        : "Waiting for the host to start the match.";
    elements.lobbyPlayerList.innerHTML = room.players.map((player) => `
        <div class="lobby-player">
            <span class="account-avatar">${escapeHtml(player.username.charAt(0).toUpperCase())}</span>
            <strong>${escapeHtml(player.username)}</strong>
            ${player.id === room.hostId ? '<span class="host-badge">Host</span>' : ""}
        </div>
    `).join("");
    if (room.status === "lobby") {
        elements.lobbyState.classList.remove("hidden");
        elements.matchState.classList.add("hidden");
    }
}

function renderMatchWord() {
    renderCharacters(elements.matchWord, state.matchWord, elements.matchInput.value, false);
}

function startMatch(match) {
    state.match = match;
    state.matchWord = "";
    state.matchStartedAt = Date.now();
    elements.lobbyState.classList.add("hidden");
    elements.matchState.classList.remove("hidden");
    elements.matchInput.value = "";
    elements.matchInput.disabled = false;
    elements.matchFeedback.textContent = "The race is live.";
    updateMatchClock(match.endsAt);
    clearInterval(state.matchClockId);
    state.matchClockId = setInterval(() => updateMatchClock(match.endsAt), 250);
    setTimeout(() => elements.matchInput.focus(), 30);
}

function updateMatchClock(endsAt) {
    const remaining = Math.max(0, endsAt - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    elements.matchClock.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function receiveMatchWord(payload) {
    state.matchWord = payload.word;
    state.matchStartedAt = Date.now();
    elements.matchInput.value = "";
    elements.matchInput.disabled = false;
    elements.matchProgress.textContent = payload.completed;
    renderMatchWord();
    elements.matchInput.focus();
}

function renderStandings(standings = []) {
    elements.standingsList.innerHTML = standings.map((player, index) => `
        <div class="standing ${player.id === state.user.id ? "me" : ""}">
            <span class="standing-rank">#${index + 1}</span>
            <span>${escapeHtml(player.username)}<small>${player.completed} words</small></span>
            <span class="standing-score">${player.score}</span>
        </div>
    `).join("");
    const myIndex = standings.findIndex((player) => player.id === state.user.id);
    elements.matchPosition.textContent = myIndex >= 0 ? `Position #${myIndex + 1}` : "Racing";
}

function endMatch(result) {
    clearInterval(state.matchClockId);
    elements.matchInput.disabled = true;
    renderStandings(result.standings);
    const winner = result.standings[0];
    const won = winner?.id === state.user.id;
    elements.matchFeedback.textContent = won
        ? "You won the room. That was fast."
        : `${winner?.username || "The leader"} wins. Rematch from the lobby.`;
    elements.matchClock.textContent = "0:00";
    showToast(won ? "Victory added to your profile." : "Race complete.");
}

function handleMatchInput() {
    if (!state.matchWord || elements.matchInput.disabled) {
        return;
    }
    renderMatchWord();
    const typed = elements.matchInput.value;
    if (typed.length && typed[typed.length - 1] !== state.matchWord[typed.length - 1]) {
        playSound(150, "sawtooth", 0.06);
    } else {
        playSound(450 + typed.length * 9, "square", 0.025, 0.025);
    }
    if (typed === state.matchWord) {
        elements.matchInput.disabled = true;
        elements.matchFeedback.textContent = "Locked in. Loading the next word…";
        socketEmit("match:finish-word", {
            word: state.matchWord,
            clientDuration: Date.now() - state.matchStartedAt
        });
    }
}

elements.soloNav.addEventListener("click", () => setView("solo"));
elements.arenaNav.addEventListener("click", () => setView("arena"));
elements.brandHome.addEventListener("click", () => setView("solo"));
elements.accountBtn.addEventListener("click", () => openAuth());
elements.logoutBtn.addEventListener("click", () => logout());
elements.authForm.addEventListener("submit", submitAuth);
elements.authSwitch.addEventListener("click", () => openAuth(state.authMode === "login" ? "register" : "login"));
elements.settingsToggle.addEventListener("click", () => elements.settingsPanel.classList.toggle("hidden"));
elements.settingsClose.addEventListener("click", () => elements.settingsPanel.classList.add("hidden"));
elements.saveApiBtn.addEventListener("click", async () => {
    state.apiUrl = normalizeApiUrl(elements.apiUrlInput.value);
    localStorage.setItem("spellrushApiUrl", state.apiUrl);
    state.socket?.disconnect();
    state.socket = null;
    const online = await checkServer();
    showToast(online ? "Railway server connected." : "Saved, but the server did not answer.");
    if (online && state.token) {
        connectSocket();
    }
});
elements.volumeSlider.addEventListener("input", () => {
    state.volume = Number(elements.volumeSlider.value);
    localStorage.setItem("masterVolume", String(state.volume));
});
elements.autoNextCheckbox.addEventListener("change", () => {
    state.autoNext = elements.autoNextCheckbox.checked;
    localStorage.setItem("autoNext", String(state.autoNext));
});
elements.contrastCheckbox.addEventListener("change", () => {
    document.documentElement.classList.toggle("high-contrast", elements.contrastCheckbox.checked);
    localStorage.setItem("highContrast", String(elements.contrastCheckbox.checked));
});
elements.typeInput.addEventListener("input", handleSoloInput);
elements.typeInput.addEventListener("keyup", verifySoloCompletion);
elements.typeInput.addEventListener("paste", (event) => event.preventDefault());
elements.typeInput.addEventListener("drop", (event) => event.preventDefault());
elements.typeInput.addEventListener("contextmenu", (event) => event.preventDefault());
elements.matchInput.addEventListener("input", handleMatchInput);
elements.matchInput.addEventListener("paste", (event) => event.preventDefault());
elements.matchInput.addEventListener("drop", (event) => event.preventDefault());
elements.randomBtn.addEventListener("click", () => initSolo());
elements.nextBtn.addEventListener("click", () => {
    advanceSolo();
});
elements.difficultyBtn.addEventListener("click", () => {
    state.modeIndex = (state.modeIndex + 1) % modes.length;
    elements.difficultyBtn.textContent = modes[state.modeIndex];
    initSolo();
});
elements.timedBtn.addEventListener("click", () => {
    state.timed = !state.timed;
    elements.timedBtn.textContent = state.timed ? "Timed" : "Relaxed";
    elements.timedBtn.classList.toggle("active", state.timed);
    initSolo();
});
elements.beeBtn.addEventListener("click", () => {
    state.spellingBee = !state.spellingBee;
    elements.beeBtn.textContent = state.spellingBee ? "Spelling bee" : "Visible word";
    elements.beeBtn.classList.toggle("active", state.spellingBee);
    initSolo();
});
elements.replayAudioBtn.addEventListener("click", () => speakWord(state.word));
elements.customWordBtn.addEventListener("click", () => {
    elements.customWordInput.value = "";
    showModal(elements.customModal);
    setTimeout(() => elements.customWordInput.focus(), 20);
});
elements.setCustomBtn.addEventListener("click", () => {
    const word = elements.customWordInput.value.trim().toLowerCase();
    if (!word) {
        return;
    }
    hideModal(elements.customModal);
    initSolo(word);
});
elements.customWordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        elements.setCustomBtn.click();
    }
});
elements.refreshRoomsBtn.addEventListener("click", loadRooms);
elements.quickPlayBtn.addEventListener("click", () => socketEmit("room:quick-join"));
elements.createRoomBtn.addEventListener("click", () => socketEmit("room:create", {
    name: elements.roomNameInput.value.trim() || `${state.user?.username || "Player"}'s race`,
    mode: elements.roomModeSelect.value,
    private: elements.privateRoomCheckbox.checked
}));
elements.joinCodeBtn.addEventListener("click", () => {
    const code = elements.joinCodeInput.value.trim().toUpperCase();
    if (code) {
        socketEmit("room:join-code", { code });
    }
});
elements.roomList.addEventListener("click", (event) => {
    const button = event.target.closest(".join-room");
    if (button) {
        socketEmit("room:join", { roomId: button.dataset.room });
    }
});
elements.leaveRoomBtn.addEventListener("click", () => socketEmit("room:leave"));
elements.startMatchBtn.addEventListener("click", () => socketEmit("match:start"));
elements.copyCodeBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(elements.copyCodeBtn.textContent);
    showToast("Invite code copied.");
});
document.addEventListener("click", (event) => {
    const closeButton = event.target.closest("[data-close]");
    if (closeButton) {
        hideModal($(closeButton.dataset.close));
    }
    if (event.target.classList.contains("modal")) {
        hideModal(event.target);
    }
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        const activeModal = event.target.closest?.(".modal:not(.hidden)");
        const typingInForm = event.target.matches?.("#auth-username, #auth-password, #custom-word-input, #join-code-input, #room-name-input, #api-url-input");
        if (state.finished && !typingInForm && (!activeModal || activeModal === elements.resultsModal)) {
            event.preventDefault();
            event.stopPropagation();
            advanceSolo();
            return;
        }
    }
    if (event.key === "Escape") {
        document.querySelectorAll(".modal:not(.hidden)").forEach(hideModal);
    }
});

elements.volumeSlider.value = state.volume;
elements.autoNextCheckbox.checked = state.autoNext;
elements.contrastCheckbox.checked = localStorage.getItem("highContrast") === "true";
document.documentElement.classList.toggle("high-contrast", elements.contrastCheckbox.checked);
elements.apiUrlInput.value = state.apiUrl;
elements.bestWpm.textContent = Math.round(state.bestWpm);
updateChallenge();
updateAccountUi();
initSolo();
if (state.token && state.user) {
    connectSocket();
}
