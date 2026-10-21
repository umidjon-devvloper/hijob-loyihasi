// N24:31 Dev AI — background service worker.
//
// Owns the full queue loop. Content script is a pure DOM worker that only
// responds to messages (PING, DRESS, DIAGNOSE) — the actual sequencing of
// jobs, retries, cooldowns and tab management lives here.
//
// Why: the earlier design let the content script auto-start a single job
// per page load. That made "process the whole queue" impossible — the
// script couldn't drive a chatgpt.com reload between tasks because the
// reload would kill its own context. Now the worker reloads the tab, waits
// for content.js to re-attach, sends the next task, waits for the result.

const KEEPALIVE = 'n2431-keepalive';
const QUEUE_TICK = 'n2431-queue-tick';

const DEFAULT_API_BASE = 'http://localhost:4000/api/v1';
const CHATGPT_URL = 'https://chatgpt.com/?model=gpt-4o';
const CHATGPT_HOST = 'https://chatgpt.com/*';

const DRESS_TIMEOUT_MS = 300_000; // 5 min per GPT round-trip (full-body renders take longer)
const BASE_GRID_TIMEOUT_MS = 420_000; // 7 min — 3×3 composite is heavier

// Must match DEFAULT_SIZES order in services/api/.../mannequin-templates.service.ts
// and GRID_ORDER in apps/admin-web/.../BaseMannequinsPanel.tsx. Row-major
// reading left→right, top→bottom.
const BASE_GRID_KEYS = [
  'slim-short',   'slim-mid',   'slim-tall',
  'medium-short', 'medium-mid', 'medium-tall',
  'full-short',   'full-mid',   'full-tall',
];

const BASE_GRID_PROMPT = [
  'Ultra-realistic composite photo containing NINE (9) full-body modest-fashion female mannequins',
  'arranged in a 3×3 grid (3 rows × 3 columns), SAME baseline per row, SAME lighting.',
  '',
  'ROWS = body type (top → bottom):',
  '  • Row 1 — SLIM: narrow shoulders and waist, overall thin frame',
  '  • Row 2 — MEDIUM: average healthy proportions',
  '  • Row 3 — FULL: wider hips, fuller waist, plus-size figure',
  '',
  'COLUMNS = height band (left → right, within each row):',
  '  • Col 1 — SHORT (~150-160 cm)',
  '  • Col 2 — MID   (~161-170 cm)',
  '  • Col 3 — TALL  (~171-185 cm)',
  '',
  'FACE REQUIREMENTS (CRITICAL — enables downstream face-swap):',
  '  • Each mannequin has a SIMPLE NEUTRAL FEMALE FACE — soft neutral features, closed mouth, calm neutral expression, eyes open and looking straight at the camera.',
  '  • SAME face across all 9 mannequins (same identity reference, same age ~25, light-tan skin tone, dark hair hidden by hijab area).',
  '  • Face must be clearly visible, well-lit, no sunglasses, no mask, no hair over the eyes.',
  '',
  'OUTFIT:',
  '  • Fully MODEST: plain SOFT BEIGE / CREAM long-sleeve ankle-length dress (abaya-like simple gown in warm beige #e8dcc6 colour, NOT white) — long sleeves to the wrists, closed high neckline, hem reaching the ankles. No bare skin anywhere.',
  '  • Plain BEIGE closed flat shoes on the feet — NO bare feet.',
  '  • The dress colour must be clearly DIFFERENT from the chroma-key GREEN backdrop so clean cut-out keying is possible.',
  '  • NO hijab or head covering on the base mannequin (that is added separately per product).',
  '',
  'LAYOUT:',
  '  • Full head-to-toe visible in every cell (face, body, dress, shoes).',
  '  • Front view, arms slightly away from body, hands relaxed.',
  '  • Equal horizontal gap between columns, equal vertical gap between rows.',
  '  • Each cell has the same canvas size (so a 3×3 grid cut is clean).',
  '  • BACKGROUND IS A FLAT UNIFORM CHROMA-KEY GREEN SCREEN — fill the entire canvas with pure saturated green #00B140 behind the figures and in every gap between the 9 cells. The green must be perfectly flat, no gradient, no shading, no vignette, no shadow on the floor, no reflections. This green is REMOVED after rendering to produce a transparent-background PNG — treat it exactly like a cyclorama/chroma backdrop in a studio.',
  '  • NOTHING on the mannequin, dress, shoes or props may be green (no green accents, no green tint on skin, no green rim light). Green is reserved for keying only.',
  '  • NO ground shadow and NO floor plane — the figures must appear to float on the flat green screen so the cut-out is clean around the feet.',
  '  • NO text, NO labels, NO rulers, NO watermarks drawn into the image.',
  '  • Output ONE opaque PNG (or JPEG), 1:1 or 4:5 aspect ratio. The transparent-background PNG is produced downstream by chroma-keying the green out.',
].join('\n');
const PAUSE_MS = 8_000; // between tasks — don't trip rate limiting
const IDLE_POLL_MS = 60_000; // when queue is empty
const MAX_FAILS = 3;
const COOLDOWN_MS = 10 * 60_000; // bad task shelved 10 min

