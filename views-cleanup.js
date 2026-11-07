// Clean Up: inbox suggestions (nothing moves by itself) and junk files (Recycle Bin after you approve).
const cl = { junk: {}, busy: null };

async function renderCleanup() {
  const token = renderToken;
  const [inbox, dv] = await Promise.all([window.api.getInbox(), window.api.getDrives()]);
  if (token !== renderToken) return;
  const online = dv.drives.filter(d => d.online);
  content.innerHTML = `
    <div class="page-head"><h1>Clean Up</h1><p>Suggestions only. Nothing is moved or deleted until you say so, and nothing is ever renamed.</p></div>
    <section class="panel"><div class="panel-head"><h2>Inbox</h2><small class="muted">Folders waiting outside your usual place</small></div>
      ${inbox.length ? `<p class="muted">These sit in an inbox-style folder or loose on the drive. Each suggestion is a move into the folder where the rest of that kind already lives. You can undo it in Move Planner.</p>
        ${inbox.map(s => `<label class="list-row"><input type="checkbox" data-ib="${escapeAttr(s.id)}" checked><div class="grow"><b>${escapeHtml(s.title)}</b><small class="mono">${escapeHtml(s.driveName)} · ${escapeHtml(s.fromRel)} → ${escapeHtml(s.toRel)}</small></div><small>${fmtBytes(s.bytes)}</small></label>`).join('')}
        <div class="btn-row pad"><button id="ibGo">Move selected</button></div>`
        : '<div class="muted pad">Nothing is waiting in an inbox.</div>'}
    </section>
    <section class="panel"><div class="panel-head"><h2>Junk files</h2><small class="muted">Sample clips, unfinished downloads, site notes, empty folders</small></div>
      <p class="muted">Looks for sample clips, partial downloads, torrent and website leftovers, Thumbs.db and empty folders. Game folders are never searched. Approved items go to the Recycle Bin, so you can still restore them.</p>
      <div class="btn-row">${online.map(d => `<button class="secondary" data-junk="${escapeAttr(d.id)}">Scan ${escapeHtml(driveLabel(d))}</button>`).join('') || '<span class="muted">Plug in a drive to scan it.</span>'}<button class="secondary" id="jkStop" hidden>Stop</button></div>
      <div id="junkOut"></div></section>`;

  const ib = $('#ibGo');
  if (ib) ib.addEventListener('click', async () => {
    const ids = [...content.querySelectorAll('[data-ib]:checked')].map(c => c.dataset.ib);
    if (!ids.length) return;
    const c = await confirmBox({ title: `Move ${ids.length} folder${ids.length === 1 ? '' : 's'}?`, okText: 'Move', body: '<p>Each folder moves on its own drive into the folder shown. Names stay exactly as they are. You can undo this in Move Planner.</p>' });
    if (!c.ok) return;
    ib.disabled = true;
    const r = await window.api.inboxApply({ ids });
    setLibrary(await window.api.getLibrary());
    setStatus(r.ok ? (r.failed.length ? `${r.done} moved, ${r.failed.length} did not: ${r.failed[0].error}` : `${r.done} moved.`) : r.error);
    renderCleanup();
  });
  content.querySelectorAll('[data-junk]').forEach(b => b.addEventListener('click', async () => {
    const out = $('#junkOut'), stop = $('#jkStop');
    out.innerHTML = '<p class="muted">Looking…</p>'; stop.hidden = false;
    content.querySelectorAll('[data-junk]').forEach(x => x.disabled = true);
    const r = await window.api.scanJunk({ driveId: b.dataset.junk });
    if (!$('#junkOut')) return;
    $('#jkStop').hidden = true; content.querySelectorAll('[data-junk]').forEach(x => x.disabled = false);
    if (!r.ok) { out.innerHTML = `<p class="red-text">${escapeHtml(r.error)}</p>`; return; }
    drawJunk(b.dataset.junk, r);
  }));
  $('#jkStop').addEventListener('click', () => window.api.cancelJunk());
}

function drawJunk(driveId, r) {
  const out = $('#junkOut');
  if (!r.items.length) { out.innerHTML = '<p>No junk found on this drive.</p>'; return; }
  const groups = {};
  r.items.forEach(i => (groups[i.reason] ||= []).push(i));
  out.innerHTML = `<p><b>${r.items.length}</b> item${r.items.length === 1 ? '' : 's'} · ${fmtBytes(r.bytes)}${r.capped ? ' (showing the first 3,000)' : ''}</p>
    ${Object.entries(groups).map(([why, list]) => `<details class="jk-group" open><summary><b>${escapeHtml(why)}</b> <small>${list.length} · ${fmtBytes(list.reduce((n, i) => n + i.size, 0))}</small></summary>
      ${list.slice(0, 200).map(i => `<label class="list-row"><input type="checkbox" data-jk="${escapeAttr(i.path)}" checked><div class="grow"><small class="mono">${escapeHtml(i.path)}</small></div><small>${i.isDir ? 'folder' : fmtBytes(i.size)}</small></label>`).join('')}
      ${list.length > 200 ? `<div class="muted pad">+${list.length - 200} more of this kind (included when you approve)</div>` : ''}</details>`).join('')}
    <div class="btn-row pad"><button class="danger" id="jkGo">Send to Recycle Bin</button><button class="secondary" id="jkNone">Select none</button></div>`;
  const hidden = r.items.filter(i => !out.querySelector(`[data-jk="${CSS.escape(i.path)}"]`)).map(i => i.path);
  $('#jkNone').addEventListener('click', () => { out.querySelectorAll('[data-jk]').forEach(c => c.checked = false); hidden.length = 0; });
  $('#jkGo').addEventListener('click', async () => {
    const paths = [...[...out.querySelectorAll('[data-jk]:checked')].map(c => c.dataset.jk), ...hidden];
    if (!paths.length) return;
    const c = await confirmBox({ title: `Send ${paths.length} item${paths.length === 1 ? '' : 's'} to the Recycle Bin?`, okText: 'Send to Recycle Bin', danger: true, body: '<p>Only files that are still junk are removed. Your movies, shows and music are never touched. You can restore anything from the Recycle Bin.</p>' });
    if (!c.ok) return;
    const res = await window.api.trashJunk({ driveId, paths });
    setStatus(res.ok ? `${res.moved} sent to the Recycle Bin (${fmtBytes(res.bytes)})${res.skipped ? `, ${res.skipped} skipped` : ''}${res.failed.length ? `, ${res.failed.length} failed` : ''}.` : res.error);
    out.innerHTML = `<p>${res.moved} item${res.moved === 1 ? '' : 's'} sent to the Recycle Bin (${fmtBytes(res.bytes)}).</p>`;
  });
}
