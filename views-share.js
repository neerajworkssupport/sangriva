// Look & Share: appearance, phone view, printable labels and the catalog web page.
function applyAppearance() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('hddPrefs') || '{}'); } catch {}
  const root = document.documentElement;
  root.dataset.theme = ['light', 'dark'].includes(p.theme) ? p.theme : 'auto';
  root.dataset.density = p.density === 'compact' ? 'compact' : 'cozy';
  root.style.setProperty('--poster-min', `${Math.min(260, Math.max(120, +p.posterSize || 176))}px`);
}
applyAppearance();

async function renderShare() {
  const token = renderToken;
  const ph = await window.api.getPhone();
  if (token !== renderToken) return;
  const seg = (key, opts, cur) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button data-ap="${key}" data-v="${v}" class="${cur === v ? 'active' : ''}">${l}</button>`).join('')}</div>`;
  content.innerHTML = `
    <div class="page-head"><h1>Look &amp; Share</h1><p>Make the app look the way you like, and take your catalog with you.</p></div>
    <section class="panel"><div class="panel-head"><h2>Appearance</h2></div>
      <div class="set-row"><span>Theme</span>${seg('theme', [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']], prefs.theme || 'auto')}</div>
      <div class="set-row"><span>Spacing</span>${seg('density', [['cozy', 'Comfortable'], ['compact', 'Compact']], prefs.density || 'cozy')}</div>
      <div class="set-row"><span>Poster size</span><input type="range" id="apSize" min="120" max="260" step="10" value="${+prefs.posterSize || 176}" aria-label="Poster size"><small id="apSizeV">${+prefs.posterSize || 176}px</small></div>
    </section>
    <section class="panel"><div class="panel-head"><h2>Phone view</h2><small class="muted">Optional, read-only, off by default</small></div>
      <p class="muted">Shows your catalog in a phone browser on the same Wi-Fi while this app is open. It cannot change or open anything. The link contains a secret key; anyone with the link on your network can browse the list. Windows may ask you to allow it through the firewall.</p>
      <div class="set-row"><label class="fcheck"><input type="checkbox" id="phOn"${ph.running ? ' checked' : ''}> Turn on the phone view</label></div>
      ${ph.running ? `<div class="ph-list">${ph.urls.length ? ph.urls.slice(0, 3).map((u, i) => `<div class="ph-box">${ph.qrs && ph.qrs[i] ? `<div class="ph-qr">${ph.qrs[i]}</div>` : ''}<div class="grow"><small class="muted">${i === 0 ? 'Most likely to work. Scan with the phone camera, or type it in the phone browser:' : 'If the first link does not open, try this one:'}</small><div class="mono ph-url">${escapeHtml(u)}</div></div></div>`).join('') : '<div class="banner">No network address found. Connect this computer to Wi-Fi or a cable, then turn the phone view off and on.</div>'}
        <div class="btn-row"><button class="secondary small-btn" id="phTest">Test it</button><button class="secondary small-btn" id="phCopy">Copy link</button><button class="secondary small-btn" id="phRegen">Make a new key</button></div>
        <div id="phTestOut" class="muted"></div>
        <details class="ph-help"><summary>Phone can't open it?</summary><ol>
          <li>The phone must be on the <b>same Wi-Fi</b> as this computer (not mobile data, not a guest network).</li>
          <li>When Windows asks, tick <b>Private networks</b> and press <b>Allow access</b>. If you missed it: Windows Security → Firewall → Allow an app → Sangriva (or Electron) → Private.</li>
          <li>This app must stay open. The link works only while it runs.</li>
          <li>Wi-Fi marked "Public" in Windows blocks it. Set the network to Private in Settings → Network.</li>
          <li>VPNs and "client isolation" on some routers block phones from reaching computers.</li></ol></details>
        <small class="muted">A new key stops the old link from working.</small></div>` : ''}
      <div id="phErr" class="red-text"></div>
    </section>
    <section class="panel"><div class="panel-head"><h2>Print and export</h2></div>
      <div class="set-row"><div class="grow"><b>Drive labels</b><br><small class="muted">One label per drive with its name, shelf and a QR code. ${ph.running ? 'The QR opens that drive in your phone view.' : 'Turn on the phone view first to make the QR code open the drive; otherwise it holds a short text.'}</small></div><button class="secondary" id="shLabels">Save labels…</button></div>
      <div class="set-row"><div class="grow"><b>Catalog web page</b><br><small class="muted">One searchable page that opens in any browser without the app (no posters).</small></div><button class="secondary" id="shCatalog">Save page…</button></div>
    </section>`;
  const set = (k, v) => { prefs[k] = v; savePrefs(); applyAppearance(); };
  content.querySelectorAll('[data-ap]').forEach(b => b.addEventListener('click', () => { set(b.dataset.ap, b.dataset.v); content.querySelectorAll(`[data-ap="${b.dataset.ap}"]`).forEach(x => x.classList.toggle('active', x === b)); }));
  $('#apSize').addEventListener('input', (e) => { $('#apSizeV').textContent = e.target.value + 'px'; set('posterSize', +e.target.value); });
  $('#phOn').addEventListener('change', async (e) => { const r = await window.api.setPhone({ on: e.target.checked }); if (!r.ok) { renderShare().then(() => { const x = $('#phErr'); if (x) x.textContent = r.error; }); return; } renderShare(); });
  const rg = $('#phRegen'); if (rg) rg.addEventListener('click', async () => { await window.api.setPhone({ regen: true }); renderShare(); });
  const pt = $('#phTest'); if (pt) pt.addEventListener('click', async () => {
    const out = $('#phTestOut'); out.textContent = 'Testing…';
    const r = await window.api.testPhone();
    out.textContent = r.ok ? 'This computer can open the link. If the phone still cannot, it is the Wi-Fi or the Windows firewall (see the help below).'
      : r.step === 'network' ? 'No network address found on this computer.' : r.step === 'off' ? 'The phone view is off.' : 'The server did not answer on this computer. Turn the phone view off and on, or check that port 8787 is free.';
  });
  const cp = $('#phCopy'); if (cp) cp.addEventListener('click', () => { try { navigator.clipboard.writeText(ph.urls[0] || ''); setStatus('Link copied.'); } catch { setStatus('Could not copy. Select the link and copy it.'); } });
  $('#shLabels').addEventListener('click', async () => { const r = await window.api.exportLabels(); if (r.ok) setStatus(`Labels saved: ${r.path}. Open it and use Print.`); else if (!r.canceled) setStatus(r.error); });
  $('#shCatalog').addEventListener('click', async () => { const r = await window.api.exportCatalogHtml(); if (r.ok) setStatus(`Saved ${r.count} titles: ${r.path}`); else if (!r.canceled) setStatus(r.error); });
}
