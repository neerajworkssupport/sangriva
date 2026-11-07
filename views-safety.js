// Copy Safety: which titles live on one drive only, stale drives, read-only broken-file check.
let safetyPick = null;

async function renderSafety() {
  const token = renderToken;
  content.innerHTML = '<div class="empty">Checking your copies…</div>';
  const r = await window.api.getCopySafety();
  if (token !== renderToken) return;
  if (!r.total) { content.innerHTML = '<div class="page-head"><h1>Copy Safety</h1><p>If a drive fails, what would you lose for good?</p></div><div class="empty">Scan a drive first.</div>'; return; }
  const drives = [...r.drives].sort((a, b) => b.unsafe - a.unsafe);
  if (!safetyPick || !drives.some(d => d.id === safetyPick)) safetyPick = (drives[0] || {}).id;
  const pct = r.total ? Math.round(((r.single) / r.total) * 100) : 0;
  const pick = drives.find(d => d.id === safetyPick);
  const items = (r.unsafeByDrive && r.unsafeByDrive[safetyPick]) || [];

  content.innerHTML = `
    <div class="page-head"><h1>Copy Safety</h1><p>If a drive fails, what would you lose for good? Based on titles found on more than one drive in your catalog. Offline drives count too.</p></div>
    <div class="tiles safety-tiles">
      <div class="tile"><div class="tile-top"><span>On one drive only</span></div><div class="tile-value red-text" id="sfSingle">${r.single.toLocaleString()}</div><div class="tile-foot muted">of ${r.total.toLocaleString()} titles · ${pct}%</div></div>
      <div class="tile"><div class="tile-top"><span>On two or more drives</span></div><div class="tile-value green-text">${r.multi.toLocaleString()}</div><div class="tile-foot muted">safe against one drive failing${r.markedSafe ? ` · ${r.markedSafe} marked backed up elsewhere` : ''}</div></div>
      <div class="tile"><div class="tile-top"><span>Not checked for 90+ days</span></div><div class="tile-value ${r.stale.length ? 'orange-text' : ''}">${r.stale.length ? r.stale.length + (r.stale.length === 1 ? ' drive' : ' drives') : 'None'}</div>
        <div class="tile-foot muted">${r.stale.length ? r.stale.map(s => escapeHtml(s.name) + ' · ' + (s.daysScan || s.daysSeen || '?') + ' days').join(', ') : 'Every drive was seen recently'}</div></div>
    </div>
    <div class="safety-cols">
      <section class="panel"><div class="panel-head"><h2>If this drive fails, you lose…</h2></div>
        ${drives.map(d => `<div class="list-row safety-drive${d.id === safetyPick ? ' sel' : ''}" data-sdrive="${escapeAttr(d.id)}">
          <div class="grow"><b>${escapeHtml(d.name)}</b><small>${d.items} titles${d.online ? '' : ' · offline'}</small></div>
          <span class="chip ${d.unsafe && d.unsafe / Math.max(1, d.items) > .6 ? 'chip-red' : d.unsafe ? 'chip-amber' : 'chip-green'}">${d.unsafe} not copied elsewhere</span></div>`).join('')}
        ${r.suggestDrive ? `<p class="muted pad">Most free space for new copies: <b>${escapeHtml(r.suggestDrive.name)}</b> (${fmtBytes(r.suggestDrive.free)} free).</p>` : ''}
      </section>
      <section class="panel"><div class="panel-head"><h2>Most worth backing up</h2><small class="muted">${pick ? escapeHtml(pick.name) : ''} · by size</small></div>
        ${items.length ? items.map(i => `<label class="list-row safety-item"><input type="checkbox" data-skey="${escapeAttr(i.key)}">
          <div class="grow"><b data-sgo="${escapeAttr(i.id)}">${escapeHtml(i.title)}</b></div>${i.res ? `<span class="q-chip">${escapeHtml(i.res)}</span>` : ''}<small>${fmtBytes(i.size)}</small></label>`).join('')
          : '<div class="muted pad">Everything on this drive has another copy.</div>'}
        ${items.length ? '<div class="btn-row pad"><button class="secondary" id="sfMark">Mark selected as backed up elsewhere</button></div>' : ''}
      </section>
    </div>
    <section class="panel" id="brokenBox"><div class="panel-head"><h2>Check for broken files</h2></div>
      <p class="muted">Read-only. Looks for missing, empty, tiny or unreadable files and bad file headers. It is a quick check, not a full integrity test, and nothing is changed or moved.</p>
      <div class="btn-row">${drives.filter(d => d.online).map(d => `<button class="secondary" data-broken="${escapeAttr(d.id)}">Check ${escapeHtml(d.name)}</button>`).join('') || '<span class="muted">Plug in a drive to check it.</span>'}
        <button class="secondary" id="brkCancel" hidden>Stop</button></div>
      <div id="brokenOut"></div>
    </section>`;

  content.querySelectorAll('[data-sdrive]').forEach(row => row.addEventListener('click', () => { safetyPick = row.dataset.sdrive; renderSafety(); }));
  content.querySelectorAll('[data-sgo]').forEach(b => b.addEventListener('click', () => go({ view: 'detail', id: b.dataset.sgo })));
  const mk = $('#sfMark');
  if (mk) mk.addEventListener('click', async () => {
    const keys = [...content.querySelectorAll('[data-skey]:checked')].map(c => c.dataset.skey);
    if (!keys.length) { setStatus('Tick the titles that have a copy somewhere else.'); return; }
    await window.api.setSafe({ keys, on: true });
    setStatus(`${keys.length} title${keys.length === 1 ? '' : 's'} marked as backed up elsewhere.`);
    renderSafety();
  });
  const out = $('#brokenOut'), cancel = $('#brkCancel');
  const off = window.api.onBrokenProgress ? window.api.onBrokenProgress((p) => { const o = $('#brokenOut'); if (o && o.dataset.busy) o.innerHTML = `<p class="muted">Checked ${p.n} files…${p.cur ? ' ' + escapeHtml(String(p.cur).split(/[\\/]/).pop()) : ''}</p>`; }) : null;
  content.querySelectorAll('[data-broken]').forEach(b => b.addEventListener('click', async () => {
    out.dataset.busy = '1'; out.innerHTML = '<p class="muted">Starting…</p>'; cancel.hidden = false;
    content.querySelectorAll('[data-broken]').forEach(x => x.disabled = true);
    const res = await window.api.checkBroken({ driveId: b.dataset.broken });
    delete out.dataset.busy; cancel.hidden = true;
    if (!$('#brokenOut')) return;
    content.querySelectorAll('[data-broken]').forEach(x => x.disabled = false);
    if (!res.ok) { out.innerHTML = `<p class="red-text">${escapeHtml(res.error || 'The check did not run.')}</p>`; return; }
    const why = { missing: 'File is missing', empty: 'File is empty', tiny: 'Suspiciously small', header: 'Header looks damaged', unreadable: 'Cannot be read' };
    out.innerHTML = `<p><b>${res.bad.length}</b> problem${res.bad.length === 1 ? '' : 's'} found${res.canceled ? ' (stopped early)' : ''} in ${res.checked != null ? res.checked + ' files' : 'this drive'}.</p>` +
      (res.bad.length ? res.bad.map(x => `<div class="list-row"><div class="grow"><b>${escapeHtml(x.title || '')}</b><small class="mono">${escapeHtml(x.path)}</small></div><span class="chip chip-red">${why[x.reason] || x.reason}</span>
        <button class="secondary small-btn" data-bopen="${escapeAttr(x.path)}">Open folder</button></div>`).join('') : '<p class="muted">Nothing suspicious.</p>');
    out.querySelectorAll('[data-bopen]').forEach(o => o.addEventListener('click', () => window.api.openPath(o.dataset.bopen.replace(/[\\/][^\\/]*$/, '') || o.dataset.bopen)));
  }));
  cancel.addEventListener('click', () => window.api.cancelBroken());
}
