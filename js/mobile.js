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
  const views = { home: $('viewHome'), weather: $('viewWeather'), tests: $('viewTests'), phone: $('viewPhone'), tenant: $('viewTenant'), news: $('viewNews') };
  let tab = 'home';
  // ── Morph between Home / Outages / Weather: the cards and the drawers share
  // one top line. A light-line strikes out from the centre of that line, the
  // new surface unfolds from it, and its contents rise in, one after another.
  const GLOBE_TABS = ['home', 'globe', 'weather', 'tenant'];   // tabs drawn over the shared globe
  const MORPH_TABS = GLOBE_TABS;
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let morphT = 0;
  function morphIn(name) {
    if (reduceMotion()) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {   // after the drawer has taken its half-up height
      const el = name === 'globe' ? $('panel') : name === 'weather' ? $('viewWeather') : name === 'tenant' ? $('viewTenant') : document.querySelector('#viewHome .hm-flow');
      if (!el) return;
      let line = $('morphLine');
      if (!line) { line = document.createElement('div'); line.id = 'morphLine'; line.setAttribute('aria-hidden', 'true'); line.innerHTML = '<i></i>'; document.body.appendChild(line); }
      document.querySelectorAll('.morph-in').forEach((x) => x.classList.remove('morph-in'));
      line.classList.remove('go');
      line.style.top = Math.round(el.getBoundingClientRect().top) + 'px';
      void line.offsetWidth;
      el.classList.add('morph-in'); line.classList.add('go');
      clearTimeout(morphT);
      morphT = setTimeout(() => { el.classList.remove('morph-in'); line.classList.remove('go'); }, 900);
    }));
  }
  // Sounds as a tab opens: the drawer whooshes up and settles (Weather pings
  // its radar instead of the whoosh); Outages and News pulse a warning when
  // something is happening now.
  const sfx = (n, ms) => { if (!window.Sfx) return; if (ms) setTimeout(() => window.Sfx.play(n), ms); else window.Sfx.play(n); };
  function somethingActive(name) {
    const A = window.TEApp, act = A && A.outages ? A.outages().some((o) => o.active) : false;
    if (name === 'globe') return act;
    const hr = Date.now() - 3600e3;
    return act || homeNews.some((n) => (n.kind === 'outage' || n.kind === 'status') && n.t >= hr);
  }
  function tabSounds(name) {
    if (window.Haptic) window.Haptic.tap();   // a tick on every screen change
    if (!window.Sfx) return;
    if (name === 'home') sfx('powerUp');
    if (name === 'globe' || name === 'tenant') { sfx('drawerOpen'); sfx('settle', 420); }
    if (name === 'weather') { sfx('chime'); sfx('settle', 420); }
    let hot = false; try { hot = (name === 'globe' || name === 'news') && somethingActive(name); } catch (_) { /* news not loaded yet */ }
    if (hot) sfx('warn', name === 'globe' ? 620 : 150);
  }
  function setTab(name, fromPop) {
    // Weather again (Show radar, a county): fold the sheet to show its globe.
    if (name === 'weather' && tab === 'weather') { foldWx(true); return; }
    // Keep the device Back button / swipe inside the app: each tab change is a
    // history entry, so Back returns to the previous tab instead of leaving.
    if (!fromPop && name !== tab) { try { history.pushState({ teTab: name }, ''); } catch (_) { /* */ } }
    if (GLOBE_TABS.includes(name) && window.TEApp && window.TEApp.enterView) window.TEApp.enterView(name);
    const prevTab = tab;
    tab = name;
    if (prevTab !== name && MORPH_TABS.includes(prevTab) && MORPH_TABS.includes(name)) morphIn(name);
    if (prevTab !== name) tabSounds(name);
    document.body.dataset.tab = name;
    for (const [k, v] of Object.entries(views)) v.hidden = k !== name;
    document.querySelectorAll('#tabbar [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    try { sessionStorage.setItem('te-m-tab', name); } catch (_) { /* */ }
    if (GLOBE_TABS.includes(name)) window.dispatchEvent(new Event('resize'));
    if (name === 'home') requestAnimationFrame(() => { placeHomeGlobe(false); if (homeMeasure) homeMeasure(); });
    if (name === 'globe') requestAnimationFrame(() => { if (sheetToMid) sheetToMid(); reportGlobeArea(); });   // Outages always opens half up
    if (name === 'weather') requestAnimationFrame(() => { if (wxToMid) wxToMid(); });                          // so does Weather
    if (name === 'tenant') requestAnimationFrame(() => { if (tnToMid) tnToMid(); });                            // and Tenant
    if (name === 'phone') refreshPhone();
    if (name === 'tests') refreshTests();
    if (name === 'home') { refreshHome(); spinRings(); }
    if (name === 'weather') refreshWeather();
    if (name === 'globe') updateOTabs();
    if (name === 'tenant') renderTenant();
    if (name === 'news') renderHomeFeed();
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
  // The raw v7 alert list carries IDs, not names: alertType, alertSeverity,
  // startDate, and a meta.id that encodes the test and rule, e.g.
  // "cea:http:<testId>:<ruleId>", "cea:network:<targetId>:<testId>:<ruleId>",
  // "endpoint:scheduled-tests:HTTP:<testId>:<ruleId>". Names come from the
  // tests list, the endpoint scheduled-tests list and the alert-rules lists
  // (TEConn fetches those). Nested shapes (test / rule objects) still work.
  const ALERT_TYPE = { 'agent-to-server': 'Network', 'agent-to-agent': 'Agent to agent', 'http-server': 'HTTP server', 'page-load': 'Page load', 'web-transactions': 'Web transaction', transactions: 'Transaction', 'end-to-end-server': 'Network', 'end-to-end-agent': 'Agent to agent', 'path-trace': 'Path trace', bgp: 'BGP', 'dns-server': 'DNS server', 'dns-trace': 'DNS trace', dnssec: 'DNSSEC', 'sip-server': 'SIP server', voice: 'Voice', ftp: 'FTP', api: 'API', EndpointHttp: 'Endpoint HTTP', BrowserBot: 'Browser', Http: 'HTTP', Network: 'Network', Bgp: 'BGP' };
  const typeLabel = (t) => ALERT_TYPE[t] || String(t || '').replace(/^endpoint-?/i, 'Endpoint ').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  function prettyExpr(e) {
    if (!e) return '';
    let x = String(e);
    const M = { 'probDetail != ""': 'Error is present', 'errorType != "None"': 'Error type is any', 'pageLoadHasError == true': 'Page load has an error', 'pageLoadTimedOut == true': 'Page load timed out', '!pageLoaded': 'Page load incomplete' };
    for (const k in M) x = x.split(k).join(M[k]);
    return x.replace(/\[[^\]]*\]/g, '').replace(/[()]/g, '').replace(/\s*&&\s*/g, ' and ').replace(/\s*\|\|\s*/g, ' or ')
      .replace(/\bloss\b/g, 'Packet loss').replace(/\blatency\b/g, 'Latency').replace(/\bjitter\b/g, 'Jitter').replace(/\breachability\b/g, 'Reachability')
      .replace(/\bresponseTime\b/g, 'Response time').replace(/\bavailability\b/g, 'Availability').replace(/>=/g, '≥').replace(/<=/g, '≤').replace(/\s+/g, ' ').trim();
  }
  const idFrom = (href, re) => { const m = href && String(href).match(re); return m ? m[1] : ''; };
  function normAlert(a) {
    const t = a.test || {}, r = a.rule || {}, tg = a.target || {}, L = a._links || a.links || {};
    const meta = String((a.meta && a.meta.id) || '').split(':'), endpoint = /^endpoint/i.test(meta[0] || '') || /^endpoint/i.test(a.alertType || '');
    const num = (v) => (/^\d+$/.test(String(v || '')) ? String(v) : '');
    const testId = String(t.id || a.testId || idFrom(L.test && L.test.href, /tests\/(?:[a-z-]+\/)?(\d+)/) || (meta.length >= 4 ? num(meta[meta.length - 2]) : '') || '');
    const ruleId = String(r.id || a.alertRuleId || a.ruleId || idFrom(L.rule && L.rule.href, /rules\/(\d+)/) || (meta.length >= 3 ? num(meta[meta.length - 1]) : '') || '');
    const TC = window.TEConn;
    const tst = testId && TC ? (TC.tests().concat(TC.epTests ? TC.epTests() : [])).find((x) => String(x.testId || x.id) === testId) : null;
    const rul = ruleId && TC && TC.rules ? TC.rules().find((x) => String(x.ruleId || x.id) === ruleId) : null;
    const ruleName = r.name || a.ruleName || (rul && (rul.ruleName || rul.name)) || '';
    const testName = t.name || a.testName || (tst && (tst.testName || tst.name)) || '';
    const rawType = t.type || (tst && tst.type) || a.alertType || r.type || a.type || '';
    const type = typeLabel(rawType) + (endpoint && !/endpoint/i.test(typeLabel(rawType)) ? ' (endpoint)' : '');
    const cond = r.expressionText || a.ruleExpression || a.expressionText || prettyExpr(r.expression || (rul && rul.expression)) || '';
    const start = (a.start || a.dateStartMs || 0) || parseTs(a.startDate) || parseTs(a.dateStart);
    const end = (a.end || a.dateEndMs || 0) || parseTs(a.endDate) || parseTs(a.dateEnd);
    const st = String(a.state || a.alertState || a.status || '').toUpperCase();
    const active = a.active != null ? !!a.active : (['ACTIVE', 'TRIGGER', 'TRIGGERED'].includes(st) || (!end && st !== 'CLEAR' && st !== 'CLEARED'));
    const agents = (a.monitors && a.monitors.length) || (a.agents && a.agents.length) || a.affectedAgents || a.agentCount || 0;
    const perma = (L.app && L.app.href) || (a.links && a.links.appLink) || a.permalink || '';
    const title = testName || tg.name || a.targetName || ruleName || (type ? type + ' alert' : 'ThousandEyes alert');
    return {
      sev: String(a.severity || a.alertSeverity || '').toUpperCase(), title,
      cond, type, start, end, active, agents, viol: a.violationCount || a.violations || 0,
      rule: ruleName, target: tg.name || '', id: a.id || a.alertId || '', testId, perma,
    };
  }
  // The shared deep-detail body for an alert (used on Home and in the tenant panel).
  function alertDetail(n, withOpen) {
    const rows = [];
    if (n.cond) rows.push(['Condition', n.cond]);
    if (n.type) rows.push(['Type', n.type]);
    if (n.sev) rows.push(['Severity', n.sev]);
    if (n.rule && n.rule !== n.title) rows.push(['Alert rule', n.rule]);
    if (n.target && n.target !== n.title) rows.push(['Target', n.target]);
    if (n.start) rows.push(['Started', new Date(n.start).toLocaleString()]);
    rows.push(['Status', n.active ? `Active · ${alertSince(n.start)} so far` : (n.end ? `Cleared ${alertSince(n.end)} ago` : 'Cleared'), n.active ? '' : 'clr']);
    if (n.viol) rows.push(['Violations', String(n.viol)]);
    if (n.agents) rows.push(['Agents affected', String(n.agents)]);
    if (n.testId) rows.push(['Test ID', n.testId]);
    if (n.id) rows.push(['Alert ID', String(n.id)]);
    return `<dl class="al-kv">${rows.map(([k, v, c]) => `<div${c ? ` class="${c}"` : ''}><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
      + (n.perma && /^https:\/\/app\.thousandeyes\.com\//.test(n.perma) ? `<a class="al-open" href="${esc(n.perma)}" target="_blank" rel="noopener">View in ThousandEyes ›</a> ` : '')
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
    ['teConnCard', 'phTE'].forEach((id) => { const el = $(id); if (el) root.appendChild(el); });
    const al = $('teTenant'), sec = $('tnAlSec'); if (al && sec) sec.appendChild(al);
  })();
  let tnLocShown = false;   // Affected locations stays tucked away until asked for
  function renderTenant() {
    const on = !!(window.TEConn && TEConn.on());
    const t = $('teTenant'), ep = $('phTE');
    if (t) t.hidden = !on;
    if (ep) ep.hidden = !on;
    ['tnStats', 'tnAlSec', 'tnAgSec', 'tnTsSec', 'tnLive'].forEach((id) => { const el = $(id); if (el) el.hidden = !on; });
    $('tnLocSec').hidden = !on || !tnLocShown;   // locations only open from their tile (or a pin)
    if (!on) {
      if (window.TEApp && TEApp.setTenantPoints) TEApp.setTenantPoints([]);
      $('tnAcct').textContent = 'Connect your tenant to see your alerts on the globe';
      return;
    }
    TEConn.refresh(); renderTenantMore(); renderTenantOutages(); renderTEEndpoint();
  }

  // ── Tenant: where the alerts are. Each alert's details name the agents that
  // saw it; an agent's "City, Region, CC" is geocoded once (Open-Meteo, cached
  // on the device) and every alert at a place becomes one pin on the globe.
  let geo = {};
  try { geo = JSON.parse(localStorage.getItem('te-geo1') || '{}') || {}; } catch (_) { geo = {}; }
  const geoQ = []; let geoBusy = false;
  function geoLookup(loc) {
    if (!loc) return null;
    if (Object.prototype.hasOwnProperty.call(geo, loc)) return geo[loc] || null;
    if (!geoQ.includes(loc)) { geoQ.push(loc); pumpGeo(); }
    return null;
  }
  async function pumpGeo() {
    if (geoBusy) return; geoBusy = true;
    let got = 0;
    while (geoQ.length) {
      const loc = geoQ.shift();
      const parts = String(loc).split(',').map((x) => x.trim()).filter(Boolean);
      const city = (parts[0] || '').replace(/\s*\(.*\)\s*$/, '');
      const cc = parts.length > 1 && /^[A-Z]{2}$/.test(parts[parts.length - 1]) ? parts[parts.length - 1] : '';
      const region = parts.length > 2 ? parts[1] : (parts.length === 2 && !cc ? parts[1] : '');
      let hit = null;
      try {
        const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=10&language=en&format=json&name=' + encodeURIComponent(city));
        const res = ((r.ok ? await r.json() : null) || {}).results || [];
        const reg = (x) => !region || x.admin1 === region || (x.admin1_code || '').toUpperCase() === region.toUpperCase() || (x.admin1 || '').toLowerCase().startsWith(region.toLowerCase());
        hit = res.find((x) => (!cc || x.country_code === cc) && reg(x)) || res.find((x) => !cc || x.country_code === cc) || res[0] || null;
      } catch (_) { continue; }   // offline: try again next time
      geo[loc] = hit ? { lat: hit.latitude, lon: hit.longitude } : 0;
      got++;
      if (got % 6 === 0) renderTenant();
    }
    try { localStorage.setItem('te-geo1', JSON.stringify(geo)); } catch (_) { /* */ }
    geoBusy = false;
    if (got) renderTenant();
  }
  const MET = { loss: ['Loss', '%'], avgLatency: ['Latency', ' ms'], latency: ['Latency', ' ms'], jitter: ['Jitter', ' ms'], responseTime: ['Response', ' ms'],
    availability: ['Availability', '%'], reachability: ['Reachability', '%'], pageLoadTime: ['Page load', ' ms'], totalTime: ['Total time', ' ms'],
    connectTime: ['Connect', ' ms'], dnsTime: ['DNS', ' ms'], waitTime: ['Wait', ' ms'], throughput: ['Throughput', ' Mbps'], errorType: ['Error', ''], probDetail: ['Error', ''] };
  function fmtMetrics(m) {
    return Object.entries(m || {}).filter(([, v]) => v !== '' && v != null).slice(0, 2).map(([k, v]) => {
      const d = MET[k], n = parseFloat(v), val = isFinite(n) && /^-?[\d.]+$/.test(String(v)) ? String(Math.round(n * 10) / 10) : String(v);
      return d ? `${d[0]} ${val}${isFinite(n) && val === String(Math.round(n * 10) / 10) ? d[1] : ''}` : `${k.replace(/([A-Z])/g, ' $1').toLowerCase()} ${val}`;
    }).join(' · ');
  }
  const SEV_ORDER = ['CRITICAL', 'MAJOR', 'MINOR', 'WARNING', 'INFO'];
  let tnModel = { list: [], byAlert: new Map() }, tnPick = null;
  function tenantModel() {
    const TC = window.TEConn;
    const agents = new Map(TC.agents().map((a) => [String(a.agentId || a.id), a]));
    const eps = new Map(TC.endpoints().map((a) => [String(a.agentId || a.id), a]));
    const pts = new Map(), byAlert = new Map();
    for (const a of TC.alerts()) {
      const n = normAlert(a), det = TC.details ? TC.details(a.id) : null;
      if (!det) continue;
      const seen = [];
      for (const d of det) {
        const ag = agents.get(String(d.id)) || eps.get(String(d.id));
        const loc = (ag && (ag.location || (ag.location && ag.location.locationName))) || d.name || '';
        const who = (ag && (ag.agentName || ag.computerName)) || d.name || 'Agent';
        const m = (d.start && d.start.metrics) || d.metrics || null;
        seen.push({ agent: who, loc, metrics: m, key: loc });
        const g = geoLookup(typeof loc === 'string' ? loc : '');
        if (!g) continue;
        const p = pts.get(loc) || { key: loc, label: String(loc).split(',')[0].replace(/\s*\(.*\)\s*$/, ''), place: String(loc).split(',').slice(0, 2).join(','), lat: g.lat, lon: g.lon, alerts: [], agents: new Set(), sev: 'INFO', rows: [] };
        if (!p.alerts.some((x) => x.id === n.id)) p.alerts.push(n);
        p.agents.add(who);
        if ((AL_SEV[n.sev] || 0) > (AL_SEV[p.sev] || 0) || (AL_SEV[n.sev] === AL_SEV[p.sev] && SEV_ORDER.indexOf(n.sev) < SEV_ORDER.indexOf(p.sev))) p.sev = n.sev;
        p.rows.push({ n, agent: who, metrics: m });
        pts.set(loc, p);
      }
      byAlert.set(String(n.id), seen);
    }
    const list = [...pts.values()].map((p) => ({ ...p, count: p.alerts.length, agents: [...p.agents] }));
    // Links: other places that share an alert with this one.
    for (const p of list) {
      const ids = new Set(p.alerts.map((x) => x.id));
      p.links = list.filter((q) => q !== p && q.alerts.some((x) => ids.has(x.id))).map((q) => ({ lon: q.lon, lat: q.lat }));
    }
    list.sort((a, b) => (AL_SEV[b.sev] || 0) - (AL_SEV[a.sev] || 0) || b.count - a.count || a.label.localeCompare(b.label));
    return { list, byAlert };
  }
  function renderTenantMore() {
    const TC = window.TEConn; if (!TC || !TC.on()) return;
    tnModel = tenantModel();
    const A = window.TEApp;
    if (A && A.setTenantPoints) A.setTenantPoints(tnModel.list.map((p) => ({ key: p.key, label: p.label, lat: p.lat, lon: p.lon, sev: p.sev, count: p.count, links: p.links })));
    // Account + freshness.
    const acct = TC.account() || {}, up = TC.updatedAt ? TC.updatedAt() : 0;
    $('tnAcct').textContent = [acct.name, acct.org && acct.org !== acct.name ? acct.org : '', up ? 'updated ' + (Date.now() - up < 60e3 ? 'just now' : alertSince(up) + ' ago') : 'loading\u2026'].filter(Boolean).join(' \u00b7 ');
    // Summary tiles.
    const alerts = TC.alerts(), sev = {};
    alerts.forEach((a) => { const s = String(a.severity || 'INFO').toUpperCase(); sev[s] = (sev[s] || 0) + 1; });
    const ent = TC.agents().filter((a) => /enterprise/i.test(a.agentType || ''));
    const entOn = ent.filter((a) => /online/i.test(a.agentState || '')).length;
    const tests = TC.tests(), alertingTests = new Set(alerts.map((a) => normAlert(a).testId).filter(Boolean));
    const eps = TC.endpoints();
    const sevDots = SEV_ORDER.filter((k) => sev[k]).map((k) => `<i class="${sevCls(k)}" title="${k}">${sev[k]}</i>`).join('');
    const tile = (k, v, sub, cls, go) => `<button type="button" class="tn-stat${cls ? ' ' + cls : ''}" data-go="${go}"><b>${v}</b><span>${k}</span>${sub ? `<small>${sub}</small>` : ''}</button>`;
    $('tnStats').innerHTML = tile('Alerts', alerts.length, sevDots, alerts.length ? (sev.CRITICAL || sev.MAJOR ? 'bad' : 'warn') : 'ok', 'tnAlSec')
      + tile('Agents', ent.length ? `${entOn}<em>/${ent.length}</em>` : TC.agents().length, ent.length ? (ent.length - entOn ? `${ent.length - entOn} offline` : 'all online') : 'cloud', ent.length && ent.length - entOn ? 'warn' : 'ok', 'tnAgSec')
      + tile('Tests', tests.length, alertingTests.size ? `${alertingTests.size} alerting` : (eps.length ? `${eps.length} endpoints` : 'all clear'), alertingTests.size ? 'warn' : 'ok', 'tnTsSec')
      + tile('Locations', tnModel.list.length, tnLocShown ? 'hide list' : tnModel.list.length ? 'affected' : 'none hit', (tnModel.list.length ? 'warn' : 'ok') + (tnLocShown ? ' on' : ''), 'tnLocSec');
    // Affected locations.
    $('tnLocN').textContent = tnModel.list.length ? String(tnModel.list.length) : '';
    const pending = alerts.some((a) => TC.details && TC.details(a.id) == null) || geoQ.length;
    $('tnLocs').innerHTML = tnModel.list.length ? tnModel.list.map((p) => {
      const top = p.rows.find((r) => r.metrics && fmtMetrics(r.metrics));
      const open = tnPick === p.key;
      return `<li class="tn-loc ${sevCls(p.sev)}${open ? ' open' : ''}" data-key="${esc(p.key)}">`
        + `<div class="tn-loc-row"><span class="tn-dot"></span><div class="tn-loc-main"><b>${esc(p.place)}</b><span>${esc(p.agents.slice(0, 2).join(', ') + (p.agents.length > 2 ? ` +${p.agents.length - 2}` : ''))}${top ? ' \u00b7 ' + esc(fmtMetrics(top.metrics)) : ''}</span></div>`
        + `<div class="tn-loc-n"><b>${p.count}</b><small>alert${p.count === 1 ? '' : 's'}</small></div></div>`
        + `<ul class="tn-loc-al">${p.rows.slice(0, 12).map((r) => `<li class="${sevCls(r.n.sev)}"><b>${esc(r.n.title)}</b><span>${esc([r.agent, fmtMetrics(r.metrics), r.n.cond].filter(Boolean).join(' \u00b7 '))}</span></li>`).join('')}</ul></li>`;
    }).join('') : `<li class="tn-empty">${alerts.length ? (pending ? 'Finding where your alerts are\u2026' : 'Your alerts aren\u2019t tied to agent locations.') : 'No alerts - nothing to show on the globe.'}</li>`;
    // Enterprise agents: problems first.
    $('tnAgN').textContent = ent.length ? `${entOn} of ${ent.length} online` : '';
    $('tnAgSec').hidden = !ent.length;
    $('tnAgents').innerHTML = ent.slice().sort((a, b) => (/online/i.test(a.agentState || '') - /online/i.test(b.agentState || '')) || String(a.agentName).localeCompare(String(b.agentName))).slice(0, 40).map((a) => {
      const onl = /online/i.test(a.agentState || ''), u = a.utilization;
      const seen = a.lastSeen ? Date.parse(a.lastSeen) : 0;
      return `<li class="tn-ag ${onl ? 'on' : 'off'}"><span class="tn-dot"></span><div class="tn-ag-main"><b>${esc(a.agentName || 'Agent')}</b><span>${esc([String(a.location || '').split(',').slice(0, 2).join(','), a.network ? String(a.network).replace(/\s*\(AS \d+\)$/, '') : ''].filter(Boolean).join(' \u00b7 '))}</span></div>`
        + (onl ? `<div class="tn-ag-u" title="Utilization">${u != null ? `<i style="--u:${Math.max(0, Math.min(100, u))}%"></i><small>${u}%</small>` : '<small>online</small>'}</div>`
          : `<div class="tn-ag-u"><small class="off">${seen ? 'seen ' + alertSince(seen) + ' ago' : 'offline'}</small></div>`) + '</li>';
    }).join('');
    // Tests: by type, and the ones alerting now.
    $('tnTsN').textContent = tests.length ? String(tests.length) : '';
    const byType = {};
    tests.forEach((t) => { const k = typeLabel(t.type || ''); byType[k] = (byType[k] || 0) + 1; });
    const alertingList = [...alertingTests].map((id) => { const t = tests.find((x) => String(x.testId || x.id) === id); const al = alerts.map(normAlert).filter((n) => n.testId === id); return { id, name: (t && (t.testName || t.name)) || (al[0] && al[0].title) || 'Test ' + id, n: al.length, sev: al.reduce((s, n) => ((AL_SEV[n.sev] || 0) > (AL_SEV[s] || 0) ? n.sev : s), 'INFO'), type: t ? typeLabel(t.type) : (al[0] && al[0].type) || '' }; });
    $('tnTests').innerHTML = `<div class="tn-chips">${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span>${esc(k || 'Other')} <b>${v}</b></span>`).join('')}</div>`
      + (alertingList.length ? `<ol class="tn-tests">${alertingList.sort((a, b) => (AL_SEV[b.sev] || 0) - (AL_SEV[a.sev] || 0) || b.n - a.n).map((t) => `<li class="${sevCls(t.sev)}"><span class="tn-dot"></span><div><b>${esc(t.name)}</b><span>${esc([t.type, t.n + ' alert' + (t.n === 1 ? '' : 's')].filter(Boolean).join(' \u00b7 '))}</span></div></li>`).join('')}</ol>` : '<p class="te-clear">No tests alerting right now.</p>');
  }
  // A location row: pick it (globe turns there) and show its alerts.
  $('tnLocs').addEventListener('click', (e) => {
    const li = e.target.closest('.tn-loc[data-key]'); if (!li) return;
    if (window.Sfx) window.Sfx.play('tap');
    const k = li.dataset.key, was = tnPick === k;
    tnPick = was ? null : k;
    $('tnLocs').querySelectorAll('.tn-loc').forEach((x) => x.classList.toggle('open', x.dataset.key === tnPick));
    if (window.TEApp && TEApp.focusTenant) TEApp.focusTenant(tnPick, !was);
  });
  // The summary tiles jump to their section.
  $('tnStats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    const sec = $(b.dataset.go), v = $('viewTenant'); if (!sec || !v) return;
    if (window.Sfx) window.Sfx.play('tap');
    if (b.dataset.go === 'tnLocSec') {   // the Locations tile shows / hides the list
      tnLocShown = !tnLocShown; renderTenant();
      if (!tnLocShown) return;
    }
    if (tnSheet && tnSheet.isMin()) tnSheet.snapTo('mid');
    setTimeout(() => v.scrollTo({ top: Math.max(0, sec.offsetTop - 34), behavior: 'smooth' }), 60);
  });
  // A pin tapped on the globe: open its row.
  addEventListener('te-tenant-pick', (e) => {
    const k = e.detail && e.detail.key; tnPick = k || null;
    if (k && !tnLocShown) { tnLocShown = true; renderTenant(); }
    const rows = $('tnLocs').querySelectorAll('.tn-loc');
    rows.forEach((x) => x.classList.toggle('open', x.dataset.key === tnPick));
    if (!k) return;
    if (tnSheet && tnSheet.isMin()) tnSheet.snapTo('mid');
    const li = [...rows].find((x) => x.dataset.key === k), v = $('viewTenant');
    if (li && v) setTimeout(() => v.scrollTo({ top: Math.max(0, li.offsetTop - 40), behavior: 'smooth' }), 80);
  });
  setInterval(() => { if (tab === 'tenant' && window.TEConn && TEConn.on()) renderTenant(); }, 30e3);
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
        <div class="al-detail">${alertDetail(n, false)}${alertAgentsHtml(n)}</div>
      </div>`;
    }).join('');
    host.querySelectorAll('.te-al').forEach((al) => { if (openAlerts.has(al.dataset.aid)) al.classList.add('open'); });
  }
  // Who saw an alert, with their numbers, and a way to see it on the globe.
  function alertAgentsHtml(n) {
    const seen = tnModel.byAlert.get(String(n.id));
    if (!seen || !seen.length) return '';
    const onGlobe = seen.find((s) => tnModel.list.some((p) => p.key === s.key));
    return `<div class="al-agents"><h4>Seen by ${seen.length} agent${seen.length === 1 ? '' : 's'}</h4><ul>${seen.slice(0, 10).map((s) => `<li><b>${esc(s.agent)}</b><span>${esc(fmtMetrics(s.metrics))}</span></li>`).join('')}${seen.length > 10 ? `<li class="more">+${seen.length - 10} more</li>` : ''}</ul>`
      + (onGlobe ? `<button type="button" class="al-open" data-globe="${esc(onGlobe.key)}">Show on the globe \u203a</button>` : '') + '</div>';
  }
  $('teAlerts').addEventListener('click', (e) => {
    const gb = e.target.closest('[data-globe]');
    if (gb) {
      e.stopPropagation();
      tnPick = gb.dataset.globe;
      $('tnLocs').querySelectorAll('.tn-loc').forEach((x) => x.classList.toggle('open', x.dataset.key === tnPick));
      if (window.TEApp && TEApp.focusTenant) TEApp.focusTenant(tnPick, true);
      if (tnSheet && !tnSheet.isMin()) tnSheet.snapTo('min');
      return;
    }
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
  // Home: tell the globe where its box is (it's drawn by the shared canvas
  // behind the page). Snap while scrolling so it moves with the page.
  function placeHomeGlobe(snap) {
    const b = $('hmGlobe'); if (!b || tab !== 'home' || !window.TEApp || !window.TEApp.setHomeBox) return;
    const r = b.getBoundingClientRect();
    window.TEApp.setHomeBox({ cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: Math.min(r.width, r.height) / 2 * 0.94 }, snap);
  }
  addEventListener('resize', () => { if (tab === 'home') placeHomeGlobe(true); });
  if ($('viewHome')) $('viewHome').addEventListener('scroll', () => placeHomeGlobe(true), { passive: true });
  // Outages: centre the globe in the band between the header and the drawer
  // when the drawer is down or half up; left alone when it's pulled all the way up.
  function reportGlobeArea() {
    if ((tab !== 'globe' && tab !== 'weather' && tab !== 'tenant') || !window.TEApp || !window.TEApp.setGlobeArea) return;
    const panel = tab === 'weather' ? $('viewWeather') : tab === 'tenant' ? $('viewTenant') : $('panel'); if (!panel) return;
    const pr = panel.getBoundingClientRect();
    if (pr.height > innerHeight * 0.62) return;                 // all the way up: you can't see the globe anyway
    const br = document.querySelector('.brand'), bb = br ? br.getBoundingClientRect().bottom : 0;
    window.TEApp.setGlobeArea(bb > 0 ? bb : 56, pr.top);
  }
  // Open a view; for Outages, optionally show just SaaS ('application') or ISPs ('network').
  function goFiltered(name, filter) {
    setTab(name);
    if (name === 'globe' && window.TEApp && window.TEApp.setFilter) window.TEApp.setFilter(filter || 'all');
  }   // Network / Device are detail views, not tabs
  // No side-swipe paging: switch screens with the tab bar or the cards.
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
    if (liveBusy || tab !== 'phone' || document.hidden || $('phNet').hidden) return;
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
  // Time left: the browser's own figure when it gives one; otherwise estimated
  // from how fast the level has been dropping (logged across reloads while on
  // battery, cleared on charging).
  let batLog = [];
  try { batLog = JSON.parse(localStorage.getItem('te-batlog') || '[]').filter((x) => Date.now() - x.t < 6 * 3600e3); } catch (_) { batLog = []; }
  function logBattery() {
    if (!battery) return;
    if (battery.charging) { batLog = []; } else {
      const l = battery.level, last = batLog[batLog.length - 1];
      if (last && l > last.l) batLog = [];                       // went up: unplugged after a charge - start over
      if (!last || last.l !== l) batLog.push({ t: Date.now(), l });
      while (batLog.length > 30) batLog.shift();
    }
    try { localStorage.setItem('te-batlog', JSON.stringify(batLog)); } catch (_) { /* */ }
  }
  function batteryLeft() {                                      // seconds, or null if not known yet
    if (!battery || battery.charging) return null;
    if (isFinite(battery.dischargingTime) && battery.dischargingTime > 0) return battery.dischargingTime;
    if (batLog.length < 2) return null;
    const a = batLog[0], b = batLog[batLog.length - 1], drop = a.l - b.l, secs = (b.t - a.t) / 1000;
    return drop > 0 && secs >= 120 ? battery.level / (drop / secs) : null;
  }
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      battery = b;
      logBattery();
      ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((ev) => b.addEventListener(ev, () => {
        if (ev === 'levelchange' || ev === 'chargingchange') logBattery();
        if (tab === 'phone') refreshBattery(); else if (tab === 'home') refreshHome();
      }));
      if (tab === 'phone') refreshBattery(); else if (tab === 'home') refreshHome();
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
      [battery.charging ? 'Full in' : 'Time left', battery.charging ? fmtDur(battery.chargingTime) : (fmtDur(batteryLeft()) || 'Estimating\u2026')],
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
  setInterval(() => { if (tab === 'phone') refreshLoc(); }, 5000);

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
      host.innerHTML = '<p class="te-ep-hint">Connect your ThousandEyes tenant above to match this device to its Endpoint Agent.</p>';
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
  var sheetToMid = null, wxToMid = null, tnToMid = null, homeMidPx = () => Math.round(innerHeight * 0.46), homeMeasure = null;   // var: setTab can run before these blocks
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
    // Half up = level with the top of the Home cards, so the globe sits in the
    // same space on Home and Outages. (Measured off the Home screen, even when
    // it's hidden; falls back to 54% of the screen.)
    let midCache = 0, topCache = 0, topVh = 0;
    function cardsTop() {                       // top of the Home cards, in px from the screen top
      if (topCache && topVh === vh()) return topCache;
      const v = $('viewHome'), f = v && v.querySelector('.hm-flow');
      let top = 0;
      if (f) {
        const hid = v.hidden;
        if (hid) { v.style.visibility = 'hidden'; v.hidden = false; }
        top = f.getBoundingClientRect().top + v.scrollTop;
        if (hid) { v.hidden = true; v.style.visibility = ''; }
      }
      topVh = vh();
      topCache = top > vh() * 0.2 && top < vh() * 0.8 ? Math.round(top) : Math.round(vh() * 0.46);
      return topCache;
    }
    function midH() {
      if (midCache) return midCache;
      const bottom = panel.getBoundingClientRect().bottom;
      if (!bottom) return Math.round(vh() - 64 - cardsTop());   // hidden: a guess, not cached
      midCache = Math.max(200, Math.round(bottom - cardsTop()));
      return midCache;
    }
    addEventListener('resize', () => { midCache = 0; });
    homeMeasure = () => { topCache = 0; midCache = 0; cardsTop(); };   // exact while Home is on screen
    const snaps = () => ({ min: minH(), mid: midH(), max: Math.round(vh() * 0.86) });
    homeMidPx = () => innerHeight - cardsTop();   // half up, as height from the screen bottom
    let curH = null;
    function applyH(px, animate) {
      const s = snaps();
      px = Math.max(s.min, Math.min(s.max, px));
      curH = px; visH = px;
      panel.style.transition = animate ? 'height .3s cubic-bezier(.22,1,.36,1)' : 'none';
      panel.style.height = px + 'px';
      document.body.classList.toggle('sheet-min', px <= s.min + 8);
      document.body.classList.toggle('sheet-tall', px > vh() * 0.6);   // globe buttons would sit on the list
      document.documentElement.style.setProperty('--sheet-px', px + 'px');
    }
    // Fluid motion: while moving, the panel is held at full height and slid with
    // a GPU transform (no list re-layout per frame); when it settles, the real
    // height is committed and the transform dropped.
    let maxPx = 0, settleT = 0, visH = 0;
    const shownH = () => visH || panel.offsetHeight;
    function hold(fromH) {
      clearTimeout(settleT);
      maxPx = snaps().max;
      document.body.classList.remove('sheet-min');
      panel.style.transition = 'none';
      panel.style.height = maxPx + 'px';
      panel.style.transform = `translateY(${maxPx - fromH}px)`; visH = fromH;
    }
    function settle(name, fromH, v) {
      const to = snaps()[name] || snaps().min, dist = Math.abs(to - fromH);
      const dur = Math.round(Math.max(170, Math.min(420, dist * 0.9 - Math.abs(v || 0) * 60)));
      void panel.offsetWidth;
      panel.style.transition = `transform ${dur}ms cubic-bezier(.2, .9, .25, 1)`;
      panel.style.transform = `translateY(${maxPx - to}px)`; visH = to;
      if (to > fromH + 30) sfx('drawerOpen');
      clearTimeout(settleT);
      settleT = setTimeout(() => {
        if (Math.abs(to - fromH) > 8) sfx('settle');
        panel.style.transition = 'none'; panel.style.transform = '';
        applyH(to, false);
        try { localStorage.setItem('te-m-sheet', name); } catch (_) { /* */ }
        dispatchEvent(new Event('resize'));
        reportGlobeArea();
      }, dur + 20);
    }
    function snapTo(name) { const cur = shownH(); hold(cur); settle(name, cur, 0); }
    // Always opens half up (see setTab).
    sheetToMid = () => { clearTimeout(settleT); panel.style.transition = 'none'; panel.style.transform = ''; midCache = 0; applyH(snaps().mid, false); };
    requestAnimationFrame(() => { sheetToMid(); reportGlobeArea(); });

    // Grab it anywhere: the header always moves the drawer; in the list, pushing
    // up expands it first (then the list scrolls), and pulling down at the top
    // of the list collapses it. It follows the finger, rubber-bands at the ends,
    // and a flick carries it to the next stop.
    const list = $('list');
    const NOGRAB = 'input, textarea, select, .rdrop-menu';
    let g = null, eatClick = false;
    function gBegin(y, target) {
      if (target && target.closest && target.closest(NOGRAB)) { g = null; return; }
      g = { y0: y, last: y, t: performance.now(), v: 0, h0: shownH(), h: shownH(), inList: !!(target && target.closest && target.closest('#list')), on: false };
    }
    function gMove(y, ev) {
      if (!g) return;
      const dy = g.y0 - y;                                       // + = finger moving up
      if (!g.on) {
        if (Math.abs(dy) < 2) return;
        if (g.inList) {
          const s = snaps();
          const take = dy > 0 ? g.h0 < s.max - 4 : list.scrollTop <= 0;
          if (!take) { g = null; return; }                        // let the list scroll
        }
        g.on = true; g.y0 = y; hold(g.h0);
      }
      if (ev && ev.cancelable) ev.preventDefault();
      const now = performance.now(), dt = Math.max(1, now - g.t);
      g.v = 0.75 * ((g.last - y) / dt) + 0.25 * g.v; g.last = y; g.t = now;
      const s = snaps();
      let h = g.h0 + (g.y0 - y);
      if (h < s.min) h = s.min - Math.min(70, (s.min - h) * 0.35);  // rubber-band
      if (h > s.max) h = s.max + Math.min(14, (h - s.max) * 0.2);
      g.h = h; visH = h;
      panel.style.transform = `translateY(${maxPx - h}px)`;
    }
    function gEnd() {
      if (!g) return;
      const G = g; g = null;
      if (!G.on) return;                                         // a tap: let the click through
      eatClick = true; setTimeout(() => { eatClick = false; }, 60);
      const s = snaps(), land = G.h + G.v * 220;                 // where a flick would carry it
      const stops = [['min', s.min], ['mid', s.mid], ['max', s.max]];
      settle(stops.reduce((a, b) => (Math.abs(b[1] - land) < Math.abs(a[1] - land) ? b : a))[0], G.h, G.v);
    }
    // Touch drives it on phones (so a list drag can be claimed before the list
    // scrolls); the mouse uses pointer events.
    panel.addEventListener('touchstart', (e) => { if (e.touches.length === 1) gBegin(e.touches[0].clientY, e.target); else g = null; }, { passive: true });
    panel.addEventListener('touchmove', (e) => { if (g && e.touches.length === 1) gMove(e.touches[0].clientY, e); }, { passive: false });
    panel.addEventListener('touchend', gEnd); panel.addEventListener('touchcancel', gEnd);
    panel.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' || e.button !== 0) return; gBegin(e.clientY, e.target); if (g) g.mouse = true; });
    addEventListener('pointermove', (e) => { if (g && g.mouse) gMove(e.clientY, e); });
    addEventListener('pointerup', (e) => { if (g && g.mouse) gEnd(); });
    // A drag shouldn't also count as a tap on whatever it started on.
    panel.addEventListener('click', (e) => { if (eatClick) { e.stopPropagation(); e.preventDefault(); } }, true);
    // Tap the grab toggles collapsed <-> half.
    grab.addEventListener('click', () => { snapTo(document.body.classList.contains('sheet-min') ? 'mid' : 'min'); });
    // Selecting an outage: the drawer sits half up (opening it if collapsed,
    // leaving it if pulled taller) with the detail card scrolled to the top.
    list.addEventListener('click', (e) => {
      if (!e.target.closest('.row[data-id]')) return;
      setTimeout(() => {
        const sel = list.querySelector('.row.sel'); if (!sel) return;
        const s = snaps();
        if (shownH() < s.mid - 4) snapTo('mid');
        setTimeout(() => { list.scrollTo({ top: Math.max(0, sel.offsetTop - list.offsetTop - 6), behavior: 'smooth' }); }, 300);
      }, 30);
    });
    const oTabsEl = $('oTabs');
    if (oTabsEl) oTabsEl.addEventListener('click', (e) => { const b = e.target.closest('.ot-tab'); if (b) { if (window.Sfx) window.Sfx.play('tap'); setOTab(b.dataset.otab); } });
    updateOTabs();
    // A count (filter) or the section title opens it when collapsed.
    panel.addEventListener('click', (e) => { if (document.body.classList.contains('sheet-min') && e.target.closest('.stats, .ot-tab')) snapTo('mid'); });
  }

  // ── Home: one glance at every tab; each card opens its tab ──────────────
  const fmtAgo = (min) => (min < 60 ? `${Math.max(1, Math.round(min))}m ago` : min < 1440 ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}m ago` : `${Math.round(min / 1440)}d ago`);
  let homeRings = {};
  // Home card helpers.
  const NET_ICO = {
    wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/></svg>',
    cell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 20v-3M9 20v-6M14 20v-9M19 20V5"/></svg>',
    eth: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="8" width="12" height="9" rx="1.5"/><path d="M9.5 8V5h5v3M10 17v3M14 17v3"/></svg>',
  };
  // The device essentials: model (or OS when the model is hidden) and a short
  // spec line - OS version, cores, memory.
  function deviceSummary() {
    const ua = navigator.userAgent, h = uaHints || {};
    let model = h.model || '', os = '';
    if (h.platform === 'Android' || /Android/.test(ua)) {
      const v = (h.platformVersion || '').split('.')[0] || (ua.match(/Android (\d+)/) || [])[1] || '';
      os = ('Android ' + v).trim();
      if (!model) { const m = ua.match(/Android [\d.]+; ([^;)]+)/); if (m && m[1] !== 'K') model = m[1]; }
    } else if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
      const m = ua.match(/OS (\d+)[_.](\d+)/); os = m ? `iOS ${m[1]}.${m[2]}` : 'iOS';
      if (!model) model = /iPad/.test(ua) || /Macintosh/.test(ua) ? 'iPad' : 'iPhone';
    } else os = platform().split(' · ')[0];
    const specs = [model ? os : '', navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} cores` : '', navigator.deviceMemory ? `${navigator.deviceMemory} GB` : ''].filter(Boolean).join(' · ');
    return { model: model || os || 'This phone', specs };
  }
  function refreshHome() {
    const A = window.TEApp;
    const now = new Date();
    $('hmClock').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    $('hmDate').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    if (!A) return;
    // Weather here, under the clock.
    const w = A.weather ? A.weather() : {}, wc = w.now && w.now.current, rmW = A.room && A.room();
    const WMO = (window.WxBrief && window.WxBrief.WMO) || {};
    if (wc) {
      if (A.drawWx) A.drawWx($('hmWxIcon'), wc.weather_code, wc.is_day === 1, 26);
      $('hmWxT').textContent = Math.round(wc.temperature_2m) + '\u00b0';
      $('hmWxC').textContent = (WMO[wc.weather_code] || '').replace(/^./, (x) => x.toUpperCase());
    }
    $('hmWxP').textContent = (w.brief && w.brief.city) || (rmW && rmW.city) || '';
    $('hmWx').classList.toggle('alert', !!((w.brief && w.brief.alertInfo) || []).length);
    // Hero: how many outages are active right now.
    const os = A.outages ? A.outages() : [], h = A.windowH ? A.windowH() : 24;
    const act = os.filter((o) => o.active), win = h === 1 ? 'the last hour' : `the last ${h} hours`;
    const hero = $('hmHero');
    hero.dataset.state = !os.length && !A.outages ? 'wait' : act.length >= 5 ? 'bad' : act.length ? 'warn' : 'ok';
    const q = quality();
    // ── Four cards, clockwise along the path the traffic takes ──
    // 1) Device: the essentials (model, OS, cores, memory) and a small battery.
    const dv = deviceSummary();
    $('hmDevV').textContent = dv.model;
    $('hmDevSub').textContent = dv.specs;
    const bat = $('hmBat');
    if (battery) {
      const lv = Math.round(battery.level * 100);
      bat.hidden = false;
      bat.firstElementChild.style.width = lv + '%';
      bat.className = 't-bat' + (lv <= 20 ? ' low' : '') + (battery.charging ? ' chg' : '');
      const full = fmtDur(battery.chargingTime), left = fmtDur(batteryLeft());
      $('hmDevBatTxt').textContent = battery.charging
        ? `${lv}% · ${lv >= 100 ? 'charged' : full ? `full in ${full}` : 'charging'}`
        : `${lv}% · ${left ? `${left} left` : 'estimating time left'}`;
    } else { bat.hidden = true; $('hmDevBatTxt').textContent = ''; }
    // 2) Connection: quality + round trip, with a Wi-Fi / cellular icon.
    const ct = conn && conn.type, ck = ct === 'wifi' ? 'wifi' : ct === 'cellular' ? 'cell' : ct === 'ethernet' ? 'eth' : '';
    $('hmNetIco').innerHTML = ck ? NET_ICO[ck] : '';
    $('hmBars').className = 'bars q' + q.bars;
    $('hmNetV').innerHTML = q.rtt != null ? `${Math.round(q.rtt)}<small>ms</small>` : '–';
    const typeWord = { wifi: 'Wi-Fi', cell: 'Cellular', eth: 'Ethernet' }[ck] || (conn && conn.effectiveType ? conn.effectiveType.toUpperCase() + '-class' : '');
    $('hmNetSub').textContent = [q.label, typeWord].filter(Boolean).join(' · ');
    const edgeC = window.RoomNet && window.RoomNet.edge && window.RoomNet.edge.colo, rm = A.room && A.room();
    const isp = rm && rm.org ? String(rm.org).replace(/^AS\d+\s+/, '').replace(/,?\s*(Inc|LLC|Ltd|Corporation|Corp|Communications)\.?$/i, '') : '';
    const speed = lastSpeed ? `${Math.round(lastSpeed.down)} Mbps` : conn && conn.downlink ? `~${conn.downlink} Mbps` : '';
    $('hmNetSub2').textContent = [isp, edgeC ? `${edgeC} edge` : '', speed].filter(Boolean).join(' · ');
    // 3) Global Health: the Internet Insights headline numbers - active now,
    //    then application vs network outages in the window, and what's active.
    const hW = A.windowH ? A.windowH() : 24, since = Date.now() - hW * 3600e3;
    const inWin = os.filter((o) => o.start >= since), nApp = inWin.filter((o) => o.kind !== 'network').length, nNetO = inWin.length - nApp;
    const live = os.filter((o) => o.active).sort((a, b) => b.locations.length - a.locations.length);
    const inet = $('hmInet');
    $('hmInetV').innerHTML = `${live.length}<small>active</small>`;
    $('hmInetSub').textContent = `${nApp} SaaS · ${nNetO} ISP outages`;
    inet.querySelector('.t-k').textContent = `Global Health (${hW}h)`;
    $('hmInetSub2').textContent = live.length ? [...new Set(live.map((o) => o.name))].slice(0, 2).join(', ') + (live.length > 2 ? ` +${live.length - 2}` : '') : 'Nothing active now';
    inet.dataset.state = live.length >= 5 ? 'bad' : live.length ? 'warn' : 'ok';
    // 4) SaaS: the service checks at a glance (details on Network).
    const svcs = [...document.querySelectorAll('#roomNetRows .svc')].map((r) => ({
      name: (r.querySelector('.svc-name') || {}).textContent || '', lvl: (r.className.match(/svc-(ok|warn|bad|info|wait)/) || [])[1] || 'wait' }));
    const good = svcs.filter((x) => x.lvl === 'ok' || x.lvl === 'info').length, bad = svcs.filter((x) => x.lvl === 'bad'), warn = svcs.filter((x) => x.lvl === 'warn');
    const lat = ((window.RoomNet && window.RoomNet.probes) || []).map((p) => p.last).filter((v) => v != null);
    const avg = lat.length ? Math.round(lat.reduce((x, y) => x + y, 0) / lat.length) : null;
    $('hmSvcDots').innerHTML = svcs.map((x) => `<i class="svc-${x.lvl}"></i>`).join('');
    $('hmSvcV').innerHTML = svcs.length ? `${good}<small>/${svcs.length}</small>` : '–';
    const probes = (window.RoomNet && window.RoomNet.probes) || [], hr = Date.now() - 3600e3;
    let tot = 0, okN = 0; probes.forEach((p) => (p.samples || []).forEach((x) => { if (x.t >= hr) { tot++; if (x.ms != null) okN++; } }));
    const up = tot ? (okN / tot) * 100 : null;
    const status = !svcs.length ? '' : bad.length ? `${bad[0].name} not responding` : warn.length ? `${warn[0].name} slow` : svcs.some((x) => x.lvl === 'wait') ? 'Checking…' : 'All reachable';
    $('hmSvcSub').textContent = [status, avg != null ? `${avg} ms avg` : '', up != null ? `${up >= 99.95 ? 100 : up.toFixed(1)}% up` : ''].filter(Boolean).join(' · ');
    const ranked = probes.filter((p) => p.last != null).sort((a, b) => a.last - b.last);
    $('hmSvcSub2').textContent = ranked.length > 1 ? `Fastest ${ranked[0].name} ${Math.round(ranked[0].last)} ms · slowest ${ranked[ranked.length - 1].name} ${Math.round(ranked[ranked.length - 1].last)} ms` : '';
    $('hmSvc').dataset.state = bad.length ? 'bad' : warn.length ? 'warn' : 'ok';

    // Hero rings (fuller = healthier), each tied directly to what it measures:
    //  Device  = this phone's own connection quality.
    //  Network = that connection blended with the services it can reach.
    //  SaaS / ISPs (Global Health) = how many outages in the Outages window.
    const dev = navigator.onLine && q.bars != null ? Math.round((q.bars / 5) * 100) : 0;
    const svcScore = svcs.length ? (good / svcs.length) * 100 : null;
    const net = svcScore == null ? dev : Math.round((dev + svcScore) / 2);
    // Global Outages: count of outages in the last 24h (0 outages = full ring,
    // ~60 = empty). Active outages count a little extra.
    // Over the same window as the Outages page; ~60 outages a day empties a ring.
    const count = (kind) => os.reduce((n, o) => n + ((o.kind === 'network') === (kind === 'network') && o.start >= since ? (o.active ? 1.5 : 1) : 0), 0);
    const full = Math.max(6, (60 * hW) / 24);
    const outScore = (n) => Math.max(0, Math.round(100 - Math.min(100, (n / full) * 100)));
    const iiNet = outScore(count('network')), iiApp = outScore(count('application'));
    setRing('rgDevice', dev); setRing('rgNet', net); setRing('rgIINet', iiNet); setRing('rgIIApp', iiApp);
    const legRow = (x) => `<span class="rg-go" data-go="${x[3]}"${x[4] ? ` data-filter="${x[4]}"` : ''} style="color:${x[0]}"><i style="background:${x[0]}"></i>${x[1]} <b>${x[2]}%</b></span>`;
    // Apps + Internet are out on the public internet (external); Network and
    // this Device are things you run (internal).
    $('hmRingLegend').innerHTML =
      `<div class="rg-grp"><em class="rg-cat">Global Health (${hW}h)</em>${[['#00bceb', 'SaaS', iiApp, 'globe', 'application'], ['#f15e22', 'ISPs', iiNet, 'globe', 'network']].map(legRow).join('')}</div>`
      + `<div class="rg-grp"><em class="rg-cat">This Device</em>${[['#78be20', 'Network', net, 'tests'], ['#2557e8', 'Device', dev, 'phone']].map(legRow).join('')}</div>`;
    homeRings = {
      rgIIApp: { name: 'SaaS', color: '#00bceb', val: iiApp, desc: `Global SaaS outages in the last ${hW} hours (Microsoft 365, Zoom, Webex and more). Fewer outages fills the ring.` },
      rgIINet: { name: 'ISPs', color: '#f15e22', val: iiNet, desc: `Global ISP and backbone network outages in the last ${hW} hours. Fewer outages fills the ring.` },
      rgNet: { name: 'Network', color: '#78be20', val: net, desc: 'Your connection blended with the service checks it reaches (Webex, Microsoft, Google, AWS, Zoom).' },
      rgDevice: { name: 'Device', color: '#2557e8', val: dev, desc: 'This phone\u2019s own connection quality to the nearest internet edge.' },
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
  // News: outage-focused headlines and status-page incidents, gathered
  // server-side every few minutes (scripts/fetch_news.py, .github/workflows/
  // news.yml) into the repo's data branch. Hacker News is the fallback.
  const NEWS_URL = 'https://raw.githubusercontent.com/lucidium2000/TEMobile/data/news.json';
  let homeNews = [], newsAt = 0;
  async function loadHomeNews() {
    if (homeNews.length && Date.now() - newsAt < 5 * 60e3) return;
    newsAt = Date.now();
    try {
      const d = await fetch(`${NEWS_URL}?t=${Math.floor(Date.now() / 60e3)}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
      if (d && d.items && d.items.length) {
        homeNews = d.items.filter((n) => n.title && n.url).map((n) => ({ title: n.title, url: n.url, t: n.t, kind: n.kind || 'outage', source: n.source || hostOf(n.url) }));
        if (tab === 'news') renderHomeFeed();
        updateTabDots();
        return;
      }
    } catch (_) { /* fall through to Hacker News */ }
    const since = Math.floor((Date.now() - 7 * 864e5) / 1000), qs = [['outage', 'outage'], ['cybersecurity', 'security']];
    try {
      const res = await Promise.all(qs.map(([q]) => fetch(`https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=10&numericFilters=created_at_i>${since}&query=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => null)));
      const seen = new Set(), out = [];
      res.forEach((d, i) => d && d.hits && d.hits.forEach((h) => { if (h.title && h.url && !seen.has(h.title)) { seen.add(h.title); out.push({ title: h.title, url: h.url, t: (h.created_at_i || 0) * 1000, kind: qs[i][1], source: hostOf(h.url) }); } }));
      homeNews = out.sort((a, b) => b.t - a.t);
      if (tab === 'news') renderHomeFeed();
    } catch (_) { /* best-effort */ }
  }
  // Row builders - one per feed kind (a single item renders as a plain row).
  const alertRow = (n) => `<li class="feed-alert al-exp sev-${sevCls(n.sev)}" data-alert="1" data-aid="${esc(alKey(n))}"><div class="al-row"><span class="ico">${ALERT_ICO}</span><span class="nm">${esc(n.title)}<small>${esc([n.cond, n.type].filter(Boolean).join(' \u00b7 '))}</small></span><span class="ago"><em class="feed-tag sev-${sevCls(n.sev)}">${esc(n.sev || 'ALERT')}</em>${n.start ? alertSince(n.start) : ''}${CHEV}</span></div><div class="al-detail">${alertDetail(n, true)}</div></li>`;
  const outageRow = (o, A) => `<li class="${o.kind} active" data-id="${esc(o.id)}"><span class="ico">${A.iconHtml ? A.iconHtml(o) : ''}</span><span class="nm">${esc(o.name)}<small>${o.kind === 'network' ? 'ISP' : 'SaaS'} \u00b7 ${esc(o.locations.length === 1 ? o.locations[0].name : o.locations.length + ' locations')}</small></span><span class="ago">Active</span></li>`;
  const NEWS_TAG = { status: ['Status', 'st'], security: ['Security', 'sec'], outage: ['Outage', 'out'] };
  const newsRow = (n) => { const tg = NEWS_TAG[n.kind] || NEWS_TAG.outage;
    return `<li class="feed-news k-${tg[1]}" data-url="${esc(n.url)}"><span class="ico">${NEWS_ICO}</span><span class="nm"><span class="nt-t">${esc(n.title)}</span><small><em class="feed-tag nt-${tg[1]}">${tg[0]}</em>${esc(n.source || hostOf(n.url))}</small></span><span class="ago">${fmtAgo((Date.now() - n.t) / 60e3)}</span></li>`; };
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
    // News has its own tab now, so everything is shown expanded, in sections:
    // what Internet Insights sees right now, then outage news and status-page
    // incidents, then security.
    const parts = [];
    const sec = (t, n) => `<li class="feed-sec">${t}<b>${n}</b></li>`;
    if (act.length) { parts.push(sec('Active outages', act.length)); act.forEach((o) => parts.push(outageRow(o, A))); }
    const out = homeNews.filter((n) => n.kind !== 'security').slice(0, 30), secn = homeNews.filter((n) => n.kind === 'security').slice(0, 12);
    if (out.length) { parts.push(sec('Outage news', out.length)); out.forEach((n) => parts.push(newsRow(n))); }
    if (secn.length) { parts.push(sec('Security', secn.length)); secn.forEach((n) => parts.push(newsRow(n))); }

    const html = parts.filter(Boolean).join('');
    host.innerHTML = html || '<li class="empty">All clear \u2014 no active alerts or outages</li>';
    host.querySelectorAll('.feed-group').forEach((g) => {        // re-apply expanded state after the rebuild
      if (openGroups.has(g.dataset.grp)) { g.classList.add('open'); const h = g.querySelector('.grp-head'); if (h) h.setAttribute('aria-expanded', 'true'); }
    });
    host.querySelectorAll('.feed-alert').forEach((li) => { if (openAlerts.has(li.dataset.aid)) li.classList.add('open'); });
    const lbl = $('hmFeedLabel'); if (lbl) lbl.textContent = act.length ? 'Happening now' : homeNews.length ? 'Outage & security news' : 'All clear';
    loadHomeNews();
  }
  // Cards and links that open another view. A card can also carry an outage
  // to select (Internet -> the nearest issue) or a section to scroll to.
  document.querySelectorAll('#viewHome [data-go], #viewNews [data-go]').forEach((el) => el.addEventListener('click', () => {
    if (window.Sfx) window.Sfx.play('tap');
    setTab(el.dataset.go);
    if (el.dataset.filter && window.TEApp && window.TEApp.setFilter) window.TEApp.setFilter(el.dataset.filter);
    if (el.dataset.oid && window.TEApp) setTimeout(() => window.TEApp.selectOutage(el.dataset.oid), 60);
    if (el.dataset.scroll) setTimeout(() => { const t = $(el.dataset.scroll); if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 80);
  }));
  // Detail views (Network, Device) aren't tabs: a way back Home.
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { if (window.Sfx) window.Sfx.play('tap'); setTab('home'); }));
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
  addEventListener('te-conn', () => { if (tab === 'news') renderHomeFeed(); });
  addEventListener('te-data', () => { if (tab === 'news') renderHomeFeed(); });

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
      let tap = null;
      ringsEl.addEventListener('pointerdown', (e) => { const id = ringAt(e.clientX, e.clientY); if (id) { holding = true; tap = { id, x: e.clientX, y: e.clientY, t: Date.now() }; try { ringsEl.setPointerCapture(e.pointerId); } catch (_) { /* */ } e.preventDefault(); e.stopPropagation(); show(id, e.clientX, e.clientY); } });
      ringsEl.addEventListener('pointermove', (e) => {
        if (holding) { e.preventDefault(); const id = ringAt(e.clientX, e.clientY); id ? show(id, e.clientX, e.clientY) : hide(); return; }
        if (e.pointerType === 'mouse') { const id = ringAt(e.clientX, e.clientY); id ? show(id, e.clientX, e.clientY) : hide(); }
      });
      const end = () => { holding = false; hide(); };
      const RING_GO = { rgDevice: 'phone', rgNet: 'tests', rgIINet: 'globe', rgIIApp: 'globe' }, RING_FILTER = { rgIINet: 'network', rgIIApp: 'application' };
      ringsEl.addEventListener('pointerup', (e) => {
        const t = tap; tap = null; end();
        if (t && Date.now() - t.t < 300 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10 && RING_GO[t.id]) { if (window.Sfx) window.Sfx.play('tap'); goFiltered(RING_GO[t.id], RING_FILTER[t.id]); }
      });
      ringsEl.addEventListener('pointercancel', end);
      ringsEl.addEventListener('pointerleave', () => { if (!holding) hide(); });
      ringsEl.addEventListener('click', (e) => e.stopPropagation());   // handled on pointerup above
      // Legend entries go to their own screen (not the hero's default, Outages).
      $('hmRingLegend').addEventListener('click', (e) => {
        const g = e.target.closest('.rg-go'); if (!g) return;
        e.stopPropagation(); if (window.Sfx) window.Sfx.play('tap'); goFiltered(g.dataset.go, g.dataset.filter);
      });
    }
  }
  addEventListener('te-outages', () => tab === 'home' && refreshHome());
  addEventListener('te-weather', () => {
    updateTabDots();
    if (tab === 'home') refreshHome();
    if (tab === 'weather' && window.TEApp && !$('wxCard').classList.contains('other')) window.TEApp.renderForecast();
  });
  // Tab-bar dots: News when there's outage news or a status incident from the
  // last hour; Weather when there's a severe / extreme alert where you are.
  function updateTabDots() {
    const hr = Date.now() - 3600e3;
    const newsHot = homeNews.some((n) => (n.kind === 'outage' || n.kind === 'status') && n.t >= hr);
    const A = window.TEApp, w = A && A.weather ? A.weather() : {}, al = (w && w.brief && w.brief.alertInfo) || [];
    const wxHot = al.some((x) => /^(extreme|severe)$/i.test(x.severity || ''));
    const nb = document.querySelector('#tabbar [data-tab="news"]'), wb = document.querySelector('#tabbar [data-tab="weather"]');
    if (nb) { nb.classList.toggle('dot', newsHot); nb.setAttribute('aria-label', newsHot ? 'News - new outage news in the last hour' : 'News'); }
    if (wb) { wb.classList.toggle('dot', wxHot); wb.setAttribute('aria-label', wxHot ? 'Weather - severe weather alert here' : 'Weather'); }
  }
  setInterval(() => {
    if (tab === 'home') refreshHome(); else if (tab === 'news') renderHomeFeed();
    loadHomeNews();          // refreshes itself at most every 5 minutes, on any tab
    updateTabDots();
  }, 4000);
  setTimeout(() => { loadHomeNews(); updateTabDots(); }, 1500);

  // ── A fluid bottom sheet over the shared globe (Weather, Tenant). Three
  // stops like the Outages drawer: folded, half up (level with the Home cards -
  // where it opens) and tall. It follows the finger, flicks to the next stop,
  // and moves with a GPU transform; the real height is committed when it rests.
  let safeTop = null;
  function makeSheet(view, o) {
    const grab = document.createElement('button');
    grab.className = 'sheet-grab ' + o.grabCls; grab.setAttribute('aria-label', o.label);
    view.prepend(grab);
    let min = true, H = 0, vis = 0, maxPx = 0, settleT = 0, g = null, eat = false;
    const snaps = () => {
      const tabh = (($('tabbar') && $('tabbar').offsetHeight) || 64);
      if (safeTop == null) { const p = document.createElement('div'); p.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top,0px);visibility:hidden'; document.body.appendChild(p); safeTop = p.offsetHeight; p.remove(); }
      const max = Math.round(innerHeight - 64 - safeTop);
      const mn = Math.min(max, tabh + o.minPx);
      return { min: mn, mid: Math.max(mn + 40, Math.min(max, Math.round(homeMidPx()))), max };
    };
    function apply(px) {
      const s = snaps();
      px = Math.max(s.min, Math.min(s.max, px));
      H = px; vis = px;
      view.style.transition = 'none'; view.style.transform = '';
      view.style.height = px + 'px';
      min = px <= s.min + 8;
      if (o.minClass) document.body.classList.toggle(o.minClass, min);
      if (min) view.scrollTop = 0;
      if (o.cssVar) document.documentElement.style.setProperty(o.cssVar, px + 'px');
      reportGlobeArea();
    }
    function hold(fromH) {
      clearTimeout(settleT);
      maxPx = snaps().max;
      if (o.minClass) document.body.classList.remove(o.minClass);
      view.style.transition = 'none';
      view.style.height = maxPx + 'px';
      view.style.transform = `translateY(${maxPx - fromH}px)`; vis = fromH;
    }
    function settle(name, fromH, v) {
      const to = snaps()[name], dist = Math.abs(to - fromH);
      const dur = Math.round(Math.max(170, Math.min(420, dist * 0.9 - Math.abs(v || 0) * 60)));
      void view.offsetWidth;
      view.style.transition = `transform ${dur}ms cubic-bezier(.2, .9, .25, 1)`;
      view.style.transform = `translateY(${maxPx - to}px)`; vis = to;
      if (to > fromH + 30) sfx('drawerOpen');
      clearTimeout(settleT);
      settleT = setTimeout(() => { if (Math.abs(to - fromH) > 8) sfx('settle'); apply(to); }, dur + 20);
    }
    function snapTo(name) { const cur = vis || view.offsetHeight; hold(cur); settle(name, cur, 0); }
    const toMid = () => { clearTimeout(settleT); apply(snaps().mid); };
    requestAnimationFrame(toMid);
    grab.addEventListener('click', () => { snapTo(min ? 'mid' : 'min'); });
    view.addEventListener('click', (e) => {
      if (eat) { e.stopPropagation(); e.preventDefault(); return; }
      if (min && o.openOn && o.openOn(e)) snapTo('mid');
    }, true);
    // Drag anywhere: the grab always moves it; in the content, pushing up grows
    // it first (then it scrolls), and pulling down at the top shrinks it.
    function begin(y, target, x) {
      if (target && target.closest && target.closest('input, textarea, select') && !target.closest('.sheet-grab')) { g = null; return; }
      const h = vis || view.offsetHeight;
      g = { x0: x || 0, y0: y, last: y, t: performance.now(), v: 0, h0: h, h, grab: !!(target && target.closest && target.closest('.sheet-grab')), on: false };
    }
    function move(y, ev, x) {
      if (!g) return;
      const dy = g.y0 - y;
      if (!g.on) {
        if (Math.abs(dy) < 3 && Math.abs((x || 0) - g.x0) < 3) return;
        if (Math.abs((x || 0) - g.x0) > Math.abs(dy)) { g = null; return; }   // sideways: strips scroll
        if (!g.grab) {
          const s = snaps();
          const take = dy > 0 ? g.h0 < s.max - 4 : view.scrollTop <= 0;
          if (!take) { g = null; return; }
        }
        g.on = true; g.y0 = y; hold(g.h0);
      }
      if (ev && ev.cancelable) ev.preventDefault();
      const t = performance.now(), dt = Math.max(1, t - g.t);
      g.v = 0.75 * ((g.last - y) / dt) + 0.25 * g.v; g.last = y; g.t = t;
      const s = snaps();
      let h = g.h0 + (g.y0 - y);
      if (h < s.min) h = s.min - Math.min(70, (s.min - h) * 0.35);
      if (h > s.max) h = s.max + Math.min(14, (h - s.max) * 0.2);
      g.h = h; vis = h;
      view.style.transform = `translateY(${maxPx - h}px)`;
    }
    function end() {
      if (!g) return;
      const G = g; g = null;
      if (!G.on) return;
      eat = true; setTimeout(() => { eat = false; }, 60);
      const s = snaps(), land = G.h + G.v * 220;
      const stops = [['min', s.min], ['mid', s.mid], ['max', s.max]];
      settle(stops.reduce((a, b) => (Math.abs(b[1] - land) < Math.abs(a[1] - land) ? b : a))[0], G.h, G.v);
    }
    view.addEventListener('touchstart', (e) => { if (e.touches.length === 1) begin(e.touches[0].clientY, e.target, e.touches[0].clientX); else g = null; }, { passive: true });
    view.addEventListener('touchmove', (e) => { if (g && e.touches.length === 1) move(e.touches[0].clientY, e, e.touches[0].clientX); }, { passive: false });
    view.addEventListener('touchend', end); view.addEventListener('touchcancel', end);
    view.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' || e.button !== 0) return; begin(e.clientY, e.target, e.clientX); if (g) g.mouse = true; });
    addEventListener('pointermove', (e) => { if (g && g.mouse) move(e.clientY, e, e.clientX); });
    addEventListener('pointerup', () => { if (g && g.mouse) end(); });
    addEventListener('resize', () => { if (tab === o.tab && !g) apply(snaps()[min ? 'min' : H >= snaps().max - 4 ? 'max' : 'mid']); });
    return { snapTo, toMid, isMin: () => min };
  }

  // Weather: radar and power on the globe; folded = layer switches + hours.
  const wxView = $('viewWeather');
  const wxSheet = makeSheet(wxView, {
    tab: 'weather', grabCls: 'wx-grab', label: 'Show or hide the forecast', minPx: 196, minClass: 'wx-min', cssVar: '--wsheet-px',
    openOn: (e) => !e.target.closest('[data-fips], button') && !!e.target.closest('#wxCard, #pwrWrap, .wx-hours'),
  });
  function foldWx(v) { wxSheet.snapTo(v ? 'min' : 'mid'); }
  wxToMid = wxSheet.toMid;
  // Tenant: alerts on the globe; folded = the summary strip.
  const tnView = $('viewTenant');
  const tnSheet = tnView ? makeSheet(tnView, { tab: 'tenant', grabCls: 'tn-grab', label: 'Show or hide your tenant', minPx: 150, minClass: 'tn-min', cssVar: '--tsheet-px', openOn: () => true }) : null;
  tnToMid = tnSheet ? tnSheet.toMid : null;

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
  const startTab = (!['phone', 'tests'].includes(start) && (views[start] || start === 'globe')) ? start : 'home';
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
