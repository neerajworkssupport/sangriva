// Missing: missing TV episodes and franchise gaps.
const missUI = { open: new Set() };
async function renderMissing() {
  const token = renderToken;
  content.innerHTML = '<div class="empty">Loading…</div>';
  const m = await window.api.getMissing();
  if (token !== renderToken) return;

  const tab = prefs.missingTab === 'franchise' ? 'franchise' : 'episodes';
  const epTotal = m.episodes.reduce((n, e) => n + e.missingCount, 0);
  const frMissing = m.franchises.reduce((n, f) => n + f.missing.length, 0);
  const frGroups = m.franchises.filter(f => f.missing.length).length;
  const notSynced = m.synced.eligible && m.synced.withDetails < m.synced.eligible;

  const sync = notSynced ? `<div class="banner">Info is ready for ${m.synced.withDetails} of ${m.synced.eligible} titles, so these lists may be incomplete.
      <button id="msSync" class="secondary">${m.synced.hasKey ? 'Sync info now' : 'Add TMDB key'}</button></div>` : '';

  const sortBy = ['most', 'az'].includes(prefs.missingSort) ? prefs.missingSort : 'closest';
  const sorters = { most: (a, b) => b.missingCount - a.missingCount || a.title.localeCompare(b.title), az: (a, b) => a.title.localeCompare(b.title) };
  const eps = sortBy === 'closest' ? m.episodes : m.episodes.slice().sort(sorters[sortBy]);
  const cant = m.cantCheck || [];
  const isOpen = (k) => missUI.open.has(k) ? ' open' : '';
  const epRows = eps.map(e => `
    <details class="miss-det" data-mk="ep:${escapeAttr(e.id)}"${isOpen('ep:' + e.id)}>
      <summary class="miss-row">
        <span class="caret">▶</span>
        <div class="thumb">${e.poster ? `<img class="poster-img" src="${escapeAttr(e.poster)}" alt="">` : ''}</div>
        <div class="grow"><b>${escapeHtml(e.title)}</b> ${e.year ? `<span class="muted">(${e.year})</span>` : ''}</div>
        <div class="miss-side">${e.completion != null ? `<div class="bar small"><i style="width:${e.completion}%"></i></div><small>${e.completion}% complete</small>` : ''}</div>
        ${e.missingCount ? statusChip('red', `${e.missingCount} missing`) : statusChip('grey', 'check names')}
      </summary>
      <div class="miss-body">
        <div class="miss-seasons">${e.seasons.map(s => `<span class="${s.uncertain ? 'muted' : ''}">Season ${s.season}: ${escapeHtml(s.text)}</span>`).join('')}</div>
        <small>${escapeHtml(driveLine(e) || '')}</small>
        <button class="secondary small-btn" data-go="${escapeAttr(e.id)}">Open show</button>
      </div>
    </details>`).join('');
  const franBlocks = m.franchises.filter(f => f.missing.length).map(f => `
    <details class="panel fran miss-det" data-mk="fr:${escapeAttr(f.name)}"${isOpen('fr:' + f.name)}>
      <summary class="panel-head"><span class="caret">▶</span><h2><a href="#" class="coll-link" data-gocoll="${escapeAttr(f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">${escapeHtml(f.name)}</a> ${statusChip('red', `${f.missing.length} missing`)}</h2>
        <span class="muted">You own ${f.owned} of ${f.total}</span><button class="small-btn" data-gocoll="${escapeAttr(f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}" title="Open the whole collection: owned and missing">Open collection ›</button></summary>
      <div class="bar"><i style="width:${Math.round((f.owned / f.total) * 100)}%"></i></div>
      <div class="grid small-grid">${f.missing.map(p => ghostCardHTML(p)).join('')}</div>
      ${f.upcoming.length ? `<div class="muted pad">Not released yet: ${f.upcoming.map(p => escapeHtml(p.title) + (p.release_date ? ` (${fmtDay(p.release_date)})` : '')).join(', ')}</div>` : ''}
    </details>`).join('');

  content.innerHTML = `
    <div class="page-head"><h1>Missing</h1><p>Only what you are missing: episodes of shows you collect, and movies or shows from your franchises.</p></div>
    ${sync}
    <div class="two-stat">
      <button class="stat-card${tab === 'episodes' ? ' active' : ''}" data-tab="episodes"><span class="tile-icon">📺</span><div><small>Missing TV episodes</small><b>${epTotal.toLocaleString()}</b>
        <span class="muted">across ${m.episodes.length} show${m.episodes.length === 1 ? '' : 's'}</span></div></button>
      <button class="stat-card${tab === 'franchise' ? ' active' : ''}" data-tab="franchise"><span class="tile-icon">★</span><div><small>Missing franchise movies</small><b>${frMissing.toLocaleString()}</b>
        <span class="muted">across ${frGroups} franchise${frGroups === 1 ? '' : 's'}</span></div></button>
    </div>
    ${tab === 'episodes'
      ? (epRows ? `<div class="sort-row"><label>Sort <select id="msSort"><option value="closest"${sortBy === 'closest' ? ' selected' : ''}>Closest to complete</option><option value="most"${sortBy === 'most' ? ' selected' : ''}>Most missing</option><option value="az"${sortBy === 'az' ? ' selected' : ''}>A–Z</option></select></label><span class="grow"></span><button class="secondary small-btn" data-mexp="1">Expand all</button><button class="secondary small-btn" data-mexp="0">Collapse all</button></div><div class="miss-list">${epRows}</div>` : `<div class="empty">${m.synced.withDetails ? 'No missing episodes found.' : 'Sync info to find missing episodes.'}</div>`)
      : (franBlocks ? `<div class="sort-row"><span class="grow"></span><button class="secondary small-btn" data-mexp="1">Expand all</button><button class="secondary small-btn" data-mexp="0">Collapse all</button></div>${franBlocks}` : `<div class="empty">${m.synced.withDetails ? 'No franchise gaps found.' : 'Sync info to find franchise gaps.'}<br><small>Franchise lists come from TMDB collections and the universes in franchises.json.</small></div>`)}`;

  bindWish(content);
  content.querySelectorAll('.miss-det').forEach(d => d.addEventListener('toggle', () => { d.open ? missUI.open.add(d.dataset.mk) : missUI.open.delete(d.dataset.mk); }));
  content.querySelectorAll('[data-mexp]').forEach(b => b.addEventListener('click', () => {
    const open = b.dataset.mexp === '1';
    content.querySelectorAll('.miss-det').forEach(d => { d.open = open; });
  }));
  content.querySelectorAll('[data-gocoll]').forEach(b => b.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); go({ view: 'collection', key: b.dataset.gocoll }); }));
  const srt = $('#msSort'); if (srt) srt.addEventListener('change', () => { prefs.missingSort = srt.value; savePrefs(); renderMissing(); });
  content.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { prefs.missingTab = b.dataset.tab; savePrefs(); renderMissing(); }));
  content.querySelectorAll('[data-go]').forEach(r => r.addEventListener('click', (ev) => { ev.preventDefault(); go({ view: 'detail', id: r.dataset.go }); }));
  const s = $('#msSync');
  if (s) s.addEventListener('click', () => (m.synced.hasKey ? syncMeta() : openKeyDialog('Add your TMDB key to sync episode and franchise info.')));
}
