// A small made-up catalog so a new user can look around before scanning a real drive. Nothing here touches any real file.
const crypto = require('crypto');
const id = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const GB = 1024 ** 3;

const DRIVES = [
  { id: 'demo:1', label: 'Demo Movies', nickname: 'Demo Movies', root: '(demo)', shelf: 'Shelf A, row 1', total: 4000 * GB, used: 3100 * GB, free: 900 * GB },
  { id: 'demo:2', label: 'Demo Archive', nickname: 'Demo Archive', root: '(demo)', shelf: 'Shelf B, row 2', total: 2000 * GB, used: 1400 * GB, free: 600 * GB }
];
const MOVIES = [
  ['Inception', 2010, '1080p', 0], ['The Dark Knight', 2008, '2160p', 0], ['Interstellar', 2014, '2160p', 0], ['Parasite', 2019, '1080p', 1],
  ['Spirited Away', 2001, '1080p', 1], ['Heat', 1995, '1080p', 0], ['Dune', 2021, '2160p', 0], ['Dune Part Two', 2024, '2160p', 0],
  ['Whiplash', 2014, '1080p', 1], ['The Prestige', 2006, '1080p', 0], ['Oldboy', 2003, '720p', 1], ['Blade Runner 2049', 2017, '2160p', 0],
  ['Mad Max Fury Road', 2015, '1080p', 1], ['Coco', 2017, '1080p', 1], ['Arrival', 2016, '1080p', 0], ['Inception', 2010, '720p', 1]
];
const SHOWS = [['Breaking Bad', 2008, 2, 4], ['The Office', 2005, 1, 5]];
const ALBUMS = [['Pink Floyd', 'The Dark Side of the Moon'], ['A. R. Rahman', 'Roja'], ['Queen', 'A Night at the Opera']];

function build() {
  const now = Date.now();
  const recs = [];
  MOVIES.forEach(([t, y, res, d], n) => {
    const drive = DRIVES[d].id, rel = `Movies/${t} (${y}) ${res}`;
    recs.push({ id: id(`${drive}|${rel}`), type: 'movie', title: t, year: y, driveId: drive, rel, path: `(demo)/${rel}`, size: (res === '2160p' ? 55 : res === '1080p' ? 12 : 5) * GB, fileCount: 2, scannedAt: now - n * 3600e3, addedAt: now - n * 86400e3, demo: true });
  });
  SHOWS.forEach(([t, y, seasons, eps], si) => {
    const key = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    for (let s = 1; s <= seasons; s++) for (let e = 1; e <= eps; e++) {
      const rel = `TV/${t} (${y})/Season ${s}/${t}.S0${s}E0${e}.1080p.mkv`, drive = DRIVES[si].id;
      recs.push({ id: id(`${drive}|${rel}`), type: 'episode', showTitle: t, showYear: y, showKey: key, season: s, eps: [e], title: `${t} S0${s}E0${e}`, driveId: drive, rel, path: `(demo)/${rel}`, isFile: true, size: 1.4 * GB, fileCount: 1, scannedAt: now, addedAt: now - si * 86400e3, demo: true });
    }
  });
  ALBUMS.forEach(([artist, title]) => {
    const rel = `Music/${artist}/${title}`;
    recs.push({ id: id(`demo:2|${rel}`), type: 'music', artist, title, driveId: 'demo:2', rel, path: `(demo)/${rel}`, size: 0.4 * GB, fileCount: 10, scannedAt: now, addedAt: now, demo: true });
  });
  return { drives: DRIVES.map(d => ({ ...d, lastSeen: now, firstSeen: now, demo: true })), records: recs };
}
module.exports = { build };
