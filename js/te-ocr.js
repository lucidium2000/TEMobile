// Camera OCR for the ThousandEyes token.
//
// Point the phone at the token on a computer screen; this reads the characters
// and fills the field, so you don't hand-type a long token. The OCR engine
// (Tesseract.js, WASM) is loaded only the first time you tap Scan, so it never
// weighs on normal use. The image is processed on-device and never uploaded.
//
// OCR on a random token is imperfect (0/O, 1/l/I, 5/S, rn/m), and reading off a
// screen adds glare, so the flow always ends on an editable confirm step and
// the token is validated against the API before it's trusted.
//
// window.TEOcr.scan() -> Promise<string|null>  (null if cancelled)
(function () {
  'use strict';

  const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  // Inclusive of base64 / base64url / JWT shapes so a valid char is never dropped;
  // the confirm step + API validation catch the rest.
  const WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~+/=';

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

  // Crop the scan box out of the current video frame, upscaled and
  // contrast-boosted - screen text is small and low-contrast for OCR.
  function cropBox(video, stage, box) {
    const vW = video.videoWidth, vH = video.videoHeight;
    const sR = stage.getBoundingClientRect(), bR = box.getBoundingClientRect();
    // object-fit: contain -> the frame is centred and letterboxed in the stage.
    const scale = Math.min(sR.width / vW, sR.height / vH);
    const offX = (sR.width - vW * scale) / 2, offY = (sR.height - vH * scale) / 2;
    const ix = Math.max(0, (bR.left - sR.left - offX) / scale);
    const iy = Math.max(0, (bR.top - sR.top - offY) / scale);
    const iw = Math.min(vW - ix, bR.width / scale);
    const ih = Math.min(vH - iy, bR.height / scale);
    const up = 2;
    const c = document.createElement('canvas');
    c.width = Math.round(iw * up); c.height = Math.round(ih * up);
    const ctx = c.getContext('2d');
    ctx.drawImage(video, ix, iy, iw, ih, 0, 0, c.width, c.height);
    // Grayscale + contrast stretch.
    try {
      const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
      let min = 255, max = 0;
      for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11); d[i] = d[i + 1] = d[i + 2] = g; if (g < min) min = g; if (g > max) max = g; }
      const range = Math.max(1, max - min);
      for (let i = 0; i < d.length; i += 4) { const v = ((d[i] - min) / range) * 255; d[i] = d[i + 1] = d[i + 2] = v; }
      ctx.putImageData(img, 0, 0);
    } catch (_) { /* tainted or unsupported: use as-is */ }
    return c;
  }

  async function recognize(canvasOrImg) {
    await loadTess();
    const worker = await window.Tesseract.createWorker('eng');
    try {
      await worker.setParameters({ tessedit_char_whitelist: WHITELIST, tessedit_pageseg_mode: '6', preserve_interword_spaces: '0' });
      const { data } = await worker.recognize(canvasOrImg);
      // Tokens carry no whitespace.
      return (data && data.text || '').replace(/\s+/g, '');
    } finally { try { await worker.terminate(); } catch (_) { /* */ } }
  }

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function scan() {
    return new Promise((resolve) => {
      const ov = el('div', 'ocr-ov');
      const stage = el('div', 'ocr-stage');
      const video = el('video'); video.setAttribute('playsinline', ''); video.muted = true; video.autoplay = true;
      const box = el('div', 'ocr-box');
      const hint = el('div', 'ocr-hint', 'Fill the box with the token. Tip: zoom it large on your screen first.');
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
        stage.innerHTML = '';
        stage.append(el('div', 'ocr-msg', msg));
        bar.innerHTML = ''; const ok = el('button', 'ocr-btn', 'Close'); ok.onclick = () => close(null); bar.append(ok);
      }

      cancel.onclick = () => close(null);
      capture.onclick = async () => {
        if (!video.videoWidth) return;
        bar.innerHTML = '';
        const proc = el('div', 'ocr-proc', '<i></i>Reading the token…');
        stage.append(proc);
        let text = '';
        try { text = await recognize(cropBox(video, stage, box)); }
        catch (e) { fail((e && e.message) || 'Couldn’t read it.'); return; }
        proc.remove();
        // Confirm / edit step.
        box.style.display = 'none'; hint.style.display = 'none'; video.style.opacity = '.25';
        const res = el('div', 'ocr-result');
        res.append(el('div', 'ocr-rl', 'Check this is right — OCR can miss a character:'));
        const input = el('input', 'ocr-in'); input.type = 'text'; input.value = text; input.spellcheck = false; input.autocapitalize = 'off';
        res.append(input);
        stage.append(res);
        const retry = el('button', 'ocr-btn ghost', 'Retry');
        const use = el('button', 'ocr-btn', 'Use token');
        bar.append(retry, use);
        retry.onclick = () => close(scan());   // re-open a fresh scan; resolve with its result
        use.onclick = () => close(input.value.replace(/\s+/g, ''));
        input.focus();
      };

      navigator.mediaDevices && navigator.mediaDevices.getUserMedia
        ? navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
          .then((s) => { stream = s; video.srcObject = s; })
          .catch((e) => fail(e && e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in your browser, or paste the token instead.' : 'No camera available. Paste the token instead.'))
        : fail('This browser can’t open the camera. Paste the token instead.');
    });
  }

  window.TEOcr = { scan, _recognize: recognize };
})();
