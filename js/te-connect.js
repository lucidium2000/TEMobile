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

  // Fill this in once a shared Worker is deployed, to make Connect one-tap.
  // Until then the user pastes their own Worker URL.
  const DEFAULT_PROXY = '';

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

  window.TEConn = {
    on: () => state.status === 'on',
    account: () => state.acct,
    proxyHost: () => { try { return new URL(base()).host; } catch (_) { return ''; } },
    api,
    async connect(proxy, token, persist) {
      state.proxy = (proxy || '').trim(); state.token = (token || '').trim(); state.persist = !!persist;
      const acct = await validate();            // throws on bad token / proxy
      state.acct = acct; state.status = 'on';
      save(state.proxy, state.token, state.persist);
      changed();
      return acct;
    },
    disconnect() {
      state.token = ''; state.acct = null; state.status = 'off';
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
      card.querySelector('.tec-body').innerHTML = `
        <div class="tec-acct">
          <div class="tec-ok"><i></i>Connected</div>
          <b>${esc(a.name)}</b>
          ${a.org ? `<span>${esc(a.org)}</span>` : ''}
          <small>${a.count > 1 ? a.count + ' account groups · ' : ''}via ${esc(TEConn.proxyHost())}</small>
        </div>
        <button class="m-btn ghost" id="tecOff">Disconnect &amp; forget token</button>`;
      $('tecOff').addEventListener('click', () => TEConn.disconnect());
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
    card.querySelector('.tec-body').innerHTML = `
      <label class="tec-f">Proxy URL
        <input id="tecProxy" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://te-proxy.you.workers.dev" value="${esc(state.proxy)}">
      </label>
      <label class="tec-f">API token
        <div class="tec-tokrow">
          <input id="tecToken" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ThousandEyes bearer token">
          <button type="button" class="tec-scan" id="tecScan" title="Scan the token with the camera" aria-label="Scan the token with the camera"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9V7a2 2 0 0 1 2-2h2M17 5h2a2 2 0 0 1 2 2v2M21 15v2a2 2 0 0 1-2 2h-2M7 19H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.2"/></svg></button>
        </div>
      </label>
      <label class="tec-chk"><input id="tecPersist" type="checkbox" ${state.persist ? 'checked' : ''}><span>Keep me connected on this device</span></label>
      <div class="tec-err" id="tecErr" hidden></div>
      <div class="tec-btns"><button class="m-btn" id="tecGo">Connect</button><button class="m-btn ghost" id="tecCancel">Cancel</button></div>
      <p class="tec-help">Use a read-only account for this. <a href="https://github.com/lucidium2000/TEMobile/tree/main/worker" target="_blank" rel="noopener">How to deploy the proxy</a> · token from <em>ThousandEyes &rsaquo; Account Settings &rsaquo; Users &rsaquo; User API Tokens</em>.</p>`;
    $('tecCancel').addEventListener('click', () => { state.status = state.acct ? 'on' : 'off'; render(); });
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
      const proxy = $('tecProxy').value.trim(), token = $('tecToken').value.trim(), persist = $('tecPersist').checked;
      const err = $('tecErr');
      err.hidden = true;
      if (!/^https:\/\//i.test(proxy) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(proxy)) { err.textContent = 'Enter the https Worker URL.'; err.hidden = false; return; }
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
