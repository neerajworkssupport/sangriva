// Copy safety, drive health and the read-only broken-file check. Pure functions (no Electron), so they can be tested alone.
const fs = require('fs');
const path = require('path');

const DAY = 24 * 3600 * 1000;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** One key per "thing you own": the same movie in two qualities, or a show on two drives, is one thing with several copies. */
function copyKey(i) {
  if (i.type === 'movie') return i.versionKey || `n:${norm(i.title)}|${i.year || ''}`;
  if (i.type === 'series') return `s:${i.key || i.id}`;
  if (i.type === 'music') return `a:${norm(i.artist)}|${norm(i.title)}`;
  if (i.type === 'game') return `g:${norm(i.title)}`;
  return null;
}

/**
 * lib = decorated library (not split per drive). drives = [{id,name,online}]. safe = Set of keys the user marked as backed up elsewhere.
 * A title is "single" when it exists on one drive only and is not marked safe.
 */
function analyzeSafety(lib, drives, safe = new Set()) {
  const groups = new Map();
  for (const i of lib) {
    if (i.single || i.video || !i.driveId && !(i.isGroup && i.byDrive)) continue;
    const key = copyKey(i); if (!key) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { key, title: i.displayTitle || i.title, type: i.type, res: '', drives: new Map() });
    const parts = i.isGroup && i.byDrive ? Object.entries(i.byDrive).map(([d, b]) => [d, b.size || 0]) : [[i.driveId, i.size || 0]];
    for (const [d, size] of parts) {
      const cur = g.drives.get(d) || { size: 0, id: i.id };
      cur.size += size; g.drives.set(d, cur);
    }
    const r = i.quality && i.quality.res; if (r && !g.res) g.res = r;
  }
  const names = new Map(drives.map(d => [d.id, d]));
  const perDrive = new Map(drives.map(d => [d.id, { id: d.id, name: d.name, online: d.online, items: 0, unsafe: 0, unsafeBytes: 0 }]));
  const unsafeByDrive = {};
  let single = 0, multi = 0, markedSafe = 0;
  for (const g of groups.values()) {
    const ids = [...g.drives.keys()];
    const isSafe = ids.length > 1 || safe.has(g.key);
    if (ids.length > 1) multi++; else if (safe.has(g.key)) markedSafe++; else single++;
    for (const d of ids) {
      const row = perDrive.get(d); if (!row) continue;
      row.items++;
      if (!isSafe) {
        const c = g.drives.get(d);
        row.unsafe++; row.unsafeBytes += c.size;
        (unsafeByDrive[d] = unsafeByDrive[d] || []).push({ id: c.id, key: g.key, title: g.title, type: g.type, size: c.size, res: g.res });
      }
    }
  }
  for (const d of Object.keys(unsafeByDrive)) unsafeByDrive[d] = unsafeByDrive[d].sort((a, b) => b.size - a.size).slice(0, 60);
  const total = groups.size;
  return { total, single, multi, markedSafe, drives: [...perDrive.values()].filter(d => d.items).sort((a, b) => b.unsafe - a.unsafe), unsafeByDrive };
}

/** Appends one used-space sample per day (max 90). */
function sampleHistory(d, now = Date.now()) {
  if (!d || !d.total || d.free == null) return false;
  const h = d.usedHistory = Array.isArray(d.usedHistory) ? d.usedHistory : [];
  const last = h[h.length - 1];
  if (last && now - last[0] < 20 * 3600 * 1000) return false;
  h.push([now, d.total - d.free]);
  if (h.length > 90) h.splice(0, h.length - 90);
  return true;
}