const AUTO_KEY = 'n2431.auto';
const CURRENT_STATUS_KEY = 'n2431.status';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Config / auth ─────────────────────────────────────────────────────

async function getConfig() {
  const { apiBase, accessToken } = await chrome.storage.local.get(['apiBase', 'accessToken']);
  return { apiBase: apiBase || DEFAULT_API_BASE, accessToken: accessToken || null };
}

async function hasSession() {
  const { accessToken } = await getConfig();
  return !!accessToken;
}

async function readAuto() {
  const stored = await chrome.storage.local.get(AUTO_KEY);
  return stored[AUTO_KEY] === true;
}

async function setAutoFlag(enabled) {
  await chrome.storage.local.set({ [AUTO_KEY]: enabled });
}

// ─── Status (visible in popup) ─────────────────────────────────────────

const EMPTY_STATUS = {
  state: 'idle', // 'idle' | 'running' | 'stopped'
  auto: false,
  taskId: null,
  queued: 0,
  finished: 0,
  failed: 0,
  log: [],
};

let STATUS = { ...EMPTY_STATUS };
let STOP_REQUESTED = false;
let LOOPING = false;
const TROUBLED = new Map(); // jobId -> { fails, until }

async function saveStatus() {
  await chrome.storage.local.set({ [CURRENT_STATUS_KEY]: STATUS });
}

function note(text) {
  const stamp = new Date().toLocaleTimeString('uz-UZ', { hour12: false });
  STATUS.log = [`${stamp} · ${text}`, ...STATUS.log].slice(0, 60);
  console.log(`[N24:31] ${text}`);
  saveStatus();
}

function setStatus(partial) {
  STATUS = { ...STATUS, ...partial };
  saveStatus();
}

// ─── Backend API ───────────────────────────────────────────────────────

async function listPending() {
  const { apiBase, accessToken } = await getConfig();
  if (!accessToken) return [];
  const res = await fetch(`${apiBase}/admin/style-jobs?status=pending`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`listPending HTTP ${res.status}`);
  return res.json();
}

async function uploadResult(id, blob, filename) {
  const { apiBase, accessToken } = await getConfig();
  const form = new FormData();
  form.append('file', blob, filename || 'gpt-result.jpg');
  const res = await fetch(`${apiBase}/admin/style-jobs/${id}/upload-result`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `uploadResult HTTP ${res.status}`);
  }
  return res.json();
}

// Upload 9 variant slices (body-type × height) under their sizeKey field
// names in one request. The API saves each one and stores a sizeKey → URL
// map in `resultVariants`, using medium-mid as the fallback resultUrl.
async function uploadResultVariants(id, slices) {
  const { apiBase, accessToken } = await getConfig();
  const form = new FormData();
  for (const s of slices) {
    const bin = Uint8Array.from(atob(s.base64), (c) => c.charCodeAt(0));
    const mime = s.mime || 'image/png';
    const blob = new Blob([bin], { type: mime });
    form.append(s.sizeKey, blob, `${s.sizeKey}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`);
  }
  const res = await fetch(`${apiBase}/admin/style-jobs/${id}/upload-variants`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `uploadVariants HTTP ${res.status}`);
  }
  return res.json();
}

