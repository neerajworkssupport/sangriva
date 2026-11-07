// Music: Artists / Albums / Singles browse, album page (track table) and artist page. Everything is read from the catalog.
const hue = (name) => { let h = 0; for (const c of String(name || '?')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const artistKey = (i) => i.artist || 'Unknown artist';
const fmtTotal = (bytes) => (bytes ? fmtBytes(bytes) : '');

function artistAvatar(name, album, cls = '') {
  const inner = album && album.poster ? `<img class="poster-img" src="${escapeAttr(album.poster)}" alt="">` : `<span>${escapeHtml(initials(name))}</span>`;
  return `<div class="poster artist-cover ${cls}" style="--h:${hue(name)}">${inner}</div>`;
}

/** The Music page: Artists | Albums | Singles with a labeled filter bar. */
function renderMusicBrowse(items) {
  const tab = ['albums', 'singles'].includes(prefs.musicTab2) ? prefs.musicTab2 : 'artists';
  const w = searchTerm.toLowerCase();
  const albums = items; // already filtered by search / availability
  const ss = singles.filter(i => (!w || `${i.title} ${i.artist}`.toLowerCase().includes(w)) && (prefs.filter === 'online' ? i.online : prefs.filter === 'offline' ? !i.online : true));
  const dec = (y) => (y ? Math.floor(y / 10) * 10 : 0);
  const decades = [...new Set(albums.map(a => dec(a.year)).filter(Boolean))].sort((a, b) => b - a);
  const mdec = prefs.mdec && prefs.mdec !== 'all' ? +prefs.mdec : null;
  const albumsF = albums.filter(a => !mdec || dec(a.year) === mdec);
  const sort = prefs.msort || 'az';
  const sorter = { az: (a, b) => (a.title || '').localeCompare(b.title || ''), recent: (a, b) => (b.addedAt || 0) - (a.addedAt || 0), year: (a, b) => (b.year || 0) - (a.year || 0) || (a.title || '').localeCompare(b.title || '') }[sort];
  const byArtist = new Map();
  const add = (i, k) => { const a = artistKey(i); const g = byArtist.get(a) || byArtist.set(a, { name: a, albums: [], singles: [] }).get(a); g[k].push(i); };
  albumsF.forEach(i => add(i, 'albums')); if (!mdec) ss.forEach(i => add(i, 'singles'));
  const artists = [...byArtist.values()].sort((a, b) => sort === 'recent' ? Math.max(0, ...b.albums.map(x => x.addedAt || 0)) - Math.max(0, ...a.albums.map(x => x.addedAt || 0)) : a.name.localeCompare(b.name));

  const sel = (id, label, cur, opts) => `<div class="fgroup"><label for="${id}">${label}</label><select id="${id}" data-mf="${id}">${opts.map(([v, t]) => `<option value="${escapeAttr(v)}"${String(cur || 'all') === String(v) ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></div>`;
  const bar = `<div class="fbar">
    ${sel('msort', 'Order by', sort, [['az', 'A to Z'], ['recent', 'Latest added'], ['year', 'Year (newest)']])}
    ${tab === 'singles' ? '' : sel('mdec', 'Decade', prefs.mdec, [['all', 'All Decades'], ...decades.map(d => [d, `${d}s`])])}
    ${sel('mavail', 'Availability', prefs.filter || 'all', PILLS)}
    <div class="fgroup fend"><div class="seg"><button data-layout="grid" class="${prefs.layout === 'grid' ? 'active' : ''}" title="Grid">▦</button><button data-layout="list" class="${prefs.layout === 'list' ? 'active' : ''}" title="List">☰</button></div></div></div>`;

  const tabs = `<div class="mtabs">${[['artists', 'Artists', artists.length], ['albums', 'Albums', albumsF.length], ['singles', 'Singles', ss.length]].map(([k, l, n]) => `<button data-mtab="${k}" class="${tab === k ? 'active' : ''}">${l}<span>${n.toLocaleString()}</span></button>`).join('')}</div>`;

  let body;
  if (tab === 'artists') {
    body = artists.length ? `<div class="artist-grid">${artists.map(g => `
      <div class="artist-card" data-artist="${escapeAttr(g.name)}"${g.albums[0] ? ` data-id="${escapeAttr(g.albums[0].id)}"` : ''}>
        ${artistAvatar(g.name, g.albums.find(a => a.poster) || g.albums[0])}
        <div class="artist-name" title="${escapeAttr(g.name)}">${escapeHtml(g.name)}</div>
        <div class="artist-sub">${[g.albums.length ? `${g.albums.length} album${g.albums.length === 1 ? '' : 's'}` : '', g.singles.length ? `${g.singles.length} single${g.singles.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</div>
      </div>`).join('')}</div>` : '<div class="empty">No artists match.</div>';
  } else if (tab === 'albums') {
    const list = albumsF.slice().sort(sorter);
    body = !list.length ? '<div class="empty">No albums match.</div>'
      : prefs.layout === 'list'
        ? `<div class="tracklist albumlist">${list.map((a, n) => `
          <div class="tl-row card row" data-id="${escapeAttr(a.id)}"><span class="tl-n">${n + 1}</span>
            <div class="thumb poster square">${posterInner(a)}</div>
            <div class="tl-title"><b>${escapeHtml(a.title)}</b><small>${escapeHtml(a.artist || 'Unknown artist')}</small></div>
            <span class="tl-meta">${a.year || ''}</span><span class="tl-meta">${(a.tracks || []).length || a.fileCount || ''} songs</span><span class="tl-meta">${fmtTotal(a.size)}</span>
            ${onlineChip(a.online)}
            ${a.online ? '<button class="secondary small-btn" data-play>▶ Play</button>' : ''}</div>`).join('')}</div>`
        : `<div class="grid music-grid">${list.map(i => cardHTML(i)).join('')}</div>`;
  } else {
    const list = ss.slice().sort((a, b) => a.title.localeCompare(b.title));
    body = list.length ? singlesTable(list, true) : '<div class="empty">No singles yet. Songs in folders that are not albums (or in a folder called Singles) show up here after a scan.</div>';
  }
  content.innerHTML = `
    <div class="page-head"><h1>Music</h1><p>${artists.length.toLocaleString()} artist${artists.length === 1 ? '' : 's'} · ${albumsF.length.toLocaleString()} album${albumsF.length === 1 ? '' : 's'} · ${ss.length.toLocaleString()} single${ss.length === 1 ? '' : 's'}</p></div>
    ${tabs}${bar}${body}`;

  content.querySelectorAll('[data-mtab]').forEach(b => b.addEventListener('click', () => { prefs.musicTab2 = b.dataset.mtab; savePrefs(); render(); }));
  content.querySelectorAll('[data-mf]').forEach(el => el.addEventListener('change', () => {
    if (el.id === 'msort') prefs.msort = el.value; else if (el.id === 'mdec') prefs.mdec = el.value; else prefs.filter = el.value;
    savePrefs(); render();
  }));
  content.querySelectorAll('[data-layout]').forEach(b => b.addEventListener('click', () => { prefs.layout = b.dataset.layout; savePrefs(); render(); }));
  content.querySelectorAll('[data-artist]').forEach(r => r.addEventListener('click', () => go({ view: 'artist', name: r.dataset.artist })));
  bindSingles(content);
  bindCards(content);
  queuePosters(albumsF.slice(0, 400));
}

function singlesTable(list, withArtist) {
  return `<div class="tracklist singles">
    <div class="tl-head"><span class="tl-n">#</span><span class="tl-title">Title</span>${withArtist ? '<span class="tl-meta wide">Artist</span>' : ''}<span class="tl-meta">Size</span><span class="tl-meta wide">Drive</span><span class="tl-act"></span></div>
    ${list.map((t, n) => `
    <div class="tl-row ep ep-available" data-sid="${escapeAttr(t.id)}"><span class="tl-n">${n + 1}</span>
      <div class="tl-title"><b>${escapeHtml(t.title)}</b></div>
      ${withArtist ? `<span class="tl-meta wide">${escapeHtml(t.artist || 'Unknown artist')}</span>` : ''}
      <span class="tl-meta">${t.size ? fmtBytes(t.size) : ''}</span><span class="tl-meta wide">${escapeHtml(t.driveName || '')} ${t.online ? '' : '<em>offline</em>'}</span>
      <span class="tl-act">${t.online ? '<button class="icon-btn" data-splay title="Play">▶</button>' : ''}<button class="icon-btn" data-sfolder title="Open folder">📂</button>${t.online ? '<button class="icon-btn track-del" data-sdel title="Move to the Recycle Bin">🗑</button>' : ''}</span></div>`).join('')}</div>`;
}

function bindSingles(root, after) {
  root.querySelectorAll('[data-sid]').forEach(r => {
    const it = byId.get(r.dataset.sid);
    if (!it) return;
    r.querySelector('[data-sfolder]').addEventListener('click', () => window.api.openPath(it.path.replace(/[\\/][^\\/]*$/, '')));
    const pl = r.querySelector('[data-splay]'); if (pl) pl.addEventListener('click', () => playItem(it));
    const del = r.querySelector('[data-sdel]');
    if (del) del.addEventListener('click', async () => {
      const c = await confirmBox({ title: 'Move this song to the Recycle Bin?', body: `<p><b>${escapeHtml(it.title)}</b></p><p class="muted">It is removed from the drive and the catalog. If the drive has no Recycle Bin, nothing is deleted.</p>`, okText: 'Move to Recycle Bin', danger: true });
      if (!c.ok) return;
      const res = await window.api.deleteTrack({ id: it.id });
      if (!res.ok) { setStatus(res.error === 'nobin' ? 'Not deleted: this drive has no Recycle Bin.' : 'Could not remove that song.'); return; }
      setLibrary(await window.api.getLibrary());
      render();
    });
  });
}

// ---------- album page ----------
async function renderAlbum(id) {
  const token = renderToken;
  content.innerHTML = '<button class="secondary back" data-back>← Back</button><div class="empty">Loading…</div>';
  $('[data-back]').addEventListener('click', back);
  const r = await window.api.getAlbum(id);
  if (token !== renderToken) return;
  if (r.status !== 'ok') { content.innerHTML = '<button class="secondary back" data-back>← Back</button><div class="empty">This album is no longer in the library.</div>'; $('[data-back]').addEventListener('click', back); return; }
  const it = r.item;
  const tracks = r.tracks;
  const total = tracks.reduce((n, t) => n + (t.size || 0), 0);
  content.innerHTML = `
    <button class="secondary back" data-back>← Back</button>
    <div class="detail-head album-hero" style="--h:${hue(it.artist || it.title)}">
      <div class="poster square detail-poster" data-id="${escapeAttr(it.id)}">${posterInner(it)}</div>
      <div class="detail-info">
        <div class="kicker">${it.single ? 'Single' : 'Album'}</div>
        <h1>${escapeHtml(it.title)}</h1>
        <div class="detail-meta">${it.artist ? `<a href="#" id="artistLink"><b>${escapeHtml(it.artist)}</b></a>` : 'Unknown artist'}${it.year ? ` · ${it.year}` : ''} · ${tracks.length} song${tracks.length === 1 ? '' : 's'}${total ? ` · ${fmtBytes(total)}` : ''}</div>
        <div class="where-line">${onlineChip(it.online)} <span>${escapeHtml(driveLine(it) || 'Drive not recorded. Rescan this drive to assign it.')}</span></div>
        <div class="btn-row">
          <button id="playAlbum" class="play-big${it.online ? '' : ' is-off'}">▶ Play</button>
          <button id="openAlbum" class="secondary">Open folder</button>
        </div>
      </div>
    </div>
    <section class="section">
      ${tracks.length ? `<div class="tracklist">
        <div class="tl-head"><span class="tl-n">#</span><span class="tl-title">Title</span><span class="tl-meta">Size</span><span class="tl-act"></span></div>
        ${tracks.map((t, n) => `
        <div class="tl-row ep ep-available"><span class="tl-n ep-num">${n + 1}</span>
          <div class="tl-title"><b>${escapeHtml(t.name)}</b></div>
          <span class="tl-meta">${t.size ? fmtBytes(t.size) : ''}</span>
          <span class="tl-act">${it.online ? `<button class="icon-btn" data-track="${escapeAttr(t.rel)}" title="Play this song">▶</button><button class="icon-btn track-del" data-tdel="${escapeAttr(t.rel)}" data-tname="${escapeAttr(t.name)}" title="Move this song to the Recycle Bin">🗑</button>` : ''}</span></div>`).join('')}</div>`
        : `<div class="muted pad">${r.saved ? 'No audio files found.' : 'Track names are saved when you scan this drive. Rescan it (or plug it in) to see them.'}</div>`}
    </section>`;
  $('[data-back]').addEventListener('click', back);
  $('#playAlbum').addEventListener('click', () => playItem(it));
  $('#openAlbum').addEventListener('click', () => openFolder(it.path, it));
  content.querySelectorAll('[data-track]').forEach(b => b.addEventListener('click', () => playItem(it, { track: b.dataset.track })));
  content.querySelectorAll('[data-tdel]').forEach(b => b.addEventListener('click', async () => {
    const c = await confirmBox({ title: 'Move this song to the Recycle Bin?', body: `<p><b>${escapeHtml(b.dataset.tname)}</b></p><p class="muted">It is removed from the drive and the catalog. You can restore it from the Recycle Bin. If the drive has no Recycle Bin, nothing is deleted.</p>`, okText: 'Move to Recycle Bin', danger: true });
    if (!c.ok) return;
    const res = await window.api.deleteTrack({ id: it.id, rel: b.dataset.tdel });
    if (!res.ok) { setStatus(res.error === 'nobin' ? 'Not deleted: this drive has no Recycle Bin.' : res.error === 'offline' ? 'That drive is offline.' : 'Could not remove that song.'); return; }
    setStatus('Moved to the Recycle Bin');
    setLibrary(await window.api.getLibrary());
    if (byId.get(it.id)) renderAlbum(it.id); else go({ view: 'music' }, { nav: true });
  }));
  const al = $('#artistLink');
  if (al) al.addEventListener('click', (e) => { e.preventDefault(); go({ view: 'artist', name: it.artist }); });
  queuePosters([byId.get(it.id)].filter(Boolean));
}

// ---------- artist page ----------
function renderArtist(name) {
  const albums = library.filter(i => i.type === 'music' && artistKey(i) === name)
    .sort((a, b) => (a.year || 9999) - (b.year || 9999) || a.title.localeCompare(b.title));
  const ss = singles.filter(i => artistKey(i) === name).sort((a, b) => a.title.localeCompare(b.title));
  const songs = albums.reduce((n, a) => n + ((a.tracks || []).length || 0), 0) + ss.length;
  const size = albums.reduce((n, a) => n + (a.size || 0), 0) + ss.reduce((n, a) => n + (a.size || 0), 0);
  const years = albums.map(a => a.year).filter(Boolean);
  content.innerHTML = `
    <button class="secondary back" data-back>← Back</button>
    <div class="detail-head artist-hero" style="--h:${hue(name)}" ${albums[0] ? `data-id="${escapeAttr(albums[0].id)}"` : ''}>
      ${artistAvatar(name, albums.find(a => a.poster) || albums[0], 'big')}
      <div class="detail-info">
        <div class="kicker">Artist</div>
        <h1>${escapeHtml(name)}</h1>
        <div class="detail-meta">${albums.length} album${albums.length === 1 ? '' : 's'} · ${ss.length} single${ss.length === 1 ? '' : 's'}${songs ? ` · ${songs} songs` : ''}${years.length ? ` · ${Math.min(...years)}${Math.max(...years) !== Math.min(...years) ? '–' + Math.max(...years) : ''}` : ''}${size ? ` · ${fmtBytes(size)}` : ''}</div>
      </div>
    </div>
    ${albums.length ? `<section class="section"><h2>Albums</h2><div class="grid music-grid">${albums.map(i => cardHTML(i)).join('')}</div></section>` : ''}
    ${ss.length ? `<section class="section"><h2>Singles</h2>${singlesTable(ss, false)}</section>` : ''}`;
  $('[data-back]').addEventListener('click', back);
  bindSingles(content);
  bindCards(content);
  queuePosters(albums);
}
