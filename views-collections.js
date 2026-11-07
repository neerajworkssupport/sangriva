// Collections: one tile per franchise you own part of; click for every part in release order.
let collectionsCache = null;

async function loadCollections() {
  collectionsCache = await window.api.getCollections();
  return collectionsCache;
}

const COLL_SORTS = [['az', 'Name A–Z'], ['most', 'Most missing'], ['least', 'Fewest missing'], ['owned', 'Most owned'], ['pct', '% complete']];
const PART_SORTS = [['release', 'Release order'], ['az', 'Name A–Z'], ['missing', 'Missing first'], ['owned', 'Owned first']];

/** One franchise seen as movies only or series only (a universe can hold both). */
function collView(c) {
  const parts = c.parts;
  const owned = parts.filter(p => p.owned).length;
  const missing = parts.filter(p => !p.owned && !p.upcoming).length;
  const covers = parts.filter(p => p.owned && p.itemId && byId.get(p.itemId)).map(p => byId.get(p.itemId).poster).filter(Boolean).slice(0, 3);
  return { ...c, parts, owned, total: parts.length, missing, covers };
}

function collectionTile(c) {
  const covers = c.covers.slice(0, 3);
  const pct = c.total ? Math.round((c.owned / c.total) * 100) : 0;
  return `
    <div class="coll-tile" data-coll="${escapeAttr(c.key)}">
      <div class="coll-covers">${covers.length ? covers.map(u => `<img src="${escapeAttr(u)}" alt="">`).join('') : '<span class="muted">No posters yet</span>'}</div>
      <div class="info">
        <div class="title" title="${escapeAttr(c.name)}">${escapeHtml(c.name)}</div>
        <div class="bar small"><i style="width:${pct}%"></i></div>
        <div class="meta"><span>You own ${c.owned} of ${c.total}</span>${c.missing ? statusChip('red', `${c.missing} missing`) : statusChip('green', 'Complete')}</div>
      </div>
    </div>`;
}

const collStatus = () => (['incomplete', 'complete'].includes(prefs.collStatus) ? prefs.collStatus : 'all');