// Upload a single sliced mannequin cell to its size slot.
async function uploadMannequinTemplate(sizeKey, blob) {
  const { apiBase, accessToken } = await getConfig();
  const form = new FormData();
  form.append('file', blob, `${sizeKey}.png`);
  const res = await fetch(`${apiBase}/admin/mannequin-templates/${sizeKey}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `mannequin upload HTTP ${res.status}`);
  }
  return res.json();
}

async function failJob(id, message) {
  const { apiBase, accessToken } = await getConfig();
  const res = await fetch(`${apiBase}/admin/style-jobs/${id}/ai-fail`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `failJob HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchImageAsBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchImage HTTP ${res.status}`);
  return res.blob();
}

async function blobToBase64(blob) {
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

// ─── Tab management ────────────────────────────────────────────────────

async function ensureTab() {
  // Prefer an already-open ChatGPT tab so we don't open a new one for every
  // queue run.
  const tabs = await chrome.tabs.query({ url: CHATGPT_HOST });
  let tab = tabs.find((t) => typeof t.id === 'number');
  if (!tab) {
    tab = await chrome.tabs.create({ url: CHATGPT_URL, active: true });
    await sleep(6000); // wait for first mount
  }
  if (!(await ping(tab.id))) {
    // Content script wasn't present on this tab (installed after it opened).
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await sleep(1500);
    if (!(await ping(tab.id))) throw new Error('ChatGPT tab unresponsive');
  }
  return tab.id;
}

// Reload the ChatGPT tab between tasks. A fresh chat page = empty composer,
// no stale attachments, no previous generated images confusing the result
// detector.
async function freshChat(tabId) {
  await chrome.tabs.update(tabId, { url: CHATGPT_URL });
  // Wait for navigation + content script re-attach.
  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(1500);
    if (await ping(tabId)) return;
  }
  // Fallback: inject programmatically.
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await sleep(1500);
  if (!(await ping(tabId))) throw new Error('fresh chat page did not respond');
}

async function ping(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return res?.ok === true;
  } catch {
    return false;
  }
}

async function askContent(tabId, request) {
  const res = await chrome.tabs.sendMessage(tabId, request).catch((e) => ({ ok: false, error: String(e) }));
  if (!res) throw new Error('content script did not respond');
  return res;
}

// DRESS uses a long-lived port instead of sendMessage. In Manifest V3 the
// background service worker is suspended after ~30s idle; a pending
// sendMessage reply gets killed with "message channel closed before a
// response was received". A port keeps the SW alive for its entire
// lifetime, so GPT's up-to-3-minute render finishes without the SW dying
// under us.
async function askContentPort(tabId, request, timeoutMs = 240_000) {
  return new Promise((resolve) => {
    let settled = false;
    let port;
    const done = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { port?.disconnect(); } catch { /* already closed */ }
      resolve(res);
    };
    const timer = setTimeout(
      () => done({ ok: false, error: `port timeout after ${timeoutMs / 1000}s` }),
      timeoutMs,
    );
    try {
      port = chrome.tabs.connect(tabId, { name: 'n2431-dress' });
    } catch (e) {
      return done({ ok: false, error: `connect failed: ${String(e?.message ?? e)}` });
    }
    port.onMessage.addListener((msg) => done(msg));
    port.onDisconnect.addListener(() => {
      // Fires with no prior message if the content script died or the tab
      // was closed/reloaded.
      const err = chrome.runtime.lastError?.message || 'port closed without response';
      done({ ok: false, error: err });
    });
    try {
      port.postMessage(request);
    } catch (e) {
      done({ ok: false, error: `postMessage failed: ${String(e?.message ?? e)}` });
    }
  });
}

// ─── Prompt builder ────────────────────────────────────────────────────

// GPT renders the grid on a flat chroma-key backdrop; the content script
// keys it out and drops each figure into the fitting-room scene. A dark
// backdrop would swallow black/navy hijabs, so we use green by default and
// switch to magenta when the hijab itself is greenish.
const CHROMA = {
  green: { hex: '#00B140', name: 'chroma-key GREEN' },
  magenta: { hex: '#FF00FF', name: 'chroma-key MAGENTA' },
};

function chromaFor(colorHex) {
  const m = /^#?([0-9a-f]{6})/i.exec(colorHex || '');
  if (!m) return CHROMA.green;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return g > r + 25 && g > b + 10 ? CHROMA.magenta : CHROMA.green;
}

// Fitting-room backdrop bundled with the extension. Missing file → null,
// and the content script falls back to plain (un-composited) slices.
const SCENE_PATH = 'assets/fitting-room.jpg';

async function loadScene() {
  try {
    const res = await fetch(chrome.runtime.getURL(SCENE_PATH));
    if (!res.ok) return null;
    const blob = await res.blob();
    return { base64: await blobToBase64(blob), mime: blob.type || 'image/jpeg' };
  } catch {
    return null;
  }
}

function buildPrompt(job) {
  const chroma = chromaFor(job.colorHex);
  const style =
    job.tyingStyle === 'loose' ? 'loose, flowing drape style' :
    job.tyingStyle === 'double' ? 'double-layered formal style' :
    'classical neat wrap style';
  // targetSize is the SCARF dimension in cm (e.g. "110x110"), not a body size.
  const scarfLine = job.targetSize
    ? `Scarf size: ${job.targetSize} cm — show the full fabric length draping down in every panel.`
    : 'Scarf size: standard square — show the full fabric length draping down in every panel.';
  return [
    'Ultra-realistic fashion-catalogue composite photo containing NINE (9) full-body modest-fashion young women models, each wearing THE SAME hijab from the attached reference image.',
    '',
    'ARRANGE them in a 3×3 grid (3 rows × 3 columns), SAME baseline per row, SAME lighting, equal gaps between cells, EQUAL cell size so the image can be cut cleanly into 9 pieces.',
    '',
    'ROWS = body type (top → bottom):',
    '  • Row 1 — SLIM: narrow shoulders and waist, overall thin frame',
    '  • Row 2 — MEDIUM: average healthy proportions',
    '  • Row 3 — FULL: wider hips, fuller waist, plus-size figure',
    '',
    'COLUMNS = height band (left → right, within each row):',
    '  • Col 1 — SHORT (~150-160 cm)',
    '  • Col 2 — MID   (~161-170 cm)',
    '  • Col 3 — TALL  (~171-185 cm)',
    '',
    `Tying style: ${style}.`,
    `Primary color accent: ${job.colorHex}.`,
    scarfLine,
    '',
    'Each cell is a HEAD-TO-TOE full-body shot — the ENTIRE model must be visible from the top of the head all the way DOWN TO THE FEET; feet inside the frame; model centered in her cell.',
    '',
    'Model (every cell):',
    '• Realistic young woman fashion model, photoreal skin and natural look — NOT a plastic mannequin. Realistic proportions head to feet.',
    "• Natural, friendly face — soft gentle closed-mouth smile, eyes open and looking at the camera. Head turned at most slightly so BOTH eyes stay fully visible (the face is replaced later).",
    '• SAME face identity across all 9 cells (same woman, ~25 years old, light-tan skin, soft warm light on the face).',
    '• Face is clearly visible around the hijab opening — not hidden, not shadowed, no sunglasses, no mask.',
    '• Realistic proportions, head to feet (head, neck, shoulders, chest, waist, hips, thighs, knees, calves and ankles).',
    '• FULLY MODEST OUTFIT: plain SOFT BEIGE / CREAM long-sleeve ankle-length dress (abaya-like simple gown in warm beige #e8dcc6, NOT white). Long sleeves to the wrists, closed high neckline, hem reaching the ankles. No bare skin anywhere.',
    '• Plain BEIGE closed flat shoes on the feet — no bare feet.',
    `• Nothing on the model, dress, shoes or hijab may be ${chroma.name} — the background colour is reserved for keying.`,
    '',
    'Pose (SAME in every cell) — relaxed boutique fitting-room pose like a fashion catalogue photo, NOT a stiff passport pose:',
    '• Body turned about 20° to the side (three-quarter view), face turned back toward the camera.',
    '• Weight on one leg, the other knee softly relaxed; shoulders soft; elegant, confident posture.',
    '• One hand lightly touching the hijab edge at chest level (fingers visible, NOT covering the face and NOT hiding the hijab pattern); the other arm relaxed along the body.',
    '• Elbows and hands stay close to the body so the whole figure fits inside its own cell and never reaches into a neighbouring cell.',
    '',
    'Hijab (every cell):',
    '• Use the attached HIJAB image as the fabric reference — preserve its colour, pattern and texture EXACTLY in every one of the 9 cells.',
    '• Drape the hijab naturally around the head, shoulders, and chest over the beige dress; same drape in every cell.',
    '• The dress and shoes beneath remain fully visible — no bare skin exposed anywhere.',
    '',
    'Scene:',
    '• Soft warm studio lighting on the figures (like a boutique fitting room). NO ground shadow and NO floor plane — every figure must appear to float on the flat chroma backdrop so the cut-out is clean around the feet.',
    `• BACKGROUND IS A FLAT UNIFORM ${chroma.name} CHROMA-KEY SCREEN — fill the entire canvas with ${chroma.hex} behind the figures and in every gap between the 9 cells. The chroma must be perfectly flat: no gradient, no shading, no vignette, no reflected tint on the figure, no shadow on the floor. This chroma is REMOVED after rendering to produce a transparent-background PNG that will be composed on the real fitting-room backdrop in the app.`,
    `• Nothing on the model, dress, shoes or hijab may be ${chroma.name} — ${chroma.hex} is reserved for keying only (no accents, no tinted highlights, no rim-light of this colour).`,
    '• NO text, NO labels, NO rulers, NO panel borders, NO watermarks drawn into the image.',
    `• Equal empty ${chroma.hex} gaps between the 9 figures so a 3×3 crop lands cleanly without clipping any figure.`,
    '',
    'Output ONE opaque image (JPEG or PNG), square or 4:5 portrait, containing all 9 full-body models arranged in a clean 3×3 grid on the flat chroma backdrop ready for mechanical cutting and chroma-keying.',
  ].join('\n');
}

// ─── Per-task runner ───────────────────────────────────────────────────

function skipped(jobId) {
  const entry = TROUBLED.get(jobId);
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    TROUBLED.delete(jobId);
    return false;
  }
  return entry.fails >= MAX_FAILS;
}

async function runOne(job) {
  setStatus({ state: 'running', taskId: job.id });
  note(`▶ v${chrome.runtime.getManifest().version} · ${job.id.slice(0, 8)} (${job.product?.titleRu ?? '—'} · ${job.targetSize ?? 'one-size'})`);

  try {
    // 1. Fetch hijob bytes (background has host_permissions so no CORS).
    note('⬇ hijob fetching…');
    const hijabBlob = await fetchImageAsBlob(job.hijabUrl);
    const hijabBase64 = await blobToBase64(hijabBlob);

    // 2. Open/reset ChatGPT tab.
    const tabId = await ensureTab();
    note('↺ fresh chat opening…');
    await freshChat(tabId);

    // 3. Hand the DRESS request to the content script via a long-lived
    // port. The port keeps the service worker alive for the whole render.
    // We ask for a 3×3 grid of this hijab on 9 body/height mannequin
    // variants; the content script slices it before replying.
    note('✏ GPT ga 3×3 grid yuborilyapti…');
    const prompt = buildPrompt(job);
    const scene = await loadScene();
    if (!scene) note(`⚠ ${SCENE_PATH} topilmadi — fonsiz bo'laklar yuklanadi`);
    const resp = await askContentPort(tabId, {
      type: 'DRESS',
      prompt,
      hijabBase64,
      hijabMime: hijabBlob.type || 'image/jpeg',
      scene,
      gridKeys: BASE_GRID_KEYS,
      rows: 3,
      cols: 3,
      timeoutMs: DRESS_TIMEOUT_MS,
    }, DRESS_TIMEOUT_MS + 30_000);

    if (!resp?.ok) throw new Error(resp?.error ?? 'content script failed');
    const slices = Array.isArray(resp.slices) ? resp.slices : [];
    if (slices.length !== 9) throw new Error(`expected 9 slices, got ${slices.length}`);

    // 4. Upload all 9 variants in one request. API stores them keyed by
    // sizeKey and sets medium-mid as the fallback resultUrl.
    note('⬆ 9 variantni serverga yuklash…');
    await uploadResultVariants(job.id, slices);
    note(`✓ ${job.id.slice(0, 8)} — 9 variant DONE`);
    TROUBLED.delete(job.id);
    setStatus({ finished: STATUS.finished + 1 });
  } catch (e) {
    const msg = e?.message ?? 'noma\'lum xato';
    note(`✗ ${job.id.slice(0, 8)} — ${msg}`);
    const fails = (TROUBLED.get(job.id)?.fails ?? 0) + 1;
    TROUBLED.set(job.id, { fails, until: Date.now() + COOLDOWN_MS });
    if (fails >= MAX_FAILS) {
      note(`↷ ${job.id.slice(0, 8)} ${MAX_FAILS}x failed — ${COOLDOWN_MS / 60_000} daqiqa chetga`);
      // Also mark server-side failed so the seller sees a real error.
      try { await failJob(job.id, msg); } catch {}
    }
    setStatus({ failed: STATUS.failed + 1 });
    await sleep(PAUSE_MS);
  }
}

