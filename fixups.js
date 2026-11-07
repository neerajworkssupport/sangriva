// Display-time clean-ups for libraries saved by older scans (no rescan needed). Pure functions; nothing touches a drive.
const path = require('path');

// folders that hold bonus material, never a movie of their own
const EXTRA_DIR = /^(?:extras?|extra features?|special features?|featurettes?|bonus.*|behind the scenes|deleted scenes?|making of.*|interviews?|samples?|trailers?)$/i;
// folders inside a game that are cracks, installers or disc images, never a game on their own
const GAME_SUPPORT_DIR = /^(?:skidrow|razor1911|codex|plaza|cpy|reloaded|fitgirl.*|empress|tenoke|hoodlum|flt|prophet|ali213|3dm|crack(?:s|ed)?|crackfix|fix(?:es)?|bin(?:32|64)?|redist(?:ributables?)?|_?commonredist|directx|dotnet|vcredist|support|installer|setup|install|cd[\s._-]*drive|cd[\s._-]*\d|dvd[\s._-]*\d|disc[\s._-]*\d|reader|rsrc)$/i;
const EPISODE_NAME = /s\d{1,2}[\s._-]?e\d{1,3}|(?<!\d)\d{1,2}x\d{2,3}(?!\d)/i;
const DISC_DIR = /^(?:cd|disc|disk|vol(?:ume)?)[\s._-]*\d{1,2}(?:\b.*)?$/i;

const segments = (rel) => String(rel || '').split(/[\\/]+/).filter(Boolean);

/** A movie record that is really bonus material: any folder above the file/folder is an Extras-type folder. */
function isExtraItem(i) {
  if (i.type !== 'movie') return false;
  const segs = segments(i.rel || i.path);
  return segs.slice(0, -1).some(s => EXTRA_DIR.test(s.trim()));
}

/** An episode (or old per-folder show) record that is really bonus material: it sits in an Extras-type folder, or the "show" is named like one. */
function isExtraEpisode(i) {
  if (i.type !== 'episode' && !(i.type === 'series' && !i.isGroup)) return false;
  if (EXTRA_DIR.test(String(i.showTitle || '').trim())) return true;
  const segs = segments(i.rel || i.path);
  return (i.type === 'episode' ? segs.slice(0, -1) : segs).some(s => EXTRA_DIR.test(s.trim()));
}

/** A game record that is really a crack/installer folder or a TV episode folder. */
function isJunkGame(i) {
  if (i.type !== 'game') return false;
  const base = segments(i.path || i.rel).pop() || '';
  return GAME_SUPPORT_DIR.test(base.trim()) || EPISODE_NAME.test(base);
}

const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

/**
 * Disc 1 / CD 2 / Vol 1 folders saved as separate albums are merged into the album folder above them.
 * libId(record) -> id; parseMusic(folderName, parentName) -> { artist, album, year }.
 */
