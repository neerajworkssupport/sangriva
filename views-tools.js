// Duplicates and Storage pages.

// ---------- Duplicates ----------
const DUP_KIND = {
  exact: ['red', 'Identical copy'],
  duplicate: ['orange', 'Duplicate'],
  quality: ['blue', 'Different quality — keep both'],
  split: ['grey', 'Split across drives — keep both']
};

async function renderDuplicates() {
  const token = renderToken;
  content.innerHTML = '<div class="empty">Loading…</div>';
  const r = await window.api.getDuplicates();
  if (token !== renderToken) return;
  const tab = prefs.dupTab || 'dups';
  const isDup = (g) => g.kind === 'exact' || g.kind === 'duplicate';
  const dups = r.groups.filter(isDup), keep = r.groups.filter(g => !isDup(g));
  const shown = tab === 'dups' ? dups : keep;

  const block = (g) => {
    const [kind, label] = DUP_KIND[g.kind];
    return `<section class="panel dup">
      <div class="panel-head"><h2>${escapeHtml(g.title)} ${statusChip(kind, label)}</h2>
        <span class="muted">${g.wastedBytes ? `${fmtBytes(g.wastedBytes)} could be freed` : g.copies.length + ' copies'}</span></div>
      ${g.copies.map(c => {
        const it = byId.get(c.id);
        const q = c.quality && c.quality.res ? [c.quality.res, ...(c.quality.tags || []).filter(t => ['REMUX', 'HEVC', 'HDR', 'IMAX'].includes(t))].join(' · ') : '';
        return `<div class="list-row">
          <span class="list-icon ${c.online ? 'green' : 'grey'}">💽</span>
          <div class="grow"><b>${escapeHtml(c.driveName || 'Unknown drive')}</b>${c.shelf ? ` <span class="muted">· ${escapeHtml(c.shelf)}</span>` : ''}
            <small>${escapeHtml(c.path)}</small></div>
          ${q ? `<span class="q-chip static">${escapeHtml(q)}</span>` : ''}
          ${c.episodes != null ? `<span class="chip chip-grey">${c.episodes} episodes</span>` : ''}
          <span class="muted size">${c.size ? fmtBytes(c.size) : '—'}</span>
          ${onlineChip(c.online)}
          <button class="secondary small-btn" data-dup-open="${escapeAttr(c.id)}">Open</button></div>`;
      }).join('')}
    </section>`;
  };

  content.innerHTML = `
    <div class="page-head"><h1>Duplicates</h1><p>The same title found more than once across your drives. Nothing is deleted from here.</p></div>
    ${r.measured < r.total ? `<div class="banner">Sizes are known for ${r.measured} of ${r.total} items. Rescan each drive (Drives → Scan this drive) to measure the rest.</div>` : ''}
    <div class="two-stat">
      <button class="stat-card${tab === 'dups' ? ' active' : ''}" data-tab="dups"><span class="tile-icon">⧉</span><div><small>Duplicates</small><b>${dups.length}</b>
        <span class="muted">${r.wasted ? `${fmtBytes(r.wasted)} could be freed` : 'nothing to free'}</span></div></button>
      <button class="stat-card${tab === 'keep' ? ' active' : ''}" data-tab="keep"><span class="tile-icon">✓</span><div><small>Keep both</small><b>${keep.length}</b>
        <span class="muted">different quality or split shows</span></div></button>
    </div>
    ${shown.length ? shown.map(block).join('') : `<div class="empty">${tab === 'dups' ? 'No duplicates found. Nice.' : 'Nothing here.'}</div>`}`;

  content.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { prefs.dupTab = b.dataset.tab; savePrefs(); renderDuplicates(); }));
  content.querySelectorAll('[data-dup-open]').forEach(b => b.addEventListener('click', () => { const it = byId.get(b.dataset.dupOpen); if (it) openFolder(it.path, it); }));
}

// ---------- Storage ----------
const TYPE_COLORS = { movie: 'var(--green)', series: 'var(--blue)', music: 'var(--orange)', game: 'var(--purple)' };

/** Space breakdown for one drive (stacked bar by type + legend). sd = one entry of getStorage().drives */
function storageBlock(sd) {
  const types = [['movie', 'Movies'], ['series', 'Series'], ['music', 'Music'], ['game', 'Games']];
  const total = sd.total || 0;
  const seg = (n) => (total ? Math.max(0, (n / total) * 100) : 0);
  const other = sd.used != null ? Math.max(0, sd.used - sd.cataloged) : 0;
  return `${total ? `<div class="stack">${types.map(([k]) => `<i style="width:${seg(sd.byType[k])}%;background:${TYPE_COLORS[k]}"></i>`).join('')}<i style="width:${seg(other)}%;background:var(--muted-fill)"></i></div>` : ''}
    <div class="legend">${types.filter(([k]) => sd.byType[k]).map(([k, l]) => `<span><i style="background:${TYPE_COLORS[k]}"></i>${l} ${fmtBytes(sd.byType[k])}</span>`).join('') || '<span class="muted">No sizes measured yet</span>'}
      ${other ? `<span><i style="background:var(--muted-fill)"></i>Other files ${fmtBytes(other)}</span>` : ''}</div>
    ${sd.unmeasured ? `<small class="muted">${sd.unmeasured} item${sd.unmeasured === 1 ? '' : 's'} not measured yet — rescan this drive.</small>` : ''}`;
}

/** Video quality + biggest items panels (shown under the drive cards). */
function storagePanels(s) {
  const resRows = ['4K', '1080p', '720p', 'SD', 'unknown'].map(k => [k, s.resolution[k]]);
  const resTotal = resRows.reduce((n, [, v]) => n + v, 0) || 1;
  return `<div class="two-col">
      <section class="panel"><div class="panel-head"><h2>Video quality</h2><span class="muted">${resTotal === 1 && !resRows[0][1] ? '' : 'movies and series'}</span></div>
        ${resRows.map(([k, v]) => `<div class="q-row"><span>${k === 'unknown' ? 'Not in the name' : k}</span><div class="bar small"><i style="width:${Math.round((v / resTotal) * 100)}%"></i></div><b>${v}</b></div>`).join('')}
        ${s.upgradeCount ? `<div class="muted pad">${s.upgradeCount} title${s.upgradeCount === 1 ? ' is' : 's are'} 720p or lower. Open one and press “Wish to Upgrade”.</div>` : ''}
      </section>
      <section class="panel"><div class="panel-head"><h2>Biggest items</h2></div>
        ${s.biggest.map(b => `<div class="list-row" data-big="${escapeAttr(b.id)}"><div class="grow"><b>${escapeHtml(b.title)}</b><small>${escapeHtml(b.driveName || '')}</small></div>
          <span class="muted size">${fmtBytes(b.size)}</span>${onlineChip(b.online)}</div>`).join('') || '<div class="muted pad">Sizes appear after a scan.</div>'}
      </section>
    </div>`;
}

// Storage now lives on the Drives page.
function renderStorage() { return renderDrives(); }
