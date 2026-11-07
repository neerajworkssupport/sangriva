// Pure name helpers (no Electron, no disk): clean display titles, game names, quality tags.
// Folder names on the drive are only ever READ. Nothing here renames anything.
const { parseMediaName, norm } = require('./posters');

/** "The.Dark.Knight.2008.1080p.BluRay" -> { title: "The Dark Knight", year: 2008, display: "The Dark Knight (2008)" } */
function displayName(folderName, fallbackYear = null) {
  const p = parseMediaName(folderName);
  const title = p.title || String(folderName || '').replace(/[._]+/g, ' ').trim();
  const year = p.year || fallbackYear || null;
  return { title, year, display: year ? `${title} (${year})` : title };
}

// Repack / scene noise that follows a game's real name
const GAME_JUNK = new RegExp(
  '(?:[\\s._-]+(?:setup|installer|repack|fitgirl|dodi|gog|codex|skidrow|plaza|cpy|flt|razor1911|elamigos|rg\\s*mechanics|multi\\d*|multilingual|' +
  'build[\\s._-]*\\d+|update[\\s._-]*\\d+|v[\\s._-]?\\d+(?:[._]\\d+)*[a-z]?|\\d+(?:\\.\\d+){1,}|pc|win(?:dows)?|x64|x86|dlc.*|incl.*|\\+.*)\\b).*$',
  'i'
);

/** "Cyberpunk.2077.v2.1.Repack-FitGirl" -> { title: "Cyberpunk 2077" } */
function parseGameName(folderName) {
  let s = String(folderName || '').replace(/\[[^\]]*\]/g, ' ').replace(/\((?!\s*(?:19|20)\d{2}\s*\))[^)]*\)/g, ' ');
  s = s.replace(/[._]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const cut = s.replace(GAME_JUNK, '').trim();
  const title = (cut || s).replace(/\s*[-–:,]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();
  const ym = String(folderName || '').match(/\(\s*((?:19|20)\d{2})\s*\)/);
  return { title: title.replace(/\(\s*(?:19|20)\d{2}\s*\)/, '').trim() || s, year: ym ? +ym[1] : null };
}

/**
 * Quality tags from file / folder names.
 * Returns { res: '4K'|'1080p'|'720p'|'SD'|null, tags: ['REMUX','HEVC',...] } (tags are display labels).
 */
function qualityOf(...names) {
  const s = names.filter(Boolean).join(' ').toLowerCase();
  let res = null;
  if (/(2160p|\b4k\b|\buhd\b)/.test(s)) res = '4K';
  else if (/1080p|1080i/.test(s)) res = '1080p';
  else if (/\b720p\b/.test(s)) res = '720p';
  else if (/(480p|576p|\bdvdrip\b|\bdvd\b|\bdvdscr\b|\bcam\b|\bhdtv\b)/.test(s)) res = 'SD';

  const tags = [];
  if (/\bremux\b/.test(s)) tags.push('REMUX');
  else if (/(blu-?ray|bdrip|brrip|\bbd\b)/.test(s)) tags.push('BluRay');
  else if (/(web-?dl|web-?rip|\bweb\b)/.test(s)) tags.push('WEB-DL');
  if (/(x265|hevc|h\.?265)/.test(s)) tags.push('HEVC');
  else if (/\bav1\b/.test(s)) tags.push('AV1');
  if (/(dolby[\s._-]*vision|\bdv\b|hdr10\+?|\bhdr\b)/.test(s)) tags.push('HDR');
  if (/\bimax\b/.test(s)) tags.push('IMAX');
  if (/\b3d\b|\bh-?sbs\b|\bhalf[\s._-]?sbs\b|\bh-?ou\b|\bhalf[\s._-]?ou\b|\bsbs\b/.test(s)) tags.push('3D');
  if (/\bextended\b/.test(s)) tags.push('Extended');
  if (/(director'?s?[\s._-]*cut)/.test(s)) tags.push("Director's Cut");
  if (/\btheatrical\b/.test(s)) tags.push('Theatrical');
  if (/\bunrated\b/.test(s)) tags.push('Unrated');
  return { res, tags };
}

/** Merge two quality results (folder-name tags + file-name tags): the best resolution wins. */
function mergeQuality(a, b) {
  const order = ['SD', '720p', '1080p', '4K'];
  const ra = a && a.res, rb = b && b.res;
  const res = [ra, rb].filter(Boolean).sort((x, y) => order.indexOf(y) - order.indexOf(x))[0] || null;
  const tags = [...new Set([...((a && a.tags) || []), ...((b && b.tags) || [])])];
  return { res, tags };
}

/** Editions and remuxes make two copies genuinely different, even at the same resolution. */
const EDITION_TAGS = new Set(['REMUX', 'Extended', "Director's Cut", 'Theatrical', 'Unrated', 'IMAX', '3D']);
const editionKey = (q) => ((q && q.tags) || []).filter(t => EDITION_TAGS.has(t)).sort().join('+');

module.exports = { displayName, parseGameName, qualityOf, mergeQuality, editionKey, norm };
