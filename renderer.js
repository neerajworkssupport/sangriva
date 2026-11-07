// Core: state, navigation, Library browsing, posters, key dialog, scan, search palette.
let library = [];
let byId = new Map();
let route = { view: 'overview' };
const stack = [];
let renderToken = 0;
let searchTerm = '';
let fetching = false;
let syncing = false;
const requested = new Set(); // item ids already asked for this session (stops re-fetching on every re-render)
const MEDIA = new Set(['movie', 'series']);
const BROWSE = new Set(['videos', 'all', 'movie', 'series', 'music', 'game', 'noposter']);

const content = $('#content');
const fetchBtn = $('#fetchBtn');
const syncBtn = $('#syncBtn');
const keyBtn = $('#keyBtn');
const keyDialog = $('#keyDialog');
const keyForm = $('#keyForm');
const keyInput = $('#keyInput');
const keyMsg = $('#keyMsg');
const keySave = $('#keySave');

// ---------- remembered view choices ----------
const prefs = (() => {
  const d = { filter: 'all', sort: 'recent', layout: 'grid', musicTab2: 'artists', missingTab: 'episodes' };
  try { return { ...d, ...JSON.parse(localStorage.getItem('hddPrefs') || '{}') }; } catch { return d; }
})();
function savePrefs() { try { localStorage.setItem('hddPrefs', JSON.stringify(prefs)); } catch {} }

// ---------- navigation ----------
function setActiveNav() {
  const alias = { album: 'music', artist: 'music', collection: 'collections' };
  const v = route.view === 'detail' || route.view === 'person' ? null : (alias[route.view] || route.view);
  if (!v) return;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === v));
}

function go(r, { nav = false } = {}) {
  if (nav) stack.length = 0; else stack.push(route);
  route = r;
  setActiveNav();
  render();
  content.scrollTop = 0;
}

function back() {
  route = stack.pop() || { view: 'overview' };
  setActiveNav();
  render();
}

function render() {
  if (moreObs) { moreObs.disconnect(); moreObs = null; }
  renderToken++;
  switch (route.view) {
    case 'overview': return renderOverview();
    case 'missing': return renderMissing();
    case 'compare': return renderCompare();
    case 'backup': return renderBackup();
    case 'safety': return renderSafety();
    case 'move': return renderMove();
    case 'cleanup': return renderCleanup();
    case 'share': return renderShare();
    case 'settings': return renderSettings();
    case 'queue': return renderQueue();
    case 'find': return renderFind();
    case 'drives': return renderDrives();
    case 'collections': return renderCollections();
    case 'collection': return renderCollection(route.key);
    case 'duplicates': return renderDuplicates();
    case 'storage': return renderDrives();
    case 'videos': { // a background refresh must not wipe what is being typed in the Assign box
      const a = document.activeElement;
      if (a && a.matches && a.matches('[data-vq],[data-vyr]')) return;
      return renderVideos();
    }
    case 'wishlist': return renderWishlist();
    case 'album': return renderAlbum(route.id);
    case 'artist': return renderArtist(route.name);
    case 'detail': return renderDetail(route.id);
    case 'person': return renderPerson(route.id);
    default: return renderBrowse();
  }
}

document.querySelectorAll('.nav-item').forEach(el => el.addEventListener('click', () => go({ view: el.dataset.view }, { nav: true })));

// ---------- library data ----------
let gameCands = [], singles = [], videos = [], gameRejected = [];
function setLibrary(items) {
  const all = items || [];
  { const bar = document.getElementById('demoBar'); if (bar) bar.hidden = !all.some(i => i.demo); }
  gameCands = all.filter(i => i.type === 'game' && i.gameState === 'candidate');
  singles = all.filter(i => i.single);
  videos = all.filter(i => i.video);
  gameRejected = all.filter(i => i.type === 'game' && i.gameState === 'rejected');
  library = all.filter(i => !(i.type === 'game' && i.gameState !== 'confirmed') && !i.single && !i.video);
  const vb = document.getElementById('videosBadge'); if (vb) { vb.textContent = videos.length; vb.hidden = !videos.length; }
  byId = new Map(all.map(i => [i.id, i]));
  const nq = library.filter(i => i.queued).length;
  const qb = document.getElementById('queueBadge'); if (qb) { qb.textContent = nq; qb.hidden = !nq; }
}

let lastLibSig = '';
let searchIndex = {}; // item id -> cast, crew, genres... words, so search finds more than titles
async function loadSearchIndex() { try { searchIndex = await window.api.getSearchIndex(); } catch {} }

/** quiet = a background refresh: nothing is redrawn unless the data really changed, and the scroll position is kept. */
async function loadLibrary({ quiet = false } = {}) {
  const items = await window.api.getLibrary();
  const sig = JSON.stringify(items);
  refreshSideDrives();
  if (quiet && sig === lastLibSig) return;
  lastLibSig = sig;
  const keep = quiet ? content.scrollTop : 0;
  setLibrary(items);
  render();
  if (quiet) { const put = () => { content.scrollTop = keep; }; requestAnimationFrame(put); setTimeout(put, 250); }
  refreshWish();
  refreshBadges();
  loadSearchIndex();
}

function refreshBadges() {} // the Videos counter is set when the library loads

async function refreshSideDrives() {
  try { updateSideDrives((await window.api.getDrives()).drives); } catch {}
}

function openFolder(p, item) {
  if (!p) return;
  if (item && !item.online) setStatus(`${item.driveName || 'This drive'} is offline${item.shelf ? ` — it lives on ${item.shelf}` : ''}. Plug it in to open the folder.`);
  else window.api.openPath(p);
}

