// ThousandEyes tenant connection.
//
// The app reads a user's own ThousandEyes tenant through the public API. The
// API has no CORS, so calls go through a small proxy (worker/thousandeyes-proxy.js)
// that only adds the CORS header and forwards. The token lives on THIS device
// only (local- or sessionStorage), is sent only to the chosen proxy, and never
// touches the repo, the page source or anyone else.
//
// window.TEConn is the shared client the Outages and Phone views build on:
//   TEConn.on()            -> connected?
//   TEConn.account()       -> { name, org, aid } of the current account group
//   TEConn.api(path, opts) -> GET through the proxy, parsed JSON (throws on error)
//   TEConn.connect / disconnect
//   window event 'te-conn' fires whenever the connection changes.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  // Shared, stateless CORS proxy (worker/thousandeyes-proxy.js) so Connect is
  // one-tap - paste just the token. Override via "Advanced" to use your own.
  const DEFAULT_PROXY = 'https://te-proxy.lucidium2000.workers.dev';

  // Token persistence: localStorage (this device, until disconnected) or
  // sessionStorage (gone when the tab closes). Proxy URL isn't secret.
  const K = { proxy: 'te-proxy', token: 'te-token', persist: 'te-persist' };
  const store = () => (localStorage.getItem(K.persist) === '1' ? localStorage : sessionStorage);
  function load() {
    try {
      return {
        proxy: localStorage.getItem(K.proxy) || DEFAULT_PROXY,
        token: localStorage.getItem(K.token) || sessionStorage.getItem(K.token) || '',
        persist: localStorage.getItem(K.persist) === '1',
      };
    } catch (_) { return { proxy: DEFAULT_PROXY, token: '', persist: false }; }
  }
  function save(proxy, token, persist) {
    try {
      localStorage.setItem(K.proxy, proxy);       // URL isn't sensitive; remember it either way
      localStorage.setItem(K.persist, persist ? '1' : '0');
      sessionStorage.removeItem(K.token); localStorage.removeItem(K.token);
      (persist ? localStorage : sessionStorage).setItem(K.token, token);
    } catch (_) { /* private mode: stay in memory only */ }
  }
  function wipe() {
    try { [localStorage, sessionStorage].forEach((s) => { s.removeItem(K.token); }); localStorage.removeItem(K.persist); } catch (_) { /* */ }
  }

  let state = { proxy: load().proxy, token: load().token, persist: load().persist, acct: null, status: 'off' };
  let showProxy = !state.proxy;   // hidden when we have a default proxy

  const base = () => state.proxy.replace(/\/+$/, '');
  function changed() { try { dispatchEvent(new CustomEvent('te-conn', { detail: { on: state.status === 'on' } })); } catch (_) { /* */ } render(); }

  // GET a v7 path through the proxy. Never logs the token.
  async function api(path, opts = {}) {
    if (!state.proxy || !state.token) throw { status: 0, message: 'Not connected' };
    const url = base() + (path.startsWith('/') ? path : '/' + path);
    let r;
    try {
      r = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + state.token, Accept: 'application/json' }, signal: opts.signal });
    } catch (_) {
      throw { status: 0, message: 'Can’t reach the proxy. Check the Worker URL and that it’s deployed.' };
    }
    if (r.status === 401 || r.status === 403) throw { status: r.status, message: 'The token was refused (401/403). Check it’s a valid ThousandEyes API token.' };
    if (!r.ok) throw { status: r.status, message: `ThousandEyes API returned ${r.status}.` };
    try { return await r.json(); } catch (_) { throw { status: r.status, message: 'The proxy didn’t return JSON — is the Worker URL right?' }; }
  }

  async function validate() {
    const d = await api('/v7/account-groups');
    const groups = (d && d.accountGroups) || [];
    const cur = groups.find((g) => g.isCurrentAccountGroup) || groups.find((g) => g.isDefaultAccountGroup) || groups[0] || null;
    return cur ? { name: cur.accountGroupName || 'ThousandEyes', org: cur.organizationName || '', aid: cur.aid || '', count: groups.length } : { name: 'ThousandEyes', org: '', aid: '', count: groups.length };
  }

  // ── Tenant data, cached and shared by the snapshot / Outages / Phone ──────
  const cache = { at: 0, agents: null, tests: null, alerts: null, endpoints: null, loading: false };
  function withAid(path) { const a = state.acct && state.acct.aid; return a ? path + (path.includes('?') ? '&' : '?') + 'aid=' + encodeURIComponent(a) : path; }
  function pick(d) { for (let i = 1; i < arguments.length; i++) { const k = arguments[i]; if (d && Array.isArray(d[k])) return d[k]; } return []; }
  function fireData() { try { dispatchEvent(new CustomEvent('te-data', { detail: summary() })); } catch (_) { /* */ } render(); }
  async function refresh(force) {
    if (state.status !== 'on') return cache;
    if (!force && cache.at && Date.now() - cache.at < 45e3) return cache;
    if (cache.loading) return cache;
    cache.loading = true;
    try {
      // Fast, high-value data first (alerts, endpoints, tests) so the UI fills
      // in quickly; everything is scoped to the current account group by aid.
      const [al, ep, ts] = await Promise.all([
        api(withAid('/v7/alerts')).catch(() => null),
        api(withAid('/v7/endpoint/agents')).catch(() => null),
        api(withAid('/v7/tests')).catch(() => null),
      ]);
      if (al) cache.alerts = pick(al, 'alerts', 'results', 'result');
      if (ep) cache.endpoints = pick(ep, 'agents', 'results', 'result', 'endpointAgents');
      if (ts) cache.tests = pick(ts, 'tests', 'results', 'result');
      cache.at = Date.now();
      fireData();
      // Agents can be 1000+ (all the cloud vantage points): load in the
      // background so it never blocks the first paint.
      api(withAid('/v7/agents')).then((ag) => { if (ag) { cache.agents = pick(ag, 'agents', 'result'); fireData(); } }).catch(() => {});
    } finally { cache.loading = false; }
    return cache;
  }
  function summary() {
    const ag = cache.agents || [], al = cache.alerts || [];
    const sev = {}; al.forEach((x) => { const s = (x.severity || 'INFO').toUpperCase(); sev[s] = (sev[s] || 0) + 1; });
    return {
      loaded: !!cache.at,
      agents: { total: ag.length, cloud: ag.filter((a) => a.agentType === 'cloud').length, enterprise: ag.filter((a) => a.agentType === 'enterprise').length },
      tests: (cache.tests || []).length,
      endpoints: (cache.endpoints || []).length,
      alerts: { total: al.length, bySeverity: sev },
      at: cache.at,
    };
  }

  window.TEConn = {
    on: () => state.status === 'on',
    account: () => state.acct,
    proxyHost: () => { try { return new URL(base()).host; } catch (_) { return ''; } },
    api,
    refresh,
    summary,
    agents: () => cache.agents || [],
    tests: () => cache.tests || [],
    alerts: () => cache.alerts || [],
    endpoints: () => cache.endpoints || [],
    async connect(proxy, token, persist) {
      state.proxy = (proxy || '').trim(); state.token = (token || '').trim(); state.persist = !!persist;
      const acct = await validate();            // throws on bad token / proxy
      state.acct = acct; state.status = 'on';
      save(state.proxy, state.token, state.persist);
      changed();
      refresh(true);                            // pull tenant data in the background
      return acct;
    },
    disconnect() {
      state.token = ''; state.acct = null; state.status = 'off';
      cache.at = 0; cache.agents = cache.tests = cache.alerts = cache.endpoints = null;
      wipe();
      changed();
    },
  };

  // ── Card UI ───────────────────────────────────────────────────────────────
  function render() {
    const card = $('teConnCard'); if (!card) return;
    const a = state.acct;
    if (state.status === 'on' && a) {
      card.dataset.state = 'on';
      const s = summary();
      const al = s.alerts.total, sev = s.alerts.bySeverity, crit = (sev.CRITICAL || 0) + (sev.MAJOR || 0);
      const snap = !s.loaded
        ? '<div class="tec-snap loading"><i></i>Loading your tenant…</div>'
        : `<div class="tec-snap">
            <div><b>${s.agents.total}</b><span>Agents</span><small>${s.agents.cloud} cloud · ${s.agents.enterprise} ent</small></div>
            <div><b>${s.tests}</b><span>Tests</span></div>
            <div><b>${s.endpoints}</b><span>Endpoints</span></div>
            <div class="${al ? (crit ? 'bad' : 'warn') : 'ok'}"><b>${al}</b><span>Alerts</span>${al ? `<small>${crit ? crit + ' major+' : 'all minor'}</small>` : '<small>all clear</small>'}</div>
          </div>`;
      card.querySelector('.tec-body').innerHTML = `
        <div class="tec-acct">
          <div class="tec-ok"><i></i>Connected</div>
          <b>${esc(a.name)}</b>
          ${a.org ? `<span>${esc(a.org)}</span>` : ''}
          <small>via ${esc(TEConn.proxyHost())}</small>
        </div>
        ${snap}
        <div class="tec-btns"><button class="m-btn ghost" id="tecRefresh">Refresh</button><button class="m-btn ghost" id="tecOff">Disconnect</button></div>`;
      $('tecOff').addEventListener('click', () => TEConn.disconnect());
      const rf = $('tecRefresh'); if (rf) rf.addEventListener('click', () => { rf.textContent = 'Refreshing…'; refresh(true); });
      return;
    }
    card.dataset.state = state.status === 'form' ? 'form' : 'off';
    if (state.status !== 'form') {
      card.querySelector('.tec-body').innerHTML = `
        <p class="tec-intro">See your own agents, tests and alerts in the app. Your token stays on this device and is sent only to your proxy.</p>
        <button class="m-btn" id="tecStart">Connect ThousandEyes</button>`;
      $('tecStart').addEventListener('click', () => { state.status = 'form'; render(); });
      return;
    }
    const proxyHidden = !showProxy;
    card.querySelector('.tec-body').innerHTML = `
      <label class="tec-f">API token
        <div class="tec-tokrow">
          <input id="tecToken" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ThousandEyes bearer token">
          <button type="button" class="tec-scan" id="tecScan" title="Scan the token with the camera" aria-label="Scan the token with the camera"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9V7a2 2 0 0 1 2-2h2M17 5h2a2 2 0 0 1 2 2v2M21 15v2a2 2 0 0 1-2 2h-2M7 19H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.2"/></svg></button>
        </div>
      </label>
      <label class="tec-f" id="tecProxyWrap"${proxyHidden ? ' hidden' : ''}>Proxy URL
        <input id="tecProxy" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://te-proxy.you.workers.dev" value="${esc(state.proxy)}">
      </label>
      <label class="tec-chk"><input id="tecPersist" type="checkbox" ${state.persist ? 'checked' : ''}><span>Keep me connected on this device</span></label>
      <div class="tec-err" id="tecErr" hidden></div>
      <div class="tec-btns"><button class="m-btn" id="tecGo">Connect</button><button class="m-btn ghost" id="tecCancel">Cancel</button></div>
      <p class="tec-help"><a href="#" id="tecAdv">${proxyHidden ? 'Advanced: use your own proxy' : 'Hide advanced'}</a> · token from <em>ThousandEyes &rsaquo; Account Settings &rsaquo; Users &rsaquo; User API Tokens</em>. Use a read-only account.</p>`;
    $('tecCancel').addEventListener('click', () => { state.status = state.acct ? 'on' : 'off'; render(); });
    $('tecAdv').addEventListener('click', (e) => { e.preventDefault(); showProxy = !showProxy; render(); });
    const scanBtn = $('tecScan');
    if (scanBtn) scanBtn.addEventListener('click', async () => {
      if (!window.TEOcr) return;
      scanBtn.disabled = true;
      try {
        const t = await TEOcr.scan();
        if (t) { const ti = $('tecToken'); if (ti) { ti.type = 'text'; ti.value = t; ti.focus(); } }
      } catch (_) { /* */ }
      scanBtn.disabled = false;
    });
    const go = $('tecGo');
    go.addEventListener('click', async () => {
      const proxy = ($('tecProxy') ? $('tecProxy').value.trim() : '') || state.proxy, token = $('tecToken').value.trim(), persist = $('tecPersist').checked;
      const err = $('tecErr');
      err.hidden = true;
      if (!/^https:\/\//i.test(proxy) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(proxy)) { showProxy = true; render(); const e2 = $('tecErr'); if (e2) { e2.textContent = 'Enter the https proxy URL.'; e2.hidden = false; } return; }
      if (!token) { err.textContent = 'Paste your ThousandEyes API token.'; err.hidden = false; return; }
      go.disabled = true; go.textContent = 'Connecting…';
      try {
        await TEConn.connect(proxy, token, persist);
      } catch (e) {
        err.textContent = (e && e.message) || 'Could not connect.'; err.hidden = false;
        go.disabled = false; go.textContent = 'Connect';
      }
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // Restore: if a token is already stored, show connected at once and
  // re-check quietly in the background.
  function init() {
    if (!$('teConnCard')) return;
    if (state.token && state.proxy) {
      state.status = 'on';
      state.acct = { name: 'ThousandEyes', org: '', aid: '', count: 1 };
      render();
      validate().then((a) => { state.acct = a; render(); })
        .catch((e) => { if (e && (e.status === 401 || e.status === 403)) { TEConn.disconnect(); } else { render(); } });
    } else {
      render();
    }
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', init); else init();
})();
