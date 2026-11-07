// Pure helpers for episodes, missing-content maths and music folder names (no Electron, no network).
// File names are only READ here to work out episode numbers. Nothing is ever renamed.

const VIDEO_RE = /\.(mkv|mp4|avi|mov|wmv|m4v|ts|webm)$/i;

/**
 * Season/episode numbers from a file name.
 * "Show.S01E02.mkv" -> {season:1, eps:[2]}, "S01E01-E03" -> [1,2,3], "1x05", "Episode 5", "05 - Title" (season null).
 */
function parseEpisodes(fileName) {
  const name = String(fileName || '').replace(VIDEO_RE, '');

  let m = name.match(/s(\d{1,2})[ ._-]?e(\d{1,3})/i);
  if (m) {
    const season = +m[1];
    const eps = [+m[2]];
    let rest = name.slice(m.index + m[0].length);
    for (;;) {
      const more = rest.match(/^(?:([ ._-]?)e(\d{1,3})|-(\d{1,3})(?![\d p]))/i);
      if (!more) break;
      const n = +(more[2] || more[3]);
      const last = eps[eps.length - 1];
      const dash = more[3] != null || more[1] === '-'; // "E01-03" and "E01-E03" are ranges, "E01E02" is a list
      if (dash && n > last && n - last <= 24) for (let k = last + 1; k <= n; k++) eps.push(k);
      else eps.push(n);
      rest = rest.slice(more[0].length);
    }
    return { season, eps };
  }

  m = name.match(/season[ ._-]*(\d{1,2})[^]*?episode[ ._-]*(\d{1,3})/i);
  if (m) return { season: +m[1], eps: [+m[2]] };

  m = name.match(/(?<!\d)(\d{1,2})x(\d{2,3})(?!\d)/i);
  if (m) return { season: +m[1], eps: [+m[2]] };

  m = name.match(/(?:^|[^a-z0-9])(?:ep?|episode)[ ._-]*(\d{1,3})(?![\dp])/i);
  if (m) return { season: null, eps: [+m[1]] };

  m = name.match(/^(\d{1,3})(?=[ ._-]|$)/);
  if (m) return { season: null, eps: [+m[1]] };

  return null;
}

/**
 * Episode numbers for a list of file names.
 * defaultSeason is used for files that carry no season of their own (e.g. inside a "Season 2" folder).
 * Returns { bySeason: {"1":[1,2,3]}, files, parsed } where files = video files seen, parsed = files we understood.
 */
function collectEpisodes(fileNames, defaultSeason = 1) {
  const sets = new Map();
  let files = 0, parsed = 0;
  for (const f of fileNames) {
    if (!VIDEO_RE.test(f)) continue;
    files++;
    const r = parseEpisodes(f);
    if (!r) continue;
    parsed++;
    const s = r.season == null ? defaultSeason : r.season;
    if (!sets.has(s)) sets.set(s, new Set());
    r.eps.forEach(e => sets.get(s).add(e));
  }
  const bySeason = {};
  for (const [s, set] of sets) bySeason[s] = [...set].sort((a, b) => a - b);
  return { bySeason, files, parsed };
}

/** Merge several collectEpisodes() results (one per season folder) into one owned map. */
function mergeOwned(results) {
  const owned = {};
  const stats = {};
  for (const { season, res } of results) {
    for (const [s, eps] of Object.entries(res.bySeason)) owned[s] = [...new Set([...(owned[s] || []), ...eps])].sort((a, b) => a - b);
    const st = stats[season] || (stats[season] = { files: 0, parsed: 0 });
    st.files += res.files;
    st.parsed += res.parsed;
  }
  return { owned, stats };
}

/** [7,8,9,12] -> "7–9, 12" */
function ranges(nums) {
  const a = [...nums].sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < a.length;) {
    let j = i;
    while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    out.push(j > i ? `${a[i]}–${a[j]}` : `${a[i]}`);
    i = j + 1;
  }
  return out.join(', ');
}

/** How many episodes of each season (not specials) have aired, from a TMDB /tv/{id} payload. */
function airedBySeason(details, today = new Date()) {
  const out = {};
  const last = details && details.last_episode_to_air;
  for (const s of (details && details.seasons) || []) {
    if (!s.season_number) continue; // season 0 = specials: never counted as missing
    const total = s.episode_count || 0;
    let aired;
    if (last && s.season_number < last.season_number) aired = total;
    else if (last && s.season_number === last.season_number) aired = last.episode_number;
    else if (last) aired = 0;
    else aired = s.air_date && new Date(s.air_date) <= today ? total : 0;
    out[s.season_number] = total ? Math.min(aired, total) : aired;
  }
  return out;
}

/**
 * What is missing for one series.
 * item: { owned:{season:[eps]}, seasonStats:{season:{files,parsed}} }, details: cached TMDB show payload.
 * A season whose files we could not read at all is skipped (reported as uncertain) instead of being called "all missing".
 */
function seriesStatus(item, details, today = new Date()) {
  const aired = airedBySeason(details, today);
  const owned = item.owned || {};
  const stats = item.seasonStats || {};
  const missing = [];
  let airedTotal = 0, ownedAired = 0, missingCount = 0;

  for (const [sKey, count] of Object.entries(aired)) {
    if (!count) continue;
    const st = stats[sKey];
    if (st && st.files > 0 && st.parsed === 0) { missing.push({ season: +sKey, numbers: [], uncertain: true, aired: count }); continue; }
    const have = new Set(owned[sKey] || []);
    const numbers = [];
    for (let e = 1; e <= count; e++) if (!have.has(e)) numbers.push(e);
    airedTotal += count;
    ownedAired += count - numbers.length;
    missingCount += numbers.length;
    if (numbers.length) missing.push({ season: +sKey, numbers, uncertain: !!(st && st.parsed < st.files), aired: count });
  }
  return {
    airedTotal, ownedAired, missingCount, missing,
    completion: airedTotal ? Math.round((ownedAired / airedTotal) * 100) : null
  };
}

// ---------- music ----------
const GENERIC_PARENTS = new Set(['music', 'albums', 'album', 'audio', 'songs', 'mp3', 'flac', 'itunes', 'downloads', '']);

/** "Artist - Album (2015)" or ".../Artist/Album (2015)" -> { artist, album, year } */
function parseMusicName(folderName, parentName = '') {
  let name = String(folderName || '');
  const ym = name.match(/[(\[]\s*((?:19|20)\d{2})\s*[)\]]/) || name.match(/(?:^|[\s._-])((?:19|20)\d{2})(?=[\s._-]|$)/);
  const year = ym ? +ym[1] : null;
  name = name.replace(/[(\[]\s*(?:19|20)\d{2}\s*[)\]]/g, '').replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();
  const parts = name.split(/\s+[-–]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), album: parts.slice(1).join(' - ').trim(), year };
  const parent = String(parentName || '').trim();
  const artist = GENERIC_PARENTS.has(parent.toLowerCase()) || /^[a-z]:\\?$/i.test(parent) ? '' : parent;
  return { artist, album: name, year };
}

module.exports = { VIDEO_RE, parseEpisodes, collectEpisodes, mergeOwned, ranges, airedBySeason, seriesStatus, parseMusicName };
