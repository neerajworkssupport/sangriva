// Opt-in update check against GitHub Releases. It only looks; it never downloads or installs by itself.
const semver = (v) => String(v || '').replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
function isNewer(latest, current) {
  const a = semver(latest), b = semver(current);
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) > (b[i] || 0)) return true; if ((a[i] || 0) < (b[i] || 0)) return false; }
  return false;
}
/** fetchFn(url) -> { ok, status, json() }. Returns { ok, newer, latest, url, notes } or { ok:false, error } */
async function checkForUpdate({ repo, current, fetchFn }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.+$)[\w.-]+$/.test(String(repo || ''))) return { ok: false, error: 'No release page is set up for this build yet.' };
  try {
    const r = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`);
    if (r.status === 404) return { ok: false, error: 'No published release was found.' };
    if (!r.ok) return { ok: false, error: `GitHub answered ${r.status}.` };
    const j = await r.json();
    const tag = j.tag_name || j.name || '';
    return { ok: true, newer: isNewer(tag, current), latest: String(tag).replace(/^v/i, ''), url: j.html_url || `https://github.com/${repo}/releases`, notes: String(j.body || '').slice(0, 1200) };
  } catch (e) { return { ok: false, error: 'Could not reach GitHub. Check your internet connection.' }; }
}
module.exports = { isNewer, checkForUpdate };
