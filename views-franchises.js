// Manage Franchises: add / edit / remove the big universes (MCU, Star Wars…) that group movies and series in Collections and Missing.
async function openFranchiseEditor(onDone) {
  let list = (await window.api.getFranchises()).map(d => ({ ...d }));
  let editing = -1; // index being edited, -1 = adding
  let dlg = $('#franchiseDialog');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'franchiseDialog'; dlg.className = 'confirm fr-dialog'; document.body.appendChild(dlg); }
  const draw = (err) => {
    dlg.innerHTML = `
      <form method="dialog" id="frForm" autocomplete="off">
        <div class="fr-head"><div><h3>Manage Franchises</h3><p class="muted">Add, edit, or remove franchises.</p></div><button type="button" class="secondary small-btn" id="frX" aria-label="Close">×</button></div>
        <div class="muted fr-count">${list.length} franchise${list.length === 1 ? '' : 's'}</div>
        <div class="fr-list">${list.length ? list.map((d, i) => `
          <div class="fr-row${i === editing ? ' editing' : ''}">
            <div class="fr-name"><b>${escapeHtml(d.name)}</b><small>${escapeHtml(d.keyword)}</small></div>
            <span class="chip gray">${d.count != null ? d.count + ' titles' : 'not synced'}</span>
            <button type="button" class="secondary small-btn" data-fe="${i}" title="Edit">✎</button>
            <button type="button" class="secondary small-btn" data-fd="${i}" title="Remove">🗑</button>
          </div>`).join('') : '<div class="empty">No franchises yet.</div>'}</div>
        <div class="fr-form">
          <label>Name<input id="frName" type="text" placeholder="Star Wars Universe" value="${escapeAttr(editing >= 0 ? list[editing].name : '')}"></label>
          <label>TMDB keyword<input id="frKw" type="text" placeholder="star wars" value="${escapeAttr(editing >= 0 ? list[editing].keyword : '')}"></label>
          <button type="button" id="frAdd">${editing >= 0 ? 'Update Franchise' : '+ Add Franchise'}</button>
        </div>
        <div class="fr-err" id="frErr">${err ? escapeHtml(err) : ''}</div>
        <p class="muted fr-help">Uses TMDB keyword search. Changes are saved on this computer. A universe is split into its sub-series (Iron Man, Thor…) on its page.</p>
        <div class="dialog-actions"><button type="button" class="secondary" id="frCancel">Cancel</button><button type="submit" id="frSave">Save</button></div>
      </form>`;
    const form = $('#frForm');
    $('#frX').addEventListener('click', () => dlg.close());
    $('#frCancel').addEventListener('click', () => dlg.close());
    dlg.querySelectorAll('[data-fe]').forEach(b => b.addEventListener('click', () => { editing = +b.dataset.fe; draw(); $('#frName').focus(); }));
    dlg.querySelectorAll('[data-fd]').forEach(b => b.addEventListener('click', async () => {
      const d = list[+b.dataset.fd];
      const c = await confirmBox({ title: `Remove “${d.name}”?`, body: '<p>This only deletes the franchise definition, not any media.</p>', okText: 'Remove', danger: true });
      if (!c.ok) { if (!dlg.open) dlg.showModal(); return; }
      list.splice(+b.dataset.fd, 1); editing = -1; if (!dlg.open) dlg.showModal(); draw();
    }));
    const add = () => {
      const name = $('#frName').value.trim(), keyword = $('#frKw').value.trim();
      if (!name || !keyword) return draw('Name and keyword are both required.'), $('#frName').focus();
      const dup = list.findIndex((d, i) => i !== editing && d.keyword.toLowerCase() === keyword.toLowerCase());
      if (dup >= 0) return draw(`The keyword “${keyword}” is already used by “${list[dup].name}”.`);
      const dupN = list.findIndex((d, i) => i !== editing && d.name.toLowerCase() === name.toLowerCase());
      if (dupN >= 0) return draw(`“${name}” is already in the list.`);
      if (editing >= 0) list[editing] = { name, keyword, count: list[editing].keyword === keyword ? list[editing].count : null };
      else list.push({ name, keyword, count: null });
      editing = -1; draw();
    };
    $('#frAdd').addEventListener('click', add);
    dlg.querySelectorAll('#frName,#frKw').forEach(i => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if ($('#frName').value.trim() || $('#frKw').value.trim()) { add(); if ($('#frErr').textContent) return; } // a filled-in form counts as "add"
      const btn = $('#frSave'); btn.disabled = true; btn.textContent = 'Saving…';
      const r = await window.api.saveFranchises(list.map(d => ({ name: d.name, keyword: d.keyword })));
      if (!r.ok) { draw(r.error); return; }
      dlg.close();
      const bad = (r.results || []).filter(x => !x.found);
      setStatus(bad.length ? `Saved. Nothing found on TMDB for: ${bad.map(x => x.name).join(', ')}. Check the keyword spelling.` : r.results && r.results.length ? `Saved. ${r.results.map(x => `${x.name}: ${x.found} titles`).join(', ')}.` : r.hasKey ? 'Saved.' : 'Saved. Press Sync Info (needs your TMDB key) to fetch the titles.');
      if (onDone) onDone();
    });
  };
  draw();
  dlg.showModal();
}
