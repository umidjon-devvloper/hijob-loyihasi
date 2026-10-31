/**
 * ChatGPT content script — pure DOM worker.
 *
 * The background service worker owns the queue loop and sends us a DRESS
 * request per task:
 *   { type: 'DRESS', prompt, hijabBase64, hijabMime, timeoutMs }
 *
 * We:
 *   1. Fill the composer with the prompt
 *   2. Attach the hijob file (via DataTransfer on the file input)
 *   3. Click send
 *   4. Watch for the assistant's generated image
 *   5. Reply with the image URL (or base64 if we can read it directly)
 *
 * We also respond to PING so the background can confirm the script is
 * attached, and DIAGNOSE for the popup's debug button.
 */

(() => {
  console.log('[N24:31] content v1.3.2 ready', { url: location.href });

  // ─── Message handler (one-shot: PING, DIAGNOSE) ────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      if (msg?.type === 'PING') {
        sendResponse({ ok: true, href: location.href });
        return;
      }
      if (msg?.type === 'DIAGNOSE') {
        sendResponse({ ok: true, report: diagnose() });
        return;
      }
      sendResponse({ ok: false, error: 'unknown message' });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message ?? e) });
    }
    // No `return true` — we only handle sync replies here. DRESS flows
    // through the long-lived port below.
  });

  // ─── Port handler (long-lived: DRESS) ──────────────────────────────
  //
  // DRESS can take 3 min while GPT renders. In Manifest V3 the background
  // service worker is killed after ~30s of idle time, which would close an
  // in-flight sendMessage channel and surface "message channel closed before
  // a response was received". A port keeps the SW alive for its entire
  // lifetime, so we route the long task through this port instead.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'n2431-dress') return;
    port.onMessage.addListener(async (msg) => {
      try {
        if (msg?.type === 'DRESS') {
          showTicker(msg);
          const url = await runDress(msg);
          tick('💾 Rasm o\'qilmoqda va 3×3 ga qirqilyapti…');
          const slices = await sliceGrid(url, msg.gridKeys, msg.rows ?? 3, msg.cols ?? 3, msg.scene);
          hideTicker();
          port.postMessage({ ok: true, slices });
          return;
        }
        if (msg?.type === 'BASE_GRID') {
          showTicker(msg);
          const url = await runBaseGrid(msg);
          tick('💾 Rasm o\'qilmoqda va 3×3 ga qirqilyapti…');
          const slices = await sliceGrid(url, msg.gridKeys, msg.rows ?? 3, msg.cols ?? 3);
          hideTicker();
          port.postMessage({ ok: true, slices });
          return;
        }
        if (msg?.type === 'SLICE_LAST') {
          // Grab the LATEST image already in the current ChatGPT chat
          // without triggering a new generation. Lets a seller manually
          // craft the perfect 3×3 in ChatGPT (regen until it looks good),
          // then one-click upload that exact image.
          showTicker(msg);
          tick('🔎 Oxirgi rasm izlanmoqda…');
          const url = pickLatestChatImage();
          if (!url) throw new Error('ChatGPT suhbatida rasm topilmadi');
          tick('💾 Rasm o\'qilmoqda va 3×3 ga qirqilyapti…');
          const slices = await sliceGrid(url, msg.gridKeys, msg.rows ?? 3, msg.cols ?? 3);
          hideTicker();
          port.postMessage({ ok: true, slices });
          return;
        }
        port.postMessage({ ok: false, error: 'unknown port message' });
      } catch (e) {
        hideTicker();
        try {
          port.postMessage({ ok: false, error: String(e?.message ?? e) });
        } catch {
          // port already closed on the other end
        }
      }
    });
  });

  // ─── Core: run one DRESS task ──────────────────────────────────────

  async function runDress({ prompt, hijabBase64, hijabMime, styleRefBase64, styleRefMime, timeoutMs = 180_000 }) {
    tick('⏳ ChatGPT textarea izlanmoqda…');
    if (!(await waitForComposer(15_000))) throw new Error('composer topilmadi');

    tick('✏️ Prompt yozilmoqda…');
    if (!(await fillPrompt(prompt))) throw new Error('prompt yozib bo\'lmadi');

    // Attach the STYLE REFERENCE FIRST — GPT-4o weights the first attached
    // image more heavily, which is exactly what we want for silhouette.
    if (styleRefBase64) {
      tick('📎 Style reference biriktirilmoqda…');
      const refBin = Uint8Array.from(atob(styleRefBase64), (c) => c.charCodeAt(0));
      const refFile = new File(
        [new Blob([refBin], { type: styleRefMime || 'image/png' })],
        'STYLE-REFERENCE-copy-this-wrap.png',
        { type: styleRefMime || 'image/png' },
      );
      if (!(await attachFile(refFile))) throw new Error('style reference biriktirib bo\'lmadi');
    }

    tick('📎 Hijob biriktirilmoqda…');
    const bin = Uint8Array.from(atob(hijabBase64), (c) => c.charCodeAt(0));
    const file = new File([new Blob([bin], { type: hijabMime })], 'fabric-swatch-color-only.jpg', { type: hijabMime });
    if (!(await attachFile(file))) throw new Error('fayl biriktirib bo\'lmadi');

    tick('⏳ Attachment preview kutilmoqda…');
    await waitForAttachment(10_000);

    // Fingerprint every attachment we send so none can be mistaken for the
    // generated result. GPT sometimes echoes a reference back verbatim —
    // without this guard the slicer would cut up our reference photo and
    // ship it to the seller as the catalogue.
    const hijabPrint = await fingerprintBlob(file).catch(() => null);
    const avoidPrints = [hijabPrint];
    if (styleRefBase64) {
      const refBin2 = Uint8Array.from(atob(styleRefBase64), (c) => c.charCodeAt(0));
      const refBlob = new Blob([refBin2], { type: styleRefMime || 'image/png' });
      const refPrint = await fingerprintBlob(refBlob).catch(() => null);
      if (refPrint) avoidPrints.push(refPrint);
    }

    // Snapshot every image on the page BEFORE send — anything already
    // visible (old chat images, composer preview) is not a new result.
    const before = snapshotImageSrcs();

    tick('▶️ Send bosilmoqda…');
    if (!(await clickSend())) throw new Error('send tugmasi topilmadi');

    tick('⏳ GPT javobini kutmoqda…');
    const url = await waitForAssistantImage(before, timeoutMs, avoidPrints);
    if (!url) throw new Error(`GPT ${timeoutMs/1000}s ichida rasm chiqarmadi`);

    tick('✓ Rasm olindi');
    return url;
  }

  // Text-only prompt (no attachment), used for the one-off base-mannequin
  // 3×3 grid generation. Mirrors runDress but skips the file attach step.
  async function runBaseGrid({ prompt, timeoutMs = 420_000 }) {
    tick('⏳ ChatGPT textarea izlanmoqda…');
    if (!(await waitForComposer(15_000))) throw new Error('composer topilmadi');

    tick('✏️ Prompt yozilmoqda…');
    if (!(await fillPrompt(prompt))) throw new Error('prompt yozib bo\'lmadi');

    const before = snapshotImageSrcs();

    tick('▶️ Send bosilmoqda…');
    if (!(await clickSend())) throw new Error('send tugmasi topilmadi');

    tick('⏳ GPT 3×3 grid rasmini chizmoqda…');
    const url = await waitForAssistantImage(before, timeoutMs);
    if (!url) throw new Error(`GPT ${timeoutMs/1000}s ichida rasm chiqarmadi`);

    tick('✓ Rasm olindi');
    return url;
  }

  // Captures src/currentSrc of every <img> on the page right now. Used as a
  // "before" baseline — anything in this set is NOT a new generated result.
  function snapshotImageSrcs() {
    const set = new Set();
    for (const img of document.querySelectorAll('img')) {
      const src = img.currentSrc || img.src;
      if (src) set.add(src);
    }
    return set;
  }

  // Slice the generated composite image into rows×cols cells (default 3×3)
  // and return one base64 PNG per cell, zipped with the gridKeys array so the
  // caller knows which sizeKey each slice belongs to. When the source image
  // has an alpha channel (per prompt — "transparent PNG"), each slice is
  // auto-trimmed to the opaque bounding box so there's no empty gutter.
  async function sliceGrid(url, gridKeys, rows = 3, cols = 3, scene = null) {
    const expected = rows * cols;
    if (!Array.isArray(gridKeys) || gridKeys.length !== expected) {
      throw new Error(`gridKeys length ${gridKeys?.length} != ${expected}`);
    }
    const img = await loadImage(url);

    // GPT never draws a perfectly even grid — a figure in row 3 can start a
    // few px above the 2/3 line, so an equal cut leaves its hijab top glued
    // to the bottom of the cell above. Cut along the real dark gutters
    // between figures instead, then wipe any neighbour scraps left over.
    const { xs, ys, bg } = findGridCuts(img, rows, cols);
    console.log('[N24:31] grid cuts', { xs, ys, bg });
    const cells = [];
    for (let i = 0; i < expected; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x0 = xs[col];
      const y0 = ys[row];
      const cellW = xs[col + 1] - x0;
      const cellH = ys[row + 1] - y0;
      const cell = document.createElement('canvas');
      cell.width = cellW;
      cell.height = cellH;
      const ctx = cell.getContext('2d');
      if (!ctx) throw new Error('canvas 2d context');
      ctx.drawImage(img, x0, y0, cellW, cellH, 0, 0, cellW, cellH);
      const box = bg ? isolateMainFigure(cell, bg) : null;
      cells.push({ sizeKey: gridKeys[i], cell, box });
    }

    // Fitting-room mode: needs the scene, a readable backdrop colour and a
    // figure box in every cell; otherwise fall back to plain slices.
    if (scene && bg && cells.every((c) => c.box)) {
      const sceneUrl = URL.createObjectURL(
        new Blob([Uint8Array.from(atob(scene.base64), (ch) => ch.charCodeAt(0))], { type: scene.mime }),
      );
      try {
        const sceneImg = await loadImage(sceneUrl);
        const figures = cells.map((c) => keyOut(c.cell, c.box, bg));
        const tallest = Math.max(...figures.map((f) => f.height));
        const scale = (TALLEST_H * SCENE_H) / tallest;
        return cells.map((c, i) =>
          canvasToSlice(c.sizeKey, placeOnScene(figures[i], sceneImg, scale), 'image/jpeg', 0.9),
        );
      } finally {
        URL.revokeObjectURL(sceneUrl);
      }
    }

    // Uniform-scale path: key out backdrop on every cell, measure the
    // opaque bbox of each resulting figure, then draw EVERY figure into
    // its own 900×1200 canvas at the SAME scale (based on the tallest
    // figure in the grid). This keeps slim↔full and short↔tall
    // proportions comparable across the 9 variants, and does exactly one
    // resample step from native cell pixels → final canvas so quality
    // survives. The old centerFigureInCell path tight-cropped each cell
    // and rescaled it independently, which both broke proportions and
    // added an extra resample pass that softened detail.
    return uniformSliceCells(cells, bg);
  }

  function uniformSliceCells(cells, gridBg) {
    const keyed = cells.map((c) => {
      const cellBg = gridBg || sampleBackground(
        c.cell.getContext('2d', { willReadFrequently: true })
          .getImageData(0, 0, c.cell.width, c.cell.height).data,
        c.cell.width, c.cell.height,
      );
      const box = { x0: 0, y0: 0, x1: c.cell.width, y1: c.cell.height };
      return { sizeKey: c.sizeKey, canvas: keyOut(c.cell, box, cellBg) };
    });
    const bboxes = keyed.map((k) => opaqueBbox(k.canvas));
    // Guard against a cell where keyOut returned nothing opaque.
    const validHs = bboxes.filter((b) => b.h > 0).map((b) => b.h);
    const validWs = bboxes.filter((b) => b.w > 0).map((b) => b.w);
    if (!validHs.length || !validWs.length) {
      return cells.map((c) =>
        canvasToSlice(c.sizeKey, centerFigureInCell(c.cell), 'image/png'),
      );
    }
    const maxH = Math.max(...validHs);
    const maxW = Math.max(...validWs);
    const scale = Math.min(
      (CELL_OUT_H * 0.90) / maxH,
      (CELL_OUT_W * 0.88) / maxW,
    );
    return keyed.map((k, i) =>
      canvasToSlice(k.sizeKey, drawUniform(k.canvas, bboxes[i], scale), 'image/png'),
    );
  }

  // Tight opaque bounding box inside a transparent canvas.
  function opaqueBbox(canvas) {
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let d;
    try { d = ctx.getImageData(0, 0, w, h).data; } catch { return { x: 0, y: 0, w, h }; }
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    const ALPHA_MIN = 32;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] >= ALPHA_MIN) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // Draw the transparent figure into a fixed 900×1200 canvas at the given
  // scale: horizontally centered on the figure's own center-of-mass column,
  // and vertically positioned so the feet sit ~96% down the frame (same
  // floor line for every variant, so short/mid/tall differences stay visible).
  function drawUniform(figCanvas, bbox, scale) {
    const out = document.createElement('canvas');
    out.width = CELL_OUT_W;
    out.height = CELL_OUT_H;
    const octx = out.getContext('2d');
    if (!octx || bbox.w === 0) return out;
    octx.imageSmoothingQuality = 'high';
    const dw = bbox.w * scale;
    const dh = bbox.h * scale;
    const destX = (CELL_OUT_W - dw) / 2;
    const floorY = CELL_OUT_H * 0.96;
    const destY = floorY - dh;
    octx.drawImage(figCanvas, bbox.x, bbox.y, bbox.w, bbox.h, destX, destY, dw, dh);
    return out;
  }

  // Find the main figure in the cell (ignoring stray feet / hijab tops
  // from neighbouring rows that bled across the grid cut), then crop
  // tightly around that figure and resize the crop into a FIXED-ASPECT
  // 3:4 output so every one of the 9 variants comes back the same shape
  // and the hero/thumbnail renderer can place them identically. Dark
  // hijab / hair / shoes sit very close to the near-black boutique
  // backdrop, so the detection threshold is low on purpose — too high
  // and the top of the head or the feet get silently dropped out of the
  // bbox and chopped off in the final crop.
  const CELL_FG_DIST = 20;  // |ΔR|+|ΔG|+|ΔB| threshold vs. sampled bg
  // Higher-res output per cell — sharper detail retention for product
  // detail page where the image is displayed at close to full width.
  // Final canvas resolution per cell. Bumped from 900×1200 → 1500×2000 so
  // the mobile detail page (shown at ~1200 px on a 3x retina phone) is no
  // longer silently upscaled by the OS image viewer. GPT's native cell is
  // ~340 px wide, so this is still a ~4× upsample at drawImage time, but
  // the browser's bicubic resampler is far better than the phone's and
  // the resulting PNG is far crisper on the product page.
  const CELL_OUT_W = 1500;
  const CELL_OUT_H = 2000;

  function centerFigureInCell(cell) {
    const w = cell.width;
    const h = cell.height;
    const ctx = cell.getContext('2d', { willReadFrequently: true });
    if (!ctx) return cell;
    let d;
    try { d = ctx.getImageData(0, 0, w, h).data; } catch { return cell; }
    const bg = sampleBackground(d, w, h);

    const colProf = new Uint32Array(w);
    const rowProf = new Uint32Array(h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (
          Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) >
          CELL_FG_DIST
        ) { colProf[x]++; rowProf[y]++; }
      }
    }
    // mainBand picks the HEAVIEST contiguous run of fg lines on each
    // axis — this is what rejects a thin stray strip of feet or head at
    // the top/bottom of the cell (bigger than the stray because they
    // span the whole figure).
    const ry = mainBand(rowProf);
    const rx = mainBand(colProf);
    if (!ry || !rx) return cell;
    const [y0, y1] = ry;
    const [x0, x1] = rx;
    if (y1 <= y0 || x1 <= x0) return cell;

    // Breathing pad around the figure so the top of the hijab and the
    // bottom of the shoe don't kiss the output frame — the feet of a
    // "tall" row benefit the most because the row-cut used to sit a
    // couple of pixels into the figure's shoe.
    const figW = x1 - x0 + 1;
    const figH = y1 - y0 + 1;
    const padX = Math.round(figW * 0.08);
    const padY = Math.round(figH * 0.06);
    const srcX0 = Math.max(0, x0 - padX);
    const srcY0 = Math.max(0, y0 - padY);
    const srcX1 = Math.min(w, x1 + padX);
    const srcY1 = Math.min(h, y1 + padY);
    const srcW = srcX1 - srcX0;
    const srcH = srcY1 - srcY0;

    // Build a transparent cut-out of the figure using the proven keyOut
    // path (connected-component flood-fill from edges + despill), then
    // place that onto a FIXED 3:4 canvas so every variant has the same
    // frame. The simplified alpha-ramp we were using before leaked
    // chroma on non-pure backgrounds and left dark halos on JPEG-
    // compressed edges; keyOut's flood-fill ignores enclosed dark
    // pockets inside the figure and keeps the model's own dark hijab/
    // hair/shoes fully opaque.
    const figBox = { x0: srcX0, y0: srcY0, x1: srcX1, y1: srcY1 };
    const figure = keyOut(cell, figBox, bg);
    const fw = figure.width;
    const fh = figure.height;

    const out = document.createElement('canvas');
    out.width = CELL_OUT_W;
    out.height = CELL_OUT_H;
    const octx = out.getContext('2d');
    if (!octx) return cell;
    octx.imageSmoothingQuality = 'high';
    const scale = Math.min(CELL_OUT_W / fw, CELL_OUT_H / fh);
    const dw = fw * scale;
    const dh = fh * scale;
    const destX = (CELL_OUT_W - dw) / 2;
    const destY = (CELL_OUT_H - dh) / 2;
    octx.drawImage(figure, 0, 0, fw, fh, destX, destY, dw, dh);
    return out;
  }

  // ─── Gutter-aware grid cutting ─────────────────────────────────────

  const FG_DIST = 60; // sum of |ΔR|+|ΔG|+|ΔB| above which a pixel is "figure"

  function isFg(d, i, bg) {
    return Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > FG_DIST;
  }

  // Background = average of the four 8×8 corner patches (the prompt asks
  // for a solid flat background, so corners are always empty).
  function sampleBackground(d, w, h) {
    const s = [0, 0, 0];
    let n = 0;
    const p = 8;
    for (const [cx, cy] of [[0, 0], [w - p, 0], [0, h - p], [w - p, h - p]]) {
      for (let y = cy; y < cy + p; y++) {
        for (let x = cx; x < cx + p; x++) {
          const i = (y * w + x) * 4;
          s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2];
          n++;
        }
      }
    }
    return s.map((v) => Math.round(v / n));
  }

  // Returns cut positions [0, c1, …, W] / [0, r1, …, H]. Each inner cut
  // goes through the middle of the widest empty band near its expected
  // equal-split position. Falls back to equal cuts if pixels are
  // unreadable (tainted canvas).
  function findGridCuts(img, rows, cols) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const equal = (len, n) => Array.from({ length: n + 1 }, (_, k) => Math.round((len * k) / n));
    let d;
    try {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      d = ctx.getImageData(0, 0, w, h).data;
    } catch {
      return { xs: equal(w, cols), ys: equal(h, rows), bg: null };
    }
    const bg = sampleBackground(d, w, h);
    const rowProf = new Uint32Array(h);
    const colProf = new Uint32Array(w);
    // "Blackness" = fraction of near-pure-black pixels on this axis.
    // The DRESS prompt asks GPT to draw solid-black gutters between
    // the 3×3 cells, so a row/column that is almost entirely black is
    // the gutter the slicer should lock onto. Even when GPT ignores
    // that instruction the near-black count stays low on figure/scene
    // rows and we fall through to the old empty-band detection.
    const rowBlack = new Uint32Array(h);
    const colBlack = new Uint32Array(w);
    const BLACK_T = 24; // r+g+b <= this → counted as near-black
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (isFg(d, i, bg)) { rowProf[y]++; colProf[x]++; }
        if (d[i] + d[i + 1] + d[i + 2] <= BLACK_T) { rowBlack[y]++; colBlack[x]++; }
      }
    }
    return {
      xs: cutsAlong(colProf, cols, colBlack, h),
      ys: cutsAlong(rowProf, rows, rowBlack, w),
      bg,
    };
  }

  function cutsAlong(prof, n, blackProf, crossLen) {
    const len = prof.length;
    const cuts = [0];
    // A line counts as "the black gutter" when nearly every pixel along
    // its cross-axis is pure black. 70 % is enough slack for AA edges.
    const blackHit = blackProf ? Math.round(crossLen * 0.7) : Infinity;
    for (let k = 1; k < n; k++) {
      const expected = Math.round((len * k) / n);
      const win = Math.round((len / n) * 0.3);
      const lo = Math.max(cuts[cuts.length - 1] + 1, expected - win);
      const hi = Math.min(len - 1, expected + win);

      // 1. First try to lock onto a solid-black gutter bar in the
      //    window. If one exists, cut through its centre and ignore
      //    the empty-band fallback — the bar is what the prompt asked
      //    GPT to draw and it's the only cut that never clips a figure.
      if (blackProf) {
        let bestBlack = null;
        for (let i = lo; i <= hi; ) {
          if (blackProf[i] < blackHit) { i++; continue; }
          let j = i;
          while (j + 1 <= hi && blackProf[j + 1] >= blackHit) j++;
          const run = { mid: Math.round((i + j) / 2), size: j - i + 1 };
          if (!bestBlack || run.size > bestBlack.size) bestBlack = run;
          i = j + 1;
        }
        if (bestBlack && bestBlack.size >= 2) {
          cuts.push(bestBlack.mid);
          continue;
        }
      }

      // 2. Fallback — widest run of lines with the lowest fg density
      //    near the expected split. Works when GPT drew faint gutters
      //    instead of solid black bars.
      let min = Infinity;
      for (let i = lo; i <= hi; i++) min = Math.min(min, prof[i]);
      const tol = min + 3;
      let best = null;
      for (let i = lo; i <= hi; ) {
        if (prof[i] > tol) { i++; continue; }
        let j = i;
        while (j + 1 <= hi && prof[j + 1] <= tol) j++;
        const run = { mid: Math.round((i + j) / 2), size: j - i + 1 };
        if (
          !best || run.size > best.size ||
          (run.size === best.size && Math.abs(run.mid - expected) < Math.abs(best.mid - expected))
        ) best = run;
        i = j + 1;
      }
      cuts.push(best ? best.mid : expected);
    }
    cuts.push(len);
    return cuts;
  }

  // Keep only the dominant figure in a cell: find the heaviest contiguous
  // band of figure pixels along each axis and paint everything outside it
  // with the background colour, so a neighbour's sleeve or hijab tip that
  // crossed the gutter doesn't ride along. Returns the padded figure box
  // ({x0, y0, x1, y1}, end-exclusive) or null.
  function isolateMainFigure(cell, bg) {
    const w = cell.width;
    const h = cell.height;
    const ctx = cell.getContext('2d', { willReadFrequently: true });
    let d;
    try { d = ctx.getImageData(0, 0, w, h).data; } catch { return null; }
    const rowProf = new Uint32Array(h);
    const colProf = new Uint32Array(w);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (isFg(d, (y * w + x) * 4, bg)) { rowProf[y]++; colProf[x]++; }
      }
    }
    const ry = mainBand(rowProf);
    const rx = mainBand(colProf);
    if (!ry || !rx) return null;
    const pad = 6;
    const y0 = Math.max(0, ry[0] - pad);
    const y1 = Math.min(h, ry[1] + 1 + pad);
    const x0 = Math.max(0, rx[0] - pad);
    const x1 = Math.min(w, rx[1] + 1 + pad);
    ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    ctx.fillRect(0, 0, w, y0);
    ctx.fillRect(0, y1, w, h - y1);
    ctx.fillRect(0, y0, x0, y1 - y0);
    ctx.fillRect(x1, y0, w - x1, y1 - y0);
    return { x0, y0, x1, y1 };
  }

  // ─── Fitting-room compositing ──────────────────────────────────────
  //
  // Every slice is keyed off its flat backdrop and stood on the floor of
  // the same fitting-room photo. One scale is shared by all 9 cells so the
  // short/mid/tall height difference GPT drew survives the move.

  const SCENE_W = 720;
  const SCENE_H = 960;
  const FLOOR_Y = 0.95; // feet line, fraction of scene height
  const TALLEST_H = 0.84; // tallest figure's height, fraction of scene height
  const KEY_LO = 40; // colour distance (sum |Δ|) fully background below this
  const KEY_HI = 120; // … fully figure above this

  // Figure box → canvas of the same size with the backdrop keyed to alpha.
  function keyOut(cell, box, bg) {
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(cell, box.x0, box.y0, w, h, 0, 0, w, h);
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    const n = w * h;
    const greenKey = bg[1] > bg[0] + 40 && bg[1] > bg[2] + 40;
    const magentaKey = bg[0] > bg[1] + 40 && bg[2] > bg[1] + 40;
    // GPT sometimes ignores the "flat solid chroma" instruction and draws a
    // very dark backdrop (near black with coloured noise sprinkled on it).
    // Detect that so we can key more aggressively and sweep the noise out —
    // otherwise semi-transparent speckles leak into the final PNG and show
    // up as green/colored dots around the figure on the mobile preview.
    const bgSum = bg[0] + bg[1] + bg[2];
    const darkKey = !greenKey && !magentaKey && bgSum < 80;
    // Dark backdrops: widen the ramp so faint colored noise (sum-dist 60–180
    // from near-black bg) falls below full opacity and can be flood-killed.
    const keyLo = darkKey ? 30 : KEY_LO;
    const keyHi = darkKey ? 220 : KEY_HI;

    // Pre-filter: any pixel still clearly in the chroma colour (even if the
    // ramp would hold onto it as an edge) gets snapped to the background —
    // otherwise semi-transparent chroma pixels leak around every figure
    // after keying, showing up as a yashil halo on the admin preview.
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      if (greenKey) {
        if (d[i + 1] > d[i] + 20 && d[i + 1] > d[i + 2] + 15 && d[i + 1] > 110) {
          d[i] = bg[0]; d[i + 1] = bg[1]; d[i + 2] = bg[2];
        }
      } else if (magentaKey) {
        if (d[i] > d[i + 1] + 20 && d[i + 2] > d[i + 1] + 20 && d[i] > 110 && d[i + 2] > 110) {
          d[i] = bg[0]; d[i + 1] = bg[1]; d[i + 2] = bg[2];
        }
      } else if (darkKey) {
        // Only snap pixels that are both DARK and CLOSE to the backdrop
        // colour. The old rule snapped on brightness alone, which stripped
        // dark hijabs and dark dress fabric straight off the figure. We
        // need colour-distance here so black fabric (far from dark-but-
        // tinted speckle) survives.
        const dr = d[i] - bg[0];
        const dg = d[i + 1] - bg[1];
        const db = d[i + 2] - bg[2];
        const colDist = Math.abs(dr) + Math.abs(dg) + Math.abs(db);
        if (colDist <= 36 && d[i] + d[i + 1] + d[i + 2] <= 120) {
          d[i] = bg[0]; d[i + 1] = bg[1]; d[i + 2] = bg[2];
        }
      }
    }

    // Raw key alpha per pixel.
    const alpha = new Float32Array(n);
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
      alpha[p] = Math.min(1, Math.max(0, (dist - keyLo) / (keyHi - keyLo)));
    }

    // On a dark backdrop only pixels connected to the box edge count, so
    // dark pupils stay opaque. A chroma colour never occurs on the figure,
    // so there enclosed pockets (arm–body gap, between the feet) go too.
    const reached = new Uint8Array(n);
    const stack = [];
    const seed = (p) => { if (!reached[p] && alpha[p] < 1) { reached[p] = 1; stack.push(p); } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      if (x > 0) seed(p - 1);
      if (x < w - 1) seed(p + 1);
      if (p >= w) seed(p - w);
      if (p < n - w) seed(p + w);
    }
    // Larger enclosed pockets of backdrop (arm–body gap) go too; tiny ones
    // (pupils, a few px across) stay.
    const minPocket = Math.max(40, Math.round(n * 0.0015));
    const seen = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (reached[p] || seen[p] || alpha[p] >= 0.5) continue;
      const comp = [p];
      seen[p] = 1;
      for (let k = 0; k < comp.length; k++) {
        const q = comp[k];
        const x = q % w;
        for (const r of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q >= w ? q - w : -1, q < n - w ? q + w : -1]) {
          if (r >= 0 && !seen[r] && !reached[r] && alpha[r] < 0.5) { seen[r] = 1; comp.push(r); }
        }
      }
      if (comp.length >= minPocket) for (const q of comp) reached[q] = 1;
    }
    const chromaKey = greenKey || magentaKey;
    for (let p = 0; p < n; p++) {
      if (!reached[p] && !(chromaKey && alpha[p] < 0.5)) alpha[p] = 1;
      // Hard-snap any backdrop-connected soft pixel to zero. Without this,
      // speckle noise sitting at alpha 0.1–0.5 survives the composite and
      // shows up as faint coloured dots around the figure in the final PNG.
      else if (reached[p] && alpha[p] < 0.6) alpha[p] = 0;
    }

    // Keep only the LARGEST solid foreground island plus any island at
    // least 20 % of its size. GPT sometimes bleeds a chin or hijab tip
    // from the neighbour row into this cell — stray enclosed by backdrop
    // (not touching our edges) survived the flood-fill above and was
    // forced opaque. Those are always much smaller than the real figure.
    {
      const label = new Int32Array(n);
      const sizes = [0]; // index 0 unused
      let bestSize = 0;
      let bestId = 0;
      const q = new Int32Array(n);
      for (let p = 0; p < n; p++) {
        if (label[p] || alpha[p] < 1) continue;
        const id = sizes.length;
        label[p] = id;
        let qh = 0;
        let qt = 0;
        q[qt++] = p;
        let size = 0;
        while (qh < qt) {
          const r = q[qh++];
          size++;
          const rx = r % w;
          if (rx > 0 && !label[r - 1] && alpha[r - 1] >= 1) { label[r - 1] = id; q[qt++] = r - 1; }
          if (rx < w - 1 && !label[r + 1] && alpha[r + 1] >= 1) { label[r + 1] = id; q[qt++] = r + 1; }
          if (r >= w && !label[r - w] && alpha[r - w] >= 1) { label[r - w] = id; q[qt++] = r - w; }
          if (r < n - w && !label[r + w] && alpha[r + w] >= 1) { label[r + w] = id; q[qt++] = r + w; }
        }
        sizes.push(size);
        if (size > bestSize) { bestSize = size; bestId = id; }
      }
      // Keep anything at least 8 % of the main figure. A hijab head or a
      // sleeve may become its own island after keying — those must survive;
      // only clearly-tiny strays (chin peek, speckle) get dropped.
      const minKeep = Math.max(400, Math.round(bestSize * 0.08));
      for (let p = 0; p < n; p++) {
        const id = label[p];
        if (id && id !== bestId && sizes[id] < minKeep) alpha[p] = 0;
      }
    }

    // 2px choke: drop the thin halo of backdrop-tinted edge pixels. One
    // pixel wasn't enough when GPT drew figures with soft chroma AA — the
    // extra pass removes those sub-pixel green rings around hems and
    // hijab edges.
    let choked = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let m = alpha[y * w + x];
        if (m > 0) {
          for (let dy = -1; dy <= 1 && m > 0; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx >= 0 && xx < w) m = Math.min(m, alpha[yy * w + xx]);
            }
          }
        }
        choked[y * w + x] = m;
      }
    }
    // Alpha hardening: push every soft edge to either fully-opaque or
    // fully-transparent with a very narrow (1-px) anti-alias band in
    // between. The old 2-pass choke left a 2–3 px soft gradient at every
    // hem, hijab and sleeve edge that read as "xira" (blurry) on the
    // mobile preview after upscale. A steeper sigmoid gives crisp edges
    // without the ladder-step aliasing of a hard binary alpha.
    for (let p = 0; p < n; p++) {
      const a = choked[p];
      if (a <= 0) continue;
      if (a >= 1) continue;
      // Below 0.35 → gone, above 0.75 → solid, in between → steep ramp
      // mapped back to [0, 1].
      if (a < 0.35) choked[p] = 0;
      else if (a > 0.75) choked[p] = 1;
      else choked[p] = (a - 0.35) / 0.40;
    }

    for (let p = 0; p < n; p++) {
      const i = p * 4;
      const a = choked[p];
      if (a === 0) { d[i + 3] = 0; continue; }
      if (a < 1) {
        // Remove the backdrop's share of the colour on soft edges.
        for (let k = 0; k < 3; k++) {
          d[i + k] = Math.min(255, Math.max(0, (d[i + k] - (1 - a) * bg[k]) / a));
        }
        d[i + 3] = Math.round(a * 255);
      }
      // Despill: green light bounced onto the figure. Safe on every pixel
      // because green is only picked when the hijab isn't green.
      if (greenKey) {
        const cap = Math.max(d[i], d[i + 2]);
        if (d[i + 1] > cap) d[i + 1] = cap;
      } else if (magentaKey && a < 1) {
        const ex = Math.min(d[i], d[i + 2]) - d[i + 1];
        if (ex > 0) { d[i] -= ex; d[i + 2] -= ex; }
      }
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  function drawCover(ctx, img, w, h) {
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / s;
    const sh = h / s;
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h);
  }

  function placeOnScene(figure, scene, scale) {
    const out = document.createElement('canvas');
    out.width = SCENE_W;
    out.height = SCENE_H;
    const ctx = out.getContext('2d');
    drawCover(ctx, scene, SCENE_W, SCENE_H);
    const fw = figure.width * scale;
    const fh = figure.height * scale;
    const cx = SCENE_W / 2;
    const floor = FLOOR_Y * SCENE_H;
    // Soft contact shadow so the figure stands on the carpet, not above it.
    const r = fw * 0.55;
    ctx.save();
    ctx.translate(cx, floor);
    ctx.scale(1, 0.14);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, 'rgba(45,32,20,0.45)');
    g.addColorStop(1, 'rgba(45,32,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(figure, cx - fw / 2, floor - fh, fw, fh);
    return out;
  }

  function canvasToSlice(sizeKey, canvas, mime, quality) {
    const dataUrl = canvas.toDataURL(mime, quality);
    const commaIdx = dataUrl.indexOf(',');
    return { sizeKey, base64: commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl, mime };
  }

  // [start, end] of the heaviest run of non-empty lines. Gaps up to 0.5% of
  // the length are bridged so a thin dark seam inside the figure (e.g.
  // between hem and shoes) doesn't split it. Keeping the gap tight is
  // important: a stray neighbour-cell head sitting ~20px below the main
  // figure's feet must NOT get bridged into the main band or it ends up
  // dangling under the shoes in the final crop.
  function mainBand(prof) {
    const len = prof.length;
    const maxGap = Math.max(2, Math.round(len * 0.005));
    const minLine = 2;
    let best = null;
    let cur = null;
    let gap = 0;
    for (let i = 0; i < len; i++) {
      if (prof[i] >= minLine) {
        if (!cur) cur = { start: i, end: i, mass: 0 };
        cur.end = i;
        cur.mass += prof[i];
        gap = 0;
      } else if (cur && ++gap > maxGap) {
        if (!best || cur.mass > best.mass) best = cur;
        cur = null;
        gap = 0;
      }
    }
    if (cur && (!best || cur.mass > best.mass)) best = cur;
    return best ? [best.start, best.end] : null;
  }

  function loadImage(url) {
    return new Promise((ok, nope) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => ok(el);
      el.onerror = () => nope(new Error('composite image load failed'));
      el.src = url;
    });
  }

  // ─── Image fingerprint (detect the hijab echo by pixels) ───────────
  //
  // 16×16 RGB thumbnail + aspect ratio. Two renders of the same file are
  // near-identical; GPT's 3×3 mannequin grid on a dark background is far
  // off. Throws on a tainted canvas — callers treat that as "unknown".

  const PRINT_N = 16;
  const SAME_IMAGE_DIST = 18; // mean abs RGB diff (0–255)

  function fingerprintImage(img) {
    const c = document.createElement('canvas');
    c.width = PRINT_N;
    c.height = PRINT_N;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, PRINT_N, PRINT_N);
    const data = ctx.getImageData(0, 0, PRINT_N, PRINT_N).data;
    const px = new Uint8Array(PRINT_N * PRINT_N * 3);
    for (let i = 0, j = 0; i < data.length; i += 4) {
      px[j++] = data[i];
      px[j++] = data[i + 1];
      px[j++] = data[i + 2];
    }
    return { px, aspect: img.naturalWidth / img.naturalHeight };
  }

  async function fingerprintBlob(blob) {
    const url = URL.createObjectURL(blob);
    try {
      return fingerprintImage(await loadImage(url));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function fingerprintUrl(url) {
    return fingerprintImage(await loadImage(url));
  }

  function isSameImage(a, b) {
    if (Math.abs(a.aspect - b.aspect) > 0.05) return false;
    let sum = 0;
    for (let i = 0; i < a.px.length; i++) sum += Math.abs(a.px[i] - b.px[i]);
    return sum / a.px.length < SAME_IMAGE_DIST;
  }

  // Crop a canvas down to its opaque bounding box. Keeps a tiny 8px margin
  // so the figure doesn't touch the edges. Returns null if the cell is
  // fully opaque (no trim needed) or fully empty (shouldn't happen).
  function trimTransparent(src) {
    const w = src.width;
    const h = src.height;
    const ctx = src.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    let data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch {
      return null;
    }
    let top = h, bottom = -1, left = w, right = -1;
    const alphaThreshold = 20;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = data[(y * w + x) * 4 + 3];
        if (a > alphaThreshold) {
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    if (bottom < 0 || right < 0) return null; // empty
    const margin = 8;
    const x0 = Math.max(0, left - margin);
    const y0 = Math.max(0, top - margin);
    const x1 = Math.min(w, right + 1 + margin);
    const y1 = Math.min(h, bottom + 1 + margin);
    // If almost nothing was trimmed, skip the extra canvas work.
    if (x0 === 0 && y0 === 0 && x1 === w && y1 === h) return null;
    // Safety net: GPT occasionally returns a PNG where "white dress on
    // transparent background" strips the dress too — leaving just the
    // scarf opaque. The trim would then collapse the cell to a close-up
    // of the hijab and lose the whole mannequin body. If we're about to
    // throw away more than 50% of the cell area, assume GPT confused the
    // alpha channel and keep the full cell instead.
    const trimmedArea = (x1 - x0) * (y1 - y0);
    const cellArea = w * h;
    if (trimmedArea < cellArea * 0.5) {
      // Diagnostic — not an error. Use log so Chrome's Errors tab doesn't
      // flag it. Fires when GPT returned a PNG where "white dress on
      // transparent background" accidentally made the dress transparent
      // too; we skip the aggressive trim and keep the full cell.
      console.log('[extension] trim >50% suppressed, keeping full cell');
      return null;
    }
    const out = document.createElement('canvas');
    out.width = x1 - x0;
    out.height = y1 - y0;
    const octx = out.getContext('2d');
    if (!octx) return null;
    octx.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  // ─── ChatGPT DOM selectors (old + new UI) ──────────────────────────

  const SEND_LABEL = /send|отправ|yubor|jo'nat|إرسال/i;
  const VOICE_LABEL = /voice|dictat|microphone|голос|диктов|микрофон|ovoz|صوت/i;

  function composer() {
    return (
      document.querySelector('#prompt-textarea') ||
      document.querySelector('textarea#mobile-composer-prompt') ||
      document.querySelector('form textarea[placeholder]') ||
      document.querySelector('form div[contenteditable="true"]') ||
      document.querySelector('div.ProseMirror[contenteditable="true"]') ||
      null
    );
  }

  function composerForm() {
    return composer()?.closest('form') ?? null;
  }

  async function waitForComposer(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (composer()) return true;
      await sleep(300);
    }
    return false;
  }

  async function fillPrompt(text) {
    const el = composer();
    if (!el) return false;
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      // Textarea route (new "octane" UI).
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    // ProseMirror / contenteditable
    el.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
    try {
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
    } catch {}
    return true;
  }

  function findFileInputs() {
    const scoped = composerForm()?.querySelector('input[type="file"][accept*="image"], input[type="file"]');
    if (scoped) return [scoped];
    const candidates = Array.from(document.querySelectorAll(
      '#octane-mobile-composer-files-input, form input[type="file"][accept*="image"], input[type="file"]'
    ));
    return candidates.slice(0, 1);
  }

  function attachmentCount() {
    const blobs = document.querySelectorAll('form img[src^="blob:"]');
    if (blobs.length > 0) return blobs.length;
    const thumbs = document.querySelectorAll(
      'form [data-testid*="attachment"], form button[aria-label*="Remove"]',
    );
    return thumbs.length;
  }

  function transferOf(file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    return dt;
  }

  // Multi-strategy attach — ChatGPT's composer accepts drops on the <form>
  // and pastes into the editor, but newer builds don't always react to the
  // bare file-input change. We try all three until the preview appears.
  async function attachFile(file) {
    const composerEl = composer();
    const formEl = composerForm() ?? composerEl?.closest('main') ?? document.body;
    if (!composerEl || !formEl) return false;

    const inputs = findFileInputs();
    const startCount = attachmentCount();

    const strategies = [
      // 1) paste a File into the editor
      () => {
        try {
          composerEl.focus();
          composerEl.dispatchEvent(
            new ClipboardEvent('paste', {
              clipboardData: transferOf(file),
              bubbles: true,
              cancelable: true,
            }),
          );
        } catch (e) {
          console.warn('[N24:31] paste attach failed', e);
        }
      },
      // 2) drag + drop onto the form
      () => {
        try {
          const dt = transferOf(file);
          for (const type of ['dragenter', 'dragover', 'drop']) {
            formEl.dispatchEvent(
              new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }),
            );
          }
        } catch (e) {
          console.warn('[N24:31] drop attach failed', e);
        }
      },
      // 3) file input change
      () => {
        for (const input of inputs) {
          try {
            input.files = transferOf(file).files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (e) {
            console.warn('[N24:31] input attach failed', e);
          }
        }
      },
    ];

    for (let i = 0; i < strategies.length; i++) {
      strategies[i]();
      const ok = await waitForNewAttachment(startCount, 15_000);
      if (ok) {
        console.log('[N24:31] attach OK via strategy', i + 1);
        return true;
      }
    }
    return false;
  }

  async function waitForNewAttachment(startCount, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (attachmentCount() > startCount) return true;
      await sleep(300);
    }
    return false;
  }

  async function waitForAttachment(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (attachmentCount() > 0) return true;
      await sleep(300);
    }
    return false;
  }

  function labelledButton(pattern) {
    const scope = composerForm() ?? document;
    for (const btn of scope.querySelectorAll('button')) {
      const label = `${btn.getAttribute('aria-label') ?? ''} ${btn.title ?? ''}`;
      if (pattern.test(label) && !VOICE_LABEL.test(label)) return btn;
    }
    return null;
  }

  function findSendButton() {
    const direct =
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button#composer-submit-button') ||
      document.querySelector('button[aria-label="Send message"]');
    if (direct) return direct;
    return labelledButton(SEND_LABEL);
  }

  async function clickSend() {
    // Wait for the button to become enabled (ChatGPT disables it while
    // attachments are still uploading).
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const btn = findSendButton();
      if (btn) {
        const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
        if (!disabled) {
          btn.click();
          return true;
        }
      }
      await sleep(300);
    }
    return false;
  }

  // Busy = ChatGPT is actively streaming a response. We look for the stop
  // button (several labels across languages / UI revisions). This is the
  // one signal that reliably means "generation is in flight".
  function isBusy() {
    return !!document.querySelector(
      'button[data-testid="stop-button"], ' +
      'button[aria-label="Stop generating"], ' +
      'button[aria-label*="Stop streaming"], ' +
      'button[aria-label*="Stop" i], ' +
      'button[aria-label*="стоп" i], ' +
      'button[aria-label*="Остановить"], ' +
      'button[aria-label*="To\'xtat" i]',
    );
  }

  // Find the LAST assistant turn element — this is where the generated
  // image lands. ChatGPT's older UI uses `data-message-author-role`;
  // the newer image-carousel UI wraps the whole reply in
  // `article[data-testid^="conversation-turn"]`.
  function lastAssistantTurn() {
    const roleTurns = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (roleTurns.length > 0) return roleTurns[roleTurns.length - 1];
    const articleTurns = document.querySelectorAll('article[data-testid^="conversation-turn"]');
    for (let i = articleTurns.length - 1; i >= 0; i--) {
      const t = articleTurns[i];
      // Skip ones that explicitly belong to the user.
      if (t.querySelector('[data-message-author-role="user"]')) continue;
      return t;
    }
    return null;
  }

  // The whole turn wrapper of the LAST user message. ChatGPT renders the
  // uploaded attachment inside this wrapper but often OUTSIDE the
  // `[data-message-author-role="user"]` div itself, so we exclude the
  // full wrapper, not just the role div.
  function lastUserTurn() {
    const users = document.querySelectorAll('[data-message-author-role="user"]');
    const u = users[users.length - 1];
    if (!u) return null;
    return u.closest('article, [data-testid^="conversation-turn"]') ?? u;
  }

  // True when `img` sits strictly after the user turn in document order
  // (i.e. in GPT's reply), never inside the user turn itself.
  function isAfterUserTurn(img, userTurn) {
    if (!userTurn) return true;
    if (userTurn.contains(img)) return false;
    return !!(userTurn.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  // "Give me the single largest image already visible in the latest
  // assistant turn (or anywhere on the page as fallback)." Used by the
  // SLICE_LAST flow where the seller has already crafted the image they
  // want in ChatGPT and the extension should just grab + slice it.
  function pickLatestChatImage() {
    const turn = lastAssistantTurn();
    const scope = turn || document;
    const cands = candidateImagesIn(scope)
      .filter((img) => img.complete && img.naturalWidth > 0)
      .map((img) => ({ img, area: img.naturalWidth * img.naturalHeight }))
      .sort((a, b) => b.area - a.area);
    if (!cands.length) return null;
    const best = cands[0].img;
    return best.currentSrc || best.src;
  }

  // Return big, non-chrome images from the given scope (default: the whole
  // document). Excludes composer/form/nav/aside/header UI.
  function candidateImagesIn(scope) {
    const root = scope || document;
    const out = [];
    for (const img of root.querySelectorAll('img')) {
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:image/svg')) continue;
      const w = img.naturalWidth || img.width || img.clientWidth || 0;
      const h = img.naturalHeight || img.height || img.clientHeight || 0;
      if (w < 400 || h < 400) continue;
      if (img.closest('#n2431-ticker, form, nav, aside, header')) continue;
      if (img.closest('[data-message-author-role="user"]')) continue;
      out.push(img);
    }
    return out;
  }

  function lastAssistantText() {
    const turn = lastAssistantTurn();
    if (!turn) return '';
    return (turn.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  async function waitForAssistantImage(before, timeoutMs, avoidPrints = null) {
    // Back-compat: allow a single print or an array.
    const avoidList = Array.isArray(avoidPrints)
      ? avoidPrints.filter(Boolean)
      : (avoidPrints ? [avoidPrints] : []);
    const deadline = Date.now() + timeoutMs;

    // Phase 1 — REQUIRE that GPT actually starts streaming. Without this
    // the function would accept the hijab echo that ChatGPT instantly
    // renders in the user bubble before GPT even begins to think.
    const startDeadline = Date.now() + 90_000;
    while (!isBusy() && Date.now() < startDeadline) await sleep(500);
    if (!isBusy()) {
      throw new Error(
        "ChatGPT 90s ichida javob boshlamadi — sahifada 'Stop generating' tugmasi ko'rinmadi",
      );
    }

    // Phase 2 — wait until generation finishes.
    while (isBusy() && Date.now() < deadline) await sleep(1000);
    if (isBusy()) return null;

    // Phase 3 — pick the largest new image that sits AFTER our user turn
    // (GPT's reply) and is not the hijab we sent. Scanning by document
    // order instead of `lastAssistantTurn()` keeps working when the image
    // block lives outside the assistant role div; the pixel check catches
    // the hijab echo even if ChatGPT moves it somewhere unexpected.
    const userTurn = lastUserTurn();
    const echoes = new Set(); // srcs already identified as the hijab
    let sawEcho = false;
    const imageDeadline = Math.min(Date.now() + 45_000, deadline);
    while (Date.now() < imageDeadline) {
      const fresh = candidateImagesIn(document)
        .filter((img) => {
          const src = img.currentSrc || img.src;
          return (
            src && !before.has(src) && !echoes.has(src) &&
            img.complete && img.naturalWidth > 0 &&
            isAfterUserTurn(img, userTurn)
          );
        })
        .map((img) => ({ img, area: img.naturalWidth * img.naturalHeight }))
        .sort((a, b) => b.area - a.area);
      for (const { img } of fresh) {
        const url = img.currentSrc || img.src;
        if (avoidList.length) {
          const print = await fingerprintUrl(url).catch(() => null);
          if (print && avoidList.some((p) => isSameImage(print, p))) {
            console.log('[N24:31] skipping attachment echo', url);
            echoes.add(url);
            sawEcho = true;
            continue;
          }
        }
        console.log('[N24:31] accepting result', {
          url,
          w: img.naturalWidth,
          h: img.naturalHeight,
          candidates: fresh.length,
        });
        return url;
      }
      await sleep(500);
    }

    if (sawEcho) {
      throw new Error("GPT yangi rasm chizmadi — sahifada faqat yuborilgan hijob bor");
    }
    const reply = lastAssistantText();
    if (reply) {
      throw new Error(`AI rasm o'rniga matn qaytardi: «${reply}»`);
    }
    return null;
  }

  // ─── Diagnose (popup debug) ────────────────────────────────────────

  function diagnose() {
    const lines = [];
    const c = composer();
    lines.push(c ? `✓ composer: ${c.tagName}#${c.id || ''}` : '✗ composer topilmadi');
    const files = findFileInputs();
    lines.push(files.length ? `✓ file input: ${files.length} ta` : '✗ file input yo\'q');
    const send = findSendButton();
    lines.push(send ? `✓ send button: ${send.getAttribute('aria-label') || send.id || 'topildi'}` : '✗ send topilmadi');
    return lines;
  }

  // ─── Ticker overlay (visible progress on ChatGPT page) ─────────────

  let tickerEl = null;
  function showTicker(msg) {
    if (!tickerEl) {
      tickerEl = document.createElement('div');
      tickerEl.id = 'n2431-ticker';
      document.documentElement.appendChild(tickerEl);
    }
    tick('Boshlanmoqda…');
  }
  function hideTicker() {
    if (tickerEl) { tickerEl.remove(); tickerEl = null; }
  }
  function tick(text) {
    if (!tickerEl) return;
    tickerEl.textContent = `N24:31 · ${text}`;
    console.log(`[N24:31] ${text}`);
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // Reads an image URL (blob: or https) and returns {base64, mime}. For
  // blob: URLs we go through fetch directly (same-origin, works). For
  // https we also use the DOM <img> as a fallback via canvas when fetch
  // trips a cross-origin restriction.
  async function readImageAsBase64(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const blob = await res.blob();
      if (!blob.size) throw new Error('empty blob');
      const base64 = await blobToBase64(blob);
      return { base64, mime: blob.type || 'image/jpeg' };
    } catch (fetchErr) {
      console.warn('[N24:31] direct fetch failed, trying canvas', fetchErr);
      // Canvas fallback — find an <img> on the page with this src and
      // re-encode via canvas. Works for same-origin images; may fail with
      // a tainted canvas error on cross-origin ones.
      const img = Array.from(document.querySelectorAll('img')).find(
        (el) => (el.currentSrc || el.src) === url,
      );
      if (!img) throw fetchErr;
      await new Promise((r) => {
        if (img.complete && img.naturalWidth) return r();
        img.addEventListener('load', r, { once: true });
        img.addEventListener('error', r, { once: true });
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const idx = dataUrl.indexOf(',');
      return { base64: dataUrl.slice(idx + 1), mime: 'image/jpeg' };
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const result = String(r.result);
        const idx = result.indexOf(',');
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
})();
