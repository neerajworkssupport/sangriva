// Wishlist: missing movies / shows / episodes you added with the heart. Entries leave by themselves once you own them.
async function renderWishlist() {
  const token = renderToken;
  content.innerHTML = '<div class="empty">Loading…</div>';
  const r = await window.api.getWishlist();
  if (token !== renderToken) return;
  await refreshWish();
  const items = r.items;
  const row = (e) => {
    const title = e.kind === 'episode' ? `${e.showTitle} · S${String(e.season).padStart(2, '0')}E${String(e.number).padStart(2, '0')}${e.name ? ' · ' + e.name : ''}` : `${e.title}${e.year ? ` (${e.year})` : ''}`;
    const kind = e.kind === 'upgrade' ? `Better than ${e.from}` : e.kind === 'episode' ? 'Episode' : e.type === 'tv' ? 'Series' : 'Movie';
    return `<div class="card row" data-wkey="${escapeAttr(e.key)}">
      <div class="thumb poster">${e.posterUrl ? `<img class="poster-img" src="${escapeAttr(e.posterUrl)}" alt="">` : escapeHtml((e.title || e.showTitle || '').slice(0, 18))}</div>
      <div class="row-title">${escapeHtml(title)}<small>Added ${escapeHtml(new Date(e.addedAt).toLocaleDateString())}</small></div>
      <span class="badge badge-${e.type === 'tv' ? 'series' : 'movie'}">${kind}</span>
      <button class="secondary small-btn" data-wremove>Remove</button></div>`;
  };
  content.innerHTML = `
    <div class="page-head"><h1>Wishlist</h1>
      <p>${items.length ? `${items.length} thing${items.length === 1 ? '' : 's'} you are missing and want. They disappear from here by themselves once the files show up in your library.` : 'Nothing yet. Tap the ♡ on a missing movie, show or episode (or press “Wish to Upgrade” on a 720p / SD movie) to add it here.'}</p></div>
    ${items.length ? `<div class="rows">${items.map(row).join('')}</div>` : '<div class="empty">Your wishlist is empty.</div>'}`;
  content.querySelectorAll('[data-wkey]').forEach(el => el.querySelector('[data-wremove]').addEventListener('click', async () => {
    await window.api.wishlistRemove({ key: el.dataset.wkey });
    renderWishlist();
  }));
}
