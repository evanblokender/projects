const BEATSAVER_API = 'https://api.beatsaver.com';
const RAILWAY_BACKEND_URL = 'https://imdbeatsaber-backend-production.up.railway.app';

const state = {
  query: 'camellia',
  page: 0,
  order: 'Rating',
  filters: new Set(),
  maps: [],
  currentMap: null,
  accessToken: localStorage.getItem('imd_access_token') || '',
  user: null
};

const $ = (selector) => document.querySelector(selector);

const els = {
  searchForm: $('#searchForm'),
  searchInput: $('#searchInput'),
  sortSelect: $('#sortSelect'),
  results: $('#results'),
  spotlight: $('#spotlight'),
  statusTitle: $('#statusTitle'),
  statusText: $('#statusText'),
  loadMore: $('#loadMoreButton'),
  chips: Array.from(document.querySelectorAll('.chip')),
  modal: $('#mapModal'),
  closeModal: $('#closeModal'),
  modalCover: $('#modalCover'),
  modalKicker: $('#modalKicker'),
  modalTitle: $('#modalTitle'),
  modalMeta: $('#modalMeta'),
  modalStats: $('#modalStats'),
  modalTags: $('#modalTags'),
  modalDescription: $('#modalDescription'),
  beatsaverLink: $('#beatsaverLink'),
  downloadLink: $('#downloadLink'),
  reviewsSummary: $('#reviewsSummary'),
  reviewsList: $('#reviewsList'),
  reviewForm: $('#reviewForm'),
  reviewStars: $('#reviewStars'),
  reviewBody: $('#reviewBody'),
  reviewLoginButton: $('#reviewLoginButton'),
  accountButton: $('#accountButton'),
  accountPanel: $('#accountPanel'),
  closeAccount: $('#closeAccount'),
  accountState: $('#accountState'),
  loginForm: $('#loginForm'),
  registerForm: $('#registerForm'),
  logoutButton: $('#logoutButton'),
  authMessage: $('#authMessage')
};

const backendBase = RAILWAY_BACKEND_URL.replace(/\/+$/, '');

function text(value, fallback = '') {
  return value == null || value === '' ? fallback : String(value);
}