// ─── One-off: generate the 9-mannequin base grid ───────────────────────
//
// Admin triggers this from the popup. We open ChatGPT, send the 3×3 grid
// prompt (text only), wait for the composite image, slice into 9 cells in
// the content script, then POST each slice to its mannequin-template slot.
async function runBaseGrid() {
  setStatus({ state: 'running', taskId: 'base-grid' });
  note('▶ base grid (9 maneken)');
  try {
    const tabId = await ensureTab();
    note('↺ fresh chat opening…');
    await freshChat(tabId);

    note('✏ GPT ga grid prompt yuborilyapti…');
    const resp = await askContentPort(
      tabId,
      {
        type: 'BASE_GRID',
        prompt: BASE_GRID_PROMPT,
        gridKeys: BASE_GRID_KEYS,
        rows: 3,
        cols: 3,
        timeoutMs: BASE_GRID_TIMEOUT_MS,
      },
      BASE_GRID_TIMEOUT_MS + 30_000,
    );
    if (!resp?.ok) throw new Error(resp?.error ?? 'content script failed');
    const slices = Array.isArray(resp.slices) ? resp.slices : [];
    if (slices.length !== 9) throw new Error(`expected 9 slices, got ${slices.length}`);

    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      note(`⬆ ${i + 1}/9 — ${s.sizeKey}`);
      const bin = Uint8Array.from(atob(s.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bin], { type: s.mime || 'image/png' });
      await uploadMannequinTemplate(s.sizeKey, blob);
    }
    note('✓ 9 maneken yuklandi');
    setStatus({ finished: STATUS.finished + 1 });
  } catch (e) {
    const msg = e?.message ?? 'noma\'lum xato';
    note(`✗ base-grid — ${msg}`);
    setStatus({ failed: STATUS.failed + 1 });
  } finally {
    setStatus({ state: 'idle', taskId: null });
    await updateBadge();
  }
}

