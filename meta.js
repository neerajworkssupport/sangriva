// TMDB metadata with an on-disk cache, so everything keeps working offline after a sync.
// Network access is injected (tmdbGet / downloadImage / queue) which also makes this testable.
const fs = require('fs');
const path = require('path');
const { norm } = require('./posters');

const DAY = 24 * 3600 * 1000;
const DETAILS_TTL = 30 * DAY;
const SEASON_TTL = 14 * DAY;
const PERSON_TTL = 90 * DAY;
const COLLECTION_TTL = 14 * DAY;

function createMeta({ dir, tmdbGet, getKey, queue, downloadImage }) {
  const sub = (n) => path.join(dir, n);
  for (const n of ['details', 'seasons', 'people', 'collections', 'universes', 'img']) fs.mkdirSync(sub(n), { recursive: true });

  const readJson = (file, fb = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fb; } };
  const writeJson = (file, data) => { const tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file); };
  const fresh = (obj, ttl) => !!obj && Date.now() - (obj.fetchedAt || 0) < ttl;
  const key = () => getKey();
  const get = (p, params) => queue(() => tmdbGet(p, params, key()));

  // ---------- id map: poster-cache key -> TMDB id ----------
  const idsFile = path.join(dir, 'ids.json');
  const ids = readJson(idsFile, {});
  let idsTimer = null;
  const getId = (k) => ids[k] || null;
  const setId = (k, v) => {
    ids[k] = { tmdbId: v.tmdbId, mediaType: v.mediaType, at: Date.now() };
    clearTimeout(idsTimer);
    idsTimer = setTimeout(flush, 500);
  };
  const clearId = (k) => { delete ids[k]; clearTimeout(idsTimer); idsTimer = setTimeout(flush, 500); };
  const flush = () => { clearTimeout(idsTimer); idsTimer = null; try { writeJson(idsFile, ids); } catch (e) { console.error('ids save', e.message); } };

  // ---------- details (movie / tv) ----------
  const details = new Map(); // "movie:123" -> trimmed payload
  let loaded = false;
  const ensureLoaded = () => {
    if (loaded) return;
    loaded = true;
    for (const f of fs.readdirSync(sub('details'))) {
      if (!f.endsWith('.json')) continue;
      const d = readJson(path.join(sub('details'), f));
      if (d && d.id && d.type) details.set(`${d.type}:${d.id}`, d);
    }
  };

  const castOf = (raw) => ((raw.credits && raw.credits.cast) || []).slice(0, 14).map(c => ({ id: c.id, name: c.name, character: c.character || '', photo: c.profile_path || null }));
  const yearOf = (s) => parseInt(String(s || '').slice(0, 4), 10) || null;

  function trim(type, raw) {
    const base = {
      id: raw.id, type,
      title: raw.title || raw.name, year: yearOf(raw.release_date || raw.first_air_date),
      overview: raw.overview || '', genres: (raw.genres || []).map(g => g.name),
      rating: raw.vote_average ? Math.round(raw.vote_average * 10) / 10 : null, votes: raw.vote_count || 0,
      language: raw.original_language || null,
      cast: castOf(raw), fetchedAt: Date.now()
    };
    if (type === 'movie') {
      const crew = (raw.credits && raw.credits.crew) || [];
      return {
        ...base, runtime: raw.runtime || null, tagline: raw.tagline || '',
        collection: raw.belongs_to_collection ? { id: raw.belongs_to_collection.id, name: raw.belongs_to_collection.name } : null,
        directors: crew.filter(c => c.job === 'Director').slice(0, 3).map(c => ({ id: c.id, name: c.name }))
      };
    }
    const ep = (e) => (e ? { season_number: e.season_number, episode_number: e.episode_number, air_date: e.air_date || null, name: e.name || '' } : null);
    return {
      ...base, status: raw.status || '', runtime: (raw.episode_run_time || [])[0] || null,
      seasons: (raw.seasons || []).map(s => ({ season_number: s.season_number, episode_count: s.episode_count || 0, air_date: s.air_date || null, name: s.name || '' })),
      last_episode_to_air: ep(raw.last_episode_to_air), next_episode_to_air: ep(raw.next_episode_to_air),
      creators: (raw.created_by || []).slice(0, 3).map(c => ({ id: c.id, name: c.name }))
    };
  }

  function cachedDetails(type, id) { ensureLoaded(); return details.get(`${type}:${id}`) || null; }

  async function getDetails(type, id, { refresh = false } = {}) {
    ensureLoaded();
    const have = details.get(`${type}:${id}`);
    if (have && !refresh && fresh(have, DETAILS_TTL)) return have;
    const raw = await get(`/${type}/${id}`, { append_to_response: 'credits' });
    const d = trim(type, raw);
    details.set(`${type}:${id}`, d);
    writeJson(path.join(sub('details'), `${type}-${id}.json`), d);
    return d;
  }

  // ---------- seasons ----------
  async function getSeason(tvId, n) {
    const file = path.join(sub('seasons'), `tv-${tvId}-${n}.json`);
    const have = readJson(file);
    if (fresh(have, SEASON_TTL)) return have;
    const raw = await get(`/tv/${tvId}/season/${n}`, {});
    const s = {
      id: tvId, season: n, name: raw.name || '', fetchedAt: Date.now(),
      episodes: (raw.episodes || []).map(e => ({ number: e.episode_number, name: e.name || '', air_date: e.air_date || null, runtime: e.runtime || null, overview: e.overview || '' }))
    };
    writeJson(file, s);
    return s;
  }
  const cachedSeason = (tvId, n) => readJson(path.join(sub('seasons'), `tv-${tvId}-${n}.json`));

  // ---------- people ----------
  async function getPerson(id) {
    const file = path.join(sub('people'), `${id}.json`);
    const have = readJson(file);
    if (fresh(have, PERSON_TTL)) return have;
    const raw = await get(`/person/${id}`, { append_to_response: 'combined_credits' });
    const seen = new Map();
    const add = (c, role) => {
      if (!c || !c.id || (c.media_type !== 'movie' && c.media_type !== 'tv')) return;
      const k = `${c.media_type}:${c.id}`;
      if (seen.has(k)) { if (role && !seen.get(k).roles.includes(role)) seen.get(k).roles.push(role); return; }
      seen.set(k, { type: c.media_type, id: c.id, title: c.title || c.name, year: yearOf(c.release_date || c.first_air_date), roles: [role].filter(Boolean), poster: c.poster_path || null, popularity: c.popularity || 0 });
    };
    const cc = raw.combined_credits || {};
    (cc.cast || []).forEach(c => add(c, c.character || 'Actor'));
    (cc.crew || []).filter(c => ['Director', 'Creator', 'Writer', 'Screenplay'].includes(c.job)).forEach(c => add(c, c.job));
    const p = {
      id, name: raw.name, photo: raw.profile_path || null, department: raw.known_for_department || '',
      birthday: raw.birthday || null, place: raw.place_of_birth || '', bio: String(raw.biography || '').slice(0, 1400),
      credits: [...seen.values()].sort((a, b) => b.popularity - a.popularity).slice(0, 150), fetchedAt: Date.now()
    };
    writeJson(file, p);
    return p;
  }
  const cachedPerson = (id) => readJson(path.join(sub('people'), `${id}.json`));

  // ---------- collections & universes ----------
  async function getCollection(id) {
    const file = path.join(sub('collections'), `${id}.json`);
    const have = readJson(file);
    if (fresh(have, COLLECTION_TTL)) return have;
    const raw = await get(`/collection/${id}`, {});
    const c = {
      id, name: raw.name || '', fetchedAt: Date.now(),
      parts: (raw.parts || []).map(p => ({ id: p.id, title: p.title, year: yearOf(p.release_date), release_date: p.release_date || null, poster: p.poster_path || null }))
        .sort((a, b) => (a.release_date || '9').localeCompare(b.release_date || '9'))
    };
    writeJson(file, c);
    return c;
  }
  const cachedCollection = (id) => readJson(path.join(sub('collections'), `${id}.json`));

  const slug = (s) => norm(s).replace(/\s+/g, '-');
  /** def: { name, keyword } -> movies carrying that TMDB keyword (e.g. "marvel cinematic universe (mcu)") */
  async function getUniverse(def) {
    const file = path.join(sub('universes'), `${slug(def.name)}.json`);
    const have = readJson(file);
    if (fresh(have, COLLECTION_TTL) && have.v === 2) return have;
    const found = await get('/search/keyword', { query: def.keyword });
    const want = norm(def.keyword);
    const list = found.results || [];
    const kw = list.find(k => norm(k.name) === want) || list.find(k => norm(k.name).includes(want)) || null;
    if (!kw) { const miss = { name: def.name, keywordId: null, parts: [], v: 2, fetchedAt: Date.now() }; writeJson(file, miss); return miss; }
    const parts = [];
    for (let page = 1; page <= 4; page++) {
      const r = await get('/discover/movie', { with_keywords: kw.id, sort_by: 'primary_release_date.asc', include_adult: 'false', page });
      for (const m of r.results || []) parts.push({ id: m.id, type: 'movie', title: m.title, year: yearOf(m.release_date), release_date: m.release_date || null, poster: m.poster_path || null });
      if (page >= (r.total_pages || 1)) break;
    }
    // TV series that carry the same keyword belong to the same franchise
    try {
      for (let page = 1; page <= 2; page++) {
        const r = await get('/discover/tv', { with_keywords: kw.id, sort_by: 'first_air_date.asc', include_adult: 'false', page });
        for (const t of r.results || []) parts.push({ id: t.id, type: 'tv', title: t.name, year: yearOf(t.first_air_date), release_date: t.first_air_date || null, poster: t.poster_path || null });
        if (page >= (r.total_pages || 1)) break;
      }
    } catch (e) { if (e && e.status === 401) throw e; }
    const u = { name: def.name, keywordId: kw.id, parts, v: 2, fetchedAt: Date.now() };
    writeJson(file, u);
    return u;
  }
  const cachedUniverse = (def) => readJson(path.join(sub('universes'), `${slug(def.name)}.json`));

  // ---------- images (cast photos etc.), cached so they work offline ----------
  const imgName = (p, size) => `${size}${String(p).replace(/[^a-z0-9.]+/gi, '_')}`;
  const imageUrl = (p, size = 'w185') => (p && fs.existsSync(path.join(sub('img'), imgName(p, size))) ? `poster://img/${imgName(p, size)}` : null);
  async function ensureImage(p, size = 'w185') {
    if (!p) return null;
    const have = imageUrl(p, size);
    if (have) return have;
    try {
      await queue(() => downloadImage(size, p, path.join(sub('img'), imgName(p, size))));
      return imageUrl(p, size);
    } catch {
      return null;
    }
  }

  // ---------- people index (names seen in cached cast lists) ----------
  function searchPeople(q, limit = 6) {
    ensureLoaded();
    const w = norm(q);
    if (!w) return [];
    const seen = new Map();
    for (const d of details.values()) {
      for (const c of [...d.cast, ...(d.directors || []), ...(d.creators || [])]) {
        if (!c.id || seen.has(c.id)) continue;
        if (norm(c.name).includes(w)) seen.set(c.id, { id: c.id, name: c.name, photo: c.photo || null });
      }
    }
    return [...seen.values()].slice(0, limit);
  }

  return {
    getId, setId, clearId, flush, ensureLoaded,
    getDetails, cachedDetails, allDetails: () => { ensureLoaded(); return [...details.values()]; },
    getSeason, cachedSeason, getPerson, cachedPerson,
    getCollection, cachedCollection, getUniverse, cachedUniverse,
    imageUrl, ensureImage, searchPeople
  };
}

module.exports = { createMeta };