function mergeDiscAlbums(raw, libId, parseMusic) {
  const groups = new Map();
  for (const i of raw) {
    if (i.type !== 'music' || !i.path) continue;
    if (!DISC_DIR.test(path.basename(i.path).trim())) continue;
    const parentRel = path.dirname(String(i.rel || ''));
    if (!parentRel || parentRel === '.') continue;
    const k = `${i.driveId || ''}|${path.dirname(i.path)}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(i);
  }
  if (!groups.size) return raw;
  const drop = new Set(), add = [];
  for (const [, discs] of groups) {
    discs.sort((a, b) => natural(path.basename(a.path), path.basename(b.path)));
    const first = discs[0];
    const parentPath = path.dirname(first.path), parentRel = path.dirname(first.rel);
    const existing = raw.find(r => r.type === 'music' && r.driveId === first.driveId && r.path === parentPath);
    const tracks = [];
    if (existing && Array.isArray(existing.tracks)) tracks.push(...existing.tracks);
    for (const d of discs) for (const t of (d.tracks || [])) tracks.push({ ...t, rel: path.join(path.basename(d.path), t.rel || t.name) });
    const sum = (f) => discs.reduce((n, d) => n + (d[f] || 0), 0) + (existing ? existing[f] || 0 : 0);
    const mu = parseMusic(path.basename(parentPath), path.basename(path.dirname(parentPath)));
    const rec = {
      ...(existing || {}), path: parentPath, rel: parentRel, driveId: first.driveId, type: 'music',
      title: (existing && existing.title) || mu.album || path.basename(parentPath), year: (existing && existing.year) || mu.year || first.year || null,
      artist: (existing && existing.artist) || mu.artist || first.artist || '', album: (existing && existing.album) || mu.album || path.basename(parentPath),
      size: sum('size'), fileCount: sum('fileCount'), tracks: tracks.length ? tracks : undefined,
      scannedAt: Math.max(...discs.map(d => d.scannedAt || 0)), addedAt: Math.min(...discs.map(d => d.addedAt || d.scannedAt || Infinity).filter(Number.isFinite), existing ? existing.addedAt || Infinity : Infinity)
    };
    if (!Number.isFinite(rec.addedAt)) rec.addedAt = rec.scannedAt;
    rec.id = libId(rec);
    discs.forEach(d => drop.add(d));
    if (existing) drop.add(existing);
    add.push(rec);
  }
  return raw.filter(i => !drop.has(i)).concat(add);
}

// ---------- loose video files: movie, or just a clip? ----------
const RELEASE_NOISE = /(?:^|[^a-z0-9])(?:480p|576p|720p|1080p|1080i|2160p|4k|uhd|blu-?ray|brrip|bdrip|bdremux|web-?rip|web-?dl|hdrip|dvdrip|dvdscr|hdtv|x264|x265|h\.?26[45]|hevc|xvid|divx)(?:[^a-z0-9]|$)/i;
const YEAR_IN_NAME = /(?:^|[^0-9a-z])(?:19|20)\d{2}(?:[^0-9a-z]|$)/i;
const NOT_A_MOVIE = /youtube|\bintro\b|\bdemos?\b|\bofficial\b|music video|lyrics?|\bclips?\b|trailer|sample|teaser|\bpromo\b|dialogues|whatsapp|\bstatus\b|^img[\s._-]?\d|^vid[\s._-]?\d|^mov[\s._-]?\d|^video[\s._-]?\d/i;
const NUMBERED_ONLY = /^\d{1,3}(?:[\s._-]+\d{1,2})?$/; // "01", "01 1": a bare number, not "21 Jump Street"

const stem = (name) => String(name || '').replace(/\.[^.]+$/, '');
/** A file name that clearly describes a movie: a year or release tags (1080p, BluRay, x264…) and nothing clip-like. */
const movieLikeName = (name) => { const b = stem(name); return !NOT_A_MOVIE.test(b) && (YEAR_IN_NAME.test(b) || RELEASE_NOISE.test(b)); };

/**
 * Which loose video files of ONE folder are movies. files: [{ name, ... }] (already big enough to be a movie).
 * Every file counts (as before) except ones that are clearly not films: clip-like names (YouTube, intro, demo, trailer,
 * music video...) and bare numbered clips ("01.mp4"), unless the name also carries a year or release tags.
 */
function pickLooseMovies(files) {
  const likely = files.filter(f => movieLikeName(f.name));
  // same as before (every loose video), minus things that are clearly not films: clips, intros, music videos, "01.mp4"
  return files.filter(f => likely.includes(f) || (!NOT_A_MOVIE.test(stem(f.name)) && !NUMBERED_ONLY.test(stem(f.name))));
}

/** Loose movie records from older scans that are really clips (music videos, "01.mp4", intros): hidden at display time. */
function looseNonMovies(raw) {
  const groups = new Map();
  for (const i of raw) {
    if (i.type !== 'movie' || !i.isFile || !i.path) continue;
    const k = `${i.driveId || ''}|${String(i.path).replace(/[\\/][^\\/]*$/, '')}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(i);
  }
  const hide = new Set();
  for (const [, list] of groups) {
    const files = list.map(i => ({ name: String(i.path).split(/[\\/]/).pop(), item: i }));
    const keep = new Set(pickLooseMovies(files));
    files.forEach(f => { if (!keep.has(f)) hide.add(f.item); });
  }
  return hide;
}

