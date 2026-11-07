const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { parseMediaName, idFor, queryFor, findLocalPoster, pickBest, makeQueue, similarity, norm: normTitle } = require('./posters');
const { collectEpisodes, mergeOwned, ranges, airedBySeason, seriesStatus, parseMusicName } = require('./episodes');
const drives = require('./drives');
const { createMeta } = require('./meta');
const { displayName, parseGameName, qualityOf, mergeQuality } = require('./names');
const media = require('./media');
const { findDuplicates, compareDrives } = require('./dupes');
const { copyFolderVerified, copyFileVerified, verifyTrees, verifyFiles } = require('./copy');
const steam = require('./steam');
const { scanRoot } = require('./scanner');
const { showKey: showKeyOf, withSeries, promoteNumberedFiles, legacyShow } = require('./series');
const { isExtraItem, isJunkGame, mergeDiscAlbums, looseNonMovies, gameState, languageOf } = require('./fixups');
const { videoDuration } = require('./duration');
// old folder-based series records (one per folder) that belong to the show entry with this key
const legacyFoldersOf = (raw, key) => raw.filter(r => r.type === 'series' && !r.isGroup && (legacyShow(r) || {}).key === key);
const driveNameOf = (did) => { const x = drivesDb.find(y => y.id === did); return x ? (x.nickname || x.label || x.root) : ''; };

// Custom scheme so the renderer can show cached posters (must be declared before app is ready)
protocol.registerSchemesAsPrivileged([
  { scheme: 'poster', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

const brand = require('./brand');
const { resolveDataDir } = require('./paths');
let dataInfo = { dir: null, portable: false, why: 'default' };
try {
  // a --user-data-dir given on the command line (tests, power users) always wins
  if (typeof app.setPath === 'function' && !(app.commandLine && app.commandLine.hasSwitch && app.commandLine.hasSwitch('user-data-dir'))) {
    const r = resolveDataDir({ env: process.env, exeDir: path.dirname(process.execPath), appData: app.getPath('appData') });
    // a development run (electron .) keeps the folder earlier versions used
    app.setPath('userData', r.dir); dataInfo = r;
  }
} catch {}
const userData = app.getPath('userData');
dataInfo.dir = userData;
const dataFile = path.join(userData, 'library.json');
const settingsFile = path.join(userData, 'settings.json');
const drivesFile = path.join(userData, 'drives.json');
const metaDir = path.join(userData, 'meta');
const postersDir = path.join(userData, 'posters');
const posterIndexFile = path.join(postersDir, 'index.json');
const matchesFile = path.join(userData, 'matches.json');
const overridesFile = path.join(userData, 'overrides.json');
const languagesFile = path.join(userData, 'languages.json');
const notShowFile = path.join(userData, 'notshow.json');
const wishlistFile = path.join(userData, 'wishlist.json');
const episodeNumFile = path.join(userData, 'episodenumbers.json');
const durationsFile = path.join(userData, 'durations.json');
let episodeNums = {}, wishlist = [], durations = {};
try { episodeNums = JSON.parse(fs.readFileSync(episodeNumFile, 'utf8')) || {}; } catch {}
try { wishlist = JSON.parse(fs.readFileSync(wishlistFile, 'utf8')) || []; } catch {}
try { durations = JSON.parse(fs.readFileSync(durationsFile, 'utf8')) || {}; } catch {}
const saveJson = (f, o) => { try { fs.writeFileSync(f, JSON.stringify(o)); } catch {} };
const videoAssignFile = path.join(userData, 'videoassign.json');
let videoAssign = {};
try { videoAssign = JSON.parse(fs.readFileSync(videoAssignFile, 'utf8')) || {}; } catch {}
const saveVideoAssign = () => { try { fs.writeFileSync(videoAssignFile, JSON.stringify(videoAssign)); } catch {} };
const gameFlagsFile = path.join(userData, 'gameflags.json');
let gameFlags = {};
try { gameFlags = JSON.parse(fs.readFileSync(gameFlagsFile, 'utf8')) || {}; } catch {}
const saveGameFlags = () => { try { fs.writeFileSync(gameFlagsFile, JSON.stringify(gameFlags)); } catch {} };
fs.mkdirSync(postersDir, { recursive: true });

// ---------- small JSON helpers ----------
function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('Read error', file, e.message);
  }
  return fallback;
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// ---------- settings (TMDB key) ----------
const settings = readJson(settingsFile, {});
let keyInvalid = false; // set when TMDB answers 401, so we stop hammering it

function saveSettings() {
  try {
    writeJsonAtomic(settingsFile, settings);
  } catch (e) {
    console.error('Settings save error', e.message);
  }
}

// Key saved inside the app wins; environment variables are the fallback.
function getTmdbKey() {
  return String(settings.tmdbKey || process.env.TMDB_API_KEY || process.env.TMDB_KEY || '').trim();
}

// ---------- library ----------
// id = drive + path relative to the drive, so it survives the drive getting a different letter
const libId = (i) => (i.driveId && i.rel != null ? idFor(`${i.driveId}|${i.rel}`) : idFor(i.path));

/** A loose video the user assigned to a show becomes an episode of it (the file itself is never renamed). */
function applyVideoAssign(raw) {
  const ids = Object.keys(videoAssign);
  if (!ids.length) return raw;
  const { parseEpisodes } = require('./episodes');
  return raw.map(i => {
    const a = videoAssign[i.id];
    if (!a || i.type === 'episode' || !i.path) return i;
    const ep = parseEpisodes(path.basename(i.path)) || { season: null, eps: [] };
    return {
      id: i.id, path: i.path, rel: i.rel, driveId: i.driveId, isFile: true, type: 'episode',
      showTitle: a.title, showYear: a.year || null, showKey: showKeyOf(a.title), season: ep.season != null ? ep.season : 1, eps: ep.eps || [],
      size: i.size, fileCount: 1, quality: i.fileQuality || i.quality || null, scannedAt: i.scannedAt, addedAt: i.addedAt, assigned: true
    };
  });
}

/** A "movie" the user says belongs to a show: a file becomes an episode, a folder becomes a show (files are never touched). */
function applyAsShow(raw) {
  if (!Object.keys(asShow).length) return raw;
  const { parseEpisodes } = require('./episodes');
  return raw.map(i => {
    const a = asShow[i.id];
    if (!a || i.type !== 'movie' || !i.path) return i;
    if (i.isFile) {
      const ep = parseEpisodes(path.basename(i.path)) || { season: null, eps: [] };
      return {
        id: i.id, path: i.path, rel: i.rel, driveId: i.driveId, isFile: true, type: 'episode',
        showTitle: a.title, showYear: a.year || null, showKey: showKeyOf(a.title), season: ep.season != null ? ep.season : 1, eps: ep.eps || [],
        size: i.size, fileCount: 1, quality: i.fileQuality || i.quality || null, scannedAt: i.scannedAt, addedAt: i.addedAt, asShowId: i.id
      };
    }
    return { ...i, type: 'series', isGroup: false, showTitleOverride: a.title, showYearOverride: a.year || null, owned: {}, seasonStats: { 1: { files: i.fileCount || 1, parsed: 0 } }, asShowId: i.id };
  });
}

/** Shows the user marked "this is a movie": their episode records become loose movies (files are never touched). */
function applyNotShow(raw) {
  if (!notShow.size) return raw;
  const byKey = new Map();
  for (const i of raw) if (i.type === 'episode' && notShow.has(i.showKey)) (byKey.get(i.showKey) || byKey.set(i.showKey, []).get(i.showKey)).push(i);
  return raw.map(i => {
    if (i.type === 'series' && !i.isGroup) { const s = legacyShow(i); if (s && notShow.has(s.key)) return { ...i, type: 'movie', notShowKey: s.key, ...(notShow.get(s.key) === 'videos' ? { forceVideo: true } : {}) }; return i; }
    if (i.type !== 'episode' || !notShow.has(i.showKey) || !i.path) return i;
    const one = byKey.get(i.showKey).length === 1;
    const dn = one ? { title: i.showTitle, year: i.showYear } : displayName(path.basename(i.path).replace(/\.[^.]+$/, ''), i.showYear);
    return {
      id: i.id, path: i.path, rel: i.rel, driveId: i.driveId, isFile: !i.legacy, type: 'movie', title: dn.title, year: dn.year || null,
      size: i.size, fileCount: i.fileCount || 1, sig: `${path.basename(i.path).toLowerCase()}|${i.size || 0}`, fileQuality: i.quality || null,
      scannedAt: i.scannedAt, addedAt: i.addedAt, notShowKey: i.showKey, ...(notShow.get(i.showKey) === 'videos' ? { forceVideo: true } : {})
    };
  });
}

/** Episode numbers the user typed in for files the app could not read (the file is not renamed). */
function applyEpisodeNumbers(raw) {
  if (!Object.keys(episodeNums).length) return raw;
  return raw.map(i => {
    const a = episodeNums[i.id];
    return a && i.type === 'episode' ? { ...i, season: a.season, eps: a.eps, parsedCount: a.eps.length, manualNumber: true } : i;
  });
}

// the parsed file is kept until it changes on disk, so many quick calls do not each re-read and re-parse it
let libCache = null;
function readLibraryRaw() {
  let st = null;
  try { st = fs.statSync(dataFile); } catch {}
  if (!st) { libCache = null; return []; }
  if (libCache && libCache.mtimeMs === st.mtimeMs && libCache.size === st.size) return libCache.data.map(i => ({ ...i }));
  const data = readJson(dataFile, []);
  if (!Array.isArray(data)) return [];
  libCache = { mtimeMs: st.mtimeMs, size: st.size, data };
  return data.map(i => ({ ...i }));
}

function loadLibrary() {
  const raw = readLibraryRaw();
  // ids are always derived, which also heals libraries saved with the old colliding ids
  return Array.isArray(raw) ? applyEpisodeNumbers(applyNotShow(applyAsShow(applyVideoAssign(mergeDiscAlbums(promoteNumberedFiles(raw.map(i => ({ ...i, id: libId(i) }))), libId, parseMusicName))))) : [];
}

function saveLibrary(items) {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(items));
    libCache = null;
  } catch (e) {
    console.error('Save error', e);
  }
}

