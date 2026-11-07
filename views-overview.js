// Overview (home) page: counts, recent additions, missing content, drive summary.
async function renderOverview() {
  const token = renderToken;
  content.innerHTML = '<div class="empty">Loading…</div>';
  const o = await window.api.getOverview();
  if (token !== renderToken) return;

  if (!o.total) {
    content.innerHTML = `
      <div class="page-head"><h1>Overview</h1><p>Your media library, organized. Your files, untouched.</p></div>
      <div class="empty">Nothing here yet.<br>Plug in a drive and click <b>Scan Folder / Drive</b> to start your catalog.</div>`;
    return;
  }

  const tile = (icon, label, value, foot, extra = '') => `
    <div class="tile"><div class="tile-top"><span class="tile-icon">${icon}</span><span>${label}</span></div>
      <div class="tile-value">${value}</div><div class="tile-foot">${foot}</div>${extra}</div>`;
  const plus = (n) => (n ? `<span class="up">▲ ${n} this week</span>` : '<span class="muted">no new this week</span>');
  const e = o.episodes;
  const synced = o.synced.eligible ? Math.round((o.synced.withDetails / o.synced.eligible) * 100) : 100;

  const recent = o.recent.map(i => cardHTML(byId.get(i.id) || i)).join('');
  const missRows = o.missingTop.map(m => {
    const first = m.seasons[0];
    const where = first ? `Season ${first.season}${first.uncertain ? '' : ', ' + (first.count === 1 ? 'Episode ' : 'Episodes ') + first.text}` : '';
    return `<div class="list-row" data-go="${escapeAttr(m.id)}">
      <span class="list-icon red">▶</span>
      <div class="grow"><b>${escapeHtml(m.title)}</b><small>${escapeHtml(where)}${m.seasons.length > 1 ? ` +${m.seasons.length - 1} more` : ''}</small></div>
      <span class="chip chip-red">${m.missingCount} missing</span><span class="chev">›</span></div>`;
  }).join('');
  const franRows = o.franchiseTop.map(f => `
    <div class="list-row" data-goto="missing-franchise">
      <span class="list-icon purple">★</span>
      <div class="grow"><b>${escapeHtml(f.name)}</b><small>You own ${f.owned} of ${f.total}</small></div>
      <span class="chip chip-orange">${f.missing} not in library</span><span class="chev">›</span></div>`).join('');

  const syncBanner = synced < 100
    ? `<div class="banner">Episode, franchise and cast info is ready for ${o.synced.withDetails} of ${o.synced.eligible} titles.
        <button id="ovSync" class="secondary">Sync info now</button></div>` : '';

  content.innerHTML = `
    <div class="page-head"><h1>Overview</h1><p>Your media library, organized. Your files, untouched.</p></div>
    ${syncBanner}
    <div id="ovNew"></div>
    <div class="tiles">
      ${tile('🎬', 'Movies', o.counts.movie.toLocaleString(), plus(o.fresh.movie))}
      ${tile('📺', 'TV Series', o.counts.series.toLocaleString(), e.avgCompletion != null ? `${e.avgCompletion}% average completion` : '<span class="muted">sync info to see completion</span>',
        e.avgCompletion != null ? `<div class="bar"><i style="width:${e.avgCompletion}%"></i></div>` : '')}
      ${tile('⚠️', 'Missing Episodes', e.tracked ? e.missing.toLocaleString() : '—', e.tracked ? `<span class="${e.missing ? 'down' : 'up'}">across ${e.shows} show${e.shows === 1 ? '' : 's'}</span>` : '<span class="muted">not synced yet</span>')}
      ${tile('🎵', 'Music Albums', o.counts.music.toLocaleString(), plus(o.fresh.music))}
    </div>

    <div class="two-col">
      <section class="panel">
        <div class="panel-head"><h2>Recent Additions</h2><a href="#" data-goto="all">View all ›</a></div>
        <div class="hscroll">${recent}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Missing</h2><a href="#" data-goto="missing">View all ›</a></div>
        ${missRows || ''}${franRows || ''}
        ${!missRows && !franRows ? `<div class="muted pad">${e.tracked ? 'Nothing missing. Nice.' : 'Click “Sync info” to find missing episodes and franchise movies.'}</div>` : ''}
        <button class="secondary wide" data-goto="missing">See all missing items →</button>
      </section>
    </div>

    <div class="statbar">
      <div><small>Drives online</small><b>${o.drives.online} of ${o.drives.total}</b></div>
      <div><small>Space used on drives</small><b>${o.drives.total ? fmtBytes(o.drives.used) : '—'}</b></div>
      <div><small>Items in catalog</small><b>${o.total.toLocaleString()}</b></div>
      <div><small>Posters</small><b>${o.posters.have}/${o.posters.total}</b></div>
      <div><small>Last scan</small><b>${o.lastScan ? ago(o.lastScan) : '—'}</b></div>
    </div>`;

  bindCards(content);
  content.querySelectorAll('[data-goto]').forEach(a => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    const v = a.dataset.goto;
    if (v === 'missing-franchise') { prefs.missingTab = 'franchise'; savePrefs(); go({ view: 'missing' }, { nav: true }); }
    else go({ view: v }, { nav: true });
  }));
  content.querySelectorAll('[data-go]').forEach(r => r.addEventListener('click', () => go({ view: 'detail', id: r.dataset.go })));
  window.api.getScanHistory().then((hist) => {
    const box = $('#ovNew'); if (!box || token !== renderToken) return;
    const rows = (hist || []).filter(h => h.new > 0 && !h.first).slice(0, 4);
    const mix = (h) => Object.entries(h.types || {}).map(([t, n]) => `${n} ${t === 'series' ? 'series' : t === 'movie' ? (n === 1 ? 'movie' : 'movies') : t}`).join(', ');
    box.innerHTML = `<section class="panel new-shelf"><div class="panel-head"><h2>New on the shelf</h2><a href="#" id="ovTonight">What should I watch tonight? →</a></div>
      ${rows.length ? rows.map(h => `<div class="list-row"><span class="list-icon green">＋</span><div class="grow"><b>${h.new} new on ${escapeHtml(h.drive)}</b><small>${escapeHtml(mix(h))}</small></div><small class="muted">${ago(h.at)}</small></div>`).join('') : '<div class="muted pad">Nothing new since your last scans.</div>'}</section>`;
    $('#ovTonight').addEventListener('click', (ev) => { ev.preventDefault(); go({ view: 'queue' }, { nav: true }); });
  }).catch(() => {});
  const sb = $('#ovSync'); if (sb) sb.addEventListener('click', syncMeta);
  queuePosters(o.recent.map(i => byId.get(i.id)).filter(Boolean));
}
