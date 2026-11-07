// Duplicates across drives, and "what does drive A have that drive B doesn't". Pure functions over library items.
const { queryFor } = require('./posters');
const { parseGameName, norm, editionKey } = require('./names');

/** Same-title key: movies/series by TMDB-style title+year, albums by artist+album, games by cleaned name. */
function dupKey(item) {
  if (item.type === 'movie' || item.type === 'series') {
    const q = queryFor({ ...item, path: item.path || '' });
    return q.key;
  }
  if (item.type === 'music') return `music|${norm(item.artist || '')}|${norm(item.album || item.title || '')}`;
  if (item.type === 'game') return `game|${norm(parseGameName(item.folderName || item.title).title)}`;
  return null;
}

function episodeSet(item) {
  const s = new Set();
  for (const [season, eps] of Object.entries(item.owned || {})) for (const e of eps) s.add(`${season}:${e}`);
  return s;
}

const resOf = (i) => (i.quality && i.quality.res) || null;

/**
 * Groups of the same title found more than once.
 * kind: 'exact' (identical main file), 'duplicate' (same title and quality),
 *       'quality' (different resolution/edition: keep both), 'split' (a show spread over drives, no overlap).
 */
function findDuplicates(lib0) {
  // a show that lives on several drives is one entry in the library but one copy per drive here
  const lib = [];
  for (const i of lib0) {
    if (i.isGroup && i.byDrive && Object.keys(i.byDrive).length > 1) {
      for (const [driveId, x] of Object.entries(i.byDrive)) lib.push({ ...i, driveId, owned: x.owned, size: x.size, driveName: i.driveNames && i.driveNames[driveId] || i.driveName, byDrive: { [driveId]: x } });
    } else lib.push(i);
  }
  const groups = new Map();
  for (const item of lib) {
    const k = dupKey(item);
    if (!k) continue;
    (groups.get(k) || groups.set(k, []).get(k)).push(item);
  }
  const out = [];
  let wasted = 0;
  const totals = { exact: 0, duplicate: 0, quality: 0, split: 0 };

  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const type = list[0].type;
    let kind = 'duplicate';

    if (type === 'series') {
      const sets = list.map(episodeSet);
      const anyOverlap = sets.some((a, i) => sets.some((b, j) => j > i && [...a].some(x => b.has(x))));
      if (!anyOverlap && sets.every(s => s.size)) kind = 'split';
    }
    if (kind !== 'split') {
      const sigs = list.map(i => i.sig).filter(Boolean);
      const resSet = new Set(list.map(resOf).filter(Boolean));
      const edSet = new Set(list.map(i => editionKey(i.quality)));
      if (resSet.size > 1 || edSet.size > 1) kind = 'quality';
      else if (sigs.length >= 2 && new Set(sigs).size < sigs.length) kind = 'exact';
    }

    const sizes = list.map(i => i.size || 0);
    const known = sizes.filter(Boolean);
    let wastedBytes = (kind === 'exact' || kind === 'duplicate') && known.length ? sizes.reduce((a, b) => a + b, 0) - Math.max(...sizes) : 0;
    if (type === 'series' && wastedBytes) { // only the episodes that really are on two drives count as wasted space
      const sets = list.map(episodeSet);
      const big = sizes.indexOf(Math.max(...sizes));
      wastedBytes = 0;
      list.forEach((_, n) => {
        if (n === big || !sets[n].size) return;
        const others = new Set(); sets.forEach((st, m) => { if (m !== n) st.forEach(x => others.add(x)); });
        const shared = [...sets[n]].filter(x => others.has(x)).length;
        wastedBytes += Math.round((sizes[n] || 0) * shared / sets[n].size);
      });
    }
    wasted += wastedBytes;
    totals[kind]++;
    out.push({
      key, kind, type, title: list[0].displayTitle || list[0].title, year: list[0].year || null,
      poster: (list.find(i => i.poster) || {}).poster || null, wastedBytes,
      copies: list.map(i => ({
        id: i.id, driveName: i.driveName || '', shelf: i.shelf || '', online: !!i.online, path: i.path,
        size: i.size || null, quality: i.quality || null, episodes: type === 'series' ? episodeSet(i).size : null
      }))
    });
  }
  const rank = { exact: 0, duplicate: 1, quality: 2, split: 3 };
  out.sort((a, b) => b.wastedBytes - a.wastedBytes || rank[a.kind] - rank[b.kind] || a.title.localeCompare(b.title));
  return { groups: out, totals, wasted };
}

/**
 * Titles drive `a` has that drive `b` doesn't.
 * status 'missing' = not on b at all, 'partial' = show on b lacks episodes a has.
 */
function compareDrives(lib0, a, b) {
  // a show that lives on several drives is compared drive by drive
  const lib = [];
  for (const i of lib0) {
    if (i.isGroup && i.byDrive) for (const [driveId, x] of Object.entries(i.byDrive)) lib.push({ ...i, driveId, owned: x.owned, size: x.size });
    else lib.push(i);
  }
  const onB = new Map();
  for (const i of lib) if (i.driveId === b) { const k = dupKey(i); if (k) (onB.get(k) || onB.set(k, []).get(k)).push(i); }
  const rows = [];
  for (const i of lib) {
    if (i.driveId !== a) continue;
    const k = dupKey(i);
    if (!k) continue;
    const there = onB.get(k);
    if (!there) { rows.push({ item: i, status: 'missing', size: i.size || null }); continue; }
    if (i.type === 'series') {
      const have = new Set();
      there.forEach(t => episodeSet(t).forEach(x => have.add(x)));
      const lacking = [...episodeSet(i)].filter(x => !have.has(x));
      if (lacking.length) rows.push({ item: i, status: 'partial', missingEpisodes: lacking.length, size: i.size || null });
    }
  }
  rows.sort((x, y) => (x.status === y.status ? 0 : x.status === 'missing' ? -1 : 1) || (x.item.title || '').localeCompare(y.item.title || ''));
  return rows;
}

module.exports = { dupKey, findDuplicates, compareDrives, episodeSet };
