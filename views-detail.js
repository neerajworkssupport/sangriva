// Movie / series detail page, and person (cast & crew) page.
const seasonChoice = {}; // series id -> selected season number

function banner(status) {
  const msg = {
    no_key: 'Add your TMDB key (top bar) to see cast, episode lists and franchise info.',
    bad_key: 'TMDB rejected the saved key. Click “TMDB Key” to enter it again.',
    not_found: 'This folder could not be matched on TMDB, so only local information is shown.',
    offline: 'No internet right now. Showing what is saved on this computer.',
    error: 'Could not load info from TMDB. Showing what is saved on this computer.'
  }[status];
  return msg ? `<div class="banner">${msg}</div>` : '';
}

async function renderDetail(id) {
  const token = renderToken;
  const base = byId.get(id);
  content.innerHTML = `<button class="secondary back" data-back>← Back</button><div class="empty">Loading…</div>`;
  $('[data-back]').addEventListener('click', back);
  if (!base) return;

  const r = await window.api.getDetail(id);
  if (token !== renderToken) return;
  if (r.status === 'gone') { content.innerHTML = `<button class="secondary back" data-back>← Back</button><div class="empty">This item is no longer in the library.</div>`; $('[data-back]').addEventListener('click', back); return; }

  const it = r.item, d = r.details;
  const bits = [
    it.year || (d && d.year),
    it.type === 'series' ? seasonSummary(it) : (d && d.runtime ? `${d.runtime} min` : ''),
    d && d.genres.length ? d.genres.slice(0, 3).join(', ') : ''
  ].filter(Boolean);
  const people = d ? (d.directors || d.creators || []) : [];
  const crewLabel = d && d.type === 'tv' ? 'Created by' : 'Directed by';

  const cast = d && d.cast.length ? `
    <section class="section"><h2>Cast &amp; Crew</h2>
      <div class="cast-row">
        ${[...people.map(p => ({ ...p, character: crewLabel.replace(' by', '') })), ...d.cast].map(c => `
          <button class="person" data-person="${c.id}">
            ${c.photoUrl ? `<img src="${escapeAttr(c.photoUrl)}" alt="">` : `<span class="avatar">${escapeHtml(initials(c.name))}</span>`}
            <b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.character || '')}</small>
          </button>`).join('')}
      </div></section>` : '';

  const coll = r.collection ? `<div class="note">Part of <b>${escapeHtml(r.collection.name)}</b>${r.collection.total ? ` — you own ${r.collection.owned} of ${r.collection.total}` : ''}.
      ${r.collection.total && r.collection.owned < r.collection.total ? '<a href="#" data-goto-missing>See what is missing</a>' : ''}</div>` : '';

  const seriesStat = r.series && r.series.airedTotal ? `
    <div class="note">${r.series.completion}% complete · ${r.series.ownedAired} of ${r.series.airedTotal} aired episodes in your library${r.series.missingCount ? ` · <b class="red-text">${r.series.missingCount} missing</b>` : ''}</div>` : '';

  content.innerHTML = `
    <button class="secondary back" data-back>← Back</button>
    ${banner(r.status)}
    <div class="detail-head">
      <div class="poster detail-poster" data-id="${escapeAttr(it.id)}">${posterInner(it)}</div>
      <div class="detail-info">
        <h1>${escapeHtml(shownTitle(it))}</h1>
        <div class="detail-meta">${escapeHtml(bits.join(' · '))} ${d && d.rating ? stars(d.rating) : ''} ${qualityChip(it)}</div>
        ${it.type === 'movie' || it.type === 'series' ? langLineHTML(it) : ''}
        ${d && d.tagline ? `<div class="tagline">${escapeHtml(d.tagline)}</div>` : ''}
        <p class="overview">${escapeHtml(d && d.overview ? d.overview : 'No description saved yet.')}</p>
        <div class="where-line">${onlineChip(it.online)} <span>${escapeHtml(driveLine(it) || 'Drive not recorded. Rescan this drive to assign it.')}</span></div>
        ${seriesStat}${coll}
        ${it.type === 'movie' || it.type === 'series' ? '<div id="detailMine" class="detail-mine"></div>' : ''}
        <div class="btn-row">
          <span id="detailMarks"></span>
          <button id="playBtn" class="${it.online ? '' : 'is-off'}" title="${it.online ? 'Open in your default player' : 'Drive is offline'}">▶ Play${it.type === 'series' ? ' first episode' : ''}</button>
          ${it.type === 'series' ? '<button id="notShow" class="secondary" title="This is really a movie">Not a TV Show → Movies</button><button id="hideShow" class="secondary" title="Take it out of TV Series (it waits in the Videos tab)">Remove from TV Series</button>' : ''}
          ${it.type === 'series' && it.asShowIds && it.asShowIds.length ? '<button id="backMovie" class="secondary" title="Put it back under Movies">Back to Movies</button>' : ''}
          ${it.type === 'movie' && !(it.quality && (it.quality.res === '1080p' || it.quality.res === '4K')) ? `<button id="wishUp" class="secondary" title="Look for a better version of this movie"></button>` : ''}
          ${it.type === 'movie' && !it.notShowKey ? '<button id="asShow" class="secondary" title="This is part of a TV show">Not a Movie → TV Show</button>' : ''}
          ${it.notShowKey ? '<button id="backShow" class="secondary" title="Put it back under TV Series">Back to TV Series</button>' : ''}
          ${it.type === 'movie' || it.type === 'series' ? `<button id="fixTitle" class="secondary" title="The app picked the wrong ${it.type === 'series' ? 'show' : 'movie'}? Choose the right one">✎ Wrong ${it.type === 'series' ? 'show' : 'movie'}? Correct it</button>` : ''}
          ${it.isGroup ? '' : `<button id="openFolder" class="secondary">${it.isFile ? 'Show file' : 'Open ' + (it.type === 'series' ? 'show ' : '') + 'folder'}</button>`}
        </div>
        <div id="fixBox"></div>
        ${it.folderName && it.folderName !== shownTitle(it) ? `<div class="folder-name" title="Names on the drive are never changed">${it.isFile ? 'File' : 'Folder'}: ${escapeHtml(it.folderName)}</div>` : ''}
      </div>
    </div>
    ${versionsPanel(it)}
    ${franchiseRow(r)}
    ${cast}
    ${it.type === 'series' ? `<section class="section" id="seasonsSection"></section>` : ''}
    ${r.locations && r.locations.length ? `<section class="section"><h2>Where these episodes are</h2><div class="loc-list">${r.locations.map((l, i) => `<div class="loc-row">${onlineChip(l.online)} <b>${escapeHtml(l.driveName)}</b> <code>${escapeHtml(l.dir)}</code> <span class="muted">${l.count} ep · ${l.seasons.map(s => s ? 'S' + s : 'Specials').join(', ')}</span> <button class="secondary small-btn" data-loc="${i}">Open</button></div>`).join('')}</div></section>` : ''}`;

  $('[data-back]').addEventListener('click', back);
  const fx = $('#fixTitle'); if (fx) fx.addEventListener('click', () => openCorrect(it));
  const of = $('#openFolder'); if (of) of.addEventListener('click', () => openFolder(it.path, it));
  $('#playBtn').addEventListener('click', () => playItem(it));
  bindLang(content, it, () => renderDetail(id));
  const wu = $('#wishUp');
  if (wu) {
    const key = `up:${it.id}`, paint = () => { const on = wishKeys.has(key); wu.textContent = on ? '♥ Wished to upgrade' : '⬆ Wish to Upgrade'; wu.classList.toggle('on-btn', on); wu.title = on ? 'On your wishlist (click to remove)' : 'Add a better version of this movie to your wishlist'; };
    refreshWish().then(paint);
    wu.addEventListener('click', async () => {
      const res = wishKeys.has(key) ? await window.api.wishlistRemove({ key }) : await window.api.wishlistAdd({ kind: 'upgrade', id: it.id });
      if (res && res.keys) { wishKeys = new Set(res.keys); setWishBadge(); }
      paint(); setStatus(wishKeys.has(key) ? 'Added to your Wishlist. It leaves by itself once you own it in 1080p or 4K.' : 'Removed from your Wishlist.');
    });
  }
  if (it.type === 'movie' || it.type === 'series') renderDetailMarks(it);
  content.querySelectorAll('[data-vopen]').forEach(b => b.addEventListener('click', () => { const x = byId.get(b.dataset.vopen); if (x) openFolder(x.path, x); }));
  content.querySelectorAll('[data-vview]').forEach(b => b.addEventListener('click', () => go({ view: 'detail', id: b.dataset.vview })));
  const flip = async (on, view, msg) => {
    const res = await window.api.setNotShow({ id: it.id, key: it.notShowKey, on });
    if (!res || !res.ok) { setStatus('Could not move it.'); return; }
    setLibrary(res.items); setStatus(msg); go({ view }, { nav: true });
  };
  const ns = $('#notShow'); if (ns) ns.addEventListener('click', async () => {
    const c = await confirmBox({ title: 'Move to Movies?', body: `<p><b>${escapeHtml(shownTitle(it))}</b> will be listed under Movies instead of TV Series. Your files are not touched.</p>`, okText: 'Move to Movies' });
    if (c.ok) flip(true, 'movie', 'Moved to Movies.');
  });
  const hs = $('#hideShow'); if (hs) hs.addEventListener('click', () => removeFromTv(it));
  const am = $('#asShow'); if (am) am.addEventListener('click', () => moveToShow(it));
  const bm = $('#backMovie'); if (bm) bm.addEventListener('click', async () => {
    const res = await window.api.setAsShow({ ids: it.asShowIds, on: false });
    if (!res || !res.ok) { setStatus('Could not move it.'); return; }
    setLibrary(res.items); setStatus('Back under Movies.'); go({ view: 'movie' }, { nav: true });
  });
  const bs = $('#backShow'); if (bs) bs.addEventListener('click', () => flip(false, 'series', 'Back under TV Series.'));
  content.querySelectorAll('[data-part]').forEach(c => c.addEventListener('click', () => go({ view: 'detail', id: c.dataset.part })));
  content.querySelectorAll('[data-person]').forEach(b => b.addEventListener('click', () => go({ view: 'person', id: +b.dataset.person })));
  content.querySelectorAll('[data-loc]').forEach(b => b.addEventListener('click', () => { const l = r.locations[+b.dataset.loc]; if (l.online) window.api.openPath(l.dir); else setStatus(`${l.driveName} is offline.`); }));
  const gm = $('[data-goto-missing]');
  if (gm) gm.addEventListener('click', (ev) => { ev.preventDefault(); prefs.missingTab = 'franchise'; savePrefs(); go({ view: 'missing' }, { nav: true }); });
  if (it.type === 'series') drawSeasons(r, token);
  queuePosters([byId.get(id)].filter(Boolean));
}