/** Days until the drive is full, from the growth between the oldest and newest sample (needs 14+ days of history and real growth). */
function forecast(d, now = Date.now()) {
  const h = (d && d.usedHistory) || [];
  if (h.length < 2 || !d.total || d.free == null) return null;
  const [t0, u0] = h[0], [t1, u1] = h[h.length - 1];
  const days = (t1 - t0) / DAY;
  if (days < 14) return null;
  const perDay = (u1 - u0) / days;
  if (perDay < 50 * 1024 * 1024 / 30) return { perDay: Math.max(0, perDay), daysLeft: null }; // under ~50 MB a month: not growing
  return { perDay, daysLeft: Math.round(d.free / perDay) };
}

function staleInfo(d, now = Date.now(), online = false) {
  const seen = d.lastSeen || 0, scan = d.lastScan || 0;
  const daysSeen = seen ? Math.floor((now - seen) / DAY) : null;
  const daysScan = scan ? Math.floor((now - scan) / DAY) : null;
  return { daysSeen, daysScan, stale: !online && daysSeen != null && daysSeen >= 90, unscanned: daysScan != null ? daysScan >= 90 : seen > 0 };
}

// ----- broken files (read only) -----
const VIDEO = /\.(mkv|mp4|avi|mov|wmv|m4v|ts|webm|mpg|mpeg|m2ts)$/i;
const AUDIO = /\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i;
function headerOk(file, buf) {
  const ext = path.extname(file).toLowerCase();
  const at = (s, o = 0) => buf.length >= o + s.length && buf.slice(o, o + s.length).toString('latin1') === s;
  if (ext === '.mkv' || ext === '.webm') return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  if (ext === '.mp4' || ext === '.m4v' || ext === '.mov' || ext === '.m4a') return ['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip', 'pnot'].some(t => at(t, 4));
  if (ext === '.avi') return at('RIFF') && at('AVI', 8);
  if (ext === '.flac') return at('fLaC') || at('ID3');
  if (ext === '.wav') return at('RIFF') && at('WAVE', 8);
  return true; // other formats: not checked
}

/** Checks one file. Returns a reason string or null. */
function checkFile(file) {
  const isV = VIDEO.test(file), isA = AUDIO.test(file);
  if (!isV && !isA) return null;
  let st;
  try { st = fs.statSync(file); } catch { return { reason: 'missing', size: null }; }
  if (st.size === 0) return { reason: 'empty', size: 0 };
  if (st.size < (isV ? 64 * 1024 : 8 * 1024)) return { reason: 'tiny', size: st.size };
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    if (!headerOk(file, buf)) return { reason: 'header', size: st.size };
  } catch { return { reason: 'unreadable', size: st.size }; } finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
  return null;
}

/** Walks the paths (files or folders, 4 levels deep) and reports broken media files. cb(count,current) for progress; ctl.cancel stops it. */
async function scanBroken(paths, { cb, ctl = {}, max = 500, maxFiles = 200000 } = {}) {
  const bad = [];
  let n = 0;
  const tick = () => new Promise(r => setImmediate(r));
  const visit = async (p, depth, owner) => {
    if (ctl.cancel || bad.length >= max || n >= maxFiles) return;
    let st; try { st = fs.statSync(p); } catch { if (depth === 0 && (VIDEO.test(p) || AUDIO.test(p))) bad.push({ ...owner, path: p, reason: 'missing', size: null }); return; }
    if (st.isDirectory()) {
      if (depth >= 4) return;
      let kids = []; try { kids = fs.readdirSync(p); } catch { bad.push({ ...owner, path: p, reason: 'unreadable', size: null }); return; }
      for (const k of kids) await visit(path.join(p, k), depth + 1, owner);
    } else {
      n++;
      const r = checkFile(p);
      if (r) bad.push({ ...owner, path: p, ...r });
      if (n % 25 === 0) { if (cb) cb(n, p); await tick(); }
    }
  };
  for (const o of paths) await visit(o.path, 0, { itemId: o.id, title: o.title });
  return { bad, checked: n, canceled: !!ctl.cancel, capped: bad.length >= max };
}

module.exports = { copyKey, analyzeSafety, sampleHistory, forecast, staleInfo, checkFile, scanBroken };