function openItem(item) {
  if (!item) return;
  if (item.type === 'game') openFolder(item.path, item);
  else if (item.type === 'music') go({ view: 'album', id: item.id });
  else go({ view: 'detail', id: item.id });
}

/** Click handling for every .card[data-id] under root. */
/** Sends a series entry to the Videos tab (out of TV Series). Files are not touched. */
async function removeFromTv(item) {
  const c = await confirmBox({ title: 'Remove from TV Series?', body: `<p><b>${escapeHtml(shownTitle(item))}</b> will leave TV Series and wait in the Videos tab, where you can assign it to the right movie or show, or delete it. Your files are not touched.</p>`, okText: 'Remove from TV Series' });
  if (!c.ok) return;
  const res = await window.api.setNotShow({ id: item.id, to: 'videos' });
  if (!res || !res.ok) { setStatus('Could not remove it.'); return; }
  setLibrary(res.items); if (route.view === 'detail') go({ view: 'series' }, { nav: true }); else render();
  setStatus('Removed from TV Series. It is in the Videos tab.');
}

/** A movie entry that is really part of a show: asks for the show's name, then lists it under TV Series. */
async function moveToShow(item) {
  const c = await confirmBox({ title: 'Move to TV Series?', body: `<p><b>${escapeHtml(shownTitle(item))}</b> will be listed under TV Series. Which show is it part of?</p><input type="text" id="asShowTitle" class="wide-input" value="${escapeAttr(item.title || '')}" maxlength="120" autocomplete="off"><p class="muted">Use the same name for every part of the show so they join one entry. Your files are not touched.</p>`, okText: 'Move to TV Series' });
  if (!c.ok) return;
  const title = ($('#asShowTitle') || {}).value || '';
  if (!title.trim()) { setStatus('Type the show name first.'); return; }
  const res = await window.api.setAsShow({ id: item.id, title, year: item.year || null });
  if (!res || !res.ok) { setStatus('Could not move it.'); return; }
  setLibrary(res.items); if (route.view === 'detail') go({ view: 'series' }, { nav: true }); else render();
  setStatus('Moved to TV Series. Open the show and press “Back to Movies” to undo.');
}

/** A series entry that is really a movie: after a confirmation it is listed under Movies. Files are not touched. */
async function moveToMovies(item) {
  const c = await confirmBox({ title: 'Move to Movies?', body: `<p><b>${escapeHtml(shownTitle(item))}</b> will be listed under Movies instead of TV Series. Your files are not touched.</p>`, okText: 'Move to Movies' });
  if (!c.ok) return;
  const res = await window.api.setNotShow({ id: item.id });
  if (!res || !res.ok) { setStatus('Could not move it.'); return; }
  setLibrary(res.items); render(); setStatus('Moved to Movies. Open it there and press “Back to TV Series” to undo.');
}

/** ✓ watched / ★ favourite. The buttons change in place; the grid only redraws when a Status filter is on. */
async function toggleMark(item, key, card) {
  const cur = key === 'w' ? !item.watched : key === 'q' ? !item.queued : !item.fav;
  const res = await window.api.setMark({ id: item.id, key, on: cur });
  if (!res || !res.ok) return;
  setLibrary(res.items);
  if (route.view === 'queue') { render(); return; }
  if (prefs.fs && prefs.fs !== 'all' && (route.view === 'movie' || route.view === 'series')) { render(); return; }
  if (card) card.querySelectorAll(`[data-mark="${key}"]`).forEach(b => b.classList.toggle('on', cur));
  const d = $('#detailMarks'); if (d) renderDetailMarks(byId.get(item.id) || item);
}

function bindCards(root) {
  root.querySelectorAll('.card[data-id]').forEach(card => {
    card.addEventListener('click', (ev) => {
      const item = byId.get(card.dataset.id);
      if (!item) return;
      const mk = ev.target.closest('[data-mark]');
      if (mk) { ev.stopPropagation(); toggleMark(item, mk.dataset.mark, card); return; }
      if (ev.target.closest('[data-notshow]')) { ev.stopPropagation(); moveToMovies(item); return; }
      if (ev.target.closest('[data-hideshow]')) { ev.stopPropagation(); removeFromTv(item); return; }
      if (ev.target.closest('[data-asshow]')) { ev.stopPropagation(); moveToShow(item); return; }
      if (ev.target.closest('[data-gremove]')) { ev.stopPropagation(); window.api.setGameState([item.id], 'no').then(items => { setLibrary(items); render(); setStatus(`Removed “${item.title}” from Games. It is listed under “Removed” at the bottom, where you can put it back.`); }); return; }
      if (ev.target.closest('[data-open]')) { ev.stopPropagation(); openFolder(item.path, item); return; }
      if (ev.target.closest('[data-play]')) { ev.stopPropagation(); playItem(item); return; }
      openItem(item);
    });
  });
}

// ---------- Library browsing ----------
const SORTS = [['recent', 'Recently added'], ['az', 'A to Z'], ['year', 'Year (newest)'], ['rating', 'Rating'], ['drive', 'Drive']];
const PILLS = [['all', 'All'], ['online', 'Online now'], ['offline', 'Offline'], ['recent', 'Added this month']];

const RES_ORDER = ['4K', '1080p', '720p', 'SD'];
const MEDIA_FILTERS = new Set(['movie', 'series', 'all']);

