// Settings & About, the first-run wizard, update notice and start-up.
let appInfo = null;

async function renderSettings() {
  const token = renderToken;
  appInfo = await window.api.getAppInfo();
  if (token !== renderToken) return;
  const a = appInfo;
  content.innerHTML = `
    <div class="page-head"><img src="assets/logo-full.jpg" alt="Sangriva" class="about-logo"><h1>Settings &amp; About</h1><p>${escapeHtml(a.name)} ${escapeHtml(a.version)} · ${escapeHtml(a.tagline)}</p></div>
    <section class="panel"><div class="panel-head"><h2>Language &amp; updates</h2></div>
      <div class="set-row"><span>Interface language</span><select id="stLang" aria-label="Interface language"><option value="en"${a.lang === 'en' ? ' selected' : ''}>English</option><option value="hi"${a.lang === 'hi' ? ' selected' : ''}>हिन्दी (Hindi)</option></select><small class="muted">Menus and main screens. Titles and file names are never translated.</small></div>
      <div class="set-row"><span>Updates</span>${a.repo ? `<label class="fcheck"><input type="checkbox" id="stUpd"${a.updatesOn ? ' checked' : ''}> Tell me when a new version is available</label><button class="secondary small-btn" id="stCheck">Check now</button>` : '<small class="muted">Update checks are not set up in this build.</small>'}</div>
      <div id="stUpdMsg" class="muted pad"></div>
      ${a.repo ? '<small class="muted">Checking contacts GitHub only to read the latest release number. Nothing about you or your files is sent, and nothing is installed without you.</small>' : ''}
    </section>
    <section class="panel"><div class="panel-head"><h2>Your data</h2></div>
      <div class="set-row"><span>Data folder</span><div class="grow"><span class="mono ph-url">${escapeHtml(a.dataDir)}</span><br><small class="muted">${a.portable ? 'Portable mode: everything stays next to the program, so you can carry it on a drive.' : 'To make this portable, put an empty file named <b>portable.flag</b> next to the program and restart.'}</small></div><button class="secondary small-btn" id="stOpen">Open folder</button></div>
      <div class="set-row"><span>Demo catalog</span><div class="grow"><small class="muted">${a.demoLoaded ? 'A made-up catalog is loaded so you can look around.' : 'Load a small made-up catalog to look around before scanning a real drive.'}</small></div>${a.demoLoaded ? '<button class="secondary small-btn" id="stDemoOff">Remove the demo catalog</button>' : '<button class="secondary small-btn" id="stDemoOn">Try the demo catalog</button>'}</div>
      <div class="set-row"><span>Setup</span><div class="grow"><small class="muted">Walk through language, TMDB key and first scan again.</small></div><button class="secondary small-btn" id="stWiz">Run setup again</button></div>
    </section>
    <section class="panel"><div class="panel-head"><h2>Credits</h2></div>
      <p class="muted">${escapeHtml(a.name)} keeps everything on this computer. Your files are only ever moved or sent to the Recycle Bin when you approve it, and are never renamed.</p>
      <ul class="credits">
        <li>Movie and TV information and posters: <b>TMDB</b>. This product uses the TMDB API but is not endorsed or certified by TMDB. (themoviedb.org)</li>
        <li>Game information: the <b>Steam</b> store. Steam and the Steam logo are trademarks of Valve Corporation. This product is not affiliated with Valve.</li>
        <li>QR codes: qrcode-generator by Kazuhiko Arase (MIT licence).</li>
        <li>Built with Electron (MIT licence).</li>
      </ul></section>`;
  $('#stLang').addEventListener('change', async (e) => { await setAppLang(e.target.value); renderSettings(); });
  const u = $('#stUpd'); if (u) u.addEventListener('change', (e) => window.api.setAppSetting({ key: 'updatesOn', value: e.target.checked }));
  const c = $('#stCheck'); if (c) c.addEventListener('click', async () => {
    const m = $('#stUpdMsg'); m.textContent = 'Checking…';
    const r = await window.api.checkUpdate();
    m.innerHTML = !r.ok ? escapeHtml(r.error) : r.newer ? `Version <b>${escapeHtml(r.latest)}</b> is available. <button class="small-btn" id="stGet">Open the download page</button>` : 'You have the latest version.';
    const g = $('#stGet'); if (g) g.addEventListener('click', () => window.api.openRelease({ url: r.url }));
  });
  $('#stOpen').addEventListener('click', () => window.api.openDataFolder());
  const on = $('#stDemoOn'); if (on) on.addEventListener('click', async () => { await window.api.loadDemo(); setLibrary(await window.api.getLibrary()); refreshSideDrives(); setStatus('Demo catalog loaded.'); renderSettings(); });
  const off = $('#stDemoOff'); if (off) off.addEventListener('click', async () => { const r = await window.api.clearDemo(); setLibrary(await window.api.getLibrary()); refreshSideDrives(); setStatus(`Demo catalog removed (${r.removed} items).`); renderSettings(); });
  $('#stWiz').addEventListener('click', () => runWizard());
}

async function setAppLang(lang) {
  prefs.lang = lang === 'hi' ? 'hi' : 'en'; savePrefs();
  await window.api.setAppSetting({ key: 'lang', value: prefs.lang });
  setLanguage(prefs.lang);
}

