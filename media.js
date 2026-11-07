// Disk helpers for media folders: sizes, main video, episode files, tracks, embedded album art.
// Everything here only READS the drive.
const fs = require('fs');
const path = require('path');
const { parseEpisodes } = require('./episodes');
const { qualityOf, mergeQuality } = require('./names');

const VIDEO = /\.(mkv|mp4|avi|mov|wmv|m4v|ts|m2ts|webm|mpg|mpeg)$/i;
const AUDIO = /\.(mp3|flac|wav|m4a|aac|ogg|opus|wma)$/i;
const JUNK_DIR = /^(extras?|featurettes?|samples?|trailers?|bonus.*|behind the scenes|subs?|subtitles?|screens?|screenshots?)$/i;
const JUNK_FILE = /(^|[\s._-])(sample|trailer)([\s._-]|\.[a-z0-9]+$|$)/i;

const readdir = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };

/** Files under dir (depth-limited): [{ full, rel, name, size, junk }] */
let walkCache = null; // while a scan runs, folders are listed (and every file stat'ed) once, not once per question asked of them
const startScanCache = () => { walkCache = new Map(); };
const endScanCache = () => { walkCache = null; };
function walkFiles(dir, maxDepth = 4, limit = 30000) {
  if (!walkCache) return walkFilesRaw(dir, maxDepth, limit);
  const k = `${maxDepth}|${limit}|${dir}`;
  let r = walkCache.get(k);
  if (!r) {
    // a deeper walk of the same folder already holds the answer for a shallower one
    for (const [kk, v] of walkCache) {
      const [md, lm, dd] = [kk.slice(0, kk.indexOf('|')), 0, kk.slice(kk.indexOf('|', kk.indexOf('|') + 1) + 1)];
      if (dd === dir && +md > maxDepth && v.length < limit) { r = v.filter(f => f.rel.split(/[\\/]/).length - 1 <= maxDepth); break; }
    }
    if (!r) r = walkFilesRaw(dir, maxDepth, limit);
    if (walkCache.size >= 300) walkCache.delete(walkCache.keys().next().value);
    walkCache.set(k, r);
  }
  return r;
}
function walkFilesRaw(dir, maxDepth = 4, limit = 30000) {
  const out = [];
  (function rec(d, depth, junk) {
    for (const e of readdir(d)) {
      if (out.length >= limit) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth && !e.name.startsWith('.')) rec(full, depth + 1, junk || JUNK_DIR.test(e.name));
      } else if (e.isFile()) {
        let size = 0;
        try { size = fs.statSync(full).size; } catch {}
        out.push({ full, rel: path.relative(dir, full), name: e.name, size, junk: junk || JUNK_FILE.test(e.name) });
      }
    }
  })(dir, 0, false);
  return out;
}

/** Size, file count, main-video signature and file-name quality for a media folder. */
function folderStats(dir, folderName = path.basename(dir)) {
  const files = walkFiles(dir);
  const videos = files.filter(f => VIDEO.test(f.name));
  const real = videos.filter(f => !f.junk);
  const main = (real.length ? real : videos).slice().sort((a, b) => b.size - a.size)[0] || null;
  const size = files.reduce((n, f) => n + f.size, 0);
  let q = qualityOf(folderName);
  // season packs: look at a few episode names too
  for (const v of real.slice(0, 4)) q = mergeQuality(q, qualityOf(v.name));
  return { size, fileCount: files.length, sig: main ? `${main.name.toLowerCase()}|${main.size}` : null, mainName: main ? main.name : null, quality: q };
}

/** The file to open for "Play" on a movie: biggest non-sample video. */
function pickMainVideo(dir) {
  const videos = walkFiles(dir, 3).filter(f => VIDEO.test(f.name));
  const real = videos.filter(f => !f.junk);
  const pool = real.length ? real : videos;
  pool.sort((a, b) => b.size - a.size);
  return pool[0] ? pool[0].full : null;
}

/** The video file holding episode `number` of `season` for a library series item. */
function findEpisodeFile(item, season, number) {
  // season folders are found by name under the show's current path, so a changed drive letter can't break this
  const folders = (item.seasons || []).filter(s => s.number === season).map(s => (s.name ? path.join(item.path, s.name) : s.path));
  const dirs = folders.length ? folders : [item.path];
  for (const d of dirs) {
    for (const f of walkFiles(d, 2)) {
      if (!VIDEO.test(f.name) || f.junk) continue;
      const r = parseEpisodes(f.name);
      if (!r) continue;
      const s = r.season == null ? season : r.season;
      if (s === season && r.eps.includes(number)) return f.full;
    }
  }
  return null;
}

