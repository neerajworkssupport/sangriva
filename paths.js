// Where the catalog is kept: portable folder next to the program, the old folder from earlier versions, or the normal one.
const fs = require('fs');
const path = require('path');
const brand = require('./brand');

/**
 * { dir, portable, why }. Order: portable (a portable.flag file or the portable build) > existing old folder > new folder.
 * env: process.env, exeDir: folder holding the program, appData: %APPDATA%
 */
function resolveDataDir({ env = process.env, exeDir, appData }) {
  const flagDirs = [env.PORTABLE_EXECUTABLE_DIR, exeDir].filter(Boolean);
  for (const d of flagDirs) {
    try { if (fs.existsSync(path.join(d, 'portable.flag')) || (d === env.PORTABLE_EXECUTABLE_DIR)) return { dir: path.join(d, `${brand.name}Data`), portable: true, why: 'portable' }; } catch {}
  }
  const legacy = path.join(appData, brand.legacyDataDir);
  try { if (fs.existsSync(legacy)) return { dir: legacy, portable: false, why: 'existing' }; } catch {}
  return { dir: path.join(appData, brand.name), portable: false, why: 'new' };
}
module.exports = { resolveDataDir };