/** "In this series": every part of the movie's collection in release order. */
function franchiseRow(r) {
  const f = r.franchise;
  if (!f) return '';
  const cards = f.parts.map(p => {
    const it = p.itemId ? byId.get(p.itemId) : null;
    const tag = p.current ? '<span class="chip chip-blue">You are here</span>' : p.id === f.nextId ? '<span class="chip chip-orange">Next</span>' : '';
    if (it) {
      return `<div class="card part${p.current ? ' current' : ''}" data-id="${escapeAttr(it.id)}" ${p.current ? '' : `data-part="${escapeAttr(it.id)}"`}>
        <div class="poster">${posterInner(it)}${it.online ? '' : '<span class="off-chip">Offline</span>'}</div>
        <div class="info"><div class="title" title="${escapeAttr(p.title)}">${escapeHtml(p.title)}</div><div class="meta">${p.year || ''} ${tag}</div></div></div>`;
    }
    return `<div class="card ghost part"><div class="poster">${p.poster ? `<img class="poster-img" src="${escapeAttr(p.poster)}" alt="">` : escapeHtml(p.title)}${p.year ? `<span class="year-chip">${p.year}</span>` : ''}</div>
      <div class="info"><div class="title" title="${escapeAttr(p.title)}">${escapeHtml(p.title)}</div><div class="meta">${p.upcoming ? statusChip('grey', 'Not released yet') : statusChip('red', 'Not in library')} ${tag}</div></div></div>`;
  }).join('');
  return `<section class="section"><h2>In this series — ${escapeHtml(f.name)}</h2><div class="hscroll">${cards}</div></section>`;
}

