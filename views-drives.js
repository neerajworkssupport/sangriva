// Drives page: one card per hard drive with name, shelf label, online status and space.
async function renderDrives(refresh = false) {
  const token = renderToken;
  if (!refresh) content.innerHTML = '<div class="empty">Loading…</div>';
  const [r, st] = await Promise.all([refresh ? window.api.refreshDrives() : window.api.getDrives(), window.api.getStorage()]);
  if (token !== renderToken) return;
  const sdOf = new Map(st.drives.map(x => [x.id, x]));
  updateSideDrives(r.drives);

  const cards = r.drives.map(d => {
    const pct = d.total && d.used != null ? Math.round((d.used / d.total) * 100) : null;
    const counts = [['Movies', d.counts.movie], ['Series', d.counts.series], ['Albums', d.counts.music], ['Games', d.counts.game]]
      .filter(([, n]) => n).map(([l, n]) => `${n} ${l}`).join(' · ');
    return `
      <div class="drive-card${d.online ? '' : ' is-off'}" data-drive="${escapeAttr(d.id)}">
        <div class="drive-top">
          <span class="drive-icon">💽</span>
          <div class="grow"><input class="drive-name" value="${escapeAttr(d.nickname)}" placeholder="${escapeAttr(d.label || d.name || 'Name this drive')}" maxlength="60" aria-label="Drive name">
            <small>${escapeHtml(d.label || '')}${d.online ? ` · currently ${escapeHtml(d.root)}` : ''}</small></div>
          ${d.kind === 'system' ? '<span class="chip kind" title="The drive Windows runs from">System</span>' : d.kind === 'removable' ? '<span class="chip kind">Removable</span>' : ''}${onlineChip(d.online)}
        </div>
        <label class="shelf"><span>Shelf</span><input class="drive-shelf" value="${escapeAttr(d.shelf)}" placeholder="e.g. Shelf A, row 2" maxlength="80" aria-label="Shelf location"></label>
        ${pct != null ? `<div class="bar"><i style="width:${pct}%"></i></div><div class="space"><span>${fmtBytes(d.used)} used of ${fmtBytes(d.total)}</span><span>${fmtBytes(d.free)} free</span></div>` : '<div class="space muted">Space info appears once the drive has been connected.</div>'}
        ${sdOf.has(d.id) ? storageBlock(sdOf.get(d.id)) : ''}
        ${driveHealthHTML(d)}
        <div class="drive-counts">${escapeHtml(counts || 'Nothing catalogued yet')}</div>
        <div class="drive-foot"><small>${d.online ? 'Connected now' : `Last connected ${ago(d.lastSeen)}`}</small>
          <span>${d.online ? '<button class="secondary" data-open-root>Open</button> <button class="secondary" data-scan-root>Scan this drive</button>' : ''}</span></div>
      </div>`;
  }).join('');

  content.innerHTML = `
    <div class="page-head row-head"><div><h1>Drives</h1><p>Your hard drives, where they sit on the shelf, and where the space goes. Remembered even when unplugged.</p></div>
      <div class="btn-row"><button class="secondary" id="drvRefresh">Refresh</button></div></div>
    ${r.unassigned ? `<div class="banner">${r.unassigned} older item${r.unassigned === 1 ? '' : 's'} aren’t linked to a drive yet. Scan their drive again and they’ll be assigned automatically.</div>` : ''}
    ${st.unmeasured ? `<div class="banner">${st.unmeasured} of ${st.total} items have no size yet. Rescan each drive to measure them.</div>` : ''}
    ${cards ? `<div class="drive-grid">${cards}</div>` : '<div class="empty">No drives yet.<br>Click <b>Scan Folder / Drive</b> and pick a drive to add it here.</div>'}
    ${cards ? storagePanels(st) : ''}`;
  content.querySelectorAll('[data-big]').forEach(x => x.addEventListener('click', () => { const it = byId.get(x.dataset.big); if (it) openItem(it); }));

  $('#drvRefresh').addEventListener('click', () => renderDrives(true));
  content.querySelectorAll('.drive-card').forEach(card => {
    const id = card.dataset.drive;
    const save = () => window.api.updateDrive({ id, nickname: $('.drive-name', card).value, shelf: $('.drive-shelf', card).value });
    card.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('change', save);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    });
    const d = r.drives.find(x => x.id === id);
    const sc = $('[data-scan-root]', card); if (sc) sc.addEventListener('click', () => scanFolder(d.root));
    const op = $('[data-open-root]', card); if (op) op.addEventListener('click', () => window.api.openPath(d.root));
  });
}

function updateSideDrives(drives) {
  const el = $('#sideDrives');
  if (!drives || !drives.length) { el.innerHTML = '<small>No drives yet</small>'; return; }
  const on = drives.filter(d => d.online).length;
  el.innerHTML = `<small>Drives</small><b>${on} of ${drives.length} online</b>
    <div class="side-dots">${drives.map(d => `<i class="${d.online ? 'on' : ''}" title="${escapeAttr(d.name + (d.shelf ? ' · ' + d.shelf : ''))}"></i>`).join('')}</div>`;
}

/** Last scanned / last seen, a stale warning, and "full in about N days" once there is enough history. */
function driveHealthHTML(d) {
  const h = d.health || {}, f = d.forecast;
  const bits = [];
  if (d.lastScan) bits.push(`Last scanned ${ago(d.lastScan)}`); else if (d.items !== 0) bits.push('Never scanned in this version');
  let fc = '';
  if (f && f.daysLeft != null) fc = f.daysLeft < 1 ? 'Full now at the current pace' : `At this pace it fills in about ${f.daysLeft < 90 ? f.daysLeft + ' days' : Math.round(f.daysLeft / 30) + ' months'}`;
  else if (f && f.perDay != null) fc = 'Growing slowly: no sign of filling up';
  return `<div class="drive-health">${h.stale ? `<span class="chip chip-amber" title="This drive has been unplugged for a long time. Plug it in and check it still works.">Not seen for ${h.daysSeen} days</span> ` : ''}${bits.length ? `<small>${escapeHtml(bits.join(' · '))}</small>` : ''}${fc ? `<small class="forecast"> · ${escapeHtml(fc)}</small>` : ''}</div>`;
}
