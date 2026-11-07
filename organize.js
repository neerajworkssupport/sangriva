// v2.8: move planner, junk finder and inbox suggestions. Files are only ever MOVED, never renamed:
// the last part of every path stays exactly as it was. Anything removed goes to the Recycle Bin.
const fs = require('fs');
const path = require('path');

const inside = (root, p) => { const r = path.resolve(root), q = path.resolve(p); return q !== r && q.startsWith(r.endsWith(path.sep) ? r : r + path.sep); };
const cleanRel = (rel) => { const s = String(rel == null ? '' : rel); return s && !path.isAbsolute(s) && !s.split(/[\\/]/).includes('..') ? s : null; };
const swap = (e) => ({ ...e, from: e.to, to: e.from, fromRel: e.toRel, toRel: e.fromRel, fromDriveId: e.toDriveId, toDriveId: e.fromDriveId });

/** Plan moving library records to another drive, keeping the same folder structure. mounts: Map(id -> {root}) */
function planMoves(records, mounts, destDriveId) {
  const dest = mounts.get(destDriveId);
  const entries = [], skipped = [];
  const seen = new Set();
  for (const r of records) {
    const title = r.title || r.showTitle || path.basename(r.path || '') || 'Unknown';
    if (!dest) { skipped.push({ title, reason: 'The target drive is not plugged in.' }); continue; }
    const rel = cleanRel(r.rel);
    if (!r.driveId || rel == null || !r.path) { skipped.push({ title, reason: 'Not linked to a drive yet. Scan its drive again.' }); continue; }
    if (r.driveId === destDriveId) { skipped.push({ title, reason: 'Already on that drive.' }); continue; }
    const from = mounts.get(r.driveId);
    if (!from) { skipped.push({ title, reason: 'Its drive is not plugged in.' }); continue; }
    const src = path.join(from.root, rel), to = path.join(dest.root, rel);
    if (seen.has(src)) continue; seen.add(src);
    if (!fs.existsSync(src)) { skipped.push({ title, reason: 'Not found on the drive any more.' }); continue; }
    if (fs.existsSync(to)) { skipped.push({ title, reason: 'A file or folder with that name is already on the target drive.' }); continue; }
    entries.push({ recId: r.id, title, type: r.type, isFile: !!r.isFile, fromDriveId: r.driveId, toDriveId: destDriveId, fromRel: rel, toRel: rel, from: src, to, bytes: r.size || 0 });
  }
  return { entries, skipped, bytes: entries.reduce((n, e) => n + e.bytes, 0) };
}

/**
 * Do one move. Same drive: rename (instant). Other drive: verified copy, then the original goes to the Recycle Bin.
 * deps: { copy(e), verify(e), trash(path) }
 */
async function runEntry(e, deps) {
  if (!fs.existsSync(e.from)) throw new Error('The original is not there any more.');
  if (fs.existsSync(e.to)) throw new Error('Something with that name is already at the destination.');
  if (e.fromDriveId === e.toDriveId) {
    fs.mkdirSync(path.dirname(e.to), { recursive: true });
    fs.renameSync(e.from, e.to);
    return;
  }
  await deps.copy(e);
  const v = deps.verify(e);
  if (!v.ok) throw new Error(`The copy did not match the original (${v.reason}). Nothing was deleted.`);
  await deps.trash(e.from);
}

// ---------- junk ----------
const VIDEO = /\.(mkv|mp4|avi|mov|m4v|wmv|mpg|mpeg|ts|webm)$/i;
const SKIP_DIRS = /^(\$recycle\.bin|system volume information|recycler|found\.\d+)$/i;
const JUNK_NAMES = /^(thumbs\.db|desktop\.ini|\.ds_store|rarbg_do_not_mirror\.exe)$/i;
const JUNK_EXT = /\.(!ut|part|crdownload|torrent|url)$/i;
const RELEASE_NOTE = /^(rarbg|yify|yts|ettv|eztv|www\.|torrent downloaded|downloaded from).*\.(txt|nfo|jpg|png|html?)$/i;

