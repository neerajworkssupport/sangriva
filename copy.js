// Safe folder copy between drives: copy to a temporary name, verify every file, then rename into place.
// The original is never touched here. Deleting it is a separate, explicit step.
const fs = require('fs');
const path = require('path');

/** { files: Map(rel -> size), dirs: [rel], bytes } for a folder tree */
function treeOf(root) {
  const files = new Map();
  const dirs = [];
  let bytes = 0;
  (function rec(d) {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      const rel = path.relative(root, full);
      if (e.isDirectory()) { dirs.push(rel); rec(full); }
      else if (e.isFile()) {
        let size = 0;
        try { size = fs.statSync(full).size; } catch {}
        files.set(rel, size);
        bytes += size;
      }
    }
  })(root);
  return { files, dirs, bytes };
}

/** { ok, reason } — same files with the same sizes in both folders */
function verifyTrees(a, b) {
  const ta = treeOf(a), tb = treeOf(b);
  if (ta.files.size !== tb.files.size) return { ok: false, reason: `file count differs (${ta.files.size} vs ${tb.files.size})` };
  for (const [rel, size] of ta.files) {
    if (!tb.files.has(rel)) return { ok: false, reason: `missing: ${rel}` };
    if (tb.files.get(rel) !== size) return { ok: false, reason: `size differs: ${rel}` };
  }
  return { ok: true, files: ta.files.size, bytes: ta.bytes };
}

class CopyError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function copyFolderVerified(src, dest, { onProgress, isCancelled, freeBytes = null, _beforeVerify } = {}) {
  if (!fs.existsSync(src)) throw new CopyError('nosource', 'The source folder is not available.');
  if (fs.existsSync(dest)) throw new CopyError('exists', 'A folder with this name already exists on the target drive.');
  const tmp = `${dest}.copying`;
  if (fs.existsSync(tmp)) throw new CopyError('leftover', 'A half-finished copy from an earlier attempt is in the way. Delete the folder ending in “.copying” on the target drive and try again.');

  const tree = treeOf(src);
  if (freeBytes != null && freeBytes < tree.bytes * 1.02 + 1024 * 1024) {
    throw new CopyError('space', 'Not enough free space on the target drive.');
  }

  const cleanup = async () => { try { await fs.promises.rm(tmp, { recursive: true, force: true }); } catch {} };
  try {
    await fs.promises.mkdir(tmp, { recursive: true });
    for (const d of tree.dirs) await fs.promises.mkdir(path.join(tmp, d), { recursive: true });
    let done = 0, doneBytes = 0;
    for (const [rel, size] of tree.files) {
      if (isCancelled && isCancelled()) throw new CopyError('cancelled', 'Copy cancelled.');
      const from = path.join(src, rel), to = path.join(tmp, rel);
      await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL);
      try { const st = fs.statSync(from); fs.utimesSync(to, st.atime, st.mtime); } catch {}
      done++; doneBytes += size;
      if (onProgress) onProgress({ files: done, totalFiles: tree.files.size, bytes: doneBytes, totalBytes: tree.bytes, current: rel });
    }
    if (_beforeVerify) await _beforeVerify(tmp);
    const v = verifyTrees(src, tmp);
    if (!v.ok) throw new CopyError('verify', `The copy did not match the original (${v.reason}). Nothing was kept.`);
    await fs.promises.rename(tmp, dest);
    return { files: v.files, bytes: v.bytes };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

/** { ok, reason } — two single files with the same size */
function verifyFiles(a, b) {
  let sa, sb;
  try { sa = fs.statSync(a).size; sb = fs.statSync(b).size; } catch { return { ok: false, reason: 'file missing' }; }
  return sa === sb ? { ok: true, files: 1, bytes: sa } : { ok: false, reason: `size differs (${sa} vs ${sb})` };
}

/** Same safety as the folder copy, for one loose file: temporary name, size check, then rename. */
async function copyFileVerified(src, dest, { onProgress, isCancelled, freeBytes = null, _beforeVerify } = {}) {
  if (!fs.existsSync(src)) throw new CopyError('nosource', 'The source file is not available.');
  if (fs.existsSync(dest)) throw new CopyError('exists', 'A file with this name already exists on the target drive.');
  const tmp = `${dest}.copying`;
  if (fs.existsSync(tmp)) throw new CopyError('leftover', 'A half-finished copy from an earlier attempt is in the way. Delete the file ending in “.copying” on the target drive and try again.');
  const size = fs.statSync(src).size;
  if (freeBytes != null && freeBytes < size * 1.02 + 1024 * 1024) throw new CopyError('space', 'Not enough free space on the target drive.');
  try {
    if (isCancelled && isCancelled()) throw new CopyError('cancelled', 'Copy cancelled.');
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(src, tmp, fs.constants.COPYFILE_EXCL);
    try { const st = fs.statSync(src); fs.utimesSync(tmp, st.atime, st.mtime); } catch {}
    if (onProgress) onProgress({ files: 1, totalFiles: 1, bytes: size, totalBytes: size, current: path.basename(src) });
    if (_beforeVerify) await _beforeVerify(tmp);
    const v = verifyFiles(src, tmp);
    if (!v.ok) throw new CopyError('verify', `The copy did not match the original (${v.reason}). Nothing was kept.`);
    await fs.promises.rename(tmp, dest);
    return { files: 1, bytes: size };
  } catch (e) {
    try { await fs.promises.rm(tmp, { force: true }); } catch {}
    throw e;
  }
}

module.exports = { treeOf, verifyTrees, verifyFiles, copyFolderVerified, copyFileVerified, CopyError };