async function renderCollections() {
  const token = renderToken;
  content.innerHTML = '<div class="empty">Loading…</div>';
  const r = await loadCollections();
  if (token !== renderToken) return;
  const status = collStatus();
  const sortBy = COLL_SORTS.some(x => x[0] === prefs.collSort) ? prefs.collSort : 'az';
  const base = r.collections.map(collView).filter(c => c.owned >= 1 && c.total >= 2);
  const nInc = base.filter(c => c.missing).length, nCom = base.length - nInc;
  const cmp = {
    az: (a, b) => a.name.localeCompare(b.name),
    most: (a, b) => b.missing - a.missing || a.name.localeCompare(b.name),
    least: (a, b) => a.missing - b.missing || a.name.localeCompare(b.name),
    owned: (a, b) => b.owned - a.owned || a.name.localeCompare(b.name),
    pct: (a, b) => (b.owned / b.total) - (a.owned / a.total) || a.name.localeCompare(b.name)
  }[sortBy];
  const w = searchTerm.toLowerCase();
  const list = base.filter(c => (status === 'all' || (status === 'incomplete' ? c.missing : !c.missing)) && (!w || c.name.toLowerCase().includes(w))).sort(cmp);
  const notSynced = r.synced.eligible && r.synced.withDetails < r.synced.eligible;
  const sync = notSynced ? `<div class="banner">Franchise info is ready for ${r.synced.withDetails} of ${r.synced.eligible} titles.
      <button id="colSync" class="secondary">${r.synced.hasKey ? 'Sync info now' : 'Add TMDB key'}</button></div>` : '';
  const pill = (k, label, n, cur, attr) => `<button class="pill${cur === k ? ' active' : ''}" ${attr}="${k}">${label} (${n})</button>`;
  content.innerHTML = `
    <div class="page-head"><h1>Collections</h1><p>Franchises and sagas with two or more titles, where you own at least one. Click one to see every part.</p>
      <button class="secondary small-btn" id="manageFr">Manage Franchises…</button></div>
    ${sync}
    <div class="toolbar coll-bar">
      <div class="pills">${pill('all', 'All', base.length, status, 'data-cstatus')}${pill('incomplete', 'Incomplete', nInc, status, 'data-cstatus')}${pill('complete', 'Complete', nCom, status, 'data-cstatus')}</div>
      <label class="arrange">Arrange <select id="collSort">${COLL_SORTS.map(([k, l]) => `<option value="${k}"${sortBy === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    ${list.length ? `<div class="coll-grid">${list.map(collectionTile).join('')}</div>`
      : `<div class="empty">${!r.collections.length ? (r.synced.withDetails ? 'No franchises found among your titles yet.' : 'Sync info to find franchises such as Harry Potter or the MCU.') : 'Nothing matches these buttons.'}</div>`}`;
  content.querySelectorAll('[data-coll]').forEach(t => t.addEventListener('click', () => go({ view: 'collection', key: t.dataset.coll })));
  content.querySelectorAll('[data-cstatus]').forEach(b => b.addEventListener('click', () => { prefs.collStatus = b.dataset.cstatus; savePrefs(); renderCollections(); }));
  $('#collSort').addEventListener('change', (e) => { prefs.collSort = e.target.value; savePrefs(); renderCollections(); });
  $('#manageFr').addEventListener('click', () => openFranchiseEditor(() => renderCollections()));
  const b = $('#colSync');
  if (b) b.addEventListener('click', () => (r.synced.hasKey ? syncMeta() : openKeyDialog('Add your TMDB key to sync franchise info.')));
}

async function renderCollection(key) {
  const token = renderToken;
  content.innerHTML = '<button class="secondary back" data-back>← Back</button><div class="empty">Loading…</div>';
  $('[data-back]').addEventListener('click', back);
  const r = await loadCollections();
  if (token !== renderToken) return;
  const raw = r.collections.find(x => x.key === key);
  if (!raw) { content.innerHTML = '<button class="secondary back" data-back>← Back</button><div class="empty">This franchise is no longer listed.</div>'; $('[data-back]').addEventListener('click', back); return; }
  const c = collView(raw);
  const sortBy = PART_SORTS.some(x => x[0] === prefs.partSort) ? prefs.partSort : 'release';
  const show = ['owned', 'missing'].includes(prefs.partShow) ? prefs.partShow : 'all';

  const firstMissing = c.parts.findIndex(p => !p.owned && !p.upcoming);
  const nextId = firstMissing >= 0 ? c.parts[firstMissing].id : null;
  let parts = c.parts.filter(p => show === 'all' || (show === 'owned' ? p.owned : !p.owned));
  const cmp = {
    release: null,
    az: (a, b) => a.title.localeCompare(b.title),
    missing: (a, b) => (a.owned - b.owned) || 0,
    owned: (a, b) => (b.owned - a.owned) || 0
  }[sortBy];
  if (cmp) parts = parts.map((p, i) => [p, i]).sort((x, y) => cmp(x[0], y[0]) || x[1] - y[1]).map(x => x[0]);
  const cardOf = (p) => {
    const it = p.itemId ? byId.get(p.itemId) : null;
    const next = p.id === nextId ? ' ' + statusChip('orange', 'Next to get') : '';
    return it ? cardHTML(it, { showOpen: true }) : ghostCardHTML(p, { tag: next });
  };
  const cards = parts.map(cardOf).join('');
  // a big universe is split into its sub-series (Iron Man, Thor, TV series…)
  let body = `<div class="grid" style="margin-top:12px">${cards || '<div class="empty">Nothing here.</div>'}</div>`;
  if (c.groups && c.groups.length > 1) {
    const key = (p) => `${p.type === 'tv' ? 'tv' : 'movie'}:${p.id}`;
    const sections = c.groups.map(g => {
      const ids = new Set(g.ids);
      const inAll = c.parts.filter(p => ids.has(key(p)));
      const shown = parts.filter(p => ids.has(key(p)));
      if (!shown.length) return '';
      const o = inAll.filter(p => p.owned).length;
      return `<details class="panel fran grp" open><summary class="panel-head"><h2>${escapeHtml(g.name)}</h2><span class="muted">${o} of ${inAll.length}</span>${o === inAll.length ? statusChip('green', 'Complete') : ''}</summary>
        <div class="grid" style="margin-top:8px">${shown.map(cardOf).join('')}</div></details>`;
    }).join('');
    if (sections) body = `<div style="margin-top:12px">${sections}</div>`;
  }
  const nOwned = c.parts.filter(p => p.owned).length, nMiss = c.parts.length - nOwned;
  const pill = (k, label, n) => `<button class="pill${show === k ? ' active' : ''}" data-pshow="${k}">${label} (${n})</button>`;

  content.innerHTML = `
    <button class="secondary back" data-back>← Back</button>
    <div class="page-head"><h1>${escapeHtml(c.name)}</h1>
      <p>You own ${c.owned} of ${c.total}${c.missing ? ` · ${c.missing} missing` : ' · Complete'}</p></div>
    <div class="bar"><i style="width:${c.total ? Math.round((c.owned / c.total) * 100) : 0}%"></i></div>
    <div class="toolbar coll-bar" style="margin-top:16px">
      <div class="pills">${pill('all', 'All', c.parts.length)}${pill('owned', 'Owned', nOwned)}${pill('missing', 'Missing', nMiss)}</div>
      <label class="arrange">Arrange <select id="partSort">${PART_SORTS.map(([k, l]) => `<option value="${k}"${sortBy === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    ${body}`;
  $('[data-back]').addEventListener('click', back);
  content.querySelectorAll('[data-pshow]').forEach(b => b.addEventListener('click', () => { prefs.partShow = b.dataset.pshow; savePrefs(); renderCollection(key); }));
  $('#partSort').addEventListener('change', (e) => { prefs.partSort = e.target.value; savePrefs(); renderCollection(key); });
  bindCards(content);
  bindWish(content);
  queuePosters(c.parts.map(p => (p.itemId ? byId.get(p.itemId) : null)).filter(Boolean));
}