// Pick up the latest image already in the ChatGPT chat (do NOT regenerate)
// and treat it as the base-grid 3×3 — slice to 9 cells and upload to the
// mannequin-template slots. This is the "I already got a great grid in
// ChatGPT, just use that one" shortcut.
async function sliceLastBaseGrid() {
  setStatus({ state: 'running', taskId: 'base-grid-slice' });
  note("▶ oxirgi rasm'dan 9 slice");
  try {
    const tabId = await ensureTab();
    // Do NOT freshChat — we want to use the current conversation's last image.
    const resp = await askContentPort(
      tabId,
      {
        type: 'SLICE_LAST',
        gridKeys: BASE_GRID_KEYS,
        rows: 3,
        cols: 3,
      },
      60_000,
    );
    if (!resp?.ok) throw new Error(resp?.error ?? 'content script failed');
    const slices = Array.isArray(resp.slices) ? resp.slices : [];
    if (slices.length !== 9) throw new Error(`expected 9 slices, got ${slices.length}`);
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      note(`⬆ ${i + 1}/9 — ${s.sizeKey}`);
      const bin = Uint8Array.from(atob(s.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bin], { type: s.mime || 'image/png' });
      await uploadMannequinTemplate(s.sizeKey, blob);
    }
    note('✓ 9 maneken yuklandi (oxirgi rasm)');
    setStatus({ finished: STATUS.finished + 1 });
  } catch (e) {
    const msg = e?.message ?? 'noma\'lum xato';
    note(`✗ slice-last — ${msg}`);
    setStatus({ failed: STATUS.failed + 1 });
  } finally {
    setStatus({ state: 'idle', taskId: null });
    await updateBadge();
  }
}

