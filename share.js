// v2.8: printable drive labels, a single-file HTML catalog, and the optional read-only phone view.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
let qrcode = null;
try { qrcode = require('./qrlib'); } catch { /* the QR library is optional: labels fall back to text */ }

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function qrSvg(text, cell = 4) {
  if (!qrcode) return '';
  const q = qrcode(0, 'M'); q.addData(String(text)); q.make();
  return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}

/** Plain rows used by the catalog page and the phone view. */
function rowsOf(items) {
  return items.filter(i => ['movie', 'series', 'music', 'game'].includes(i.type)).map(i => ({
    id: i.id, t: i.displayTitle || i.title || '', y: i.year || '', ty: i.type,
    q: (i.quality && i.quality.res && i.quality.res !== 'Unknown') ? i.quality.res : '',
    d: i.driveName || '', s: i.shelf || '', on: !!i.online, sz: i.size || 0,
    p: i.poster ? path.basename(String(i.poster).split('?')[0]) : '', g: (i.genres || []).join(', '), w: i.watched ? 1 : 0
  }));
}

const PAGE_CSS = `*{box-sizing:border-box}body{margin:0;font-family:system-ui,"Segoe UI",sans-serif;background:#f7f8fc;color:#0f172a}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e5e8f0;padding:10px 14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;z-index:2}
h1{font-size:18px;margin:0 8px 0 0}input,select{font:inherit;padding:7px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff}input{flex:1;min-width:140px}
main{padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
.c{background:#fff;border:1px solid #e5e8f0;border-radius:10px;overflow:hidden}.c .ph{aspect-ratio:2/3;background:#e2e8f0;display:grid;place-items:center;text-align:center;padding:8px;font-size:13px;color:#475569}
.c img{width:100%;height:100%;object-fit:cover;display:block}.c .i{padding:8px;font-size:13px}.c b{display:block;line-height:1.25}.m{color:#64748b;font-size:12px}
.on{color:#166534}.off{color:#92400e}#n{color:#64748b;font-size:13px;margin-left:auto}
@media(prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}header,.c{background:#1e293b;border-color:#334155}input,select{background:#0f172a;color:#e2e8f0;border-color:#334155}.c .ph{background:#334155;color:#cbd5e1}.on{color:#4ade80}.off{color:#fbbf24}}`;

const PAGE_JS = `const R=window.__ROWS__,POST=window.__POSTERS__||'';const q=document.getElementById('q'),ty=document.getElementById('ty'),dr=document.getElementById('dr'),m=document.getElementById('m'),n=document.getElementById('n');
const drives=[...new Set(R.map(r=>r.d).filter(Boolean))].sort();dr.innerHTML='<option value="">All drives</option>'+drives.map(d=>'<option>'+d.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</option>').join('');try{const pd=new URLSearchParams(location.search).get('drive');if(pd&&drives.includes(pd))dr.value=pd;}catch(e){}
const e=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function draw(){const w=q.value.trim().toLowerCase(),t=ty.value,d=dr.value;const L=R.filter(r=>(!t||r.ty===t)&&(!d||r.d===d)&&(!w||(r.t+' '+r.y+' '+r.g+' '+r.q+' '+r.d).toLowerCase().includes(w))).slice(0,600);
n.textContent=L.length+(L.length===600?'+':'')+' shown';m.innerHTML=L.map(r=>'<div class="c"><div class="ph">'+(POST&&r.p?'<img loading="lazy" src="'+POST+encodeURIComponent(r.p)+'" alt="">':e(r.t))+'</div><div class="i"><b>'+e(r.t)+'</b><span class="m">'+[r.y,r.q,r.ty].filter(Boolean).join(' · ')+'</span><br><span class="m '+(r.on?'on':'off')+'">'+e(r.d||'')+(r.s?' · '+e(r.s):'')+(r.on?'':' · offline')+'</span></div></div>').join('');}
[q,ty,dr].forEach(x=>x.addEventListener('input',draw));draw();`;

