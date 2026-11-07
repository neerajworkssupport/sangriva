// Move Planner: choose titles, preview the plan, move them (copy, check, Recycle Bin for the original), undo later.
const mv = { src: null, dest: null, sel: new Set(), q: '', plan: null, companions: [], extra: new Set(), busy: false, note: '', gather: false };

function moveDrives() { return (window.__mvDrives || []); }
const driveLabel = (d) => d.nickname || d.label || d.name || d.root || 'Drive';

function mvItems() {
  const w = mv.q.trim().toLowerCase();
  return library.filter(i => ['movie', 'series', 'music', 'game'].includes(i.type)
    && (i.isGroup ? (i.drives || []).includes(mv.src) : i.driveId === mv.src)
    && (!w || (shownTitle(i) + ' ' + (i.year || '')).toLowerCase().includes(w)))
    .sort((a, b) => (b.size || 0) - (a.size || 0));
}
const itemBytes = (i) => mv.gather ? (i.size || 0) : (i.isGroup && i.byDrive && i.byDrive[mv.src] ? i.byDrive[mv.src].size : i.size) || 0;

async function renderMove(preset) {
  const token = renderToken;
  if (preset) { Object.assign(mv, { dest: preset.dest, sel: new Set(preset.ids), plan: null, companions: [], extra: new Set(), q: '', note: preset.note || '', gather: true }); }
  const [dv, moves, split] = await Promise.all([window.api.getDrives(), window.api.getMoves(), window.api.getFranchiseSplit()]);
  if (token !== renderToken) return;
  window.__mvDrives = dv.drives;
  const online = dv.drives.filter(d => d.online);
  if (!mv.src || !dv.drives.some(d => d.id === mv.src)) mv.src = (online[0] || dv.drives[0] || {}).id;
  if (mv.dest === mv.src && !mv.gather) mv.dest = null;
  const list = mv.gather ? [...mv.sel].map(id => byId.get(id)).filter(Boolean) : mv.src ? mvItems() : [];
  const dOpt = (cur, skip) => dv.drives.filter(d => d.id !== skip).map(d => `<option value="${escapeAttr(d.id)}"${d.id === cur ? ' selected' : ''}${d.online ? '' : ' disabled'}>${escapeHtml(driveLabel(d))}${d.online ? '' : ' (offline)'}</option>`).join('');
  const selBytes = [...mv.sel].reduce((n, id) => { const i = byId.get(id); return n + (i ? itemBytes(i) : 0); }, 0);

  content.innerHTML = `
    <div class="page-head"><h1>Move Planner</h1><p>Move titles to another drive. Files keep their names, you see a plan first, and nothing is final: undo is kept for 30 days.</p></div>
    ${mv.note ? `<div class="banner">${escapeHtml(mv.note)}</div>` : ''}
    <div class="mv-cols">
      <section class="panel"><div class="panel-head"><h2>1. What to move</h2></div>
        <div class="mv-pick"><label>From <select id="mvSrc">${dOpt(mv.src, null)}</select></label>
          <label>To <select id="mvDest"><option value="">Choose a drive…</option>${dOpt(mv.dest, mv.gather ? null : mv.src)}</select></label></div>
        <input id="mvQ" class="mv-q" placeholder="Filter this drive’s titles" value="${escapeAttr(mv.q)}" aria-label="Filter titles">
        <div class="mv-list">${list.length ? list.map(i => `<label class="list-row mv-row"><input type="checkbox" data-mvsel="${escapeAttr(i.id)}"${mv.sel.has(i.id) ? ' checked' : ''}>
          <div class="grow"><b>${escapeHtml(shownTitle(i))}</b><small>${escapeHtml([i.year, TYPE_LABEL[i.type] || i.type].filter(Boolean).join(' · '))}</small></div><small>${fmtBytes(itemBytes(i))}</small></label>`).join('')
          : '<div class="muted pad">Nothing on this drive matches.</div>'}</div>
        <div class="btn-row pad"><span class="muted">${mv.sel.size} selected · ${fmtBytes(selBytes)}</span><button id="mvPlan"${mv.sel.size && mv.dest ? '' : ' disabled'}>Preview the move</button></div>
      </section>
      <section class="panel" id="mvPreview"><div class="panel-head"><h2>2. Preview</h2></div>${mv.plan ? mvPreviewHTML() : '<div class="muted pad">Pick titles and a target drive, then press Preview. Nothing moves yet.</div>'}</section>
    </div>
    ${split.length ? `<section class="panel"><div class="panel-head"><h2>Collections split across drives</h2><small class="muted">Keep franchises together</small></div>
      ${split.slice(0, 12).map((f, n) => `<div class="list-row"><div class="grow"><b>${escapeHtml(f.name)}</b><small>${f.drives.map(d => `${escapeHtml(d.name)}: ${d.count}`).join(' · ')}</small></div>
        <button class="secondary small-btn" data-gather="${n}"${f.online ? '' : ' disabled'} title="${f.online ? '' : 'Plug that drive in first'}">Gather ${f.count} on ${escapeHtml(f.targetName)}</button></div>`).join('')}</section>` : ''}
    <section class="panel"><div class="panel-head"><h2>Recent moves</h2><small class="muted">Undo puts every file back in its exact old folder</small></div>
      ${moves.length ? moves.map(m => `<div class="list-row"><div class="grow"><b>${escapeHtml(m.summary)}</b><small>${m.kind === 'inbox' ? 'Inbox tidy · ' : ''}${escapeHtml(m.fromTo)} · ${m.count} item${m.count === 1 ? '' : 's'} · ${ago(m.at)}</small></div>
        ${m.undone ? '<span class="chip">Undone</span>' : m.canUndo ? `<button class="secondary small-btn" data-undo="${escapeAttr(m.id)}">Undo</button>` : '<span class="chip">Too old to undo</span>'}</div>`).join('')
        : '<div class="muted pad">No moves yet.</div>'}</section>`;

  const redo = () => renderMove();
  $('#mvSrc').addEventListener('change', (e) => { mv.src = e.target.value; mv.gather = false; mv.sel = new Set(); mv.plan = null; if (mv.dest === mv.src) mv.dest = null; redo(); });
  $('#mvDest').addEventListener('change', (e) => { mv.dest = e.target.value || null; mv.plan = null; redo(); });
  $('#mvQ').addEventListener('input', (e) => { mv.q = e.target.value; const pos = e.target.selectionStart; renderMove().then(() => { const q = $('#mvQ'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }); });
  content.querySelectorAll('[data-mvsel]').forEach(c => c.addEventListener('change', () => { c.checked ? mv.sel.add(c.dataset.mvsel) : mv.sel.delete(c.dataset.mvsel); mv.plan = null; redo(); }));
  $('#mvPlan').addEventListener('click', mvPreview);
  content.querySelectorAll('[data-gather]').forEach(b => b.addEventListener('click', () => { const f = split[+b.dataset.gather]; renderMove({ dest: f.target, ids: f.ids, note: `${f.name}: ${f.count} title${f.count === 1 ? '' : 's'} from other drives selected to gather on ${f.targetName}. Untick any you want to leave, then press Preview.` }); }));
  content.querySelectorAll('[data-undo]').forEach(b => b.addEventListener('click', async () => {
    const c = await confirmBox({ title: 'Undo this move?', okText: 'Undo', body: '<p>Each file is copied back to its exact old folder, checked, and the moved copy goes to the Recycle Bin. If something is now in an old spot, that one is left alone and you are told.</p>' });
    if (!c.ok) return;
    b.disabled = true; setStatus('Putting files back…');
    const r = await window.api.moveUndo({ batchId: b.dataset.undo });
    setLibrary(await window.api.getLibrary());
    if (!r.ok) setStatus(r.error); else setStatus(r.failed.length ? `${r.back} put back, ${r.failed.length} left alone: ${r.failed[0].error}` : `${r.back} item${r.back === 1 ? '' : 's'} put back.`);
    renderMove();
  }));
  if (mv.plan) bindMvPreview();
}

function mvPreviewHTML() {
  const p = mv.plan;
  const dest = (window.__mvDrives || []).find(d => d.id === mv.dest) || {};
  const after = p.free != null && p.total ? Math.round(((p.total - p.free + p.bytes) / p.total) * 100) : null;
  return `${p.entries.length ? `<div class="mv-sum"><b>${p.entries.length}</b> title${p.entries.length === 1 ? '' : 's'} · <b>${fmtBytes(p.bytes)}</b> to ${escapeHtml(driveLabel(dest))}${p.free != null ? ` · ${fmtBytes(p.free)} free` : ''}</div>
      ${after != null ? `<div class="bar"><i style="width:${Math.min(100, after)}%"></i></div><small class="muted">${escapeHtml(driveLabel(dest))} would be ${after}% full</small>` : ''}
      ${p.enough ? '' : '<div class="banner red">Not enough free space on the target drive.</div>'}
      <div class="mv-list small">${p.entries.map(e => `<div class="list-row"><div class="grow"><b>${escapeHtml(e.title)}</b><small class="mono">${escapeHtml(e.rel)}</small></div><small>${fmtBytes(e.bytes)}</small></div>`).join('')}</div>` : '<div class="muted pad">Nothing can be moved with this selection.</div>'}
    ${p.skipped.length ? `<h3 class="cc-head">Left out (${p.skipped.length})</h3>${p.skipped.map(s => `<div class="list-row"><div class="grow"><b>${escapeHtml(s.title)}</b><small>${escapeHtml(s.reason)}</small></div></div>`).join('')}` : ''}
    ${mv.companions.length ? `<h3 class="cc-head">Keep franchises together</h3><p class="muted">These belong to the same franchise but are on another drive. Tick any to move them too.</p>
      ${mv.companions.map(c => `<label class="list-row"><input type="checkbox" data-mvextra="${escapeAttr(c.id)}"${mv.extra.has(c.id) ? ' checked' : ''}><div class="grow"><b>${escapeHtml(c.title)}</b><small>${escapeHtml(c.franchise)} · now on ${escapeHtml(c.driveName || '')}</small></div><small>${fmtBytes(c.bytes)}</small></label>`).join('')}` : ''}
    <div class="btn-row pad"><button id="mvGo"${p.entries.length && p.enough ? '' : ' disabled'}>Move ${p.entries.length} title${p.entries.length === 1 ? '' : 's'}</button><span class="muted" id="mvProg"></span></div>
    <p class="muted">Each title is copied, checked against the original, and only then is the original sent to the Recycle Bin.</p>`;
}

async function mvPreview() {
  const ids = [...mv.sel, ...mv.extra];
  const fromDriveId = mv.gather ? null : (mv.src || null);
  mv.plan = await window.api.movePlan({ ids, destDriveId: mv.dest, fromDriveId: (mv.extra.size || mv.gather) ? null : fromDriveId });
  mv.companions = await window.api.moveCompanions({ ids: [...mv.sel], destDriveId: mv.dest });
  mv.companions = mv.companions.filter(c => !mv.sel.has(c.id));
  const box = $('#mvPreview'); if (!box) return;
  box.innerHTML = `<div class="panel-head"><h2>2. Preview</h2></div>${mvPreviewHTML()}`;
  bindMvPreview();
}

function bindMvPreview() {
  content.querySelectorAll('[data-mvextra]').forEach(c => c.addEventListener('change', async () => { c.checked ? mv.extra.add(c.dataset.mvextra) : mv.extra.delete(c.dataset.mvextra); await mvPreview(); }));
  const go = $('#mvGo'); if (!go) return;
  go.addEventListener('click', async () => {
    const p = mv.plan, dest = (window.__mvDrives || []).find(d => d.id === mv.dest) || {};
    const c = await confirmBox({ title: `Move ${p.entries.length} title${p.entries.length === 1 ? '' : 's'}?`, okText: 'Move', body: `<p>${fmtBytes(p.bytes)} will be copied to <b>${escapeHtml(driveLabel(dest))}</b> and checked. The originals then go to the Recycle Bin. Names and folders stay the same, and you can undo this for 30 days.</p>` });
    if (!c.ok) return;
    go.disabled = true;
    window.api.onMoveProgress((pr) => { const el = $('#mvProg'); if (el) el.textContent = `${pr.n} of ${pr.total}: ${pr.title}`; });
    const r = await window.api.moveRun({ ids: [...mv.sel, ...mv.extra], destDriveId: mv.dest, fromDriveId: (mv.extra.size || mv.gather) ? null : mv.src });
    setLibrary(await window.api.getLibrary());
    mv.sel = new Set(); mv.extra = new Set(); mv.plan = null; mv.note = ''; mv.gather = false;
    setStatus(!r.ok ? r.error : r.failed.length ? `${r.done} moved, ${r.failed.length} did not: ${r.failed[0].error}` : `${r.done} title${r.done === 1 ? '' : 's'} moved. Undo is in Recent moves.`);
    renderMove();
  });
}
