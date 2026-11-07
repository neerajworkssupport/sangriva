// Small helpers shared by all views (plain scripts, no bundler).
const $ = (sel, root = document) => root.querySelector(sel);

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const TYPE_LABEL = { movie: 'Movie', series: 'Series', music: 'Album', game: 'Game' };

function fmtBytes(n) {
  if (n == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${i === 0 || n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

function fmtDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtDay(s) {
  if (!s) return '';
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d) ? s : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function ago(ts) {
  if (!ts) return 'never';
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return fmtDay(new Date(ts).toISOString().slice(0, 10));
}

function stars(rating) {
  if (rating == null) return '';
  const n = Math.max(0, Math.min(5, Math.round(rating / 2)));
  return `<span class="stars" title="${rating}/10">${'★'.repeat(n)}${'☆'.repeat(5 - n)} <b>${Number(rating).toFixed(1)}</b></span>`;
}

const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

function posterInner(item) {
  return item.poster
    ? `<img class="poster-img" src="${escapeAttr(item.poster)}" alt="">`
    : escapeHtml(item.title || 'No Title');
}

function seasonSummary(item) {
  const n = (item.seasons || []).length;
  const parts = [];
  if (n) parts.push(`${n} season${n === 1 ? '' : 's'}`);
  if (item.episodes) parts.push(`${item.episodes} episode${item.episodes === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function driveLine(item) {
  const bits = [item.driveName, item.shelf].filter(Boolean);
  return bits.join(' · ');
}

let statusTimer = null;
function setStatus(text) {
  $('#status').textContent = text;
  clearTimeout(statusTimer);
  if (text && text !== 'Ready') statusTimer = setTimeout(() => { $('#status').textContent = 'Ready'; }, 12000); // messages fade back to Ready
}

const statusChip = (kind, text) => `<span class="chip chip-${kind}">${escapeHtml(text)}</span>`;
const onlineChip = (online) => (online ? '<span class="badge online">Online</span>' : '<span class="badge offline">Offline</span>');

const shownTitle = (item) => item.displayTitle || item.title || 'Unknown';

/** "4K · HEVC" style chip for the best-known quality of a movie/series. */
function qualityChip(item) {
  const q = item && item.quality;
  if (!q || !q.res) return '';
  const extra = (q.tags || []).filter(t => ['REMUX', 'HEVC', 'AV1', 'HDR', 'IMAX', '3D'].includes(t)).slice(0, 2);
  return `<span class="q-chip" title="${escapeAttr([q.res, ...(q.tags || [])].join(' · '))}">${escapeHtml([q.res, ...extra].join(' · '))}</span>`;
}

const canPlay = (item) => item && (item.type === 'movie' || item.type === 'series' || item.type === 'music');

/** Standard poster card used on Overview, Library and franchise views. */
/** Card for something you do not own: poster when we have one, a ♡ to add it to the wishlist. */
function ghostCardHTML(p, { tag = '' } = {}) {
  const type = p.type === 'tv' ? 'tv' : 'movie';
  return `<div class="card ghost">${wishBtn({ kind: 'title', type, tmdbId: p.id, title: p.title, year: p.year || null, poster: p.posterRaw || p.rawPoster || null })}
    <div class="poster">${p.poster ? `<img class="poster-img" src="${escapeAttr(p.poster)}" alt="">` : escapeHtml(p.title)}${p.year ? `<span class="year-chip">${p.year}</span>` : ''}</div>
    <div class="info"><div class="title" title="${escapeAttr(p.title)}">${escapeHtml(p.title)}</div>
    <div class="meta">${type === 'tv' ? statusChip('blue', 'Series') + ' ' : ''}${p.upcoming ? statusChip('grey', 'Not released yet') : statusChip('red', 'Not in library')}${tag}</div></div></div>`;
}

function tvDot(item) {
  if (item.type !== 'series' || !item.tvStatus) return '';
  const ok = item.tvStatus === 'complete';
  return `<span class="tv-dot ${ok ? 'green' : 'orange'}" title="${ok ? 'All aired episodes are in your library' : 'Some episodes are missing'}"></span>`;
}

function cardHTML(item, { showOpen = true } = {}) {
  const square = item.type === 'music' ? ' square' : '';
  const sub = item.type === 'series' && seasonSummary(item) ? seasonSummary(item)
    : item.type === 'music' ? (item.artist || '')
    : (item.genres && item.genres.length ? item.genres.slice(0, 2).join(', ') : '');
  const hasYearInTitle = item.type === 'movie' || item.type === 'series';
  return `
    <div class="card" data-id="${escapeAttr(item.id)}"${item.gameDesc ? ` title="${escapeAttr(item.gameDesc)}"` : ''}>
      <div class="poster${square}">${posterInner(item)}
        ${item.year && !hasYearInTitle ? `<span class="year-chip">${item.year}</span>` : ''}
        ${qualityChip(item)}
        ${item.versionCount > 1 ? `<span class="ver-chip" title="Same movie in ${item.versionCount} qualities or copies. Open it to see them all.">${item.versionCount} versions</span>` : ''}
        ${tvDot(item)}
        ${item.type === 'movie' || item.type === 'series' ? `<div class="card-marks"><button class="mk${item.watched ? ' on' : ''}" data-mark="w" title="Watched">✓</button><button class="mk${item.fav ? ' on' : ''}" data-mark="f" title="Favourite">★</button><button class="mk${item.queued ? ' on' : ''}" data-mark="q" title="To watch">＋</button></div>` : ''}
        ${item.type === 'series' ? '<div class="card-xs"><button class="card-x" data-notshow title="This is really a movie: move it to Movies">Not a TV Show → Movies</button><button class="card-x" data-hideshow title="Take it out of TV Series (it waits in the Videos tab)">Remove from TV Series</button></div>' : ''}
        ${item.type === 'movie' ? '<div class="card-xs"><button class="card-x" data-asshow title="This is part of a TV show: move it to TV Series">Not a Movie → TV Show</button></div>' : ''}
        ${item.type === 'game' ? '<button class="card-x" data-gremove title="Not a game: remove it from Games">✕ Remove</button>' : ''}
        ${item.online ? '' : '<span class="off-chip">Offline</span>'}
        ${canPlay(item) ? '<button class="play-btn" data-play title="Play">▶</button>' : ''}
        ${showOpen ? '<button class="open-btn" data-open title="Open folder">Open</button>' : ''}
      </div>
      <div class="info">
        <div class="title" title="${escapeAttr(shownTitle(item))}">${escapeHtml(shownTitle(item))}</div>
        ${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''}
        <div class="meta"><span class="badge badge-${escapeAttr(item.type)}">${TYPE_LABEL[item.type] || cap(item.type)}</span>${item.rating ? stars(item.rating) : ''}</div>
        ${driveLine(item) ? `<div class="where">${escapeHtml(driveLine(item))}</div>` : ''}
      </div>
    </div>`;
}

/**
 * Small modal used for every confirmation. Resolves { ok, checked }.
 * opts: { title, body (html), okText, danger, checkbox: 'label' }
 */
function confirmBox({ title, body, okText = 'OK', danger = false, checkbox = null, cancelText = 'Cancel', hideCancel = false }) {
  const dlg = $('#confirmDialog');
  $('#confirmTitle').textContent = title;
  $('#confirmBody').innerHTML = body;
  const ok = $('#confirmOk');
  ok.textContent = okText;
  ok.classList.toggle('danger', !!danger);
  const cancel = $('#confirmCancel');
  cancel.textContent = cancelText;
  cancel.hidden = !!hideCancel;
  $('#confirmCheckRow').hidden = !checkbox;
  $('#confirmCheck').checked = false;
  if (checkbox) $('#confirmCheckText').textContent = checkbox;
  return new Promise((resolve) => {
    const done = (okay) => {
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      dlg.removeEventListener('cancel', onCancel);
      const checked = $('#confirmCheck').checked;
      if (dlg.open) dlg.close();
      resolve({ ok: okay, checked });
    };
    const onOk = (e) => { e.preventDefault(); done(true); };
    const onCancel = (e) => { if (e) e.preventDefault(); done(false); };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    dlg.addEventListener('cancel', onCancel);
    dlg.showModal();
  });
}

const PLAY_ERRORS = {
  offline: (item) => `${(item && item.driveName) || 'That drive'} is offline${item && item.shelf ? ` — it lives on ${item.shelf}` : ''}. Plug it in to play.`,
  nofile: () => 'Could not find a playable file in that folder.',
  gone: () => 'This item is no longer in the library.',
  unsupported: () => 'Games are opened from their folder.'
};

/** Opens a movie, an episode, an album or a track in the default player. */
async function playItem(item, extra = {}) {
  if (!item) return;
  if (!item.online) { setStatus(PLAY_ERRORS.offline(item)); return; }
  try {
    const r = await window.api.play({ id: item.id, ...extra });
    if (r.ok) setStatus(`Opening ${shownTitle(item)} in your player…`);
    else setStatus((PLAY_ERRORS[r.error] || (() => `Could not play: ${r.error}`))(item));
  } catch (e) {
    setStatus('Could not start the player.');
  }
}

// ---------- wishlist hearts (shown on missing items only) ----------
let wishKeys = new Set();
const wishKeyOf = (w) => (w.kind === 'upgrade' ? `up:${w.id}` : w.kind === 'episode' ? `ep:${w.showId}:${w.season}:${w.number}` : `${w.type}:${w.tmdbId}`);
/** ♡ / ♥ button for a missing movie, show or episode. w: { kind, type, tmdbId, title, year, poster } or { kind:'episode', showId, showTitle, season, number, name } */
function wishBtn(w) {
  const on = wishKeys.has(wishKeyOf(w));
  return `<button class="wish-btn${on ? ' on' : ''}" data-wish="${escapeAttr(JSON.stringify(w))}" title="${on ? 'On your wishlist (click to remove)' : 'Add to wishlist'}" aria-label="Wishlist">${on ? '♥' : '♡'}</button>`;
}
function bindWish(root) {
  root.querySelectorAll('[data-wish]').forEach(b => b.addEventListener('click', async (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    const w = JSON.parse(b.dataset.wish), key = wishKeyOf(w);
    const r = wishKeys.has(key) ? await window.api.wishlistRemove({ key }) : await window.api.wishlistAdd(w);
    if (r && r.keys) { wishKeys = new Set(r.keys); setWishBadge(); }
    const on = wishKeys.has(key);
    b.classList.toggle('on', on); b.textContent = on ? '♥' : '♡';
    b.title = on ? 'On your wishlist (click to remove)' : 'Add to wishlist';
  }));
}
function setWishBadge() {
  const el = document.getElementById('wishBadge');
  if (el) { el.textContent = wishKeys.size; el.hidden = !wishKeys.size; }
}
async function refreshWish() { try { wishKeys = new Set(await window.api.wishlistKeys()); setWishBadge(); } catch {} }