function pageHtml(rows, { title = 'My catalog', posters = '' } = {}) {
  const data = JSON.stringify(rows).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body>
<header><h1>${esc(title)}</h1><input id="q" type="search" placeholder="Search title, year, quality, drive" aria-label="Search"><select id="ty" aria-label="Type"><option value="">All</option><option value="movie">Movies</option><option value="series">TV</option><option value="music">Music</option><option value="game">Games</option></select><select id="dr" aria-label="Drive"></select><span id="n"></span></header>
<main id="m"></main><script>window.__ROWS__=${data};window.__POSTERS__=${JSON.stringify(posters)};${PAGE_JS}</script></body></html>`;
}

/** Print-ready labels, one per drive. qrFor(drive) returns the text the QR code holds. */
function labelsHtml(drives, qrFor) {
  const labels = drives.map(d => `<div class="lb"><div class="q">${qrSvg(qrFor(d), 4)}</div><div class="t"><b>${esc(d.nickname || d.label || d.root || 'Drive')}</b>
    <div>${esc(d.shelf ? 'Shelf: ' + d.shelf : '')}</div><small>${esc(d.counts || '')}</small></div></div>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Drive labels</title><style>
body{font-family:system-ui,"Segoe UI",sans-serif;margin:16px;color:#000}h1{font-size:16px;margin:0 0 4px}p{margin:0 0 14px;color:#555;font-size:13px}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.lb{display:flex;gap:10px;align-items:center;border:1.5px dashed #888;border-radius:8px;padding:10px;break-inside:avoid}.q{width:96px;height:96px;flex:none}.q svg{width:100%;height:100%}
.t b{font-size:18px;display:block;margin-bottom:4px}.t div{font-size:14px}.t small{color:#555}
@media print{p{display:none}body{margin:6mm}}</style></head><body><h1>Drive labels</h1><p>Print this page and cut along the dashed lines. Use your browser's Print.</p><div class="g">${labels}</div></body></html>`;
}

/** Addresses a phone can really reach: real Wi-Fi / Ethernet first, virtual adapters (WSL, Hyper-V, VPN, VirtualBox...) last or left out. */
function lanAddresses() {
  const out = [];
  const virtual = /vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|tailscale|zerotier|hamachi|vpn|loopback|bluetooth|tap-|tun/i;
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family !== 'IPv4' || n.internal || /^169\.254\./.test(n.address)) continue;
      const m = n.address.match(/^(\d+)\.(\d+)\./);
      const priv = m && (m[1] === '192' && m[2] === '168' || m[1] === '10' || (m[1] === '172' && +m[2] >= 16 && +m[2] <= 31));
      const wifi = /wi-?fi|wlan|wireless|en0|eth|ethernet|local area/i.test(name);
      let score = 0;
      if (priv) score += 4; if (wifi) score += 2; if (virtual.test(name)) score -= 6; if (m && m[1] === '192' && m[2] === '168') score += 1;
      out.push({ address: n.address, name, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.map(o => o.address);
}

/**
 * Read-only phone view. Only GET, a secret key in the link, posters by file name only. Off unless the person turns it on.
 * getRows(): current rows. postersDir: folder holding poster files.
 */
function startPhoneServer({ getRows, postersDir, token, port = 8787, title = 'My catalog' }) {
  const server = http.createServer((req, res) => {
    const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(body); };
    try {
      if (req.method !== 'GET') return send(405, 'text/plain', 'Read-only.');
      const u = new URL(req.url, 'http://x');
      const key = u.searchParams.get('k') || '';
      const ok = key.length === token.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(token));
      if (!ok) return send(403, 'text/plain', 'Open the link shown in the app (it contains a secret key).');
      if (u.pathname === '/') return send(200, 'text/html; charset=utf-8', pageHtml(getRows(), { title, posters: `/p/?k=${token}&f=` }));
      if (u.pathname === '/p/') {
        const f = path.basename(u.searchParams.get('f') || '');
        if (!f || !/\.(jpe?g|png|webp)$/i.test(f)) return send(404, 'text/plain', 'No.');
        const file = path.join(postersDir, f);
        if (!fs.existsSync(file)) return send(404, 'text/plain', 'No.');
        res.writeHead(200, { 'Content-Type': /\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'max-age=3600' });
        return fs.createReadStream(file).pipe(res);
      }
      return send(404, 'text/plain', 'Not found.');
    } catch { return send(500, 'text/plain', 'Error.'); }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

module.exports = { qrSvg, rowsOf, pageHtml, labelsHtml, lanAddresses, startPhoneServer };
