// ThousandEyes CORS proxy - a Cloudflare Worker.
//
// The ThousandEyes API (api.thousandeyes.com) does not send CORS headers, so a
// browser app can't call it directly. This Worker sits in between: it adds the
// CORS header the browser needs and forwards the request to the API unchanged.
//
// It is deliberately a dumb pass-through:
//   - GET only, and only the /v6/* and /v7/* API paths - nothing else.
//   - It forwards ONLY the Authorization header. Each user's own token decides
//     which tenant they see; the Worker never reads, stores or logs it.
//   - CORS is allowed for the app's origin, localhost (dev) and *.github.io
//     (forks). Edit ALLOW_* below to add your own origin.
//
// One deployed Worker serves everyone: it's stateless, so two people using it
// with different tokens each see only their own portal. Deploy:
//   npm i -g wrangler && wrangler deploy worker/thousandeyes-proxy.js --name te-proxy
// or paste this file into the Cloudflare dashboard (Workers > Create). Then put
// the Worker URL (https://te-proxy.<you>.workers.dev) into the app's Connect box.

const OFFICIAL_ORIGIN = 'https://lucidium2000.github.io';

function allowedOrigin(o) {
  if (!o) return false;
  if (o === OFFICIAL_ORIGIN) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return true;   // local dev
  if (/^https:\/\/[a-z0-9-]+\.github\.io$/i.test(o)) return true;          // forks on GitHub Pages
  return false;
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const allow = allowedOrigin(origin) ? origin : OFFICIAL_ORIGIN;
    const cors = (extra = {}) => ({
      'Access-Control-Allow-Origin': allow,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
      ...extra,
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors() });

    const url = new URL(request.url);
    // Only proxy the ThousandEyes API itself - never an open relay.
    if (!/^\/v[67]\//.test(url.pathname)) {
      return new Response(JSON.stringify({ error: 'Only /v6/* and /v7/* are proxied' }),
        { status: 404, headers: cors({ 'Content-Type': 'application/json' }) });
    }
    const auth = request.headers.get('Authorization');
    if (!auth) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: cors({ 'Content-Type': 'application/json' }) });
    }

    const target = 'https://api.thousandeyes.com' + url.pathname + url.search;
    let upstream;
    try {
      upstream = await fetch(target, { method: 'GET', headers: { 'Authorization': auth, 'Accept': 'application/json' } });
    } catch (_) {
      return new Response(JSON.stringify({ error: 'Could not reach the ThousandEyes API' }),
        { status: 502, headers: cors({ 'Content-Type': 'application/json' }) });
    }
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: cors({ 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' }),
    });
  },
};
