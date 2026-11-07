// Pure poster helpers (no Electron dependency) so they can be tested on their own.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const hashMemo = new Map();
const sha1 = (s) => {
  const k = String(s);
  let h = hashMemo.get(k);
  if (h === undefined) {
    h = crypto.createHash('sha1').update(k).digest('hex');
    if (hashMemo.size > 200000) hashMemo.clear();
    hashMemo.set(k, h);
  }
  return h;
};

// Stable id for a library item. Hash of the full path (the old base64 slice collided for
// any folders sharing their first 12 characters, so posters landed on the wrong cards).
const idFor = (p) => sha1(p).slice(0, 16);

// ---------- name parsing ----------
const VIDEO_EXT_RE = /\.(mkv|mp4|avi|mov|wmv|m4v|ts|webm|mpg|mpeg|m2ts)$/i;

// Release tags that can never be part of a title: they always end it.
const STRONG = /^(?:480p|576p|720p|1080p|1080i|2160p|4k|uhd|blu-?ray|bluray|brrip|bdrip|bdremux|remux|web-?rip|web-?dl|webrip|webdl|hdrip|dvdrip|dvdscr|hdtv|pdtv|hdcam|hdts|telesync|x264|x265|h\.?26[45]|hevc|avc|xvid|divx|av1|aac\d*|ac3|eac3|dts|dts-?hd|ddp?\d*|atmos|truehd|hdr10?|hdr|10bit|8bit|6ch|2ch|5\.1|7\.1|nf|amzn|dsnp|hmax|hulu|atvp|yify|yts|rarbg|ettv|eztv|psa)$/i;
// Edition / language / scene words: they end a title only when more release noise follows
// ("The.A.Team.EXTENDED.2010.720p" cuts at EXTENDED, "Extended Family" stays whole).
const WEAK = /^(?:extended|unrated|uncut|remastered|restored|theatrical|imax|directors?|director'?s|cut|final|special|edition|ultimate|collectors?|anniversary|proper|repack|internal|limited|dual|multi|dubbed|subbed|subs|audio|hindi|english|tamil|telugu|korean|japanese|french|spanish|german|eng|kor|hin|tam|tel|jap|complete|bonus|extras|3d|hsbs|sbs|webhd|web|hd|sd|ts|cam)$/i;
const SEASON_TOKEN = /^(?:s\d{1,2}(?:e\d{1,3}(?:-?e?\d{1,3})*)?|\d{1,2}x\d{2,3}|season\d*|series\d+|episode\d*|e\d{2,3})$/i;
const YEAR_TOKEN = /^(?:19|20)\d{2}$/;
// "198h3", "20l0", "19838": looks like a year but isn't a valid one
const BAD_YEAR_TOKEN = /^(?:19|20)(?=[0-9a-z]*[a-z])[0-9a-z]{2,3}$|^(?:19|20)\d{3}$/i;

/**
 * Title and year from a release or folder name. Reads only; never renames.
 * "The.A.Team.EXTENDED.2010.720p.BrRip.x264.YIFY.mp4" -> { title: "The A Team", year: 2010 }
 * "Scarface.198h3.720p.HDTV.x264.AAC"                  -> { title: "Scarface", year: null, yearIssue: "198h3" }
 */
const parseMemo = new Map();
function parseMediaName(raw) {
  const mk = String(raw || '');
  const hit = parseMemo.get(mk);
  if (hit) return { ...hit };
  const out = parseMediaNameUncached(mk);
  if (parseMemo.size > 100000) parseMemo.clear();
  parseMemo.set(mk, out);
  return { ...out };
}
function parseMediaNameUncached(raw) {
  let s = String(raw || '').replace(VIDEO_EXT_RE, '').trim();
  s = s.replace(/^(?:\[[^\]]*\]\s*)+/, '').replace(/^(?:www\.)?[a-z0-9-]+\.(?:com|net|org|to|me|cc|io|tv|in)\s*[-–]\s*/i, '');

  let year = null, yearIssue = null, bare = false;
  const paren = s.match(/[(\[]\s*((?:19|20)\d{2})\s*[)\]]/);
  if (paren) {
    year = +paren[1];
    s = s.slice(0, paren.index);
  }
  const tokens = s.replace(/[(\[][^)\]]*[)\]]/g, ' ').split(/[\s._]+/).filter(Boolean);

  const root = (t) => t.split('-')[0];
  const isStrong = (t) => STRONG.test(t) || STRONG.test(root(t));
  const isWeak = (t) => WEAK.test(t) || WEAK.test(root(t));
  const isSeason = (t) => SEASON_TOKEN.test(t) || SEASON_TOKEN.test(root(t));
  // is there release noise (or a year) after position i?
  // a bare "Season"/"Episode" only ends the title when a number follows ("Anatomy of an Episode - A Mother's Mercy" stays whole)
  const isSeasonAt = (i) => (/^(?:season|series|episode)$/i.test(tokens[i]) ? /^\d{1,3}$/.test(tokens[i + 1] || '') : isSeason(tokens[i]));
  const noiseAfter = (i) => tokens.slice(i + 1).some((t, k) => isStrong(t) || isSeasonAt(i + 1 + k) || YEAR_TOKEN.test(t) || BAD_YEAR_TOKEN.test(t));

  // 1. where does release noise start?  2. the year is the last plain 19xx/20xx before that
  let noiseAt = tokens.length;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (isStrong(t) || isSeasonAt(i)) { noiseAt = i; break; }
    if (BAD_YEAR_TOKEN.test(t) && !YEAR_TOKEN.test(t)) { yearIssue = t; noiseAt = i; break; }
  }
  let cut = noiseAt, yearAt = -1;
  for (let i = 1; i < noiseAt; i++) if (YEAR_TOKEN.test(tokens[i])) yearAt = i;
  if (!paren && yearAt > 0) { year = +tokens[yearAt]; bare = true; cut = yearAt; }
  else if (!paren) {
    // no year: an edition word right before the noise ("Movie.EXTENDED.1080p") is not part of the title
    cut = noiseAt;
  }
  // trailing edition words before the year / noise are not part of the title
  const SAFE_EDITION = /^(?:extended|unrated|uncut|remastered|restored|theatrical|imax|proper|repack|internal|limited|dual|multi|dubbed|subbed|directors?|director'?s|ultimate|collectors?|anniversary|hsbs|sbs)$/i;
  if (cut < tokens.length || paren) {
    while (cut > 1 && (SAFE_EDITION.test(tokens[cut - 1]) || (/^cut$/i.test(tokens[cut - 1]) && /^director'?s?$/i.test(tokens[cut - 2] || '')))) cut--;
  }
  const tidy = (t) => t.replace(/[()\[\]]/g, ' ').replace(/\s*[-–:,]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();
  let title = tidy(tokens.slice(0, cut).join(' '));
  if (!title) title = tidy(tokens.join(' '));
  // "Wonder Woman 1984": the year may be part of the title, so keep an alternative query
  return { title, year, yearIssue, altTitle: bare && year && title ? `${title} ${year}` : null };
}

const SEASON_RE = /^(?:(?:season|series)[\s._-]*\d{1,2}\b.*|s\d{1,2})$/i;
const MEDIA_TYPES = { movie: 'movie', series: 'tv' };

/** Everything needed to look an item up: cache key, search title, year, TMDB type. */
function queryFor(item) {
  const p = item.path || '';
  let name = path.basename(p) || item.title || '';
  // "Season 1" folders: search with the show folder's name instead
  if (SEASON_RE.test(name.trim()) && path.dirname(p) !== p) name = path.basename(path.dirname(p)) || name;

  const parsed = parseMediaName(name);
  const year = parsed.year || item.year || null;
  const tmdbType = MEDIA_TYPES[item.type] || null;
  const localOnly = !tmdbType; // games / music: only look for art already in the folder

  const key = localOnly
    ? sha1(`local|${item.driveId || ''}|${item.rel || p}`).slice(0, 20)
    : sha1(`${tmdbType}|${parsed.title.toLowerCase()}|${year || ''}`).slice(0, 20);

  return { key, title: parsed.title || item.title || name, year, altTitle: parsed.altTitle, yearIssue: parsed.yearIssue || null, tmdbType, localOnly };
}

// ---------- local poster detection ----------
/** Reads the folder once (cheap on spinning drives) and returns the best poster-like image, or null. */
async function findLocalPoster(dir, folderName) {
  let files;
  try {
    files = await fs.promises.readdir(dir);
  } catch {
    return null;
  }
  const byBase = new Map();
  for (const f of files) {
    const m = f.match(/^(.*)\.(?:jpe?g|png|webp)$/i);
    if (m && !byBase.has(m[1].toLowerCase())) byBase.set(m[1].toLowerCase(), f);
  }
  const fn = String(folderName || '').toLowerCase();
  const order = ['poster', `${fn}-poster`, 'folder', 'cover', 'movie', 'show', fn];
  for (const b of order) if (b && byBase.has(b)) return path.join(dir, byBase.get(b));
  return null;
}

// ---------- fuzzy matching (typos, missing words) ----------
/** 0..1 how alike two titles are (edit distance on the normalised text). */
function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const m = x.length, n = y.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

// ---------- TMDB result ranking ----------
const norm = (s) => {
  const str = String(s || '');
  const n = str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  return n || str.toLowerCase().trim();
};

/**
 * Pick the best search hit that has a poster.
 * strict = only accept an exact (normalised) title match; used for fallbacks that could misfire.
 */
function pickBest(results, { title, year }, strict = false, needPoster = true) {
  const want = norm(title);
  let best = null;
  (results || []).forEach((r, i) => {
    if (!r || (needPoster && !r.poster_path)) return;
    const names = [r.title, r.name, r.original_title, r.original_name].filter(Boolean).map(norm);
    const exact = names.includes(want);
    if (strict && !exact) return;
    const ry = parseInt(String(r.release_date || r.first_air_date || '').slice(0, 4), 10);
    let score = (exact ? 10 : 0) - i * 0.1;
    if (year && ry) {
      const d = Math.abs(ry - year);
      score += d === 0 ? 5 : d === 1 ? 2 : -3;
    }
    if (!best || score > best.score) best = { score, r };
  });
  return best ? best.r : null;
}

// ---------- tiny job queue ----------
/** At most `concurrency` jobs at once, with a small gap between jobs. */
function makeQueue(concurrency = 3, gapMs = 120) {
  let active = 0;
  const waiting = [];
  const pump = () => {
    while (active < concurrency && waiting.length) {
      const { fn, resolve, reject } = waiting.shift();
      active++;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          active--;
          setTimeout(pump, gapMs);
        });
    }
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      waiting.push({ fn, resolve, reject });
      pump();
    });
}

module.exports = { sha1, idFor, parseMediaName, queryFor, findLocalPoster, pickBest, norm, makeQueue, similarity };
