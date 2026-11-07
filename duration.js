// Video length from the file header only (a few KB read, never the whole file). Read-only.
const fs = require('fs');

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return n === len ? b : b.subarray(0, n);
}

/** MP4 / MOV / M4V: walk the top-level boxes to "moov", then read "mvhd". */
function mp4Duration(fd, size) {
  let pos = 0;
  for (let guard = 0; guard < 64 && pos + 8 <= size; guard++) {
    const h = readAt(fd, pos, 16);
    if (h.length < 8) return null;
    let len = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    let hdr = 8;
    if (len === 1 && h.length >= 16) { len = Number(h.readBigUInt64BE(8)); hdr = 16; }
    else if (len === 0) len = size - pos;
    if (len < hdr) return null;
    if (type === 'moov') return mvhd(fd, pos + hdr, Math.min(pos + len, size));
    pos += len;
  }
  return null;
}
function mvhd(fd, start, end) {
  let pos = start;
  for (let guard = 0; guard < 64 && pos + 8 <= end; guard++) {
    const h = readAt(fd, pos, 8);
    if (h.length < 8) return null;
    const len = h.readUInt32BE(0), type = h.toString('latin1', 4, 8);
    if (len < 8) return null;
    if (type === 'mvhd') {
      const b = readAt(fd, pos + 8, 32);
      const ver = b[0];
      if (ver === 1 && b.length >= 32) return Number(b.readBigUInt64BE(24)) / b.readUInt32BE(20);
      if (b.length >= 20) { const ts = b.readUInt32BE(12); return ts ? b.readUInt32BE(16) / ts : null; }
      return null;
    }
    pos += len;
  }
  return null;
}

// ---- Matroska / WebM ----
function vint(buf, i, keepMarker) {
  const first = buf[i];
  if (!first) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || i + len > buf.length) return null;
  let val = keepMarker ? first : first & (0xff >> len);
  for (let k = 1; k < len; k++) val = val * 256 + buf[i + k];
  return { val, len };
}
function mkvDuration(fd) {
  const buf = readAt(fd, 0, 262144);
  const INFO = Buffer.from([0x15, 0x49, 0xa9, 0x66]);
  const at = buf.indexOf(INFO);
  if (at < 0) return null;
  const sz = vint(buf, at + 4, false);
  if (!sz) return null;
  let p = at + 4 + sz.len;
  const end = Math.min(buf.length, p + sz.val);
  let scale = 1000000, dur = null;
  while (p < end) {
    const id = vint(buf, p, true); if (!id) break;
    const s = vint(buf, p + id.len, false); if (!s) break;
    const body = p + id.len + s.len;
    if (id.val === 0x2ad7b1) { let v = 0; for (let k = 0; k < s.val; k++) v = v * 256 + buf[body + k]; scale = v; }
    else if (id.val === 0x4489) dur = s.val === 8 ? buf.readDoubleBE(body) : s.val === 4 ? buf.readFloatBE(body) : null;
    p = body + s.val;
  }
  return dur != null ? (dur * scale) / 1e9 : null;
}

// ---- AVI ----
function aviDuration(fd) {
  const b = readAt(fd, 0, 64);
  if (b.length < 56 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'AVI ') return null;
  if (b.toString('latin1', 24, 28) !== 'avih') return null;
  const micro = b.readUInt32LE(32), frames = b.readUInt32LE(48);
  return micro && frames ? (micro * frames) / 1e6 : null;
}

/** Seconds, or null when the format is not understood. */
function videoDuration(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const head = readAt(fd, 0, 12);
    let sec = null;
    if (head.toString('latin1', 0, 4) === 'RIFF') sec = aviDuration(fd);
    else if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) sec = mkvDuration(fd);
    else if (head.length >= 8 && /^(ftyp|moov|mdat|free|wide|skip)$/.test(head.toString('latin1', 4, 8))) sec = mp4Duration(fd, size);
    return sec && isFinite(sec) && sec > 0 ? Math.round(sec) : null;
  } catch { return null; }
  finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
}

const fmtDuration = (sec) => {
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m} min` : `${sec}s`;
};

module.exports = { videoDuration, fmtDuration };
