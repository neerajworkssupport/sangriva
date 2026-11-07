// Game covers and descriptions from the public Steam store (no key needed).
// Network access is injected (getJson), which also makes this testable.
const { norm } = require('./names');

const SEARCH = 'https://store.steampowered.com/api/storesearch/';
const DETAILS = 'https://store.steampowered.com/api/appdetails';
const cover = (id) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`;

/** Exact name first, then "starts with" (e.g. "Hades" vs "Hades II" never wins over "Hades"). */
function pickGame(items, title) {
  const want = norm(title);
  if (!want) return null;
  const list = (items || []).filter(i => i && i.id && i.name);
  return list.find(i => norm(i.name) === want)
    || list.find(i => norm(i.name).replace(/\b(the|a|an)\b/g, '').replace(/\s+/g, ' ').trim() === want.replace(/\b(the|a|an)\b/g, '').replace(/\s+/g, ' ').trim())
    || null;
}

/** Returns { appId, name, description, genres, year, coverUrls: [portrait, header] } or null when Steam doesn't know the game. */
async function lookupGame(title, getJson) {
  const found = await getJson(`${SEARCH}?term=${encodeURIComponent(title)}&l=english&cc=us`);
  const hit = pickGame(found && found.items, title);
  if (!hit) return null;
  let d = null;
  try {
    const r = await getJson(`${DETAILS}?appids=${hit.id}&l=english`);
    d = r && r[hit.id] && r[hit.id].success ? r[hit.id].data : null;
  } catch {}
  const y = d && d.release_date && String(d.release_date.date || '').match(/\b(19|20)\d{2}\b/);
  return {
    appId: hit.id,
    name: (d && d.name) || hit.name,
    description: d ? String(d.short_description || '').slice(0, 400) : '',
    genres: d ? (d.genres || []).map(g => g.description).slice(0, 4) : [],
    year: y ? +y[0] : null,
    coverUrls: [cover(hit.id), d && d.header_image].filter(Boolean)
  };
}

module.exports = { pickGame, lookupGame, cover };