// ─── Main loop ─────────────────────────────────────────────────────────

async function loop() {
  if (LOOPING) return;
  LOOPING = true;
  chrome.alarms.create(KEEPALIVE, { periodInMinutes: 25 / 60 }); // 25s keepalive

  try {
    while (true) {
      if (STOP_REQUESTED) break;
      if (!(await hasSession())) {
        note('⚠ admin tokeni yo\'q — sozlamalardan kiring');
        break;
      }
      const jobs = await listPending();
      setStatus({ queued: jobs.length });
      const next = jobs.find((j) => !skipped(j.id));
      if (!next) {
        setStatus({ state: 'idle', taskId: null });
        if (!(await readAuto())) break;
        await sleep(IDLE_POLL_MS);
        continue;
      }
      await runOne(next);
      if (!(await readAuto())) break;
      await sleep(PAUSE_MS);
    }
  } catch (e) {
    note(`✗ loop crashed: ${e?.message}`);
  } finally {
    await chrome.alarms.clear(KEEPALIVE);
    LOOPING = false;
    setStatus({ state: STOP_REQUESTED ? 'stopped' : 'idle', taskId: null });
    await updateBadge();
  }
}

async function updateBadge() {
  try {
    if (!(await hasSession())) {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#8A8D5B' });
      return;
    }
    const jobs = await listPending();
    const count = jobs.length;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#C9A96E' });
  } catch {
    // ignore
  }
}

