// Videos tab: loose or unconfirmed videos. Assign one to a movie or a show (it then moves to Movies / TV Series),
// or send it to the Recycle Bin. Files are never renamed.
const VIDEO_REASONS = {
  clip: ['grey', 'Clip / not a film'],
  removed: ['grey', 'Removed from TV Series'],
  nomatch: ['red', 'No match'],
  unsure: ['orange', 'Not sure']
};
const videoUI = { sort: 'name', dir: 'asc', filter: 'all', selected: new Set(), open: null, q: {}, yr: {}, results: {}, dur: {}, minM: '', maxM: '' };
const fmtDur = (sec) => { if (!sec) return ''; const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m} min` : `${sec}s`; };

function videoRow(v) {
  const r = VIDEO_REASONS[v.video] || ['grey', 'Video'];
  const name = v.isGroup ? `${v.title} (${v.episodes || v.fileCount || 0} episode${(v.episodes || v.fileCount) === 1 ? '' : 's'})` : (v.isFile ? (v.path || '').split(/[\\/]/).pop() : (v.folderName || v.title));
  const sub = [v.isGroup ? 'Show' : v.isFile ? 'Loose file' : 'Folder', v.size ? fmtBytes(v.size) : '', v.driveName, v.isGroup ? '' : v.path].filter(Boolean).join(' · ');
  return `
    <div class="vid" data-vid="${escapeAttr(v.id)}">
      <div class="row">
        <input type="checkbox" class="vid-check" data-vsel="${escapeAttr(v.id)}"${videoUI.selected.has(v.id) ? ' checked' : ''} aria-label="Select">
        ${v.isGroup ? '' : `<span class="vid-len" data-dur>${videoUI.dur[v.id] ? escapeHtml(fmtDur(videoUI.dur[v.id])) : (v.online ? '…' : '–')}</span>`}
        <div class="row-title" title="${escapeAttr(name)}">${escapeHtml(name)}<small>${escapeHtml(sub)}</small></div>
        ${statusChip(r[0], r[1])}
        ${onlineChip(v.online)}
        ${!v.isGroup && v.online ? '<button class="secondary small-btn" data-vplay title="Play">▶</button>' : ''}
        <button class="secondary small-btn" data-vfolder>Open folder</button>
        <button class="small-btn" data-vassign>${videoUI.open === v.id ? 'Close' : 'Assign…'}</button>
      </div>
      ${videoUI.open === v.id ? `
      <div class="vid-assign">
        <form class="rv-search" data-vsearch>
          <input type="text" data-vq value="${escapeAttr(videoUI.q[v.id] || '')}" placeholder="Type the real movie or show name…" autocomplete="off">
          <input type="text" class="yr" data-vyr placeholder="Year" maxlength="4" value="${escapeAttr(videoUI.yr[v.id] || '')}">
          <button class="secondary small-btn" type="submit">Search</button>
        </form>
        <div class="muted vid-hint">${v.isGroup ? 'Pick the show this is.' : v.isFile ? 'Pick the movie, or the show it is an episode of.' : 'Pick the movie this folder is.'}</div>
        <div class="rv-results" data-vresults>${videoUI.results[v.id] || ''}</div>
      </div>` : ''}
    </div>`;
}

function videoMatches(v) {
  const lo = parseFloat(videoUI.minM), hi = parseFloat(videoUI.maxM);
  if ((lo > 0 || hi > 0) && !v.isGroup) {
    const d = (videoUI.dur[v.id] || 0) / 60;
    if (!d) return false; // length unknown: cannot satisfy a length filter
    if (lo > 0 && d < lo) return false;
    if (hi > 0 && d > hi) return false;
  }
  if (videoUI.filter === 'all') return true;
  if (videoUI.filter === 'shows') return v.isGroup;
  return v.video === videoUI.filter;
}

async function renderVideos() {
  const w = searchTerm.toLowerCase();
  const all = videos.filter(v => !w || `${v.title} ${v.path || ''} ${v.driveName || ''}`.toLowerCase().includes(w));
  const dir = videoUI.dir === 'desc' ? -1 : 1;
  const byName = (a, b) => (a.title || '').localeCompare(b.title || '');
  const cmp = {
    name: (a, b) => byName(a, b) * dir,
    size: (a, b) => ((a.size || 0) - (b.size || 0)) * dir || byName(a, b),
    length: (a, b) => { const x = videoUI.dur[a.id], y = videoUI.dur[b.id]; if (!x && !y) return byName(a, b); if (!x) return 1; if (!y) return -1; return (x - y) * dir || byName(a, b); } // unknown lengths always last
  }[videoUI.sort] || byName;
  const list = all.filter(videoMatches).sort(cmp);
  for (const id of [...videoUI.selected]) if (!videos.some(v => v.id === id)) videoUI.selected.delete(id);
  const count = (f) => all.filter(v => (f === 'all' ? true : f === 'shows' ? v.isGroup : v.video === f)).length;
  const chips = [['all', 'All'], ['clip', 'Clips'], ['removed', 'Removed from TV'], ['nomatch', 'No match'], ['unsure', 'Not sure'], ['shows', 'Shows']];
  const sel = videoUI.selected.size;
  content.innerHTML = `
    <div class="page-head"><h1>Videos</h1>
      <p>${videos.length.toLocaleString()} video${videos.length === 1 ? '' : 's'} not confirmed as a movie or show yet. <b>Assign</b> one to its real name and it moves to Movies or TV Series. <b>Delete</b> sends the file to the Recycle Bin.</p></div>
    <div class="toolbar">
      <div class="pills">${chips.map(([k, l]) => `<button class="pill${videoUI.filter === k ? ' active' : ''}" data-vfilter="${k}">${l} (${count(k)})</button>`).join('')}</div>
      <div class="tool-right">
        <span class="vid-range">Length <input type="number" min="0" data-vmin placeholder="min" value="${escapeAttr(videoUI.minM)}"> – <input type="number" min="0" data-vmax placeholder="max" value="${escapeAttr(videoUI.maxM)}"> minutes</span>
        <label class="check-row"><input type="checkbox" id="vAll"${list.length && list.every(v => videoUI.selected.has(v.id)) ? ' checked' : ''}> Select all shown</label>
        <button class="danger small-btn" id="vDelete"${sel ? '' : ' disabled'}>Move to Recycle Bin${sel ? ` (${sel})` : ''}</button>
      </div>
    </div>
    ${list.length ? `<div class="vid-sortbar">Sort by ${[['length', 'Length'], ['name', 'Name'], ['size', 'Size']].map(([k, l]) => `<button class="secondary small-btn${videoUI.sort === k ? ' active' : ''}" data-vsort="${k}" title="${videoUI.sort === k ? 'Click again to reverse' : 'Sort by ' + l.toLowerCase()}">${l}${videoUI.sort === k ? (videoUI.dir === 'desc' ? ' ▼' : ' ▲') : ''}</button>`).join('')}</div>` : ''}
    ${list.length ? `<div class="rows vid-list">${list.map(videoRow).join('')}</div>` : `<div class="empty">${videos.length ? 'Nothing in this filter.' : 'No loose or unconfirmed videos. Everything is matched.'}</div>`}`;

  content.querySelectorAll('[data-vsort]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.vsort; if (videoUI.sort === k) videoUI.dir = videoUI.dir === 'asc' ? 'desc' : 'asc'; else { videoUI.sort = k; videoUI.dir = k === 'name' ? 'asc' : 'desc'; } renderVideos(); }));
  const rng = (sel, key) => { const el = content.querySelector(sel); if (el) el.addEventListener('change', () => { videoUI[key] = el.value; renderVideos(); }); };
  rng('[data-vmin]', 'minM'); rng('[data-vmax]', 'maxM');
  content.querySelectorAll('[data-vfilter]').forEach(b => b.addEventListener('click', () => { videoUI.filter = b.dataset.vfilter; renderVideos(); }));
  content.querySelectorAll('[data-vsel]').forEach(c => c.addEventListener('change', () => {
    c.checked ? videoUI.selected.add(c.dataset.vsel) : videoUI.selected.delete(c.dataset.vsel);
    const btn = $('#vDelete'); btn.disabled = !videoUI.selected.size; btn.textContent = `Move to Recycle Bin${videoUI.selected.size ? ` (${videoUI.selected.size})` : ''}`;
  }));
  const va = $('#vAll'); if (va) va.addEventListener('change', () => { list.forEach(v => va.checked ? videoUI.selected.add(v.id) : videoUI.selected.delete(v.id)); renderVideos(); });
  content.querySelectorAll('[data-vid]').forEach(row => {
    const id = row.dataset.vid, v = byId.get(id);
    row.querySelector('[data-vfolder]').addEventListener('click', () => {
      if (v.isGroup) { const loc = v.path || ''; if (loc) openFolder(loc, v); else setStatus('This show spans several folders; open one from its detail page.'); }
      else openFolder(v.path, v);
    });
    const pl = row.querySelector('[data-vplay]'); if (pl) pl.addEventListener('click', () => playItem(v));
    row.querySelector('[data-vassign]').addEventListener('click', () => { videoUI.open = videoUI.open === id ? null : id; renderVideos(); if (videoUI.open === id) { const q = content.querySelector(`[data-vid="${CSS.escape(id)}"] [data-vq]`); if (q) q.focus(); } });
    const f = row.querySelector('[data-vsearch]');
    if (f) {
      f.addEventListener('submit', (e) => { e.preventDefault(); runVideoSearch(id); });
      f.querySelector('[data-vq]').addEventListener('input', (e) => { videoUI.q[id] = e.target.value; });
      f.querySelector('[data-vyr]').addEventListener('input', (e) => { videoUI.yr[id] = e.target.value; });
      if (videoUI.results[v.id]) bindVideoPicks(id);
    }
  });
  $('#vDelete').addEventListener('click', deleteSelectedVideos);
  loadDurations(list);
}

// video lengths are read from the file headers in the background, then filled in (and remembered for this session)
async function loadDurations(list) {
  const all = videoUI.sort === 'length' || parseFloat(videoUI.minM) > 0 || parseFloat(videoUI.maxM) > 0;
  const need = list.filter(v => !v.isGroup && v.online && videoUI.dur[v.id] === undefined).map(v => v.id);
  if (!need.length) return;
  const route0 = route.view;
  for (let i = 0; i < need.length; i += 100) {
    if (!all && i >= 120) break;
    const batch = need.slice(i, i + 100);
    const got = await window.api.getDurations({ ids: batch });
    for (const id of batch) videoUI.dur[id] = got[id] || 0;
    if (route.view !== route0) return;
    for (const id of batch) {
      const el = content.querySelector(`[data-vid="${CSS.escape(id)}"] [data-dur]`);
      if (el) el.textContent = videoUI.dur[id] ? fmtDur(videoUI.dur[id]) : '–';
    }
  }
  if (all && route.view === 'videos' && !document.activeElement.matches('[data-vq],[data-vyr],[data-vmin],[data-vmax]')) renderVideos(); // lengths are all known now: order the list by them
}

async function runVideoSearch(id) {
  const row = content.querySelector(`[data-vid="${CSS.escape(id)}"]`);
  const v = byId.get(id);
  if (!row || !v) return;
  const f = row.querySelector('[data-vsearch]'), box = row.querySelector('[data-vresults]');
  const q = f.querySelector('[data-vq]').value.trim(), year = parseInt(f.querySelector('[data-vyr]').value, 10) || null;
  videoUI.q[id] = f.querySelector('[data-vq]').value; videoUI.yr[id] = f.querySelector('[data-vyr]').value;
  if (!q) return;
  box.innerHTML = '<div class="muted">Searching…</div>';
  const res = await window.api.reviewSearch({ query: q, year });
  if (!res.ok) { box.innerHTML = '<div class="banner">Add your TMDB key (top bar) to look up titles.</div>'; return; }
  const ok = (c) => (v.isGroup ? c.type === 'tv' : v.isFile ? true : c.type === 'movie');
  const cands = res.candidates.filter(ok);
  box.innerHTML = cands.length ? `<div class="rv-cands">${cands.map(c => `
    <div class="rv-cand">
      ${c.thumb ? `<img src="${escapeAttr(c.thumb)}" alt="">` : '<div class="rv-noimg">?</div>'}
      <b title="${escapeAttr(c.title)}">${escapeHtml(c.title)}</b>
      <small>${c.year || ''} · ${c.type === 'tv' ? 'Series' : 'Movie'}</small>
      <button class="small-btn" data-vpick="${c.id}" data-vtype="${c.type}">${c.type === 'tv' ? 'Use as show' : 'Use as movie'}</button>
    </div>`).join('')}</div>` : '<div class="muted">Nothing found for that. Try fewer words.</div>';
  videoUI.results[id] = box.innerHTML;
  bindVideoPicks(id);
}

function bindVideoPicks(id) {
  const row = content.querySelector(`[data-vid="${CSS.escape(id)}"]`);
  if (!row) return;
  const box = row.querySelector('[data-vresults]');
  box.querySelectorAll('[data-vpick]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const r = await window.api.assignVideo({ id, tmdbId: +b.dataset.vpick, mediaType: b.dataset.vtype });
    if (!r.ok) { b.disabled = false; setStatus(r.error === 'no_key' ? 'Add your TMDB key first.' : 'Could not assign that one.'); return; }
    setStatus(`Moved to ${b.dataset.vtype === 'tv' ? 'TV Series' : 'Movies'}: ${r.title}${r.year ? ` (${r.year})` : ''}`);
    videoUI.open = null; videoUI.selected.delete(id); delete videoUI.results[id]; delete videoUI.q[id]; delete videoUI.yr[id];
    setLibrary(await window.api.getLibrary());
    render();
  }));
}

async function deleteSelectedVideos() {
  const items = [...videoUI.selected].map(id => byId.get(id)).filter(Boolean);
  if (!items.length) return;
  const names = items.slice(0, 8).map(v => `<li>${escapeHtml(v.isGroup ? `${v.title} (all ${v.episodes || v.fileCount || 0} episodes)` : (v.path || v.title).split(/[\\/]/).pop())}</li>`).join('');
  const c = await confirmBox({
    title: `Move ${items.length} item${items.length === 1 ? '' : 's'} to the Recycle Bin?`,
    body: `<p>These will be removed from the drive and the catalog. You can restore them from the Recycle Bin.</p><ul>${names}</ul>${items.length > 8 ? `<p class="muted">…and ${items.length - 8} more</p>` : ''}<p class="muted">If a drive has no Recycle Bin, that file is not touched and you will be told.</p>`,
    okText: 'Move to Recycle Bin', danger: true
  });
  if (!c.ok) return;
  setStatus('Moving to the Recycle Bin…');
  const r = await window.api.deleteVideos({ ids: items.map(v => v.id) });
  videoUI.selected.clear();
  const bits = [`${r.moved} moved to the Recycle Bin`];
  if (r.offline.length) bits.push(`${r.offline.length} skipped (drive offline)`);
  if (r.failed.length) bits.push(`${r.failed.length} NOT deleted: this drive may have no Recycle Bin`);
  setStatus(bits.join(' · '));
  if (r.failed.length) await confirmBox({ title: 'Some files were not deleted', body: `<p>Nothing was permanently deleted. These could not be moved to the Recycle Bin (the drive may not have one):</p><ul>${r.failed.slice(0, 8).map(f => `<li>${escapeHtml(f.name)}</li>`).join('')}</ul>`, okText: 'OK', hideCancel: true });
  setLibrary(await window.api.getLibrary());
  render();
}