function pickSeason(seasons, id) {
  if (seasonChoice[id] != null && seasons.some(s => s.season === seasonChoice[id])) return seasonChoice[id];
  const withMissing = seasons.find(s => s.season > 0 && s.missingCount > 0);
  const firstReal = seasons.find(s => s.season > 0);
  return (withMissing || firstReal || seasons[0] || { season: 1 }).season;
}

function drawSeasons(r, token) {
  const box = $('#seasonsSection');
  const seasons = r.seasons || [];
  if (!seasons.length) { box.innerHTML = '<h2>Seasons</h2><div class="muted">No season folders or episodes found.</div>'; return; }
  const id = r.item.id;
  const sel = pickSeason(seasons, id);
  box.innerHTML = `
    <h2>Seasons</h2>
    <div class="pills">${seasons.map(s => `
      <button class="pill${s.season === sel ? ' active' : ''}" data-season="${s.season}">
        ${s.season === 0 ? 'Specials' : `Season ${s.season}`}
        ${s.missingCount ? `<span class="dot red" title="${s.missingCount} missing"></span>` : ''}
        ${!s.hasFolder && s.total ? '<span class="dot grey" title="No folder for this season"></span>' : ''}
      </button>`).join('')}</div>
    <div id="episodes"></div>`;
  box.querySelectorAll('[data-season]').forEach(p => p.addEventListener('click', () => { seasonChoice[id] = +p.dataset.season; drawSeasons(r, token); }));
  loadEpisodes(r, sel, token);
}

