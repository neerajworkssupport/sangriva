// Backup & History: save / restore the catalog, and see what each scan changed.
const fmtWhen = (t) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '–');

async function renderBackup() {
  const token = renderToken;
  content.innerHTML = '<div class="empty">Loading…</div>';
  const [list, hist] = await Promise.all([window.api.backupList(), window.api.getScanHistory()]);
  if (token !== renderToken) return;
  const backRow = (b) => `<div class="card row" data-bname="${escapeAttr(b.name)}">
      <div class="row-title">${escapeHtml(fmtWhen(b.at))}<small>${b.kind === 'before' ? 'Saved automatically before Clear Library or a restore' : 'Daily automatic copy'}${b.items != null ? ` · ${b.items} items` : ''} · ${escapeHtml(fmtBytes(b.size))}</small></div>
      <button class="secondary small-btn" data-brestore>Restore this</button></div>`;
  const histRow = (h) => `<tr><td>${escapeHtml(fmtWhen(h.at))}</td><td>${escapeHtml(h.drive || '–')}</td>
      <td>${h.first ? `<span class="muted">first scan</span> ${h.total}` : (h.new ? `<b class="g">+${h.new}</b>` : '0')}</td>
      <td>${h.removed ? `<b class="r">−${h.removed}</b>` : '0'}</td><td>${h.changed || 0}</td><td>${h.total}</td>
      <td>${h.unreadable ? statusChip('orange', `${h.unreadable} unreadable`) : ''}</td></tr>`;
  content.innerHTML = `
    <div class="page-head"><h1>Backup &amp; History</h1>
      <p>One file holds your whole catalog and every choice you made (matches, wishlist, watched marks, languages…). Posters, cast info and your TMDB key are not in it; posters and cast info can be fetched again.</p></div>
    <div class="btn-row" style="margin-bottom:16px"><button id="bkExport">Save a backup file…</button><button id="bkRestore" class="secondary">Restore from a file…</button></div>
    <h2 class="cc-head">Automatic copies</h2>
    <p class="muted">The app keeps a daily copy (last 7) and a safety copy before every Clear Library or restore (last 5).</p>
    ${list.length ? `<div class="rows">${list.map(backRow).join('')}</div>` : '<div class="empty">No automatic copies yet. One is made after your first scan.</div>'}
    <h2 class="cc-head" style="margin-top:28px">Scan history</h2>
    ${hist.length ? `<table class="vtable"><thead><tr><th>When</th><th>Drive</th><th>New</th><th>No longer there</th><th>Changed</th><th>Total</th><th></th></tr></thead><tbody>${hist.map(histRow).join('')}</tbody></table>` : '<div class="empty">No scans recorded yet. Scan a drive and what changed shows up here.</div>'}`;
  const done = (r, what) => {
    if (r.canceled) return;
    if (!r.ok) { setStatus(r.error || `Could not ${what}.`); return; }
    return r;
  };
  $('#bkExport').addEventListener('click', async () => { const r = done(await window.api.backupExport(), 'save the backup'); if (r) setStatus(`Backup saved (${r.items} items): ${r.path}`); });
  const restore = async (name) => {
    const c = await confirmBox({ title: 'Restore this backup?', body: '<p>Your current catalog and choices will be replaced by the ones in the backup. A safety copy of the current state is saved first, so this can be undone from the list below. The app restarts to load it.</p>', okText: 'Restore' });
    if (!c.ok) return;
    const r = done(await window.api.backupRestore(name ? { name } : {}), 'restore');
    if (r) setStatus('Restored. Restarting…');
  };
  $('#bkRestore').addEventListener('click', () => restore(null));
  content.querySelectorAll('[data-bname]').forEach(el => el.querySelector('[data-brestore]').addEventListener('click', () => restore(el.dataset.bname)));
}
