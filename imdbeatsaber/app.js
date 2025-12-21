const API_BASE = 'https://api.beatsaver.com';

const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));

const searchInput = qs('#searchInput');
const searchBtn = qs('#searchBtn');
const resultsEl = qs('#results');
const recommendedEl = qs('#recommended');

const modal = qs('#modal');
const closeModal = qs('#closeModal');
const modalCover = qs('#modalCover');
const modalTitle = qs('#modalTitle');
const modalAuthor = qs('#modalAuthor');
const modalDesc = qs('#modalDesc');
const modalMods = qs('#modalMods');
const modalStars = qs('#modalStars');
const modalVotes = qs('#modalVotes');
const beatsaverLink = qs('#beatsaverLink');

function toStars(rating){
  // rating likely 0..5 or 0..1; handle both
  if (rating == null) return 0;
  let r = Number(rating);
  if (r <= 1) r = r * 5; // convert 0..1 to 0..5
  r = Math.max(0, Math.min(5, r));
  return Math.round(r);
}

function ratingFromMap(map){
  const stats = map.stats || {};
  // Prefer explicit rating if present
  if (typeof map.rating === 'number') return map.rating;
  if (typeof stats.rating === 'number') return stats.rating;
  // Derive rating from upvotes/downvotes if needed
  const up = stats.upvotes ?? stats.upVotes ?? 0;
  const down = stats.downvotes ?? stats.downVotes ?? 0;
  const total = up + down;
  if (!total) return 0;
  // normalize 0..1 for toStars()
  return up / total;
}

function makeStarsEl(n){
  const wrapper = document.createElement('div');
  wrapper.className = 'stars';
  for(let i=1;i<=5;i++){
    const span = document.createElement('span');
    span.className = 'star ' + (i<=n ? '' : 'empty-star');
    span.textContent = i<=n ? '★' : '☆';
    wrapper.appendChild(span);
  }
  return wrapper;
}

function coverFor(map){
  // try available fields
  const v = map.versions && map.versions[0];
  return v?.coverURL || map.coverURL || v?.imageURL || 'https://via.placeholder.com/256x256?text=No+Cover';
}

function authorFor(map){
  return map.metadata?.levelAuthorName || map.metadata?.levelAuthor || 'Unknown';
}

function descriptionFor(map){
  return map.description || map.metadata?.description || map.name || '';
}

function modsFor(map){
  // Look into versions/diffs requirements to detect things like Noodle Extensions, Chroma, etc.
  const v = map.versions && map.versions[0];
  const modsSet = new Set();

  if (v) {
    // Some schemas put requirements directly on the version
    if (Array.isArray(v.requirements)) {
      v.requirements.forEach(r => r && modsSet.add(String(r)));
    }

    // Most commonly, requirements live on individual diffs
    if (Array.isArray(v.diffs)) {
      v.diffs.forEach(d => {
        if (Array.isArray(d.requirements)) {
          d.requirements.forEach(r => r && modsSet.add(String(r)));
        } else if (d.requirements) {
          modsSet.add(String(d.requirements));
        }
      });
    }

    // Custom environment / other hints
    if (v.customEnvironment) modsSet.add(String(v.customEnvironment));
  }

  // Fall back to any top-level hints
  if (Array.isArray(map.requirements)) {
    map.requirements.forEach(r => r && modsSet.add(String(r)));
  } else if (map.requirements) {
    modsSet.add(String(map.requirements));
  }

  const mods = Array.from(modsSet);
  if (!mods.length) return 'None detected';
  return mods.join(', ');
}

function mapToCard(map){
  const card = document.createElement('div');
  card.className = 'card';
  card.tabIndex = 0;
  card.innerHTML = `
    <div class="left"><img src="${coverFor(map)}" alt="cover" loading="lazy" /></div>
    <div class="info">
      <div class="name">${escapeHtml(map.name)}</div>
      <div class="author">${escapeHtml(authorFor(map))}</div>
    </div>
  `;
  const stars = makeStarsEl(toStars(ratingFromMap(map)));
  card.querySelector('.info').appendChild(stars);

  card.addEventListener('click', () => openModal(map));
  card.addEventListener('keypress', (e) => { if (e.key === 'Enter') openModal(map); });

  return card;
}

