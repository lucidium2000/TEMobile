// Part of TEMobile - forked from TERoomApp, created by Christopher Hunt (github.com/lucidium2000).
/* The Weather tab, after the best weather apps: conditions over the globe,
 * the next 24 hours, a 10-day list with temperature-range bars, rain and
 * humidity, and detail tiles (feels like, humidity, wind, UV, sun, rain,
 * pressure, visibility). Open-Meteo for the numbers (free, no key), the
 * National Weather Service (js/wxbrief.js) for its own words and alerts.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const C = new URLSearchParams(location.search).get('units') === 'c';
  const DEG = '°';
  const WMO = () => (window.WxBrief && window.WxBrief.WMO) || {};
  const cap = (s) => String(s || '').replace(/^./, (x) => x.toUpperCase());
  const A = () => window.TEApp;

  // ── Data ────────────────────────────────────────────────────────────────
  const url = (lat, lon) => 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(3) + '&longitude=' + lon.toFixed(3)
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,visibility,uv_index,precipitation,cloud_cover'
    + '&hourly=temperature_2m,weather_code,precipitation_probability,is_day&forecast_hours=25'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,relative_humidity_2m_mean,uv_index_max,sunrise,sunset,wind_speed_10m_max'
    + '&forecast_days=10&timezone=auto' + (C ? '' : '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch');
  const cache = new Map();   // "lat,lon" -> { at, om, brief, busy }
  function load(pl) {
    const key = pl.lat.toFixed(2) + ',' + pl.lon.toFixed(2);
    let rec = cache.get(key);
    if (rec && (rec.busy || Date.now() - rec.at < 10 * 60e3)) return rec;
    rec = { at: Date.now(), om: rec && rec.om, brief: rec && rec.brief, busy: true };
    cache.set(key, rec);
    Promise.all([
      fetch(url(pl.lat, pl.lon)).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      window.WxBrief ? window.WxBrief.get(pl.lat, pl.lon, { fahrenheit: !C }).catch(() => null) : null,
    ]).then(([om, brief]) => {
      rec.busy = false;
      if (om && om.current) rec.om = om;
      if (brief) rec.brief = brief;
      if (place === pl || (!place && pl.mine)) render();
    });
    return rec;
  }

  // ── Place: this device's, or one searched for / tapped on the globe ─────
  let place = null;   // null = this device
  const myPlace = () => {
    const r = A() && A().room();
    return r && isFinite(r.lat) ? { lat: r.lat, lon: r.lon, name: r.city || 'My location', mine: true } : null;
  };
  const cur = () => place || myPlace();

  // ── Look: the sky's colour tints the sheet and the conditions card ──────
  function sky(code, day) {
    if (code >= 95) return 'storm';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code === 45 || code === 48) return 'fog';
    if (!day) return 'night';
    return code >= 2 ? 'cloud' : 'clear';
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const tempColor = (t) => {
    // Cold blue -> mild green -> warm yellow -> hot orange/red (°F scale).
    const f = C ? t * 9 / 5 + 32 : t;
    const stops = [[10, '#7dd3fc'], [35, '#60a5fa'], [55, '#4ade80'], [70, '#facc15'], [85, '#fb923c'], [100, '#f43f5e']];
    for (let i = 1; i < stops.length; i++) if (f <= stops[i][0]) return stops[i - 1][1];
    return stops[stops.length - 1][1];
  };
  const clock = (iso) => (iso ? new Date(iso + 'Z').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) : '');
  const uvLevel = (u) => (u < 3 ? 'Low' : u < 6 ? 'Moderate' : u < 8 ? 'High' : u < 11 ? 'Very high' : 'Extreme');
  const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

  function render() {
    const pl = cur();
    if (!pl) return;
    const rec = load(pl), om = rec.om, brief = rec.brief || (pl.mine && A() && A().weather().brief);
    const c = om && om.current, d = om && om.daily;
    const view = $('viewWeather');

    // Conditions over the globe (top right).
    $('wnPlace').textContent = (pl.mine ? (brief && brief.city) || pl.name : pl.name) + (pl.mine ? '' : '');
    $('wxNow').classList.toggle('mine', !!pl.mine);
    if (c) {
      if (A() && A().drawWx) A().drawWx($('wnIcon'), c.weather_code, c.is_day === 1, 40);
      $('wnTemp').textContent = Math.round(c.temperature_2m) + DEG;
      $('wnDesc').textContent = cap(WMO()[c.weather_code]);
      $('wnHL').textContent = d ? `H:${Math.round(d.temperature_2m_max[0])}${DEG}  L:${Math.round(d.temperature_2m_min[0])}${DEG}` : '';
      const s = sky(c.weather_code, c.is_day === 1);
      view.dataset.sky = s; $('wxNow').dataset.sky = s;
    }
    const alerts = (brief && brief.alertInfo) || [];
    $('wnAlert').hidden = !alerts.length;
    $('wnAlert').textContent = alerts.length ? '⚠ ' + alerts[0].event : '';

    // Next 24 hours, with sunrise / sunset dropped in where they fall.
    const hr = om && om.hourly, cells = [];
    if (hr && hr.time) {
      const off = (om.utc_offset_seconds || 0) * 1000, nowMs = Date.now() - 30 * 60e3;
      const suns = [];
      if (d) for (let i = 0; i < 2; i++) { suns.push({ t: Date.parse(d.sunrise[i] + 'Z') - off, k: 'rise', iso: d.sunrise[i] }); suns.push({ t: Date.parse(d.sunset[i] + 'Z') - off, k: 'set', iso: d.sunset[i] }); }
      hr.time.forEach((t, i) => {
        const wall = Date.parse(t + 'Z'), at = wall - off;
        if (at < nowMs || cells.length >= 26) return;
        cells.push({ label: cells.length ? new Date(wall).toLocaleTimeString([], { hour: 'numeric', timeZone: 'UTC' }) : 'Now',
          temp: hr.temperature_2m[i], code: hr.weather_code[i], day: hr.is_day[i] === 1, pop: hr.precipitation_probability ? hr.precipitation_probability[i] : 0 });
        const sn = suns.find((x) => x.t > at && x.t <= at + 3600e3);
        if (sn && cells.length > 1) cells.push({ label: clock(sn.iso), sun: sn.k });
      });
    }
    $('wxHours').innerHTML = cells.map((x, i) => x.sun
      ? `<li class="sun"><span>${esc(x.label)}</span><i class="sun-ico ${x.sun}"></i><em></em><b>${x.sun === 'rise' ? 'Sunrise' : 'Sunset'}</b></li>`
      : `<li><span>${esc(x.label)}</span><canvas data-h="${i}"></canvas><em>${x.pop >= 20 ? x.pop + '%' : ''}</em><b>${Math.round(x.temp)}${DEG}</b></li>`).join('');
    $('wxHours').querySelectorAll('canvas').forEach((cv) => { const x = cells[+cv.dataset.h]; if (A() && A().drawWx) A().drawWx(cv, x.code, x.day, 26); });

    // Alert + the forecaster's words.
    $('wvAlerts').innerHTML = alerts.map((a) => `<div class="wv-alert"><b>⚠ ${esc(a.event)}</b>${a.headline ? `<span>${esc(a.headline)}</span>` : ''}</div>`).join('');
    const p0 = brief && brief.periods && brief.periods[0];
    $('wvSummary').hidden = !(p0 && p0.detailed);
    $('wvSumText').textContent = p0 && p0.detailed ? p0.detailed : '';
    $('wvSumSrc').textContent = brief && brief.source === 'nws' ? 'National Weather Service' : 'Forecast';
    $('wvSpeak').hidden = !window.Tts;

    // 10-day: the bar spans the week's low to high; humidity and rain chance.
    if (d) {
      const lo = Math.min(...d.temperature_2m_min), hi = Math.max(...d.temperature_2m_max), span = Math.max(1, hi - lo);
      const grad = `linear-gradient(90deg, ${tempColor(lo)}, ${tempColor(lo + span / 2)}, ${tempColor(hi)})`;
      $('wvDays').innerHTML = d.time.map((t, i) => {
        const dn = i === 0 ? 'Today' : new Date(t + 'T12:00:00Z').toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' });
        const a = d.temperature_2m_min[i], b = d.temperature_2m_max[i];
        const left = ((a - lo) / span) * 100, w = Math.max(4, ((b - a) / span) * 100);
        const dot = i === 0 && c ? `<i class="now" style="left:${(((c.temperature_2m - lo) / span) * 100).toFixed(1)}%"></i>` : '';
        const pop = d.precipitation_probability_max ? d.precipitation_probability_max[i] : 0;
        const hum = d.relative_humidity_2m_mean ? d.relative_humidity_2m_mean[i] : null;
        return `<li><span class="dn">${esc(dn)}</span><span class="di"><canvas data-d="${i}"></canvas>${pop >= 20 ? `<em>${pop}%</em>` : ''}</span>`
          + `<span class="dh">${hum != null ? `<svg viewBox="0 0 24 24" width="11" height="11"><path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11Z" fill="currentColor"/></svg>${hum}%` : ''}</span>`
          + `<span class="lo">${Math.round(a)}${DEG}</span><span class="bar"><i class="fill" style="left:${left.toFixed(1)}%;width:${w.toFixed(1)}%;background:${grad};background-size:${(100 / w * 100).toFixed(0)}% 100%;background-position:${w >= 100 ? 0 : (left / (100 - w) * 100).toFixed(1)}% 0"></i>${dot}</span>`
          + `<span class="hi">${Math.round(b)}${DEG}</span></li>`;
      }).join('');
      $('wvDays').querySelectorAll('canvas').forEach((cv) => { const i = +cv.dataset.d; if (A() && A().drawWx) A().drawWx(cv, d.weather_code[i], true, 24); });
    }

    // Detail tiles.
    if (c && d) {
      const T = Math.round(c.temperature_2m), F = Math.round(c.apparent_temperature);
      const feel = Math.abs(F - T) <= 2 ? 'Similar to the actual temperature.' : F < T ? 'Wind is making it feel colder.' : 'Humidity is making it feel warmer.';
      const u = c.uv_index != null ? c.uv_index : 0;
      const spd = Math.round(c.wind_speed_10m), gust = Math.round(c.wind_gusts_10m || 0), dir = c.wind_direction_10m || 0;
      const vis = C ? c.visibility / 1000 : c.visibility / 5280;
      const visU = C ? 'km' : 'mi', press = C ? Math.round(c.pressure_msl) : (c.pressure_msl * 0.02953).toFixed(2);
      const off = (om.utc_offset_seconds || 0) * 1000, nowWall = Date.now() + off;
      const rise = Date.parse(d.sunrise[0] + 'Z'), set = Date.parse(d.sunset[0] + 'Z');
      const upNow = nowWall >= rise && nowWall < set;
      const sunFrac = Math.max(0, Math.min(1, (nowWall - rise) / (set - rise)));
      const ang = Math.PI * (1 - sunFrac), sx = 50 + 40 * Math.cos(ang), sy = 46 - 34 * Math.sin(ang);
      const rain = d.precipitation_sum ? d.precipitation_sum[0] : 0;
      const pMin = C ? 960 : 960, pMax = 1050, pf = Math.max(0, Math.min(1, (c.pressure_msl - pMin) / (pMax - pMin)));
      const tile = (cls, ico, k, v, s, extra) => `<div class="wt ${cls}"><span class="wt-k">${ico}${k}</span>${extra || ''}<b class="wt-v">${v}</b><span class="wt-s">${s}</span></div>`;
      const I = (p) => `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
      $('wvTiles').innerHTML = [
        tile('feel', I('<path d="M14 14.8V4a2 2 0 1 0-4 0v10.8a4 4 0 1 0 4 0Z"/>'), 'Feels like', F + DEG, feel),
        tile('hum', I('<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11Z"/>'), 'Humidity', Math.round(c.relative_humidity_2m) + '%',
          `The dew point is ${Math.round(c.dew_point_2m)}${DEG} right now.`, `<span class="hum-bar"><i style="height:${Math.round(c.relative_humidity_2m)}%"></i></span>`),
        tile('wind', I('<path d="M3 8h11a3 3 0 1 0-3-3M3 16h15a3 3 0 1 1-3 3M3 12h18"/>'), 'Wind', '',
          `${DIRS[Math.round(dir / 22.5) % 16]}${gust ? ` · gusts ${gust}` : ''}`,
          `<span class="compass"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="c-ring"/>${Array.from({ length: 36 }, (_, i) => `<line x1="50" y1="${i % 9 ? 9 : 6}" x2="50" y2="${i % 9 ? 12 : 14}" transform="rotate(${i * 10} 50 50)"/>`).join('')}<text x="50" y="22">N</text><text x="82" y="54">E</text><text x="50" y="86">S</text><text x="18" y="54">W</text><g transform="rotate(${dir + 180} 50 50)"><path d="M50 14 L55 26 L50 23 L45 26 Z" class="c-arrow"/><line x1="50" y1="24" x2="50" y2="80" class="c-shaft"/></g><circle cx="50" cy="50" r="17" class="c-hub"/><text x="50" y="50" class="c-spd">${spd}</text><text x="50" y="61" class="c-u">${C ? 'km/h' : 'mph'}</text></svg></span>`),
        tile('uv', I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'), 'UV index',
          `${Math.round(u)}<small>${uvLevel(u)}</small>`, `Peak today ${Math.round(d.uv_index_max[0])}, ${uvLevel(d.uv_index_max[0]).toLowerCase()}.`,
          ''),
        tile('sun', I('<path d="M12 3v3M5.6 8.6 4.2 7.2M18.4 8.6l1.4-1.4M3 15h18M7 15a5 5 0 0 1 10 0"/>'), upNow ? 'Sunset' : 'Sunrise',
          clock(upNow ? d.sunset[0] : (nowWall < rise ? d.sunrise[0] : d.sunrise[1])), `${upNow ? 'Sunrise' : 'Sunset'}: ${clock(upNow ? d.sunrise[0] : d.sunset[0])}`,
          `<span class="sun-arc"><svg viewBox="0 0 100 52"><path d="M10 46 A40 34 0 0 1 90 46" class="arc"/><line x1="0" y1="46" x2="100" y2="46" class="hz"/>${upNow ? `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="5" class="sun-dot"/>` : ''}</svg></span>`),
        tile('rain', I('<path d="M7 15a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 1.5A3.75 3.75 0 0 1 17.5 15"/><path d="M8 19l1-2M12 21l1-2M16 19l1-2"/>'), 'Precipitation',
          `${C ? rain.toFixed(1) : rain.toFixed(2)}<small>${C ? 'mm' : 'in'}</small>`, `Today · ${d.precipitation_probability_max[0] || 0}% chance. Tomorrow ${d.precipitation_probability_max[1] || 0}%.`),
        tile('press', I('<circle cx="12" cy="12" r="9"/><path d="M12 12l4-4"/>'), 'Pressure', `${press}<small>${C ? 'hPa' : 'inHg'}</small>`, `${Math.round(c.pressure_msl)} hPa at sea level`,
          `<span class="gauge-mini"><svg viewBox="0 0 100 60"><path d="M12 54 A40 40 0 0 1 88 54" class="g-tr"/><path d="M12 54 A40 40 0 0 1 88 54" class="g-on" pathLength="100" stroke-dasharray="${(pf * 100).toFixed(0)} 100"/></svg></span>`),
        tile('vis', I('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'), 'Visibility',
          `${vis >= 10 ? Math.round(vis) : vis.toFixed(1)}<small>${visU}</small>`, vis >= 10 ? 'Perfectly clear view.' : vis >= 5 ? 'Good visibility.' : 'Hazy right now.'),
      ].join('');
      // UV bar under its value.
      const uvT = $('wvTiles').querySelector('.wt.uv .wt-v');
      if (uvT) uvT.insertAdjacentHTML('afterend', `<span class="uv-bar"><i style="left:${Math.min(100, (u / 11) * 100).toFixed(0)}%"></i></span>`);
    }
    $('wvMine').hidden = !!pl.mine;
    $('wvSrc').textContent = 'Open-Meteo' + (brief && brief.source === 'nws' ? ' · National Weather Service' : '') + (om ? ' · updated ' + new Date(rec.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
  }

  // ── Search (Open-Meteo geocoding): "Paris", "Portland OR", "Birmingham, UK", ZIP ─
  const ALIAS = { uk: 'united kingdom', gb: 'united kingdom', england: 'united kingdom', us: 'united states', usa: 'united states', au: 'australia' };
  let hits = [], qT = 0, qN = 0;
  async function geocode(q) {
    const n = ++qN;
    const get = async (name) => { const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&format=json&name=' + encodeURIComponent(name)); const j = r.ok ? await r.json() : null; return (j && j.results) || []; };
    try {
      let list = await get(q);
      const parts = q.split(/[,\s]+/).filter(Boolean);
      if (!list.length && parts.length > 1) {
        const want = parts[parts.length - 1].toLowerCase(), full = ALIAS[want] || want;
        list = (await get(parts.slice(0, -1).join(' '))).filter((h) => [h.country, h.admin1, h.country_code].some((v) => v && String(v).toLowerCase().startsWith(full)));
      }
      if (n !== qN) return;
      hits = list.slice(0, 6);
      $('wvHits').innerHTML = hits.length ? hits.map((h, i) => `<li data-h="${i}"><b>${esc(h.name)}</b><small>${esc([h.admin1, h.country].filter(Boolean).join(', '))}</small></li>`).join('') : '<li class="none">No places found</li>';
    } catch (_) { if (n === qN) $('wvHits').innerHTML = ''; }
  }
  function setPlace(pl, fromApp) {
    place = pl && !pl.mine ? { lat: pl.lat, lon: pl.lon, name: pl.name } : null;
    if (!fromApp && A() && A().openForecast) A().openForecast(place, true);   // keeps "Hear the forecast" in step
    render();
  }
  function init() {
    $('wvQ').addEventListener('input', () => {
      clearTimeout(qT);
      const q = $('wvQ').value.trim();
      if (q.length < 2) { $('wvHits').innerHTML = ''; return; }
      qT = setTimeout(() => geocode(q), 300);
    });
    $('wvSearch').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!hits.length && $('wvQ').value.trim().length > 1) await geocode($('wvQ').value.trim());
      if (hits[0]) pick(hits[0]);
    });
    const pick = (h) => {
      $('wvQ').value = ''; $('wvHits').innerHTML = ''; $('wvQ').blur();
      setPlace({ lat: h.latitude, lon: h.longitude, name: h.name });
      if (A()) A().flyToPlace(h.longitude, h.latitude);
      if (window.TEMobile && window.TEMobile.foldWx) window.TEMobile.foldWx(true);
    };
    $('wvHits').addEventListener('click', (e) => { const li = e.target.closest('li[data-h]'); if (li) pick(hits[+li.dataset.h]); });
    $('wvMine').addEventListener('click', () => {
      setPlace(null);
      const m = myPlace(); if (m && A()) A().flyToPlace(m.lon, m.lat);
    });
    $('wvSpeak').addEventListener('click', () => { const b = $('wxcSpeak'); if (b) b.click(); });
    addEventListener('te-weather', () => { if (document.body.dataset.tab === 'weather') render(); });
    setInterval(() => { if (document.body.dataset.tab === 'weather') render(); }, 60e3);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.WxView = { render, setPlace, place: () => cur() };
})();
