// Catalog backup / restore. A backup is ONE json file holding the catalog and everything the user decided
// (matches, overrides, wishlist, marks...). Posters and the TMDB cache are not included (they can be fetched again)
// and the TMDB key is never written. Pure functions: no Electron needed.
const fs = require('fs');
const path = require('path');

const FILES = ['library.json', 'drives.json', 'matches.json', 'overrides.json', 'languages.json', 'notshow.json', 'asshow.json',
  'wishlist.json', 'episodenumbers.json', 'durations.json', 'videoassign.json', 'gameflags.json', 'marks.json', 'scanhistory.json',
  'franchises.json', 'safe.json', 'epwatched.json', 'settings.json'];

const stripSecrets = (name, data) => {
  if (name !== 'settings.json' || !data || typeof data !== 'object') return data;
  const o = { ...data };
  for (const k of Object.keys(o)) if (/key|token|secret/i.test(k)) delete o[k];
  return o;
};

function makeBundle(userData, appVersion = '') {
  const files = {};
  for (const f of FILES) {
    try { files[f] = stripSecrets(f, JSON.parse(fs.readFileSync(path.join(userData, f), 'utf8'))); } catch { /* not there yet */ }
  }
  const lib = Array.isArray(files['library.json']) ? files['library.json'] : [];
  return { format: 'hddorg-backup', version: 1, app: appVersion, createdAt: new Date().toISOString(), counts: { items: lib.length, drives: Object.keys(files['drives.json'] || {}).length || (files['drives.json'] || []).length || 0 }, files };
}

function validateBundle(b) {
  if (!b || typeof b !== 'object' || b.format !== 'hddorg-backup') return { ok: false, error: 'This is not a backup file from this app.' };
  if (!b.files || typeof b.files !== 'object') return { ok: false, error: 'The backup has no data in it.' };
  if (b.version > 1) return { ok: false, error: 'This backup was made by a newer version of the app.' };
  const lib = b.files['library.json'];
  if (lib !== undefined && !Array.isArray(lib)) return { ok: false, error: 'The catalog inside the backup is damaged.' };
  for (const k of Object.keys(b.files)) if (!FILES.includes(k)) return { ok: false, error: `Unexpected entry “${k}” in the backup.` };
  return { ok: true };
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Puts a validated backup into userData. The TMDB key in settings.json is kept as it is. Returns the names written. */
function restoreBundle(userData, b) {
  const v = validateBundle(b);
  if (!v.ok) throw new Error(v.error);
  const wrote = [];
  for (const [name, data] of Object.entries(b.files)) {
    let out = data;
    if (name === 'settings.json') {
      let cur = {}; try { cur = JSON.parse(fs.readFileSync(path.join(userData, name), 'utf8')) || {}; } catch {}
      const keep = {}; for (const k of Object.keys(cur)) if (/key|token|secret/i.test(k)) keep[k] = cur[k];
      out = { ...data, ...keep };
    }
    writeAtomic(path.join(userData, name), JSON.stringify(out));
    wrote.push(name);
  }
  return wrote;
}

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** Saves a copy in userData/backups. kind: 'auto' (at most one a day) or 'before' (always; made before Clear Library / Restore). */
function autoBackup(userData, kind = 'auto', appVersion = '') {
  const dir = path.join(userData, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const names = fs.readdirSync(dir).filter(n => n.endsWith('.json'));
  const today = stamp().slice(0, 8);
  if (kind === 'auto' && names.some(n => n.startsWith(`auto-${today}`))) return null;
  const b = makeBundle(userData, appVersion);
  if (!b.counts.items && kind === 'auto') return null; // nothing worth saving yet
  const name = `${kind}-${stamp()}.json`;
  writeAtomic(path.join(dir, name), JSON.stringify(b));
  for (const [prefix, keep] of [['auto-', 7], ['before-', 5]]) {
    const old = fs.readdirSync(dir).filter(n => n.startsWith(prefix) && n.endsWith('.json')).sort().reverse().slice(keep);
    for (const n of old) { try { fs.rmSync(path.join(dir, n)); } catch {} }
  }
  return name;
}

function listBackups(userData) {
  const dir = path.join(userData, 'backups');
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => /^(auto|before)-.*\.json$/.test(n)); } catch { return []; }
  return names.sort().reverse().map(name => {
    let items = null, at = null, size = 0;
    try { const st = fs.statSync(path.join(dir, name)); size = st.size; at = st.mtimeMs; const b = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); items = b.counts ? b.counts.items : null; at = b.createdAt ? Date.parse(b.createdAt) : at; } catch {}
    return { name, kind: name.startsWith('before-') ? 'before' : 'auto', at, size, items };
  });
}

module.exports = { FILES, makeBundle, validateBundle, restoreBundle, autoBackup, listBackups };
