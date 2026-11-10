# ThousandEyes Mobile

The phone edition of [TERoomApp](https://github.com/lucidium2000/TERoomApp), the ThousandEyes Internet Insights globe built for Cisco RoomOS / Desk Pro. Same live outage data, rebuilt around a phone: three tabs, a cleaner globe, and live checks and stats from the phone itself.

**Live:** https://lucidium2000.github.io/TEMobile/ - open it on a phone, then *Add to Home Screen* for a full-screen app.

## Tabs

- **Home** - one glance at everything: outage counts and the latest three (tap one to see it on the globe), today's weather and any alert, connection quality with each service check, the last speed test, battery and location. Each card opens its tab.
- **Outages** - live global outages from ThousandEyes Internet Insights on the 3D globe, with the outage list as a sheet that folds down to its counts (Active / Apps / Network / Locations filters, 1-24 h window), spoken summaries and camera hand gestures.
- **Weather** - the forecast (now, hourly, the week, alerts; search any city or ZIP; hear it read), big switches for the globe's weather radar (off / live / past hour - NOAA over North America, sharper detail over the UK and Australia, RainViewer elsewhere) and the US power layer (MassOutage), and the counties with the most customers out.
- **Tests** - measured from this phone:
  - **Speed test** to the nearest Cloudflare site: download, upload, latency and jitter (about 25 MB of data).
  - **Service checks** (Webex, Microsoft, Google, AWS, Zoom, editable with the gear): HTTP status, response time, a one-hour timeline, the local-edge round trip; tap one to trace its path on the globe.
- **Phone** - what the browser can see:
  - **Connection:** quality bars from the measured round trip to the internet edge, connection type and the browser's own estimate (where shared), last speed test, provider and public IP.
  - **Battery:** level, charging, time left (Chrome on Android; Safari keeps it private).
  - **Location:** the network's approximate place, or live GPS (accuracy, altitude, speed, heading) - also used for this phone's weather and pin. *Show on globe* flies there.
  - **Device:** system, browser, screen, processor, memory, graphics, WebGPU, storage, language, time zone.

Web pages can't read cellular signal strength or Wi-Fi bars, so signal quality is measured rather than read from the radio.

## Data

There's no GitHub Action here: the app reads the data TERoomApp's Action already publishes (`TERoomApp/data`: outages, pre-rendered speech, US power), so one job keeps both apps fresh. `?data=<url>` points it elsewhere.

## Differences from TERoomApp

- Tab bar (Home / Outages / Weather / Tests / Phone); the globe only draws while its tab shows.
- Canvases sized to the visible viewport (no egg-shaped globe behind mobile browser bars).
- No 80% desk scaling, compact outage card, no HUD/free-mode or full-screen buttons.

## Local development

```bash
python3 -m http.server 8767   # then open http://localhost:8767
```

No build step. Vendored: d3-geo, topojson-client, Natural Earth, MediaPipe / TF.js (gestures).

---

Created by Christopher Hunt ([@lucidium2000](https://github.com/lucidium2000)), 2026. Forked from TERoomApp.
