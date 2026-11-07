// Find on Drive: type a title (or an actor, genre...) and see which drive and shelf holds it, even when that drive is unplugged.
const findUI = { q: '' };

function findRow(it) {
  const where = it.isGroup && it.driveNames && Object.keys(it.driveNames).length
    ? Object.values(it.driveNames).filter(Boolean).join(' + ') : (it.driveName || 'Drive not recorded');
  const kind = TYPE_LABEL[it.type] || cap(it.type);
  return `
    <div class="card row" data-id="${escapeAttr(it.id)}">
      <div class="thumb poster${it.type === 'music' ? ' square' : ''}">${posterInner(it)}</div>
      <div class="row-title">${escapeHtml(shownTitle(it))}
        <small><b>${escapeHtml(where)}</b>${it.shelf ? ` · Shelf: <b>${escapeHtml(it.shelf)}</b>` : ' · <span class="muted">no shelf label (set one in Drives)</span>'}${it.path ? ` · ${escapeHtml(it.path)}` : ''}</small></div>
      <span class="badge badge-${escapeAttr(it.type)}">${escapeHtml(kind)}</span>
      ${qualityChip(it)}
      ${onlineChip(it.online)}
      ${it.online && it.path ? '<button class="secondary small-btn" data-fopen>Open folder</button>' : ''}
    </div>`;
}

async function renderFind() {
  content.innerHTML = `
    <div class="page-head"><h1>Find on Drive</h1><p>Type a title, artist, actor or genre. Each result says which drive and shelf it is on, and whether that drive is plugged in right now.</p></div>
    <div class="find-box"><input type="text" id="findQ" placeholder="e.g. Inception, Hans Zimmer, Breaking Bad…" autocomplete="off" value="${escapeAttr(findUI.q)}"></div>
    <div id="findOut"></div>`;
  const input = $('#findQ'), out = $('#findOut');
  const draw = () => {
    const w = findUI.q.trim().toLowerCase();
    if (!w) { out.innerHTML = '<div class="empty">Start typing to find where something lives.</div>'; return; }
    const hits = [...byId.values()].filter(i => !i.single && matchesSearch(i, w)).sort((a, b) => (shownTitle(a) || '').localeCompare(shownTitle(b) || ''));
    const shown = hits.slice(0, 150);
    out.innerHTML = hits.length
      ? `<div class="muted pad">${hits.length} match${hits.length === 1 ? '' : 'es'}${hits.length > shown.length ? ` (showing ${shown.length})` : ''}</div><div class="rows">${shown.map(findRow).join('')}</div>`
      : '<div class="empty">Nothing found.</div>';
    out.querySelectorAll('.card.row').forEach(c => {
      const it = byId.get(c.dataset.id);
      c.addEventListener('click', (ev) => { if (ev.target.closest('[data-fopen]')) { ev.stopPropagation(); openFolder(it.path, it); return; } if (it.type !== 'game') openItem(it); });
    });
  };
  input.addEventListener('input', () => { findUI.q = input.value; draw(); });
  draw();
  input.focus();
}