const EP_STATE = {
  available: ['green', '✓ Available'], missing: ['red', '✕ Missing'], upcoming: ['grey', '◷ Not aired yet'],
  unknown: ['orange', '? Unreadable names'], optional: ['grey', 'Not in library']
};

let epFilter = 'all'; // all | missing | available
async function loadEpisodes(r, season, token) {
  const box = $('#episodes');
  box.innerHTML = '<div class="muted pad">Loading episodes…</div>';
  const res = await window.api.getSeason({ id: r.item.id, season });
  if (token !== renderToken || !$('#episodes')) return;
  const row = r.seasons.find(s => s.season === season) || {};
  const allEps = res.episodes;
  const eps = epFilter === 'missing' ? allEps.filter(e => e.state === 'missing') : epFilter === 'available' ? allEps.filter(e => e.state === 'available') : allEps;
  const have = allEps.filter(e => e.state === 'available').length;
  const miss = allEps.filter(e => e.state === 'missing').length;
  const note = res.status === 'no_key' ? 'Add a TMDB key and sync to see names and missing episodes.'
    : res.status === 'offline' ? 'Episode names are not saved yet. Connect to the internet and open this page once.' : '';
  box.innerHTML = `
    <div class="ep-summary">${have} of ${row.total || eps.length || '?'} episodes in your library${miss ? ` · <b class="red-text">${miss} missing</b>` : ''}
      ${row.season === 0 ? ' · specials are never counted as missing' : ''}</div>
    ${note ? `<div class="muted pad">${note}</div>` : ''}
    ${have ? `<div class="btn-row ep-bulk"><button class="secondary small-btn" id="epSeenAll">Mark season watched</button><button class="secondary small-btn" id="epSeenNone">Clear season</button></div>` : ''}
    <div class="filter-row pills">${[['all', 'All', allEps.length], ['missing', 'Missing', miss], ['available', 'Available', have]].map(([k, l, n]) => `<button class="pill${epFilter === k ? ' active' : ''}" data-epfilter="${k}">${l} (${n})</button>`).join('')}</div>
    ${res.unreadable ? '<div class="muted pad">The file names in this season don’t contain episode numbers, so availability can’t be checked.</div>' : ''}
    <div class="episodes">${eps.map(e => {
      const [kind, label] = EP_STATE[e.state] || EP_STATE.available;
      const ws = e.state === 'available' ? (e.wheres || []) : [];
      const w = ws[0] || null;
      const canPlay = ws.some(x => x.online);
      const many = ws.length > 1;
      const folderName = (x) => String(x.dir || '').split(/[\\/]/).filter(Boolean).pop() || x.dir;
      const whereLine = ws.length ? `<small class="ep-where">${ws.map(x => `${escapeHtml(x.driveName ? x.driveName + ' · ' : '')}${escapeHtml(x.file || x.dir)}${x.online ? '' : ' · drive offline'}`).join('<br>')}</small>` : '';
      // more than one folder holds this episode: show each one in front of the name, with its own Open folder button
      const chips = many ? `<div class="ep-places">${ws.map(x => `<span class="ep-place${x.online ? '' : ' off'}" title="${escapeAttr((x.driveName ? x.driveName + ' · ' : '') + (x.file || x.dir))}"><i>${escapeHtml(x.driveName || 'Drive')}</i> ${escapeHtml(folderName(x))}${x.online ? `<button class="secondary small-btn ep-folder" data-folder="${escapeAttr(x.file || x.dir)}" title="Open this folder">Open folder</button>` : '<em>offline</em>'}</span>`).join('')}</div>` : '';
      const title = escapeHtml(e.name || `Episode ${e.number}`);
      const heart = e.state === 'missing' && res.tmdbId ? wishBtn({ kind: 'episode', showId: res.tmdbId, showTitle: res.showTitle || r.item.title, season, number: e.number, name: e.name || '' }) : '';
      const seenBtn = e.state === 'available' ? `<button class="ep-seen${e.watched ? ' on' : ''}" data-eseen="${e.number}" title="${e.watched ? 'Watched. Click to undo' : 'Mark as watched'}" aria-pressed="${!!e.watched}">✓</button>` : '';
      return `<div class="ep ep-${e.state}${e.watched ? ' ep-watched' : ''}${canPlay ? ' ep-playable' : ''}${many ? ' ep-many' : ''}">
        ${heart}${seenBtn}<span class="ep-num">${e.number}</span>
        <div class="grow">${chips}${canPlay ? `<b class="ep-name" data-ep="${e.number}" role="button" tabindex="0" title="Play this episode">${title}</b>` : `<b>${title}</b>`}
          <small>${[e.air_date ? fmtDay(e.air_date) : '', e.runtime ? `${e.runtime} min` : ''].filter(Boolean).join(' · ')}</small>
          ${whereLine}
          ${e.overview ? `<small class="ep-over">${escapeHtml(e.overview)}</small>` : ''}</div>
        ${!many && w && w.online ? `<button class="secondary small-btn ep-folder" data-folder="${escapeAttr(w.file || w.dir)}" title="Open the folder this episode is in">Open folder</button>` : ''}
        ${canPlay ? `<button class="secondary small-btn ep-play" data-ep="${e.number}" title="Play this episode">▶</button>` : ''}
        ${statusChip(kind, label)}</div>`;
    }).join('') || '<div class="muted pad">No episodes to show.</div>'}</div>
    ${(res.unplaced || []).length ? `<h3 class="cc-head">Files without an episode number (${res.unplaced.length})</h3>
      <p class="muted">The app could not tell which episode these are. Give each one its number.</p>
      <div class="episodes">${res.unplaced.map(u => `
        <div class="ep ep-unknown" data-uid="${escapeAttr(u.id)}"><span class="ep-num">?</span>
          <div class="grow"><b>${escapeHtml(u.name)}</b><small>${escapeHtml([u.driveName, u.size ? fmtBytes(u.size) : '', u.online ? '' : 'drive offline'].filter(Boolean).join(' · '))}</small></div>
          <button class="secondary small-btn" data-ufolder="${escapeAttr(u.file)}">Open folder</button>
          <button class="small-btn" data-uassign>Assign episode number</button></div>`).join('')}</div>` : ''}`;
  box.querySelectorAll('[data-epfilter]').forEach(b => b.addEventListener('click', () => { epFilter = b.dataset.epfilter; loadEpisodes(r, season, token); }));
  bindWish(box);
  const seen = async (numbers, on) => {
    const res = await window.api.setEpisodeWatched({ id: r.item.id, season, numbers, on });
    if (!res || !res.ok) return;
    setLibrary(res.items);
    renderDetailMine(byId.get(r.item.id) || r.item);
    loadEpisodes(r, season, token);
  };
  box.querySelectorAll('[data-eseen]').forEach(b => b.addEventListener('click', (ev) => { ev.stopPropagation(); const n = +b.dataset.eseen; seen([n], !b.classList.contains('on')); }));
  const availNums = allEps.filter(e => e.state === 'available').map(e => e.number);
  const sa = $('#epSeenAll'); if (sa) sa.addEventListener('click', () => seen(availNums, true));
  const sn = $('#epSeenNone'); if (sn) sn.addEventListener('click', () => seen(availNums, false));
  box.querySelectorAll('[data-ufolder]').forEach(b => b.addEventListener('click', () => window.api.openPath(b.dataset.ufolder)));
  box.querySelectorAll('[data-uassign]').forEach(b => b.addEventListener('click', async () => {
    const id = b.closest('[data-uid]').dataset.uid;
    const c = await confirmBox({ title: 'Which episode is this file?', okText: 'Save', body: `<div class="ep-assign-form"><label>Season <input type="number" id="uaSeason" min="0" value="${season}"></label> <label>Episode <input type="number" id="uaNumber" min="0" autofocus></label></div><p class="muted">Only the catalog changes. The file is not renamed.</p>` });
    if (!c.ok) return;
    const res2 = await window.api.setEpisodeNumber({ id, season: $('#uaSeason').value, number: $('#uaNumber').value });
    if (!res2.ok) { setStatus('Enter an episode number first.'); return; }
    setLibrary(await window.api.getLibrary());
    renderDetail(r.item.id);
  }));
  box.querySelectorAll('[data-ep]').forEach(b => {
    const go = () => playItem(r.item, { season, number: +b.dataset.ep });
    b.addEventListener('click', go);
    b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
  });
  box.querySelectorAll('[data-folder]').forEach(b => b.addEventListener('click', () => window.api.openPath(b.dataset.folder)));
}

