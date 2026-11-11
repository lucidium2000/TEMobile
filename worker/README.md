# ThousandEyes proxy (Cloudflare Worker)

The app reads your own ThousandEyes tenant through the public API. That API sends
no CORS headers, so a browser can't call it directly. This tiny Worker sits in
between: it adds the CORS header the browser needs and forwards the request to
`api.thousandeyes.com` unchanged.

It is a deliberately dumb pass-through:

- **GET only**, and only the `/v6/*` and `/v7/*` API paths — never an open relay.
- It forwards **only** the `Authorization` header. Your token decides which tenant
  you see; the Worker never reads, stores or logs it.
- CORS is allowed for the app's origin, `localhost` (dev) and any `*.github.io`
  (forks). Edit `allowedOrigin()` in [`thousandeyes-proxy.js`](thousandeyes-proxy.js)
  to add your own.

One deployed Worker serves everyone: it's stateless, so two people using it with
different tokens each see only their own portal. The token still passes *through*
the Worker in transit, so if you share one Worker with others, they're trusting it
not to log — the code above is short on purpose so they can check. For anything
sensitive, deploy your own and keep it to yourself.

## Deploy in ~2 minutes

### Option A — dashboard (no tools)

1. Sign in at <https://dash.cloudflare.com> → **Workers & Pages** → **Create** →
   **Create Worker**. Give it a name (e.g. `te-proxy`) and **Deploy**.
2. **Edit code**, delete the sample, paste all of
   [`thousandeyes-proxy.js`](thousandeyes-proxy.js), and **Deploy**.
3. Copy the Worker URL — `https://te-proxy.<you>.workers.dev`.

### Option B — Wrangler (CLI)

```bash
npm i -g wrangler
wrangler login
wrangler deploy worker/thousandeyes-proxy.js --name te-proxy --compatibility-date 2024-01-01
```

## Connect the app

1. In the app: **Network → ThousandEyes tenant → Connect ThousandEyes**.
2. **Proxy URL:** the Worker URL from above.
3. **API token:** ThousandEyes → **Account Settings → Users → User API Tokens**
   (the OAuth Bearer token). Use a **read-only** account — the app only reads.
4. Connect. The token is stored on this device only; **Disconnect & forget token**
   removes it.

## Free tier

Cloudflare's free plan allows 100,000 requests/day — far more than this app uses.
The Worker is separate from the app's GitHub repo: the app keeps working without
it, just without the live tenant layer.