function isPathOnline(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

// ---------- poster index (what we know about every poster lookup) ----------
// key -> { status: 'ok' | 'not_found' | 'error', file, source: 'local' | 'tmdb', checkedAt, ... }
const posterIndex = readJson(posterIndexFile, {});
// matches the app is not sure about (waiting for you to confirm) and the ones you confirmed
const matches = readJson(matchesFile, {});     // key -> { state: 'tentative'|'unmatched'|'skipped', reason, guess, candidates }
const notShow = new Map((() => { const r = readJson(notShowFile, []); return Array.isArray(r) ? r.map(k => [k, 'movie']) : Object.entries(r || {}); })()); // show key -> 'movie' (it is a movie) | 'videos' (just remove it from TV Series)
const backup = require('./backup');
const safety = require('./safety');
const organize = require('./organize');
const share = require('./share');
const marksFile = path.join(userData, 'marks.json');
const marks = readJson(marksFile, {}); // item id -> { w: watched, f: favourite, q: to watch, r: own rating 1-5, t: tags }
const safeFile = path.join(userData, 'safe.json');
const safeKeys = readJson(safeFile, {}); // copy key -> true: "backed up elsewhere" (cloud, discs...)
const epwFile = path.join(userData, 'epwatched.json');
const epWatched = readJson(epwFile, {}); // show id -> { "season:number": 1 }
const historyFile = path.join(userData, 'scanhistory.json');
let scanHistory = readJson(historyFile, []);
const asShowFile = path.join(userData, 'asshow.json');
const asShow = readJson(asShowFile, {}); // movie id -> { title, year }: the user says this "movie" is really part of a show
const langOverrides = readJson(languagesFile, {}); // item id -> language name
const overrides = readJson(overridesFile, {}); // key -> { tmdbId, mediaType, title, year }
// matches saved before adult results were filtered out: drop their candidate lists (and the "no match" ones, which are searched again)
for (const k of Object.keys(matches)) {
  const m = matches[k];
  if (!m || m.cv === 2) continue;
  if (m.state === 'unmatched') delete matches[k]; else { m.candidates = []; m.cv = 2; }
}
let matchTimer = null;
function flushMatches() {
  clearTimeout(matchTimer);
  try { writeJsonAtomic(matchesFile, matches); writeJsonAtomic(overridesFile, overrides); } catch (e) { console.error('Match save error', e.message); }
}
function saveMatchesSoon() {
  clearTimeout(matchTimer);
  matchTimer = setTimeout(flushMatches, 300);
}
let indexTimer = null;

function flushIndex() {
  clearTimeout(indexTimer);
  indexTimer = null;
  try {
    writeJsonAtomic(posterIndexFile, posterIndex);
  } catch (e) {
    console.error('Poster index save error', e.message);
  }
}
function saveIndexSoon() {
  clearTimeout(indexTimer);
  indexTimer = setTimeout(flushIndex, 400);
}
function record(key, entry) {
  postersSeen.at = 0;
  posterIndex[key] = { ...entry, checkedAt: Date.now() };
  saveIndexSoon();
}

const NOT_FOUND_TTL = 14 * 24 * 3600 * 1000; // re-check TMDB misses after two weeks
const ERROR_TTL = 10 * 60 * 1000;            // network errors are retried after 10 minutes

function effectiveStatus(entry) {
  if (!entry) return 'unknown';
  const age = Date.now() - (entry.checkedAt || 0);
  if (entry.status === 'not_found' && age > NOT_FOUND_TTL) return 'unknown';
  if (entry.status === 'not_found' && entry.source === 'local' && entry.v !== 2) return 'unknown'; // v1.2 miss: embedded art / Steam weren't tried then
  if (entry.status === 'error' && age > ERROR_TTL) return 'unknown';
  return entry.status;
}

const posterUrl = (entry) => `poster://local/${entry.file}?v=${entry.checkedAt || 0}`;

// ---------- drives (shelf labels, online status, drive-letter changes) ----------
let drivesDb = readJson(drivesFile, []); // [{ id, label, root, nickname, shelf, total, free, lastSeen }]
let mounts = new Map();                  // id -> { root, label } for drives that are plugged in right now

function saveDrives() {
  try {
    writeJsonAtomic(drivesFile, drivesDb);
  } catch (e) {
    console.error('Drives save error', e.message);
  }
}

function refreshSpace(d) {
  const sp = drives.diskSpace(d.root);
  if (sp) { d.total = sp.total; d.free = sp.free; }
}

function upsertDrive(vol) {
  let d = drivesDb.find(x => x.id === vol.id);
  if (!d) {
    d = { id: vol.id, label: vol.label || '', root: vol.root, nickname: '', shelf: '', addedAt: Date.now() };
    drivesDb.push(d);
  }
  d.root = vol.root;
  if (vol.label) d.label = vol.label;
  d.lastSeen = Date.now();
  refreshSpace(d);
  safety.sampleHistory(d);
  mounts.set(vol.id, { root: vol.root, label: vol.label || '' });
  saveDrives();
  return d;
}

/**
 * Works out which drives are plugged in right now (system and external), registers new ones,
 * and fixes paths when a drive came back under another letter. Returns true when anything changed.
 */
async function reconcileDrives() {
  const found = await drives.detectMounts(drivesDb);
  const before = [...mounts.keys()].sort().join('|');
  let lib = null;
  let dirty = false;
  let changed = false; // something the screens show changed (drive added / moved / renamed); space and last-seen updates are saved quietly

  // drives we haven't seen before are added on their own (no scan needed to see them)
  for (const [id, m] of found) {
    if (drivesDb.some(d => d.id === id)) continue;
    const sp = drives.diskSpace(m.root);
    if (sp && sp.total < 2 * 1024 ** 3) continue; // tiny recovery / boot partitions
    drivesDb.push({ id, label: m.label || '', root: m.root, nickname: '', shelf: '', addedAt: Date.now(), kind: m.kind || 'drive' });
    dirty = true; changed = true;
  }

  const next = new Map();
  for (const d of drivesDb) {
    const m = found.get(d.id);
    if (!m) continue;
    next.set(d.id, m);
    if (m.root !== d.root) {
      lib = lib || loadLibrary();
      for (const i of lib) {
        if (i.driveId === d.id) i.path = i.rel != null ? path.join(m.root, i.rel) : drives.remapPath(i.path, d.root, m.root);
      }
      d.root = m.root;
      dirty = true; changed = true;
    }
    if (m.kind && d.kind !== m.kind) { d.kind = m.kind; dirty = true; changed = true; }
    if (m.label && d.label !== m.label) { d.label = m.label; dirty = true; changed = true; }
    if (!d.lastSeen || Date.now() - d.lastSeen > 60000 || !mounts.has(d.id)) { d.lastSeen = Date.now(); dirty = true; }
    const t0 = d.total, f0 = d.free;
    refreshSpace(d);
    if (d.total !== t0 || Math.abs((d.free || 0) - (f0 || 0)) > 50 * 1024 * 1024) dirty = true;
    if (safety.sampleHistory(d)) dirty = true;
  }
  mounts = next;
  if (lib) saveLibrary(lib);
  if (dirty) saveDrives();
  return changed || before !== [...next.keys()].sort().join('|');
}

let reconcileP = Promise.resolve(false); // handlers wait for the first drive check so Online/Offline is right at start-up

/** Adds online / poster / posterStatus to every library item (index lookups only, no network, no drive reads). */
/** 'complete' = every aired episode is in the library; 'missing' = some are not; null = cannot tell. */
function tvStatusOf(item, det) {
  try {
    const st = seriesStatus(item, det);
    if (!st.airedTotal) return null;
    if (st.missing.some(x => x.uncertain)) return st.missingCount ? 'missing' : null;
    return st.missingCount ? 'missing' : 'complete';
  } catch { return null; }
}
/** Which episode to watch next, and how many owned episodes are watched. Uses the owned map (season -> numbers). */
function epProgressOf(item) {
  const w = epWatched[item.id] || {};
  let owned = 0, seen = 0, next = null;
  for (const sn of Object.keys(item.owned).map(Number).sort((a, b) => (a || 99) - (b || 99))) {
    if (!sn) continue; // specials are not part of "next episode"
    for (const n of [...item.owned[sn]].sort((a, b) => a - b)) {
      owned++;
      if (w[`${sn}:${n}`]) seen++; else if (!next) next = { season: sn, number: n };
    }
  }
  return { epOwned: owned, epSeen: seen, nextEp: next };
}

// the poster folder listing, reused for a couple of seconds (it can hold thousands of files)
let postersSeen = { at: 0, set: new Set() };
function postersListing() {
  if (Date.now() - postersSeen.at < 2000) return postersSeen.set;
  let set;
  try { set = new Set(fs.readdirSync(postersDir)); } catch { set = new Set(); }
  postersSeen = { at: Date.now(), set };
  return set;
}

function decorate(rawLib, opts = {}) {
  // extras, crack folders and episode folders from older scans are not shown as movies/games
  const merged = withSeries(rawLib, idFor); // episode files -> one Series entry per show, across drives
  const clips = looseNonMovies(merged); // loose clips / music videos saved by older scans
  const lib = merged.filter(i => !isExtraItem(i) && !isJunkGame(i));
  const driveById = new Map(drivesDb.map(d => [d.id, d]));
  const cached = postersListing();
  return lib.map(item => {
    const qk = queryFor(item).key;
    const entry = posterIndex[qk];
    const has = !!entry && entry.status === 'ok' && cached.has(entry.file);
    const d = item.driveId ? driveById.get(item.driveId) : null;
    const known = meta.getId(qk) || (entry && entry.tmdbId ? { tmdbId: entry.tmdbId, mediaType: entry.mediaType } : null);
    const det = known ? meta.cachedDetails(known.mediaType, known.tmdbId) : null;

    // clean display title, worked out from the folder name (the folder itself is never renamed)
    const folderName = (item.isFile ? path.basename(item.path || '').replace(/\.[^.]+$/, '') : path.basename(item.path || '')) || item.title || '';
    let title = item.title, year = item.year, displayTitle, quality = null;
    if (item.type === 'movie' || item.type === 'series') {
      const dn = displayName(folderName, item.year);
      title = dn.title; year = dn.year; displayTitle = dn.display;
      quality = mergeQuality(qualityOf(folderName), item.fileQuality);
    } else if (item.type === 'game') {
      const g = parseGameName(folderName);
      title = g.title; year = g.year || item.year;
      displayTitle = title;
    } else {
      displayTitle = title;
    }
    const ov = overrides[qk];
    if (ov && (item.type === 'movie' || item.type === 'series')) { title = ov.title; year = ov.year; displayTitle = year ? `${title} (${year})` : title; }
    const mt = matches[qk];
    // a "video": loose or unconfirmed, so it waits in the Videos tab until it is assigned to a movie or show
    let video = null;
    if (item.forceVideo) video = 'removed';
    else if (!ov && (item.type === 'movie' || item.type === 'series')) {
      if (clips.has(item) || (item.type === 'movie' && item.isFile && item.size && item.size < 100 * 1024 * 1024)) video = 'clip';
      else if (mt && mt.state === 'unmatched') video = 'nomatch';
      else if (mt && mt.state === 'tentative') video = 'unsure';
      else if (entry && entry.status === 'not_found' && entry.source !== 'local' && effectiveStatus(entry) === 'not_found' && !known) video = 'nomatch';
    }
    return {
      ...item,
      video, matchKey: qk, corrected: !!ov,
      review: !ov && mt && (mt.state === 'tentative' || mt.state === 'unmatched') ? mt.state : null,
      title, year, displayTitle, folderName, quality,
      rating: det ? det.rating : null,
      genres: det ? det.genres.slice(0, 3) : (entry && entry.genres ? entry.genres.slice(0, 3) : []),
      gameDesc: item.type === 'game' && entry && entry.desc ? entry.desc : '',
      language: (item.type === 'movie' || item.type === 'series') ? (langOverrides[item.id] || languageOf(folderName, det && det.language)) : '',
      languageSet: !!langOverrides[item.id],
      watched: !!(marks[item.id] && marks[item.id].w),
      queued: !!(marks[item.id] && marks[item.id].q),
      ...(item.type === 'series' && item.owned ? epProgressOf(item) : {}),
      fav: !!(marks[item.id] && marks[item.id].f),
      versionKey: item.type === 'movie' ? (known && known.tmdbId ? `m${known.tmdbId}` : `n:${String(item.title || folderName || '').toLowerCase().replace(/\(\s*(?:19|20)\d{2}\s*\)/, '').replace(/[^a-z0-9]+/g, ' ').trim()}|${item.year || ''}`) : null,
      tvStatus: item.type === 'series' && det ? tvStatusOf(item, det) : null,
      gameFlag: item.type === 'game' ? (gameFlags[item.id] || null) : undefined,
      gameState: item.type === 'game' ? gameState(item, gameFlags[item.id], !!(entry && entry.source === 'steam' && entry.status === 'ok')) : undefined,
      runtime: det ? det.runtime : null,
      online: item.isGroup ? (item.drives || []).some(id => mounts.has(id)) : (item.driveId ? mounts.has(item.driveId) : isPathOnline(item.path)),
      driveName: item.isGroup ? (item.drives || []).map(id => { const x = driveById.get(id); return x ? (x.nickname || x.label || x.root) : ''; }).filter(Boolean).join(' + ') : (d ? (d.nickname || d.label || d.root) : ''),
      driveNames: item.isGroup ? Object.fromEntries((item.drives || []).map(id => { const x = driveById.get(id); return [id, x ? (x.nickname || x.label || x.root) : '']; })) : undefined,
      shelf: item.isGroup ? [...new Set((item.drives || []).map(id => (driveById.get(id) || {}).shelf).filter(Boolean))].join(' / ') : (d ? d.shelf || '' : ''),
      addedAt: item.addedAt || item.scannedAt || 0,
      poster: has ? posterUrl(entry) : null,
      posterSource: has ? entry.source : null,
      posterStatus: has ? 'ok' : effectiveStatus(entry)
    };
  }).filter(i => (i.type !== 'game' || i.gameState === 'confirmed' || (opts.all && (i.gameState === 'candidate' || (i.gameState === 'rejected' && i.gameFlag === 'no')))) && (!i.video || opts.all));
}

// ---------- TMDB ----------
const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/';
const POSTER_SIZE = 'w500';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const netQueue = makeQueue(5, 50); // polite but quick: 6 requests at a time
const meta = createMeta({
  dir: metaDir,
  tmdbGet,
  getKey: () => getTmdbKey(),
  queue: netQueue,
  downloadImage: (size, p, dest) => downloadImage(p, dest, size)
});

// Accepts the v3 API key or the v4 "Read Access Token" (starts with eyJ)
// Network circuit breaker: when TMDB cannot be reached (offline, VPN, ISP/DNS block), stop waiting 15 s per title and say so.
const netHealth = { fails: 0, downAt: 0, lastError: '' };
const netIsDown = () => netHealth.downAt && Date.now() - netHealth.downAt < 45000;
const netOk = () => { netHealth.fails = 0; netHealth.downAt = 0; };
const netFail = (e) => {
  netHealth.lastError = (e && ((e.cause && (e.cause.code || e.cause.message)) || e.message)) || 'network error';
  if (++netHealth.fails >= 6) netHealth.downAt = Date.now();
};
async function tmdbGet(pathname, params, key, attempt = 0) {
  if (netIsDown()) { const err = new Error('TMDB unreachable'); err.network = true; throw err; }
  const url = new URL(TMDB_API + pathname);
  for (const [k, v] of Object.entries(params || {})) if (v != null) url.searchParams.set(k, String(v));
  const headers = { accept: 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);

  let res;
  try { res = await net.fetch(url.toString(), { headers, signal: AbortSignal.timeout(10000) }); } catch (e) { netFail(e); e.network = true; throw e; }
  netOk();
  if (res.status === 429 && attempt < 4) {
    await sleep((Number(res.headers.get('retry-after')) || 2) * 1000);
    return tmdbGet(pathname, params, key, attempt + 1);
  }
  if (!res.ok) {
    const err = new Error(`TMDB ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const yearOfDate = (r) => parseInt(String(r.release_date || r.first_air_date || '').slice(0, 4), 10) || null;
/** TMDB sometimes returns adult titles even with include_adult=false: never match or offer them. */
const clean = (results) => (results || []).filter(r => r && r.adult !== true);
const candOf = (type, r) => ({ id: r.id, type, title: r.title || r.name || '', year: yearOfDate(r), poster: r.poster_path || null });

/**
 * Finds a title on TMDB. Returns { posterPath, id, matched, mediaType, tentative, reason } or null.
 * tentative = the app is not sure (unreadable year, several same-name titles, or only a similar name matched).
 * opts.out.candidates is filled with the closest titles so they can be offered for confirmation.
 */
async function searchTmdb(q, key, { needPoster = true, out = {} } = {}) {
  const types = [q.tmdbType, q.tmdbType === 'movie' ? 'tv' : 'movie']; // folder may be mis-typed
  const cands = new Map();
  const collect = (type, results) => clean(results).forEach(r => { if (r && r.id && !cands.has(`${type}:${r.id}`)) cands.set(`${type}:${r.id}`, candOf(type, r)); });
  const ranked = () => [...cands.values()]
    .map(c => ({ c, sc: similarity(q.title, c.title) + (q.year && c.year ? (c.year === q.year ? 0.15 : Math.abs(c.year - q.year) === 1 ? 0.05 : -0.1) : 0) + (c.type === q.tmdbType ? 0.02 : 0) }))
    .sort((x, y) => y.sc - x.sc);
  // only titles that really resemble the file name are offered (no random look-alikes)
  const finish = () => { out.candidates = ranked().filter(x => similarity(q.title, x.c.title) >= 0.3).slice(0, 6).map(x => x.c); };

  for (let t = 0; t < types.length; t++) {
    const type = types[t];
    const strict = t > 0; // the other media type is only accepted on an exact title match
    const yearKey = type === 'tv' ? 'first_air_date_year' : 'year';
    const tries = [];
    if (q.year) tries.push({ params: { query: q.title, [yearKey]: q.year }, want: { title: q.title, year: q.year } });
    // "Wonder Woman 1984": try the year as part of the title before falling back to a loose title search
    if (q.altTitle) tries.push({ params: { query: q.altTitle }, want: { title: q.altTitle, year: null } });
    tries.push({ params: { query: q.title }, want: { title: q.title, year: q.year } });

    for (const attempt of tries) {
      const json = await netQueue(() => tmdbGet(`/search/${type}`, { include_adult: 'false', ...attempt.params }, key));
      collect(type, json.results);
      let hit = pickBest(clean(json.results), attempt.want, strict, needPoster);
      if (hit) {
        const exacts = clean(json.results).filter(r => (r.title || r.name || '').length && normTitle(r.title || r.name) === normTitle(q.title));
        const exactYears = new Set(exacts.map(yearOfDate));
        let tentative = false, reason = null;
        if (q.yearIssue) { tentative = true; reason = `the year in the name (“${q.yearIssue}”) can't be read`; }
        else if (!q.year && exactYears.size > 1) {
          // several same-name titles: take the one that is clearly the famous one, ask only when they are close
          const byPop = exacts.filter(r => !needPoster || r.poster_path).sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
          const lead = byPop[0], second = byPop[1];
          if (lead && (lead.popularity || 0) >= 10 && (lead.popularity || 0) >= 3 * Math.max((second && second.popularity) || 0, 0.5)) hit = lead;
          else { tentative = true; reason = 'several titles share this name and the file has no year'; }
        }
        finish();
        return { posterPath: hit.poster_path || null, id: hit.id, matched: hit.title || hit.name, mediaType: type, year: yearOfDate(hit), tentative, reason };
      }
    }
  }

  // nothing matched exactly: drop words from the end ("... Raw and Undekha", "... Remastered Edition") and try again
  const words = q.title.split(/\s+/).filter(Boolean);
  for (let n = words.length - 1; n >= Math.max(2, words.length - 3); n--) {
    const text = words.slice(0, n).join(' ');
    for (const type of types) {
      try {
        const yk = type === 'tv' ? 'first_air_date_year' : 'year';
        const json = await netQueue(() => tmdbGet(`/search/${type}`, { include_adult: 'false', query: text, ...(q.year ? { [yk]: q.year } : {}) }, key));
        collect(type, json.results);
        const hit = pickBest(clean(json.results), { title: text, year: q.year }, true, needPoster);
        if (hit) {
          const yearOk = !!q.year && yearOfDate(hit) === q.year;
          finish();
          return { posterPath: hit.poster_path || null, id: hit.id, matched: hit.title || hit.name, mediaType: type, year: yearOfDate(hit), tentative: !yearOk || !!q.yearIssue, reason: yearOk && !q.yearIssue ? null : 'extra words at the end of the name were ignored' };
        }
      } catch (e) { if (e.status === 401) throw e; }
    }
  }

  // still nothing: look for similar names (typos, a missing or extra word)
  const variants = new Set();
  if (words.length >= 3) { variants.add(words.slice(0, -1).join(' ')); variants.add(words.slice(0, 2).join(' ')); }
  if (words.length === 2) variants.add(words[0]);
  if (q.title.length >= 6) variants.add(q.title.slice(0, Math.max(4, Math.ceil(q.title.length * 0.7))));
  for (const text of variants) {
    for (const type of types) {
      try {
        const json = await netQueue(() => tmdbGet(`/search/${type}`, { include_adult: 'false', query: text }, key));
        collect(type, json.results);
      } catch (e) { if (e.status === 401) throw e; }
    }
  }
  finish();
  const best = ranked().find(x => (!needPoster || x.c.poster) && x.sc >= 0.78);
  if (best) {
    const c = best.c;
    // a near-identical title with no close rival is accepted without asking
    const sims = ranked().map(x => similarity(q.title, x.c.title)).sort((a, b) => b - a);
    const clear = similarity(q.title, c.title) >= 0.9 && (sims[1] == null || sims[1] <= sims[0] - 0.15) && !q.yearIssue;
    return { posterPath: c.poster, id: c.id, matched: c.title, mediaType: c.type, year: c.year, tentative: !clear, reason: clear ? null : 'only a similar title was found' };
  }
  return null;
}

/** Remember what the app is unsure about, or forget it once a match is solid. */
function noteMatch(q, hit, out) {
  if (overrides[q.key]) return;
  const prev = matches[q.key];
  if (hit && !hit.tentative) { if (prev && prev.state !== 'skipped') { delete matches[q.key]; saveMatchesSoon(); } return; }
  if (prev && prev.state === 'skipped') return;
  matches[q.key] = hit
    ? { state: 'tentative', reason: hit.reason, guess: { id: hit.id, type: hit.mediaType, title: hit.matched, year: hit.year }, candidates: (out && out.candidates) || [], cv: 2 }
    : { state: 'unmatched', reason: 'nothing on TMDB matched this name', guess: null, candidates: (out && out.candidates) || [], cv: 2 };
  saveMatchesSoon();
}

async function downloadImage(posterPath, dest, size = POSTER_SIZE) {
  return downloadUrl(`${TMDB_IMG}${size}${posterPath}`, dest);
}