function formatNumber(value) {
  const n = Number(value || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const min = Math.floor(total / 60);
  const sec = Math.floor(total % 60).toString().padStart(2, '0');
  return total ? `${min}:${sec}` : 'Unknown';
}

function mapKey(map) {
  return text(map.key || map.id, 'unknown');
}

function latestVersion(map) {
  return Array.isArray(map.versions) ? map.versions[0] : null;
}

function coverFor(map) {
  const version = latestVersion(map);
  return version?.coverURL || map.coverURL || version?.imageURL || '';
}

function authorFor(map) {
  return map.uploader?.name || map.metadata?.levelAuthorName || map.metadata?.songAuthorName || 'Unknown mapper';
}

function songLine(map) {
  const song = text(map.metadata?.songName || map.name, 'Untitled');
  const artist = text(map.metadata?.songAuthorName);
  return artist ? `${song} by ${artist}` : song;
}

function ratingPercent(map) {
  const stats = map.stats || {};
  if (typeof stats.score === 'number') return Math.round(stats.score * 100);
  if (typeof stats.rating === 'number') return Math.round((stats.rating <= 1 ? stats.rating : stats.rating / 100) * 100);
  const up = stats.upvotes ?? stats.upVotes ?? 0;
  const down = stats.downvotes ?? stats.downVotes ?? 0;
  const total = up + down;
  return total ? Math.round((up / total) * 100) : 0;
}

function requirementTags(map) {
  const version = latestVersion(map);
  const requirements = new Set();
  if (Array.isArray(version?.requirements)) version.requirements.forEach((item) => requirements.add(item));
  if (Array.isArray(version?.diffs)) {
    version.diffs.forEach((diff) => {
      if (Array.isArray(diff.requirements)) diff.requirements.forEach((item) => requirements.add(item));
      if (diff.characteristic) requirements.add(diff.characteristic);
    });
  }
  if (map.ranked) requirements.add('Ranked');
  if (map.qualified) requirements.add('Qualified');
  if (map.curatedAt || map.curator) requirements.add('Curated');
  return Array.from(requirements).filter(Boolean).slice(0, 7);
}

function difficultySummary(map) {
  const version = latestVersion(map);
  const diffs = Array.isArray(version?.diffs) ? version.diffs : [];
  const names = [...new Set(diffs.map((diff) => diff.difficulty).filter(Boolean))];
  return names.length ? names.join(', ') : 'No difficulties listed';
}

function buildSearchUrl(page = 0) {
  const params = new URLSearchParams();
  params.set('q', state.query || 'beatsaber');
  params.set('order', state.order);
  params.set('pageSize', '30');
  if (state.filters.has('curated')) params.set('curated', 'true');
  if (state.filters.has('noodle')) params.set('noodle', 'true');
  if (state.filters.has('chroma')) params.set('chroma', 'true');
  if (state.filters.has('cinema')) params.set('cinema', 'true');
  if (state.filters.has('ranked')) params.set('leaderboard', 'Ranked');
  return `${BEATSAVER_API}/search/text/${page}?${params.toString()}`;
}

function setStatus(title, message) {
  els.statusTitle.textContent = title;
  els.statusText.textContent = message;
}

function renderSkeleton() {
  els.results.innerHTML = Array.from({ length: 8 }, () => '<div class="skeleton"></div>').join('');
}

async function fetchMaps({ append = false } = {}) {
  if (!append) {
    state.page = 0;
    state.maps = [];
    els.spotlight.classList.add('hidden');
    renderSkeleton();
  }

  setStatus('Searching maps', `${state.query || 'Beat Saber'} sorted by ${state.order.toLowerCase()}.`);

  try {
    const res = await fetch(buildSearchUrl(state.page));
    if (!res.ok) throw new Error(`BeatSaver returned ${res.status}`);
    const json = await res.json();
    const docs = Array.isArray(json.docs) ? json.docs : [];

    state.maps = append ? state.maps.concat(docs) : docs;
    renderMaps();
    els.loadMore.classList.toggle('hidden', docs.length < 30);
    setStatus(`${state.maps.length} maps loaded`, docs.length ? 'Open a map for downloads, requirements, reviews, and details.' : 'Try a different search or remove a filter.');
  } catch (error) {
    console.error(error);
    els.results.innerHTML = '<div class="empty-state">BeatSaver did not answer. Check your connection or try again in a minute.</div>';
    els.loadMore.classList.add('hidden');
    setStatus('Search failed', 'BeatSaver may be down or rate limited.');
  }
}

function renderMaps() {
  if (!state.maps.length) {
    els.results.innerHTML = '<div class="empty-state">No maps matched that search.</div>';
    return;
  }

  renderSpotlight(state.maps[0]);
  els.results.innerHTML = '';
  state.maps.forEach((map) => els.results.appendChild(createCard(map)));
}

function renderSpotlight(map) {
  els.spotlight.classList.remove('hidden');
  els.spotlight.innerHTML = `
    <img src="${coverFor(map)}" alt="" />
    <div class="spotlight-content">
      <div class="kicker">Featured result</div>
      <h2>${escapeHtml(songLine(map))}</h2>
      <p>${escapeHtml(authorFor(map))} | ${ratingPercent(map)}% rating | ${difficultySummary(map)}</p>
    </div>
  `;
  els.spotlight.onclick = () => openMap(map);
}

function createCard(map) {
  const card = document.createElement('article');
  card.className = 'card';
  card.tabIndex = 0;
  card.innerHTML = `
    <img src="${coverFor(map)}" alt="" loading="lazy" />
    <div>
      <h3>${escapeHtml(songLine(map))}</h3>
      <div class="mapper">${escapeHtml(authorFor(map))}</div>
      <div class="stat-row">
        <span class="pill gold">${ratingPercent(map)}%</span>
        <span class="pill">${formatNumber(map.stats?.upvotes ?? map.stats?.upVotes)} up</span>
        <span class="pill">${formatDuration(map.metadata?.duration)}</span>
      </div>
    </div>
  `;
  card.addEventListener('click', () => openMap(map));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') openMap(map);
  });
  return card;
}