function escapeHtml(str){
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

async function search(query){
  if (!query || !query.trim()) return;
  resultsEl.innerHTML = '';
  const q = encodeURIComponent(query.trim());
  // use text search endpoint for random
  try {
    const res = await fetch(`${API_BASE}/search/text/0?q=${q}`);
    if (!res.ok) throw new Error('fetch failed');
    const j = await res.json();
    const docs = j.docs || j.maps || j;
    if (!docs || docs.length === 0) {
      resultsEl.innerHTML = `<div class="nores" style="color:var(--muted);padding:20px">No results</div>`;
      return;
    }
    docs.slice(0, 80).forEach(m => resultsEl.appendChild(mapToCard(m)));
  } catch (err) {
    resultsEl.innerHTML = `<div style="color:var(--muted);padding:20px">Search failed</div>`;
    console.error(err);
  }
}

async function loadRecommended(){
  // to asure fucking person thinks its doing something
  recommendedEl.innerHTML = `<div style="color:var(--muted);padding:8px 4px;">Loading random maps...</div>`;

  // Use text search pages (which we know work from normal search) as our source,
  // then shuffle for randomness.
  async function fetchPage(page){
    const url = `${API_BASE}/search/text/${page}?q=a`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('failed ' + url);
    const j = await res.json();
    return j.docs || j.maps || [];
  }

  try {
    // three pages of results, then randomize
    const pages = await Promise.all([
      fetchPage(0),
      fetchPage(1),
      fetchPage(2),
    ]);

    let maps = pages.flat();

    if (!maps || !maps.length) {
      recommendedEl.innerHTML = `<div style="color:var(--muted);padding:8px 4px;">No recommended maps found.</div>`;
      return;
    }

    // shuffle e full set of maps so they are random every refresh
    maps = maps.slice();
    for (let i = maps.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [maps[i], maps[j]] = [maps[j], maps[i]];
    }

    // pick a reasonable haha number to display in the strip
    const pick = maps.slice(0, 12);

    recommendedEl.innerHTML = '';
    pick.forEach(m => {
      const c = document.createElement('div');
      c.className = 'reco-card';
      const stars = toStars(ratingFromMap(m));
      c.innerHTML = `
        <img class="cover-thumb" src="${coverFor(m)}" alt="cover" />
        <div class="reco-info">
          <div class="title">${escapeHtml(m.name)}</div>
          <div class="sub">${escapeHtml(authorFor(m))}</div>
          <div class="stars small-stars">
            ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}
          </div>
        </div>`;
      c.addEventListener('click', ()=> openModal(m));
      recommendedEl.appendChild(c);
    });
  } catch(e){
    console.error('recommended failed', e);
    recommendedEl.innerHTML = `<div style="color:var(--muted);padding:8px 4px;">Failed to load recommended maps.</div>`;
  }
}

function openModal(map){
  modalCover.src = coverFor(map);
  modalTitle.textContent = map.name;
  modalAuthor.textContent = 'by ' + authorFor(map);
  modalDesc.textContent = descriptionFor(map) || 'No description available.';
  modalMods.textContent = modsFor(map);
  const starsN = toStars(ratingFromMap(map));
  modalStars.innerHTML = '';
  modalStars.appendChild(makeStarsEl(starsN));

  // upvotes / downvotes display main shit
  const stats = map.stats || {};
  const up = stats.upvotes ?? stats.upVotes ?? 0;
  const down = stats.downvotes ?? stats.downVotes ?? 0;
  modalVotes.textContent = `${up} upvotes • ${down} downvotes`;
  // set beatsaver link - use key if available else id key should work
  const key = map.key || map.id || '';
  beatsaverLink.href = key ? `https://beatsaver.com/beatmap/${key}` : 'https://beatsaver.com';
  modal.classList.remove('hidden');
  // close the damn modal
  closeModal.focus();
}

closeModal.addEventListener('click', ()=> modal.classList.add('hidden'));
modal.addEventListener('click', (e)=>{ if (e.target === modal) modal.classList.add('hidden'); });
document.addEventListener('keydown', (e)=> { if (e.key === 'Escape') modal.classList.add('hidden'); });

searchBtn.addEventListener('click', ()=> search(searchInput.value));
searchInput.addEventListener('keydown', (e)=> { if (e.key === 'Enter') search(searchInput.value); });

// initial
loadRecommended();

// small helpful: search on load popular term to show content
search(''); // will do nothing if empty; optional initial results can be loaded by uncommenting