// ---------- first-run wizard ----------
function runWizard() {
  let dlg = document.getElementById('wizard');
  if (dlg) dlg.remove();
  dlg = document.createElement('dialog'); dlg.id = 'wizard'; dlg.className = 'wizard';
  document.body.appendChild(dlg);
  const steps = ['welcome', 'tmdb', ...(appInfo && appInfo.repo ? ['updates'] : []), 'start'];
  let n = 0, lang = (appInfo && appInfo.lang) || 'en';
  const finish = async () => { await window.api.setAppSetting({ key: 'setupDone', value: true }); dlg.close(); dlg.remove(); };
  const draw = () => {
    const st = steps[n], dots = steps.map((_, i) => `<i class="${i === n ? 'on' : ''}"></i>`).join('');
    let body = '';
    if (st === 'welcome') body = `<img src="assets/logo-mark.png" alt="" class="wz-logo"><h2>Welcome to ${escapeHtml(appInfo.name)}</h2><p>${escapeHtml(appInfo.tagline)}. It catalogs the movies, shows, music and games on your drives, even when the drives are unplugged.</p>
      <p><b>Language</b></p><div class="seg wz-lang"><button data-l="en" class="${lang === 'en' ? 'active' : ''}">English</button><button data-l="hi" class="${lang === 'hi' ? 'active' : ''}">हिन्दी</button></div>`;
    if (st === 'tmdb') body = `<h2>Posters and episode info</h2><p>These come from TMDB, a free service. Paste your free API key here, or skip and add it later with the <b>TMDB Key</b> button. Without a key, the app still catalogs everything.</p>
      <input type="password" id="wzKey" class="wz-input" placeholder="Paste your TMDB key or token" autocomplete="off" spellcheck="false"><div id="wzMsg" class="red-text"></div>`;
    if (st === 'updates') body = `<h2>Updates</h2><p>Tell you when a new version is available? This contacts GitHub only to read the latest release number.</p>
      <label class="fcheck"><input type="checkbox" id="wzUpd"> Yes, tell me about updates</label>`;
    if (st === 'start') body = `<h2>Ready to start</h2><p>Plug in a drive and scan it, or look around with a small made-up catalog first. You can remove the demo any time in Settings.</p>
      <div class="wz-start"><button id="wzScan">Scan my first drive</button><button class="secondary" id="wzDemo">Try the demo catalog</button></div>`;
    dlg.innerHTML = `<div class="wz-body">${body}</div><div class="wz-foot"><span class="wz-dots">${dots}</span><span class="grow"></span>
      <button class="secondary" id="wzSkip">${st === 'start' ? 'Close' : 'Skip setup'}</button>${st === 'start' ? '' : '<button id="wzNext">Next</button>'}</div>`;
    setLanguage(lang === 'hi' ? 'hi' : 'en');
    dlg.querySelectorAll('[data-l]').forEach(b => b.addEventListener('click', async () => { lang = b.dataset.l; await setAppLang(lang); appInfo.lang = lang; draw(); }));
    $('#wzSkip').addEventListener('click', finish);
    const nx = $('#wzNext');
    if (nx) nx.addEventListener('click', async () => {
      if (st === 'tmdb') { const v = $('#wzKey').value.trim(); if (v) { nx.disabled = true; const r = await window.api.setTmdbKey(v); nx.disabled = false; if (!r.ok) { $('#wzMsg').textContent = r.error; return; } keyBtn.classList.remove('attention'); } }
      if (st === 'updates') await window.api.setAppSetting({ key: 'updatesOn', value: $('#wzUpd').checked });
      n++; draw();
    });
    const sc = $('#wzScan'); if (sc) sc.addEventListener('click', async () => { await finish(); $('#scanBtn').click(); });
    const dm = $('#wzDemo'); if (dm) dm.addEventListener('click', async () => { await window.api.loadDemo(); setLibrary(await window.api.getLibrary()); refreshSideDrives(); await finish(); go({ view: 'overview' }, { nav: true }); setStatus('Demo catalog loaded. Remove it any time in Settings & About.'); });
  };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(); });
  dlg.showModal(); draw();
}

// ---------- start-up ----------
async function initApp() {
  try {
    appInfo = await window.api.getAppInfo();
    prefs.lang = appInfo.lang; setLanguage(appInfo.lang);
    if (appInfo.setupNeeded) runWizard();
    window.api.onUpdateAvailable((r) => showUpdateNotice(r));
  } catch (e) { console.error(e); }
}
function showUpdateNotice(r) {
  if (document.getElementById('updNotice')) return;
  const b = document.createElement('div'); b.id = 'updNotice'; b.className = 'banner upd-notice';
  b.innerHTML = `Version <b>${escapeHtml(r.latest)}</b> is available. <button class="small-btn" id="updGet">Download page</button> <button class="secondary small-btn" id="updHide">Later</button>`;
  content.parentNode.insertBefore(b, content);
  $('#updGet').addEventListener('click', () => window.api.openRelease({ url: r.url }));
  $('#updHide').addEventListener('click', () => b.remove());
}