async function renderPerson(personId) {
  const token = renderToken;
  content.innerHTML = `<button class="secondary back" data-back>← Back</button><div class="empty">Loading…</div>`;
  $('[data-back]').addEventListener('click', back);
  const r = await window.api.getPerson(personId);
  if (token !== renderToken) return;

  if (r.status !== 'ok') {
    const msg = r.status === 'no_key' ? 'Add your TMDB key to load this person.' : r.status === 'bad_key' ? 'TMDB rejected the saved key.' : 'This person is not saved on this computer yet, and there is no internet connection.';
    content.innerHTML = `<button class="secondary back" data-back>← Back</button><div class="empty">${msg}</div>`;
    $('[data-back]').addEventListener('click', back);
    return;
  }
  const p = r.person;
  const owned = r.credits.filter(c => c.ownedId);
  const others = r.credits.filter(c => !c.ownedId);
  const ownedCards = owned.map(c => {
    const it = byId.get(c.ownedId);
    return it ? cardHTML(it, { showOpen: true }) : '';
  }).join('');
  const otherCards = others.map(c => `
    <div class="card ghost"><div class="poster">${c.poster ? `<img class="poster-img" src="${escapeAttr(c.poster)}" alt="">` : escapeHtml(c.title)}${c.year ? `<span class="year-chip">${c.year}</span>` : ''}</div>
      <div class="info"><div class="title" title="${escapeAttr(c.title)}">${escapeHtml(c.title)}</div>
      <div class="sub">${escapeHtml(c.roles.slice(0, 2).join(', '))}</div>
      <div class="meta">${statusChip('grey', 'Not in library')}</div></div></div>`).join('');

  content.innerHTML = `
    <button class="secondary back" data-back>← Back</button>
    <div class="detail-head">
      <div class="person-photo">${p.photoUrl ? `<img src="${escapeAttr(p.photoUrl)}" alt="">` : `<span class="avatar big">${escapeHtml(initials(p.name))}</span>`}</div>
      <div class="detail-info">
        <h1>${escapeHtml(p.name)}</h1>
        <div class="detail-meta">${escapeHtml([p.department, p.birthday ? `Born ${fmtDay(p.birthday)}` : '', p.place].filter(Boolean).join(' · '))}</div>
        <p class="overview">${escapeHtml(p.bio || '')}</p>
        <div class="note"><b>${r.ownedCount}</b> of their ${r.credits.length} best-known titles are in your library.</div>
      </div>
    </div>
    ${owned.length ? `<section class="section"><h2>In your library</h2><div class="grid">${ownedCards}</div></section>` : ''}
    ${others.length ? `<section class="section"><h2>Also appears in</h2><div class="grid">${otherCards}</div></section>` : ''}`;
  $('[data-back]').addEventListener('click', back);
  bindCards(content);
}