function openMap(map) {
  state.currentMap = map;
  const version = latestVersion(map);
  const key = mapKey(map);
  els.modalCover.src = coverFor(map);
  els.modalKicker.textContent = key ? `BeatSaver ${key}` : 'BeatSaver map';
  els.modalTitle.textContent = songLine(map);
  els.modalMeta.textContent = `${authorFor(map)} | ${difficultySummary(map)}`;
  els.modalStats.innerHTML = [
    ['Rating', `${ratingPercent(map)}%`],
    ['Upvotes', formatNumber(map.stats?.upvotes ?? map.stats?.upVotes)],
    ['Downvotes', formatNumber(map.stats?.downvotes ?? map.stats?.downVotes)],
    ['Length', formatDuration(map.metadata?.duration)],
    ['BPM', text(map.metadata?.bpm, 'Unknown')],
    ['Uploaded', text(map.uploaded ? new Date(map.uploaded).toLocaleDateString() : '')]
  ].map(([label, value]) => `<div class="stat-box"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('');
  const tags = requirementTags(map);
  els.modalTags.innerHTML = tags.length ? tags.map((tag) => `<span class="pill good">${escapeHtml(tag)}</span>`).join('') : '<span class="pill">No special requirements detected</span>';
  els.modalDescription.textContent = text(map.description || map.metadata?.description, 'No description available.');
  els.beatsaverLink.href = key ? `https://beatsaver.com/maps/${key}` : 'https://beatsaver.com';
  els.downloadLink.href = version?.downloadURL || els.beatsaverLink.href;
  els.modal.classList.remove('hidden');
  loadReviews(key);
}

function closeMap() {
  els.modal.classList.add('hidden');
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

async function api(path, options = {}) {
  if (!backendBase) throw new Error('Backend URL is not set in app.js');
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (state.accessToken) headers.set('Authorization', `Bearer ${state.accessToken}`);

  const res = await fetch(`${backendBase}${path}`, {
    ...options,
    headers,
    credentials: 'include'
  });

  if (res.status === 401 && path !== '/api/auth/refresh') {
    const refreshed = await refreshToken();
    if (refreshed) return api(path, options);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed with ${res.status}`);
  return data;
}

async function refreshToken() {
  if (!backendBase) return false;
  try {
    const data = await api('/api/auth/refresh', { method: 'POST', body: '{}' });
    setSession(data);
    return true;
  } catch {
    clearSession();
    return false;
  }
}

function setSession(data) {
  state.accessToken = data.accessToken || '';
  state.user = data.user || null;
  if (state.accessToken) localStorage.setItem('imd_access_token', state.accessToken);
  renderAccount();
}

function clearSession() {
  state.accessToken = '';
  state.user = null;
  localStorage.removeItem('imd_access_token');
  renderAccount();
}

function renderAccount() {
  const signedIn = Boolean(state.user);
  els.accountButton.textContent = signedIn ? state.user.username : 'Sign in';
  els.reviewLoginButton.classList.toggle('hidden', signedIn);
  els.reviewForm.classList.toggle('hidden', !signedIn || !state.currentMap || !backendBase);
  els.logoutButton.classList.toggle('hidden', !signedIn);
  els.loginForm.classList.toggle('hidden', signedIn);
  els.registerForm.classList.toggle('hidden', signedIn);
  els.accountState.textContent = signedIn ? `Signed in as ${state.user.username}.` : 'Sign in or create an account to rate maps without spam.';
}

async function loadMe() {
  if (!backendBase || !state.accessToken) {
    renderAccount();
    return;
  }
  try {
    const data = await api('/api/auth/me');
    state.user = data.user;
  } catch {
    clearSession();
  }
  renderAccount();
}

async function loadReviews(key) {
  els.reviewsList.innerHTML = '';
  renderAccount();

  if (!backendBase) {
    els.reviewsSummary.textContent = 'Paste your Railway backend URL into RAILWAY_BACKEND_URL in app.js to enable protected reviews.';
    return;
  }

  els.reviewsSummary.textContent = 'Loading reviews...';
  try {
    const data = await api(`/api/maps/${encodeURIComponent(key)}/reviews`);
    const avg = data.summary?.averageRating ? Number(data.summary.averageRating).toFixed(1) : 'No';
    els.reviewsSummary.textContent = `${avg} average | ${data.summary?.reviewCount || 0} reviews`;
    if (!data.reviews?.length) {
      els.reviewsList.innerHTML = '<div class="empty-state">No reviews yet.</div>';
      return;
    }
    els.reviewsList.innerHTML = data.reviews.map((review) => `
      <article class="review">
        <strong>${review.stars}/5 | ${escapeHtml(review.username)}</strong>
        <p>${escapeHtml(review.body)}</p>
      </article>
    `).join('');
  } catch (error) {
    els.reviewsSummary.textContent = error.message;
  }
}

els.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.query = els.searchInput.value.trim() || 'beatsaber';
  fetchMaps();
});

els.sortSelect.addEventListener('change', () => {
  state.order = els.sortSelect.value;
  fetchMaps();
});

els.chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    const filter = chip.dataset.filter;
    if (state.filters.has(filter)) state.filters.delete(filter);
    else state.filters.add(filter);
    chip.classList.toggle('active', state.filters.has(filter));
    fetchMaps();
  });
});

els.loadMore.addEventListener('click', () => {
  state.page += 1;
  fetchMaps({ append: true });
});

els.closeModal.addEventListener('click', closeMap);
els.modal.addEventListener('click', (event) => {
  if (event.target === els.modal) closeMap();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeMap();
    els.accountPanel.classList.add('hidden');
  }
});

els.accountButton.addEventListener('click', () => els.accountPanel.classList.remove('hidden'));
els.reviewLoginButton.addEventListener('click', () => els.accountPanel.classList.remove('hidden'));
els.closeAccount.addEventListener('click', () => els.accountPanel.classList.add('hidden'));

els.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  els.authMessage.textContent = 'Signing in...';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: $('#loginEmail').value,
        password: $('#loginPassword').value
      })
    });
    setSession(data);
    els.authMessage.textContent = 'Signed in.';
    if (state.currentMap) loadReviews(mapKey(state.currentMap));
  } catch (error) {
    els.authMessage.textContent = error.message;
  }
});

els.registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  els.authMessage.textContent = 'Creating account...';
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#registerUsername').value,
        email: $('#registerEmail').value,
        password: $('#registerPassword').value
      })
    });
    setSession(data);
    els.authMessage.textContent = 'Account created.';
    if (state.currentMap) loadReviews(mapKey(state.currentMap));
  } catch (error) {
    els.authMessage.textContent = error.message;
  }
});

els.logoutButton.addEventListener('click', async () => {
  try {
    if (backendBase) await api('/api/auth/logout', { method: 'POST', body: '{}' });
  } finally {
    clearSession();
    els.authMessage.textContent = 'Logged out.';
    if (state.currentMap) loadReviews(mapKey(state.currentMap));
  }
});

els.reviewForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.currentMap) return;
  const key = mapKey(state.currentMap);
  try {
    await api(`/api/maps/${encodeURIComponent(key)}/reviews`, {
      method: 'POST',
      body: JSON.stringify({
        stars: Number(els.reviewStars.value),
        body: els.reviewBody.value.trim()
      })
    });
    els.reviewBody.value = '';
    loadReviews(key);
  } catch (error) {
    els.reviewsSummary.textContent = error.message;
  }
});

els.searchInput.value = state.query;
els.sortSelect.value = state.order;
loadMe();
fetchMaps();
