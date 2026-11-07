// The scanner: walks a drive or folder and turns what it finds into catalog records.
// It is file-based, so a movie can be a folder, a loose file or sit inside a big "All Movies" folder,
// and a TV episode can be anywhere. It only READS the drive.
const fs = require('fs');
const path = require('path');
const { parseMediaName, norm } = require('./posters');
const { displayName, parseGameName, qualityOf } = require('./names');
const { parseEpisodes, parseMusicName } = require('./episodes');
const media = require('./media');
const { gameSignals, EXTRA_DIR, GAME_SUPPORT_DIR, DISC_DIR, pickLooseMovies } = require('./fixups');

const VIDEO_RE = /\.(mkv|mp4|avi|mov|wmv|m4v|ts|webm|mpg|mpeg|m2ts)$/i;
const AUDIO_RE = /\.(mp3|flac|wav|m4a|aac|ogg|opus|wma)$/i;
const IGNORE = new Set(['$RECYCLE.BIN', 'System Volume Information', '.Trashes', '.git', 'node_modules', '.DS_Store', 'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', 'AppData']);
const JUNK_DIR = new RegExp(`(?:${EXTRA_DIR.source})|^(?:subs?|subtitles?|screens?|screenshots?|artwork|covers?)$`, 'i');
const JUNK_FILE = /(^|[\s._-])(sample|trailer)([\s._-]|\.[a-z0-9]+$|$)/i;
const SEASON_DIR_RE = /^(?:(?:season|series)[\s._-]*\d{1,2}|s\d{1,2})(?:\b.*)?$|^specials?$/i;
const GENERIC = new Set(['tv', 'tv shows', 'tv series', 'tvshows', 'tvseries', 'series', 'shows', 'show', 'movies', 'movie', 'films', 'film', 'downloads', 'video', 'videos', 'media', 'new folder', 'anime', 'season', 'seasons', 'episodes', 'complete', 'all movies', 'all series', 'hollywood', 'bollywood']);
const STRONG_EP = [/s\d{1,2}[ ._-]?e\d{1,3}/i, /season[ ._-]*\d{1,2}[^]*?episode[ ._-]*\d{1,3}/i, /(?<!\d)\d{1,2}x\d{2,3}(?!\d)/i];
const LOOSE_VIDEO_MIN = 20 * 1024 * 1024; // smaller than this is not worth listing at all
const LOOSE_MIN = 100 * 1024 * 1024; // a loose video under 100 MB is a clip, not a movie

const readdir = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };

function extractYear(name) {
  const paren = String(name).match(/\(\s*((19|20)\d{2})\s*\)/);
  if (paren) return +paren[1];
  const plain = String(name).match(/\b((19|20)\d{2})\b/);
  return plain ? +plain[1] : null;
}

/** 0..1 similarity of two titles by shared words (cheap; used to decide if a folder is named after its movie). */
function similar(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean)), B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.max(A.size, B.size);
}

const EP_FIRST = /^(?:s\d{1,2}(?:e\d|$)|e\d{1,3}$|ep\d|episode|\d{1,3}$|\d{1,2}x\d)/i;
/** Show title from a file name, or '' when the name starts with the episode marker ("S01E03.mkv", "Episode 4"). */
function fileShow(name) {
  const first = String(name).replace(VIDEO_RE, '').split(/[\s._]+/).filter(Boolean)[0] || '';
  if (!first || EP_FIRST.test(first)) return { title: '', year: null };
  const p = parseMediaName(name);
  return { title: p.title, year: p.year };
}

function seasonFromDirs(names) {
  for (const n of names.slice().reverse()) {
    if (/^specials?$/i.test(n.trim())) return 0;
    const m = n.match(/\b(?:season|series)[\s._-]*(\d{1,2})\b/i) || n.match(/(?:^|[\s._-])s(\d{1,2})(?=[\s._-]|$)/i);
    if (m) return +m[1];
  }
  return null;
}

function showContext(names) {
  for (const n of names.slice().reverse()) {
    const t = n.trim();
    if (!t || SEASON_DIR_RE.test(t) || EXTRA_DIR.test(t) || GENERIC.has(t.toLowerCase())) continue;
    const p = parseMediaName(t);
    if (p.title) return p;
  }
  return null;
}

/**
 * ctx: { driveId, driveRoot, libId(item), tick(), onProgress(count, current), skipped: [] }
 * Returns an array of records: movie (folder or loose file), episode (one per video file), music, game.
 */