/** Labeled drop-downs above a Movies / TV / Library grid: Quality, Genre, Language, Rating, Year, Availability, Order by. */
function filterBarHTML() {
  const base = library.filter(i => route.view === 'all' || i.type === route.view);
  const uniq = (f) => [...new Set(base.flatMap(f).filter(Boolean))];
  const res = uniq(i => [(i.quality && i.quality.res) || 'Unknown']).sort((a, b) => (RES_ORDER.indexOf(a) < 0 ? 99 : RES_ORDER.indexOf(a)) - (RES_ORDER.indexOf(b) < 0 ? 99 : RES_ORDER.indexOf(b)));
  const genres = uniq(i => i.genres || []).sort();
  const langs = uniq(i => [i.language || 'Unknown']).sort();
  const years = uniq(i => [i.year]).sort((a, b) => b - a);
  const sel = (id, label, cur, opts) => `<div class="fgroup"><label for="${id}">${label}</label><select id="${id}" data-f="${id}">${opts.map(([v, t]) => `<option value="${escapeAttr(v)}"${String(cur || 'all') === String(v) ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></div>`;
  const any = ['fq', 'fg', 'fl', 'fr', 'fy', 'fs'].some(k => prefs[k] && prefs[k] !== 'all') || (route.view === 'series' && ['complete', 'incomplete'].includes(prefs.tvc)) || (prefs.filter && prefs.filter !== 'all');
  const tvc = route.view === 'series' ? (['complete', 'incomplete'].includes(prefs.tvc) ? prefs.tvc : 'all') : null;
  const nC = base.filter(i => i.tvStatus === 'complete').length, nI = base.filter(i => i.tvStatus === 'missing').length;
  const tvBtns = tvc ? `<div class="fgroup"><label>Episodes</label><div class="pills">${[['all', 'All', base.length], ['complete', 'Complete', nC], ['incomplete', 'Incomplete', nI]].map(([k, l, n]) => `<button class="pill${tvc === k ? ' active' : ''}" data-tvc="${k}">${l} (${n})</button>`).join('')}</div></div>` : '';
  return `<div class="fbar">
    ${tvBtns}
    ${sel('fq', 'Quality', prefs.fq, [['all', 'All'], ...res.map(r => [r, r]), ['3D', '3D']])}
    ${sel('fg', 'Genre', prefs.fg, [['all', 'All Genres'], ...genres.map(g => [g, g])])}
    ${sel('fl', 'Language', prefs.fl, [['all', 'All Languages'], ...langs.map(l => [l, l])])}
    ${sel('fr', 'Rating', prefs.fr, [['all', 'All Ratings'], ['9', '9+'], ['8', '8+'], ['7', '7+'], ['6', '6+'], ['5', '5+']])}
    ${sel('fy', 'Year', prefs.fy, [['all', 'All Years'], ...years.map(y => [y, y])])}
    ${route.view === 'movie' || route.view === 'series' ? sel('fs', 'Status', prefs.fs, [['all', 'All'], ['watched', 'Watched'], ['unwatched', 'Not watched'], ['fav', '★ Favourites'], ['queue', '＋ To watch']]) : ''}
    ${sel('favail', 'Availability', prefs.filter || 'all', PILLS)}
    ${sel('sortSel', 'Order by', prefs.sort, SORTS.map(([k, l]) => [k, k === 'recent' ? 'Latest' : l]))}
    <div class="fgroup fend">${route.view === 'movie' ? `<label class="fcheck" title="Show the same movie in several qualities as one card"><input type="checkbox" data-gv${prefs.groupVer !== false ? ' checked' : ''}> Group versions</label>` : ''}${any ? '<button class="secondary small-btn" id="fclear">Clear filters</button>' : ''}
      <div class="seg"><button data-layout="grid" class="${prefs.layout === 'grid' ? 'active' : ''}" title="Grid">▦</button><button data-layout="list" class="${prefs.layout === 'list' ? 'active' : ''}" title="List">☰</button></div></div>
  </div>`;
}

/**
 * Every word typed must match. Words search title, artist, drive, shelf, year, quality, genre, language, cast and crew.
 * Special words: >10GB  <2GB  (size)   2160p / 4k / 1080p / 3d   offline / online   watched / unwatched / fav
 *                type:movie|series|music|game   year:2010   drive:name
 */
const SIZE_UNITS = { kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };
function matchesSearch(item, w) {
  const q = item.quality || {};
  const hay = `${item.title} ${item.artist || ''} ${item.driveName || ''} ${item.shelf || ''} ${item.year || ''} ${q.res || ''} ${(q.tags || []).join(' ')} ${searchIndex[item.id] || ''}`.toLowerCase();
  return w.split(/\s+/).filter(Boolean).every(t => {
    let m = t.match(/^([<>])=?(\d+(?:\.\d+)?)(kb|mb|gb|tb)$/);
    if (m) { const v = +m[2] * SIZE_UNITS[m[3]], s = item.size || 0; return m[1] === '>' ? s > v : s < v; }
    if (t === 'offline') return !item.online;
    if (t === 'online') return !!item.online;
    if (t === 'watched') return !!item.watched;
    if (t === 'unwatched') return !item.watched;
    if (t === 'fav' || t === 'favourite' || t === 'favorite' || t === 'favourites') return !!item.fav;
    if ((m = t.match(/^(type|year|drive):(.+)$/))) {
      const v = m[2];
      if (m[1] === 'type') return item.type === v || (v === 'tv' || v === 'show') && item.type === 'series' || v === 'film' && item.type === 'movie';
      if (m[1] === 'year') return String(item.year) === v;
      return (item.driveName || '').toLowerCase().includes(v);
    }
    if (t === '2160p' || t === 'uhd') t = '4k';
    return hay.includes(t);
  });
}

/** Movies that are the same film in different qualities: the best copy stands for the group (its card says "N versions"). */
const RES_RANK = { '4K': 4, '1080p': 3, '720p': 2, SD: 1 };
function groupVersions(items) {
  const best = new Map(), count = new Map(), order = [];
  for (const it of items) {
    const k = it.versionKey;
    if (!k) { order.push(it); continue; }
    count.set(k, (count.get(k) || 0) + 1);
    const cur = best.get(k);
    const score = (x) => (RES_RANK[x.quality && x.quality.res] || 0) * 1e13 + (x.size || 0);
    if (!cur) { best.set(k, it); order.push(k); } else if (score(it) > score(cur)) best.set(k, it);
  }
  return order.map(o => (typeof o === 'string' ? { ...best.get(o), versionCount: count.get(o) } : o));
}

function visibleItems() {
  const w = searchTerm.toLowerCase();
  const month = Date.now() - 30 * 86400000;
  let items = library.filter(item => {
    if (route.view === 'noposter') { if (item.poster) return false; }
    else if (route.view !== 'all' && item.type !== route.view) return false;
    if (route.view !== 'noposter') {
      if (prefs.filter === 'online' && !item.online) return false;
      if (prefs.filter === 'offline' && item.online) return false;
      if (prefs.filter === 'recent' && item.addedAt < month) return false;
    }
    if (w && !matchesSearch(item, w)) return false;
    if ((route.view === 'movie' || route.view === 'series') && prefs.fs && prefs.fs !== 'all') {
      if (prefs.fs === 'watched' && !item.watched) return false;
      if (prefs.fs === 'unwatched' && item.watched) return false;
      if (prefs.fs === 'fav' && !item.fav) return false;
      if (prefs.fs === 'queue' && !item.queued) return false;
    }
    if (route.view === 'series') {
      if (prefs.tvc === 'complete' && item.tvStatus !== 'complete') return false;
      if (prefs.tvc === 'incomplete' && item.tvStatus !== 'missing') return false;
    }
    if (MEDIA_FILTERS.has(route.view)) {
      if (prefs.fq && prefs.fq !== 'all') {
        if (prefs.fq === '3D') { if (!((item.quality && item.quality.tags) || []).includes('3D')) return false; }
        else if (((item.quality && item.quality.res) || 'Unknown') !== prefs.fq) return false;
      }
      if (prefs.fg && prefs.fg !== 'all' && !(item.genres || []).includes(prefs.fg)) return false;
      if (prefs.fl && prefs.fl !== 'all' && (item.language || 'Unknown') !== prefs.fl) return false;
      if (prefs.fr && prefs.fr !== 'all' && !(item.rating >= +prefs.fr)) return false;
      if (prefs.fy && prefs.fy !== 'all' && String(item.year) !== String(prefs.fy)) return false;
    }
    return true;
  });
  const by = {
    recent: (a, b) => b.addedAt - a.addedAt || a.title.localeCompare(b.title),
    az: (a, b) => a.title.localeCompare(b.title),
    year: (a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || a.title.localeCompare(b.title),
    drive: (a, b) => (a.driveName || '~').localeCompare(b.driveName || '~') || a.title.localeCompare(b.title)
  }[prefs.sort] || (() => 0);
  items.sort(by);
  return route.view === 'movie' && prefs.groupVer !== false ? groupVersions(items) : items;
}

function reasonFor(item) {
  if (!MEDIA.has(item.type)) return item.online ? 'No cover image in folder' : 'Drive offline, folder not checked';
  switch (item.posterStatus) {
    case 'not_found': return 'Not found on TMDB';
    case 'no_key': return 'Needs a TMDB key';
    case 'bad_key': return 'TMDB key was rejected';
    case 'error': return 'Network error, will retry';
    default: return 'Not fetched yet';
  }
}

function listRowHTML(item) {
  return `
    <div class="card row" data-id="${escapeAttr(item.id)}">
      <div class="thumb poster${item.type === 'music' ? ' square' : ''}">${posterInner(item)}</div>
      <div class="row-title">${escapeHtml(shownTitle(item))}
        <small>${escapeHtml([item.artist, item.type === 'movie' || item.type === 'series' ? '' : item.year, item.type === 'series' ? seasonSummary(item) : '', item.size ? fmtBytes(item.size) : '', driveLine(item)].filter(Boolean).join(' · '))}</small></div>
      ${qualityChip(item)}
      <span class="badge badge-${escapeAttr(item.type)}">${TYPE_LABEL[item.type] || cap(item.type)}</span>
      ${item.rating ? stars(item.rating) : ''}
      ${onlineChip(item.online)}
      ${canPlay(item) ? '<button class="secondary small-btn" data-play>▶ Play</button>' : ''}
      ${item.type === 'series' ? '<button class="secondary small-btn" data-notshow title="This is really a movie">Not a TV Show → Movies</button><button class="secondary small-btn" data-hideshow>Remove from TV Series</button>' : ''}
      ${item.type === 'movie' ? '<button class="secondary small-btn" data-asshow>Not a Movie → TV Show</button>' : ''}
      <button class="secondary small-btn" data-open>Open</button>
    </div>`;
}

function noPosterRow(item) {
  return `
    <div class="row" data-open-path="${escapeAttr(item.id)}">
      <div class="row-title">${escapeHtml(item.title || 'Unknown')}<small>${escapeHtml(item.path)}</small></div>
      <span class="badge badge-${escapeAttr(item.type)}">${TYPE_LABEL[item.type] || cap(item.type)}</span>
      <span class="reason">${escapeHtml(reasonFor(item))}</span>
    </div>`;
}

// a big library is drawn in chunks as you scroll, so the page opens at once instead of building thousands of cards
const BATCH = 150;
let moreObs = null;
function setupMore(items, build) {
  if (moreObs) { moreObs.disconnect(); moreObs = null; }
  const sentinel = $('#moreSentinel'), box = content.querySelector('.grid, .rows');
  if (!sentinel || !box || items.length <= BATCH || typeof IntersectionObserver === 'undefined') return;
  let shown = BATCH;
  moreObs = new IntersectionObserver((entries) => {
    if (!entries.some(e => e.isIntersecting)) return;
    const chunk = items.slice(shown, shown + BATCH); shown += chunk.length;
    const tmp = document.createElement('div'); tmp.innerHTML = chunk.map(build).join('');
    bindCards(tmp);
    while (tmp.firstChild) box.appendChild(tmp.firstChild);
    queuePosters(chunk);
    if (shown >= items.length) { moreObs.disconnect(); moreObs = null; sentinel.remove(); }
  }, { root: content, rootMargin: '900px 0px' });
  moreObs.observe(sentinel);
}

function renderBrowse() {
  let moreBuild = null;
  const items = visibleItems();
  const missingPosters = library.filter(i => !i.poster).length;
  const isMusic = route.view === 'music';
  const title = { all: 'Library', movie: 'Movies', series: 'TV Series', music: 'Music', game: 'Games', noposter: 'No Poster' }[route.view] || 'Library';

  const toolbar = route.view === 'noposter' ? '' : MEDIA_FILTERS.has(route.view) ? filterBarHTML() : `
    <div class="toolbar">
      <div class="pills">${PILLS.map(([k, l]) => `<button class="pill${prefs.filter === k ? ' active' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
      <div class="tool-right">
        <select id="sortSel" aria-label="Sort">${SORTS.map(([k, l]) => `<option value="${k}"${prefs.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <div class="seg"><button data-layout="grid" class="${prefs.layout === 'grid' ? 'active' : ''}" title="Grid">▦</button><button data-layout="list" class="${prefs.layout === 'list' ? 'active' : ''}" title="List">☰</button></div>
      </div>
    </div>`;
  const musicTabs = isMusic ? `<div class="tabs"><button data-mtab="artists" class="${prefs.musicTab2 !== 'albums' ? 'active' : ''}">Artists</button><button data-mtab="albums" class="${prefs.musicTab2 === 'albums' ? 'active' : ''}">All albums</button></div>` : '';
  const head = `<div class="page-head"><h1>${title}</h1><p>${items.length.toLocaleString()} item${items.length === 1 ? '' : 's'}${route.view === 'noposter' ? '' : missingPosters ? ` · ${missingPosters} without a poster` : ''}</p></div>`;

  let body;
  if (!items.length && !(isMusic && singles.length)) {
    body = `<div class="empty">${route.view === 'noposter' ? 'Every item has a poster.' : library.length ? 'Nothing matches these filters.' : 'No items yet. Click “Scan Folder / Drive” to add media.'}</div>`;
  } else if (route.view === 'noposter') {
    body = `<div class="rows">${items.map(noPosterRow).join('')}</div>`;
  } else if (isMusic && prefs.musicTab2 !== 'albums') {
    const groups = new Map();
    const w = searchTerm.toLowerCase();
    const add = (i, k) => { const a = i.artist || 'Unknown artist'; const g = groups.get(a) || groups.set(a, { albums: [], singles: [] }).get(a); g[k].push(i); };
    items.forEach(i => add(i, 'albums'));
    singles.filter(i => !w || `${i.title} ${i.artist}`.toLowerCase().includes(w)).forEach(i => add(i, 'singles'));
    body = `<div class="rows">${[...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([a, g]) => `
      <div class="row" data-artist="${escapeAttr(a)}"><div class="row-title">${escapeHtml(a)}<small>${g.albums.slice(0, 4).map(x => escapeHtml(x.title)).join(' · ')}${g.albums.length > 4 ? ' …' : ''}</small></div>
      <span class="chip chip-grey">${[g.albums.length ? `${g.albums.length} album${g.albums.length === 1 ? '' : 's'}` : '', g.singles.length ? `${g.singles.length} single${g.singles.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</span></div>`).join('')}</div>`;
  } else if (prefs.layout === 'list') {
    body = `<div class="rows">${items.slice(0, BATCH).map(listRowHTML).join('')}</div>${items.length > BATCH ? '<div id="moreSentinel" class="more-sentinel"></div>' : ''}`;
    moreBuild = listRowHTML;
  } else {
    body = `<div class="grid${isMusic ? ' music-grid' : ''}">${items.slice(0, BATCH).map(i => cardHTML(i)).join('')}</div>${items.length > BATCH ? '<div id="moreSentinel" class="more-sentinel"></div>' : ''}`;
    moreBuild = (i) => cardHTML(i);
  }
  if (isMusic) { renderMusicBrowse(items); return; }
  const cands = route.view === 'game' ? gameCands : [];
  const rej = route.view === 'game' ? gameRejected : [];
  const candBox = cands.length ? `
    <details class="rv-none game-cands" open><summary>Possible games to confirm (${cands.length}) <button class="secondary small-btn" id="gcAll">Confirm all</button> <button class="secondary small-btn" id="gcNone">Remove all</button></summary>
      <div class="rows">${cands.slice(0, 300).map(g => `
        <div class="row" data-gid="${escapeAttr(g.id)}"><div class="row-title">${escapeHtml(g.title)}<small>${escapeHtml([g.size ? fmtBytes(g.size) : '', g.driveName, g.path].filter(Boolean).join(' · '))}</small></div>
          <button class="secondary small-btn" data-gopen>Open folder</button>
          <button class="small-btn" data-gyes>Yes, a game</button>
          <button class="secondary small-btn" data-gno title="Not a game: remove it from this list">Remove</button></div>`).join('')}</div>
    </details>` : '';
  const rejBox = rej.length ? `
    <details class="rv-none"><summary>Removed: marked as not a game (${rej.length})</summary>
      <div class="rows">${rej.slice(0, 300).map(g => `
        <div class="row" data-rid="${escapeAttr(g.id)}"><div class="row-title">${escapeHtml(g.title)}<small>${escapeHtml([g.size ? fmtBytes(g.size) : '', g.driveName, g.path].filter(Boolean).join(' · '))}</small></div>
          <button class="secondary small-btn" data-rback>Put back</button></div>`).join('')}</div>
    </details>` : '';
  content.innerHTML = head + candBox + musicTabs + toolbar + body + rejBox;
  const setGames = async (ids, state) => { setLibrary(await window.api.setGameState(ids, state)); render(); };
  content.querySelectorAll('[data-gid]').forEach(r => {
    const id = r.dataset.gid;
    r.querySelector('[data-gyes]').addEventListener('click', () => setGames([id], 'yes'));
    r.querySelector('[data-gno]').addEventListener('click', () => setGames([id], 'no'));
    r.querySelector('[data-gopen]').addEventListener('click', () => { const it = byId.get(id); if (it) openFolder(it.path, it); });
  });
  content.querySelectorAll('[data-rid]').forEach(r => r.querySelector('[data-rback]').addEventListener('click', async () => { setLibrary(await window.api.setGameState([r.dataset.rid], 'clear')); render(); }));
  const ga = $('#gcAll'); if (ga) ga.addEventListener('click', (e) => { e.preventDefault(); setGames(cands.map(g => g.id), 'yes'); });
  const gn = $('#gcNone'); if (gn) gn.addEventListener('click', (e) => { e.preventDefault(); setGames(cands.map(g => g.id), 'no'); });
  if (cands.length) queuePosters(cands.slice(0, 60));

  content.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { prefs.filter = b.dataset.filter; savePrefs(); render(); }));
  content.querySelectorAll('[data-gv]').forEach(c => c.addEventListener('change', () => { prefs.groupVer = c.checked; savePrefs(); render(); }));
  content.querySelectorAll('[data-tvc]').forEach(b => b.addEventListener('click', () => { prefs.tvc = b.dataset.tvc; savePrefs(); render(); }));
  content.querySelectorAll('[data-f]').forEach(el => el.addEventListener('change', () => {
    if (el.id === 'favail') prefs.filter = el.value; else if (el.id !== 'sortSel') prefs[el.id] = el.value; else return;
    savePrefs(); render();
  }));
  const fc = $('#fclear'); if (fc) fc.addEventListener('click', () => { for (const k of ['fq', 'fg', 'fl', 'fr', 'fy', 'fs']) prefs[k] = 'all'; prefs.filter = 'all'; prefs.tvc = 'all'; savePrefs(); render(); });
  const sel = $('#sortSel'); if (sel) sel.addEventListener('change', () => { prefs.sort = sel.value; savePrefs(); render(); });
  content.querySelectorAll('[data-layout]').forEach(b => b.addEventListener('click', () => { prefs.layout = b.dataset.layout; savePrefs(); render(); }));
  content.querySelectorAll('[data-mtab]').forEach(b => b.addEventListener('click', () => { prefs.musicTab2 = b.dataset.mtab; savePrefs(); render(); }));
  content.querySelectorAll('[data-artist]').forEach(r => r.addEventListener('click', () => go({ view: 'artist', name: r.dataset.artist })));
  content.querySelectorAll('[data-open-path]').forEach(r => r.addEventListener('click', () => { const it = byId.get(r.dataset.openPath); if (it) openFolder(it.path, it); }));
  bindCards(content);
  queuePosters(items.slice(0, BATCH));
  if (moreBuild) setupMore(items, moreBuild);
}

// ---------- posters ----------
function paintPoster(item) {
  const sel = `[data-id="${CSS.escape(item.id)}"]`;
  content.querySelectorAll(`${sel} .poster, ${sel}.poster`).forEach(el => {
    const keep = [...el.children].filter(c => c.classList && (c.classList.contains('year-chip') || c.classList.contains('off-chip') || c.classList.contains('open-btn')));
    el.innerHTML = `<img class="poster-img" src="${escapeAttr(item.poster)}" alt="">`;
    keep.forEach(k => el.appendChild(k));
  });
}

function applyPoster(id, r) {
  const item = byId.get(id);
  if (!item || !r) return;
  item.posterStatus = r.status;
  if (r.poster) {
    item.poster = r.poster;
    paintPoster(item);
  } else if (r.status === 'no_key' || r.status === 'bad_key') {
    keyBtn.classList.add('attention');
    setStatus(r.status === 'no_key' ? 'Add your TMDB key to download posters' : 'TMDB key was rejected, please re-enter it');
  }
}

// Lazy loading: at most 6 requests in flight; items we already asked about or know are missing are skipped
const pending = [];
let active = 0;
function queuePosters(items) {
  for (const item of items) {
    if (item.poster || requested.has(item.id) || item.posterStatus === 'not_found') continue;
    requested.add(item.id);
    pending.push(item);
  }
  pump();
}
function pump() {
  while (active < 6 && pending.length) {
    const item = pending.shift();
    active++;
    window.api
      .fetchPoster({ id: item.id, path: item.path, title: item.title, year: item.year, type: item.type, driveId: item.driveId, rel: item.rel })
      .then(r => applyPoster(item.id, r))
      .catch(() => {})
      .finally(() => { active--; pump(); });
  }
}

// A poster file that fails to load falls back to the title text (error events don't bubble, so capture them)
content.addEventListener('error', (e) => {
  const img = e.target;
  if (img && img.classList && img.classList.contains('poster-img')) {
    const title = img.closest('.card')?.querySelector('.title')?.textContent || 'No Poster';
    img.parentElement.textContent = title;
  }
}, true);

window.api.onPosterProgress((p) => {
  setStatus(`Posters ${p.done}/${p.total} · ${p.found} found · ${p.notFound} not found${p.errors ? ` · ${p.errors} errors` : ''}`);
  if (p.id && p.poster) {
    const item = byId.get(p.id);
    if (item) { item.poster = p.poster; item.posterStatus = 'ok'; paintPoster(item); }
  }
});

async function fetchMissing() {
  if (fetching) return;
  fetching = true;
  fetchBtn.disabled = true;
  setStatus('Looking for posters...');
  try {
    const res = await window.api.fetchMissingPosters({ retryFailed: true });
    if (res.busy) return;
    setLibrary(await window.api.getLibrary());
    render();
    const left = library.filter(i => !i.poster).length;
    setStatus(`Done: ${res.found} new poster${res.found === 1 ? '' : 's'}, ${res.notFound} not found${res.errors ? `, ${res.errors} errors` : ''}. ${left} still missing.`);
    if (res.badKey) openKeyDialog('TMDB rejected the saved key. Please enter it again.');
    else if (res.noKey) openKeyDialog('Add your TMDB API key to download the remaining posters.');
    else if (res.netDown) setStatus(`Cannot reach TMDB right now${res.lastError ? ' (' + res.lastError + ')' : ''}. Stopped early so you are not kept waiting. Check your internet; some networks block themoviedb.org, so try another network, a VPN, or DNS 1.1.1.1. Then press Fetch Posters again.`);
  } catch (e) {
    console.error(e);
    setStatus('Poster fetch failed');
  } finally {
    fetching = false;
    fetchBtn.disabled = false;
  }
}
fetchBtn.addEventListener('click', fetchMissing);

// ---------- metadata sync (episodes, cast, franchises) ----------
let syncT0 = 0;
window.api.onMetaProgress((p) => {
  if (!syncT0 || p.done <= 1) syncT0 = Date.now();
  const el = (Date.now() - syncT0) / 1000;
  let eta = '';
  if (p.done >= 3 && p.total > p.done && el > 2) { const left = Math.round(el / p.done * (p.total - p.done)); eta = left >= 90 ? ` · about ${Math.round(left / 60)} min left` : ` · about ${Math.max(5, Math.round(left / 5) * 5)} sec left`; }
  if (p.done >= p.total) syncT0 = 0;
  setStatus(`${p.phase === 'titles' ? 'Syncing info' : 'Syncing franchises'} ${p.done}/${p.total}${eta}…`);
});

async function syncMeta() {
  if (syncing) return;
  syncing = true;
  syncBtn.disabled = true;
  setStatus('Syncing info…');
  try {
    const r = await window.api.syncMetadata({});
    if (r.noKey) openKeyDialog('Add your TMDB key to sync episode, franchise and cast info.');
    else if (r.badKey) openKeyDialog('TMDB rejected the saved key. Please enter it again.');
    else if (r.netDown) setStatus(`Cannot reach TMDB right now${r.lastError ? ' (' + r.lastError + ')' : ''}. Sync stopped early. Check your internet, or try another network/VPN, then press Sync Info again.`);
    else if (!r.busy) setStatus(`Synced ${r.resolved} title${r.resolved === 1 ? '' : 's'}${r.unresolved ? ` · ${r.unresolved} not matched` : ''}${r.errors ? ` · ${r.errors} errors` : ''}`);
  } catch (e) {
    console.error(e);
    setStatus('Sync failed');
  } finally {
    syncing = false;
    syncBtn.disabled = false;
    setLibrary(await window.api.getLibrary());
    render();
    loadSearchIndex();
  }
}
syncBtn.addEventListener('click', syncMeta);

// ---------- TMDB key dialog ----------
async function openKeyDialog(message) {
  const s = await window.api.getSettings();
  keyInput.value = '';
  keyInput.placeholder = s.hasKey && !s.keyInvalid
    ? `Key is set (${s.keySource === 'env' ? 'from environment' : 'saved in app'}). Paste to replace`
    : 'Paste your TMDB key or token';
  keyMsg.textContent = message || '';
  if (!keyDialog.open) keyDialog.showModal();
  keyInput.focus();
}

keyBtn.addEventListener('click', () => openKeyDialog());
$('#keyCancel').addEventListener('click', () => keyDialog.close());
keyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!keyInput.value.trim()) { keyDialog.close(); return; }
  keySave.disabled = true;
  keyMsg.textContent = 'Verifying...';
  try {
    const r = await window.api.setTmdbKey(keyInput.value);
    if (!r.ok) { keyMsg.textContent = r.error; return; }
    keyDialog.close();
    keyBtn.classList.remove('attention');
    requested.clear();
    fetchMissing().then(syncMeta);
  } finally {
    keySave.disabled = false;
  }
});

// ---------- scan / clear ----------
window.api.onScanProgress((data) => setStatus(`Scanning... ${data.count} found (${data.current})`));

async function scanFolder(folder) {
  if (!folder) return;
  setStatus('Scanning...');
  try {
    setLibrary(await window.api.scan(folder));
    setStatus(`Found ${library.length} items`);
    refreshSideDrives();
    render();
    refreshBadges();
  } catch (e) {
    setStatus('Scan failed');
    console.error(e);
  }
}

$('#scanBtn').addEventListener('click', async () => scanFolder(await window.api.selectFolder()));

$('#clearBtn').addEventListener('click', async () => {
  const info = await window.api.getClearInfo();
  if (!info.items) { setStatus('The library is already empty.'); return; }
  const r = await confirmBox({
    title: 'Clear the library?',
    body: `<p>This removes <b>${info.items.toLocaleString()} item${info.items === 1 ? '' : 's'}</b> from the catalog.</p>
      <p>Your files on the drives are <b>not touched</b>. Your <b>${info.drives} drive name${info.drives === 1 ? '' : 's'} and shelf labels are kept</b>.</p>`,
    checkbox: info.posters ? `Also delete the ${info.posters.toLocaleString()} downloaded posters (they would need to download again)` : null,
    okText: 'Clear library', danger: true
  });
  if (!r.ok) return;
  setLibrary(await window.api.clearLibrary({ deletePosters: r.checked }));
  requested.clear();
  render();
  refreshSideDrives();
  setStatus('Library cleared. Scan a drive to rebuild it.');
});

window.api.onScanReport((x) => {
  const bits = [`${x.new} new`, `${x.removed} no longer there`, `${x.changed} changed`];
  setStatus(`${x.drive}: ${x.first ? `${x.total} items catalogued` : bits.join(', ')}${x.unreadable ? ` · ${x.unreadable} folder${x.unreadable === 1 ? '' : 's'} could not be read` : ''}. See Backup & History.`);
});
window.api.onDrivesChanged(() => loadLibrary({ quiet: true }));


// ---------- search ----------
$('#search').addEventListener('input', (e) => {
  searchTerm = e.target.value.trim();
  if (!BROWSE.has(route.view)) go({ view: 'all' }, { nav: true });
  else render();
});

// Ctrl+K quick search: titles, artists and people from cached cast lists
const palette = $('#palette');
const pInput = $('#paletteInput');
const pList = $('#paletteList');
let pItems = [];
let pIdx = 0;
let pTimer = null;

function openPalette() {
  pInput.value = '';
  pItems = []; pIdx = 0; pList.innerHTML = '';
  if (!palette.open) palette.showModal();
  pInput.focus();
}
function drawPalette() {
  pList.innerHTML = pItems.length
    ? pItems.map((x, i) => `<div class="pal-row${i === pIdx ? ' active' : ''}" data-i="${i}">
        <span class="pal-kind">${x.kind === 'person' ? 'Person' : TYPE_LABEL[x.type] || 'Item'}</span>
        <b>${escapeHtml(x.kind === 'person' ? x.name : x.title)}</b>
        <small>${escapeHtml(x.kind === 'person' ? '' : [x.artist, x.year, x.related ? 'cast / crew / genre match' : ''].filter(Boolean).join(' · '))}</small></div>`).join('')
    : (pInput.value.trim() ? '<div class="muted pad">No matches.</div>' : '');
  pList.querySelectorAll('.pal-row').forEach(r => r.addEventListener('click', () => choosePalette(+r.dataset.i)));
}
function choosePalette(i) {
  const x = pItems[i];
  if (!x) return;
  palette.close();
  if (x.kind === 'person') go({ view: 'person', id: x.id });
  else openItem(byId.get(x.id));
}
pInput.addEventListener('input', () => {
  clearTimeout(pTimer);
  pTimer = setTimeout(async () => {
    const r = await window.api.searchAll(pInput.value);
    pItems = [...r.titles.map(t => ({ kind: 'title', ...t })), ...r.people.map(p => ({ kind: 'person', ...p })), ...(r.related || []).map(t => ({ kind: 'title', related: true, ...t }))];
    pIdx = 0;
    drawPalette();
  }, 120);
});
pInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); pIdx = Math.min(pItems.length - 1, pIdx + 1); drawPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); pIdx = Math.max(0, pIdx - 1); drawPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); choosePalette(pIdx); }
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
});
palette.addEventListener('click', (e) => { if (e.target === palette) palette.close(); });

loadLibrary();
initApp();

(() => {
  const rm = document.getElementById('demoRemove'); if (!rm) return;
  rm.addEventListener('click', async () => { const r = await window.api.clearDemo(); setLibrary(await window.api.getLibrary()); refreshSideDrives(); setStatus(`Demo catalog removed (${r.removed} items).`); render(); });
  const lm = document.getElementById('demoLearn'); if (lm) lm.addEventListener('click', () => go({ view: 'settings' }, { nav: true }));
})();

window.api.getAppInfo().then((a) => { const slot = document.getElementById('tmdbLogoSlot'); if (slot && a && a.tmdbLogo) slot.innerHTML = '<img src="assets/tmdb.svg" alt="TMDB" class="credit-logo">'; }).catch(() => {});
