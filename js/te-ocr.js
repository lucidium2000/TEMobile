// Camera OCR for the ThousandEyes token.
//
// Point the phone at the token on a computer screen; this reads the characters
// and fills the field, so you don't hand-type a long token. The OCR engine
// (Tesseract.js, WASM) loads only the first time you tap Scan, and the image is
// processed on-device and never uploaded.
//
// Reading a random token off a screen is the hard case for OCR, so accuracy
// comes from the pipeline, not one lucky frame:
//   - Capture a BURST of frames and vote per character position (a one-frame
//     1/l or 0/O slip gets outvoted).
//   - Binarize each frame with Otsu thresholding, auto-detect light-on-dark vs
//     dark-on-light, and blur lightly to kill screen moire.
//   - Upscale 3x, single-line mode, 300 dpi, charset whitelist.
//   - Flag characters the frames disagreed on, and always end on an editable
//     confirm step; the token is still validated against the API.
//
// window.TEOcr.scan() -> Promise<string|null>  (null if cancelled)
(function () {
  'use strict';

  const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~+/=';
  const FRAMES = 7;            // burst size
  const AGREE_OK = 0.6;        // below this fraction of frames agreeing -> flag the char
  // Look-alikes that OCR confuses the same way in every frame, so voting can't
  // catch them - flag them for the eye regardless of agreement.
  const AMBIG = new Set('0OoQ1lIi5S8B6G9gq2Zz7TcC'.split(''));

  let tessPromise = null;
  function loadTess() {
    if (window.Tesseract) return Promise.resolve();
    if (tessPromise) return tessPromise;
    tessPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = TESS_URL; s.async = true;
      s.onload = () => res();
      s.onerror = () => { tessPromise = null; rej(new Error('Could not load the OCR engine (no connection?).')); };
      document.head.appendChild(s);
    });
    return tessPromise;
  }

  // ── Image pipeline ─────────────────────────────────────────────────────────
  // Crop the scan box out of the current video frame (no scaling yet).
  function cropBox(video, stage, box) {
    const vW = video.videoWidth, vH = video.videoHeight;
    const sR = stage.getBoundingClientRect(), bR = box.getBoundingClientRect();
    const scale = Math.min(sR.width / vW, sR.height / vH);          // object-fit: contain
    const offX = (sR.width - vW * scale) / 2, offY = (sR.height - vH * scale) / 2;
    const ix = Math.max(0, (bR.left - sR.left - offX) / scale);
    const iy = Math.max(0, (bR.top - sR.top - offY) / scale);
    const iw = Math.min(vW - ix, bR.width / scale);
    const ih = Math.min(vH - iy, bR.height / scale);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(iw)); c.height = Math.max(1, Math.round(ih));
    c.getContext('2d').drawImage(video, ix, iy, iw, ih, 0, 0, c.width, c.height);
    return c;
  }

  // Grayscale -> 3x upscale -> light blur (de-moire) -> Otsu binarize with
  // auto polarity (text black on white). Returns a new canvas.
  function preprocess(src) {
    const up = 3;
    const c = document.createElement('canvas');
    c.width = src.width * up; c.height = src.height * up;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    let img;
    try { img = ctx.getImageData(0, 0, c.width, c.height); } catch (_) { return c; }
    const d = img.data, n = c.width * c.height;
    const g = new Float32Array(n);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) g[p] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    // Separable 3x3 box blur to soften moire / sub-pixel fringing.
    const W = c.width, H = c.height, b = new Float32Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, xl = x > 0 ? i - 1 : i, xr = x < W - 1 ? i + 1 : i;
      b[i] = (g[xl] + g[i] + g[xr]) / 3;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, yt = y > 0 ? i - W : i, yb = y < H - 1 ? i + W : i;
      g[i] = (b[yt] + b[i] + b[yb]) / 3;
    }
    // Otsu threshold.
    const hist = new Array(256).fill(0);
    for (let p = 0; p < n; p++) hist[Math.max(0, Math.min(255, g[p] | 0))]++;
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, maxVar = -1, thr = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > maxVar) { maxVar = between; thr = t; }
    }
    // Polarity: the larger class is the background -> make it white.
    let above = 0; for (let p = 0; p < n; p++) if (g[p] > thr) above++;
    const textIsAbove = above < n - above;   // fewer pixels = the text
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const isText = textIsAbove ? g[p] > thr : g[p] <= thr;
      const v = isText ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  async function makeWorker() {
    await loadTess();
    const w = await window.Tesseract.createWorker('eng');
    await w.setParameters({
      tessedit_char_whitelist: WHITELIST,
      tessedit_pageseg_mode: '7',          // single text line
      user_defined_dpi: '300',
      preserve_interword_spaces: '0',
    });
    return w;
  }
  async function readWith(worker, canvas) {
    const { data } = await worker.recognize(canvas);
    return { text: (data && data.text || '').replace(/\s+/g, ''), conf: data ? data.confidence || 0 : 0 };
  }

  // Majority vote per character position across frames of the modal length.
  function consensus(reads) {
    const good = reads.filter((r) => r.text.length);
    if (!good.length) return { text: '', low: new Set() };
    const byLen = {};
    good.forEach((r) => { (byLen[r.text.length] = byLen[r.text.length] || []).push(r); });
    let L = 0, best = -1;
    for (const len in byLen) { const score = byLen[len].length; if (score > best || (score === best && +len > L)) { best = score; L = +len; } }
    const pool = byLen[L];
    if (pool.length < 2) { const top = good.slice().sort((a, b) => b.conf - a.conf)[0]; return { text: top.text, low: new Set() }; }
    let out = '', low = new Set();
    for (let i = 0; i < L; i++) {
      const tally = {};
      pool.forEach((r) => { const ch = r.text[i]; tally[ch] = (tally[ch] || 0) + 1; });
      let ch = '', c = -1;
      for (const k in tally) if (tally[k] > c) { c = tally[k]; ch = k; }
      out += ch;
      if (c / pool.length < AGREE_OK) low.add(i);
    }
    return { text: out, low };
  }

  // Test hook: one-shot recognize of a clean canvas/image.
  async function recognizeOnce(canvasOrImg) {
    const w = await makeWorker();
    try { return (await readWith(w, preprocess(toCanvas(canvasOrImg)))).text; }
    finally { try { await w.terminate(); } catch (_) { /* */ } }
  }
  function toCanvas(x) {
    if (x instanceof HTMLCanvasElement) return x;
    const c = document.createElement('canvas'); c.width = x.width || x.videoWidth; c.height = x.height || x.videoHeight;
    c.getContext('2d').drawImage(x, 0, 0); return c;
  }

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function scan() {
    return new Promise((resolve) => {
      const ov = el('div', 'ocr-ov');
      const stage = el('div', 'ocr-stage');
      const video = el('video'); video.setAttribute('playsinline', ''); video.muted = true; video.autoplay = true;
      const box = el('div', 'ocr-box');
      const hint = el('div', 'ocr-hint', 'Fill the box with one line of the token. Tip: zoom it large on your screen first, and hold steady.');
      stage.append(video, box, hint);
      const bar = el('div', 'ocr-bar');
      const cancel = el('button', 'ocr-btn ghost', 'Cancel');
      const capture = el('button', 'ocr-btn', 'Capture');
      bar.append(cancel, capture);
      ov.append(stage, bar);
      document.body.appendChild(ov);

      let stream = null, done = false;
      function stop() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; }
      function close(val) { if (done) return; done = true; stop(); ov.remove(); resolve(val); }
      function fail(msg) {
        stage.innerHTML = ''; stage.append(el('div', 'ocr-msg', msg));
        bar.innerHTML = ''; const ok = el('button', 'ocr-btn', 'Close'); ok.onclick = () => close(null); bar.append(ok);
      }
      cancel.onclick = () => close(null);

      capture.onclick = async () => {
        if (!video.videoWidth) return;
        bar.innerHTML = '';
        const proc = el('div', 'ocr-proc', '<i></i><span>Reading…</span>');
        stage.append(proc); const label = proc.querySelector('span');
        let worker;
        try {
          worker = await makeWorker();
          const reads = [];
          for (let k = 0; k < FRAMES; k++) {
            label.textContent = `Reading… ${k + 1}/${FRAMES}`;
            reads.push(await readWith(worker, preprocess(cropBox(video, stage, box))));
            await new Promise((r) => setTimeout(r, 90));   // small gap between frames
          }
          const { text, low } = consensus(reads);
          proc.remove();
          showResult(text, low);
        } catch (e) { fail((e && e.message) || 'Couldn’t read it.'); }
        finally { if (worker) try { await worker.terminate(); } catch (_) { /* */ } }
      };

      function showResult(text, low) {
        box.style.display = 'none'; hint.style.display = 'none'; video.style.opacity = '.2';
        // Flag frames-disagreed characters AND every easily-misread look-alike.
        low = new Set(low ? [...low] : []);
        for (let i = 0; i < text.length; i++) if (AMBIG.has(text[i])) low.add(i);
        const res = el('div', 'ocr-result');
        res.append(el('div', 'ocr-rl', text.length && low.size
          ? 'Highlighted characters are easy to misread (0/O, 1/l…) or the frames disagreed — check them:'
          : 'Check this is right before using it:'));
        const prev = el('div', 'ocr-prev');
        prev.innerHTML = text.length
          ? [...text].map((ch, i) => `<span class="${low && low.has(i) ? 'lc' : ''}">${esc(ch)}</span>`).join('')
          : '<em>Nothing read — try again, larger and steadier.</em>';
        res.append(prev);
        const input = el('input', 'ocr-in'); input.type = 'text'; input.value = text; input.spellcheck = false; input.autocapitalize = 'off'; input.autocomplete = 'off';
        res.append(input);
        stage.append(res);
        bar.innerHTML = '';
        const retry = el('button', 'ocr-btn ghost', 'Retry');
        const use = el('button', 'ocr-btn', 'Use token');
        retry.onclick = () => close(scan());
        use.onclick = () => close(input.value.replace(/\s+/g, ''));
        bar.append(retry, use);
        // Keep the highlighted preview in step with manual edits.
        input.addEventListener('input', () => {
          const v = input.value.replace(/\s+/g, '');
          prev.innerHTML = [...v].map((ch) => `<span>${esc(ch)}</span>`).join('');
        });
        input.focus();
      }

      navigator.mediaDevices && navigator.mediaDevices.getUserMedia
        ? navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
          .then((s) => { stream = s; video.srcObject = s; })
          .catch((e) => fail(e && e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in your browser, or paste the token instead.' : 'No camera available. Paste the token instead.'))
        : fail('This browser can’t open the camera. Paste the token instead.');
    });
  }

  window.TEOcr = { scan, _recognize: recognizeOnce, _preprocess: preprocess };
})();