// ─── Lifecycle ─────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await updateBadge();
  // Lightweight periodic tick so the loop auto-resumes after MV3 worker death.
  chrome.alarms.create(QUEUE_TICK, { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(async () => {
  await updateBadge();
  chrome.alarms.create(QUEUE_TICK, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === QUEUE_TICK || alarm.name === KEEPALIVE) {
    if (LOOPING || STATUS.state === 'running') return;
    const auto = await readAuto();
    if (auto) {
      STOP_REQUESTED = false;
      void loop();
    } else {
      await updateBadge();
    }
  }
});

// ─── Message dispatch (from popup) ─────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'getStatus') {
        return sendResponse({ ok: true, status: STATUS });
      }
      if (msg?.type === 'setAuto') {
        await setAutoFlag(msg.enabled);
        setStatus({ auto: msg.enabled });
        if (msg.enabled) {
          STOP_REQUESTED = false;
          note('Avto YOQILDI');
          void loop();
        } else {
          STOP_REQUESTED = true;
          note("Avto O'CHIRILDI — joriy qadam tugagach to'xtaydi");
        }
        return sendResponse({ ok: true });
      }
      if (msg?.type === 'startOne') {
        // One-shot: run exactly one job (first pending) and stop.
        if (LOOPING || STATUS.state === 'running') {
          return sendResponse({ ok: false, error: 'already running' });
        }
        STOP_REQUESTED = false;
        void (async () => {
          try {
            const jobs = await listPending();
            const first = jobs.find((j) => !skipped(j.id));
            if (!first) { note('Pending job yo\'q'); return; }
            setStatus({ queued: jobs.length });
            await runOne(first);
          } catch (e) {
            note(`✗ ${e?.message ?? 'xato'}`);
          } finally {
            setStatus({ state: 'idle', taskId: null });
            await updateBadge();
          }
        })();
        return sendResponse({ ok: true });
      }
      if (msg?.type === 'stop') {
        STOP_REQUESTED = true;
        note("STOP so'raldi");
        return sendResponse({ ok: true });
      }
      if (msg?.type === 'baseGrid') {
        // One-off: generate the 9-mannequin base grid.
        if (LOOPING || STATUS.state === 'running') {
          return sendResponse({ ok: false, error: 'already running' });
        }
        void runBaseGrid();
        return sendResponse({ ok: true });
      }
      if (msg?.type === 'sliceLastBaseGrid') {
        // Grab the LAST image already in the ChatGPT chat (no new GPT
        // generation) and upload its 9 slices to the base-mannequin
        // slots. Lets the seller hand-craft the perfect grid in ChatGPT
        // and then one-click adopt it.
        if (LOOPING || STATUS.state === 'running') {
          return sendResponse({ ok: false, error: 'already running' });
        }
        void sliceLastBaseGrid();
        return sendResponse({ ok: true });
      }
      if (msg?.type === 'refreshBadge') {
        await updateBadge();
        return sendResponse({ ok: true });
      }
    } catch (e) {
      return sendResponse({ ok: false, error: String(e) });
    }
    sendResponse({ ok: false, error: 'unknown message' });
  })();
  return true;
});
