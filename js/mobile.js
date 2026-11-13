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
  const views = { home: $('viewHome'), weather: $('viewWeather'), tests: $('viewTests'), phone: $('viewPhone'), tenant: $('viewTenant') };
  let tab = 'home';
  function setTab(name, fromPop) {
    // Weather again (Show radar, a county): fold the sheet to show its globe.
    if (name === 'weather' && tab === 'weather') { foldWx(true); return; }
    // Keep the device Back button / swipe inside the app: each tab change is a
    // history entry, so Back returns to the previous tab instead of leaving.
    if (!fromPop && name !== tab) { try { history.pushState({ teTab: name }, ''); } catch (_) { /* */ } }
    if ((name === 'globe' || name === 'weather') && window.TEApp && window.TEApp.enterView) window.TEApp.enterView(name);
    tab = name;
    document.body.dataset.tab = name;
    for (const [k, v] of Object.entries(views)) v.hidden = k !== name;
    document.querySelectorAll('#tabbar [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    try { sessionStorage.setItem('te-m-tab', name); } catch (_) { /* */ }
    if (name === 'globe' || name === 'weather') window.dispatchEvent(new Event('resize'));
    if (name === 'phone') refreshPhone();
    if (name === 'tests') refreshTests();
    if (name === 'home') { refreshHome(); spinRings(); }
    if (name === 'weather') refreshWeather();
    if (name === 'globe') updateOTabs();
    if (name === 'tenant') renderTenant();
  }

  // ── Outages: the user's own ThousandEyes tenant - active alerts ───────────
  const AL_SEV = { CRITICAL: 3, MAJOR: 3, MINOR: 2, INFO: 1, WARNING: 2 };
  function alertSince(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min'; if (s < 86400) return Math.round(s / 3600) + ' h'; return Math.round(s / 86400) + ' d';
  }
  const sevCls = (sv) => { sv = (sv || '').toUpperCase(); return sv === 'CRITICAL' || sv === 'MAJOR' ? 'bad' : sv === 'MINOR' || sv === 'WARNING' ? 'warn' : 'info'; };
  // Normalise an alert across the nested (test/rule/target) and flat
  // (testName/ruleName/ruleExpression) shapes the API can return, and fall back
  // to the tests list by id, so an alert always shows real detail - not just "Alert".
  const parseTs = (v) => { if (!v) return 0; const d = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + 'Z'); return isFinite(d) ? d : 0; };
  function normAlert(a) {
    const t = a.test || {}, r = a.rule || {}, tg = a.target || {};
    let name = t.name || a.testName || tg.name || a.targetName || '';
    if (!name) { const tid = a.testId || t.id; if (tid && window.TEConn) { const tt = TEConn.tests().find((x) => String(x.testId || x.id) === String(tid)); if (tt) name = tt.testName || tt.name; } }
    if (!name) name = r.name || a.ruleName || '';
    const cond = r.expressionText || a.ruleExpression || a.expressionText || r.name || a.ruleName || '';
    const type = t.type || r.type || a.alertType || a.type || '';
    const start = (a.start || a.dateStartMs || 0) || parseTs(a.dateStart);
    const end = (a.end || a.dateEndMs || 0) || parseTs(a.dateEnd);
    const active = a.active != null ? !!a.active : (['ACTIVE', 'TRIGGERED'].includes(String(a.state || a.status || '').toUpperCase()) || (!end));
    const agents = (a.monitors && a.monitors.length) || (a.agents && a.agents.length) || a.affectedAgents || a.agentCount || 0;
    const perma = (a.links && (a.links.appLink || a.links.self)) || a.permalink || (a.apiLinks && a.apiLinks[0] && a.apiLinks[0].href) || '';
    return {
      sev: (a.severity || '').toUpperCase(), title: name || (type ? type + ' alert' : 'ThousandEyes alert'),
      cond, type, start, end, active, agents, viol: a.violationCount || a.violations || 0,
      rule: r.name || a.ruleName || '', id: a.id || a.alertId || '', testId: a.testId || t.id || '', perma,
    };
  }
  // The shared deep-detail body for an alert (used on Home and in the tenant panel).
  function alertDetail(n, withOpen) {
    const rows = [];
    if (n.cond) rows.push(['Condition', n.cond]);
    if (n.type) rows.push(['Type', n.type]);
    if (n.sev) rows.push(['Severity', n.sev]);
    if (n.rule && n.rule !== n.title) rows.push(['Alert rule', n.rule]);
    if (n.start) rows.push(['Started', new Date(n.start).toLocaleString()]);
    rows.push(['Status', n.active ? `Active · ${alertSince(n.start)} so far` : (n.end ? `Cleared ${alertSince(n.end)} ago` : 'Cleared')]);
    if (n.viol) rows.push(['Violations', String(n.viol)]);
    if (n.agents) rows.push(['Agents affected', String(n.agents)]);
    if (n.id) rows.push(['Alert ID', String(n.id)]);
    return `<dl class="al-kv">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
      + (withOpen ? `<button type="button" class="al-open" data-act="tenant">Open in My ThousandEyes ›</button>` : '');
  }
  const alKey = (n) => String(n.id || n.title || '');
  const openAlerts = new Set();   // which alerts are expanded (kept across refreshes)
  // Two equivalent views in the outage sheet, one row of tabs: the global
  // "Around the World" and the user's own "My ThousandEyes" (shown only when
  // connected). Only one is visible at a time, so the sheet stays compact.
  let oTab = 'world';
  try { oTab = sessionStorage.getItem('te-m-otab') || 'world'; } catch (_) { /* */ }
  function setOTab(t) {
    if (t === 'tenant' && !(window.TEConn && TEConn.on())) t = 'world';
    oTab = t;
    try { sessionStorage.setItem('te-m-otab', t); } catch (_) { /* */ }
    document.querySelectorAll('#oTabs .ot-tab').forEach((b) => b.classList.toggle('on', b.dataset.otab === t));
    const tenant = $('teTenant'), world = $('owSection'), win = $('winBtn');
    if (tenant) tenant.hidden = t !== 'tenant';
    if (world) world.hidden = t !== 'world';
    if (win) win.style.display = t === 'world' ? '' : 'none';
    if (t === 'tenant') renderTenantOutages();
  }
  function updateOTabs() {
    // Tenant lives in its own tab now - Outages is global only.
    const btn = document.querySelector('#oTabs .ot-tab[data-otab="tenant"]');
    if (btn) btn.hidden = true;
    setOTab('world');
  }
  // The dedicated ThousandEyes tab: the connect card, active alerts and the
  // endpoint match (moved here from Network / Outages / This Device).
  (function buildTenant() {
    const root = $('tnRoot'); if (!root) return;
    ['teConnCard', 'teTenant', 'phTE'].forEach((id) => { const el = $(id); if (el) root.appendChild(el); });
  })();
  function renderTenant() {
    const on = !!(window.TEConn && TEConn.on());
    const t = $('teTenant'), ep = $('phTE');
    if (t) t.hidden = !on;
    if (ep) ep.hidden = !on;
    if (on) { TEConn.refresh(); renderTenantOutages(); renderTEEndpoint(); }
  }
  // This Device = the old Home + the phone merged: the live connection timeline
  // and per-service timelines sit under the hero, device detail under the feed.
  (function buildThisDevice() {
    // Front screen shows summary tiles (Connection, Services); the connection
    // and service timelines live on the Network tab. Only the device detail
    // (battery / location / device) moves under "Happening now" here.
    const extra = $('hmDeviceExtra');
    if (extra) ['phBat', 'phLoc', 'phDev'].forEach((id) => { const el = $(id); if (el) extra.appendChild(el); });
  })();
  function renderTenantOutages() {
    if (!window.TEConn || !TEConn.on()) return;
    TEConn.refresh();
    const alerts = TEConn.alerts().slice().sort((a, b) => (AL_SEV[(b.severity || '').toUpperCase()] || 0) - (AL_SEV[(a.severity || '').toUpperCase()] || 0) || (b.start || 0) - (a.start || 0));
    const badge = $('oTenantBadge'); if (badge) { badge.textContent = alerts.length; badge.hidden = !alerts.length; badge.className = 'ot-badge' + (alerts.some((a) => ['CRITICAL', 'MAJOR'].includes((a.severity || '').toUpperCase())) ? '' : ' minor'); }
    const host = $('teAlerts'); if (!host) return;
    if (!alerts.length) { host.innerHTML = '<p class="te-clear">No active alerts in your tenant right now.</p>'; return; }
    host.innerHTML = alerts.slice(0, 40).map((a) => {
      const n = normAlert(a);
      return `<div class="te-al al-exp ${sevCls(n.sev)}" data-aid="${esc(alKey(n))}">
        <div class="te-al-row">
        <span class="te-al-dot"></span>
        <div class="te-al-main"><b>${esc(n.title)}</b><span>${esc([n.cond, n.type].filter(Boolean).join(' · '))}</span></div>
        <div class="te-al-meta"><span>${esc(n.sev || '')}</span><small>${n.start ? alertSince(n.start) : ''}${n.viol ? ' · ' + n.viol + '\u00d7' : ''}</small></div>
        </div>
        <div class="al-detail">${alertDetail(n, false)}</div>
      </div>`;
    }).join('');
    host.querySelectorAll('.te-al').forEach((al) => { if (openAlerts.has(al.dataset.aid)) al.classList.add('open'); });
  }
  $('teAlerts').addEventListener('click', (e) => {
    const al = e.target.closest('.te-al.al-exp'); if (!al) return;
    if (window.Sfx) window.Sfx.play('tap');
    const op = al.classList.toggle('open');
    if (op) openAlerts.add(al.dataset.aid); else openAlerts.delete(al.dataset.aid);
  });
  addEventListener('te-conn', () => { updateOTabs(); if (tab === 'tenant') renderTenant(); });
  addEventListener('te-data', () => { if (tab === 'tenant') renderTenant(); });
  window.TEMobile = { setTab: (t) => setTab(t), tab: () => tab, foldWx: (v) => foldWx(v) };
  document.getElementById('tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b && b.dataset.tab !== tab) { if (window.Sfx) window.Sfx.play('tap'); setTab(b.dataset.tab); }
  });
  // ── Flow between tabs: This Device -> Network -> Outages -> Tenant -> Weather.
  // Edge arrows (tap) and left/right swipes follow the traffic flow. ─────────
  const TAB_ORDER = ['home', 'tests', 'globe', 'tenant', 'weather'];
  // ── Seamless pager: drag left/right and the screens follow your finger (hold
  // and they hold), release to complete or snap back. Arrows / taps animate the
  // same way. A view slides over / off the globe, which stays as the backdrop.
  const screenEl = (name) => views[name] || null;   // null = the globe backdrop
  const vw = () => window.innerWidth;
  const clearT = (el) => { if (el) { el.style.transition = ''; el.style.transform = ''; } };
  function settle(cur, nxt, toName) {
    clearT(cur); clearT(nxt);
    if (toName) setTab(toName); else if (nxt && nxt !== screenEl(tab)) nxt.hidden = true;
  }
  function slideTo(dir) {                              // programmatic (arrows / taps)
    const to = TAB_ORDER[TAB_ORDER.indexOf(tab) + dir]; if (!to) return;
    const W = vw(), cur = screenEl(tab), nxt = screenEl(to), DUR = 280, E = 'cubic-bezier(.4,0,.2,1)';
    if (nxt) { nxt.hidden = false; nxt.style.transition = 'none'; nxt.style.transform = `translateX(${dir > 0 ? W : -W}px)`; void nxt.offsetWidth; }
    if (cur) cur.style.transition = `transform ${DUR}ms ${E}`;
    if (nxt) nxt.style.transition = `transform ${DUR}ms ${E}`;
    requestAnimationFrame(() => { if (cur) cur.style.transform = `translateX(${dir > 0 ? -W : W}px)`; if (nxt) nxt.style.transform = 'translateX(0)'; });
    setTimeout(() => settle(cur, nxt, to), DUR + 30);
  }
  // Interactive finger-follow drag.
  let pg = null;
  const PG_IGNORE = 'input, textarea, select, [contenteditable]';
  function pgNeighbor(dir) {
    const name = TAB_ORDER[TAB_ORDER.indexOf(tab) + dir] || null;
    if (pg.nbrName === name) return;
    if (pg.nbrEl && pg.nbrEl !== screenEl(tab)) { clearT(pg.nbrEl); pg.nbrEl.hidden = true; }
    pg.nbrName = name; pg.nbrEl = name ? screenEl(name) : null;
    if (pg.nbrEl) pg.nbrEl.hidden = false;
  }
  addEventListener('pointerdown', (e) => {
    if (pg || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const t = e.target; if (t && t.closest && t.closest(PG_IGNORE)) return;
    // Only start from the outer 25% on either side; the middle 50% is left for
    // other gestures (globe, drawer, taps) so paging doesn't steal them.
    const W = vw();
    if (e.clientX > W * 0.25 && e.clientX < W * 0.75) return;
    pg = { x0: e.clientX, y0: e.clientY, axis: null, W, curEl: null, nbrEl: null, nbrName: undefined, dx: 0, dir: 0, moved: false, t0: Date.now() };
  }, { capture: true, passive: true });
  addEventListener('pointermove', (e) => {
    if (!pg) return;
    const dx = e.clientX - pg.x0, dy = e.clientY - pg.y0;
    if (!pg.axis) {
      if (Math.abs(dx) < 9 && Math.abs(dy) < 9) return;
      pg.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (pg.axis === 'x') pg.curEl = screenEl(tab);
    }
    if (pg.axis !== 'x') return;                        // vertical: let it scroll
    pg.moved = true;
    const dir = dx < 0 ? 1 : -1; pg.dir = dir;
    pgNeighbor(dir);
    const d = pg.nbrName ? dx : dx * 0.28;              // rubber-band at the ends
    pg.dx = d;
    if (pg.curEl) { pg.curEl.style.transition = 'none'; pg.curEl.style.transform = `translateX(${d}px)`; }
    if (pg.nbrEl) { pg.nbrEl.style.transition = 'none'; pg.nbrEl.style.transform = `translateX(${(dir > 0 ? pg.W : -pg.W) + d}px)`; }
    if (e.cancelable) e.preventDefault();
  }, { capture: true, passive: false });
  function pgEnd(cancel) {
    if (!pg) return; const p = pg; pg = null;
    if (p.axis !== 'x' || !p.moved) { clearT(p.curEl); if (p.nbrEl && p.nbrEl !== screenEl(tab)) { clearT(p.nbrEl); p.nbrEl.hidden = true; } return; }
    const W = p.W, dir = p.dir, DUR = 240, E = 'cubic-bezier(.4,0,.2,1)';
    const to = TAB_ORDER[TAB_ORDER.indexOf(tab) + dir];
    const fast = (Date.now() - p.t0) < 350 && Math.abs(p.dx) > 40;
    const commit = !cancel && to && (Math.abs(p.dx) > W * 0.32 || fast);
    if (p.curEl) p.curEl.style.transition = `transform ${DUR}ms ${E}`;
    if (p.nbrEl) p.nbrEl.style.transition = `transform ${DUR}ms ${E}`;
    requestAnimationFrame(() => {
      if (commit) { if (p.curEl) p.curEl.style.transform = `translateX(${dir > 0 ? -W : W}px)`; if (p.nbrEl) p.nbrEl.style.transform = 'translateX(0)'; }
      else { if (p.curEl) p.curEl.style.transform = 'translateX(0)'; if (p.nbrEl) p.nbrEl.style.transform = `translateX(${dir > 0 ? W : -W}px)`; }
    });
    setTimeout(() => { if (commit) settle(p.curEl, p.nbrEl, to); else { clearT(p.curEl); if (p.nbrEl && p.nbrEl !== screenEl(tab)) { clearT(p.nbrEl); p.nbrEl.hidden = true; } } }, DUR + 30);
  }
  addEventListener('pointerup', () => pgEnd(false), { capture: true, passive: true });
  addEventListener('pointercancel', () => pgEnd(true), { capture: true, passive: true });
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

  if (conn && conn.addEventListener) conn.addEventListener('change', () => { if (tab === 'home') refreshHome(); });
  addEventListener('online', () => tab === 'home' && refreshHome());
  addEventListener('offline', () => tab === 'home' && refreshHome());

  // ── Phone: battery (Chrome on Android; not Safari) ───────────────────────
  let battery = null;
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      battery = b;
      ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((ev) => b.addEventListener(ev, () => tab === 'home' && refreshBattery()));
      if (tab === 'home') refreshBattery();
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

  function refreshPhone() { refreshNet(); refreshBattery(); refreshLoc(); refreshDev(); renderTEEndpoint(); }
  setInterval(() => { if (tab === 'home') refreshLoc(); }, 5000);

  // ── Phone: match this device to its ThousandEyes Endpoint Agent ───────────
  // The browser can't read the installed agent's ID, so the match is
  // best-effort: same public IP, then the platform and most-recent heartbeat.
  function deviceGuess() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return { k: 'ios', label: 'iPhone / iPad' };
    if (/Android/.test(ua)) return { k: 'android', label: 'Android' };
    if (/Macintosh|Mac OS X/.test(ua)) return { k: 'mac', label: 'Mac' };
    if (/Windows/.test(ua)) return { k: 'windows', label: 'Windows' };
    if (/CrOS/.test(ua)) return { k: 'chromeos', label: 'ChromeOS' };
    return { k: '', label: 'This device' };
  }
  function sinceStr(iso) {
    const t = Date.parse(iso); if (!isFinite(t)) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago';
  }
  const PLAT = { windows: 'Windows', mac: 'macOS', android: 'Android', ios: 'iOS', roomos: 'RoomOS', linux: 'Linux' };
  const cap = (v) => (v ? String(v).replace(/^./, (c) => c.toUpperCase()) : '');
  function epDetail(e) {
    const rows = [], add = (k, v) => { if (v) rows.push([k, v]); };
    add('Operating system', [PLAT[e.platform] || e.platform, e.osVersion].filter(Boolean).join(' '));
    add('Model', [e.manufacturer, e.model].filter(Boolean).join(' '));
    add('Serial', e.serialNumber);
    add('License', cap(e.licenseType));
    add('Battery', cap(e.batteryLevel));
    add('Network adapter', [e.nicModel, e.nicDriverVersion].filter(Boolean).join(' · '));
    const dep = {}; (e.deploymentInfo || []).forEach((d) => { dep[d.key] = d.value; });
    add('Deployment', [cap(dep.managementMode), dep.installMethod].filter(Boolean).join(' · '));
    add('Public IP', e.publicIP);
    add('Status', cap(e.status));
    add('Last seen', e.lastSeen ? sinceStr(e.lastSeen) : '');
    return rows.length ? '<dl class="ep-kv">' + rows.map((kv) => `<div><dt>${esc(kv[0])}</dt><dd>${esc(kv[1])}</dd></div>`).join('') + '</dl>' : '';
  }
  function epRow(e, cls) {
    const live = sinceStr(e.lastSeen), recent = Date.now() - Date.parse(e.lastSeen) < 15 * 60e3;
    return `<div class="ep-row ${cls || ''}">
      <span class="ep-dot ${recent ? 'on' : ''}"></span>
      <div class="ep-main"><b>${esc(e.name || e.computerName || 'Agent')}</b><span>${esc(PLAT[e.platform] || e.platform || '')}${e.osVersion ? ' · ' + esc(e.osVersion) : ''}</span></div>
      <div class="ep-meta"><span>${esc(e.locationName || '')}</span><small>${live ? 'seen ' + live : ''}</small></div>
    </div>`;
  }
  function renderTEEndpoint() {
    const host = $('phTEBody'); if (!host) return;
    if (!window.TEConn || !TEConn.on()) {
      host.innerHTML = '<p class="te-ep-hint">Connect your ThousandEyes tenant on the <b>Network</b> tab to match this device to its Endpoint Agent.</p>';
      return;
    }
    TEConn.refresh();
    const eps = TEConn.endpoints();
    const ip = (netInfo && netInfo.ip) || (window.TEApp && TEApp.room() && TEApp.room().ip) || null;
    if (!eps.length) { host.innerHTML = '<p class="te-ep-hint">No Endpoint Agents in this tenant, or still loading…</p>'; return; }
    const dev = deviceGuess();
    const sameIP = ip ? eps.filter((e) => e.publicIP && e.publicIP === ip) : [];
    const bySeen = (a, b) => Date.parse(b.lastSeen || 0) - Date.parse(a.lastSeen || 0);
    const platMatch = sameIP.filter((e) => e.platform === dev.k).sort(bySeen);
    const best = platMatch[0] || null;
    let html = '';
    if (best) {
      html += `<div class="ep-hdr"><span class="ep-tag ok">This device</span> matched by public IP and ${esc(dev.label)}</div>` + epRow(best, 'me') + epDetail(best);
      const others = sameIP.filter((e) => e !== best);
      if (others.length) html += `<div class="ep-sub">Others on this network (${esc(ip)})</div>` + others.sort(bySeen).map((e) => epRow(e)).join('');
    } else if (sameIP.length) {
      html += `<div class="ep-hdr">No <b>${esc(dev.label)}</b> agent on this network, but ${sameIP.length} other device${sameIP.length > 1 ? 's' : ''} at <b>${esc(ip)}</b>:</div>` + sameIP.sort(bySeen).map((e) => epRow(e)).join('');
    } else {
      html += `<div class="ep-hdr">No Endpoint Agent is reporting from this network${ip ? ' (<b>' + esc(ip) + '</b>)' : ''}. Install the ThousandEyes Endpoint Agent on this device to see it here.</div>`;
      html += `<div class="ep-sub">${eps.length} endpoint agent${eps.length > 1 ? 's' : ''} in your tenant</div>` + eps.slice().sort(bySeen).slice(0, 4).map((e) => epRow(e)).join('');
    }
    host.innerHTML = html;
  }
  addEventListener('te-conn', () => { if (tab === 'tenant') renderTEEndpoint(); });
  addEventListener('te-data', () => { if (tab === 'tenant') renderTEEndpoint(); });

  // ── Outages: a draggable bottom-sheet drawer. Grab anywhere on the header
  // and slide up / down; it snaps to collapsed / half / tall. The outage detail
  // card lives INSIDE the drawer (not floating over the globe). ──────────────
  {
    const panel = $('panel'), grab = document.createElement('button');
    grab.className = 'sheet-grab'; grab.setAttribute('aria-label', 'Drag to resize the outage list');
    panel.prepend(grab);
    // Move the detail card into the drawer, right under the tabs.
    const card = $('card'), ow = $('owSection');
    if (card && ow) panel.insertBefore(card, ow);

    const vh = () => window.innerHeight;
    // Collapsed height hugs the header (grab + tabs + stats) so there's no empty
    // gap under it; mid/max are fractions of the viewport.
    function minH() {
      const t = $('oTabs'), st = $('owSection') && $('owSection').querySelector('.stats');
      return Math.max(120, (grab.offsetHeight || 22) + (t ? t.offsetHeight : 0) + (st ? st.offsetHeight : 0) + 38);
    }
    const snaps = () => ({ min: minH(), mid: Math.round(vh() * 0.54), max: Math.round(vh() * 0.86) });
    let curH = null;
    function applyH(px, animate) {
      const s = snaps();
      px = Math.max(s.min, Math.min(s.max, px));
      curH = px;
      panel.style.transition = animate ? 'height .3s cubic-bezier(.22,1,.36,1)' : 'none';
      panel.style.height = px + 'px';
      document.body.classList.toggle('sheet-min', px <= s.min + 8);
      document.documentElement.style.setProperty('--sheet-px', px + 'px');
    }
    function snapTo(name, animate) {
      applyH(snaps()[name] || snaps().min, animate !== false);
      try { localStorage.setItem('te-m-sheet', name); } catch (_) { /* */ }
      setTimeout(() => dispatchEvent(new Event('resize')), 320);
    }
    let saved = 'min'; try { saved = localStorage.getItem('te-m-sheet') || 'min'; } catch (_) { /* */ }
    if (!['min', 'mid', 'max'].includes(saved)) saved = saved === 'open' ? 'mid' : 'min';
    requestAnimationFrame(() => applyH(snaps()[saved], false));

    // Drag from anywhere on the header (grab / tabs / stats background), but not
    // from a button, the scrolling list, or the card.
    const NODRAG = '.list, #card, .te-alerts, .ot-tab, .win-btn, .stat, .filter-all, button, input, textarea';
    let dragging = false, startY = 0, startH = 0, lastY = 0, lastT = 0, vel = 0, moved = false;
    panel.addEventListener('pointerdown', (e) => {
      if (e.target !== grab && e.target.closest(NODRAG)) return;
      dragging = true; moved = false; startY = e.clientY; startH = panel.offsetHeight; lastY = e.clientY; lastT = performance.now(); vel = 0;
      try { panel.setPointerCapture(e.pointerId); } catch (_) { /* */ }
    });
    panel.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = startY - e.clientY;
      if (Math.abs(dy) > 4) moved = true;
      if (moved) { applyH(startH + dy, false); e.preventDefault(); }
      const now = performance.now();
      if (now - lastT > 16) { vel = (lastY - e.clientY) / (now - lastT); lastY = e.clientY; lastT = now; }
    });
    const endDrag = () => {
      if (!dragging) return; dragging = false;
      if (!moved) return;                         // a tap, not a drag - leave height, let click fire
      const s = snaps(), h = curH;
      let t;
      if (vel > 0.45) t = h < s.mid ? 'mid' : 'max';
      else if (vel < -0.45) t = h > s.mid ? 'mid' : 'min';
      else { const d = { min: Math.abs(h - s.min), mid: Math.abs(h - s.mid), max: Math.abs(h - s.max) }; t = Object.keys(d).reduce((a, b) => (d[b] < d[a] ? b : a)); }
      snapTo(t, true);
    };
    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);
    // Tap the grab toggles collapsed <-> half.
    grab.addEventListener('click', () => { if (moved) return; if (window.Sfx) window.Sfx.play('tap'); snapTo(document.body.classList.contains('sheet-min') ? 'mid' : 'min', true); });
    // Selecting an outage opens the drawer (only if collapsed) so its inline
    // detail is visible; if already open, leave the user's height alone.
    $('list').addEventListener('click', (e) => { if (e.target.closest('.row:not(.row-detail)') && document.body.classList.contains('sheet-min')) snapTo('mid', true); });
    if (card) new MutationObserver(() => { if (!card.hidden && document.body.classList.contains('sheet-min')) snapTo('mid', true); }).observe(card, { attributes: true, attributeFilter: ['hidden'] });
    const oTabsEl = $('oTabs');
    if (oTabsEl) oTabsEl.addEventListener('click', (e) => { const b = e.target.closest('.ot-tab'); if (b) { if (window.Sfx) window.Sfx.play('tap'); setOTab(b.dataset.otab); } });
    updateOTabs();
    // A count (filter) or the section title opens it when collapsed.
    panel.addEventListener('click', (e) => { if (!moved && document.body.classList.contains('sheet-min') && e.target.closest('.stats, .ot-tab')) snapTo('mid', true); });
  }

  // ── Home: one glance at every tab; each card opens its tab ──────────────
  const fmtAgo = (min) => (min < 60 ? `${Math.max(1, Math.round(min))}m ago` : min < 1440 ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}m ago` : `${Math.round(min / 1440)}d ago`);
  let homeRings = {};
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
    renderHomeFeed();
    // Device detail (battery / location / device) lives under the feed.
    const q = quality();
    refreshBattery(); refreshLoc(); refreshDev();
    // Connection summary tile.
    $('hmBars').className = 'bars q' + q.bars;
    $('hmNetV').innerHTML = q.rtt != null ? `${Math.round(q.rtt)}<small>ms</small>` : '–';
    $('hmNetSub').textContent = q.label + (lastSpeed ? ` · ${Math.round(lastSpeed.down)} Mbps` : '');
    // Services summary tile (from the live service rows).
    const svcs = [...document.querySelectorAll('#roomNetRows .svc')].map((r) => ({
      name: (r.querySelector('.svc-name') || {}).textContent || '', lvl: (r.className.match(/svc-(ok|warn|bad|info|wait)/) || [])[1] || 'wait' }));
    const good = svcs.filter((x) => x.lvl === 'ok' || x.lvl === 'info').length, bad = svcs.filter((x) => x.lvl === 'bad'), warn = svcs.filter((x) => x.lvl === 'warn');
    $('hmSvcDots').innerHTML = svcs.map((x) => `<i class="svc-${x.lvl}"></i>`).join('');
    $('hmSvcV').innerHTML = svcs.length ? `${good}<small>/${svcs.length}</small>` : '–';
    $('hmSvcSub').textContent = !svcs.length ? '' : bad.length ? `${bad[0].name} not responding` : warn.length ? `${warn[0].name} slow` : svcs.some((x) => x.lvl === 'wait') ? 'Checking…' : 'All reachable';
    $('hmSvc').dataset.state = bad.length ? 'bad' : warn.length ? 'warn' : 'ok';

    // Hero rings (fuller = healthier), each tied directly to what it measures:
    //  Device  = this phone's own connection quality.
    //  Network = that connection blended with the services it can reach.
    //  Apps / Internet (Global Outages) = how many outages in the last 24 hours.
    const dev = navigator.onLine && q.bars != null ? Math.round((q.bars / 5) * 100) : 0;
    const svcScore = svcs.length ? (good / svcs.length) * 100 : null;
    const net = svcScore == null ? dev : Math.round((dev + svcScore) / 2);
    // Global Outages: count of outages in the last 24h (0 outages = full ring,
    // ~60 = empty). Active outages count a little extra.
    const since24 = Date.now() - 24 * 3600e3;
    const count = (kind) => os.reduce((n, o) => n + ((o.kind === 'network') === (kind === 'network') && o.start >= since24 ? (o.active ? 1.5 : 1) : 0), 0);
    const outScore = (n) => Math.max(0, Math.round(100 - Math.min(100, (n / 60) * 100)));
    const iiNet = outScore(count('network')), iiApp = outScore(count('application'));
    setRing('rgDevice', dev); setRing('rgNet', net); setRing('rgIINet', iiNet); setRing('rgIIApp', iiApp);
    const legRow = (x) => `<span style="color:${x[0]}"><i style="background:${x[0]}"></i>${x[1]} <b>${x[2]}%</b></span>`;
    // Apps + Internet are out on the public internet (external); Network and
    // this Device are things you run (internal).
    $('hmRingLegend').innerHTML =
      `<div class="rg-grp"><em class="rg-cat">Global Outages</em>${[['#00bceb', 'Apps', iiApp], ['#f15e22', 'Internet', iiNet]].map(legRow).join('')}</div>`
      + `<div class="rg-grp"><em class="rg-cat">This Device</em>${[['#78be20', 'Network', net], ['#7c3aed', 'Device', dev]].map(legRow).join('')}</div>`;
    homeRings = {
      rgIIApp: { name: 'Apps', color: '#00bceb', val: iiApp, desc: 'Global application outages in the last 24 hours (Microsoft 365, Zoom, Webex and more). Fewer outages fills the ring.' },
      rgIINet: { name: 'Internet', color: '#f15e22', val: iiNet, desc: 'Global network outages in the last 24 hours across ISPs and backbones. Fewer outages fills the ring.' },
      rgNet: { name: 'Network', color: '#78be20', val: net, desc: 'Your connection blended with the service checks it reaches (Webex, Microsoft, Google, AWS, Zoom).' },
      rgDevice: { name: 'Device', color: '#7c3aed', val: dev, desc: 'This phone\u2019s own connection quality to the nearest internet edge.' },
    };
  }
  // This Device: a compact overview of the service checks - every service's
  // latency as an overlapping line on one grid, with a legend. Full per-service
  // detail lives on the Network tab ("Details").
  const SVCC_COLORS = ['#16bdeb', '#78be20', '#f15e22', '#a78bfa', '#fbbf24', '#f472b6'];
  function renderSvcOverview() {
    const grid = $('hmSvccGrid'), leg = $('hmSvccLegend'); if (!grid) return;
    const probes = (window.RoomNet && window.RoomNet.probes) || [];
    const now = Date.now(), span = 3600e3, winStart = now - span;
    // Stretch the drawn data across the full width (earliest sample -> now) and
    // let it scroll as time goes on, like the connection timeline.
    let earliest = Infinity, maxMs = 60;
    probes.forEach((p) => (p.samples || []).forEach((s) => { if (s.t >= winStart) { if (s.t < earliest) earliest = s.t; if (s.ms != null) maxMs = Math.max(maxMs, s.ms); } }));
    const t0 = isFinite(earliest) ? Math.max(winStart, earliest) : now - 60e3, t1 = Math.max(now, t0 + 1000);
    maxMs = Math.min(maxMs * 1.12, 600);
    const W = 300, H = 54, X = (t) => ((t - t0) / (t1 - t0)) * W, Y = (ms) => H - 3 - (Math.min(ms, maxMs) / maxMs) * (H - 8);
    let paths = '';
    probes.forEach((p, i) => {
      const col = SVCC_COLORS[i % SVCC_COLORS.length];
      const pts = (p.samples || []).filter((s) => s.t >= t0 && s.ms != null);
      if (!pts.length) return;
      let d = pts.map((s, k) => (k ? 'L' : 'M') + X(s.t).toFixed(1) + ' ' + Y(s.ms).toFixed(1)).join(' ');
      if (pts.length === 1) d += `L${W} ${Y(pts[0].ms).toFixed(1)}`;              // a lone point still draws a line to now
      else d += `L${W} ${Y(pts[pts.length - 1].ms).toFixed(1)}`;                  // hold the last value out to now
      paths += `<path d="${d}" fill="none" stroke="${col}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/>`;
    });
    const mins = Math.round((now - t0) / 60e3);
    const axL = mins >= 59 ? '1h ago' : mins >= 1 ? mins + ' min ago' : Math.max(1, Math.round((now - t0) / 1000)) + ' s ago';
    grid.innerHTML = paths
      ? `<svg class="svcc-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${paths}</svg><span class="svcc-ax"><span>${axL}</span><span>now</span></span>`
      : '<span class="svcc-wait">Checking services…</span>';
    leg.innerHTML = probes.map((p, i) => {
      const col = SVCC_COLORS[i % SVCC_COLORS.length];
      const last = (p.samples || []).filter((s) => s.ms != null).slice(-1)[0];
      const lvl = p.status === 'down' ? 'bad' : (p.status === 'slow' || p.status === 'warn') ? 'warn' : last ? 'ok' : 'wait';
      const ms = last ? Math.round(last.ms) + ' ms' : (p.status === 'pending' ? '…' : 'no reply');
      return `<span class="svcc-lg ${lvl}"><i style="background:${col}"></i>${esc(p.name || p.label || '')} <b>${ms}</b></span>`;
    }).join('');
  }
  function setRing(id, v) {
    const el = $(id); if (!el) return;
    const c = Math.max(0, Math.min(100, v || 0));
    el.style.strokeDashoffset = String(100 - c);
    // Park so the MIDDLE of this ring's gap sits at the 4:30 clock position.
    // Arc starts at 3 o'clock and draws clockwise for c%; its gap-mid is 180deg
    // from its arc-mid, so base rotation = 225 - 1.8*c keeps the gap at 4:30.
    el.style.setProperty('--rg-base', (225 - 1.8 * c).toFixed(1) + 'deg');
    // Original per-ring spread (8 + 0.34*(100-c)) scaled to 1/5, so fuller rings
    // spin clearly faster than emptier ones, at half the previous overall speed.
    el.style.setProperty('--rg-dur', (1.6 + (100 - c) * 0.068).toFixed(2) + 's');
  }
  // Spin the rings one full turn, then let them rest. Re-runs each time Home opens.
  function spinRings() {
    const r = document.querySelector('.rings'); if (!r) return;
    r.classList.remove('spin'); void r.offsetWidth; r.classList.add('spin');
    const circles = r.querySelectorAll('.rg-val circle');
    let done = 0;
    circles.forEach((c) => c.addEventListener('animationend', () => {
      if (++done >= circles.length) r.classList.remove('spin'); // hand back to the resting transform
    }, { once: true }));
  }

  // ── Home feed: current before past - tenant active alerts, then active
  // Internet Insights outages (network + application), then recent network /
  // security news (Hacker News Algolia, keyless, best-effort). ──────────────
  const ALERT_ICO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';
  const NEWS_ICO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h13v14H5a2 2 0 0 1-2-2V7M17 8h3v9a2 2 0 0 1-2 2M7 9h7M7 13h7"/></svg>';
  const OUTAGE_ICO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>';
  const CHEV = '<svg class="chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return 'news'; } };
  let homeNews = [], newsAt = 0;
  async function loadHomeNews() {
    if (homeNews.length && Date.now() - newsAt < 30 * 60e3) return;
    newsAt = Date.now();
    const since = Math.floor((Date.now() - 21 * 864e5) / 1000), qs = ['internet outage', 'cybersecurity'];
    try {
      const res = await Promise.all(qs.map((q) => fetch(`https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=6&numericFilters=created_at_i>${since},points>40&query=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => null)));
      const seen = new Set(), out = [];
      res.forEach((d) => d && d.hits && d.hits.forEach((h) => { if (h.title && h.url && !seen.has(h.title)) { seen.add(h.title); out.push({ title: h.title, url: h.url, t: (h.created_at_i || 0) * 1000 }); } }));
      homeNews = out.sort((a, b) => b.t - a.t).slice(0, 4);
      if (tab === 'home') renderHomeFeed();
    } catch (_) { /* best-effort */ }
  }
  // Row builders - one per feed kind (a single item renders as a plain row).
  const alertRow = (n) => `<li class="feed-alert al-exp sev-${sevCls(n.sev)}" data-alert="1" data-aid="${esc(alKey(n))}"><div class="al-row"><span class="ico">${ALERT_ICO}</span><span class="nm">${esc(n.title)}<small>${esc([n.cond, n.type].filter(Boolean).join(' \u00b7 '))}</small></span><span class="ago"><em class="feed-tag sev-${sevCls(n.sev)}">${esc(n.sev || 'ALERT')}</em>${n.start ? alertSince(n.start) : ''}${CHEV}</span></div><div class="al-detail">${alertDetail(n, true)}</div></li>`;
  const outageRow = (o, A) => `<li class="${o.kind} active" data-id="${esc(o.id)}"><span class="ico">${A.iconHtml ? A.iconHtml(o) : ''}</span><span class="nm">${esc(o.name)}<small>${o.kind === 'network' ? 'Network' : 'Application'} \u00b7 ${esc(o.locations.length === 1 ? o.locations[0].name : o.locations.length + ' locations')}</small></span><span class="ago">Active</span></li>`;
  const newsRow = (n) => `<li class="feed-news" data-url="${esc(n.url)}"><span class="ico">${NEWS_ICO}</span><span class="nm">${esc(n.title)}<small>${esc(hostOf(n.url))} \u00b7 news</small></span><span class="ago">${fmtAgo((Date.now() - n.t) / 60e3)}</span></li>`;
  // Which rolled-up groups the user has expanded (kept across the 4s refresh).
  const openGroups = new Set();
  function feedGroup(key, cls, ico, rows, label, sub, tag) {
    if (!rows.length) return '';
    if (rows.length === 1) return rows[0];                        // one of a kind: show it plainly
    return `<li class="feed-group ${cls}" data-grp="${key}"><button type="button" class="grp-head" aria-expanded="false"><span class="ico">${ico}</span><span class="nm">${rows.length} ${esc(label)}<small>${esc(sub)}</small></span><span class="ago">${tag}${CHEV}</span></button><ol class="grp-body">${rows.join('')}</ol></li>`;
  }
  function renderHomeFeed() {
    const A = window.TEApp, host = $('hmList'); if (!host) return;
    // Tenant alerts now live in the dedicated Tenant tab, not here.
    // Active Internet Insights outages, biggest (most locations) first so a
    // major outage like a Microsoft one reads as the top headline.
    const act = (A && A.outages ? A.outages() : []).filter((o) => o.active)
      .sort((a, b) => (b.locations.length - a.locations.length) || (b.start || 0) - (a.start || 0));
    // Recent news, newest first.
    const news = homeNews.slice(0, 4).slice().sort((a, b) => b.t - a.t);

    const parts = [];
    // Show the top few outages as named headlines; roll any overflow.
    const TOP = 4, lead = act.slice(0, TOP), rest = act.slice(TOP);
    lead.forEach((o) => parts.push(outageRow(o, A)));
    if (rest.length) {
      const nNet = rest.filter((o) => o.kind === 'network').length, nApp = rest.length - nNet;
      const oSub = [nNet ? `${nNet} network` : '', nApp ? `${nApp} application` : ''].filter(Boolean).join(' \u00b7 ');
      parts.push(feedGroup('outages', 'g-outage', OUTAGE_ICO, rest.map((o) => outageRow(o, A)), 'more active outages', oSub, `<em class="feed-tag count">${rest.length}</em>`));
    }
    const nSub = news.length ? news[0].title : '';
    parts.push(feedGroup('news', 'g-news', NEWS_ICO, news.map(newsRow), 'news stories', nSub, `<em class="feed-tag count">${news.length}</em>`));

    const html = parts.filter(Boolean).join('');
    host.innerHTML = html || '<li class="empty">All clear \u2014 no active alerts or outages</li>';
    host.querySelectorAll('.feed-group').forEach((g) => {        // re-apply expanded state after the rebuild
      if (openGroups.has(g.dataset.grp)) { g.classList.add('open'); const h = g.querySelector('.grp-head'); if (h) h.setAttribute('aria-expanded', 'true'); }
    });
    host.querySelectorAll('.feed-alert').forEach((li) => { if (openAlerts.has(li.dataset.aid)) li.classList.add('open'); });
    const lbl = $('hmFeedLabel'); if (lbl) lbl.textContent = act.length ? 'Happening now' : homeNews.length ? 'Network & security news' : 'All clear';
    loadHomeNews();
  }
  document.querySelectorAll('#viewHome [data-go]').forEach((el) => el.addEventListener('click', () => {
    if (window.Sfx) window.Sfx.play('tap');
    setTab(el.dataset.go);
  }));
  $('hmList').addEventListener('click', (e) => {
    const head = e.target.closest('.grp-head');                  // tap a roll-up summary to expand / collapse it
    if (head) {
      const g = head.closest('.feed-group'); if (!g) return;
      const open = g.classList.toggle('open');
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) openGroups.add(g.dataset.grp); else openGroups.delete(g.dataset.grp);
      if (window.Sfx) window.Sfx.play('tap');
      return;
    }
    if (e.target.closest('.al-open')) { if (window.Sfx) window.Sfx.play('tap'); setTab('globe'); setTimeout(() => { try { setOTab('tenant'); } catch (_) { /* */ } }, 60); return; }
    const li = e.target.closest('li'); if (!li || li.classList.contains('feed-group')) return;
    if (li.dataset.url) { window.open(li.dataset.url, '_blank', 'noopener'); return; }
    if (window.Sfx) window.Sfx.play('tap');
    if (li.classList.contains('feed-alert')) { const op = li.classList.toggle('open'); if (op) openAlerts.add(li.dataset.aid); else openAlerts.delete(li.dataset.aid); return; }   // tap an alert for its deeper detail
    if (li.dataset.id && window.TEApp) { setTab('globe'); setTimeout(() => window.TEApp.selectOutage(li.dataset.id), 50); return; }
  });
  addEventListener('te-conn', () => { if (tab === 'home') renderHomeFeed(); });
  addEventListener('te-data', () => { if (tab === 'home') renderHomeFeed(); });

  // ── Home rings: press / hover a ring to see what it means; slide a finger
  // across the rings and it follows to each one. ───────────────────────────
  {
    const ringsEl = document.querySelector('#hmHero .rings'), hero = $('hmHero');
    if (ringsEl && hero) {
      const BANDS = [['rgDevice', 31], ['rgNet', 49], ['rgIINet', 67], ['rgIIApp', 85]];
      let tip = null, active = null, holding = false;
      const ringAt = (cx, cy) => {
        const r = ringsEl.getBoundingClientRect();
        const d = Math.hypot(cx - (r.left + r.width / 2), cy - (r.top + r.height / 2)) * 200 / r.width;
        if (d < 21 || d > 95) return null;
        let best = null, bd = 1e9;
        BANDS.forEach(([id, rad]) => { const g = Math.abs(d - rad); if (g < bd) { bd = g; best = id; } });
        return best;
      };
      const show = (id, cx, cy) => {
        const info = homeRings[id]; if (!info) return hide();
        if (!tip) { tip = document.createElement('div'); tip.className = 'ring-tip'; hero.appendChild(tip); }
        if (id !== active) {
          tip.innerHTML = `<b style="color:${info.color}">${esc(info.name)}<span>${info.val}%</span></b><p>${esc(info.desc)}</p>`;
          ringsEl.querySelectorAll('.rg-val circle').forEach((c) => c.classList.toggle('rg-hot', c.id === id));
          active = id;
        }
        const h = hero.getBoundingClientRect();
        tip.style.left = Math.max(92, Math.min(h.width - 92, cx - h.left)) + 'px';
        tip.style.top = Math.max(2, cy - h.top - 96) + 'px';
        tip.classList.add('on'); ringsEl.classList.add('inspect');
      };
      const hide = () => { if (tip) tip.classList.remove('on'); ringsEl.classList.remove('inspect'); ringsEl.querySelectorAll('.rg-hot').forEach((c) => c.classList.remove('rg-hot')); active = null; };
      ringsEl.addEventListener('pointerdown', (e) => { const id = ringAt(e.clientX, e.clientY); if (id) { holding = true; try { ringsEl.setPointerCapture(e.pointerId); } catch (_) { /* */ } e.preventDefault(); e.stopPropagation(); show(id, e.clientX, e.clientY); } });
      ringsEl.addEventListener('pointermove', (e) => {
        if (holding) { e.preventDefault(); const id = ringAt(e.clientX, e.clientY); id ? show(id, e.clientX, e.clientY) : hide(); return; }
        if (e.pointerType === 'mouse') { const id = ringAt(e.clientX, e.clientY); id ? show(id, e.clientX, e.clientY) : hide(); }
      });
      const end = () => { holding = false; hide(); };
      ringsEl.addEventListener('pointerup', end);
      ringsEl.addEventListener('pointercancel', end);
      ringsEl.addEventListener('pointerleave', () => { if (!holding) hide(); });
      ringsEl.addEventListener('click', (e) => e.stopPropagation());   // rings inspect, never navigate
    }
  }
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
  const startTab = (start !== 'phone' && (views[start] || start === 'globe')) ? start : 'home';
  setTab(startTab);
  // Seed history so the very first Back has a tab to return to, and route Back
  // / Forward through the tabs rather than off the page.
  try { history.replaceState({ teTab: startTab }, ''); } catch (_) { /* */ }
  addEventListener('popstate', (e) => {
    const t = e.state && e.state.teTab;
    if (t && t !== tab) setTab(t, true);
  });

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