async function steamJson(url) {
  const res = await net.fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Steam ${res.status}`);
  return res.json();
}

async function downloadUrl(url, dest) {
  if (netIsDown()) { const err = new Error('Image host unreachable'); err.network = true; throw err; }
  let res;
  try { res = await net.fetch(url, { signal: AbortSignal.timeout(20000) }); } catch (e) { netFail(e); e.network = true; throw e; }
  netOk();
  if (!res.ok) throw new Error(`Image HTTP ${res.status}`);
  if (!(res.headers.get('content-type') || '').startsWith('image/')) throw new Error('Response was not an image');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) throw new Error('Image too small');
  const tmp = `${dest}.tmp`; // write + rename so a half-written file is never cached
  await fs.promises.writeFile(tmp, buf);
  await fs.promises.rename(tmp, dest);
}

// ---------- the poster pipeline ----------
// 1. already cached?  2. poster file inside the media folder?  3. remembered miss?  4. ask TMDB
const inflight = new Map(); // key -> promise, so identical titles are only looked up once

function ensurePoster(item, opts = {}) {
  const q = queryFor(item);
  if (inflight.has(q.key)) return inflight.get(q.key);
  const p = doEnsure(item, q, opts).finally(() => inflight.delete(q.key));
  inflight.set(q.key, p);
  return p;
}

async function doEnsure(item, q, { retryFailed = false } = {}) {
  const entry = posterIndex[q.key];

  // 1. cached poster
  if (entry && entry.status === 'ok' && fs.existsSync(path.join(postersDir, entry.file))) {
    return { status: 'ok', poster: posterUrl(entry) };
  }

  // 2. a poster already sitting in the media folder (needs the drive to be connected)
  const online = isPathOnline(item.path);
  if (online && !item.isFile) {
    const local = await findLocalPoster(item.path, path.basename(item.path));
    if (local) {
      try {
        const file = `${q.key}${path.extname(local).toLowerCase()}`;
        await fs.promises.copyFile(local, path.join(postersDir, file));
        if (entry && entry.file && entry.file !== file) fs.promises.unlink(path.join(postersDir, entry.file)).catch(() => {});
        record(q.key, { status: 'ok', source: 'local', file, from: local });
        return { status: 'ok', poster: posterUrl(posterIndex[q.key]) };
      } catch (e) {
        console.error('Local poster copy failed:', e.message);
      }
    }
  }

  // 3. remembered failures (not retried unless asked)
  const age = Date.now() - ((entry && entry.checkedAt) || 0);
  const oldLocalMiss = !!entry && entry.status === 'not_found' && entry.source === 'local' && entry.v !== 2;
  if (!retryFailed && !oldLocalMiss && entry && entry.status === 'not_found' && age < NOT_FOUND_TTL) return { status: 'not_found', poster: null };
  if (!retryFailed && entry && entry.status === 'error' && age < ERROR_TTL) return { status: 'error', poster: null };

  // music: cover art embedded in the tracks (needs the drive)
  if (q.localOnly && item.type === 'music') {
    if (!online) return { status: 'offline', poster: null }; // unknown, so don't record a miss
    const art = media.albumArt(item.path);
    if (art) {
      try {
        const file = `${q.key}.${art.ext}`;
        await fs.promises.writeFile(path.join(postersDir, file), art.data);
        record(q.key, { status: 'ok', source: 'embedded', file, v: 2 });
        return { status: 'ok', poster: posterUrl(posterIndex[q.key]) };
      } catch (e) {
        console.error('Embedded art save failed:', e.message);
      }
    }
    record(q.key, { status: 'not_found', source: 'local', v: 2 });
    return { status: 'not_found', poster: null };
  }

  // games: the public Steam store (no key). Doesn't need the drive, only the folder name.
  if (q.localOnly && item.type === 'game') {
    const g = parseGameName(path.basename(item.path || '') || item.title);
    try {
      const hit = await netQueue(() => steam.lookupGame(g.title, steamJson));
      if (!hit) {
        record(q.key, { status: 'not_found', source: 'steam', v: 2 });
        return { status: 'not_found', poster: null };
      }
      const file = `${q.key}.jpg`;
      let saved = false;
      for (const u of hit.coverUrls) {
        try { await netQueue(() => downloadUrl(u, path.join(postersDir, file))); saved = true; break; } catch {}
      }
      if (!saved) {
        record(q.key, { status: 'not_found', source: 'steam', v: 2 });
        return { status: 'not_found', poster: null };
      }
      record(q.key, { status: 'ok', source: 'steam', file, steamId: hit.appId, matched: hit.name, desc: hit.description, genres: hit.genres, year: hit.year, v: 2 });
      return { status: 'ok', poster: posterUrl(posterIndex[q.key]) };
    } catch (e) {
      console.error('Steam lookup error:', e.message);
      record(q.key, { status: 'error', message: e.message });
      return { status: 'error', poster: null };
    }
  }

  if (q.localOnly) return { status: 'not_found', poster: null };

  // 4. TMDB
  const key = getTmdbKey();
  if (!key) return { status: 'no_key', poster: null };
  if (keyInvalid) return { status: 'bad_key', poster: null };

  try {
    const ov = overrides[q.key];
    const out = {};
    let hit;
    if (ov) {
      const raw = await netQueue(() => tmdbGet(`/${ov.mediaType}/${ov.tmdbId}`, {}, key));
      hit = { posterPath: raw.poster_path || null, id: ov.tmdbId, matched: ov.title, mediaType: ov.mediaType };
    } else hit = await searchTmdb(q, key, { out });
    if (!ov) noteMatch(q, hit, out);
    if (!hit || !hit.posterPath) {
      record(q.key, { status: 'not_found', source: 'tmdb', query: { title: q.title, year: q.year } });
      return { status: 'not_found', poster: null };
    }
    const file = `${q.key}.jpg`;
    await netQueue(() => downloadImage(hit.posterPath, path.join(postersDir, file)));
    record(q.key, { status: 'ok', source: 'tmdb', file, tmdbId: hit.id, mediaType: hit.mediaType, matched: hit.matched });
    meta.setId(q.key, { tmdbId: hit.id, mediaType: hit.mediaType });
    return { status: 'ok', poster: posterUrl(posterIndex[q.key]) };
  } catch (e) {
    if (e.status === 401) {
      keyInvalid = true;
      return { status: 'bad_key', poster: null };
    }
    console.error('Poster fetch error:', e.message);
    record(q.key, { status: 'error', message: e.message });
    return { status: 'error', poster: null };
  }
}

// ---------- window / protocol ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: brand.name
  });
  win.loadFile('index.html');
  return win;
}

for (const [k, v] of Object.entries(overrides)) { try { meta.setId(k, { tmdbId: v.tmdbId, mediaType: v.mediaType }); } catch {} }

let mainWindow;
let drivePoll = null;
app.whenReady().then(() => {
  try { backup.autoBackup(userData, 'auto', app.getVersion()); } catch {}
  // poster://local/<file> -> file inside the posters cache folder
  protocol.handle('poster', (request) => {
    try {
      const url = new URL(request.url);
      const name = path.basename(decodeURIComponent(url.pathname));
      if (!/^[a-z0-9_.-]+$/i.test(name)) return new Response('Bad request', { status: 400 });
      const file = path.join(url.hostname === 'img' ? path.join(metaDir, 'img') : postersDir, name);
      if (!fs.existsSync(file)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response('Error', { status: 500 });
    }
  });

  reconcileP = reconcileDrives().catch(() => false);
  mainWindow = createWindow();

  // real-time drive detection: look every few seconds (plugging a drive in or out, a drive back under another letter)
  let checking = false;
  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      if (await reconcileDrives() && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('drives-changed');
    } catch {} finally { checking = false; }
  };
  drivePoll = setInterval(check, 3000);
  if (drivePoll.unref) drivePoll.unref();
  mainWindow.on('focus', check);
  if (settings.phone && settings.phone.on) startPhone().catch(() => {});
});

app.on('before-quit', () => { clearInterval(drivePoll); stopPhone(); flushIndex(); flushMatches(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- IPC: folders / scan ----------
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select a drive or media folder to scan'
  });
  return result.canceled ? null : result.filePaths[0];
});

// Season folders inside a show: "Season 1", "S01", "Series 2", "Specials"
const SEASON_DIR_RE = /^(?:(?:season|series)[\s._-]*\d{1,2}|s\d{1,2})(?:\b.*)?$|^specials?$/i;
const VIDEO_RE = /\.(mkv|mp4|avi|mov|wmv|m4v|ts|webm)$/i;

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

const countVideos = (entries) => entries.filter(e => e.isFile() && VIDEO_RE.test(e.name)).length;

/** Season folders of a show, with video counts and which episode numbers each holds (file names are only read). */
function seasonsOf(kids, full) {
  const results = [];
  const seasons = kids
    .filter(k => k.isDirectory() && SEASON_DIR_RE.test(k.name.trim()))
    .map(k => {
      const m = k.name.match(/\d+/);
      const number = m ? parseInt(m[0], 10) : 0;
      const p = path.join(full, k.name);
      const names = safeReaddir(p).filter(e => e.isFile()).map(e => e.name);
      const res = collectEpisodes(names, number);
      results.push({ season: number, res });
      return { name: k.name, number, path: p, episodes: res.files };
    })
    .sort((a, b) => a.number - b.number || a.name.localeCompare(b.name));
  return { seasons, results };
}

/** Show-level owned-episode map. Flat shows (no season folders) are read from their own files. */
function ownedFor(name, kids, seasonResults) {
  if (seasonResults.length) return mergeOwned(seasonResults);
  const guess = (name.match(/\b[sS](\d{1,2})\b/) || name.match(/season[ ._-]*(\d{1,2})/i) || [])[1];
  const season = guess ? parseInt(guess, 10) : 1;
  const names = kids.filter(e => e.isFile()).map(e => e.name);
  return mergeOwned([{ season, res: collectEpisodes(names, season) }]);
}

ipcMain.handle('scan', async (event, root) => {
  await reconcileP;
  await reconcileDrives(); // fixes paths first if the drive came back under another letter
  const vol = await drives.volumeOf(root);
  const drive = upsertDrive(vol);

  const skipped = [];
  const found = await scanRoot(root, {
    driveId: drive.id, driveRoot: drive.root, libId, skipped,
    tick: () => new Promise(r => setImmediate(r)), // keeps the window alive and the progress moving
    onProgress: (count, current) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan-progress', { count, current }); }
  });

  const rootRel = path.relative(drive.root, root);
  const under = (i) => i.driveId === drive.id && i.rel != null && (rootRel === '' || i.rel === rootRel || i.rel.startsWith(rootRel + path.sep));
  const seen = new Set(found.map(i => i.id));
  const foundPaths = new Set(found.map(i => i.path));
  const before = loadLibrary();
  const prevUnder = new Map(before.filter(i => under(i) && !(i.type === 'series' && !i.isGroup)).map(i => [i.id, i]));
  let existing = before.filter(i => {
    if (i.type === 'series' && !i.isGroup && under(i)) return false;             // old one-folder-per-show entries: replaced by episode files
    if (!i.driveId && foundPaths.has(i.path)) return false;                      // older entries not linked to a drive: replaced
    if (!skipped.length && under(i) && !seen.has(i.id)) return false;            // no longer on the drive (moved or deleted)
    return true;
  });
  const map = new Map(existing.map(i => [i.id, i]));
  for (const item of found) {
    const old = map.get(item.id);
    map.set(item.id, { ...old, ...item, addedAt: (old && (old.addedAt || old.scannedAt)) || item.scannedAt });
  }
  const merged = Array.from(map.values());
  saveLibrary(merged);
  drive.lastScan = Date.now(); saveDrives();
  const out = decorate(merged, { all: true });
  try { const a = analyze(); pruneWishlist(a.ownedMap, a.lib); } catch {}

  // what changed on this drive since the last scan (kept as a short history)
  const types = {};
  let isNew = 0, changed = 0;
  for (const i of found) {
    const o = prevUnder.get(i.id);
    if (!o) { isNew++; types[i.type] = (types[i.type] || 0) + 1; }
    else if ((o.size || 0) !== (i.size || 0) || (o.fileCount || 0) !== (i.fileCount || 0)) changed++;
  }
  const removed = skipped.length ? 0 : [...prevUnder.keys()].filter(id => !seen.has(id)).length;
  const report = { at: Date.now(), driveId: drive.id, drive: drive.nickname || drive.label || drive.root, root, new: isNew, removed, changed, total: found.length, unreadable: skipped.length, types, first: !prevUnder.size };
  scanHistory = [report, ...scanHistory].slice(0, 60);
  saveJson(historyFile, scanHistory);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan-report', report);
  try { backup.autoBackup(userData, 'auto', app.getVersion()); } catch {}
  return out;
});
ipcMain.handle('get-scan-history', () => scanHistory);

function detectType(name, fullPath, kids) {
  // a folder that contains Season folders is a series, whatever it is called
  if (kids && kids.some(k => k.isDirectory() && SEASON_DIR_RE.test(k.name.trim()))) return 'series';
  const files = (kids || safeReaddir(fullPath)).filter(e => e.isFile()).map(e => e.name);
  // an album folder: several audio files and no video ("Artist - Album (1979)" would otherwise look like a movie)
  if (files.filter(f => /\.(mp3|flac|wav|m4a|aac|ogg|opus|wma)$/i.test(f)).length >= 3 && !files.some(f => VIDEO_RE.test(f))) return 'music';
  const lower = name.toLowerCase();
  if (lower.includes('season') || /\bs\d{1,2}\b/i.test(name) || lower.includes('series') || lower.includes('episode')) {
    return 'series';
  }
  if (/\(\s*(19|20)\d{2}\s*\)/.test(name) || /\b(19|20)\d{2}\b/.test(name)) {
    return 'movie';
  }
  if (files.some(f => f.toLowerCase().endsWith('.exe') && !f.toLowerCase().includes('unins'))) return 'game';
  // a movie folder with no year in its name: it holds one big video file (not a sample)
  const vids = files.filter(f => VIDEO_RE.test(f) && !/sample|trailer/i.test(f));
  if (vids.length >= 1 && vids.length <= 3) {
    const big = vids.some(f => { try { return fs.statSync(path.join(fullPath, f)).size >= 300 * 1024 * 1024; } catch { return false; } });
    if (big) return 'movie';
  }
  return 'other';
}

function cleanTitle(name) {
  return name
    .replace(/\(\s*(19|20)\d{2}\s*\)/g, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractYear(name) {
  const paren = name.match(/\(\s*((19|20)\d{2})\s*\)/);
  if (paren) return parseInt(paren[1], 10);
  const plain = name.match(/\b((19|20)\d{2})\b/);
  if (plain) return parseInt(plain[1], 10);
  return null;
}

ipcMain.handle('open-path', (event, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') return { error: 'Invalid path' };
  try {
    let isFile = false;
    try { isFile = fs.statSync(targetPath).isFile(); } catch {}
    if (isFile && shell.showItemInFolder) shell.showItemInFolder(targetPath); // loose movie file: reveal it, don't launch it
    else shell.openPath(targetPath);
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('get-library', async () => { await reconcileP; return decorate(loadLibrary(), { all: true }); });
// "Not a TV show": a series entry that is really a movie moves to Movies (to: 'movie'), or is only taken out of TV Series (to: 'videos'
// - it then waits in the Videos tab). Files are never touched.
ipcMain.handle('set-not-show', async (_e, { id, key, on, to } = {}) => {
  await reconcileP;
  let k = key;
  if (!k) { const it = decorate(loadLibrary(), { all: true }).find(i => i.id === id); k = it && it.type === 'series' ? it.key : null; }
  if (!k) return { ok: false, error: 'unknown' };
  if (on === false) notShow.delete(k); else notShow.set(k, to === 'videos' ? 'videos' : 'movie');
  try { writeJsonAtomic(notShowFile, Object.fromEntries(notShow)); } catch (e) { return { ok: false, error: e.message }; }
  return { ok: true, items: decorate(loadLibrary(), { all: true }) };
});

// "Not a movie": a movie entry that is part of a show. title = the show's name (the user types it); on:false puts it back.
ipcMain.handle('set-as-show', async (_e, { id, ids, title, year, on } = {}) => {
  await reconcileP;
  const list = Array.isArray(ids) ? ids : id ? [id] : [];
  if (!list.length) return { ok: false, error: 'unknown' };
  const t = String(title || '').trim().slice(0, 120);
  if (on !== false && !t) return { ok: false, error: 'title' };
  for (const x of list) { if (on === false) delete asShow[x]; else asShow[x] = { title: t, year: year ? +year || null : null }; }
  try { writeJsonAtomic(asShowFile, asShow); } catch (e) { return { ok: false, error: e.message }; }
  return { ok: true, items: decorate(loadLibrary(), { all: true }) };
});

ipcMain.handle('set-mark', async (_e, { id, key, on } = {}) => {
  if (!id || !['w', 'f', 'q'].includes(key)) return { ok: false };
  const cur = { ...(marks[id] || {}) };
  if (on) cur[key] = true; else delete cur[key];
  if (Object.keys(cur).length) marks[id] = cur; else delete marks[id];
  try { writeJsonAtomic(marksFile, marks); } catch (e) { return { ok: false, error: e.message }; }
  return { ok: true, items: decorate(loadLibrary(), { all: true }) };
});

const saveMarks = () => writeJsonAtomic(marksFile, marks);
function patchMark(id, fn) {
  const cur = { ...(marks[id] || {}) };
  fn(cur);
  if (Object.keys(cur).length) marks[id] = cur; else delete marks[id];
  saveMarks();
}
// ---------- copy safety, drive health, broken files ----------
ipcMain.handle('get-copy-safety', async () => {
  await reconcileP;
  const lib = decorate(loadLibrary());
  const dv = drivesView();
  const r = safety.analyzeSafety(lib, dv.map(d => ({ id: d.id, name: d.name, online: d.online })), new Set(Object.keys(safeKeys)));
  const best = dv.filter(d => d.online && d.kind !== 'system' && d.free != null).sort((a, b) => b.free - a.free)[0];
  return { ...r, stale: dv.filter(d => d.health.stale || d.health.unscanned).map(d => ({ id: d.id, name: d.name, online: d.online, daysSeen: d.health.daysSeen, daysScan: d.health.daysScan })),
    suggestDrive: best ? { id: best.id, name: best.name, free: best.free } : null };
});
ipcMain.handle('set-safe', async (_e, { keys, on } = {}) => {
  if (!Array.isArray(keys)) return { ok: false };
  for (const k of keys.slice(0, 500)) { if (on) safeKeys[String(k)] = true; else delete safeKeys[String(k)]; }
  try { writeJsonAtomic(safeFile, safeKeys); } catch (e) { return { ok: false, error: e.message }; }
  return { ok: true };
});
let brokenCtl = null;
ipcMain.handle('check-broken', async (_e, { driveId } = {}) => {
  await reconcileP;
  if (!driveId || !mounts.has(driveId)) return { ok: false, error: 'Plug this drive in first.' };
  if (brokenCtl) return { ok: false, error: 'A check is already running.' };
  brokenCtl = {};
  try {
    const recs = loadLibrary().filter(i => i.driveId === driveId && i.path && i.type !== 'game');
    const res = await safety.scanBroken(recs.map(i => ({ id: i.id, path: i.path, title: i.title })), {
      ctl: brokenCtl, cb: (n, cur) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('broken-progress', { n, cur }); }
    });
    return { ok: true, ...res };
  } finally { brokenCtl = null; }
});
ipcMain.handle('cancel-broken', () => { if (brokenCtl) brokenCtl.cancel = true; return true; });

// ---------- episode progress ----------
ipcMain.handle('set-episode-watched', async (_e, { id, season, numbers, on } = {}) => {
  if (!id || !Number.isFinite(season) || !Array.isArray(numbers)) return { ok: false };
  const cur = { ...(epWatched[id] || {}) };
  for (const n of numbers.slice(0, 500)) { const k = `${season}:${Number(n)}`; if (on) cur[k] = 1; else delete cur[k]; }
  if (Object.keys(cur).length) epWatched[id] = cur; else delete epWatched[id];
  try { writeJsonAtomic(epwFile, epWatched); } catch (e) { return { ok: false, error: e.message }; }
  return { ok: true, items: decorate(loadLibrary(), { all: true }) };
});

// ---------- backup / restore ----------
const stampDate = () => new Date().toISOString().slice(0, 10);
ipcMain.handle('backup-export', async () => {
  const res = await dialog.showSaveDialog(mainWindow, { title: 'Save a backup of your catalog', defaultPath: `${brand.name}-backup-${stampDate()}.json`, filters: [{ name: `${brand.name} backup`, extensions: ['json'] }] });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    const b = backup.makeBundle(userData, app.getVersion());
    fs.writeFileSync(res.filePath, JSON.stringify(b));
    return { ok: true, path: res.filePath, items: b.counts.items };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('backup-list', () => backup.listBackups(userData));
ipcMain.handle('backup-restore', async (_e, { name } = {}) => {
  let file = null;
  if (name) { if (!/^(auto|before)-[0-9-]+\.json$/.test(name)) return { ok: false, error: 'bad name' }; file = path.join(userData, 'backups', name); }
  else {
    const res = await dialog.showOpenDialog(mainWindow, { title: 'Choose a backup file', properties: ['openFile'], filters: [{ name: 'HDD Organizer backup', extensions: ['json'] }] });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    file = res.filePaths[0];
  }
  let b;
  try { b = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { ok: false, error: 'That file could not be read.' }; }
  const v = backup.validateBundle(b);
  if (!v.ok) return { ok: false, error: v.error };
  try { backup.autoBackup(userData, 'before', app.getVersion()); backup.restoreBundle(userData, b); } catch (e) { return { ok: false, error: e.message }; }
  if (!process.env.HDD_NO_RELAUNCH) setTimeout(() => { app.relaunch(); app.exit(0); }, 600); // reload everything from the restored files
  return { ok: true, items: b.counts ? b.counts.items : null, relaunching: !process.env.HDD_NO_RELAUNCH };
});
ipcMain.handle('set-language', async (_e, { id, language } = {}) => {
  const v = String(language || '').trim().slice(0, 40);
  if (v) langOverrides[id] = v; else delete langOverrides[id];
  try { writeJsonAtomic(languagesFile, langOverrides); } catch (e) { return { ok: false, error: e.message }; }
  return { ok: true, items: decorate(loadLibrary(), { all: true }) };
});
ipcMain.handle('set-game-state', async (_e, { ids, state }) => {
  for (const id of ids || []) { if (state === 'clear') delete gameFlags[id]; else gameFlags[id] = state === 'yes' ? 'yes' : 'no'; }
  saveGameFlags();
  return decorate(loadLibrary(), { all: true });
});

// What "Clear Library" would remove, so the confirmation can say it plainly.
ipcMain.handle('get-clear-info', () => {
  let posters = 0;
  try { posters = fs.readdirSync(postersDir).filter(f => f !== 'index.json' && !f.endsWith('.tmp')).length; } catch {}
  return { items: withSeries(loadLibrary(), idFor).length, drives: drivesDb.length, posters };
});

// Removes the catalog only. Drive names, shelf labels and your files are never touched.
ipcMain.handle('clear-library', (event, opts = {}) => {
  try { backup.autoBackup(userData, 'before', app.getVersion()); } catch {} // so "Clear Library" can always be undone from Backup
  saveLibrary([]);
  if (opts && opts.deletePosters) {
    try {
      postersSeen.at = 0;
      for (const f of fs.readdirSync(postersDir)) if (f !== 'index.json') fs.rmSync(path.join(postersDir, f), { force: true });
    } catch (e) { console.error('Poster cleanup failed:', e.message); }
    for (const k of Object.keys(posterIndex)) delete posterIndex[k];
    flushIndex();
  }
  return [];
});

// ---------- IPC: posters ----------
// One item (called lazily as cards appear). Returns { status, poster }.
ipcMain.handle('fetch-poster', async (event, item) => {
  if (!item || typeof item.path !== 'string') return { status: 'error', poster: null };
  return ensurePoster(item);
});

// Every item that still has no poster. Streams 'poster-progress' events, returns a summary + what remains.
let bulkRunning = false;
ipcMain.handle('fetch-missing-posters', async (event, opts = {}) => {
  if (bulkRunning) return { busy: true };
  bulkRunning = true;
  try {
    const todo = decorate(loadLibrary(), { all: true }).filter(i => !i.poster && !i.single && i.video !== 'clip');
    const stats = { total: todo.length, done: 0, found: 0, notFound: 0, errors: 0, noKey: false, badKey: false };
    const remaining = [];
    let next = 0;

    const worker = async () => {
      while (next < todo.length) {
        if (netIsDown()) { stats.netDown = true; break; }
        const item = todo[next++];
        const r = await ensurePoster(item, { retryFailed: opts.retryFailed !== false });
        stats.done++;
        if (r.status === 'ok') stats.found++;
        else {
          remaining.push({ id: item.id, title: item.title, path: item.path, status: r.status });
          if (r.status === 'not_found') stats.notFound++;
          else if (r.status === 'error') stats.errors++;
          else if (r.status === 'no_key') stats.noKey = true;
          else if (r.status === 'bad_key') stats.badKey = true;
        }
        if (!event.sender.isDestroyed()) event.sender.send('poster-progress', { ...stats, id: item.id, poster: r.poster || null });
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
    flushIndex();
    return { ...stats, netDown: !!stats.netDown || netIsDown(), lastError: netHealth.lastError, remaining };
  } finally {
    bulkRunning = false;
  }
});

ipcMain.handle('get-settings', () => ({
  hasKey: !!getTmdbKey(),
  keySource: settings.tmdbKey ? 'app' : (process.env.TMDB_API_KEY || process.env.TMDB_KEY ? 'env' : null),
  keyInvalid
}));

// Verifies the key against TMDB before saving it.
ipcMain.handle('set-tmdb-key', async (event, rawKey) => {
  const key = String(rawKey || '').trim();
  if (!key) return { ok: false, error: 'Paste a key first.' };
  let unverified = false;
  try {
    await tmdbGet('/configuration', {}, key);
  } catch (e) {
    if (e.status === 401) return { ok: false, error: 'TMDB rejected this key (401). Check that you copied the whole key.' };
    unverified = true; // offline or TMDB hiccup: keep the key, verify on first use
  }
  settings.tmdbKey = key;
  saveSettings();
  keyInvalid = false;
  return { ok: true, unverified };
});

// A show that lives on several drives counts once per drive in drive-level views (counts, storage, shelf list)
function perDrive(lib) {
  const out = [];
  for (const i of lib) {
    if (i.isGroup && i.byDrive) {
      for (const [driveId, b] of Object.entries(i.byDrive)) out.push({ ...i, driveId, size: b.size, episodes: Object.values(b.owned).reduce((n, a) => n + a.length, 0), owned: b.owned });
    } else out.push(i);
  }
  return out;
}

// ---------- IPC: drives ----------
function gameShown(i) {
  const e = posterIndex[queryFor(i).key];
  return gameState(i, gameFlags[i.id], !!(e && e.source === 'steam' && e.status === 'ok')) === 'confirmed';
}
function drivesView() {
  const lib = perDrive(decorate(loadLibrary()));
  return drivesDb.map(d => {
    const mine = lib.filter(i => i.driveId === d.id);
    const counts = { movie: 0, series: 0, music: 0, game: 0 };
    mine.forEach(i => { if ((i.type === 'game' && !gameShown(i)) || i.single) return; if (counts[i.type] != null) counts[i.type]++; });
    return {
      id: d.id, label: d.label || '', nickname: d.nickname || '', shelf: d.shelf || '', kind: (mounts.get(d.id) || {}).kind || d.kind || 'drive',
      name: d.nickname || d.label || d.root, root: (mounts.get(d.id) || {}).root || d.root,
      online: mounts.has(d.id), total: d.total || null, free: d.free || null,
      used: d.total && d.free != null ? d.total - d.free : null, lastSeen: d.lastSeen || null, lastScan: d.lastScan || null,
      health: safety.staleInfo(d, Date.now(), mounts.has(d.id)), forecast: safety.forecast(d),
      items: mine.length, counts
    };
  });
}

ipcMain.handle('get-drives', async () => {
  await reconcileP;
  return { drives: drivesView(), unassigned: loadLibrary().filter(i => !i.driveId).length };
});

ipcMain.handle('refresh-drives', async () => {
  await reconcileDrives();
  return { drives: drivesView(), unassigned: loadLibrary().filter(i => !i.driveId).length };
});

ipcMain.handle('update-drive', (event, { id, nickname, shelf }) => {
  const d = drivesDb.find(x => x.id === id);
  if (!d) return { ok: false };
  if (typeof nickname === 'string') d.nickname = nickname.trim().slice(0, 60);
  if (typeof shelf === 'string') d.shelf = shelf.trim().slice(0, 80);
  saveDrives();
  return { ok: true };
});

// ---------- metadata helpers ----------
const today = () => new Date().toISOString().slice(0, 10);

/** TMDB id for a library item: cached lookup first, then the poster cache, then (optionally) a search. */
function idInfoFor(item) {
  const q = queryFor(item);
  if (!q.tmdbType) return null;
  const known = meta.getId(q.key);
  if (known) return known;
  const pe = posterIndex[q.key];
  if (pe && pe.tmdbId) {
    const info = { tmdbId: pe.tmdbId, mediaType: pe.mediaType || q.tmdbType };
    meta.setId(q.key, info);
    return info;
  }
  return null;
}

async function resolveTmdb(item, { search = true } = {}) {
  const have = idInfoFor(item);
  if (have || !search) return have;
  const key = getTmdbKey();
  if (!key || keyInvalid) return null;
  const q = queryFor(item);
  const out = {};
  const hit = await searchTmdb(q, key, { needPoster: false, out });
  noteMatch(q, hit, out);
  if (!hit) return null;
  const info = { tmdbId: hit.id, mediaType: hit.mediaType };
  meta.setId(q.key, info);
  return info;
}

function franchiseDefs() {
  const user = readJson(path.join(userData, 'franchises.json'), null);
  return Array.isArray(user) ? user : readJson(path.join(__dirname, 'franchises.json'), []);
}

/** Everything derived from the library + cached metadata. No network. */
function analyze() {
  const lib = decorate(loadLibrary());
  const ownedMap = new Map(); // "movie:603" / "tv:1396" -> library item
  const seriesRows = [];
  let eligible = 0;
  for (const item of lib) {
    const info = idInfoFor(item);
    if (info) ownedMap.set(`${info.mediaType}:${info.tmdbId}`, item);
    if (item.type === 'movie' || item.type === 'series') eligible++;
    if (item.type === 'series') {
      const d = info && info.mediaType === 'tv' ? meta.cachedDetails('tv', info.tmdbId) : null;
      if (d) seriesRows.push({ item, d, st: seriesStatus(item, d) });
    }
  }
  return { lib, ownedMap, seriesRows, eligible };
}

/** A show whose files we found but could not read a single episode number from can't be checked: never "all missing". */
const cantCheck = (item) => (item.fileCount || item.episodes || 0) > 0 && !Object.values(item.owned || {}).some(a => a && a.length);

function missingEpisodes(seriesRows) {
  const rows = seriesRows
    .filter(r => r.st.missingCount > 0 || r.st.missing.some(m => m.uncertain))
    .map(({ item, st }) => ({
      id: item.id, title: item.title, year: item.year, poster: item.poster, online: item.online,
      driveName: item.driveName, shelf: item.shelf, unreadable: cantCheck(item),
      missingCount: st.missingCount, completion: st.completion,
      seasons: st.missing.map(m => ({ season: m.season, text: m.uncertain ? 'episode numbers unreadable' : ranges(m.numbers), count: m.numbers.length, uncertain: m.uncertain }))
    }));
  // closest to complete first: those are the ones where a few downloads finish the job
  const closest = (a, b) => (b.completion == null ? -1 : b.completion) - (a.completion == null ? -1 : a.completion) || a.missingCount - b.missingCount || a.title.localeCompare(b.title);
  const checkable = rows.filter(r => !r.unreadable).sort(closest);
  const unreadable = rows.filter(r => r.unreadable).sort((a, b) => a.title.localeCompare(b.title)).map(r => ({ ...r, missingCount: 0, completion: null }));
  return { checkable, unreadable };
}

/** Saves the posters of titles you don't own (once, so they also show offline) and fills in `poster`. */
async function withPartPosters(franchises) {
  const raws = new Set();
  for (const f of franchises) for (const p of f.parts) if (!p.owned && p.posterRaw) raws.add(p.posterRaw);
  await Promise.race([Promise.all([...raws].slice(0, 80).map(r => meta.ensureImage(r, 'w185'))), sleep(6000)]);
  const url = (r) => (r ? meta.imageUrl(r, 'w185') : null);
  for (const f of franchises) {
    for (const p of f.parts) p.poster = p.owned ? null : url(p.posterRaw);
    if (Array.isArray(f.missing)) f.missing = f.missing.map(p => ({ ...p, posterRaw: p.poster || null, poster: url(p.poster) }));
  }
  return franchises;
}

function computeFranchises(ownedMap) {
  const day = today();
  const keyOf = (p) => `${p.type === 'tv' ? 'tv' : 'movie'}:${p.id}`;
  const isOwned = (p) => ownedMap.has(keyOf(p));
  const out = [];
  const shown = []; // part-id sets of universes already listed

  const build = (kind, name, allParts, extra = {}) => {
    // unreleased titles are left out entirely: only what is out (or what you already own) is listed
    const parts = allParts.filter(p => isOwned(p) || (p.release_date && p.release_date <= day));
    // a single title is not a collection: it needs at least two (movies and/or series) under the franchise
    if (parts.length < 2) return null;
    const owned = parts.filter(isOwned);
    if (!owned.length) return null;
    const notOwned = parts.filter(p => !isOwned(p));
    const byDate = (a, b) => (a.release_date || '9').localeCompare(b.release_date || '9');
    const released = notOwned.filter(p => p.release_date && p.release_date <= day).sort(byDate);
    const upcoming = notOwned.filter(p => !p.release_date || p.release_date > day).sort(byDate);
    const all = parts.slice().sort(byDate).map(p => {
      const it = ownedMap.get(keyOf(p));
      return { id: p.id, type: p.type === 'tv' ? 'tv' : 'movie', title: p.title, year: p.year, release_date: p.release_date, owned: !!it, itemId: it ? it.id : null, upcoming: !p.release_date || p.release_date > day, posterRaw: p.poster || null };
    });
    return { kind, name, total: parts.length, owned: owned.length, missing: released, upcoming, parts: all, ...extra };
  };

  // inside a big universe: group the parts by their TMDB collection (Iron Man, Thor, Star Wars saga…), then TV, then the rest
  const partCollection = new Map(); // movie id -> collection name
  const collSeen = new Set();
  for (const d of meta.allDetails()) {
    if (d.type !== 'movie' || !d.collection || collSeen.has(d.collection.id)) continue;
    collSeen.add(d.collection.id);
    const c = meta.cachedCollection(d.collection.id);
    if (c) for (const p of c.parts) partCollection.set(p.id, c.name);
  }
  const groupParts = (f) => {
    const g = new Map();
    for (const p of f.parts) {
      const name = p.type === 'tv' ? 'TV series' : (partCollection.get(p.id) || 'Standalone films');
      if (!g.has(name)) g.set(name, []);
      g.get(name).push(p);
    }
    if (g.size < 2) return null;
    const rank = (n) => (n === 'TV series' ? 2 : n === 'Standalone films' ? 1 : 0);
    return [...g.entries()].map(([name, ps]) => ({ name, ids: ps.map(p => `${p.type}:${p.id}`) }))
      .sort((a, b) => rank(a.name) - rank(b.name) || (g.get(a.name)[0].release_date || '9').localeCompare(g.get(b.name)[0].release_date || '9'));
  };

  for (const def of franchiseDefs()) {
    const u = meta.cachedUniverse(def);
    if (!u || !u.parts.length) continue;
    const f = build('universe', def.name, u.parts);
    if (f) { f.groups = groupParts(f); out.push(f); shown.push(new Set(u.parts.map(p => p.id))); }
  }

  const seen = new Set();
  for (const d of meta.allDetails()) {
    if (d.type !== 'movie' || !d.collection || seen.has(d.collection.id) || !ownedMap.has(`movie:${d.id}`)) continue;
    seen.add(d.collection.id);
    const c = meta.cachedCollection(d.collection.id);
    if (!c || !c.parts.length) continue;
    if (shown.some(set => c.parts.every(p => set.has(p.id)))) continue; // already covered by a universe above
    const f = build('collection', c.name, c.parts);
    if (f) out.push(f);
  }
  return out.sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name));
}

const slimItem = (i) => ({ id: i.id, title: i.title, year: i.year, type: i.type, poster: i.poster, online: i.online, artist: i.artist, seasons: i.seasons, episodes: i.episodes, driveName: i.driveName, shelf: i.shelf });

// ---------- IPC: overview / missing ----------
ipcMain.handle('get-overview', async () => {
  await reconcileP;
  const { lib, ownedMap, seriesRows, eligible } = analyze();
  const week = Date.now() - 7 * 24 * 3600 * 1000;
  const counts = { movie: 0, series: 0, music: 0, game: 0 };
  const fresh = { movie: 0, series: 0, music: 0, game: 0 };
  lib.forEach(i => { if (i.single) return; if (counts[i.type] != null) { counts[i.type]++; if (i.addedAt > week) fresh[i.type]++; } });

  const { checkable: miss, unreadable: unread } = missingEpisodes(seriesRows);
  const completions = seriesRows.filter(r => !cantCheck(r.item)).map(r => r.st.completion).filter(c => c != null);
  const franchises = computeFranchises(ownedMap);
  const dv = drivesView();
  const used = dv.reduce((n, d) => n + (d.used || 0), 0);
  const withDetails = lib.filter(i => { const x = idInfoFor(i); return x && meta.cachedDetails(x.mediaType, x.tmdbId); }).length;

  return {
    counts, fresh, total: lib.length,
    episodes: {
      missing: miss.reduce((n, m) => n + m.missingCount, 0), shows: miss.length, tracked: seriesRows.length, cantCheck: unread.length,
      avgCompletion: completions.length ? Math.round(completions.reduce((a, b) => a + b, 0) / completions.length) : null
    },
    franchise: { missing: franchises.reduce((n, f) => n + f.missing.length, 0), groups: franchises.filter(f => f.missing.length).length },
    drives: { online: dv.filter(d => d.online).length, total: dv.length, used, capacity: dv.reduce((n, d) => n + (d.total || 0), 0) },
    posters: { have: lib.filter(i => i.poster).length, total: lib.length },
    lastScan: lib.reduce((m, i) => Math.max(m, i.scannedAt || 0), 0) || null,
    synced: { withDetails, eligible },
    recent: [...lib].sort((a, b) => b.addedAt - a.addedAt || a.title.localeCompare(b.title)).slice(0, 10).map(slimItem),
    missingTop: miss.slice(0, 4),
    franchiseTop: franchises.filter(f => f.missing.length).slice(0, 3).map(f => ({ name: f.name, missing: f.missing.length, owned: f.owned, total: f.total }))
  };
});

ipcMain.handle('get-missing', async () => {
  await reconcileP;
  const { ownedMap, seriesRows, eligible, lib } = analyze();
  const withDetails = lib.filter(i => { const x = idInfoFor(i); return x && meta.cachedDetails(x.mediaType, x.tmdbId); }).length;
  return {
    ...(() => { const m = missingEpisodes(seriesRows); return { episodes: m.checkable, cantCheck: m.unreadable }; })(),
    franchises: await withPartPosters(computeFranchises(ownedMap)),
    synced: { withDetails, eligible, hasKey: !!getTmdbKey() }
  };
});

// ---------- IPC: detail pages ----------
function seasonsView(item, d) {
  const aired = d ? airedBySeason(d) : {};
  const st = d ? seriesStatus(item, d) : null;
  const rows = new Map();
  for (const s of (d && d.seasons) || []) {
    rows.set(s.season_number, { season: s.season_number, name: s.name || (s.season_number ? `Season ${s.season_number}` : 'Specials'), total: s.episode_count, aired: s.season_number ? aired[s.season_number] : s.episode_count });
  }
  const ensure = (n, name) => { if (!rows.has(n)) rows.set(n, { season: n, name: name || (n ? `Season ${n}` : 'Specials'), total: null, aired: null }); };
  Object.keys(item.owned || {}).forEach(k => ensure(+k));
  (item.seasons || []).forEach(f => ensure(f.number, f.name));
  return [...rows.values()].sort((a, b) => a.season - b.season).map(r => {
    const folder = (item.seasons || []).find(f => f.number === r.season);
    const ownedCount = (item.owned && item.owned[r.season] ? item.owned[r.season].length : 0) || (folder ? folder.episodes : 0);
    const m = st && st.missing.find(x => x.season === r.season);
    return { ...r, owned: ownedCount, missingCount: m && !m.uncertain ? m.numbers.length : 0, uncertain: !!(m && m.uncertain), special: r.season === 0, hasFolder: !!folder };
  });
}

ipcMain.handle('get-detail', async (event, id) => {
  await reconcileP;
  const lib = decorate(loadLibrary(), { all: true });
  const item = lib.find(i => i.id === id);
  if (!item) return { status: 'gone' };
  const key = getTmdbKey();
  const canFetch = !!key && !keyInvalid;
  let status = 'ok', info = null, d = null;
  try {
    info = await resolveTmdb(item, { search: canFetch });
    if (info) d = meta.cachedDetails(info.mediaType, info.tmdbId);
    if (info && !d && canFetch) d = await meta.getDetails(info.mediaType, info.tmdbId);
    if (!d) status = !key ? 'no_key' : keyInvalid ? 'bad_key' : info ? 'error' : 'not_found';
  } catch (e) {
    if (e.status === 401) { keyInvalid = true; status = 'bad_key'; }
    else status = d ? 'ok' : 'offline';
  }

  let cast = [];
  if (d) {
    const photos = Promise.all(d.cast.map(c => meta.ensureImage(c.photo)));
    await Promise.race([photos, sleep(6000)]);
    cast = d.cast.map(c => ({ ...c, photoUrl: meta.imageUrl(c.photo) }));
  }

  const out = { status, item, details: d ? { ...d, cast } : null };
  if (item.type === 'series') {
    out.seasons = seasonsView(item, d);
    out.series = d ? seriesStatus(item, d) : null;
    if (item.isGroup) {
      const nameOf = driveNameOf;
      const byDir = new Map();
      const rawAll = loadLibrary();
      for (const li of legacyFoldersOf(rawAll, item.key)) {
        const k = `${li.driveId}|${li.path}`;
        byDir.set(k, { driveName: nameOf(li.driveId), dir: li.path, online: mounts.has(li.driveId), count: Object.values(li.owned || {}).reduce((n, a) => n + a.length, 0) || li.fileCount || 0, seasons: new Set(Object.keys(li.owned || {}).map(Number)), legacy: true });
      }
      for (const r of rawAll) {
        if (r.type !== 'episode' || r.showKey !== item.key) continue;
        const dir = path.dirname(r.path), k = `${r.driveId}|${dir}`;
        const e = byDir.get(k) || { driveName: nameOf(r.driveId), dir, online: mounts.has(r.driveId), count: 0, seasons: new Set() };
        e.count += (r.eps || []).length; e.seasons.add(r.season);
        byDir.set(k, e);
      }
      out.locations = [...byDir.values()].map(e => ({ ...e, seasons: [...e.seasons].sort((a, b) => a - b) })).sort((a, b) => a.driveName.localeCompare(b.driveName) || a.dir.localeCompare(b.dir));
    }
  }
  if (d && d.type === 'movie' && d.collection) {
    const c = meta.cachedCollection(d.collection.id);
    if (c) {
      const { ownedMap } = analyze();
      const released = c.parts.filter(p => ownedMap.has(`movie:${p.id}`) || (p.release_date && p.release_date <= today()));
      out.collection = { name: c.name, total: released.length, owned: released.filter(p => ownedMap.has(`movie:${p.id}`)).length };
      // "In this series": every part in release order, with the next one marked
      const day = today();
      const parts = c.parts.filter(p => ownedMap.has(`movie:${p.id}`) || (p.release_date && p.release_date <= day)).map(p => {
        const it = ownedMap.get(`movie:${p.id}`);
        return { id: p.id, title: p.title, year: p.year, owned: !!it, itemId: it ? it.id : null, current: p.id === d.id, upcoming: !p.release_date || p.release_date > day, posterRaw: p.poster || null };
      });
      await Promise.race([Promise.all(parts.filter(p => !p.owned && p.posterRaw).map(p => meta.ensureImage(p.posterRaw, 'w185'))), sleep(5000)]);
      parts.forEach(p => { p.poster = p.owned ? null : meta.imageUrl(p.posterRaw, 'w185'); });
      const at = parts.findIndex(p => p.current);
      if (parts.length > 1) out.franchise = { name: c.name, parts, nextId: at >= 0 && at + 1 < parts.length ? parts[at + 1].id : null };
    } else out.collection = { name: d.collection.name, total: null, owned: null };
  }
  return out;
});

ipcMain.handle('get-season', async (event, { id, season }) => {
  const item = decorate(loadLibrary(), { all: true }).find(i => i.id === id);
  if (!item) return { status: 'gone', episodes: [] };
  const info = idInfoFor(item);
  const key = getTmdbKey();
  let s = info && info.mediaType === 'tv' ? meta.cachedSeason(info.tmdbId, season) : null;
  if (info && info.mediaType === 'tv' && !s && key && !keyInvalid) {
    try { s = await meta.getSeason(info.tmdbId, season); } catch (e) { if (e.status === 401) keyInvalid = true; }
  }
  const have = new Set((item.owned && item.owned[season]) || []);
  const st = item.seasonStats && item.seasonStats[season];
  const unreadable = !!(st && st.files > 0 && st.parsed === 0);
  const day = today();
  let episodes;
  if (s && s.episodes.length) {
    episodes = s.episodes.map(e => {
      const aired = !!e.air_date && e.air_date <= day;
      const state = have.has(e.number) ? 'available' : unreadable ? 'unknown' : season === 0 ? 'optional' : aired ? 'missing' : 'upcoming';
      return { number: e.number, name: e.name, air_date: e.air_date, runtime: e.runtime, overview: e.overview, state };
    });
    const known = new Set(s.episodes.map(e => e.number));
    [...have].filter(n => !known.has(n)).forEach(n => episodes.push({ number: n, name: '', state: 'available' }));
    episodes.sort((a, b) => a.number - b.number);
  } else {
    // no episode names saved: still show every episode number, using the show's season totals
    const d = info && info.mediaType === 'tv' ? meta.cachedDetails('tv', info.tmdbId) : null;
    const sd = d && d.seasons.find(x => x.season_number === season);
    const aired = d && season ? (airedBySeason(d)[season] || 0) : 0;
    const total = sd ? sd.episode_count : 0;
    const nums = new Set([...have, ...Array.from({ length: total }, (_, i) => i + 1)]);
    episodes = [...nums].sort((a, b) => a - b).map(n => ({
      number: n, name: '',
      state: have.has(n) ? 'available' : unreadable ? 'unknown' : season === 0 ? 'optional' : n <= aired ? 'missing' : 'upcoming'
    }));
  }
  // every place an episode lives (a folder on each drive that holds it): shown in front of the name, each with "Open folder"
  const where = new Map(); // number -> [{ file, dir, name, driveName, online }]
  const addWhere = (n, w) => {
    const list = where.get(n) || where.set(n, []).get(n);
    if (!list.some(x => x.dir === w.dir && x.driveName === w.driveName)) list.push(w);
  };
  if (item.isGroup) {
    const raw = loadLibrary();
    for (const r of raw) {
      if (r.type !== 'episode' || r.showKey !== item.key || r.season !== season) continue;
      const on = mounts.has(r.driveId);
      for (const n of (r.eps || [])) addWhere(n, { file: r.path, dir: path.dirname(r.path), name: path.basename(r.path), driveName: driveNameOf(r.driveId), online: on });
    }
    for (const li of legacyFoldersOf(raw, item.key)) { // folders from older scans: the episode is somewhere inside
      const on = mounts.has(li.driveId);
      const sf = (li.seasons || []).find(x => x.number === season);
      const dir = sf ? (sf.name ? path.join(li.path, sf.name) : sf.path) : li.path;
      for (const n of ((li.owned && li.owned[season]) || [])) addWhere(n, { file: '', dir, name: '', driveName: driveNameOf(li.driveId), online: on });
    }
  } else if (item.path) {
    for (const n of have) addWhere(n, { file: '', dir: item.path, name: '', driveName: item.driveName || '', online: !!item.online });
  }
  episodes.forEach(e => {
    const list = (where.get(e.number) || []).slice().sort((a, b) => (b.online - a.online) || a.driveName.localeCompare(b.driveName) || a.dir.localeCompare(b.dir));
    e.wheres = list;
    e.where = list[0] || null;
  });
  // files of this season the app could not number: listed last, each with "Assign episode number"
  const unplaced = [];
  if (item.isGroup) {
    for (const r of loadLibrary()) {
      if (r.type !== 'episode' || r.showKey !== item.key || r.season !== season || (r.eps || []).length || !r.isFile) continue;
      unplaced.push({ id: r.id, file: r.path, name: path.basename(r.path), dir: path.dirname(r.path), driveName: driveNameOf(r.driveId), online: mounts.has(r.driveId), size: r.size || null });
    }
  }
  const ew = epWatched[id] || {};
  episodes.forEach(e => { e.watched = !!ew[`${season}:${e.number}`]; });
  return { status: s ? 'ok' : key ? 'offline' : 'no_key', unreadable, episodes, unplaced, tmdbId: info && info.mediaType === 'tv' ? info.tmdbId : null, showTitle: item.title };
});

ipcMain.handle('get-person', async (event, personId) => {
  let p = meta.cachedPerson(personId);
  let status = 'ok';
  if (!p) {
    if (!getTmdbKey() || keyInvalid) return { status: getTmdbKey() ? 'bad_key' : 'no_key' };
    try { p = await meta.getPerson(personId); } catch (e) { return { status: e.status === 401 ? 'bad_key' : 'offline' }; }
  }
  const photoUrl = await meta.ensureImage(p.photo, 'w185');
  const { ownedMap } = analyze();
  // posters for titles you don't own: saved once, so the "Also appears in" cards show artwork
  const want = p.credits.filter(c => c.poster && !ownedMap.has(`${c.type}:${c.id}`)).slice(0, 36);
  await Promise.race([Promise.all(want.map(c => meta.ensureImage(c.poster, 'w185'))), sleep(6000)]);
  const credits = p.credits.map(c => {
    const item = ownedMap.get(`${c.type}:${c.id}`);
    return { ...c, ownedId: item ? item.id : null, poster: item ? item.poster : meta.imageUrl(c.poster), online: item ? item.online : null };
  });
  return {
    status,
    person: { id: p.id, name: p.name, department: p.department, birthday: p.birthday, place: p.place, bio: p.bio, photoUrl },
    credits: [...credits.filter(c => c.ownedId), ...credits.filter(c => !c.ownedId)],
    ownedCount: credits.filter(c => c.ownedId).length
  };
});

/** Extra words each title can be found by: cast, characters, director / creator, genres, language, year, tagline. */
function searchTextFor(item) {
  if (item.type !== 'movie' && item.type !== 'series') return '';
  const info = idInfoFor(item);
  const d = info ? meta.cachedDetails(info.mediaType, info.tmdbId) : null;
  const bits = [item.language, item.year, ...(item.genres || [])];
  if (d) {
    bits.push(...(d.genres || []), d.tagline, d.language);
    for (const c of d.cast || []) bits.push(c.name, c.character);
    for (const c of [...(d.directors || []), ...(d.creators || [])]) bits.push(c.name);
  }
  return bits.filter(Boolean).join(' ').toLowerCase();
}

ipcMain.handle('get-search-index', async () => {
  await reconcileP;
  const out = {};
  for (const i of decorate(loadLibrary(), { all: true })) { const t = searchTextFor(i); if (t) out[i.id] = t; }
  return out;
});

ipcMain.handle('search-all', async (event, q) => {
  const w = String(q || '').trim().toLowerCase();
  if (!w) return { titles: [], related: [], people: [] };
  const toks = w.split(/\s+/).filter(Boolean);
  const lib = decorate(loadLibrary());
  const hay = (i) => `${i.title || ''} ${i.artist || ''} ${searchTextFor(i)}`.toLowerCase();
  const direct = lib.filter(i => (i.title || '').toLowerCase().includes(w) || (i.artist || '').toLowerCase().includes(w));
  const seen = new Set(direct.map(i => i.id));
  const wide = lib.filter(i => !seen.has(i.id) && toks.every(t => hay(i).includes(t)));
  const titles = direct.slice(0, 8).map(slimItem), related = wide.slice(0, 8).map(slimItem);
  return { titles, related, people: meta.searchPeople(w) };
});

// ---------- IPC: bulk metadata sync ----------
let syncRunning = false;
ipcMain.handle('sync-metadata', async (event, opts = {}) => {
  if (syncRunning) return { busy: true };
  const key = getTmdbKey();
  if (!key) return { noKey: true };
  if (keyInvalid) return { badKey: true };
  syncRunning = true;
  const send = (d) => { if (!event.sender.isDestroyed()) event.sender.send('meta-progress', d); };
  const sum = { resolved: 0, unresolved: 0, details: 0, errors: 0, collections: 0, universes: 0 };
  try {
    const items = decorate(loadLibrary(), { all: true }).filter(i => i.type === 'movie' || i.type === 'series');
    let done = 0;
    let next = 0;
    let stop = false;
    const worker = async () => {
      while (next < items.length && !stop) {
        const item = items[next++];
        try {
          const info = await resolveTmdb(item, { search: true });
          if (!info) sum.unresolved++;
          else {
            sum.resolved++;
            const had = meta.cachedDetails(info.mediaType, info.tmdbId);
            await meta.getDetails(info.mediaType, info.tmdbId, { refresh: !!opts.refresh && !!had });
            if (!had) sum.details++;
          }
        } catch (e) {
          if (e.status === 401) { keyInvalid = true; stop = true; }
          else { sum.errors++; if (netIsDown()) { stop = true; sum.netDown = true; sum.lastError = netHealth.lastError; } }
        }
        done++;
        send({ phase: 'titles', done, total: items.length, ...sum });
      }
    };
    await Promise.all(Array.from({ length: Math.min(10, items.length) }, worker));
    if (keyInvalid) return { ...sum, badKey: true };
    if (sum.netDown) return { ...sum };

    // franchises: collections of owned movies + the configured universes
    const colIds = new Set();
    for (const d of meta.allDetails()) if (d.type === 'movie' && d.collection) colIds.add(d.collection.id);
    const defs = franchiseDefs();
    const total = colIds.size + defs.length;
    let n = 0;
    for (const id of colIds) {
      try { await meta.getCollection(id); sum.collections++; } catch (e) { if (e.status !== 401) sum.errors++; }
      send({ phase: 'franchises', done: ++n, total, ...sum });
    }
    for (const def of defs) {
      try { await meta.getUniverse(def); sum.universes++; } catch (e) { if (e.status !== 401) sum.errors++; }
      send({ phase: 'franchises', done: ++n, total, ...sum });
    }
    meta.flush();
    return sum;
  } finally {
    syncRunning = false;
  }
});

// ---------- IPC: review matches (names the app was not sure about) ----------
function reviewGroups() {
  const lib = withSeries(loadLibrary(), idFor).filter(i => i.type === 'movie' || i.type === 'series');
  const groups = new Map();
  for (const item of lib) {
    const q = queryFor(item);
    const m = matches[q.key];
    if (!m || overrides[q.key] || m.state === 'skipped') continue;
    let g = groups.get(q.key);
    if (!g) {
      g = { key: q.key, state: m.state, reason: m.reason || '', type: item.type, parsed: { title: q.title, year: q.year }, guess: m.guess, candidates: m.candidates || [], names: [], itemIds: [] };
      groups.set(q.key, g);
    }
    g.names.push(item.isGroup ? `${item.title} (${item.episodes} episode${item.episodes === 1 ? '' : 's'})` : path.basename(item.path));
    g.itemIds.push(item.id);
  }
  return [...groups.values()].sort((a, b) => (a.state === b.state ? 0 : a.state === 'unmatched' ? -1 : 1) || a.parsed.title.localeCompare(b.parsed.title));
}

async function withThumbs(cands) {
  const list = (cands || []).map(c => ({ ...c }));
  await Promise.race([Promise.all(list.map(c => (c.poster ? meta.ensureImage(c.poster, 'w185') : null))), sleep(6000)]);
  return list.map(c => ({ ...c, thumb: c.poster ? meta.imageUrl(c.poster) : null }));
}

ipcMain.handle('get-review-count', async () => { await reconcileP; return { count: reviewGroups().length }; });

ipcMain.handle('get-review', async () => {
  await reconcileP;
  const groups = reviewGroups();
  for (const g of groups.slice(0, 60)) g.candidates = await withThumbs(g.candidates);
  return { groups: groups.map(g => ({ ...g, names: g.names.slice(0, 4), itemCount: g.itemIds.length })), hasKey: !!getTmdbKey() };
});

// Manual search from the review page
ipcMain.handle('review-search', async (event, { query, year } = {}) => {
  const key = getTmdbKey();
  if (!key || keyInvalid) return { ok: false, candidates: [] };
  const text = String(query || '').trim().slice(0, 120);
  if (!text) return { ok: true, candidates: [] };
  const out = [];
  for (const type of ['movie', 'tv']) {
    try {
      const yk = type === 'tv' ? 'first_air_date_year' : 'year';
      const json = await netQueue(() => tmdbGet(`/search/${type}`, { include_adult: 'false', query: text, ...(year ? { [yk]: year } : {}) }, key));
      clean(json.results).slice(0, 5).forEach(r => out.push(candOf(type, r)));
    } catch (e) { if (e.status === 401) keyInvalid = true; }
  }
  return { ok: true, candidates: await withThumbs(out) };
});

// "Yes, this is it" (or a different pick): saved for good, the poster is fetched, the title shown from now on is TMDB's.
ipcMain.handle('review-confirm', (event, req = {}) => confirmMatch(req));

// "Confirm all best guesses": every "not sure" title that has a guess is accepted in one go ("no match" ones are left alone)
ipcMain.handle('review-confirm-all', async () => {
  await reconcileP;
  if (!getTmdbKey() || keyInvalid) return { ok: false, error: 'no_key', done: 0, failed: 0 };
  let done = 0, failed = 0;
  for (const g of reviewGroups()) {
    if (g.state !== 'tentative' || !g.guess) continue;
    const r = await confirmMatch({ key: g.key, tmdbId: g.guess.id, mediaType: g.guess.type });
    if (r.ok) done++; else { failed++; if (r.error === 'no_key') break; }
  }
  return { ok: true, done, failed };
});

async function confirmMatch({ key, tmdbId, mediaType } = {}) {
  if (!key || !tmdbId || !['movie', 'tv'].includes(mediaType)) return { ok: false, error: 'unknown' };
  const apiKey = getTmdbKey();
  if (!apiKey || keyInvalid) return { ok: false, error: 'no_key' };
  try {
    const d = await meta.getDetails(mediaType, +tmdbId);
    overrides[key] = { tmdbId: +tmdbId, mediaType, title: d.title, year: d.year || null };
    meta.setId(key, { tmdbId: +tmdbId, mediaType });
    delete matches[key];
    saveMatchesSoon();
    // refresh the poster for this match
    delete posterIndex[key];
    const q = { key, title: d.title, year: d.year, tmdbType: mediaType, localOnly: false };
    try {
      const raw = await netQueue(() => tmdbGet(`/${mediaType}/${+tmdbId}`, {}, apiKey));
      if (raw.poster_path) {
        const file = `${key}.jpg`;
        await netQueue(() => downloadImage(raw.poster_path, path.join(postersDir, file)));
        record(key, { status: 'ok', source: 'tmdb', file, tmdbId: +tmdbId, mediaType, matched: d.title, confirmed: true });
      }
    } catch (e) { console.error('Poster after confirm failed:', e.message); }
    flushIndex();
    return { ok: true, title: d.title, year: d.year || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}


// ---------- "Correct this title": the person picks the right TMDB entry for one movie/series ----------
function itemById(id) { return decorate(loadLibrary(), { all: true }).find(i => i.id === id); }
ipcMain.handle('get-correct-info', async (_e, { id } = {}) => {
  await reconcileP;
  const it = itemById(id);
  if (!it || !(it.type === 'movie' || it.type === 'series')) return { ok: false };
  const folderTitle = parseMediaName(it.folderName || it.title || '');
  const qk = it.matchKey;
  return { ok: true, query: folderTitle.title || it.title, year: folderTitle.year || it.year || null, corrected: !!overrides[it.matchKey], hasKey: !!getTmdbKey() && !keyInvalid, kind: it.type === 'series' ? 'tv' : 'movie' };
});
ipcMain.handle('correct-title', async (_e, { id, tmdbId, mediaType } = {}) => {
  await reconcileP;
  const it = itemById(id);
  if (!it || !(it.type === 'movie' || it.type === 'series')) return { ok: false, error: 'unknown' };
  const key = it.matchKey;
  const r = await confirmMatch({ key, tmdbId, mediaType: mediaType || (it.type === 'series' ? 'tv' : 'movie') });
  if (r.ok) { flushMatches(); }
  return r;
});
ipcMain.handle('reset-correction', async (_e, { id } = {}) => {
  await reconcileP;
  const it = itemById(id);
  if (!it) return { ok: false };
  const key = it.matchKey;
  delete overrides[key]; delete matches[key]; delete posterIndex[key];
  try { meta.clearId(key); } catch {}
  flushMatches(); flushIndex();
  return { ok: true };
});

ipcMain.handle('review-skip', (event, { key } = {}) => {
  if (matches[key]) { matches[key].state = 'skipped'; saveMatchesSoon(); }
  return { ok: true };
});


// ---------- IPC: Videos tab (loose / unconfirmed videos: assign to a movie or show, or send to the Recycle Bin) ----------
// Assign: a movie (any item), or a show (a loose file becomes an episode of it, an existing unconfirmed show gets the match).
ipcMain.handle('assign-video', async (event, { id, tmdbId, mediaType } = {}) => {
  await reconcileP;
  const item = decorate(loadLibrary(), { all: true }).find(i => i.id === id);
  if (!item || !['movie', 'tv'].includes(mediaType)) return { ok: false, error: 'unknown' };
  if (item.type === 'series' && mediaType !== 'tv') return { ok: false, error: 'type' };
  if (item.type === 'movie' && !item.isFile && mediaType !== 'movie') return { ok: false, error: 'type' };
  if (item.type === 'movie' && item.isFile && mediaType === 'tv') {
    const key0 = getTmdbKey();
    if (!key0 || keyInvalid) return { ok: false, error: 'no_key' };
    let d;
    try { d = await meta.getDetails('tv', +tmdbId); } catch (e) { return { ok: false, error: e.message }; }
    videoAssign[item.id] = { tmdbId: +tmdbId, title: d.title, year: d.year || null };
    saveVideoAssign();
    const key = queryFor({ type: 'series', title: d.title, year: d.year || null }).key;
    const r = await confirmMatch({ key, tmdbId, mediaType: 'tv' });
    return r.ok ? { ...r, as: 'episode' } : r;
  }
  const key = queryFor(item).key;
  const r = await confirmMatch({ key, tmdbId, mediaType });
  return r;
});

// Delete: only ever to the Recycle Bin. If the drive has none (or the move fails) nothing is deleted.
ipcMain.handle('delete-videos', async (event, { ids } = {}) => {
  await reconcileP;
  const all = decorate(loadLibrary(), { all: true });
  const raw = loadLibrary();
  const removed = new Set(), res = { ok: true, moved: 0, failed: [], offline: [] };
  for (const id of ids || []) {
    const item = all.find(i => i.id === id);
    if (!item) continue;
    let recs;
    if (item.isGroup) recs = raw.filter(r => (r.type === 'episode' && r.showKey === item.key) || (r.type === 'series' && !r.isGroup && (legacyShow(r) || {}).key === item.key));
    else recs = raw.filter(r => r.id === id);
    for (const r of recs) {
      if (!r.path) continue;
      const online = r.driveId ? mounts.has(r.driveId) : isPathOnline(r.path);
      if (!online) { res.offline.push(path.basename(r.path)); continue; }
      try {
        if (!fs.existsSync(r.path)) { removed.add(r.id); continue; } // already gone from the drive
        await shell.trashItem(r.path);
        removed.add(r.id); res.moved++;
      } catch (e) {
        res.failed.push({ name: path.basename(r.path), error: e.message });
      }
    }
  }
  if (removed.size) saveLibrary(raw.filter(r => !removed.has(r.id)));
  return res;
});


// ---------- IPC: episode numbers, wishlist, track removal, video length ----------
ipcMain.handle('set-episode-number', async (event, { id, season, number } = {}) => {
  const n = parseInt(number, 10), sn = parseInt(season, 10);
  if (!id || !(n >= 0) || !(sn >= 0)) return { ok: false, error: 'bad' };
  if (!loadLibrary().some(r => r.id === id && r.type === 'episode')) return { ok: false, error: 'gone' };
  episodeNums[id] = { season: sn, eps: [n] };
  saveJson(episodeNumFile, episodeNums);
  return { ok: true };
});

// Wishlist: missing movies / shows (franchise gaps) and missing episodes. Entries disappear by themselves once owned.
const GOOD_RES = new Set(['1080p', '4K']);
function wishOwned(e, ownedMap, lib) {
  if (e.kind === 'upgrade') { // done once the file you own is 1080p / 4K (or the old file is gone, replaced by a better one)
    const it = (lib || []).find(i => i.id === e.id);
    return !it || GOOD_RES.has(it.quality && it.quality.res);
  }
  if (e.kind === 'episode') {
    const it = ownedMap.get(`tv:${e.showId}`);
    return !!(it && it.owned && (it.owned[e.season] || []).includes(e.number));
  }
  return ownedMap.has(`${e.type}:${e.tmdbId}`);
}
function pruneWishlist(ownedMap, lib) {
  const keep = wishlist.filter(e => !wishOwned(e, ownedMap, lib));
  if (keep.length !== wishlist.length) { wishlist = keep; saveJson(wishlistFile, wishlist); }
}
ipcMain.handle('wishlist-add', async (event, e = {}) => {
  let entry;
  if (e.kind === 'upgrade') {
    const it = e.id && decorate(loadLibrary(), { all: true }).find(i => i.id === e.id && i.type === 'movie');
    if (!it) return { ok: false };
    entry = { key: `up:${it.id}`, kind: 'upgrade', type: 'movie', id: it.id, title: it.title, year: it.year || null, from: (it.quality && it.quality.res) || 'SD', posterUrl: it.poster || null, addedAt: Date.now() };
  } else if (e.kind === 'episode') {
    if (!e.showId || e.season == null || e.number == null) return { ok: false };
    entry = { key: `ep:${e.showId}:${e.season}:${e.number}`, kind: 'episode', showId: +e.showId, showTitle: String(e.showTitle || ''), season: +e.season, number: +e.number, name: String(e.name || ''), poster: e.poster || null, addedAt: Date.now() };
  } else {
    if (!e.tmdbId || !['movie', 'tv'].includes(e.type)) return { ok: false };
    entry = { key: `${e.type}:${e.tmdbId}`, kind: 'title', type: e.type, tmdbId: +e.tmdbId, title: String(e.title || ''), year: e.year || null, poster: e.poster || null, addedAt: Date.now() };
  }
  if (!wishlist.some(x => x.key === entry.key)) { wishlist.push(entry); saveJson(wishlistFile, wishlist); }
  return { ok: true, keys: wishlist.map(x => x.key) };
});
ipcMain.handle('wishlist-remove', async (event, { key } = {}) => {
  wishlist = wishlist.filter(x => x.key !== key); saveJson(wishlistFile, wishlist);
  return { ok: true, keys: wishlist.map(x => x.key) };
});
ipcMain.handle('get-upgrades', async () => {
  await reconcileP;
  const rank = { SD: 0, '720p': 1 };
  const rows = decorate(loadLibrary()).filter(i => i.type === 'movie' && i.quality && rank[i.quality.res] != null)
    .sort((a, b) => rank[a.quality.res] - rank[b.quality.res] || (a.title || '').localeCompare(b.title || ''))
    .map(i => ({ id: i.id, title: i.title, year: i.year, poster: i.poster, res: i.quality.res, tags: i.quality.tags || [], size: i.size || null, online: i.online, driveName: i.driveName, shelf: i.shelf, wished: wishlist.some(w => w.key === `up:${i.id}`) }));
  return { rows };
});
ipcMain.handle('wishlist-keys', async () => { await reconcileP; { const a = analyze(); pruneWishlist(a.ownedMap, a.lib); }; return wishlist.map(x => x.key); });
ipcMain.handle('get-wishlist', async () => {
  await reconcileP;
  { const a = analyze(); pruneWishlist(a.ownedMap, a.lib); };
  const list = wishlist.slice().sort((a, b) => b.addedAt - a.addedAt);
  await Promise.race([Promise.all(list.filter(e => e.poster).map(e => meta.ensureImage(e.poster, 'w185'))), sleep(5000)]);
  return { items: list.map(e => ({ ...e, posterUrl: e.posterUrl || (e.poster ? meta.imageUrl(e.poster) : null) })) };
});

// Remove one song (or one single): Recycle Bin only. If the drive has none, nothing is deleted.
ipcMain.handle('delete-track', async (event, { id, rel } = {}) => {
  await reconcileP;
  const raw = loadLibrary();
  const rec = raw.find(r => r.id === id && r.type === 'music');
  if (!rec) return { ok: false, error: 'gone' };
  const online = rec.driveId ? mounts.has(rec.driveId) : isPathOnline(rec.path);
  if (!online) return { ok: false, error: 'offline' };
  const file = rec.single ? rec.path : path.resolve(rec.path, String(rel || ''));
  if (!rec.single && (!rel || !file.startsWith(path.resolve(rec.path) + path.sep))) return { ok: false, error: 'bad' };
  try {
    if (fs.existsSync(file)) await shell.trashItem(file);
  } catch (e) { return { ok: false, error: 'nobin', message: e.message }; }
  let next;
  if (rec.single) next = raw.filter(r => r.id !== id);
  else {
    const gone = (rec.tracks || []).find(t => t.rel === rel);
    const tracks = (rec.tracks || []).filter(t => t.rel !== rel);
    next = tracks.length ? raw.map(r => r.id === id ? { ...r, tracks, size: Math.max(0, (r.size || 0) - ((gone && gone.size) || 0)), fileCount: Math.max(0, (r.fileCount || 1) - 1) } : r) : raw.filter(r => r.id !== id);
  }
  saveLibrary(next);
  return { ok: true };
});

// Length of each video, read from the file header; remembered by file size so it is not read twice.
ipcMain.handle('get-durations', async (event, { ids } = {}) => {
  await reconcileP;
  const raw = loadLibrary();
  const out = {};
  let dirty = false;
  for (const id of (ids || []).slice(0, 400)) {
    const r = raw.find(x => x.id === id);
    if (!r) continue;
    const files = r.isFile ? [r.path] : [];
    if (!files.length) continue;
    const c = durations[id];
    if (c && c.size === r.size) { out[id] = c.sec; continue; }
    const online = r.driveId ? mounts.has(r.driveId) : isPathOnline(r.path);
    if (!online) continue;
    const sec = videoDuration(r.path);
    durations[id] = { size: r.size, sec }; dirty = true;
    out[id] = sec;
    await new Promise(res => setImmediate(res));
  }
  if (dirty) saveJson(durationsFile, durations);
  return out;
});

// ---------- IPC: play (opens the file in the user's own player; never changes anything) ----------
const itemOnline = (item) => (item.isGroup ? (item.drives || []).some(id => mounts.has(id)) : (item.driveId ? mounts.has(item.driveId) : isPathOnline(item.path)));

ipcMain.handle('play', async (event, req) => {
  await reconcileP;
  req = req || {};
  const rawLib = loadLibrary();
  const item = withSeries(rawLib, idFor).find(i => i.id === req.id);
  if (!item) return { ok: false, error: 'gone' };
  if (item.type === 'game') return { ok: false, error: 'unsupported' };
  if (!itemOnline(item)) return { ok: false, error: 'offline' };
  let file = null;
  try {
    if (item.type === 'movie') file = item.isFile ? item.path : media.pickMainVideo(item.path);
    else if (item.type === 'series') {
      if (item.isGroup) {
        // episodes are files wherever they live (any folder, any drive); pick one that is plugged in
        const recs = rawLib.filter(r => r.type === 'episode' && r.showKey === item.key && mounts.has(r.driveId));
        const has = (r, s, n) => r.season === s && (r.eps || []).includes(n);
        let rec = null;
        if (req.season != null && req.number != null) rec = recs.find(r => has(r, +req.season, +req.number));
        else {
          const first = media.firstOwnedEpisode(item);
          if (first) rec = recs.find(r => has(r, first.season, first.number));
          if (!rec) rec = recs.sort((a, b) => (a.season === 0) - (b.season === 0) || a.season - b.season || (a.eps[0] - b.eps[0]))[0] || null;
        }
        file = rec ? rec.path : null;
        if (!file) { // old folder-based records: look inside the folder for the file
          for (const li of legacyFoldersOf(rawLib, item.key)) {
            if (!mounts.has(li.driveId)) continue;
            if (req.season != null && req.number != null) file = media.findEpisodeFile(li, +req.season, +req.number);
            else {
              const first = media.firstOwnedEpisode(li);
              file = first ? media.findEpisodeFile(li, first.season, first.number) : null;
              if (!file) file = media.pickMainVideo(li.path);
            }
            if (file) break;
          }
        }
      } else if (req.season != null && req.number != null) file = media.findEpisodeFile(item, +req.season, +req.number);
      else {
        const first = media.firstOwnedEpisode(item);
        file = first ? media.findEpisodeFile(item, first.season, first.number) : null;
        if (!file) file = media.pickMainVideo(item.path); // flat folders whose names carry no episode numbers
      }
    } else if (item.type === 'music' && item.single) {
      file = item.path;
    } else if (item.type === 'music') {
      const base = path.resolve(item.path);
      if (req.track) {
        const full = path.resolve(base, String(req.track));
        if (!full.startsWith(base + path.sep) || !media.AUDIO.test(full) || !fs.existsSync(full)) return { ok: false, error: 'nofile' };
        file = full;
      } else {
        const tracks = media.listTracks(item.path);
        if (!tracks.length) return { ok: false, error: 'nofile' };
        file = path.join(item.path, tracks[0].rel);
        if (tracks.length > 1) { // a playlist in the system temp folder (not on the drive) so the whole album plays
          try {
            const pl = path.join(require('os').tmpdir(), `hddorganizer-${item.id}.m3u`);
            fs.writeFileSync(pl, '#EXTM3U\n' + tracks.map(t => path.join(item.path, t.rel)).join('\n') + '\n');
            file = pl;
          } catch {}
        }
      }
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (!file) return { ok: false, error: 'nofile' };
  const err = await shell.openPath(file);
  return err ? { ok: false, error: err } : { ok: true, file: path.basename(file) };
});

ipcMain.handle('get-album', async (event, id) => {
  await reconcileP;
  const item = decorate(loadLibrary(), { all: true }).find(i => i.id === id);
  if (!item || item.type !== 'music') return { status: 'gone' };
  let tracks = Array.isArray(item.tracks) ? item.tracks : null;
  if (!tracks && item.online) tracks = media.listTracks(item.path);
  return { status: 'ok', item, tracks: tracks || [], saved: !!item.tracks };
});

// ---------- IPC: collections (franchise shelf) ----------
ipcMain.handle('get-collections', async () => {
  await reconcileP;
  const { lib, ownedMap, eligible } = analyze();
  const byId = new Map(lib.map(i => [i.id, i]));
  const withDetails = lib.filter(i => { const x = idInfoFor(i); return x && meta.cachedDetails(x.mediaType, x.tmdbId); }).length;
  const list = computeFranchises(ownedMap).map(f => ({
    key: f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), kind: f.kind, name: f.name,
    total: f.total, owned: f.owned, missing: f.missing.length, upcoming: f.upcoming.length,
    covers: f.parts.filter(p => p.owned).slice(0, 3).map(p => (byId.get(p.itemId) || {}).poster).filter(Boolean),
    groups: f.groups || null, parts: f.parts, hasMovies: f.parts.some(p => p.type !== 'tv'), hasTv: f.parts.some(p => p.type === 'tv')
  })).sort((a, b) => a.name.localeCompare(b.name));
  await withPartPosters(list);
  return { collections: list, synced: { withDetails, eligible, hasKey: !!getTmdbKey() } };
});

// ---------- IPC: franchise editor ----------
ipcMain.handle('get-franchises', async () => {
  const { ownedMap } = analyze();
  const counts = new Map(computeFranchises(ownedMap).map(f => [f.name, f.total]));
  return franchiseDefs().map(d => {
    const u = meta.cachedUniverse(d);
    return { name: d.name, keyword: d.keyword, count: counts.has(d.name) ? counts.get(d.name) : (u ? u.parts.length : null), fetched: !!u };
  });
});
ipcMain.handle('save-franchises', async (_e, list) => {
  if (!Array.isArray(list)) return { ok: false, error: 'Bad list.' };
  const clean = [], names = new Set(), kws = new Set();
  for (const d of list) {
    const name = String((d && d.name) || '').trim().slice(0, 80), keyword = String((d && d.keyword) || '').trim().slice(0, 120);
    if (!name || !keyword) return { ok: false, error: 'Every franchise needs a name and a keyword.' };
    if (names.has(name.toLowerCase())) return { ok: false, error: `“${name}” is listed twice.` };
    if (kws.has(keyword.toLowerCase())) return { ok: false, error: `The keyword “${keyword}” is listed twice.` };
    names.add(name.toLowerCase()); kws.add(keyword.toLowerCase()); clean.push({ name, keyword });
  }
  const before = franchiseDefs();
  try { writeJsonAtomic(path.join(userData, 'franchises.json'), clean); } catch (e) { return { ok: false, error: e.message }; }
  // fetch new or changed ones right away so they show up without pressing Sync Info
  const results = [];
  if (getTmdbKey()) {
    for (const d of clean) {
      const old = before.find(b => b.name === d.name && b.keyword === d.keyword);
      if (old && meta.cachedUniverse(d)) continue;
      try { const u = await meta.getUniverse(d); results.push({ name: d.name, found: u.parts.length }); } catch { results.push({ name: d.name, found: null }); }
    }
    meta.flush();
  }
  return { ok: true, results, hasKey: !!getTmdbKey() };
});

// ---------- IPC: duplicates, storage, shelf list ----------
ipcMain.handle('get-duplicates', async () => {
  await reconcileP;
  const lib = decorate(loadLibrary());
  const r = findDuplicates(lib);
  return { ...r, measured: lib.filter(i => i.size != null).length, total: lib.length };
});

ipcMain.handle('get-storage', async () => {
  await reconcileP;
  const lib = perDrive(decorate(loadLibrary(), { all: true }));
  const dv = drivesView();
  const perDriveRows = dv.map(d => {
    const mine = lib.filter(i => i.driveId === d.id);
    const byType = { movie: 0, series: 0, music: 0, game: 0 };
    let cataloged = 0, unmeasured = 0;
    for (const i of mine) {
      if (i.size == null) { unmeasured++; continue; }
      cataloged += i.size;
      if (byType[i.type] != null) byType[i.type] += i.size;
    }
    return { id: d.id, name: d.name, shelf: d.shelf, online: d.online, total: d.total, free: d.free, used: d.used, items: mine.length, cataloged, byType, unmeasured };
  });
  const res = { '4K': 0, '1080p': 0, '720p': 0, SD: 0, unknown: 0 };
  const upgrades = [];
  for (const i of lib) {
    if (i.type !== 'movie' && i.type !== 'series') continue;
    const r = i.quality && i.quality.res;
    res[r || 'unknown']++;
    if (r === '720p' || r === 'SD') upgrades.push({ id: i.id, title: i.displayTitle, res: r, driveName: i.driveName });
  }
  const biggest = lib.filter(i => i.size).sort((a, b) => b.size - a.size).slice(0, 10)
    .map(i => ({ id: i.id, title: i.displayTitle || i.title, type: i.type, size: i.size, driveName: i.driveName, online: i.online }));
  return { drives: perDriveRows, resolution: res, upgrades: upgrades.slice(0, 50), upgradeCount: upgrades.length, biggest, unmeasured: lib.filter(i => i.size == null).length, total: lib.length };
});

function shelfData() {
  const lib = perDrive(decorate(loadLibrary(), { all: true }));
  const order = ['movie', 'series', 'music', 'game'];
  return drivesView().map(d => {
    const mine = lib.filter(i => i.driveId === d.id);
    const groups = order.map(t => ({
      type: t,
      items: mine.filter(i => i.type === t).sort((a, b) => (a.displayTitle || a.title).localeCompare(b.displayTitle || b.title))
        .map(i => ({ title: i.type === 'music' ? [i.artist, i.title].filter(Boolean).join(' – ') + (i.year ? ` (${i.year})` : '') : i.displayTitle, size: i.size || null, res: i.quality && i.quality.res ? i.quality.res : '' }))
    })).filter(g => g.items.length);
    return { id: d.id, name: d.name, shelf: d.shelf, online: d.online, lastSeen: d.lastSeen, total: mine.length, groups };
  });
}

ipcMain.handle('get-shelf-list', async () => { await reconcileP; return { drives: shelfData(), made: Date.now() }; });

const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
ipcMain.handle('export-shelf-csv', async () => {
  const res = await dialog.showSaveDialog({
    title: 'Save shelf list',
    defaultPath: path.join(app.getPath('downloads'), 'shelf-list.csv'),
    filters: [{ name: 'CSV (opens in Excel)', extensions: ['csv'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  const lines = [['Drive', 'Shelf', 'Type', 'Title', 'Size (bytes)', 'Quality'].map(csvCell).join(',')];
  const label = { movie: 'Movie', series: 'Series', music: 'Album', game: 'Game' };
  for (const d of shelfData()) for (const g of d.groups) for (const i of g.items) {
    lines.push([d.name, d.shelf, label[g.type], i.title, i.size, i.res].map(csvCell).join(','));
  }
  try {
    fs.writeFileSync(res.filePath, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
    return { ok: true, filePath: res.filePath, rows: lines.length - 1 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---------- IPC: compare two drives, verified copy, delete original ----------
ipcMain.handle('compare-drives', async (event, { a, b } = {}) => {
  await reconcileP;
  if (!a || !b || a === b) return { rows: [], bytes: 0 };
  const lib = decorate(loadLibrary());
  const rows = compareDrives(lib, a, b).map(r => ({
    id: r.item.id, title: r.item.displayTitle || r.item.title, type: r.item.type, year: r.item.year, artist: r.item.artist,
    poster: r.item.poster, status: r.status, missingEpisodes: r.missingEpisodes || 0, size: r.size, quality: r.item.quality,
    rel: r.item.rel, isSeries: !!r.item.isGroup, copyable: r.item.isGroup ? true : (r.status === 'missing' && r.item.rel != null)
  }));
  const dv = Object.fromEntries(drivesView().map(d => [d.id, d]));
  return {
    rows, bytes: rows.filter(r => r.copyable).reduce((n, r) => n + (r.size || 0), 0),
    a: dv[a] || null, b: dv[b] || null, bothOnline: !!(dv[a] && dv[a].online && dv[b] && dv[b].online),
    unmeasured: lib.filter(i => i.driveId === a && i.size == null).length
  };
});

let copyJob = null;
ipcMain.handle('copy-item', async (event, { id, toDriveId, fromDriveId } = {}) => {
  await reconcileP;
  if (copyJob) return { ok: false, error: 'busy', message: 'Another copy is still running.' };
  // a show: copy the episode files this drive has and the target lacks, into the same folders
  const rawAll = loadLibrary();
  const ent = withSeries(rawAll, idFor).find(i => i.id === id && i.isGroup);
  if (ent) {
    const from = mounts.get(fromDriveId), to = mounts.get(toDriveId);
    if (!from || !to) return { ok: false, error: 'offline', message: 'Both drives need to be plugged in.' };
    if (fromDriveId === toDriveId) return { ok: false, error: 'same', message: 'Pick a different target drive.' };
    const eps = rawAll.filter(r => r.type === 'episode' && r.showKey === ent.key);
    const onTarget = new Set();
    eps.filter(r => r.driveId === toDriveId).forEach(r => (r.eps || []).forEach(n => onTarget.add(`${r.season}:${n}`)));
    const todo = eps.filter(r => r.driveId === fromDriveId && r.rel != null && (r.eps || []).some(n => !onTarget.has(`${r.season}:${n}`)));
    if (!todo.length) return { ok: false, error: 'nothing', message: 'The target drive already has every episode this drive has.' };
    const totalBytes = todo.reduce((n, r) => n + (r.size || 0), 0);
    const sp = drives.diskSpace(to.root);
    if (sp && sp.free < totalBytes * 1.02 + 1024 * 1024) return { ok: false, error: 'space', message: 'Not enough free space on the target drive.' };
    copyJob = { cancel: false };
    let files = 0, bytes = 0;
    const added = [];
    try {
      for (const r of todo) {
        const rel = String(r.rel);
        if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
        const dest = path.join(to.root, rel);
        if (fs.existsSync(dest)) continue;
        await copyFileVerified(r.path, dest, { freeBytes: null, isCancelled: () => copyJob.cancel });
        files++; bytes += r.size || 0;
        const copy = { ...r, driveId: toDriveId, rel, path: dest, scannedAt: Date.now(), addedAt: Date.now() };
        copy.id = libId(copy);
        added.push(copy);
        if (!event.sender.isDestroyed()) event.sender.send('copy-progress', { id, files, totalFiles: todo.length, bytes, totalBytes, current: path.basename(dest) });
      }
      return { ok: true, copyId: null, files, bytes, dest: to.root, series: true };
    } catch (e) {
      return { ok: false, error: e.code || 'error', message: e.message };
    } finally {
      if (added.length) {
        const lib = loadLibrary();
        const have = new Set(lib.map(i => i.id));
        added.forEach(c => { if (!have.has(c.id)) lib.push(c); });
        saveLibrary(lib);
        const d = drivesDb.find(x => x.id === toDriveId);
        if (d) { refreshSpace(d); saveDrives(); }
      }
      copyJob = null;
    }
  }
  const item = loadLibrary().find(i => i.id === id);
  if (!item || !item.driveId || item.rel == null) return { ok: false, error: 'unlinked', message: 'This item is not linked to a drive yet. Scan its drive again first.' };
  const rel = String(item.rel);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, error: 'unlinked', message: 'Unexpected folder location.' };
  const from = mounts.get(item.driveId), to = mounts.get(toDriveId);
  if (!from || !to) return { ok: false, error: 'offline', message: 'Both drives need to be plugged in.' };
  if (item.driveId === toDriveId) return { ok: false, error: 'same', message: 'Pick a different target drive.' };
  const src = path.join(from.root, rel), dest = path.join(to.root, rel);
  copyJob = { cancel: false };
  try {
    const sp = drives.diskSpace(to.root);
    const r = await (item.isFile ? copyFileVerified : copyFolderVerified)(src, dest, {
      freeBytes: sp ? sp.free : null,
      isCancelled: () => copyJob.cancel,
      onProgress: (p) => { if (!event.sender.isDestroyed()) event.sender.send('copy-progress', { id, ...p }); }
    });
    const copy = { ...item, driveId: toDriveId, rel, path: dest, scannedAt: Date.now(), addedAt: Date.now() };
    copy.id = libId(copy);
    const lib = loadLibrary();
    if (!lib.some(i => i.id === copy.id)) lib.push(copy);
    saveLibrary(lib);
    const d = drivesDb.find(x => x.id === toDriveId);
    if (d) { refreshSpace(d); saveDrives(); }
    return { ok: true, copyId: copy.id, files: r.files, bytes: r.bytes, dest };
  } catch (e) {
    return { ok: false, error: e.code || 'error', message: e.message };
  } finally {
    copyJob = null;
  }
});

ipcMain.handle('cancel-copy', () => { if (copyJob) copyJob.cancel = true; return true; });

// Step two, only when the person asks: re-check the copy, then move the original to the Recycle Bin.
ipcMain.handle('delete-original', async (event, { id, copyId } = {}) => {
  await reconcileP;
  const lib = loadLibrary();
  const a = lib.find(i => i.id === id), b = lib.find(i => i.id === copyId);
  if (!a || !b || a.driveId === b.driveId) return { ok: false, message: 'Could not find both copies.' };
  const ma = mounts.get(a.driveId), mb = mounts.get(b.driveId);
  if (!ma || !mb) return { ok: false, message: 'Both drives need to be plugged in.' };
  const root = path.resolve(ma.root);
  if (!path.resolve(a.path).startsWith(root) || path.resolve(a.path) === root) return { ok: false, message: 'Unexpected folder location.' };
  const v = a.isFile ? verifyFiles(a.path, b.path) : verifyTrees(a.path, b.path);
  if (!v.ok) return { ok: false, message: `The copy no longer matches the original (${v.reason}). Nothing was deleted.` };
  try {
    await shell.trashItem(a.path);
  } catch (e) {
    return { ok: false, message: `Could not move the original to the Recycle Bin: ${e.message}. Nothing was deleted.` };
  }
  saveLibrary(lib.filter(i => i.id !== id));
  const d = drivesDb.find(x => x.id === a.driveId);
  if (d) { refreshSpace(d); saveDrives(); }
  return { ok: true };
});

// ============================================================
// v2.8: move planner with undo, junk cleanup, inbox, sharing
// ============================================================
const movesFile = path.join(userData, 'moves.json');
let movesLog = readJson(movesFile, []);
if (!Array.isArray(movesLog)) movesLog = [];
const UNDO_DAYS = 30;
let moveJob = null;

/** Everything keyed by an item id follows the item when its id changes (an id is made from drive + folder). */
function migrateIds(map) {
  if (!map.size) return;
  const stores = [
    [marks, () => writeJsonAtomic(marksFile, marks)], [langOverrides, () => writeJsonAtomic(languagesFile, langOverrides)],
    [gameFlags, saveGameFlags], [durations, () => saveJson(durationsFile, durations)], [videoAssign, saveVideoAssign],
    [episodeNums, () => saveJson(episodeNumFile, episodeNums)], [asShow, () => writeJsonAtomic(asShowFile, asShow)]
  ];
  for (const [store, save] of stores) {
    let changed = false;
    for (const [from, to] of map) if (store && Object.prototype.hasOwnProperty.call(store, from)) { store[to] = store[from]; delete store[from]; changed = true; }
    if (changed) { try { save(); } catch {} }
  }
  let wl = false;
  for (const w of wishlist) for (const [from, to] of map) if (w.key === `up:${from}`) { w.key = `up:${to}`; wl = true; }
  if (wl) saveJson(wishlistFile, wishlist);
}

function recordsForIds(ids, raw, fromDriveId = null) {
  const all = decorate(raw, { all: true });
  const out = [], seen = new Set();
  for (const id of ids || []) {
    const item = all.find(i => i.id === id);
    if (!item) continue;
    const recs = item.isGroup
      ? raw.filter(r => (r.type === 'episode' && r.showKey === item.key) || (r.type === 'series' && !r.isGroup && (legacyShow(r) || {}).key === item.key))
      : raw.filter(r => r.id === id);
    for (const r of recs) if (!seen.has(r.id) && (!fromDriveId || r.driveId === fromDriveId)) { seen.add(r.id); out.push(r); }
  }
  return out;
}

function moveDeps(event, getJob) {
  return {
    copy: async (e) => {
      const sp = drives.diskSpace((mounts.get(e.toDriveId) || {}).root || e.to);
      await (e.isFile ? copyFileVerified : copyFolderVerified)(e.from, e.to, {
        freeBytes: sp ? sp.free : null, isCancelled: () => !!(getJob() && getJob().cancel)
      });
    },
    verify: (e) => (e.isFile ? verifyFiles(e.from, e.to) : verifyTrees(e.from, e.to)),
    trash: (p) => shell.trashItem(p)
  };
}

/** Run a list of planned entries one by one, keep the library and the id-keyed stores in step, and log the batch. */
async function executeBatch(event, entries, { kind = 'move', destDriveId = null } = {}) {
  moveJob = { cancel: false };
  const deps = moveDeps(event, () => moveJob);
  const done = [], failed = [], idMap = new Map();
  let lib = loadLibrary();
  try {
    let n = 0;
    for (const e of entries) {
      if (moveJob.cancel) { failed.push({ title: e.title, error: 'Stopped before this one.' }); continue; }
      try {
        await organize.runEntry(e, deps);
        const i = lib.findIndex(r => r.id === e.recId);
        let newId = e.recId;
        if (i >= 0) {
          const next = { ...lib[i], driveId: e.toDriveId, rel: e.toRel, path: e.to };
          newId = libId(next); next.id = newId; lib[i] = next;
        }
        if (newId !== e.recId) idMap.set(e.recId, newId);
        done.push({ oldId: e.recId, newId, title: e.title, type: e.type, isFile: e.isFile, from: e.from, to: e.to, fromDriveId: e.fromDriveId, toDriveId: e.toDriveId, fromRel: e.fromRel, toRel: e.toRel, bytes: e.bytes });
      } catch (err) {
        failed.push({ title: e.title, error: err.message });
      }
      n++;
      if (event && event.sender && !event.sender.isDestroyed()) event.sender.send('move-progress', { n, total: entries.length, title: e.title });
    }
  } finally {
    if (done.length) {
      saveLibrary(lib);
      migrateIds(idMap);
      const touched = new Set(done.flatMap(d => [d.fromDriveId, d.toDriveId]));
      for (const id of touched) { const d = drivesDb.find(x => x.id === id); if (d) refreshSpace(d); }
      saveDrives();
    }
    moveJob = null;
  }
  let batchId = null;
  if (done.length) {
    batchId = `b${Date.now().toString(36)}`;
    const names = [...new Set(done.map(d => d.title))];
    movesLog = [{ id: batchId, at: Date.now(), kind, destDriveId, summary: names.slice(0, 2).join(' · ') + (names.length > 2 ? ` +${names.length - 2} more` : ''), entries: done }, ...movesLog].slice(0, 40);
    saveJson(movesFile, movesLog);
  }
  return { ok: true, batchId, done: done.length, failed };
}

ipcMain.handle('move-plan', async (_e, { ids, destDriveId, fromDriveId } = {}) => {
  await reconcileP;
  const raw = loadLibrary();
  const plan = organize.planMoves(recordsForIds(ids, raw, fromDriveId), mounts, destDriveId);
  const dest = mounts.get(destDriveId);
  const sp = dest ? drives.diskSpace(dest.root) : null;
  const dd = drivesDb.find(d => d.id === destDriveId) || {};
  return {
    ok: true, bytes: plan.bytes, skipped: plan.skipped, free: sp ? sp.free : null, total: sp ? sp.total : null,
    enough: !sp || sp.free >= plan.bytes * 1.02 + 1024 * 1024, destName: dd.nickname || dd.label || '',
    entries: plan.entries.map(e => ({ recId: e.recId, title: e.title, type: e.type, bytes: e.bytes, rel: e.fromRel, fromDriveId: e.fromDriveId }))
  };
});

ipcMain.handle('move-run', async (event, { ids, destDriveId, fromDriveId } = {}) => {
  await reconcileP;
  if (moveJob) return { ok: false, error: 'A move is already running.' };
  const plan = organize.planMoves(recordsForIds(ids, loadLibrary(), fromDriveId), mounts, destDriveId);
  if (!plan.entries.length) return { ok: false, error: 'Nothing can be moved.', skipped: plan.skipped };
  const dest = mounts.get(destDriveId), sp = dest ? drives.diskSpace(dest.root) : null;
  if (sp && sp.free < plan.bytes * 1.02 + 1024 * 1024) return { ok: false, error: 'Not enough free space on the target drive.' };
  const r = await executeBatch(event, plan.entries, { kind: 'move', destDriveId });
  return { ...r, skipped: plan.skipped };
});
ipcMain.handle('cancel-move', () => { if (moveJob) moveJob.cancel = true; return true; });

ipcMain.handle('get-moves', () => {
  const now = Date.now();
  return movesLog.map(b => ({
    id: b.id, at: b.at, kind: b.kind, summary: b.summary, count: b.entries.length,
    fromTo: [...new Set(b.entries.map(e => { const f = drivesDb.find(d => d.id === e.fromDriveId), t = drivesDb.find(d => d.id === e.toDriveId); return `${f ? f.nickname || f.label : '?'} to ${t ? t.nickname || t.label : '?'}`; }))].join(', '),
    undone: !!b.undoneAt, canUndo: !b.undoneAt && now - b.at < UNDO_DAYS * 86400000
  }));
});

ipcMain.handle('move-undo', async (event, { batchId } = {}) => {
  await reconcileP;
  const b = movesLog.find(x => x.id === batchId);
  if (!b || b.undoneAt) return { ok: false, error: 'This move cannot be undone.' };
  if (Date.now() - b.at >= UNDO_DAYS * 86400000) return { ok: false, error: `Undo is only kept for ${UNDO_DAYS} days.` };
  if (moveJob) return { ok: false, error: 'A move is already running.' };
  const need = new Set(b.entries.flatMap(e => [e.fromDriveId, e.toDriveId]));
  const missing = [...need].filter(id => !mounts.has(id));
  if (missing.length) return { ok: false, error: 'Plug in every drive this move touched first.' };
  // each entry is reversed on its own, so a blocked one is reported and the rest still go back
  const entries = [...b.entries].reverse().map(e => ({ ...organize.swap({ ...e, fromRel: e.fromRel, toRel: e.toRel }), recId: e.newId, title: e.title, type: e.type, isFile: e.isFile, bytes: e.bytes, orig: e }));
  moveJob = { cancel: false };
  const deps = moveDeps(event, () => moveJob);
  const failed = [], idMap = new Map();
  let lib = loadLibrary(), back = 0;
  try {
    for (const e of entries) {
      try {
        await organize.runEntry(e, deps);
        const i = lib.findIndex(r => r.id === e.recId);
        if (i >= 0) { const next = { ...lib[i], driveId: e.toDriveId, rel: e.toRel, path: e.to }; const nid = libId(next); next.id = nid; lib[i] = next; if (nid !== e.recId) idMap.set(e.recId, nid); }
        e.orig.undone = true; back++;
      } catch (err) { failed.push({ title: e.title, error: err.message }); }
    }
  } finally {
    if (back) {
      saveLibrary(lib); migrateIds(idMap);
      for (const id of need) { const d = drivesDb.find(x => x.id === id); if (d) refreshSpace(d); }
      saveDrives();
      if (!failed.length) b.undoneAt = Date.now();
      saveJson(movesFile, movesLog);
    }
    moveJob = null;
  }
  return { ok: true, back, failed };
});

// collections whose owned parts sit on different drives, so they can be gathered on one
ipcMain.handle('get-franchise-split', async () => {
  await reconcileP;
  const { lib, ownedMap } = analyze();
  const byId = new Map(lib.map(i => [i.id, i]));
  const driveName = (id) => { const d = drivesDb.find(x => x.id === id); return d ? (d.nickname || d.label || d.root) : '?'; };
  const out = [];
  for (const f of computeFranchises(ownedMap)) {
    const owned = f.parts.filter(p => p.owned && byId.has(p.itemId)).map(p => byId.get(p.itemId)).filter(i => !i.isGroup && i.driveId);
    if (owned.length < 2) continue;
    const per = new Map();
    for (const i of owned) per.set(i.driveId, (per.get(i.driveId) || 0) + 1);
    if (per.size < 2) continue;
    const target = [...per.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const toMove = owned.filter(i => i.driveId !== target);
    out.push({ name: f.name, target, targetName: driveName(target), online: mounts.has(target),
      drives: [...per.entries()].map(([id, n]) => ({ id, name: driveName(id), count: n })),
      ids: toMove.map(i => i.id), count: toMove.length, bytes: toMove.reduce((n, i) => n + (i.size || 0), 0) });
  }
  return out.sort((a, b) => b.count - a.count);
});

// other films of the same franchise that are not on the target drive yet
ipcMain.handle('move-companions', async (_e, { ids, destDriveId } = {}) => {
  await reconcileP;
  const { lib, ownedMap } = analyze();
  const byId = new Map(lib.map(i => [i.id, i]));
  const chosen = new Set(ids || []);
  const out = new Map();
  for (const f of computeFranchises(ownedMap)) {
    const parts = f.parts.filter(p => p.owned && byId.has(p.itemId));
    if (!parts.some(p => chosen.has(p.itemId))) continue;
    for (const p of parts) {
      const it = byId.get(p.itemId);
      if (chosen.has(it.id) || it.isGroup || it.driveId === destDriveId || !it.driveId || out.has(it.id)) continue;
      out.set(it.id, { id: it.id, title: it.displayTitle || it.title, franchise: f.name, bytes: it.size || 0, driveName: it.driveName });
    }
  }
  return [...out.values()];
});

// ---------- junk ----------
let junkCtl = null;
ipcMain.handle('scan-junk', async (_e, { driveId } = {}) => {
  await reconcileP;
  const m = mounts.get(driveId);
  if (!m) return { ok: false, error: 'Plug this drive in first.' };
  if (junkCtl) return { ok: false, error: 'A scan is already running.' };
  junkCtl = {};
  try {
    const skip = loadLibrary().filter(r => r.driveId === driveId && r.type === 'game' && r.path).map(r => r.path);
    const items = await organize.scanJunk(m.root, { skip, ctl: junkCtl });
    return { ok: true, items, bytes: items.reduce((n, i) => n + i.size, 0), capped: items.length >= 3000 };
  } finally { junkCtl = null; }
});
ipcMain.handle('cancel-junk', () => { if (junkCtl) junkCtl.cancel = true; return true; });
ipcMain.handle('trash-junk', async (_e, { driveId, paths } = {}) => {
  await reconcileP;
  const m = mounts.get(driveId);
  if (!m || !Array.isArray(paths)) return { ok: false, error: 'Plug this drive in first.' };
  const res = { ok: true, moved: 0, bytes: 0, skipped: 0, failed: [] };
  // deepest first so an empty folder goes after what was inside it
  for (const p of [...new Set(paths.map(String))].sort((a, b) => b.length - a.length).slice(0, 5000)) {
    if (!organize.inside(m.root, p) || !organize.stillJunk(p)) { res.skipped++; continue; }
    let size = 0; try { size = fs.statSync(p).size; } catch {}
    try { await shell.trashItem(p); res.moved++; res.bytes += size; } catch (e) { res.failed.push({ name: path.basename(p), error: e.message }); }
  }
  const d = drivesDb.find(x => x.id === driveId); if (d) { refreshSpace(d); saveDrives(); }
  return res;
});

// ---------- inbox ----------
function inboxList() {
  const raw = loadLibrary();
  return organize.suggestInbox(raw).filter(s => mounts.has(s.driveId) && !fs.existsSync(path.join(mounts.get(s.driveId).root, s.toRel)) && fs.existsSync(path.join(mounts.get(s.driveId).root, s.fromRel)))
    .map(s => { const d = drivesDb.find(x => x.id === s.driveId) || {}; return { ...s, driveName: d.nickname || d.label || d.root || '' }; });
}
ipcMain.handle('get-inbox', async () => { await reconcileP; return inboxList(); });
ipcMain.handle('inbox-apply', async (event, { ids } = {}) => {
  await reconcileP;
  if (moveJob) return { ok: false, error: 'A move is already running.' };
  const want = new Set(ids || []);
  const entries = inboxList().filter(s => want.has(s.id)).map(s => {
    const root = mounts.get(s.driveId).root;
    return { recId: s.id, title: s.title, type: s.type, isFile: false, fromDriveId: s.driveId, toDriveId: s.driveId, fromRel: s.fromRel, toRel: s.toRel, from: path.join(root, s.fromRel), to: path.join(root, s.toRel), bytes: s.bytes };
  });
  const rec = new Map(loadLibrary().map(r => [r.id, r]));
  entries.forEach(e => { const r = rec.get(e.recId); if (r) e.isFile = !!r.isFile; });
  if (!entries.length) return { ok: false, error: 'Nothing to move.' };
  return executeBatch(event, entries, { kind: 'inbox' });
});

// ---------- sharing: catalog page, labels, phone view ----------
function catalogRows() { return share.rowsOf(decorate(loadLibrary(), { all: true }).filter(i => !(i.type === 'game' && i.gameState !== 'confirmed') && !i.single && !i.video)); }
let phoneServer = null;
function phoneState() {
  const p = settings.phone || {};
  const addrs = share.lanAddresses();
  return { on: !!p.on, running: !!phoneServer, port: p.port || 8787, token: p.token || null, urls: p.token ? addrs.map(a => `http://${a}:${p.port || 8787}/?k=${p.token}`) : [], qrs: p.token && phoneServer ? addrs.slice(0, 3).map(a => share.qrSvg(`http://${a}:${p.port || 8787}/?k=${p.token}`)) : [], qr: p.token && addrs[0] && phoneServer ? share.qrSvg(`http://${addrs[0]}:${p.port || 8787}/?k=${p.token}`) : null };
}
async function startPhone() {
  if (phoneServer) return;
  settings.phone = settings.phone || {};
  if (!settings.phone.token) settings.phone.token = crypto.randomBytes(9).toString('base64url');
  settings.phone.on = true; settings.phone.port = settings.phone.port || 8787;
  phoneServer = await share.startPhoneServer({ getRows: catalogRows, postersDir, token: settings.phone.token, port: settings.phone.port, title: 'My catalog' });
  phoneServer.on('error', () => {});
  saveSettings();
}
function stopPhone() { if (phoneServer) { try { phoneServer.close(); } catch {} phoneServer = null; } }
ipcMain.handle('get-phone', () => phoneState());
// Self-test: can this computer open its own phone link (server up) and is a network address available?
ipcMain.handle('test-phone', async () => {
  const st = phoneState();
  if (!st.running) return { ok: false, step: 'off' };
  if (!st.urls.length) return { ok: false, step: 'network' };
  const get = (u) => new Promise((resolve) => { const r = require('http').get(u, { timeout: 3000 }, (res) => { res.resume(); resolve(res.statusCode); }); r.on('error', () => resolve(0)); r.on('timeout', () => { r.destroy(); resolve(0); }); });
  const local = await get(st.urls[0].replace(/\/\/[^:]+:/, '//127.0.0.1:'));
  const lan = await get(st.urls[0]);
  return { ok: local === 200 && lan === 200, local, lan, urls: st.urls };
});
ipcMain.handle('set-phone', async (_e, { on, regen } = {}) => {
  try {
    if (regen) { stopPhone(); settings.phone = { ...(settings.phone || {}), token: crypto.randomBytes(9).toString('base64url') }; if (settings.phone.on) await startPhone(); saveSettings(); }
    if (on === true) await startPhone();
    if (on === false) { stopPhone(); settings.phone = { ...(settings.phone || {}), on: false }; saveSettings(); }
    return { ok: true, ...phoneState() };
  } catch (e) { stopPhone(); return { ok: false, error: e.code === 'EADDRINUSE' ? 'Port 8787 is already in use.' : e.message, ...phoneState() }; }
});
ipcMain.handle('export-catalog-html', async () => {
  const res = await dialog.showSaveDialog(mainWindow, { title: 'Save the catalog as a web page', defaultPath: path.join(app.getPath('downloads'), 'catalog.html'), filters: [{ name: 'Web page', extensions: ['html'] }] });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try { const rows = catalogRows(); fs.writeFileSync(res.filePath, share.pageHtml(rows, { title: 'My catalog' })); return { ok: true, path: res.filePath, count: rows.length }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('export-labels', async () => {
  const res = await dialog.showSaveDialog(mainWindow, { title: 'Save printable drive labels', defaultPath: path.join(app.getPath('downloads'), 'drive-labels.html'), filters: [{ name: 'Web page', extensions: ['html'] }] });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    const dv = drivesView(), ph = phoneState();
    const base = ph.urls[0] ? ph.urls[0] : null;
    const html = share.labelsHtml(dv.map(d => ({ ...d, counts: [['Movies', d.counts.movie], ['Series', d.counts.series], ['Albums', d.counts.music], ['Games', d.counts.game]].filter(([, n]) => n).map(([l, n]) => `${n} ${l}`).join(' · ') })),
      (d) => base ? `${base}&drive=${encodeURIComponent(d.nickname || d.label || '')}` : `${d.nickname || d.label || 'Drive'}${d.shelf ? ' | ' + d.shelf : ''} | ${d.counts.movie} movies, ${d.counts.series} series`);
    fs.writeFileSync(res.filePath, html);
    return { ok: true, path: res.filePath, count: dv.length, withLink: !!base };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ============================================================
// v2.9: first run, demo catalog, updates, app info
// ============================================================
const demo = require('./demo');
const updates = require('./updates');
const ui = () => (settings.ui = settings.ui || {});
const UI_KEYS = { lang: (v) => (v === 'hi' ? 'hi' : 'en'), updatesOn: (v) => !!v, setupDone: (v) => !!v };

ipcMain.handle('get-app-info', async () => {
  await reconcileP;
  const u = ui();
  const libNow = loadLibrary();
  const hasItems = libNow.length > 0;
  return {
    name: brand.name, tagline: brand.tagline, version: app.getVersion(), dataDir: userData, portable: !!dataInfo.portable,
    repo: brand.releaseRepo || '', lang: u.lang || 'en', updatesOn: !!u.updatesOn, lastCheck: u.lastCheck || 0,
    setupNeeded: !u.setupDone && !hasItems, demoLoaded: libNow.some(r => r.demo), tmdbLogo: fs.existsSync(path.join(__dirname, 'assets', 'tmdb.svg'))
  };
});
ipcMain.handle('set-app-setting', (_e, { key, value } = {}) => {
  if (!UI_KEYS[key]) return { ok: false };
  ui()[key] = UI_KEYS[key](value); saveSettings();
  return { ok: true };
});
ipcMain.handle('open-data-folder', () => { shell.openPath(userData); return true; });

async function checkUpdates({ force = false } = {}) {
  const u = ui();
  if (!force && (!u.updatesOn || Date.now() - (u.lastCheck || 0) < 20 * 3600e3)) return null;
  const r = await updates.checkForUpdate({ repo: brand.releaseRepo, current: app.getVersion(), fetchFn: (url) => net.fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': brand.name } }) });
  if (r.ok) { u.lastCheck = Date.now(); saveSettings(); }
  return r;
}
ipcMain.handle('check-update', async () => (await checkUpdates({ force: true })) || { ok: false, error: 'Not checked.' });
ipcMain.handle('open-release', async (_e, { url } = {}) => {
  // only the release page of the configured repo may be opened from here
  const ok = typeof url === 'string' && brand.releaseRepo && url.startsWith(`https://github.com/${brand.releaseRepo}/`);
  if (ok) await shell.openExternal(url);
  return { ok: !!ok };
});

ipcMain.handle('load-demo', async () => {
  await reconcileP;
  const d = demo.build();
  const lib = loadLibrary().filter(r => !r.demo);
  saveLibrary([...lib, ...d.records]);
  drivesDb = drivesDb.filter(x => !x.demo);
  d.drives.forEach(x => drivesDb.push(x));
  saveDrives();
  ui().setupDone = true; saveSettings();
  return { ok: true, items: d.records.length };
});
ipcMain.handle('clear-demo', async () => {
  await reconcileP;
  const gone = new Set(loadLibrary().filter(r => r.demo).map(r => r.id));
  saveLibrary(loadLibrary().filter(r => !r.demo));
  drivesDb = drivesDb.filter(x => !x.demo);
  saveDrives();
  for (const id of gone) delete marks[id];
  try { writeJsonAtomic(marksFile, marks); } catch {}
  return { ok: true, removed: gone.size };
});

app.whenReady().then(() => { setTimeout(async () => {
  try { const r = await checkUpdates(); if (r && r.ok && r.newer && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-available', r); } catch {}
}, 6000); });