module.exports = { isExtraEpisode, pickLooseMovies, movieLikeName, looseNonMovies, EXTRA_DIR, GAME_SUPPORT_DIR, DISC_DIR, isExtraItem, isJunkGame, mergeDiscAlbums };

// ---------- games: only confirmed ones are shown ----------
const GAME_FILE_SIGNAL = /^(?:steam_api(?:64)?\.dll|unityplayer\.dll|unitycrashhandler\d*\.exe|unins\d*\.exe|uninstall\.exe|galaxy(?:64)?\.dll|eossdk.*\.dll|d3d(?:9|11|12)\.dll|xinput1_\d\.dll|physx.*\.dll|binkw(?:32|64)\.dll|fmod.*\.dll|openal32\.dll|.*\.(?:pak|bsa|vpk|wad|ba2|forge|rpf|xnb|uasset|unity3d|assets))$/i;
const GAME_DIR_SIGNAL = /^(?:binaries|engine|data|_commonredist|directx|vcredist|redist|saves?|mods?|assets|content|streamingassets|[a-z0-9_ ]+_data)$/i;
/** What a game folder looks like, from its top level only: used to tell real games from stray .exe folders. */
function gameSignals(files, dirNames) {
  const out = [];
  for (const f of files) if (GAME_FILE_SIGNAL.test(f)) out.push(f.toLowerCase());
  for (const d of dirNames) if (GAME_DIR_SIGNAL.test(d)) out.push(d.toLowerCase() + '/');
  return [...new Set(out)].slice(0, 12);
}
/**
 * 'confirmed' | 'candidate' | 'rejected'. flag = the user's own yes/no; steamOk = the store lookup found it.
 * Old scans have no signals, so they stay candidates until Steam or the user confirms.
 */
function gameState(item, flag, steamOk) {
  if (flag === 'no') return 'rejected';
  if (flag === 'yes') return 'confirmed';
  const size = item.size || 0;
  if (size && size < 50e6) return 'rejected'; // a tool, installer or leftover, not a game
  const strong = (item.signals || []).length >= 1;
  // a name that exists on Steam is not enough by itself: the folder must also look like an install (or be big)
  if (steamOk && (strong || size >= 300e6)) return 'confirmed';
  if ((item.signals || []).length >= 2 && size >= 300e6) return 'confirmed';
  return 'candidate';
}
module.exports.gameSignals = gameSignals;
module.exports.gameState = gameState;

// ---------- language (for Movies/TV grouping) ----------
const LANG_NAMES = { en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada', bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', ko: 'Korean', ja: 'Japanese', zh: 'Chinese', cn: 'Chinese', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian', tr: 'Turkish', th: 'Thai', id: 'Indonesian', ar: 'Arabic', fa: 'Persian', sv: 'Swedish', da: 'Danish', no: 'Norwegian', nl: 'Dutch', pl: 'Polish' };
const LANG_IN_NAME = /(?:^|[^a-z])(hindi|tamil|telugu|malayalam|kannada|bengali|marathi|punjabi|korean|japanese|chinese|french|spanish|german|italian|russian|english)(?:[^a-z]|$)/i;
/** The language to group by: a language word in the file name wins (that is what you will hear), then TMDB's original language. */
function languageOf(name, code) {
  const m = String(name || '').match(LANG_IN_NAME);
  if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  if (code && LANG_NAMES[code]) return LANG_NAMES[code];
  return code ? String(code).toUpperCase() : '';
}
module.exports.languageOf = languageOf;
