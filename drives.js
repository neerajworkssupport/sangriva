// Drive identity. A drive is recognised by its volume serial number, not by its letter,
// so "E:" today and "F:" tomorrow are still the same shelf item. Nothing is ever written to the drive.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

/** Output of `vol X:` (any language) -> { serial, label } */
function parseVol(out) {
  const text = String(out || '');
  const serial = (text.match(/\b([0-9A-F]{4}-[0-9A-F]{4})\b/i) || [])[1] || null;
  const label = (text.match(/^\s*Volume in drive \S+ is (.+?)\s*$/im) || [])[1] || '';
  return { serial: serial && serial.toUpperCase(), label };
}

function run(cmd, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

// ---------- default provider (Windows by serial number, others by mount point) ----------
function winRoot(p) {
  const r = path.parse(p).root; // "E:\"
  return r;
}

function unixRoot(p) {
  const m = p.match(/^(\/Volumes\/[^/]+|\/media\/[^/]+\/[^/]+|\/run\/media\/[^/]+\/[^/]+|\/mnt\/[^/]+)/);
  return m ? m[1] : '/';
}

async function winVolume(root) {
  const letter = root.slice(0, 2);
  const out = await run('cmd.exe', ['/d', '/c', 'vol', letter]);
  return parseVol(out);
}

// Windows drive types from WMI: 2 removable, 3 fixed (most external HDDs report this), 4 network, 5 optical
let cim = { letters: '', info: new Map() };
async function winInfo(letters) {
  const key = letters.join('');
  if (cim.letters === key) return cim.info;
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,VolumeSerialNumber,DriveType | ConvertTo-Json -Compress'], 9000);
  const info = new Map();
  try {
    const j = JSON.parse(out);
    for (const r of Array.isArray(j) ? j : [j]) if (r && r.DeviceID) info.set(String(r.DeviceID).slice(0, 1).toUpperCase(), { type: r.DriveType, serial: r.VolumeSerialNumber ? String(r.VolumeSerialNumber).replace(/^(.{4})(.{4})$/, '$1-$2').toUpperCase() : null, label: r.VolumeName || '' });
  } catch {}
  cim = { letters: key, info };
  return info;
}

const defaultProvider = {
  async volumeOf(p) {
    if (process.platform === 'win32') {
      const root = winRoot(p);
      const v = await winVolume(root);
      return { id: v.serial ? `vol:${v.serial}` : `path:${sha1(root.toLowerCase()).slice(0, 12)}`, root, label: v.label || '' };
    }
    const root = unixRoot(p);
    return { id: `path:${sha1(root).slice(0, 12)}`, root, label: path.basename(root) || 'Disk' };
  },

  /** Every drive plugged in right now (system drive and external drives alike): Map(id -> { root, label, kind }) */
  async detectMounts(known) {
    const found = new Map();
    if (process.platform === 'win32') {
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      const present = (await Promise.all(letters.map(async (l) => {
        const r = `${l}:\\`;
        const ok = await Promise.race([fs.promises.access(r).then(() => true, () => false), new Promise(res => setTimeout(() => res(false), 1500))]);
        return ok ? l : null;
      }))).filter(Boolean);
      const info = await winInfo(present);
      const sys = String(process.env.SystemDrive || 'C:').slice(0, 1).toUpperCase();
      await Promise.all(present.map(async (l) => {
        const root = `${l}:\\`;
        const meta = info.get(l) || {};
        if (meta.type === 5 || meta.type === 4) return; // optical / network
        let v = await winVolume(root);
        if (!v.serial && meta.serial) v = { serial: meta.serial, label: v.label || meta.label };
        const id = v.serial ? `vol:${v.serial}` : `path:${sha1(root.toLowerCase()).slice(0, 12)}`;
        if (!found.has(id)) found.set(id, { root, label: v.label || meta.label || '', kind: l === sys ? 'system' : meta.type === 2 ? 'removable' : 'drive' });
      }));
    } else {
      for (const d of known) if (d.root && fs.existsSync(d.root)) found.set(d.id, { root: d.root, label: d.label || '', kind: d.kind || 'drive' });
      // also pick up mounted volumes under the usual mount points
      for (const base of process.env.HDD_NO_AUTODETECT ? [] : ['/Volumes', '/media', '/mnt', '/run/media']) {
        let list = [];
        try { list = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
        for (const e of list) {
          if (!e.isDirectory()) continue;
          const roots = base === '/media' || base === '/run/media'
            ? (() => { try { return fs.readdirSync(path.join(base, e.name), { withFileTypes: true }).filter(x => x.isDirectory()).map(x => path.join(base, e.name, x.name)); } catch { return []; } })()
            : [path.join(base, e.name)];
          for (const root of roots) {
            const id = `path:${sha1(root).slice(0, 12)}`;
            if (!found.has(id)) found.set(id, { root, label: path.basename(root), kind: 'removable' });
          }
        }
      }
      if (process.platform === 'darwin' && !process.env.HDD_NO_AUTODETECT) found.set(`path:${sha1('/').slice(0, 12)}`, { root: '/', label: 'Macintosh HD', kind: 'system' });
    }
    return found;
  }
};

let provider = defaultProvider;
const setProvider = (p) => { provider = p || defaultProvider; };
const volumeOf = (p) => provider.volumeOf(p);
const detectMounts = (known) => provider.detectMounts(known);

/** Replace the old drive root at the start of a path with the new one ("E:\Movies\X" -> "F:\Movies\X"). */
function remapPath(p, oldRoot, newRoot) {
  const norm = (s) => s.replace(/[\\/]+$/, '').toLowerCase();
  if (!oldRoot || !newRoot || norm(oldRoot) === norm(newRoot)) return p;
  const o = norm(oldRoot);
  const lower = p.toLowerCase();
  if (lower !== o && !lower.startsWith(o + '\\') && !lower.startsWith(o + '/')) return p;
  const rest = p.slice(oldRoot.replace(/[\\/]+$/, '').length).replace(/^[\\/]+/, '');
  return rest ? path.join(newRoot, rest) : newRoot;
}

/** Disk size info for a connected root (bytes), or null. */
function diskSpace(root) {
  try {
    const s = fs.statfsSync(root);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

module.exports = { parseVol, remapPath, diskSpace, volumeOf, detectMounts, setProvider, defaultProvider };
