// Series -> Season -> Episode: groups episode FILES (from any folder, any drive, loose or not) under one show.
// Pure functions over library records. Nothing here touches a drive.
const path = require('path');
const { norm } = require('./posters');
const { mergeQuality, qualityOf } = require('./names');

const showKey = (title) => norm(title);

/** Episode file records -> one entity per show: { key, title, year, owned, seasons, byDrive, ... } */
function buildSeries(records, idFor) {
  const shows = new Map();
  for (const r of records) {
    if (r.type !== 'episode') continue;
    const k = r.showKey || showKey(r.showTitle);
    if (!k) continue;
    let e = shows.get(k);
    if (!e) {
      e = { key: k, titles: new Map(), years: new Map(), recs: [] };
      shows.set(k, e);
    }
    e.recs.push(r);
    e.titles.set(r.showTitle, (e.titles.get(r.showTitle) || 0) + 1);
    if (r.showYear) e.years.set(r.showYear, (e.years.get(r.showYear) || 0) + 1);
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0];
  const out = [];
  for (const [k, e] of shows) {
    const owned = {}, bySeasonFiles = {}, parsedBySeason = {}, byDrive = {};
    let size = 0, quality = null, scannedAt = 0, addedAt = Infinity;
    for (const r of e.recs) {
      for (const n of r.eps || []) {
        const set = (owned[r.season] = owned[r.season] || []);
        if (!set.includes(n)) set.push(n);
      }
      const fc = r.fileCount || 1; // a record from an older folder-based scan stands for several files
      bySeasonFiles[r.season] = (bySeasonFiles[r.season] || 0) + fc;
      if ((r.eps || []).length) parsedBySeason[r.season] = (parsedBySeason[r.season] || 0) + (r.parsedCount != null ? r.parsedCount : 1);
      size += r.size || 0;
      quality = mergeQuality(quality, r.quality || null);
      scannedAt = Math.max(scannedAt, r.scannedAt || 0);
      addedAt = Math.min(addedAt, r.addedAt || r.scannedAt || Infinity);
      const d = (byDrive[r.driveId || ''] = byDrive[r.driveId || ''] || { owned: {}, size: 0, files: 0 });
      d.size += r.size || 0;
      d.files += fc;
      for (const n of r.eps || []) {
        const set = (d.owned[r.season] = d.owned[r.season] || []);
        if (!set.includes(n)) set.push(n);
      }
    }
    for (const s of Object.keys(owned)) owned[s].sort((a, b) => a - b);
    for (const d of Object.values(byDrive)) for (const s of Object.keys(d.owned)) d.owned[s].sort((a, b) => a - b);
    const title = top(e.titles)[0];
    const yr = e.years.size ? top(e.years)[0] : null;
    const seasonNums = [...new Set([...Object.keys(owned), ...Object.keys(bySeasonFiles)].map(Number))].sort((a, b) => a - b);
    const primary = Object.entries(byDrive).sort((a, b) => b[1].files - a[1].files)[0][0];
    out.push({
      id: idFor(`series|${k}`), type: 'series', key: k, title, year: yr, path: '', rel: null, isGroup: true,
      driveId: primary || null, drives: Object.keys(byDrive).filter(Boolean),
      owned, byDrive, size, fileQuality: quality || { res: null, tags: [] }, fileCount: e.recs.reduce((n, r) => n + (r.fileCount || 1), 0),
      seasonStats: Object.fromEntries(seasonNums.map(s => [s, { files: bySeasonFiles[s] || 0, parsed: parsedBySeason[s] || 0 }])),
      seasons: seasonNums.map(n => ({ number: n, name: n === 0 ? 'Specials' : `Season ${n}`, episodes: (owned[n] || []).length || bySeasonFiles[n] || 0 })),
      episodes: seasonNums.reduce((n, s) => n + ((owned[s] || []).length || bySeasonFiles[s] || 0), 0),
      scannedAt, addedAt: Number.isFinite(addedAt) ? addedAt : scannedAt,
      asShowIds: e.recs.map(r => r.asShowId).filter(Boolean)
    });
  }
  return out;
}

