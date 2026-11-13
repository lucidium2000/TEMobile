// Part of TERoomApp - created by Christopher Hunt (github.com/lucidium2000).
/* Interface sounds: short, soft synthesized tones (Web Audio, no files).
 *
 * window.Sfx.play(name) - see SOUNDS below for the names.
 * Browsers only allow audio after a user gesture, so the context is created
 * on the first touch/click/key; until then play() is a silent no-op (a signage
 * screen nobody has touched stays quiet).
 *
 * URL: sound=0 mutes everything; volume=<0..2> scales it (default 1).
 */
(function () {
  'use strict';

  const qs = new URLSearchParams(location.search);
  const MUTED = qs.get('sound') === '0';
  const VOLUME = Math.max(0, Math.min(2, parseFloat(qs.get('volume')) || 1));
  const MASTER = 0.09 * VOLUME;          // keep it tasteful: everything sits low (half of the old 0.18)

  let ctx = null, master = null;
  function unlock() {
    if (MUTED || ctx) { if (ctx && ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = MASTER;
      // A gentle low-pass takes the edge off every tone.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 6000;
      master.connect(lp).connect(ctx.destination);
    } catch (_) { ctx = null; }
  }
  // iOS: play as "ambient" so the ring/silent switch mutes these sounds.
  try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (_) { /* */ }
  ['pointerdown', 'keydown'].forEach((t) => window.addEventListener(t, unlock, { capture: true, passive: true }));

  /** One tone: soft attack, exponential release, optional pitch glide. */
  function tone(freq, dur, o = {}) {
    if (!ctx) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    const v = o.vol == null ? 1 : o.vol, a = o.attack || 0.006;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let out = osc.connect(g);
    if (o.lp) {   // optional low-pass, optionally opening up over the tone
      const f = ctx.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.setValueAtTime(o.lp, t0); if (o.lp2) f.frequency.exponentialRampToValueAtTime(o.lp2, t0 + dur);
      out = out.connect(f);
    }
    out.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  /** Band-passed noise with a sweeping centre: a soft whoosh. */
  function whoosh(dur, from, to, vol) {
    if (!ctx) return;
    const t0 = ctx.currentTime, n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(from, t0); bp.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  /** Filtered noise with a sweeping cutoff; o: type, f, to, q, attack, delay. */
  let noiseBuf = null;
  function noise(dur, vol, o = {}) {
    if (!ctx) return;
    const t0 = ctx.currentTime + (o.delay || 0), a = o.attack || 0.01;
    if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.f || 1000, t0); if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + a + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0); src.stop(t0 + a + dur + 0.05);
  }
  /** A tone through a feedback echo (the radar ping). */
  function echoTone(freq, dur, vol, time, fb) {
    if (!ctx) return;
    const t0 = ctx.currentTime, osc = ctx.createOscillator(), g = ctx.createGain(), d = ctx.createDelay(), k = ctx.createGain();
    osc.frequency.value = freq; d.delayTime.value = time; k.gain.value = fb;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master); g.connect(d); d.connect(k).connect(d); d.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
    setTimeout(() => { try { d.disconnect(); k.disconnect(); } catch (_) { /* */ } }, 3000);
  }

  const SOUNDS = {
    // Soundboard picks: #7 whoosh in, #11 drawer settle, #15 globe rotate,
    // #19 radar ping, #24 warning pulse.
    drawerOpen: () => noise(0.25, 0.7, { f: 300, to: 3200, q: 1.4, attack: 0.15 }),
    settle:   () => { tone(130, 0.12, { to: 60, vol: 0.7 }); noise(0.015, 0.5, { f: 3000, q: 4, attack: 0.001 }); },
    spin:     () => noise(0.45, 0.7, { type: 'lowpass', f: 350, to: 900, attack: 0.18 }),
    radar:    () => echoTone(1500, 0.6, 0.36, 0.18, 0.35),
    powerUp:  () => { tone(80, 0.6, { to: 880, vol: 0.18, type: 'sawtooth', lp: 300, lp2: 6000, attack: 0.05 }); tone(1760, 0.4, { vol: 0.16, delay: 0.6 }); },   // #27
    chime:    () => { tone(880, 0.35, { vol: 0.32 }); tone(1320, 0.5, { vol: 0.32, delay: 0.12 }); },   // #22
    warn:     () => { tone(440, 0.12, { vol: 0.16, type: 'square' }); tone(440, 0.12, { vol: 0.16, type: 'square', delay: 0.2 }); },
    tap:      () => tone(1800, 0.035, { vol: 0.35 }),
    on:       () => { tone(660, 0.09, { vol: 0.5 }); tone(990, 0.12, { vol: 0.5, delay: 0.07 }); },
    off:      () => { tone(880, 0.09, { vol: 0.45 }); tone(587, 0.12, { vol: 0.45, delay: 0.07 }); },
    toggle:   () => { tone(740, 0.06, { vol: 0.4, type: 'triangle' }); tone(988, 0.07, { vol: 0.35, type: 'triangle', delay: 0.05 }); },
    // Subtle: a short, quiet sine with only a small upward lift.
    select:   () => tone(620, 0.12, { to: 740, vol: 0.16, attack: 0.015 }),
    alert:    () => { tone(1760, 0.4, { vol: 0.4 }); tone(1318, 0.55, { vol: 0.4, delay: 0.22 }); },
    camOn:    () => { tone(523, 0.1, { vol: 0.45 }); tone(784, 0.1, { vol: 0.45, delay: 0.08 }); tone(1046, 0.16, { vol: 0.4, delay: 0.16 }); },
    camOff:   () => { tone(784, 0.1, { vol: 0.4 }); tone(523, 0.16, { vol: 0.4, delay: 0.08 }); },
    error:    () => { tone(180, 0.12, { vol: 0.35, type: 'square' }); tone(160, 0.16, { vol: 0.35, type: 'square', delay: 0.15 }); },
    ready:    () => { tone(1046, 0.12, { vol: 0.45 }); tone(1568, 0.25, { vol: 0.45, delay: 0.09 }); },
    pause:    () => tone(700, 0.14, { to: 420, vol: 0.25 }),
    grab:     () => tone(220, 0.06, { vol: 0.6, type: 'triangle' }),
    release:  () => tone(440, 0.05, { vol: 0.35, type: 'triangle' }),
    next:     () => tone(880, 0.08, { to: 1175, vol: 0.4 }),
    prev:     () => tone(880, 0.08, { to: 660, vol: 0.4 }),
    whoosh:   () => whoosh(0.45, 400, 2400, 0.55),
    open:     () => tone(520, 0.1, { to: 880, vol: 0.35 }),
    close:    () => tone(700, 0.08, { to: 440, vol: 0.3 }),
    reset:    () => tone(900, 0.25, { to: 450, vol: 0.3, type: 'triangle' }),
    zoom:     () => tone(500, 0.12, { to: 900, vol: 0.3, type: 'triangle' }),
  };

  /* Earth-moving rumble (soundboard #2, "tectonic shift"): a steady deep
   * rumble that holds while the globe is moving, and on stopping fades out
   * slowly with a low settle. Driven by Sfx.rumble(true/false) every frame. */
  let rb = null, rbOn = false, rbSince = 0, brownBuf = null;
  function brown() {
    if (brownBuf) return brownBuf;
    const n = ctx.sampleRate * 4; brownBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = brownBuf.getChannelData(0); let l = 0;
    for (let i = 0; i < n; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; }
    return brownBuf;
  }
  function rumbleGraph() {
    const src = ctx.createBufferSource(); src.buffer = brown(); src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 130;
    const ng = ctx.createGain(); ng.gain.value = 1;
    const osc = ctx.createOscillator(); osc.frequency.value = 30;
    const sg = ctx.createGain(); sg.gain.value = 0.45;
    const bus = ctx.createGain(); bus.gain.value = 0;
    src.connect(lp).connect(ng).connect(bus); osc.connect(sg).connect(bus); bus.connect(master);
    src.start(); osc.start();
    return { bus, osc, lp };
  }
  function settle() {   // the slow finish: a heavy low thud and a darkening rumble tail
    const t0 = ctx.currentTime + 0.05;
    tone(55, 0.9, { to: 28, vol: 0.55, attack: 0.02, delay: 0.05 });
    const src = ctx.createBufferSource(); src.buffer = brown();
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(300, t0); f.frequency.exponentialRampToValueAtTime(80, t0 + 0.8);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.7, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
    src.connect(f).connect(g).connect(master); src.start(t0, Math.random() * 3); src.stop(t0 + 0.85);
  }
  function rumble(on) {
    if (MUTED || !ctx || on === rbOn) return;
    if (on && ctx.state === 'suspended') ctx.resume();
    rbOn = on;
    try {
      if (!rb) rb = rumbleGraph();
      const t = ctx.currentTime, g = rb.bus.gain, fr = rb.osc.frequency, lp = rb.lp.frequency;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
      fr.cancelScheduledValues(t); fr.setValueAtTime(fr.value, t);
      lp.cancelScheduledValues(t); lp.setValueAtTime(lp.value, t);
      if (on) {
        rbSince = performance.now();
        g.linearRampToValueAtTime(1, t + 0.35);     // quick, steady swell - then holds
        fr.linearRampToValueAtTime(30, t + 0.3); lp.linearRampToValueAtTime(130, t + 0.3);
      } else {
        g.setTargetAtTime(0, t, 0.5);               // ~2 s slow fade
        fr.exponentialRampToValueAtTime(22, t + 1.8); lp.exponentialRampToValueAtTime(70, t + 1.8);
        if (performance.now() - rbSince > 350) settle();   // a real move earns the settle; a nudge just fades
      }
    } catch (_) { /* */ }
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) rumble(false); });

  // Rate limit per sound so bursts (e.g. many list re-renders) never stack up.
  const lastPlayed = {};
  window.Sfx = {
    play(name) {
      if (MUTED || !ctx || !SOUNDS[name]) return;
      if (ctx.state === 'suspended') ctx.resume();
      const now = performance.now();
      if (now - (lastPlayed[name] || 0) < 80) return;
      lastPlayed[name] = now;
      try { SOUNDS[name](); } catch (_) { /* never let sound break the UI */ }
    },
    rumble,
    get muted() { return MUTED; },
  };

  /* Haptics: a light tick on button presses and screen changes.
   * Android: navigator.vibrate. iPhone (iOS 18+): Safari has no vibrate API,
   * but toggling an <input type=checkbox switch> gives the system's switch
   * haptic, so a hidden one is clicked from inside the tap. ?haptics=0 = off. */
  const NO_HAPTICS = qs.get('haptics') === '0';
  let hLabel = null, hLast = 0;
  function hapticEl() {
    if (hLabel || !document.body) return hLabel;
    hLabel = document.createElement('label');
    hLabel.setAttribute('aria-hidden', 'true');
    hLabel.style.cssText = 'position:fixed;left:-200px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden';
    const i = document.createElement('input'); i.type = 'checkbox'; i.setAttribute('switch', ''); i.tabIndex = -1;
    hLabel.appendChild(i); document.body.appendChild(hLabel);
    return hLabel;
  }
  window.Haptic = {
    tap() {
      if (NO_HAPTICS) return;
      const t = performance.now(); if (t - hLast < 70) return; hLast = t;
      try {
        if (navigator.vibrate) { navigator.vibrate(8); return; }
        const l = hapticEl(); if (l) l.click();
      } catch (_) { /* */ }
    },
  };
  // Any button-like press ticks (the hidden switch's own clicks are skipped).
  document.addEventListener('click', (e) => {
    if (hLabel && hLabel.contains(e.target)) return;
    if (e.target.closest && e.target.closest('button, a[href], [role="button"], [data-go], [data-tab], .tile, li[data-url], label, select, input[type="checkbox"]')) window.Haptic.tap();
  }, true);
})();