// ---------- language (editable: the file name or TMDB can be wrong) ----------
const LANG_CHOICES = ['English', 'Hindi', 'Tamil', 'Telugu', 'Malayalam', 'Kannada', 'Bengali', 'Marathi', 'Punjabi', 'Gujarati', 'Korean', 'Japanese', 'Chinese', 'French', 'Spanish', 'German', 'Italian', 'Portuguese', 'Russian', 'Turkish', 'Thai', 'Arabic', 'Persian', 'Dutch', 'Swedish', 'Polish'];

function langLineHTML(it) {
  const cur = it.language || (byId.get(it.id) || {}).language || '';
  const set = it.languageSet || (byId.get(it.id) || {}).languageSet;
  const opts = [...new Set([...(cur ? [cur] : []), ...LANG_CHOICES])];
  return `<div class="lang-line"><span class="muted">Language</span> <b data-lang-cur>${escapeHtml(cur || 'Not known')}</b>${set ? ' <span class="chip chip-grey">set by you</span>' : ''}
    <button class="secondary small-btn" data-lang-edit>Change</button>
    <span class="lang-form" hidden>
      <select data-lang-sel>${opts.map(l => `<option value="${escapeAttr(l)}"${l === cur ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}<option value="__other">Other…</option></select>
      <input type="text" data-lang-other placeholder="Language name" maxlength="40" hidden>
      <button class="small-btn" data-lang-save>Save</button>
      ${set ? '<button class="secondary small-btn" data-lang-reset title="Go back to the automatic language">Automatic</button>' : ''}
      <button class="secondary small-btn" data-lang-cancel>Cancel</button>
    </span></div>`;
}

function bindLang(root, it, refresh) {
  const line = root.querySelector('.lang-line'); if (!line) return;
  const form = line.querySelector('.lang-form'), sel = line.querySelector('[data-lang-sel]'), other = line.querySelector('[data-lang-other]');
  const save = async (language) => {
    const r = await window.api.setLanguage({ id: it.id, language });
    if (r && r.ok) { setLibrary(r.items); refresh(); } else setStatus('Could not save the language.');
  };
  line.querySelector('[data-lang-edit]').addEventListener('click', () => { form.hidden = !form.hidden; });
  line.querySelector('[data-lang-cancel]').addEventListener('click', () => { form.hidden = true; });
  sel.addEventListener('change', () => { other.hidden = sel.value !== '__other'; if (!other.hidden) other.focus(); });
  line.querySelector('[data-lang-save]').addEventListener('click', () => { const v = sel.value === '__other' ? other.value.trim() : sel.value; if (v) save(v); });
  const rs = line.querySelector('[data-lang-reset]'); if (rs) rs.addEventListener('click', () => save(''));
}

// ---------- watched / favourite on the detail page ----------
function renderDetailMarks(it) {
  const box = $('#detailMarks'); if (!box) return;
  box.innerHTML = `<button class="secondary${it.watched ? ' on-btn' : ''}" data-dm="w">${it.watched ? '✓ Watched' : '✓ Mark watched'}</button><button class="secondary${it.fav ? ' on-btn' : ''}" data-dm="f">${it.fav ? '★ Favourite' : '☆ Favourite'}</button><button class="secondary${it.queued ? ' on-btn' : ''}" data-dm="q">${it.queued ? '＋ In queue' : '＋ To watch'}</button>`;
  box.querySelectorAll('[data-dm]').forEach(b => b.addEventListener('click', async () => {
    const key = b.dataset.dm, cur = key === 'w' ? !it.watched : key === 'q' ? !it.queued : !it.fav;
    const res = await window.api.setMark({ id: it.id, key, on: cur });
    if (res && res.ok) { setLibrary(res.items); renderDetailMarks(byId.get(it.id) || it); }
  }));
  renderDetailMine(byId.get(it.id) || it);
}

/** TV only: how far through the show I am, and the next episode to watch. */
function renderDetailMine(it) {
  const box = $('#detailMine'); if (!box) return;
  const prog = it.type === 'series' && it.epOwned ? `<div class="mine-row"><span class="mine-label">Progress</span><b>${it.epSeen || 0} of ${it.epOwned} watched</b>${it.nextEp ? ` <span class="chip chip-blue" id="nextEp">Next: S${String(it.nextEp.season).padStart(2, '0')}E${String(it.nextEp.number).padStart(2, '0')}</span>` : (it.epSeen ? ' <span class="chip chip-green">Caught up</span>' : '')}</div>` : '';
  box.innerHTML = prog;
}

// ---------- versions of the same movie (different quality / drive) ----------
function versionsPanel(it) {
  if (it.type !== 'movie' || !it.versionKey) return '';
  const all = [...byId.values()].filter(x => x.type === 'movie' && x.versionKey === it.versionKey);
  if (all.length < 2) return '';
  const rank = (x) => (RES_RANK[x.quality && x.quality.res] || 0);
  all.sort((a, b) => rank(b) - rank(a) || (b.size || 0) - (a.size || 0));
  const rows = all.map((x, i) => `<tr>
      <td>${qualityChip(x) || '<span class="muted">Unknown</span>'}${i === 0 ? ' <span class="chip chip-green">Best</span>' : ''}${x.id === it.id ? ' <span class="muted">(this page)</span>' : ''}</td>
      <td>${x.size ? escapeHtml(fmtBytes(x.size)) : '–'}</td>
      <td>${escapeHtml(x.driveName || '–')}${x.shelf ? ` <span class="muted">· ${escapeHtml(x.shelf)}</span>` : ''}</td>
      <td>${onlineChip(x.online)}</td>
      <td class="vtd-btns">${x.id === it.id ? '' : `<button class="secondary small-btn" data-vview="${escapeAttr(x.id)}">Open page</button>`}${x.online && x.path ? `<button class="secondary small-btn" data-vopen="${escapeAttr(x.id)}">Open folder</button>` : ''}</td></tr>`).join('');
  return `<section class="section"><h2>${all.length} versions of this movie</h2>
    <table class="vtable"><thead><tr><th>Quality</th><th>Size</th><th>Drive</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></section>`;
}


/** "Wrong movie? Correct it": search TMDB, pick the right entry; remembered for good and the poster/details follow it. */
async function openCorrect(it) {
  const box = $('#fixBox'); if (!box) return;
  const info = await window.api.getCorrectInfo({ id: it.id });
  if (!info || !info.ok) { box.innerHTML = ''; return; }
  if (!info.hasKey) { box.innerHTML = '<div class="banner">Add your TMDB key (top bar) to look up titles.</div>'; return; }
  box.innerHTML = `<div class="fix-panel">
    <b>Which ${info.kind === 'tv' ? 'show' : 'movie'} is this really?</b>
    <small class="muted">Folder name: ${escapeHtml(it.folderName || '')}. Your files are never renamed.</small>
    <div class="btn-row"><input type="search" id="fixQ" value="${escapeAttr(info.query || '')}" aria-label="Title to search">
      <input type="number" id="fixY" value="${info.year || ''}" placeholder="Year" min="1880" max="2100" aria-label="Year">
      <button id="fixGo" class="small-btn">Search</button>
      ${info.corrected ? '<button id="fixReset" class="secondary small-btn">Go back to automatic</button>' : ''}
      <button id="fixClose" class="secondary small-btn">Close</button></div>
    <div id="fixRes"></div></div>`;
  const res = $('#fixRes');
  const search = async () => {
    const q = $('#fixQ').value.trim(), year = parseInt($('#fixY').value, 10) || null;
    if (!q) return;
    res.innerHTML = '<div class="muted">Searching…</div>';
    const out = await window.api.reviewSearch({ query: q, year });
    if (!out.ok) { res.innerHTML = '<div class="banner">Could not search TMDB. Check your key and internet.</div>'; return; }
    const cands = out.candidates.filter(c => c.type === info.kind);
    res.innerHTML = cands.length ? `<div class="rv-cands">${cands.map(c => `<div class="rv-cand">
      ${c.thumb ? `<img src="${escapeAttr(c.thumb)}" alt="">` : '<div class="rv-noimg">?</div>'}
      <b title="${escapeAttr(c.title)}">${escapeHtml(c.title)}</b><small>${c.year || ''}</small>
      <button class="small-btn" data-fixpick="${c.id}" data-fixtype="${c.type}">This one</button></div>`).join('')}</div>` : '<div class="muted">Nothing found. Try fewer words, or clear the year.</div>';
    res.querySelectorAll('[data-fixpick]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Saving…';
      const r = await window.api.correctTitle({ id: it.id, tmdbId: +b.dataset.fixpick, mediaType: b.dataset.fixtype });
      if (!r || !r.ok) { b.disabled = false; b.textContent = 'This one'; setStatus('Could not save that. Check your TMDB key and internet.'); return; }
      setLibrary(await window.api.getLibrary());
      setStatus(`Now showing ${r.title}${r.year ? ' (' + r.year + ')' : ''}.`);
      renderDetail(it.id);
    }));
  };
  $('#fixGo').addEventListener('click', search);
  $('#fixQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  $('#fixClose').addEventListener('click', () => { box.innerHTML = ''; });
  const rs = $('#fixReset'); if (rs) rs.addEventListener('click', async () => { await window.api.resetCorrection({ id: it.id }); setLibrary(await window.api.getLibrary()); setStatus('Back to automatic matching.'); renderDetail(it.id); });
  search();
}