/** Show name/year/key of an old folder-based series record (v1.3 and earlier: one record per folder). */
function legacyShow(i) {
  const { showContext } = require('./scanner');
  if (i.showTitleOverride) return { title: i.showTitleOverride, year: i.showYearOverride || i.year || null, key: showKey(i.showTitleOverride) };
  const names = String(i.rel || '').split(/[\\/]/).filter(Boolean);
  const ctx = showContext(names) || showContext([path.basename(i.path || '')]);
  const title = ctx && ctx.title ? ctx.title : '';
  if (!showKey(title)) return null;
  return { title, year: (ctx && ctx.year) || i.year || null, key: showKey(title) };
}

/** Old per-folder series records -> per-season episode-like records, so they merge into one show entry. */
function legacyRecords(i, show) {
  const owned = i.owned || {}, stats = i.seasonStats || {};
  const seasons = [...new Set([...Object.keys(owned), ...Object.keys(stats)].map(Number))].sort((a, b) => a - b);
  if (!seasons.length) seasons.push(1);
  const recs = [];
  seasons.forEach((sn, idx) => {
    const st = stats[sn] || {}, eps = (owned[sn] || []).slice();
    const files = st.files || eps.length || (idx === 0 ? (i.fileCount || 1) : 0);
    if (!files && recs.length) return;
    recs.push({
      type: 'episode', legacy: true, path: i.path, rel: i.rel, driveId: i.driveId, isFile: false,
      showTitle: show.title, showYear: show.year, showKey: show.key, season: sn, eps,
      size: idx === 0 ? (i.size || 0) : 0, fileCount: files || 1, parsedCount: st.parsed != null ? st.parsed : eps.length,
      quality: idx === 0 ? mergeQuality(qualityOf(path.basename(i.path || '')), i.fileQuality || null) : null,
      scannedAt: i.scannedAt, addedAt: i.addedAt, asShowId: i.asShowId || null
    });
  });
  return recs;
}

/**
 * Older scans stored "095 - Goku vs Krillin.avi" as loose movies. When three or more numbered files sit in one folder
 * (and make up most of its loose videos) they are really episodes of the show named by that folder: turn them into
 * episode records without needing a rescan.
 */