async function scanRoot(root, ctx) {
  const { driveId, driveRoot, libId } = ctx;
  const tick = ctx.tick || (() => Promise.resolve());
  const skipped = ctx.skipped || [];
  const now = Date.now();
  const items = [];
  let count = 0;

  const push = (it) => {
    it.driveId = driveId;
    it.rel = path.relative(driveRoot, it.path);
    it.scannedAt = now;
    it.id = libId(it);
    items.push(it);
    count++;
    if (ctx.onProgress && count % 5 === 0) ctx.onProgress(count, path.basename(it.path));
  };
  const relNames = (dir) => path.relative(driveRoot, dir).split(path.sep).filter(Boolean);

  async function walk(dir, depth, inSeries) {
    if (depth > 8) return;
    await tick();
    const entries = readdir(dir);
    const files = entries.filter(e => e.isFile() && !e.name.startsWith('.'));
    const subdirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !IGNORE.has(e.name));
    const base = path.basename(dir);
    const names = relNames(dir);
    const isRoot = depth === 0;

    const hasVideo = files.some(f => VIDEO_RE.test(f.name));
    if (!isRoot && !hasVideo) {
      const audioN = files.filter(f => AUDIO_RE.test(f.name)).length;
      const singlesDir = /^(?:singles?|loose songs?)$/i.test(base.trim());
      if (audioN >= 3 && !singlesDir) {
        const mu = parseMusicName(base, path.basename(path.dirname(dir)));
        const dn = displayName(base, extractYear(base));
        push({
          path: dir, type: 'music', title: mu.album || dn.title, year: mu.year || dn.year, artist: mu.artist, album: mu.album,
          ...(() => { const st = media.folderStats(dir, base); return { size: st.size, fileCount: st.fileCount }; })(),
          tracks: media.listTracks(dir).map(t => ({ name: t.name, rel: t.rel, size: t.size }))
        });
        return;
      }
      // Disc 1 / CD 2 / Vol 1 folders belong to the album folder above them
      const discDirs = subdirs.filter(d => DISC_DIR.test(d.name.trim()));
      if (discDirs.length) {
        const discAudio = discDirs.reduce((n, d) => n + readdir(path.join(dir, d.name)).filter(f => f.isFile() && AUDIO_RE.test(f.name)).length, 0);
        if (discAudio >= 3) {
          const mu = parseMusicName(base, path.basename(path.dirname(dir)));
          const dn = displayName(base, extractYear(base));
          push({
            path: dir, type: 'music', title: mu.album || dn.title, year: mu.year || dn.year, artist: mu.artist, album: mu.album,
            ...(() => { const st = media.folderStats(dir, base); return { size: st.size, fileCount: st.fileCount }; })(),
            tracks: media.listTracks(dir).map(t => ({ name: t.name, rel: t.rel, size: t.size }))
          });
          return;
        }
      }
      // a crack / installer / disc folder is part of its game, never a game of its own
      const isSupport = GAME_SUPPORT_DIR.test(base.trim()) || /s\d{1,2}[\s._-]?e\d{1,3}/i.test(base);
      const supportHasExe = subdirs.some(d => GAME_SUPPORT_DIR.test(d.name.trim()) && readdir(path.join(dir, d.name)).some(f => f.isFile() && /\.exe$/i.test(f.name)));
      if (!isSupport && (files.some(f => /\.exe$/i.test(f.name) && !/unins/i.test(f.name)) || supportHasExe)) {
        const st = media.folderStats(dir, base);
        push({ path: dir, type: 'game', title: parseGameName(base).title, year: extractYear(base), size: st.size, fileCount: st.fileCount, signals: gameSignals(files.map(f => f.name), subdirs.map(d => d.name)) });
        return;
      }
      // one or two songs in a folder that is not an album: each is a "single" under its artist
      const songs = files.filter(f => AUDIO_RE.test(f.name));
      if (songs.length && (songs.length < 3 || singlesDir)) {
        const parent = path.basename(path.dirname(dir));
        for (const f of songs) {
          const full = path.join(dir, f.name);
          let size = 0;
          try { size = fs.statSync(full).size; } catch {}
          const stem = f.name.replace(/\.[^.]+$/, '');
          const parts = stem.split(/\s+[-–]\s+/);
          const artist = parts.length >= 2 ? parts[0].trim() : isGenericFolder(base) ? (isGenericFolder(parent) ? '' : parent) : base;
          push({ path: full, isFile: true, type: 'music', single: true, title: parts.length >= 2 ? parts.slice(1).join(' - ').trim() : stem, artist, size });
        }
      }
    }

    // videos directly in this folder
    const vids = [];
    for (const f of files) {
      if (!VIDEO_RE.test(f.name)) continue;
      const full = path.join(dir, f.name);
      let size = 0;
      try { size = fs.statSync(full).size; } catch {}
      vids.push({ name: f.name, full, size, junk: JUNK_FILE.test(f.name) });
    }
    const real = vids.filter(v => !v.junk);
    const seasonCtx = SEASON_DIR_RE.test(base.trim()) || inSeries;
    const namedSeason = seasonCtx || seasonFromDirs([base]) != null; // "Some Show S01" or "Season 2 1080p"
    const parsed = real.map(v => ({ v, ep: parseEpisodes(v.name), strong: STRONG_EP.some(re => re.test(v.name)) }));
    // "095 - Goku vs Krillin.avi": three or more files numbered 1..N (at least half the videos here) are episodes of this folder's show
    const numbered = parsed.filter(p => p.ep && p.ep.season == null && !p.strong);
    const weakAll = numbered.length >= 3 && numbered.length * 2 >= real.length && new Set(numbered.map(p => p.ep.eps[0])).size === numbered.length;

    const episodes = [], movies = [];
    for (const p of parsed) {
      if (p.ep && (p.strong || seasonCtx || (weakAll && (p.ep.season != null || numbered.includes(p))))) episodes.push(p);
      else if (namedSeason && !p.ep) episodes.push({ v: p.v, ep: { season: null, eps: [] } }); // files without numbers: counted, but "can't check"
      else movies.push(p.v);
    }

    for (const { v, ep } of episodes) {
      try {
        const fs0 = fileShow(v.name);
        const cand = showContext(names);
        let title = ep.eps.length ? fs0.title : '', year = ep.eps.length ? fs0.year : null;
        if (!title) { title = cand ? cand.title : 'Unknown Show'; year = cand ? cand.year : null; }
        else if (!year && cand && norm(cand.title) === norm(title)) year = cand.year;
        const season = ep.season != null ? ep.season : (seasonFromDirs(names) != null ? seasonFromDirs(names) : 1);
        push({
          path: v.full, isFile: true, type: 'episode', showTitle: title, showYear: year || null, showKey: norm(title),
          season, eps: ep.eps, size: v.size, fileCount: 1, quality: qualityOf(v.name), nameIssue: parseMediaName(v.name).yearIssue || null
        });
      } catch (e) { skipped.push(v.full); }
    }

    let becameFolderItem = false;
    if (movies.length && !isRoot && !episodes.length) { // a folder of episodes is never itself a movie
      const hasYear = /\b(?:19|20)\d{2}\b/.test(base);
      const pm = parseMediaName(base);
      const biggest = Math.max(...movies.map(m => m.size));
      const named = hasYear || (similar(pm.title, parseMediaName(movies[0].name).title) >= 0.5 && biggest >= LOOSE_MIN);
      if (movies.length <= 3 && named && !GENERIC.has(base.toLowerCase())) {
        try {
          const dn = displayName(base, extractYear(base));
          const st = media.folderStats(dir, base);
          push({
            path: dir, type: 'movie', title: dn.title, year: dn.year, size: st.size, fileCount: st.fileCount, sig: st.sig,
            fileQuality: st.quality, nameIssue: pm.yearIssue || null
          });
          becameFolderItem = true;
        } catch (e) { skipped.push(dir); }
      }
    }
    if (movies.length && !becameFolderItem) {
      // every loose video of a minimum size
      // clips and non-films are kept too: they show up in the Videos tab, not under Movies
      for (const v of movies) {
        if (v.size < LOOSE_VIDEO_MIN) continue;
        try {
          const b = v.name.replace(/\.[^.]+$/, '');
          const dn = displayName(b, extractYear(b));
          push({
            path: v.full, isFile: true, type: 'movie', title: dn.title, year: dn.year, size: v.size, fileCount: 1,
            sig: `${v.name.toLowerCase()}|${v.size}`, fileQuality: qualityOf(b), nameIssue: parseMediaName(b).yearIssue || null
          });
        } catch (e) { skipped.push(v.full); }
      }
    }

    if (!becameFolderItem && !isRoot && !real.length && /\b(?:19|20)\d{2}\b/.test(base) && !subdirs.some(d => SEASON_DIR_RE.test(d.name.trim()))) {
      try {
        const st = media.folderStats(dir, base);
        const hasEp = media.walkFiles(dir, 3).some(f => VIDEO_RE.test(f.name) && STRONG_EP.some(re => re.test(f.name)));
        if (st.sig && !hasEp) {
          const dn = displayName(base, extractYear(base));
          push({ path: dir, type: 'movie', title: dn.title, year: dn.year, size: st.size, fileCount: st.fileCount, sig: st.sig, fileQuality: st.quality, nameIssue: parseMediaName(base).yearIssue || null });
          becameFolderItem = true;
        }
      } catch (e) { skipped.push(dir); }
    }
    if (becameFolderItem) return; // the rest of the folder (subtitles, extras) belongs to the movie
    const childInSeries = seasonCtx || episodes.length > 0;
    for (const d of subdirs) {
      if (JUNK_DIR.test(d.name)) continue;
      try { await walk(path.join(dir, d.name), depth + 1, childInSeries); } catch (e) { skipped.push(path.join(dir, d.name)); }
    }
  }

  media.startScanCache();
  try { await walk(root, 0, false); } finally { media.endScanCache(); }
  return items;
}

const isGenericFolder = (n) => /^(?:music|albums?|audio|songs?|mp3|flac|itunes|downloads?|singles?|new folder|misc)$/i.test(String(n).trim());
module.exports = { scanRoot, similar, fileShow, showContext, GENERIC, VIDEO_RE, AUDIO_RE, SEASON_DIR_RE };
