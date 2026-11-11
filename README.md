# ThousandEyes Mobile

The phone edition of [TERoomApp](https://github.com/lucidium2000/TERoomApp), the ThousandEyes Internet Insights globe built for Cisco RoomOS / Desk Pro. Same live outage data, rebuilt around a phone: five tabs, a cleaner globe, and live checks and stats from the phone itself.

**Live:** https://lucidium2000.github.io/TEMobile/ - open it on a phone, then *Add to Home Screen* for a full-screen app.

## Tabs

- **Home** - one glance at everything: outage counts and the latest three (tap one to see it on the globe), today's weather and any alert, connection quality with each service check, the last speed test, battery and location. Each card opens its tab.
- **Network** - this phone's connection, measured live:
  - **Your connection**: quality, round trip to the nearest internet edge every 30 s on a one-hour timeline (like the service rows), with average, best, worst, jitter and reachability.
  - **Service checks** (Webex, Microsoft, Google, AWS, Zoom, editable with the gear): HTTP status, response time, a one-hour timeline, the local-edge round trip; tap one to trace its path on the globe.
  - **Speed test** to the nearest Cloudflare site (WiFiman-style): a live throughput graph with latency under load, download, upload, idle latency, jitter, latency while downloading and uploading, a bufferbloat grade (A+ to F), packet loss, packets resent (from Cloudflare's side of the connection) and a history of past tests (about 10 s; up to ~55 MB on a fast line).
- **Outages** - its own globe, outages only: live global outages from ThousandEyes Internet Insights on the 3D globe, with the outage list as a sheet that folds down to its counts (Active / Apps / Network / Locations filters, 1-24 h window), spoken summaries and camera hand gestures.
- **Weather** - a second globe, purpose-built for weather: radar, US power (amber bolts by county) and your place, under a sheet that folds down to the layer switches. Open it for the forecast (now, hourly, the week, alerts; search any city or ZIP; hear it read), big switches for the globe's weather radar (off / live / past hour - NOAA over North America, sharper detail over the UK and Australia, RainViewer elsewhere) and the US power layer (MassOutage), and the counties with the most customers out.
- **Phone** - what the browser can see:
  - **Connection:** quality bars from the measured round trip to the internet edge, a live timeline checked every second (last 10 minutes, with average, best, worst, jitter and loss; only while the Phone tab is open), the round trip and resent packets as Cloudflare's edge measures them, IPv4 / IPv6, protocol and TLS version, key exchange (flags post-quantum), connection type and the browser's own estimate (where shared), last speed test, provider and public IP.
  - **Battery:** level, charging, time left (Chrome on Android; Safari keeps it private).
  - **Location:** the network's approximate place, or live GPS (accuracy, altitude, speed, heading) - also used for this phone's weather and pin. *Show on globe* flies there.
  - **Device:** system, browser, screen, processor, memory, graphics, WebGPU, storage, language, time zone.

Web pages can't read cellular signal strength or Wi-Fi bars, or scan for nearby Wi-Fi networks (that needs a native app), so signal quality is measured rather than read from the radio.

## Data

There's no GitHub Action here: the app reads the data TERoomApp's Action already publishes (`TERoomApp/data`: outages, pre-rendered speech, US power), so one job keeps both apps fresh. `?data=<url>` points it elsewhere.

## Differences from TERoomApp

- Tab bar (Home / Network / Outages / Weather / Phone); one renderer serves two globes (Outages, Weather), each with its own view, and only draws while one of them shows.
- Canvases sized to the visible viewport (no egg-shaped globe behind mobile browser bars).
- No 80% desk scaling, compact outage card, no HUD/free-mode or full-screen buttons.

## Connect your ThousandEyes tenant

The Network tab can connect to your own ThousandEyes tenant (read-only) to show your agents, tests and alerts in the app. The ThousandEyes API sends no CORS headers, so the app talks to it through a tiny Cloudflare Worker proxy you deploy once - the token stays on your device and is sent only to your proxy, never to the repo or anyone else. See [`worker/`](worker/) for the ~30-line Worker and a 2-minute deploy guide. The tenant layer is optional: without it, the app works exactly as before.

## Local development

```bash
python3 -m http.server 8767   # then open http://localhost:8767
```

No build step. Vendored: d3-geo, topojson-client, Natural Earth, MediaPipe / TF.js (gestures).

---

Created by Christopher Hunt ([@lucidium2000](https://github.com/lucidium2000)), 2026. Forked from TERoomApp.
