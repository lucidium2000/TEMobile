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
  window.TEMobile = { setTab: (t) => setTab(t), tab: () => tab };
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
  async function ping() {
    const t0 = performance.now();
    const r = await fetch(`${CF}/cdn-cgi/trace?r=${Math.random()}`, { cache: 'no-store' });
    const txt = await r.text();
    return { ms: performance.now() - t0, colo: (txt.match(/^colo=(\w+)/m) || [])[1] || '' };
  }
  async function down(bytes) {
    const t0 = performance.now();
    const r = await fetch(`${CF}/__down?bytes=${bytes}&r=${Math.random()}`, { cache: 'no-store' });
    const reader = r.body.getReader();
    let got = 0, first = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; if (!first) first = performance.now(); got += value.length; }
    const s = (performance.now() - (first || t0)) / 1000;
    return got * 8 / Math.max(0.01, s) / 1e6;
  }
  async function up(bytes) {
    const body = new Uint8Array(bytes);
    const t0 = performance.now();
    await fetch(`${CF}/__up?r=${Math.random()}`, { method: 'POST', body, cache: 'no-store' });
    return bytes * 8 / Math.max(0.01, (performance.now() - t0) / 1000) / 1e6;
  }
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  let speedBusy = false;
  async function runSpeed() {
    if (speedBusy) return;
    speedBusy = true;
    const btn = $('speedRun'), stats = $('speedStats');
    btn.disabled = true;
    const res = {};
    const show = () => kv(stats, [
      ['Latency', res.lat != null ? `${Math.round(res.lat)} ms` : '…'],
      ['Jitter', res.jit != null ? `${Math.round(res.jit)} ms` : ''],
      ['Server', res.colo ? `Cloudflare ${res.colo}` : ''],
      ['Tested', res.at ? new Date(res.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''],
    ]);
    try {
      setGauge('gDown', null); setGauge('gUp', null);
      btn.textContent = 'Measuring latency…'; show();
      const ps = [];
      for (let i = 0; i < 10; i++) { const p = await ping(); ps.push(p.ms); res.colo = p.colo || res.colo; }
      ps.shift();   // the first opens the connection
      res.lat = median(ps);
      res.jit = ps.slice(1).reduce((a, v, i) => a + Math.abs(v - ps[i]), 0) / (ps.length - 1);
      show();
      btn.textContent = 'Testing download…';
      const dl = [];
      for (const b of [1e5, 1e6, 5e6, 10e6]) { const m = await down(b); dl.push(m); setGauge('gDown', Math.max(...dl)); if (b >= 1e6 && m < 5) break; }
      res.down = Math.max(...dl.slice(-2));
      setGauge('gDown', res.down);
      btn.textContent = 'Testing upload…';
      const ul = [];
      for (const b of [1e5, 1e6, 3e6]) { const m = await up(b); ul.push(m); setGauge('gUp', Math.max(...ul)); if (b >= 1e6 && m < 3) break; }
      res.up = Math.max(...ul.slice(-2));
      setGauge('gUp', res.up);
      res.at = Date.now();
      show();
      try { localStorage.setItem('te-m-speed', JSON.stringify(res)); } catch (_) { /* */ }
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
    if (lastSpeed && !speedBusy) {
      setGauge('gDown', lastSpeed.down); setGauge('gUp', lastSpeed.up);
      kv($('speedStats'), [['Latency', `${Math.round(lastSpeed.lat)} ms`], ['Jitter', `${Math.round(lastSpeed.jit)} ms`],
        ['Server', lastSpeed.colo ? `Cloudflare ${lastSpeed.colo}` : ''],
        ['Tested', new Date(lastSpeed.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })]]);
      $('speedRun').textContent = 'Run again';
    }
  }

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
  async function refreshNet() {
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
      ['Nearest edge', edge && edge.colo ? `Cloudflare ${edge.colo}` : ''],
      ['Browser estimate', conn && conn.downlink ? `${conn.downlink} Mbps · ${conn.rtt} ms` : ''],
      ['Data saver', conn && conn.saveData ? 'On' : ''],
      ['Last speed test', lastSpeed ? `${lastSpeed.down.toFixed(1)} ↓ / ${lastSpeed.up.toFixed(1)} ↑ Mbps` : 'Run one in Tests'],
      ['Provider', room && room.org ? room.org + (room.asn ? ` (AS${room.asn})` : '') : ''],
      ['Public IP', room && room.ip ? room.ip : ''],
    ]);
  }
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
  // Now, top right of the weather globe; the next 12 hours atop the sheet.
  const WX_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function renderNow() {
    const A = window.TEApp; if (!A) return;
    const w = A.weather ? A.weather() : {}, n = w.now, c = n && n.current, d = n && n.daily, room = A.room && A.room();
    const WMO = (window.WxBrief && window.WxBrief.WMO) || {};
    $('wnPlace').textContent = (w.brief && w.brief.city) || (room && room.city) || 'My location';
    if (c) {
      if (A.drawWx) A.drawWx($('wnIcon'), c.weather_code, c.is_day === 1, 40);
      $('wnTemp').textContent = Math.round(c.temperature_2m) + '°';
      $('wnDesc').textContent = (WMO[c.weather_code] || '').replace(/^./, (x) => x.toUpperCase());
      $('wnHL').textContent = d ? `H:${Math.round(d.temperature_2m_max[0])}°  L:${Math.round(d.temperature_2m_min[0])}°` : '';
    }
    const al = (w.brief && w.brief.alertInfo) || [];
    $('wnAlert').hidden = !al.length;
    $('wnAlert').textContent = al.length ? '⚠ ' + al[0].event : '';
    const hr = n && n.hourly, cells = [];
    if (hr && hr.time) {
      const nowMs = Date.now() - 30 * 60e3;
      hr.time.forEach((t, i) => {
        const wall = Date.parse(t + 'Z'), at = wall - (n.utc_offset_seconds || 0) * 1000;
        if (at >= nowMs && cells.length < 12) cells.push({ label: cells.length ? new Date(wall).toLocaleTimeString([], { hour: 'numeric', timeZone: 'UTC' }) : 'Now',
          temp: hr.temperature_2m[i], code: hr.weather_code[i], day: hr.is_day[i] === 1, pop: hr.precipitation_probability ? hr.precipitation_probability[i] : 0 });
      });
    }
    $('wxHours').innerHTML = cells.map((x, i) => `<li><span>${esc(x.label)}</span><canvas data-h="${i}"></canvas><em>${x.pop >= 20 ? x.pop + '%' : ''}</em><b>${Math.round(x.temp)}°</b></li>`).join('');
    $('wxHours').querySelectorAll('canvas').forEach((cv) => { const x = cells[+cv.dataset.h]; if (A.drawWx) A.drawWx(cv, x.code, x.day, 26); });
  }
  function refreshWeather() {
    const A = window.TEApp; if (!A) return;
    if (!wxOpened) { wxOpened = true; A.openForecast(null, true); } else if (!$('wxCard').classList.contains('other')) A.renderForecast();
    syncLayers(); renderNow();
  }
  addEventListener('te-weather', () => { if (tab === 'weather') renderNow(); });
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
})();