/** Why a file or folder counts as junk, or null. size is in bytes. */
function classifyJunk(name, size, isDir, entryCount = 1) {
  if (isDir) {
    if (SKIP_DIRS.test(name)) return null;
    return entryCount === 0 ? 'Empty folder' : null;
  }
  if (JUNK_NAMES.test(name)) return 'System or site leftover';
  if (JUNK_EXT.test(name)) return /\.(part|crdownload|!ut)$/i.test(name) ? 'Unfinished download' : 'Torrent or shortcut leftover';
  if (RELEASE_NOTE.test(name)) return 'Release-site note';
  if (VIDEO.test(name) && /(^|[\W_])sample([\W_]|$)/i.test(name) && size < 150 * 1024 * 1024) return 'Sample clip';
  return null;
}

/** Walk a drive and list junk. skip: absolute folders never to look inside (game folders). */
async function scanJunk(root, { skip = [], max = 3000, maxDepth = 8, ctl = {} } = {}) {
  const out = [];
  const skips = skip.map(s => path.resolve(s));
  let n = 0;
  const walk = async (dir, depth) => {
    if (ctl.cancel || out.length >= max || depth > maxDepth) return;
    if (skips.some(s => path.resolve(dir) === s || path.resolve(dir).startsWith(s + path.sep))) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (++n % 200 === 0) await new Promise(r => setImmediate(r));
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.test(e.name)) continue;
        await walk(full, depth + 1);
        let kids = null; try { kids = fs.readdirSync(full); } catch {}
        if (kids && kids.length === 0 && depth > 0) out.push({ path: full, size: 0, isDir: true, reason: 'Empty folder' });
      } else if (e.isFile()) {
        let size = 0; try { size = fs.statSync(full).size; } catch {}
        const why = classifyJunk(e.name, size, false);
        if (why) out.push({ path: full, size, isDir: false, reason: why });
      }
    }
  };
  await walk(root, 0);
  return out;
}

/** The file is still junk right now (checked again just before it goes to the Recycle Bin). */
function stillJunk(p) {
  let st; try { st = fs.statSync(p); } catch { return false; }
  const name = path.basename(p);
  if (st.isDirectory()) { let k = []; try { k = fs.readdirSync(p); } catch { return false; } return classifyJunk(name, 0, true, k.length) != null; }
  return classifyJunk(name, st.size, false) != null;
}

// ---------- inbox ----------
const INBOX = /^(inbox|incoming|new|unsorted|download|downloads|to ?sort|to ?watch|temp|tmp|misc)$/i;
const topOf = (rel) => String(rel).split(/[\\/]/)[0];

/** Folders sitting in an inbox-like place (or the drive root) that belong with the others of their kind. Suggestions only. */
function suggestInbox(records) {
  const byDrive = new Map();
  for (const r of records) {
    if (!r.driveId || r.rel == null || !r.path || r.single || r.type === 'episode' || !['movie', 'music', 'game'].includes(r.type)) continue;
    (byDrive.get(r.driveId) || byDrive.set(r.driveId, []).get(r.driveId)).push(r);
  }
  const out = [];
  for (const [driveId, recs] of byDrive) {
    const isInbox = (r) => { const parts = String(r.rel).split(/[\\/]/).filter(Boolean); return parts.length === 1 || INBOX.test(parts[0]); };
    const homes = {};
    for (const r of recs) {
      if (isInbox(r)) continue;
      const parts = String(r.rel).split(/[\\/]/).filter(Boolean);
      if (parts.length < 2) continue;
      const h = (homes[r.type] ||= {}); h[parts[0]] = (h[parts[0]] || 0) + 1;
    }
    for (const r of recs) {
      if (!isInbox(r)) continue;
      const h = homes[r.type]; if (!h) continue;
      const top = Object.entries(h).sort((a, b) => b[1] - a[1])[0][0];
      const base = path.basename(String(r.rel));
      const toRel = path.join(top, base);
      if (toRel === r.rel) continue;
      out.push({ id: r.id, title: r.title || base, type: r.type, driveId, fromRel: r.rel, toRel, bytes: r.size || 0 });
    }
  }
  return out;
}

module.exports = { inside, cleanRel, swap, planMoves, runEntry, classifyJunk, scanJunk, stillJunk, suggestInbox };
