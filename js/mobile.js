// Part of TEMobile - forked from TERoomApp, created by Christopher Hunt (github.com/lucidium2000).
/* The mobile tabs: Home (an overview of the others), Outages (the globe,
 * app.js), Weather (forecast, radar, US power), Tests (speed test + the service checks
 * from js/roomnet.js) and Phone (what the browser can tell about the phone:
 * connection, battery, location, device).
 *
 * Browsers don't expose cellular signal strength or Wi-Fi RSSI to web pages,
 * so "signal" here is measured: round-trip time to the nearest internet edge
 * (RoomNet.edge) and the speed test, plus navigator.connection where the
 * browser has it (Chrome on Android; not Safari).
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kv = (el, rows) => {
    el.innerHTML = rows.filter((r) => r && r[1] != null && r[1] !== '').map(([k, v, cls]) =>
      `<div${cls ? ` class="${cls}"` : ''}><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  };
  const toast = (msg) => {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.className = 'toast info'; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2800);
  };

  // ── Tabs ─────────────────────────────────────────────────────────────────
  const views = { home: $('viewHome'), weather: $('viewWeather'), tests: $('viewTests'), phone: $('viewPhone') };
  let tab = 'home';
  function setTab(name) {
    // Weather again (Show radar, a county): fold the sheet to show its globe.
    if (name === 'weather' && tab === 'weather') { foldWx(true); return; }
    if ((name === 'globe' || name === 'weather') && window.TEApp && window.TEApp.enterView) window.TEApp.enterView(name);
    tab = name;
    document.body.dataset.tab = name;
    for (const [k, v] of Object.entries(views)) v.hidden = k !== name;
    document.querySelectorAll('#tabbar [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    try { sessionStorage.setItem('te-m-tab', name); } catch (_) { /* */ }
    if (name === 'globe' || name === 'weather') window.dispatchEvent(new Event('resize'));
    if (name === 'phone') refreshPhone();
    if (name === 'tests') refreshTests();
    if (name === 'home') refreshHome();
    if (name === 'weather') refreshWeather();
  }
  window.TEMobile = { setTab: (t) => setTab(t), tab: () => tab, foldWx: (v) => foldWx(v) };
  document.getElementById('tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b && b.dataset.tab !== tab) { if (window.Sfx) window.Sfx.play('tap'); setTab(b.dataset.tab); }
  });
  // A service row opens its path trace - on the globe.
  $('roomNetRows').addEventListener('click', (e) => {
    if (e.target.closest('.svc-edit, .svc-grip') || $('services').classList.contains('editing')) return;
    if (e.target.closest('.svc[data-i]')) setTimeout(() => setTab('globe'), 0);
  });

  // ── Speed test (Cloudflare's speed endpoints: CORS-open, no key) ─────────
  const CF = 'https://speed.cloudflare.com';
  const setGauge = (id, mbps) => {
    const g = $(id), max = 500;
    // Log scale: 1 Mbps reads as something, 500 fills it.
    const f = mbps > 0 ? Math.min(1, Math.log10(1 + mbps) / Math.log10(1 + max)) : 0;
    g.querySelector('.g-val').style.strokeDashoffset = String(100 - f * 100);
    g.querySelector('b').textContent = mbps == null ? '–' : mbps >= 100 ? Math.round(mbps) : mbps.toFixed(1);
  };
  async function ping(ms = 3000) {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), ms);
    try {
      const t0 = performance.now();
      const r = await fetch(`${CF}/cdn-cgi/trace?r=${Math.random()}`, { cache: 'no-store', signal: ac.signal });
      const txt = await r.text();
      return { ms: performance.now() - t0, colo: (txt.match(/^colo=(\w+)/m) || [])[1] || '' };
    } catch (_) { return { ms: null, colo: '' }; } finally { clearTimeout(to); }
  }
  // Cloudflare's own view of the connection (its Server-Timing "cfL4"
  // header, readable here because the speed endpoints allow it): the TCP
  // round trip its kernel measured, and packets lost or resent so far.
  function cfL4(url) {
    try {
      const e = performance.getEntriesByName(url).pop();
      const st = e && e.serverTiming && e.serverTiming.find((x) => x.name === 'cfL4');
      if (!st) return null;
      const q = new URLSearchParams(st.description.replace(/^\?/, ''));
      const n = (k) => (q.has(k) ? Number(q.get(k)) : null);
      return { proto: q.get('proto') || '', rtt: n('rtt') != null ? n('rtt') / 1000 : null, sent: n('sent'), lost: n('lost'), retrans: n('retrans'), proto2: e.nextHopProtocol || '' };
    } catch (_) { return null; }
  }
  // Throughput samples for the live graph: { t (s from start), mbps, k: 'd'|'u' },
  // and latency under load: { t, ms, k: 'l' }.
  let spPts = [], spT0 = 0;
  async function down(bytes) {
    const url = `${CF}/__down?bytes=${bytes}&r=${Math.random()}`;
    const t0 = performance.now();
    const r = await fetch(url, { cache: 'no-store' });
    const reader = r.body.getReader();
    let got = 0, first = 0, lastT = 0, lastB = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      const now = performance.now();
      if (!first) { first = now; lastT = now; }
      got += value.length;
      if (now - lastT >= 150) { spPts.push({ t: (now - spT0) / 1000, mbps: ((got - lastB) * 8) / ((now - lastT) / 1000) / 1e6, k: 'd' }); lastT = now; lastB = got; drawSpeed(); }
    }
    const s = (performance.now() - (first || t0)) / 1000;
    return { mbps: got * 8 / Math.max(0.01, s) / 1e6, bytes: got, s, l4: cfL4(url) };
  }
  async function up(bytes) {
    const body = new Uint8Array(bytes);
    const t0 = performance.now();
    await fetch(`${CF}/__up?r=${Math.random()}`, { method: 'POST', body, cache: 'no-store' });
    const now = performance.now(), mbps = bytes * 8 / Math.max(0.01, (now - t0) / 1000) / 1e6;
    if (bytes >= 3e5) { spPts.push({ t: (t0 - spT0) / 1000, mbps, k: 'u' }); spPts.push({ t: (now - spT0) / 1000, mbps, k: 'u' }); drawSpeed(); }
    return mbps;
  }
  // Pings alongside a transfer: how much the latency climbs when the line
  // is busy (bufferbloat) - the lag a video call feels during an upload.
  function loadedPinger() {
    const out = []; let on = true;
    (async () => {
      while (on) {
        const p = await ping(2000);
        if (!on) break;
        out.push(p.ms);
        if (p.ms != null) { spPts.push({ t: (performance.now() - spT0) / 1000, ms: p.ms, k: 'l' }); drawSpeed(); }
        await new Promise((r) => setTimeout(r, 300));
      }
    })();
    return { stop() { on = false; return out; } };
  }
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  // Bufferbloat grade, on the usual scale (added latency under load).
  const bloatGrade = (add) => (add == null ? null : add < 5 ? 'A+' : add < 30 ? 'A' : add < 60 ? 'B' : add < 200 ? 'C' : add < 400 ? 'D' : 'F');
  const gradeWhat = { 'A+': 'No lag under load', A: 'Barely any lag under load', B: 'Some lag under load', C: 'Calls may stutter during big transfers', D: 'Calls and games lag during transfers', F: 'Heavy lag whenever the line is busy' };
  function drawSpeed() {
    const W = 300, H = 90, el = $('spSvg');
    $('spGraph').hidden = !spPts.length;
    if (!spPts.length) { el.innerHTML = ''; return; }
    const tMax = Math.max(4, ...spPts.map((p) => p.t));
    const mMax = Math.max(10, ...spPts.filter((p) => p.mbps != null).map((p) => p.mbps)) * 1.12;
    const lMax = Math.max(60, ...spPts.filter((p) => p.k === 'l').map((p) => p.ms)) * 1.15;
    const X = (t) => ((t / tMax) * W).toFixed(1);
    const line = (k, val, max) => {
      const pts = spPts.filter((p) => p.k === k);
      if (!pts.length) return '';
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t)} ${(H - 4 - (val(p) / max) * (H - 10)).toFixed(1)}`).join('');
      const area = k !== 'l' ? `<path class="sp-a sp-${k}" d="${d}L${X(pts[pts.length - 1].t)} ${H}L${X(pts[0].t)} ${H}Z"/>` : '';
      return area + `<path class="sp-l sp-${k}" d="${d}"/>`;
    };
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`
      + `<path class="sp-grid" d="M0 ${H / 4}H${W}M0 ${H / 2}H${W}M0 ${(H * 3) / 4}H${W}"/>`
      + line('d', (p) => p.mbps, mMax) + line('u', (p) => p.mbps, mMax) + line('l', (p) => p.ms, lMax) + '</svg>'
      + `<span class="sp-max">${mMax >= 100 ? Math.round(mMax) : mMax.toFixed(1)} Mbps</span><span class="sp-lmax">${Math.round(lMax)} ms</span>`;
  }
  function showResult(res, live) {
    const g = res.grade;
    $('spGrade').hidden = !g;
    if (g) {
      $('spGrade').className = 'sp-grade g-' + g.replace('+', 'p');
      $('spGrade').innerHTML = `<b>${g}</b><div><strong>Bufferbloat</strong><span>${gradeWhat[g]} &middot; +${Math.round(res.bloat)} ms when busy</span></div>`;
    }
    const ms = (v) => (v != null ? `${Math.round(v)} ms` : '');
    kv($('speedStats'), [
      ['Idle latency', res.lat != null ? `${Math.round(res.lat)} ms` : live ? '…' : '', res.lat == null ? '' : res.lat < 30 ? 'ok' : res.lat < 80 ? 'warn' : 'bad'],
      ['Jitter', ms(res.jit)],
      ['Latency, downloading', ms(res.latD)],
      ['Latency, uploading', ms(res.latU)],
      ['Packet loss', res.loss != null ? `${res.loss.toFixed(res.loss && res.loss < 1 ? 1 : 0)}%` : '', res.loss == null ? '' : res.loss === 0 ? 'ok' : res.loss < 2 ? 'warn' : 'bad'],
      ['Resent packets', res.retrans != null ? `${res.retrans} of ${res.sent} (${((res.retrans / Math.max(1, res.sent)) * 100).toFixed(1)}%)` : ''],
      ['Server', res.colo ? `Cloudflare ${res.colo}` + (res.proto ? ` · ${res.proto}` : '') : ''],
      ['Tested', res.at ? new Date(res.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''],
    ]);
  }
  let spHist = [];
  try { spHist = JSON.parse(localStorage.getItem('te-m-speedhist') || '[]'); } catch (_) { /* */ }
  function renderHist() {
    $('spHist').hidden = spHist.length < 1;
    const max = Math.max(1, ...spHist.map((h) => h.down || 0));
    $('spHistRows').innerHTML = spHist.slice().reverse().slice(0, 8).map((h) => `<div class="sh-row">
      <span class="sh-t">${new Date(h.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
      <span class="sh-bar"><i style="width:${((h.down / max) * 100).toFixed(0)}%"></i></span>
      <span class="sh-v"><b>${h.down >= 100 ? Math.round(h.down) : h.down.toFixed(1)}</b>&darr; ${h.up >= 100 ? Math.round(h.up) : h.up.toFixed(1)}&uarr;</span>
      <span class="sh-l">${Math.round(h.lat)} ms${h.grade ? ` · <em class="g-${h.grade.replace('+', 'p')}">${h.grade}</em>` : ''}</span></div>`).join('');
  }
  let speedBusy = false;
  async function runSpeed() {
    if (speedBusy) return;
    speedBusy = true;
    const btn = $('speedRun');
    btn.disabled = true;
    const res = {};
    spPts = []; spT0 = performance.now(); drawSpeed(); $('spGrade').hidden = true;
    try {
      setGauge('gDown', null); setGauge('gUp', null);
      btn.textContent = 'Measuring latency…'; showResult(res, true);
      const ps = []; let tries = 0;
      for (let i = 0; i < 12; i++) { const p = await ping(); tries++; ps.push(p.ms); res.colo = p.colo || res.colo; }
      ps.shift(); tries--;   // the first opens the connection
      const okPs = ps.filter((v) => v != null);
      if (!okPs.length) throw new Error('no answer');
      res.lat = median(okPs);
      res.jit = okPs.length > 1 ? okPs.slice(1).reduce((a, v, i) => a + Math.abs(v - okPs[i]), 0) / (okPs.length - 1) : 0;
      showResult(res, true);
      btn.textContent = 'Testing download…';
      let lp = loadedPinger();
      const dl = []; let l4 = null;
      // Ramp up, then keep going for about 5 s (at most ~40 MB) so the
      // graph shows how steady the line is, not just one burst.
      let tB = 0, tS = 0, used = 0, size = 1e5;
      const dEnd = performance.now() + 5000;
      for (let n = 0; n < 40; n++) {
        const d = await down(size); dl.push(d.mbps); l4 = d.l4 || l4; used += d.bytes;
        if (size >= 1e6) { tB += d.bytes; tS += d.s; }
        setGauge('gDown', tS ? (tB * 8) / tS / 1e6 : d.mbps);
        if ((size >= 1e6 && d.mbps < 5) || performance.now() > dEnd || used > 40e6) break;
        size = Math.min(10e6, size * (d.s < 0.5 ? 5 : 2));
      }
      const ldD = lp.stop();
      res.down = tS ? (tB * 8) / tS / 1e6 : Math.max(...dl);
      setGauge('gDown', res.down);
      if (l4) { res.retrans = l4.retrans; res.sent = l4.sent; res.proto = (l4.proto2 || '').replace('http/1.1', 'HTTP/1.1').replace(/^h(\d)$/, 'HTTP/$1'); }
      const okD = ldD.filter((v) => v != null);
      res.latD = okD.length ? median(okD) : null;
      showResult(res, true);
      btn.textContent = 'Testing upload…';
      lp = loadedPinger();
      const ul = [];
      let uB = 0, uS = 0, uUsed = 0, uSize = 1e5;
      const uEnd = performance.now() + 5000;
      for (let n = 0; n < 40; n++) {
        const t = performance.now(), m = await up(uSize); ul.push(m); uUsed += uSize;
        if (uSize >= 1e6) { uB += uSize; uS += (performance.now() - t) / 1000; }
        setGauge('gUp', uS ? (uB * 8) / uS / 1e6 : m);
        if ((uSize >= 1e6 && m < 3) || performance.now() > uEnd || uUsed > 15e6) break;
        uSize = Math.min(3e6, uSize * 3);
      }
      const ldU = lp.stop();
      res.up = uS ? (uB * 8) / uS / 1e6 : Math.max(...ul);
      setGauge('gUp', res.up);
      const okU = ldU.filter((v) => v != null);
      res.latU = okU.length ? median(okU) : null;
      // Loss: pings that never came back, idle and under load.
      const all = ps.concat(ldD, ldU);
      res.loss = (all.filter((v) => v == null).length / Math.max(1, all.length)) * 100;
      const loaded = [res.latD, res.latU].filter((v) => v != null);
      res.bloat = loaded.length ? Math.max(0, Math.max(...loaded) - res.lat) : null;
      res.grade = bloatGrade(res.bloat);
      res.at = Date.now();
      showResult(res);
      try { localStorage.setItem('te-m-speed', JSON.stringify(res)); } catch (_) { /* */ }
      spHist.push({ at: res.at, down: res.down, up: res.up, lat: res.lat, grade: res.grade });
      spHist = spHist.slice(-20);
      try { localStorage.setItem('te-m-speedhist', JSON.stringify(spHist)); } catch (_) { /* */ }
      renderHist();
      lastSpeed = res;
      refreshPhone();
    } catch (e) {
      toast('Speed test couldn’t finish - check the connection');
    }
    btn.textContent = 'Run again'; btn.disabled = false; speedBusy = false;
  }
  let lastSpeed = null;
  try { lastSpeed = JSON.parse(localStorage.getItem('te-m-speed') || 'null'); } catch (_) { /* */ }
  $('speedRun').addEventListener('click', runSpeed);
  function refreshTests() {
    renderConn();
    renderHist();
    if (lastSpeed && !speedBusy) {
      setGauge('gDown', lastSpeed.down); setGauge('gUp', lastSpeed.up);
      showResult(lastSpeed);
      $('speedRun').textContent = 'Run again';
    }
  }

  // ── Network: this phone's baseline - the round trip to the nearest edge,
  // checked every 30 s (js/roomnet.js), on a one-hour timeline ──────────────
  function renderConn() {
    const q = quality(), edge = window.RoomNet && window.RoomNet.edge, room = window.TEApp && window.TEApp.room();
    $('ncBars').className = 'bars q' + q.bars;
    $('ncQual').textContent = q.label;
    const kind = conn && conn.type ? { wifi: 'Wi-Fi', cellular: 'Cellular', ethernet: 'Ethernet' }[conn.type] || conn.type : '';
    $('ncType').textContent = [kind, conn && conn.effectiveType ? conn.effectiveType.toUpperCase() : '', room && room.org].filter(Boolean).join(' · ') || (room && room.org) || '';
    const ms = edge && edge.ms != null ? Math.round(edge.ms) : q.rtt != null ? Math.round(q.rtt) : null;
    $('ncMs').textContent = ms != null ? ms : '–';
    $('ncCard').dataset.state = ms == null ? 'wait' : ms < 30 ? 'ok' : ms < 80 ? 'warn' : 'bad';
    const now = Date.now(), hour = (edge && edge.samples || []).filter((x) => x.t >= now - 3600e3);
    $('ncSpark').innerHTML = window.TEApp && window.TEApp.spark ? window.TEApp.spark(hour, 30, 80) : '';
    const mins = hour.length ? Math.max(1, Math.round((now - hour[0].t) / 60e3)) : 0;
    $('ncT0').textContent = !hour.length ? '' : mins >= 59 ? '1h ago' : `${mins} min ago`;
    const v = hour.filter((x) => x.ms != null).map((x) => x.ms);
    const avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    const jit = v.length > 1 ? v.slice(1).reduce((a, b, i) => a + Math.abs(b - v[i]), 0) / (v.length - 1) : null;
    const up = hour.length ? Math.round((v.length / hour.length) * 100) : null;
    const st = (k, val, cls) => `<div class="${cls || ''}"><b>${val}</b><span>${k}</span></div>`;
    $('ncStats').innerHTML = [
      st('Average', avg != null ? Math.round(avg) + '<small>ms</small>' : '–', avg == null ? '' : avg < 30 ? 'ok' : avg < 80 ? 'warn' : 'bad'),
      st('Best', v.length ? Math.round(Math.min(...v)) + '<small>ms</small>' : '–'),
      st('Worst', v.length ? Math.round(Math.max(...v)) + '<small>ms</small>' : '–'),
      st('Jitter', jit != null ? Math.round(jit) + '<small>ms</small>' : '–'),
      st('Reachable', up != null ? up + '<small>%</small>' : '–', up == null ? '' : up >= 99 ? 'ok' : up >= 90 ? 'warn' : 'bad'),
    ].join('');
    $('ncNote').textContent = `Round trip to ${edge && edge.colo ? 'Cloudflare ' + edge.colo : 'the nearest internet edge'}, every 30 seconds while the app is open`
      + ` - it covers this phone's network and the first stretch of the provider, so a jump here means trouble close to home.`;
  }
  setInterval(() => { if (tab === 'tests') renderConn(); }, 5000);

  // ── Phone: connection ────────────────────────────────────────────────────
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  function quality() {
    // 0-5 bars from what's measured: the edge round trip first, then the
    // browser's own estimate, then the last speed test.
    const edge = window.RoomNet && window.RoomNet.edge && window.RoomNet.edge.ms;
    const rtt = edge != null ? edge : conn && conn.rtt ? conn.rtt : lastSpeed ? lastSpeed.lat : null;
    if (!navigator.onLine) return { bars: 0, label: 'Offline' };
    if (rtt == null) return { bars: 0, label: 'Measuring…' };
    const bars = rtt < 25 ? 5 : rtt < 50 ? 4 : rtt < 100 ? 3 : rtt < 200 ? 2 : 1;
    return { bars, label: ['Offline', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'][bars], rtt };
  }
  function fmtDur(s) {
    if (!isFinite(s) || s <= 0) return '';
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h ? `${h} h ${m} min` : `${m} min`;
  }
  // What the connection itself looks like from the edge (WiFiman-style
  // details): Cloudflare's trace says which address, protocol, TLS version
  // and key exchange it saw; IPv4 / IPv6 are tested separately by reaching
  // 1.1.1.1 on each. Refreshed at most once a minute.
  let netInfo = null, netInfoAt = 0;
  async function reach(url) {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 4000);
    try { const t0 = performance.now(); await fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: ac.signal }); return performance.now() - t0; }
    catch (_) { return null; } finally { clearTimeout(to); }
  }
  async function loadNetInfo() {
    if (Date.now() - netInfoAt < 60e3) return;
    netInfoAt = Date.now();
    const info = {};
    try {
      const txt = await (await fetch(`${CF}/cdn-cgi/trace?r=${Math.random()}`, { cache: 'no-store', credentials: 'omit' })).text();
      txt.split('\n').forEach((l) => { const i = l.indexOf('='); if (i > 0) info[l.slice(0, i)] = l.slice(i + 1); });
    } catch (_) { /* */ }
    const [v4, v6] = await Promise.all([reach('https://1.1.1.1/cdn-cgi/trace'), reach('https://[2606:4700:4700::1111]/cdn-cgi/trace')]);
    info.v4 = v4; info.v6 = v6;
    netInfo = info;
    if (tab === 'phone') refreshNet();
  }
  async function refreshNet() {
    loadNetInfo();
    const q = quality();
    $('phBars').dataset.n = q.bars;
    $('phBars').className = 'bars q' + q.bars;
    $('phQual').textContent = q.label;
    const kind = conn && conn.type ? { wifi: 'Wi-Fi', cellular: 'Cellular', ethernet: 'Ethernet', none: 'None', bluetooth: 'Bluetooth', wimax: 'WiMAX' }[conn.type] || conn.type : '';
    $('phType').textContent = [kind, conn && conn.effectiveType ? conn.effectiveType.toUpperCase() + ' class' : ''].filter(Boolean).join(' · ') || 'Connection type not shared by this browser';
    const room = window.TEApp && window.TEApp.room();
    const edge = window.RoomNet && window.RoomNet.edge;
    kv($('phNetKv'), [
      ['Status', navigator.onLine ? 'Online' : 'Offline'],
      ['Round trip to edge', q.rtt != null ? `${Math.round(q.rtt)} ms` : '', q.rtt != null ? (q.rtt < 50 ? 'ok' : q.rtt < 100 ? 'warn' : 'bad') : ''],
      ['Nearest edge', edge && edge.colo ? `Cloudflare ${edge.colo}` : netInfo && netInfo.colo ? `Cloudflare ${netInfo.colo}` : ''],
      ['Edge-measured round trip', liveL4 && liveL4.rtt != null ? `${liveL4.rtt.toFixed(1)} ms` : '', liveL4 && liveL4.rtt != null ? (liveL4.rtt < 30 ? 'ok' : liveL4.rtt < 80 ? 'warn' : 'bad') : ''],
      ['Resent packets (this link)', liveL4 && liveL4.retrans != null && liveL4.sent ? `${liveL4.retrans} of ${liveL4.sent} (${((liveL4.retrans / liveL4.sent) * 100).toFixed(1)}%)` : '', liveL4 && liveL4.retrans != null ? (liveL4.retrans / Math.max(1, liveL4.sent) < 0.01 ? 'ok' : liveL4.retrans / Math.max(1, liveL4.sent) < 0.03 ? 'warn' : 'bad') : ''],
      ...['v4', 'v6'].map((f) => {
        if (!netInfo) return [f === 'v4' ? 'IPv4' : 'IPv6', ''];
        const seen = netInfo.ip && (f === 'v6' ? netInfo.ip.includes(':') : netInfo.ip.includes('.'));
        const ms = netInfo[f];
        return [f === 'v4' ? 'IPv4' : 'IPv6', ms != null ? `Yes · ${Math.round(ms)} ms` : seen ? 'Yes' : 'Not detected', ms != null || seen ? 'ok' : ''];
      }),
      ['Protocol', netInfo && netInfo.http ? netInfo.http.toUpperCase().replace('HTTP/2', 'HTTP/2').replace('HTTP/3', 'HTTP/3 (QUIC)') + (netInfo.tls ? ` · ${netInfo.tls.replace('TLSv', 'TLS ')}` : '') : ''],
      ['Key exchange', netInfo && netInfo.kex ? netInfo.kex + (/MLKEM|Kyber/i.test(netInfo.kex) ? ' (post-quantum)' : '') : ''],
      ['Cloudflare WARP', netInfo && netInfo.warp && netInfo.warp !== 'off' ? 'On' : ''],
      ['Browser estimate', conn && conn.downlink ? `${conn.downlink} Mbps · ${conn.rtt} ms` : ''],
      ['Data saver', conn && conn.saveData ? 'On' : ''],
      ['Last speed test', lastSpeed ? `${lastSpeed.down.toFixed(1)} ↓ / ${lastSpeed.up.toFixed(1)} ↑ Mbps` : 'Run one in Network'],
      ['Provider', room && room.org ? room.org + (room.asn ? ` (AS${room.asn})` : '') : ''],
      ['Public IP', netInfo && netInfo.ip ? netInfo.ip : room && room.ip ? room.ip : ''],
    ]);
  }
  // ── Phone: a live, second-by-second round trip to the nearest edge (the
  // same Cloudflare check as the Network baseline, on a warm connection, so
  // each one is about one round trip). Runs only while the Phone tab shows;
  // the last 10 minutes are kept, so coming back picks up where it left off.
  const LIVE_SPAN = 600e3, LIVE_URL = 'https://speed.cloudflare.com/cdn-cgi/trace';
  const live = [];
  let liveBusy = false, liveWarm = false, liveL4 = null;
  async function livePing() {
    if (liveBusy || tab !== 'phone' || document.hidden) return;
    liveBusy = true;
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 3000);
    let ms = null;
    try {
      if (!liveWarm) { await fetch(LIVE_URL, { cache: 'no-store', credentials: 'omit', signal: ac.signal }).then((r) => r.text()); liveWarm = true; }
      const u = `${CF}/__down?bytes=0&r=${Math.random()}`;
      const t0 = performance.now();
      const r = await fetch(u, { cache: 'no-store', credentials: 'omit', signal: ac.signal });
      await r.text();
      ms = performance.now() - t0;
      const l4 = cfL4(u);
      if (l4) liveL4 = l4;
      if (performance.getEntriesByType('resource').length > 200) performance.clearResourceTimings();
    } catch (_) { liveWarm = false; }
    clearTimeout(to);
    const now = Date.now();
    live.push({ t: now, ms });
    while (live.length && live[0].t < now - LIVE_SPAN) live.shift();
    liveBusy = false;
    renderLive();
  }
  // Like the service timelines: shading for "answered" (green) or not (red),
  // and the round trip as a line - light under 30 ms, amber to 80, red past.
  // Runs of the same state are merged, so it stays light at one per second.
  function renderLive() {
    const W = 300, H = 40, now = Date.now(), G = 30, SL = 80;
    const all = live.filter((x) => x.t >= now - LIVE_SPAN);
    const last = all[all.length - 1];
    $('phLiveMs').innerHTML = last && last.ms != null ? `${Math.round(last.ms)}<small>ms</small>` : last ? '<small>no answer</small>' : '&ndash;';
    $('phLiveMs').className = !last ? '' : last.ms == null ? 'bad' : last.ms < G ? 'ok' : last.ms < SL ? 'warn' : 'bad';
    if (!all.length) { $('phSpark').innerHTML = ''; $('phT0').textContent = ''; $('phLStats').innerHTML = ''; return; }
    const t0 = all[0].t, t1 = Math.max(now, t0 + 10e3);
    const X = (t) => (((t - t0) / (t1 - t0)) * W).toFixed(1);
    let out = '', i = 0;
    while (i < all.length) {
      const up = all[i].ms != null; let j = i;
      while (j + 1 < all.length && (all[j + 1].ms != null) === up) j++;
      const b = j + 1 < all.length ? all[j + 1].t : t1;
      out += `<rect class="rn-av rn-av-${up ? 'g' : 'r'}" x="${X(all[i].t)}" y="0" width="${Math.max(0.8, X(b) - X(all[i].t) + 0.4).toFixed(1)}" height="${H}"/>`;
      i = j + 1;
    }
    const v = all.filter((x) => x.ms != null).map((x) => x.ms);
    const max = Math.max(G * 2, Math.max(...v, 0) * 1.15);
    const Y = (ms) => (H - 4 - (Math.min(ms, max) / max) * (H - 8)).toFixed(1);
    const cls = (ms) => (ms < G ? 'g' : ms < SL ? 'a' : 'r');
    const segs = { g: '', a: '', r: '' };
    for (let k = 1; k < all.length; k++) {
      const a = all[k - 1], b = all[k];
      if (a.ms == null || b.ms == null) continue;
      segs[cls((a.ms + b.ms) / 2)] += `M${X(a.t)} ${Y(a.ms)}L${X(b.t)} ${Y(b.ms)}`;
    }
    if (last.ms != null) segs[cls(last.ms)] += `M${X(last.t)} ${Y(last.ms)}L${W} ${Y(last.ms)}`;
    for (const k of ['g', 'a', 'r']) if (segs[k]) out += `<path class="rn-line rn-${k}" d="${segs[k]}"/>`;
    $('phSpark').innerHTML = `<svg class="rn-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${out}</svg>`;
    const secs = Math.round((now - t0) / 1000);
    $('phT0').textContent = secs >= 590 ? '10 min ago' : secs >= 60 ? `${Math.round(secs / 60)} min ago` : `${secs} s ago`;
    const avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    const jit = v.length > 1 ? v.slice(1).reduce((a, b, k) => a + Math.abs(b - v[k]), 0) / (v.length - 1) : null;
    const st = (k, val) => `<span>${k} <b>${val}</b></span>`;
    $('phLStats').innerHTML = [
      st('Avg', avg != null ? Math.round(avg) + '<small>ms</small>' : '–'),
      st('Best', v.length ? Math.round(Math.min(...v)) + '<small>ms</small>' : '–'),
      st('Worst', v.length ? Math.round(Math.max(...v)) + '<small>ms</small>' : '–'),
      st('Jitter', jit != null ? Math.round(jit) + '<small>ms</small>' : '–'),
      st('Lost', Math.round(((all.length - v.length) / all.length) * 100) + '%'),
    ].join('');
  }
  setInterval(livePing, 1000);

  if (conn && conn.addEventListener) conn.addEventListener('change', () => { if (tab === 'phone') refreshNet(); });
  addEventListener('online', () => tab === 'phone' && refreshNet());
  addEventListener('offline', () => tab === 'phone' && refreshNet());

  // ── Phone: battery (Chrome on Android; not Safari) ───────────────────────
  let battery = null;
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      battery = b;
      ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((ev) => b.addEventListener(ev, () => tab === 'phone' && refreshBattery()));
      if (tab === 'phone') refreshBattery();
    }).catch(() => {});
  }
  function refreshBattery() {
    const fill = $('phBatFill'), pct = $('phBatPct');
    if (!battery) {
      $('phBat').classList.add('na');
      pct.textContent = '?';
      kv($('phBatKv'), [['Battery', 'Not shared by this browser (Safari keeps it private)']]);
      return;
    }
    const lv = Math.round(battery.level * 100);
    fill.style.width = lv + '%';
    fill.className = lv <= 15 ? 'low' : lv <= 35 ? 'mid' : '';
    pct.textContent = lv + '%';
    $('phBat').classList.toggle('charging', battery.charging);
    kv($('phBatKv'), [
      ['State', battery.charging ? (lv >= 100 ? 'Full' : 'Charging') : 'On battery'],
      [battery.charging ? 'Full in' : 'Time left', fmtDur(battery.charging ? battery.chargingTime : battery.dischargingTime)],
    ]);
  }

  // ── Phone: location ──────────────────────────────────────────────────────
  let gps = null, gpsPlace = '';
  function refreshLoc() {
    const room = window.TEApp && window.TEApp.room();
    const c = gps && gps.coords;
    kv($('phLocKv'), c ? [
      ['Source', 'GPS / device location'],
      ['Place', gpsPlace],
      ['Coordinates', `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`],
      ['Accuracy', `±${Math.round(c.accuracy)} m`],
      ['Altitude', c.altitude != null ? `${Math.round(c.altitude)} m` + (c.altitudeAccuracy ? ` (±${Math.round(c.altitudeAccuracy)} m)` : '') : ''],
      ['Speed', c.speed != null && c.speed > 0.3 ? `${(c.speed * 2.23694).toFixed(1)} mph` : c.speed != null ? 'Stationary' : ''],
      ['Heading', c.heading != null && !isNaN(c.heading) && c.speed > 0.3 ? `${Math.round(c.heading)}°` : ''],
    ] : [
      ['Source', room ? (room.precise ? 'Exact location (saved)' : 'Approximate - from the network') : 'Locating…'],
      ['Place', room ? [room.city, room.region].filter(Boolean).join(', ') : ''],
      ['Coordinates', room ? `${room.lat.toFixed(3)}, ${room.lon.toFixed(3)}` : ''],
    ]);
    $('phGps').textContent = gps ? 'Stop GPS' : 'Use GPS';
  }
  let watch = null;
  $('phGps').addEventListener('click', () => {
    if (watch != null) { navigator.geolocation.clearWatch(watch); watch = null; gps = null; refreshLoc(); return; }
    if (!navigator.geolocation) return toast('Location isn’t available in this browser');
    $('phGps').textContent = 'Locating…';
    let named = false;
    watch = navigator.geolocation.watchPosition(async (p) => {
      gps = p;
      if (!named) {
        named = true;
        try {
          const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${p.coords.latitude.toFixed(4)}&longitude=${p.coords.longitude.toFixed(4)}&localityLanguage=en`);
          const j = r.ok ? await r.json() : {};
          gpsPlace = [j.city || j.locality, j.principalSubdivision].filter(Boolean).join(', ');
        } catch (_) { /* coordinates alone are fine */ }
        // Use it for this phone's weather and pin too.
        if (window.TEApp) window.TEApp.usePreciseLocation().catch(() => {});
      }
      refreshLoc();
    }, (err) => {
      watch = null; gps = null; refreshLoc();
      toast(err.code === 1 ? 'Location permission was declined' : 'Couldn’t get a GPS fix');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  });
  $('phShow').addEventListener('click', () => {
    const c = gps && gps.coords, room = window.TEApp && window.TEApp.room();
    const at = c ? [c.longitude, c.latitude] : room ? [room.lon, room.lat] : null;
    if (!at) return toast('No location yet');
    setTab('globe');
    setTimeout(() => window.TEApp.flyToPlace(at[0], at[1]), 50);
  });

  // ── Phone: device ────────────────────────────────────────────────────────
  let gpu = '', storage = null, uaHints = null;
  try {
    const g = document.createElement('canvas').getContext('webgl');
    const d = g && g.getExtension('WEBGL_debug_renderer_info');
    gpu = g ? String(d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) : '';
  } catch (_) { /* */ }
  if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then((e) => { storage = e; }).catch(() => {});
  if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
    navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion']).then((v) => { uaHints = v; }).catch(() => {});
  }
  function platform() {
    const ua = navigator.userAgent;
    if (uaHints && uaHints.platform) return `${uaHints.platform} ${uaHints.platformVersion || ''}`.trim() + (uaHints.model ? ` · ${uaHints.model}` : '');
    let m = ua.match(/iPhone OS (\d+)[_.](\d+)/) || ua.match(/CPU OS (\d+)[_.](\d+)/);
    if (m) return `iOS ${m[1]}.${m[2]}` + (/iPad/.test(ua) ? ' · iPad' : ' · iPhone');
    m = ua.match(/Android ([\d.]+)(?:; ([^;)]+))?/);
    if (m) return `Android ${m[1]}` + (m[2] && m[2] !== 'K' ? ` · ${m[2]}` : '');
    if (/Mac OS X/.test(ua)) return navigator.maxTouchPoints > 1 ? 'iPadOS' : 'macOS';
    if (/Windows/.test(ua)) return 'Windows';
    return navigator.platform || '';
  }
  function browser() {
    const ua = navigator.userAgent;
    const m = ua.match(/(EdgA?|CriOS|FxiOS|SamsungBrowser|OPR|Firefox|Chrome)\/([\d]+)/);
    if (m) return ({ EdgA: 'Edge', Edg: 'Edge', CriOS: 'Chrome', FxiOS: 'Firefox', SamsungBrowser: 'Samsung Internet', OPR: 'Opera' }[m[1]] || m[1]) + ' ' + m[2];
    const s = ua.match(/Version\/([\d.]+).*Safari/);
    return s ? 'Safari ' + s[1] : '';
  }
  function refreshDev() {
    const sc = window.screen || {};
    const o = sc.orientation ? sc.orientation.type.replace(/-primary|-secondary/, '') : (innerWidth > innerHeight ? 'landscape' : 'portrait');
    const gb = (b) => (b / 1e9 >= 1 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB');
    kv($('phDevKv'), [
      ['System', platform()],
      ['Browser', browser()],
      ['Screen', sc.width ? `${sc.width} × ${sc.height} pt · ${devicePixelRatio}×` : ''],
      ['Display', `${Math.round(sc.width * devicePixelRatio)} × ${Math.round(sc.height * devicePixelRatio)} px · ${o}`],
      ['Processor', navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} cores` : ''],
      ['Memory', navigator.deviceMemory ? `${navigator.deviceMemory} GB or more` : ''],
      ['Graphics', gpu.replace(/^ANGLE \((.*)\)$/, '$1')],
      ['WebGPU', navigator.gpu ? 'Available' : 'Not available'],
      ['Storage for this app', storage && storage.quota ? `${gb(storage.usage || 0)} of ${gb(storage.quota)}` : ''],
      ['Language', navigator.language],
      ['Time zone', Intl.DateTimeFormat().resolvedOptions().timeZone],
      ['Appearance', matchMedia('(prefers-color-scheme: dark)').matches ? 'Dark mode' : 'Light mode'],
      ['Installed as app', matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'Yes' : 'No - add to Home Screen'],
    ]);
  }

  function refreshPhone() { refreshNet(); refreshBattery(); refreshLoc(); refreshDev(); }
  setInterval(() => { if (tab === 'phone') { refreshNet(); refreshLoc(); } }, 5000);

  // ── Outages: the list is a sheet - folded to its counts, or open ──────
  {
    const panel = $('panel'), grab = document.createElement('button');
    grab.className = 'sheet-grab'; grab.setAttribute('aria-label', 'Show or hide the outage list');
    panel.prepend(grab);
    let min = true;
    try { min = localStorage.getItem('te-m-sheet') !== 'open'; } catch (_) { /* */ }
    const setMin = (v) => {
      min = v; document.body.classList.toggle('sheet-min', v);
      try { localStorage.setItem('te-m-sheet', v ? 'min' : 'open'); } catch (_) { /* */ }
      setTimeout(() => dispatchEvent(new Event('resize')), 300);
    };
    setMin(min);
    // The outage card sits just above the sheet, whatever its height.
    const fit = () => document.documentElement.style.setProperty('--sheet-px', panel.offsetHeight + 'px');
    if (window.ResizeObserver) new ResizeObserver(fit).observe(panel); else fit();
    // Picking an outage folds the list, so the globe and its card show.
    $('list').addEventListener('click', (e) => { if (e.target.closest('.row')) setMin(true); });
    grab.addEventListener('click', () => { if (window.Sfx) window.Sfx.play('tap'); setMin(!min); });
    // A count (filter) or the section title opens it.
    panel.addEventListener('click', (e) => { if (min && e.target.closest('.stats, .outages .sec-title')) setMin(false); });
  }

  // ── Home: one glance at every tab; each card opens its tab ──────────────
  const fmtAgo = (min) => (min < 60 ? `${Math.max(1, Math.round(min))}m ago` : min < 1440 ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}m ago` : `${Math.round(min / 1440)}d ago`);
  function refreshHome() {
    const A = window.TEApp;
    const now = new Date();
    $('hmClock').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    $('hmDate').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    if (!A) return;
    // Hero: how many outages are active right now.
    const os = A.outages ? A.outages() : [], h = A.windowH ? A.windowH() : 24;
    const act = os.filter((o) => o.active), win = h === 1 ? 'the last hour' : `the last ${h} hours`;
    const hero = $('hmHero');
    hero.dataset.state = !os.length && !A.outages ? 'wait' : act.length >= 5 ? 'bad' : act.length ? 'warn' : 'ok';
    $('hmHeroN').textContent = act.length;
    $('hmHeroK').textContent = 'active';
    $('hmHeroTitle').textContent = act.length ? (act.length > 1 ? 'Outages in progress' : 'Outage in progress') : 'The internet looks healthy';
    $('hmHeroSub').textContent = act.length
      ? act.slice(0, 2).map((o) => o.name).join(' · ') + (act.length > 2 ? ` +${act.length - 2}` : '')
      : `${os.length} outage${os.length === 1 ? '' : 's'} seen and cleared in ${win}`;
    $('hmList').innerHTML = os.length ? os.slice(0, 3).map((o) => `<li class="${o.kind}${o.active ? ' active' : ''}" data-id="${esc(o.id)}">`
      + `<span class="ico">${A.iconHtml ? A.iconHtml(o) : ''}</span><span class="nm">${esc(o.name)}<small>${o.kind === 'network' ? 'Network' : 'Application'} · ${esc(o.locations.length === 1 ? o.locations[0].name : o.locations.length + ' locations')}</small></span>`
      + `<span class="ago">${o.active ? 'Active' : fmtAgo((Date.now() - o.start) / 60e3)}</span></li>`).join('')
      : '<li class="empty">No outages in ' + win + '</li>';
    // Weather tile.
    const w = A.weather ? A.weather() : {}, c = w.now && w.now.current, room = A.room && A.room();
    const WMO = (window.WxBrief && window.WxBrief.WMO) || {};
    const alerts = (w.brief && w.brief.alertInfo) || [];
    if (c) {
      if (A.drawWx) A.drawWx($('hmWxIcon'), c.weather_code, c.is_day === 1, 30);
      $('hmWxTemp').textContent = Math.round(c.temperature_2m) + '°';
    }
    $('hmWx').classList.toggle('alert', !!alerts.length);
    $('hmWxSub').textContent = alerts.length ? alerts[0].event
      : [c ? (WMO[c.weather_code] || '').replace(/^./, (x) => x.toUpperCase()) : '', (w.brief && w.brief.city) || (room && room.city) || ''].filter(Boolean).join(' · ');
    // Connection tile.
    const q = quality();
    $('hmBars').className = 'bars q' + q.bars;
    $('hmNetV').innerHTML = q.rtt != null ? `${Math.round(q.rtt)}<small>ms</small>` : '–';
    $('hmNetSub').textContent = q.label + (lastSpeed ? ` · ${Math.round(lastSpeed.down)} Mbps` : '');
    // Services tile.
    const svcs = [...document.querySelectorAll('#roomNetRows .svc')].map((r) => ({
      name: (r.querySelector('.svc-name') || {}).textContent || '', lvl: (r.className.match(/svc-(ok|warn|bad|info|wait)/) || [])[1] || 'wait' }));
    const good = svcs.filter((x) => x.lvl === 'ok' || x.lvl === 'info').length, bad = svcs.filter((x) => x.lvl === 'bad'), warn = svcs.filter((x) => x.lvl === 'warn');
    $('hmSvcDots').innerHTML = svcs.map((x) => `<i class="svc-${x.lvl}"></i>`).join('');
    $('hmSvcV').innerHTML = svcs.length ? `${good}<small>/${svcs.length}</small>` : '–';
    $('hmSvcSub').textContent = !svcs.length ? '' : bad.length ? `${bad[0].name} not responding` : warn.length ? `${warn[0].name} slow` : svcs.some((x) => x.lvl === 'wait') ? 'Checking…' : 'All reachable';
    $('hmSvc').dataset.state = bad.length ? 'bad' : warn.length ? 'warn' : 'ok';
    // Battery tile (or location, where the browser hides the battery).
    const lv = battery ? Math.round(battery.level * 100) : null;
    $('hmPh').querySelector('.t-k').textContent = lv != null ? 'Battery' : 'This phone';
    $('hmBat').hidden = lv == null;
    $('hmBat').firstElementChild.style.width = (lv || 0) + '%';
    $('hmBat').className = 't-bat' + (lv != null && lv <= 20 ? ' low' : '');
    $('hmBatV').innerHTML = lv != null ? `${lv}<small>%</small>` : (navigator.onLine ? 'Online' : 'Offline');
    $('hmPhSub').textContent = [lv != null && battery.charging ? 'Charging' : '', room ? room.city : ''].filter(Boolean).join(' · ');
  }
  document.querySelectorAll('#viewHome [data-go]').forEach((el) => el.addEventListener('click', () => {
    if (window.Sfx) window.Sfx.play('tap');
    setTab(el.dataset.go);
  }));
  $('hmList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li || !window.TEApp) return;
    if (window.Sfx) window.Sfx.play('tap');
    setTab('globe'); setTimeout(() => window.TEApp.selectOutage(li.dataset.id), 50);
  });
  addEventListener('te-outages', () => tab === 'home' && refreshHome());
  addEventListener('te-weather', () => {
    if (tab === 'home') refreshHome();
    if (tab === 'weather' && window.TEApp && !$('wxCard').classList.contains('other')) window.TEApp.renderForecast();
  });
  setInterval(() => { if (tab === 'home') refreshHome(); }, 4000);

  // ── Weather: its own globe (radar, power) under a sheet - folded to the
  // layer switches, or open for the full forecast ──────────────────────────
  const wxView = $('viewWeather'), wxGrab = document.createElement('button');
  wxGrab.className = 'sheet-grab wx-grab'; wxGrab.setAttribute('aria-label', 'Show or hide the forecast');
  wxView.prepend(wxGrab);
  let wxMin = true;
  function foldWx(v) {
    wxMin = v; document.body.classList.toggle('wx-min', v);
    if (v) wxView.scrollTop = 0;
  }
  foldWx(true);
  wxGrab.addEventListener('click', () => { if (window.Sfx) window.Sfx.play('tap'); foldWx(!wxMin); });
  // Scrolling or touching the forecast opens the sheet.
  wxView.addEventListener('click', (e) => { if (wxMin && !e.target.closest('[data-fips], button') && e.target.closest('#wxCard, #pwrWrap, .wx-hours')) foldWx(false); });
  const fitWx = () => document.documentElement.style.setProperty('--wsheet-px', wxView.offsetHeight + 'px');
  if (window.ResizeObserver) new ResizeObserver(fitWx).observe(wxView);

  let wxOpened = false;
  function syncLayers() {
    const A = window.TEApp; if (!A) return;
    const rm = A.radarMode ? A.radarMode() : null, pw = A.powerOn ? A.powerOn() : false;
    $('segRadar').hidden = rm == null;
    document.querySelectorAll('#segRadar [data-radar]').forEach((b) => b.classList.toggle('on', b.dataset.radar === rm));
    $('segPower').setAttribute('aria-pressed', String(pw));
  }
  function refreshWeather() {
    const A = window.TEApp; if (!A) return;
    if (!wxOpened) { wxOpened = true; A.openForecast(null, true); }
    syncLayers();
    if (window.WxView) window.WxView.render();
  }
  $('wxNow').addEventListener('click', () => { if (window.Sfx) window.Sfx.play('tap'); foldWx(false); });
  $('segRadar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-radar]'); if (!b || !window.TEApp) return;
    if (window.Sfx) window.Sfx.play(b.dataset.radar === 'off' ? 'off' : 'on');
    window.TEApp.setRadar(b.dataset.radar); syncLayers();
  });
  $('segPower').addEventListener('click', () => {
    if (!window.TEApp) return;
    const on = !window.TEApp.powerOn();
    if (window.Sfx) window.Sfx.play(on ? 'on' : 'off');
    window.TEApp.setPower(on); syncLayers();
  });
  setInterval(() => { if (tab === 'weather') syncLayers(); }, 3000);
  $('layShow').addEventListener('click', () => {
    const r = window.TEApp && window.TEApp.room();
    foldWx(true);
    if (r && isFinite(r.lat)) window.TEApp.flyToPlace(r.lon, r.lat);
  });
  // A county in the power list: the sheet folds and the globe flies there.
  $('pwrList').addEventListener('click', (e) => { if (e.target.closest('[data-fips]')) foldWx(true); });

  // Back to the last tab - last, once everything above is set up.
  let start = 'home';
  try { start = sessionStorage.getItem('te-m-tab') || 'home'; } catch (_) { /* */ }
  setTab(views[start] || start === 'globe' ? start : 'home');

  // ── iPhone / iPad: Safari never offers to install a web app (no install
  // event, unlike Chrome on Android), so explain the Share-sheet way once.
  // Not shown when already installed, and never again once dismissed. ──────
  (function iosHint() {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const installed = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    let seen = false;
    try { seen = localStorage.getItem('te-m-ioshint') === '1'; } catch (_) { /* */ }
    if (!ios || installed || seen || /[?&]nohint\b/.test(location.search)) return;
    const el = $('iosHint');
    const close = () => { el.classList.remove('on'); setTimeout(() => { el.hidden = true; }, 300); try { localStorage.setItem('te-m-ioshint', '1'); } catch (_) { /* */ } };
    $('iosHintX').addEventListener('click', close);
    setTimeout(() => { el.hidden = false; requestAnimationFrame(() => el.classList.add('on')); }, 2500);
  })();
})();
