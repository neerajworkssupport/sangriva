// Compare Drives: pick two drives and see what is only on one, what is on both, and where the quality differs.
const cmpUI = { a: null, b: null, type: 'all', mode: 'onlyA' };

function cmpDriveIds(it) {
  if (it.isGroup) return Object.keys(it.driveNames || {});
  return it.driveId ? [it.driveId] : [];
}
function cmpKey(it) {
  if (it.type === 'movie') return it.versionKey || `m:${(it.title || '').toLowerCase()}|${it.year || ''}`;
  if (it.type === 'series') return `s:${it.key || (it.title || '').toLowerCase()}`;
  if (it.type === 'music') return `a:${(it.artist || '').toLowerCase()}|${(it.title || '').toLowerCase()}`;
  return `${it.type}:${(it.title || '').toLowerCase()}`;
}

function renderCompare() {
  const items = [...byId.values()].filter(i => ['movie', 'series', 'music', 'game'].includes(i.type) && !i.single && !i.video);
  const drives = new Map();
  for (const it of items) {
    if (it.isGroup) for (const [id, name] of Object.entries(it.driveNames || {})) drives.set(id, name || id);
    else if (it.driveId) drives.set(it.driveId, it.driveName || it.driveId);
  }
  const ids = [...drives.keys()];
  if (ids.length < 2) {
    content.innerHTML = `<div class="page-head"><h1>Compare Drives</h1><p>Scan at least two drives to compare them.</p></div><div class="empty">Only ${ids.length} drive${ids.length === 1 ? '' : 's'} catalogued so far.</div>`;
    return;
  }
  if (!ids.includes(cmpUI.a)) cmpUI.a = ids[0];
  if (!ids.includes(cmpUI.b) || cmpUI.b === cmpUI.a) cmpUI.b = ids.find(x => x !== cmpUI.a);
  const A = cmpUI.a, B = cmpUI.b;

  const groups = new Map();
  for (const it of items) {
    if (cmpUI.type !== 'all' && it.type !== cmpUI.type) continue;
    const k = cmpKey(it);
    let g = groups.get(k); if (!g) groups.set(k, g = { title: shownTitle(it), year: it.year, type: it.type, on: {} });
    for (const d of cmpDriveIds(it)) (g.on[d] = g.on[d] || []).push(it);
  }
  const bestRes = (list) => (list || []).reduce((m, x) => ((RES_RANK[x.quality && x.quality.res] || 0) > (RES_RANK[m] || 0) ? x.quality.res : m), '');
  const rows = { onlyA: [], onlyB: [], both: [], diff: [] };
  for (const g of groups.values()) {
    const a = g.on[A], b = g.on[B];
    if (a && !b) rows.onlyA.push(g);
    else if (b && !a) rows.onlyB.push(g);
    else if (a && b) {
      rows.both.push(g);
      if (g.type === 'movie' && bestRes(a) !== bestRes(b)) rows.diff.push(g);
    }
  }
  for (const k of Object.keys(rows)) rows[k].sort((x, y) => x.title.localeCompare(y.title));
  const nameA = drives.get(A), nameB = drives.get(B);
  const modes = [['onlyA', `Only on ${nameA}`], ['onlyB', `Only on ${nameB}`], ['both', 'On both'], ['diff', 'Different quality']];
  const list = rows[cmpUI.mode] || [];
  const opt = (cur, skip) => ids.filter(i => i !== skip).map(i => `<option value="${escapeAttr(i)}"${i === cur ? ' selected' : ''}>${escapeHtml(drives.get(i))}</option>`).join('');
  const chip = (list) => (list && list.length ? `${list.length > 1 ? list.length + '× ' : ''}${escapeHtml(bestRes(list) || (list[0].type === 'movie' ? 'Unknown' : 'Yes'))}` : '–');
  const row = (g) => `<div class="card row cmp-row"><div class="row-title">${escapeHtml(g.title)}${g.year ? ` (${g.year})` : ''}<small>${escapeHtml(TYPE_LABEL[g.type] || g.type)}</small></div>
      <span class="cmp-cell" title="${escapeAttr(nameA)}">${chip(g.on[A])}</span><span class="cmp-cell" title="${escapeAttr(nameB)}">${chip(g.on[B])}</span></div>`;
  content.innerHTML = `
    <div class="page-head"><h1>Compare Drives</h1><p>What do two of your drives have in common, and what is only on one of them? Unplugged drives work too.</p></div>
    <div class="toolbar coll-bar">
      <label class="arrange" style="margin-left:0">Drive 1 <select id="cmpA">${opt(A, null)}</select></label>
      <label class="arrange" style="margin-left:0">Drive 2 <select id="cmpB">${opt(B, A)}</select></label>
      <div class="pills">${[['all', 'Everything'], ['movie', 'Movies'], ['series', 'TV'], ['music', 'Music'], ['game', 'Games']].map(([k, l]) => `<button class="pill${cmpUI.type === k ? ' active' : ''}" data-ct="${k}">${l}</button>`).join('')}</div>
    </div>
    <div class="pills" style="margin:10px 0">${modes.map(([k, l]) => `<button class="pill${cmpUI.mode === k ? ' active' : ''}" data-cm="${k}">${escapeHtml(l)} (${rows[k].length})</button>`).join('')}</div>
    ${list.length ? `<div class="cmp-head"><span class="grow"></span><span class="cmp-cell">${escapeHtml(nameA)}</span><span class="cmp-cell">${escapeHtml(nameB)}</span></div><div class="rows">${list.slice(0, 400).map(row).join('')}</div>${list.length > 400 ? `<div class="muted pad">Showing 400 of ${list.length}. Narrow it with the type buttons.</div>` : ''}` : '<div class="empty">Nothing here.</div>'}`;
  $('#cmpA').addEventListener('change', (e) => { cmpUI.a = e.target.value; renderCompare(); });
  $('#cmpB').addEventListener('change', (e) => { cmpUI.b = e.target.value; renderCompare(); });
  content.querySelectorAll('[data-ct]').forEach(b => b.addEventListener('click', () => { cmpUI.type = b.dataset.ct; renderCompare(); }));
  content.querySelectorAll('[data-cm]').forEach(b => b.addEventListener('click', () => { cmpUI.mode = b.dataset.cm; renderCompare(); }));
}
