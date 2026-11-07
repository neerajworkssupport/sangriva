// To Watch queue and Tonight's pick.
let tonight = { genre: 'all', max: 'any', online: true, pickId: null };

function tonightPool() {
  return library.filter(i => i.type === 'movie' && !i.watched && !i.queued_skip
    && (!tonight.online || i.online)
    && (tonight.genre === 'all' || (i.genres || []).includes(tonight.genre))
    && (tonight.max === 'any' || !i.runtime || i.runtime <= +tonight.max));
}

async function renderQueue() {
  const queued = library.filter(i => i.queued).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  const genres = [...new Set(library.filter(i => i.type === 'movie').flatMap(i => i.genres || []))].sort();
  const pool = tonightPool();
  if (!tonight.pickId || !pool.some(i => i.id === tonight.pickId)) tonight.pickId = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : null;
  const pick = tonight.pickId ? byId.get(tonight.pickId) : null;
  const opt = (v, t, cur) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${t}</option>`;

  content.innerHTML = `
    <div class="page-head"><h1>To Watch</h1><p>Your queue, and a pick for tonight when you cannot decide.</p></div>
    <section class="panel tonight" id="tonight"><div class="panel-head"><h2>Tonight’s pick</h2></div>
      <div class="tonight-filters">
        <label>Genre <select id="tnGenre">${opt('all', 'Any', tonight.genre)}${genres.map(g => opt(escapeAttr(g), escapeHtml(g), tonight.genre)).join('')}</select></label>
        <label>Length <select id="tnMax">${[['any', 'Any'], ['100', 'Up to 100 min'], ['130', 'Up to 130 min'], ['160', 'Up to 160 min']].map(([v, t]) => opt(v, t, tonight.max)).join('')}</select></label>
        <label class="fcheck"><input type="checkbox" id="tnOnline"${tonight.online ? ' checked' : ''}> Only drives plugged in</label>
        <button class="secondary" id="tnAgain">Another</button></div>
      ${pick ? `<div class="tonight-pick">${cardHTML(pick)}<div><h3>${escapeHtml(shownTitle(pick))}</h3><p class="muted">${escapeHtml([pick.year, pick.runtime ? pick.runtime + ' min' : '', (pick.genres || []).join(', ')].filter(Boolean).join(' · '))}</p>
        <div class="btn-row"><button id="tnPlay">▶ Play</button>${pick.queued ? '' : '<button class="secondary" id="tnQueue">＋ Add to queue</button>'}<button class="secondary" id="tnOpen">Details</button></div></div></div>`
        : '<div class="muted pad">No unwatched movie matches. Loosen a filter.</div>'}
    </section>
    <h2 class="cc-head">Queue (${queued.length})</h2>
    ${queued.length ? `<div class="grid">${queued.map(i => cardHTML(i)).join('')}</div>` : '<div class="empty">Nothing queued. Press ＋ on any poster to add it here.</div>'}`;

  bindCards(content);
  queuePosters([...queued, ...(pick ? [pick] : [])]);
  const again = () => { tonight.pickId = null; renderQueue(); };
  $('#tnGenre').addEventListener('change', (e) => { tonight.genre = e.target.value; again(); });
  $('#tnMax').addEventListener('change', (e) => { tonight.max = e.target.value; again(); });
  $('#tnOnline').addEventListener('change', (e) => { tonight.online = e.target.checked; again(); });
  $('#tnAgain').addEventListener('click', () => {
    const others = tonightPool().filter(i => i.id !== tonight.pickId);
    tonight.pickId = others.length ? others[Math.floor(Math.random() * others.length)].id : tonight.pickId; renderQueue();
  });
  const pl = $('#tnPlay'); if (pl) pl.addEventListener('click', () => playItem(pick));
  const op = $('#tnOpen'); if (op) op.addEventListener('click', () => go({ view: 'detail', id: pick.id }));
  const tq = $('#tnQueue'); if (tq) tq.addEventListener('click', () => toggleMark(pick, 'q', null));
}