function promoteNumberedFiles(raw) {
  const { parseEpisodes } = require('./episodes');
  const { showContext } = require('./scanner');
  const groups = new Map();
  for (const i of raw) {
    if (i.type !== 'movie' || !i.isFile || !i.path || i.notShowKey) continue;
    const k = `${i.driveId || ''}|${path.dirname(i.path)}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(i);
  }
  const promote = new Map(); // id -> episode record
  for (const [, list] of groups) {
    const numbered = list.map(i => ({ i, ep: parseEpisodes(path.basename(i.path)) }))
      .filter(x => x.ep && x.ep.season == null && !/s\d{1,2}[ ._-]?e\d/i.test(path.basename(x.i.path)));
    if (numbered.length < 3 || numbered.length * 2 < list.length) continue;
    if (new Set(numbered.map(x => x.ep.eps[0])).size !== numbered.length) continue;
    const names = String(numbered[0].i.rel || '').split(/[\\/]/).filter(Boolean).slice(0, -1);
    const ctx = showContext(names);
    if (!ctx || !ctx.title) continue;
    for (const { i, ep } of numbered) {
      promote.set(i, {
        id: i.id, path: i.path, rel: i.rel, driveId: i.driveId, isFile: true, type: 'episode',
        showTitle: ctx.title, showYear: ctx.year || null, showKey: showKey(ctx.title), season: 1, eps: ep.eps,
        size: i.size, fileCount: 1, quality: i.fileQuality || i.quality || null, scannedAt: i.scannedAt, addedAt: i.addedAt, promoted: true
      });
    }
  }
  if (!promote.size) return raw;
  return raw.map(i => promote.get(i) || i);
}

/** Library with episode records folded into show entities (everything else untouched). */
function withSeries(raw, idFor) {
  const { isExtraEpisode } = require('./fixups');
  raw = promoteNumberedFiles(raw).filter(i => !isExtraEpisode(i));
  const eps = raw.filter(i => i.type === 'episode');
  const rest = [];
  for (const i of raw) {
    if (i.type === 'episode') continue;
    if (i.type === 'series' && !i.isGroup) { // old one-record-per-folder show: folded into the show entry (works while the drive is offline)
      const show = legacyShow(i);
      if (show) { eps.push(...legacyRecords(i, show)); continue; }
    }
    rest.push(i);
  }
  if (!eps.length) return rest;
  return rest.concat(buildSeries(eps, idFor));
}

/**
 * Episodes that sit outside their season's main folder.
 * records: episode file records; online(driveId) -> bool.
 * Returns [{ id, showKey, title, season, number, name, from, fromDrive, toDir, toDrive, sameDrive, state }]
 *   state: 'ok' | 'exists' (same file name already in the target) | 'dup' (that episode is already in the main folder) | 'offline'
 */
function tidyPlan(records, online = () => true) {
  const bySeason = new Map();
  for (const r of records) {
    if (r.type !== 'episode' || !r.path) continue;
    const k = `${r.showKey}|${r.season}`;
    (bySeason.get(k) || bySeason.set(k, []).get(k)).push(r);
  }
  const rows = [];
  for (const [, list] of bySeason) {
    const dirs = new Map(); // "drive|dir" -> records
    for (const r of list) {
      const dk = `${r.driveId || ''}|${path.dirname(r.path)}`;
      (dirs.get(dk) || dirs.set(dk, []).get(dk)).push(r);
    }
    if (dirs.size < 2) continue;
    // the main folder = the one holding most of this season; a "Season N" folder wins ties, then an online drive
    const seasonLike = (dk) => /season|series|^s\d{1,2}$/i.test(path.basename(dk.split('|').slice(1).join('|')));
    const ranked = [...dirs.entries()].sort((a, b) =>
      b[1].length - a[1].length ||
      (seasonLike(b[0]) - seasonLike(a[0])) ||
      (online(b[1][0].driveId) - online(a[1][0].driveId)) ||
      a[0].localeCompare(b[0]));
    const [homeKey, homeRecs] = ranked[0];
    const toDir = path.dirname(homeRecs[0].path), toDrive = homeRecs[0].driveId || null;
    const have = new Set();
    homeRecs.forEach(r => (r.eps || []).forEach(n => have.add(n)));
    const homeNames = new Set(homeRecs.map(r => path.basename(r.path).toLowerCase()));
    for (const [dk, recs] of ranked.slice(1)) {
      for (const r of recs) {
        const sameDrive = (r.driveId || null) === toDrive;
        const base = path.basename(r.path);
        let state = 'ok';
        if ((r.eps || []).every(n => have.has(n))) state = 'dup';
        else if (homeNames.has(base.toLowerCase())) state = 'exists';
        else if (!online(r.driveId) || !online(toDrive)) state = 'offline';
        rows.push({
          id: r.id, showKey: r.showKey, title: r.showTitle, season: r.season, number: (r.eps || [])[0], count: (r.eps || []).length,
          name: base, from: r.path, fromDrive: r.driveId || null, toDir, toDrive, sameDrive, state, size: r.size || null
        });
      }
    }
  }
  rows.sort((a, b) => a.title.localeCompare(b.title) || a.season - b.season || a.number - b.number);
  return rows;
}

module.exports = { showKey, buildSeries, withSeries, tidyPlan, promoteNumberedFiles, legacyShow };