/** First episode we own, in order (specials last). */
function firstOwnedEpisode(item) {
  const seasons = Object.keys(item.owned || {}).map(Number).sort((a, b) => (a === 0) - (b === 0) || a - b);
  for (const s of seasons) {
    const eps = (item.owned[s] || []).slice().sort((a, b) => a - b);
    if (eps.length) return { season: s, number: eps[0] };
  }
  return null;
}

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Audio tracks of an album folder, in disc/track order: [{ name, rel, size }] */
function listTracks(dir) {
  return walkFiles(dir, 2)
    .filter(f => AUDIO.test(f.name))
    .sort((a, b) => natural(a.rel, b.rel))
    .map(f => ({ name: f.name.replace(AUDIO, '').replace(/^\s*(?:\d{1,2}[-.])?\d{1,3}\s*[-._)]*\s+/, '').replace(/_/g, ' ').trim() || f.name, rel: f.rel, size: f.size }));
}

// ---------- embedded cover art (MP3 / FLAC / M4A), read-only ----------
function imageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}

function readHead(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.slice(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

function id3Art(file) {
  const head = readHead(file, 10);
  if (head.length < 10 || head.toString('latin1', 0, 3) !== 'ID3') return null;
  const ver = head[3];
  const size = Math.min(syncsafe(head, 6), 12 * 1024 * 1024);
  const tag = readHead(file, 10 + size).slice(10);
  let o = 0;
  while (ver >= 3 && o + 10 <= tag.length) {
    const id = tag.toString('latin1', o, o + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = ver === 4 ? syncsafe(tag, o + 4) : tag.readUInt32BE(o + 4);
    const start = o + 10;
    if (len <= 0 || start + len > tag.length) break;
    if (id === 'APIC') {
      const f = tag.slice(start, start + len);
      const enc = f[0];
      let p = 1;
      while (p < f.length && f[p] !== 0) p++; // mime type
      p += 2;                                  // terminator + picture type
      if (enc === 1 || enc === 2) { while (p + 1 < f.length && !(f[p] === 0 && f[p + 1] === 0)) p += 2; p += 2; }
      else { while (p < f.length && f[p] !== 0) p++; p += 1; }
      // some taggers leave the description odd; fall back to scanning for an image header
      let data = f.slice(p);
      let ext = imageType(data);
      if (!ext) {
        const j = f.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
        const k = f.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        const at = j >= 0 ? j : k;
        if (at >= 0) { data = f.slice(at); ext = imageType(data); }
      }
      if (ext) return { data, ext };
    }
    o = start + len;
  }
  return null;
}

function flacArt(file) {
  const buf = readHead(file, 12 * 1024 * 1024);
  if (buf.toString('latin1', 0, 4) !== 'fLaC') return null;
  let o = 4;
  while (o + 4 <= buf.length) {
    const h = buf[o];
    const type = h & 0x7f;
    const len = (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3];
    const s = o + 4;
    if (type === 6 && s + len <= buf.length) {
      let p = s + 4;                       // picture type
      const mimeLen = buf.readUInt32BE(p); p += 4 + mimeLen;
      const descLen = buf.readUInt32BE(p); p += 4 + descLen;
      p += 16;                             // width, height, depth, colours
      const dataLen = buf.readUInt32BE(p); p += 4;
      const data = buf.slice(p, p + dataLen);
      const ext = imageType(data);
      if (ext) return { data, ext };
    }
    if (h & 0x80) break;
    o = s + len;
  }
  return null;
}

function m4aArt(file) {
  const buf = readHead(file, 8 * 1024 * 1024);
  const i = buf.indexOf('covr');
  if (i < 0) return null;
  const d = buf.indexOf('data', i);
  if (d < 0) return null;
  const data = buf.slice(d + 4 + 8); // type(4) + locale(4)
  const ext = imageType(data);
  return ext ? { data, ext } : null;
}

/** Cover art embedded in an audio file, or null: { data: Buffer, ext: 'jpg'|'png' } */
function embeddedArt(file) {
  try {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.mp3') return id3Art(file);
    if (ext === '.flac') return flacArt(file);
    if (ext === '.m4a') return m4aArt(file);
  } catch {}
  return null;
}

/** Try the first few tracks of an album folder for embedded art. */
function albumArt(dir) {
  const tracks = walkFiles(dir, 2).filter(f => AUDIO.test(f.name)).sort((a, b) => natural(a.rel, b.rel)).slice(0, 4);
  for (const t of tracks) {
    const art = embeddedArt(t.full);
    if (art) return art;
  }
  return null;
}

module.exports = { startScanCache, endScanCache, VIDEO, AUDIO, walkFiles, folderStats, pickMainVideo, findEpisodeFile, firstOwnedEpisode, listTracks, embeddedArt, albumArt };
