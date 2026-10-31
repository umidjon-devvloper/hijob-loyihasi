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

const DEFAULT_API_BASE = 'https://api.2431.uz/api/v1';

// Any production host must be https — CORS preflight does not follow redirects,
// so a saved http://api.2431.uz value would 301 to https and the browser
// aborts the request. Transparently upgrade stored http:// values here.
function sanitizeApiBase(url) {
  if (!url) return DEFAULT_API_BASE;
  const trimmed = url.trim();
  if (!trimmed) return DEFAULT_API_BASE;
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|.*\.local|.*\.test)(:|\/|$)/i.test(trimmed)) {
    return trimmed;
  }
  if (/^http:\/\//i.test(trimmed)) return trimmed.replace(/^http:\/\//i, 'https://');
  return trimmed;
}
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
  '  • The dress colour must be visibly DIFFERENT from the (transparent/white) background so the whole figure stays visible when the background is removed.',
  '  • NO hijab or head covering on the base mannequin (that is added separately per product).',
  '',
  'LAYOUT:',
  '  • Full head-to-toe visible in every cell (face, body, dress, shoes).',
  '  • Front view, arms slightly away from body, hands relaxed.',
  '  • Equal horizontal gap between columns, equal vertical gap between rows.',
  '  • Each cell has the same canvas size (so a 3×3 grid cut is clean).',
  '  • SOLID MATTE DARK BACKGROUND — fill the entire canvas with a solid flat dark colour #1b1b14 (very dark olive-brown, near-black). FULLY OPAQUE, no transparency, no alpha channel. Same solid colour behind every mannequin, no gradient, no texture, no shadow pattern on the floor.',
  '  • NO text, NO labels, NO rulers, NO watermarks drawn into the image.',
  '  • Output ONE OPAQUE image (JPEG or PNG without alpha), 1:1 or 4:5 aspect ratio. Do NOT use transparency.',
].join('\n');
const PAUSE_MS = 3_000; // between tasks — short so the queue drains fast
const IDLE_POLL_MS = 3_000; // when queue is empty — poll every 3 s so new
                            // style jobs start within seconds of being
                            // enqueued by a seller, not up to a minute later
const MAX_FAILS = 3;
const COOLDOWN_MS = 10 * 60_000; // bad task shelved 10 min

const AUTO_KEY = 'n2431.auto';
const CURRENT_STATUS_KEY = 'n2431.status';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Config / auth ─────────────────────────────────────────────────────

async function getConfig() {
  const { apiBase, accessToken } = await chrome.storage.local.get(['apiBase', 'accessToken']);
  const clean = sanitizeApiBase(apiBase);
  if (clean !== apiBase) {
    try { await chrome.storage.local.set({ apiBase: clean }); } catch {}
  }
  return { apiBase: clean, accessToken: accessToken || null };
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

// Loads the bundled hijab-style reference once per worker lifetime. The image
// locks GPT onto the "head+neck wrap, nothing on chest" silhouette the user
// wants — a job no amount of prose has reliably achieved.
let STYLE_REF_CACHE = null;
async function loadStyleReference() {
  if (STYLE_REF_CACHE) return STYLE_REF_CACHE;
  try {
    const url = chrome.runtime.getURL('assets/hijab-style-reference.png');
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const base64 = await blobToBase64(blob);
    STYLE_REF_CACHE = { base64, mime: blob.type || 'image/png' };
    return STYLE_REF_CACHE;
  } catch {
    return null;
  }
}

async function fetchImageAsBlob(url) {
  // Upgrade http://api.2431.uz etc. to https — same reasoning as sanitizeApiBase.
  const safeUrl = /^http:\/\/(?!localhost|127\.0\.0\.1|\[::1\]|.*\.local|.*\.test)/i.test(url)
    ? url.replace(/^http:\/\//i, 'https://')
    : url;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(safeUrl, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`fetchImage HTTP ${res.status} (${safeUrl})`);
    return await res.blob();
  } catch (e) {
    throw new Error(`fetchImage failed (${safeUrl}): ${e?.message ?? e}`);
  } finally {
    clearTimeout(t);
  }
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

// ─── Shared prompt building blocks ─────────────────────────────────────
//
// Every category produces the same 3x3 grid structure (the content-script
// slicer only works if gutters, cell count and chroma backdrop are fixed),
// so grid + model identity + chroma rules are shared helpers. Each
// category function only varies the garment/accessory description, the
// pose detail and the reference-image line.

const GRID_ROWS_COLS = [
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
];

const FULL_BODY_SHOT = 'Each cell is a HEAD-TO-TOE full-body shot — the ENTIRE model must be visible from the top of the head all the way DOWN TO THE FEET; feet inside the frame; model centered in her cell.';

const ALL_NINE_CELLS = 'ALL 9 CELLS MUST BE FILLED — every cell contains ONE complete head-to-toe model. NO empty / blank cell, NO half-figure, NO cell where two figures overlap. If you cannot fit all 9, re-plan the grid before drawing so all 9 cells each hold a complete model.';

function gridGutters(chroma) {
  const colorWord = chroma.name.toLowerCase().split(' ').pop();
  return [
    'GRID GUTTERS (CRITICAL — the image is auto-sliced into 9 cells):',
    `• Leave a VISIBLE EMPTY ${colorWord} HORIZONTAL BAND between rows 1↔2 and between rows 2↔3. Each band is pure ${chroma.hex}, FULL IMAGE WIDTH, and roughly 2.5% of the TOTAL image height tall. No part of any model crosses into these bands.`,
    `• Leave a VISIBLE EMPTY ${colorWord} VERTICAL BAND between columns 1↔2 and between columns 2↔3. Each band is pure ${chroma.hex}, FULL IMAGE HEIGHT, and roughly 2.5% of the TOTAL image width wide.`,
    '• The 9 cells are the regions BETWEEN those bands. Every model stays entirely inside her own cell with ~8% empty space above her head and ~6% empty space below her shoes; nothing crosses the gutter bands.',
  ];
}

const COMMON_MODEL_IDENTITY = [
  'Model (every cell):',
  '• Realistic young woman fashion model, photoreal skin and natural look — NOT a plastic mannequin. Realistic proportions head to feet.',
  '• Natural, friendly face — soft gentle closed-mouth smile, eyes open and looking at the camera. Head turned at most slightly so BOTH eyes stay fully visible (the face is replaced later).',
  '• SAME face identity across all 9 cells (same woman, ~25 years old, light-tan skin, soft warm light on the face).',
  '• Face is clearly visible — not hidden, not shadowed, no sunglasses, no mask.',
  '• Realistic proportions, head to feet (head, neck, shoulders, chest, waist, hips, thighs, knees, calves and ankles).',
];

function commonBackground(chroma, garmentWord = 'garment') {
  const colorWord = chroma.name.toLowerCase().split(' ').pop();
  const parenNote = chroma.hex === '#00B140' ? '(bright chroma green)' : '(bright chroma magenta)';
  return [
    `Background (CRITICAL — the mobile app draws its OWN boutique scene behind every mannequin, so this image must NOT contain any scene, room, or dark colour that could ever appear on the ${garmentWord}):`,
    `• Behind every model draw a SOLID FLAT ${chroma.name} SCREEN — fill every non-model pixel with ${chroma.hex} ${parenNote}. The same flat colour fills EVERY pixel that is not part of the model herself — no gradient, no texture, no vignette, no scene, no ground.`,
    `• NOTHING on the model or her ${garmentWord} may be ${colorWord} — that colour is reserved for the chroma backdrop and will be made transparent later. A dark or black backdrop would swallow dark fabrics, so this bright chroma is deliberate.`,
    `• Replace the 2.5 % black gutter bars BETWEEN cells (described above) with equally thick ${chroma.hex} bars so the whole non-model area is a single flat chroma colour — the slicer still finds the cut lines by their distance from the figures.`,
    '• Soft, even studio lighting on the figures so they composite cleanly later; no cast shadow on the ground.',
    '• NO text, NO labels, NO rulers, NO watermarks, NO logos.',
  ];
}

function finalOutput(chroma) {
  return [
    `Output ONE OPAQUE image (JPEG or PNG without alpha), square or 4:5 portrait, containing all 9 full-body models on the flat ${chroma.name} chroma backdrop arranged in a clean 3×3 grid ready for mechanical cutting. Do NOT use transparency.`,
    '',
    'QUALITY (CRITICAL — the image will be sliced into 9 cells; each cell must look like a crisp standalone product photo, NOT a thumbnail):',
    '• RENDER AT THE HIGHEST RESOLUTION AVAILABLE — use the LARGEST canvas the model supports (prefer 2048×2048 or larger). Do NOT down-sample; do NOT output a low-res version.',
    '• Ultra-sharp focus throughout. Every garment edge (hem, sleeve, collar, hijab wrap) must be CRISP and clearly defined — no soft blur, no haze, no painterly smear.',
    '• Photorealistic high-resolution fashion catalogue photography — the kind of detail you see in Zara, Modanisa, or Net-a-Porter studio shots: visible fabric weave, clean stitching lines, fine folds, defined shoe silhouette.',
    '• Faces, hands, and feet rendered with correct anatomy and clear skin texture — no plasticky smoothing, no mushy fingers, no fused toes.',
    '• Fabric colour and texture of the product reproduced faithfully pixel-level — no colour shift, no watercolour smudging, no over-saturation.',
    '• Even studio lighting, true-colour white balance, no colour cast on the figure.',
  ].join('\n');
}

// ─── Category-specific prompts ─────────────────────────────────────────

// Hijab / scarves — EXACT original wording, kept byte-for-byte identical
// to the pre-refactor prompt so quality on the main category never drifts.
function buildScarfPrompt(job) {
  const chroma = chromaFor(job.colorHex);
  // Current drape rule — ends TUCKED BEHIND the shoulders, nothing on the
  // chest. The STYLE REFERENCE photo attached first makes the silhouette
  // concrete; this text keeps GPT from reverting to its triangular default.
  const style =
    job.tyingStyle === 'loose' ? 'loose, flowing drape style' :
    job.tyingStyle === 'double' ? 'double-layered formal style' :
    "modest classical hijab styling: smooth wrap over the head covering the forehead and ears, passing closely under the chin and around the neck; both ends tucked BEHIND the shoulders; NO fabric falling onto the chest, shoulders in front, or dress collar";
  // targetSize is the SCARF dimension in cm (e.g. "110x110"), not a body size.
  const scarfLine = job.targetSize
    ? `Scarf size: ${job.targetSize} cm — fabric wraps the head and neck only; its length is tucked behind the shoulders out of view.`
    : 'Scarf size: standard square — fabric wraps the head and neck only; its length is tucked behind the shoulders out of view.';
  return [
    '*** CRITICAL HIJAB RULE (read first, applies to every cell) ***',
    'The hijab fabric covers the HEAD AND NECK ONLY. NO fabric drapes onto the chest, shoulders in front, or the dress collar. Both ends of the scarf are tucked BEHIND the shoulders and are not visible from the front. The dress collar / neckline / chest area is 100% visible. Any cell whose hijab extends below the collarbone is rejected by the downstream filter. See the FIRST attached image (STYLE-REFERENCE) for the exact wrap silhouette.',
    '',
    'TWO reference images are attached (IN THIS ORDER):',
    '  (1) STYLE-REFERENCE-copy-this-wrap.png — a model wearing a navy dress and a cream head/neck wrap. This is the EXACT hijab silhouette to reproduce in every cell. Copy ONLY the wrap shape — ignore the reference\'s colour, dress and face.',
    '  (2) fabric-swatch-color-only.jpg — colour, pattern and texture reference for the hijab fabric. Apply this fabric onto the wrap shape from reference (1). Do NOT reshape it into a shawl or chest drape.',
    '',
    'Ultra-realistic fashion-catalogue composite photo containing NINE (9) full-body modest-fashion young women models, each wearing a hijab that matches reference (1)\'s SHAPE and reference (2)\'s COLOUR/PATTERN.',
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
    'Product colour: TAKE IT FROM THE REFERENCE IMAGE EXACTLY — do not re-tint, do not shift hue, do not substitute.',
    scarfLine,
    '',
    'Each cell is a HEAD-TO-TOE full-body shot — the ENTIRE model must be visible from the top of the head all the way DOWN TO THE FEET; feet inside the frame; model centered in her cell.',
    '',
    'GRID GUTTERS (CRITICAL — the image is auto-sliced into 9 cells):',
    `• Leave a VISIBLE EMPTY ${chroma.name.toLowerCase().split(' ').pop()} HORIZONTAL BAND between rows 1↔2 and between rows 2↔3. Each band is pure ${chroma.hex}, FULL IMAGE WIDTH, and roughly 2.5% of the TOTAL image height tall. No part of any model crosses into these bands.`,
    `• Leave a VISIBLE EMPTY ${chroma.name.toLowerCase().split(' ').pop()} VERTICAL BAND between columns 1↔2 and between columns 2↔3. Each band is pure ${chroma.hex}, FULL IMAGE HEIGHT, and roughly 2.5% of the TOTAL image width wide.`,
    '• The 9 cells are the regions BETWEEN those bands. Every model stays entirely inside her own cell with ~8% empty space above her head and ~6% empty space below her shoes; nothing crosses the gutter bands.',
    '',
    'Model (every cell):',
    '• Realistic young woman fashion model, photoreal skin and natural look — NOT a plastic mannequin. Realistic proportions head to feet.',
    "• Natural, friendly face — soft gentle closed-mouth smile, eyes open and looking at the camera. Head turned at most slightly so BOTH eyes stay fully visible (the face is replaced later).",
    '• SAME face identity across all 9 cells (same woman, ~25 years old, light-tan skin, soft warm light on the face).',
    '• Face is clearly visible around the hijab opening — not hidden, not shadowed, no sunglasses, no mask.',
    '• Realistic proportions, head to feet (head, neck, shoulders, chest, waist, hips, thighs, knees, calves and ankles).',
    '• FULLY MODEST OUTFIT: plain SOFT BEIGE / CREAM long-sleeve ankle-length dress (abaya-like simple gown in warm beige #e8dcc6, NOT white). Long sleeves to the wrists, closed high neckline, hem reaching the ankles. No bare skin anywhere.',
    '• Plain BEIGE closed flat shoes on the feet — no bare feet.',
    '',
    'Pose (SAME in every cell) — relaxed boutique fitting-room pose like a fashion catalogue photo, NOT a stiff passport pose:',
    '• Body turned about 20° to the side (three-quarter view), face turned back toward the camera.',
    '• Weight on one leg, the other knee softly relaxed; shoulders soft; elegant, confident posture.',
    '• Both arms relaxed along the body (NOT touching the hijab, NOT crossed in front of the chest). Hands rest naturally near the hips.',
    '• Elbows and hands stay close to the body so the whole figure fits inside its own cell and never reaches into a neighbouring cell.',
    '',
    'Hijab (MANDATORY — identical in every cell, see STYLE-REFERENCE image attached first):',
    '• Shape: COPY the head-and-neck wrap silhouette from the STYLE-REFERENCE photo EXACTLY. Fabric covers the top of the head, forehead and ears, passes closely under the chin and around the neck. Both ends are tucked BEHIND the shoulders and not visible from the front.',
    '• Fabric colour / pattern / texture: from the FABRIC-SWATCH image (reference 2) — preserve EXACTLY. Apply this fabric onto the wrap shape from reference (1).',
    '• Hard rule: NO fabric drapes onto the chest, onto the front of the shoulders, or onto the dress collar. The dress neckline and the model\'s chest area are 100% visible, uncovered by hijab fabric. The bottom edge of visible hijab sits HIGH on the neck, roughly at the base of the throat.',
    '• The dress and shoes remain fully visible — no bare skin exposed anywhere.',
    '',
    'Background (CRITICAL — the mobile app draws its OWN boutique scene behind every mannequin, so this image must NOT contain any scene, room, or dark colour that could ever appear on a hijab):',
    `• Behind every model draw a SOLID FLAT ${chroma.name} SCREEN — fill every non-model pixel with ${chroma.hex} ${chroma.hex === '#00B140' ? '(bright chroma green)' : '(bright chroma magenta)'}. The same flat colour fills EVERY pixel that is not part of the model herself — no gradient, no texture, no vignette, no scene, no ground.`,
    `• NOTHING on the model, dress, shoes or hijab may be ${chroma.name.toLowerCase().split(' ').pop()} — that colour is reserved for the chroma backdrop and will be made transparent later. A dark or black backdrop would swallow dark hijabs, so this bright chroma is deliberate.`,
    `• Replace the 2.5 % black gutter bars BETWEEN cells (described above) with equally thick ${chroma.hex} bars so the whole non-model area is a single flat chroma colour — the slicer still finds the cut lines by their distance from the figures.`,
    '• Soft, even studio lighting on the figures so they composite cleanly later; no cast shadow on the ground.',
    '• NO text, NO labels, NO rulers, NO watermarks, NO logos.',
    '',
    `Output ONE OPAQUE image (JPEG or PNG without alpha), square or 4:5 portrait, containing all 9 full-body models on the flat ${chroma.name} chroma backdrop arranged in a clean 3×3 grid ready for mechanical cutting. Do NOT use transparency.`,
    '',
    'QUALITY (CRITICAL — the image will be sliced into 9 cells; each cell must look like a crisp standalone product photo, NOT a thumbnail):',
    '• RENDER AT THE HIGHEST RESOLUTION AVAILABLE — use the LARGEST canvas the model supports (prefer 2048×2048 or larger). Do NOT down-sample; do NOT output a low-res version.',
    '• Ultra-sharp focus throughout. Every garment edge (hem, sleeve, collar, hijab wrap) must be CRISP and clearly defined — no soft blur, no haze, no painterly smear.',
    '• Photorealistic high-resolution fashion catalogue photography — the kind of detail you see in Zara, Modanisa, or Net-a-Porter studio shots: visible fabric weave, clean stitching, fine folds, defined shoe silhouette.',
    '• Faces, hands, and feet rendered with correct anatomy and clear skin texture — no plasticky smoothing, no mushy fingers, no fused toes.',
    '• Fabric colour and texture of the product reproduced faithfully pixel-level — no colour shift, no watercolour smudging, no over-saturation.',
    '• Even studio lighting, true-colour white balance, no colour cast on the figure.',
  ].join('\n');
}

function buildDressPrompt(job) {
  const chroma = chromaFor(job.colorHex);
  const sizeLine = job.targetSize
    ? `Dress size: ${job.targetSize} — tailor the fit to this size's silhouette in every cell.`
    : 'Dress size: standard — natural tailored fit in every cell.';
  return [
    'Ultra-realistic fashion-catalogue composite photo containing NINE (9) full-body modest-fashion young women models, each WEARING THE SAME GARMENT from the attached PRODUCT reference image.',
    '',
    'TWO reference images are attached (in this exact order):',
    '  (1) STYLE-REFERENCE-copy-this-wrap.png — a model in a navy dress wearing a cream head-and-neck wrap. This is a POSE / SILHOUETTE REFERENCE for the HIJAB wrap shape only. COPY the head-and-neck wrap shape from this photo EXACTLY in every one of the 9 cells. The hijab in this reference covers the head and wraps closely around the neck; the ends are tucked behind the shoulders; the front of the dress and the collar are fully visible with NO fabric draping onto the chest. REPRODUCE THIS EXACT HIJAB SILHOUETTE. Do NOT copy the reference\'s colours, dress or face — only the wrap shape.',
    '  (2) PRODUCT image — the actual garment to showcase. LOOK CAREFULLY at this image and decide what kind of garment it is before drawing:',
    '      • If it is a DRESS / ABAYA / GOWN / full-length modest garment (one-piece from neckline to ankles): each of the 9 models wears IT as her main outer garment. Preserve its colour, pattern, neckline, sleeves, length and silhouette EXACTLY. No additional outerwear on top.',
    '      • If it is OUTERWEAR (coat, jacket, palto, puffer, shearling, parka, bomber, blazer, vest, kurtka, plash): each of the 9 models wears a plain SOFT BEIGE / CREAM modest long-sleeve ankle-length UNDER-DRESS (#e8dcc6, NOT white) FIRST, then the OUTERWEAR from the reference OVER the under-dress — worn open or lightly closed so both lapels and the under-dress neckline are visible. HARD RULES: (a) the under-dress is ALWAYS a FLOWING ANKLE-LENGTH SKIRT/DRESS, NEVER trousers / pants / leggings / tracksuit bottoms; (b) the under-dress colour and silhouette are IDENTICAL across every cell; (c) the OUTERWEAR is a REAL THREE-DIMENSIONAL JACKET physically pulled onto the body — with its own thickness, sleeves as fabric tubes covering the arms, lapel/zip hardware, cuffs at the wrists, and a VISIBLE HEM EDGE where the jacket ends and the beige under-dress begins. The jacket is NEVER a flat print, sticker, decal or texture painted onto the dress. Preserve the outerwear\'s colour, lining, collar, closures, cuffs, pockets, hem and silhouette EXACTLY. The under-dress is visible at the neckline above the lapel, at the sleeves beyond the jacket cuffs, and from the jacket hem down to the ankles like a long dress skirt.',
    '      • If it is a SKIRT: pair with a plain SOFT BEIGE long-sleeve modest top.',
    '      • If it is a TOP / BLOUSE / tunic: pair with a plain SOFT BEIGE modest long skirt.',
    '      Pick ONE classification by looking at the garment and apply it CONSISTENTLY to all 9 cells.',
    '',
    'STRICT RULES:',
    '  • The final HIJAB silhouette matches reference (1) in shape and the HIJAB colour is a plain soft-beige/cream — the hijab is NOT the hero. Any variant whose hijab drapes below the collarbone is wrong.',
    '  • The PRODUCT (reference 2) is the hero — reproduced on EVERY model exactly as photographed.',
    '  • If reference 2 is outerwear, NEVER draw it as a stand-alone dress — the model is always wearing the beige under-dress beneath it.',
    '',
    'MANDATORY — ALL 9 CELLS MUST BE FILLED. Every one of the 9 grid cells contains ONE complete head-to-toe model. NO empty cell, NO blank cell, NO duplicate pose in two cells, NO half-figure. If you cannot fit all 9, re-plan the grid so all 9 cells each hold a complete model BEFORE drawing.',
    '',
    ...GRID_ROWS_COLS,
    '',
    'Garment colour: TAKE IT FROM THE PRODUCT REFERENCE IMAGE (reference 2) EXACTLY — do not re-tint, do not shift hue, do not substitute. The seller-selected variant swatch is informational only; the pixels in reference 2 are authoritative.',
    sizeLine,
    '',
    FULL_BODY_SHOT,
    '',
    ...gridGutters(chroma),
    '',
    ...COMMON_MODEL_IDENTITY,
    '• HEAD + NECK COVER (MANDATORY — identical in every cell, DO NOT render as a shawl or scarf):',
    '  — Material: plain matte SOFT BEIGE / CREAM fabric (#e8dcc6), no pattern, no sheen.',
    "  — Garment shape: a fitted BALACLAVA-STYLE head cover combined with a short MOCK-TURTLENECK COLLAR. Think of a one-piece sport balaclava, or a nun's wimple, or a snug ninja hood — NOT a shawl, NOT a stole, NOT a scarf hanging on the chest.",
    '  — Head part: smooth, close-fitting cap over the skull, fully covering hair / forehead / ears. No loose fabric around the face oval.',
    '  — Neck part: a short tube of the same fabric around the neck, ending HIGH at the base of the throat (collar height, roughly 2 cm above the collarbone). The bottom edge of the fabric is a clean horizontal line at throat level — like the top edge of a mock-neck sweater.',
    '  — ABSOLUTELY NO fabric descends onto the chest, onto the shoulders in front, or over the dress neckline. Zero drape, zero folds, zero triangular panels. Collarbone and dress collar visible immediately below the fabric edge.',
    '  — Symmetric on both sides.',
    '• Plain BEIGE closed flat shoes on the feet — no bare feet (unless the dress itself has an integrated shoe/leg detail).',
    '',
    'Dress (every cell — the PRODUCT being showcased):',
    '• Use the attached DRESS image as the garment reference — preserve its colour, pattern, fabric texture, neckline, sleeves, length and silhouette EXACTLY in every one of the 9 cells.',
    '• The model wears the dress as the primary visible garment, covering her from the neckline shown in the reference down to the hem shown in the reference.',
    '• If the dress is sleeveless, add a plain beige modest under-layer (long-sleeve top in #e8dcc6) so the arms remain covered — but the dress itself stays on top and fully visible.',
    '• Dress fully visible from neckline (including buttons / collar details) all the way down to the hem; no hands and no hijab fabric covering the front of the dress.',
    '',
    'Pose (SAME in every cell — MANDATORY, identical orientation across the whole 9-grid):',
    "• Body and face BOTH turned slightly to the viewer's RIGHT at a three-quarter angle (~15–20°) so the camera clearly sees the model's RIGHT cheek. NEVER turned to the left, NEVER full-front, NEVER in profile.",
    '• Full-body standing, feet almost together with weight gently on one leg, shoulders soft, elegant upright posture that shows the dress silhouette clearly.',
    '• Both arms relaxed along the body (NOT crossed in front of the dress, NOT holding anything in front of the dress, NOT touching the hijab).',
    '• Elbows and hands stay close to the body so the whole figure fits inside its own cell and the dress is unobstructed.',
    '• Soft closed-mouth smile, eyes to camera.',
    '',
    ...commonBackground(chroma, 'dress'),
    '',
    finalOutput(chroma),
  ].join('\n');
}

function buildBagPrompt(job) {
  const chroma = chromaFor(job.colorHex);
  return [
    'Ultra-realistic fashion-catalogue composite photo containing NINE (9) full-body modest-fashion young women models, each HOLDING / CARRYING THE SAME BAG from the attached reference image.',
    '',
    ...GRID_ROWS_COLS,
    '',
    'Product colour: TAKE IT FROM THE REFERENCE IMAGE EXACTLY — do not re-tint, do not shift hue, do not substitute.',
    '',
    FULL_BODY_SHOT,
    '',
    ...gridGutters(chroma),
    '',
    ...COMMON_MODEL_IDENTITY,
    '• Head covered with a plain neutral SOFT BEIGE / CREAM hijab (#e8dcc6), simple drape — not patterned.',
    '• FULLY MODEST OUTFIT: plain SOFT BEIGE / CREAM long-sleeve ankle-length dress (abaya-like simple gown in warm beige #e8dcc6, NOT white). The outfit is deliberately plain so the BAG is the hero.',
    '• Plain BEIGE closed flat shoes.',
    '',
    'Bag (every cell — the PRODUCT being showcased):',
    '• Use the attached BAG image as the reference — preserve its colour, material, shape, hardware, strap style and proportions EXACTLY in every one of the 9 cells.',
    '• Position the bag so it is CLEARLY visible and unobstructed. For shoulder/crossbody bags: strap on the shoulder, bag resting at hip level on the front-facing side. For handbags/clutches: held in the near hand at waist level in front of the body. For backpacks: both straps on shoulders, bag visible via a slight side turn.',
    '• The bag silhouette stays sharp — no fingers or sleeves cutting across the hardware or logo area.',
    '',
    'Pose (SAME in every cell) — relaxed boutique pose that frames the bag:',
    '• Body turned about 20° to the side (three-quarter view), face turned back toward the camera.',
    '• Weight on one leg, posture elegant.',
    '• One hand gently resting on the bag (strap, handle or body of the bag — depending on bag type) at a natural height; the other arm relaxed along the body.',
    '• Elbows close to the body so the whole figure plus the bag fits inside its cell.',
    '',
    ...commonBackground(chroma, 'bag'),
    '',
    finalOutput(chroma),
  ].join('\n');
}

function buildShoePrompt(job) {
  const chroma = chromaFor(job.colorHex);
  return [
    'Ultra-realistic fashion-catalogue composite photo containing NINE (9) full-body modest-fashion young women models, each WEARING THE SAME PAIR OF SHOES from the attached reference image.',
    '',
    ...GRID_ROWS_COLS,
    '',
    'Product colour: TAKE IT FROM THE REFERENCE IMAGE EXACTLY — do not re-tint, do not shift hue, do not substitute.',
    '',
    FULL_BODY_SHOT,
    '• Camera framing in every cell makes BOTH SHOES clearly visible — do not crop at the ankle; include the ground line.',
    '',
    ...gridGutters(chroma),
    '',
    ...COMMON_MODEL_IDENTITY,
    '• Head covered with a plain neutral SOFT BEIGE / CREAM hijab (#e8dcc6).',
    '• FULLY MODEST OUTFIT: plain SOFT BEIGE / CREAM mid-calf length dress or ankle-length dress with the HEM clearly ABOVE the shoes so the full shoe is visible (abaya-like simple gown in warm beige #e8dcc6, NOT white, hem at mid-calf OR shin so shoes show in full).',
    '',
    'Shoes (every cell — the PRODUCT being showcased):',
    '• Use the attached SHOES image as the reference — preserve the exact colour, material, heel height, shape, strap and sole EXACTLY in every one of the 9 cells.',
    '• Both shoes clearly visible on the model\'s feet; one foot slightly forward in a soft contrapposto so the side profile of the shoe reads clearly.',
    '• Shoes rest on an invisible ground inside the chroma backdrop — no shadow, no reflection.',
    '',
    'Pose (SAME in every cell) — relaxed boutique pose that frames the shoes:',
    '• Body turned about 20° to the side (three-quarter view), face turned back toward the camera.',
    '• Weight on one leg, the other foot slightly forward and turned ~15° outward so the shoe profile is readable.',
    '• Both arms relaxed along the body.',
    '',
    ...commonBackground(chroma, 'shoes'),
    '',
    finalOutput(chroma),
  ].join('\n');
}

// Outerwear = palto, kurtka, plash, jacket, coat. The reference image shows
// the garment flat/empty; the mannequin wears a plain modest BEIGE under-dress
// and a matching HIJAB underneath, with the outerwear worn OPEN or CLOSED
// over the top so the full outer garment silhouette reads clearly.
function buildOuterwearPrompt(job) {
  const chroma = chromaFor(job.colorHex);
  // Hijab stays NEUTRAL regardless of the variant colour the seller picked
  // — the outerwear is the hero and the hijab must not fight it visually.
  // Garment colour comes from the attached reference pixels, not from the
  // swatch; see "Garment colour" line below.
  const hijabHex = '#e8dcc6';
  const hijabWord = 'soft beige / cream';
  return [
    'Ultra-realistic fashion-catalogue composite photo containing NINE (9) full-body modest-fashion young women models, each WEARING THE SAME OUTERWEAR GARMENT (coat / jacket / palto) from the attached reference image OVER a plain modest under-dress.',
    '',
    'The attached reference shows the OUTER garment only (empty / on hanger). Every model in the grid must PHYSICALLY WEAR that exact outer garment as a real three-dimensional jacket pulled onto the body — preserve its colour, material, lining, collar, buttons / zip, cuffs, pocket layout, hem and overall silhouette EXACTLY. Jacket worn OPEN or lightly closed so both lapels / zip and the under-dress neckline are visible, buttoning position consistent across all cells.',
    '',
    '*** CRITICAL — THE JACKET IS A SEPARATE WORN GARMENT, NOT A PRINT ***',
    '• The jacket is a REAL 3D piece of outerwear with its own thickness, silhouette, sleeves, collar, cuffs, hem edge and shadows — NOT a flat graphic printed onto the under-dress.',
    '• There is a CLEAR, VISIBLE boundary / seam between the jacket hem and the beige under-dress underneath. The jacket adds bulk at the shoulders and torso.',
    '• The jacket sleeves are TUBES of fabric covering the model\'s arms, with their own cuffs ending at the wrists — the sleeve shape ADDS to the model\'s arm, it does not sit flat on the body.',
    '• NEVER render the outerwear as a sticker, a print, a texture map, a decal, or a decoration on the dress. If you cannot draw it as a worn 3D jacket, re-draw the cell from scratch.',
    '',
    ...GRID_ROWS_COLS,
    '',
    'Garment colour: TAKE IT FROM THE PRODUCT REFERENCE IMAGE EXACTLY — do not re-tint, do not shift hue, do not substitute. The seller-selected variant swatch is informational only; the pixels in the reference are authoritative.',
    '',
    FULL_BODY_SHOT,
    ALL_NINE_CELLS,
    '',
    ...gridGutters(chroma),
    '',
    ...COMMON_MODEL_IDENTITY,
    `• Head covered with a plain neutral ${hijabWord} hijab (${hijabHex}), simple close head-and-neck wrap — covers hair, forehead, ears; passes under the chin; ends tucked BEHIND the shoulders. NO hijab fabric drapes onto the chest or over the outerwear lapels.`,
    `• UNDER the outerwear: a plain SOFT BEIGE / CREAM long-sleeve ankle-length modest DRESS / abaya-style gown (#e8dcc6, NOT white). HARD RULES — the garment UNDER the jacket is ALWAYS a FLOWING ANKLE-LENGTH SKIRT/DRESS, NEVER trousers, NEVER pants, NEVER leggings, NEVER a tracksuit bottom, NEVER a two-piece set. Fabric: smooth matte beige, same colour across every cell. Visible at the neckline above the lapel, at the sleeves beyond the jacket cuffs (if the jacket is shorter) and from the jacket hem down to the ankles. The hem flares softly like a long dress skirt — definitely NOT narrow trouser legs.`,
    '• Plain BEIGE closed flat shoes on the feet — no bare feet.',
    '',
    'Outerwear (every cell — the PRODUCT being showcased):',
    '• Use the attached reference image as the garment reference — preserve its colour, pattern, fabric texture, collar, closures, sleeves, length and silhouette EXACTLY in every one of the 9 cells.',
    '• The jacket / coat is worn naturally on the shoulders. Sleeves pulled on fully to the wrists. Hem falls at the length shown in the reference. No creases that hide the main features.',
    '• Garment is UNOBSTRUCTED by hands or hijab fabric — the camera reads the full outer silhouette front-and-side.',
    '',
    'Pose (SAME in every cell — MANDATORY, identical orientation across the whole 9-grid):',
    "• Body and face BOTH turned slightly to the viewer's RIGHT at a three-quarter angle (~15–20°) so the camera clearly sees the model's RIGHT cheek. NEVER turned to the left, NEVER full-front, NEVER in profile.",
    '• Full-body standing, feet almost together with weight gently on one leg, shoulders soft, elegant upright posture that shows the outerwear silhouette clearly.',
    '• Both arms relaxed along the body — NOT crossed in front, NOT holding anything, NOT touching the hijab.',
    '• Elbows and hands stay close to the body so the whole figure fits inside its own cell and the garment is unobstructed.',
    '• Soft closed-mouth smile, eyes to camera.',
    '',
    ...commonBackground(chroma, 'outerwear'),
    '',
    finalOutput(chroma),
  ].join('\n');
}

function buildAccessoryPrompt(job) {
  const chroma = chromaFor(job.colorHex);
  return [
    'Ultra-realistic fashion-catalogue composite photo containing NINE (9) full-body modest-fashion young women models, each WEARING / DISPLAYING THE SAME ACCESSORY from the attached reference image.',
    '',
    ...GRID_ROWS_COLS,
    '',
    'Product colour: TAKE IT FROM THE REFERENCE IMAGE EXACTLY — do not re-tint, do not shift hue, do not substitute.',
    '',
    FULL_BODY_SHOT,
    '',
    ...gridGutters(chroma),
    '',
    ...COMMON_MODEL_IDENTITY,
    '• Head covered with a plain neutral SOFT BEIGE / CREAM hijab (#e8dcc6).',
    '• FULLY MODEST OUTFIT: plain SOFT BEIGE / CREAM long-sleeve ankle-length dress (#e8dcc6, NOT white). The outfit is deliberately plain so the ACCESSORY is the hero.',
    '• Plain BEIGE closed flat shoes.',
    '',
    'Accessory (every cell — the PRODUCT being showcased):',
    '• Use the attached ACCESSORY image as the reference — preserve its colour, material, texture, shape and proportions EXACTLY in every one of the 9 cells.',
    '• Place the accessory where it would naturally be worn, chosen by what it is:',
    '    – Brooch / pin → pinned on the hijab at shoulder level, visible.',
    '    – Belt / sash → around the waist over the dress, buckle centered.',
    '    – Earrings → visible beside the face through a soft hair-tuck or hijab opening (very subtle, the accessory is small).',
    '    – Necklace → draped over the dress neckline, fully visible.',
    '    – Watch / bracelet → on the near wrist, that hand slightly lifted at waist height so the piece reads.',
    '    – Scarf-pin or clip → clipped on the front drape of the hijab.',
    '• If the accessory type is ambiguous from the reference image, pick the single most natural placement from the list above and keep it consistent across all 9 cells.',
    '',
    'Pose (SAME in every cell) — relaxed boutique pose that frames the accessory:',
    '• Body turned about 20° to the side (three-quarter view), face toward camera.',
    '• Pose adjusted so the accessory location is unobstructed (e.g. hands away from a brooch, near wrist slightly lifted for a bracelet).',
    '• Elbows close to the body so the whole figure fits inside its cell.',
    '',
    ...commonBackground(chroma, 'accessory'),
    '',
    finalOutput(chroma),
  ].join('\n');
}

// Dispatcher — picks the right category prompt from product.categoryId.
// Falls back to scarves (the historical default) when the field is missing
// so old queued jobs keep rendering with the same prompt they would have.
//
// Outerwear detection: the backend has no "outerwear" category today, so
// coats/jackets land in "dresses" and the dress prompt tries to put the
// model into the jacket as if it were a gown. Sniff title keywords (uz/ru/en)
// and route those jobs to the outerwear prompt instead.
const OUTERWEAR_RE = /\b(palto|kurtka|plash|parka|bomber|jacket|coat|puffer|shuba|dublyonka|дублёнк|дубленк|пуховик|куртк|пальто|плащ|пардес|жилет|жилетка|vest)\b/i;

function looksLikeOuterwear(job) {
  const t = [job.product?.titleRu, job.product?.titleUz, job.product?.title]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return OUTERWEAR_RE.test(t);
}

function buildPrompt(job) {
  const category = job.product?.categoryId;
  if ((category === 'dresses' || category === 'accessories') && looksLikeOuterwear(job)) {
    return buildOuterwearPrompt(job);
  }
  switch (category) {
    case 'dresses':     return buildDressPrompt(job);
    case 'bags':        return buildBagPrompt(job);
    case 'shoes':       return buildShoePrompt(job);
    case 'accessories': return buildAccessoryPrompt(job);
    case 'scarves':
    default:            return buildScarfPrompt(job);
  }
}

// ─── Per-body-type prompt narrowing ────────────────────────────────────
//
// The shared category builders ask GPT for one 3×3 image. That caps each
// mannequin at ~340 px native (1024/3), which looks soft on a mobile detail
// page. To get real quality we fan the job out into THREE 1×3 renders —
// one per body type — each at ChatGPT's full landscape (~1024 wide ÷ 3 =
// ~512 px per cell, ≈ 2× the detail). This helper takes the full 3×3
// prompt and rewrites it in-place to describe just one row.
const BODY_TYPE_DESC = {
  slim: 'SLIM — narrow shoulders and waist, overall thin frame',
  medium: 'MEDIUM — average healthy proportions',
  full: 'FULL — wider hips, fuller waist, plus-size figure',
};

function narrowToBodyType(fullPrompt, bodyType) {
  const desc = BODY_TYPE_DESC[bodyType];
  if (!desc) return fullPrompt;
  return fullPrompt
    .replace(/NINE \(9\)/g, 'THREE (3)')
    .replace(/all 9 full-body models/g, 'all 3 full-body models')
    .replace(/all nine/gi, 'all three')
    .replace(/9 full-body/g, '3 full-body')
    .replace(/9 cells/g, '3 cells')
    .replace(/9 pieces/g, '3 pieces')
    .replace(/9 variants/g, '3 variants')
    .replace(/3×3 grid \(3 rows × 3 columns\)/g, '1×3 landscape strip (1 row × 3 columns)')
    .replace(/clean 3×3 grid/g, 'clean 1×3 landscape strip')
    .replace(
      /ROWS = body type \(top → bottom\):[\s\S]*?Row 3 — FULL[^\n]*/,
      `BODY TYPE for this strip (SAME for all 3 cells): ${desc}`,
    )
    .replace(/• Leave a VISIBLE EMPTY [a-z]+ HORIZONTAL BAND[^\n]*\n?/g, '')
    .replace(/between rows 1↔2 and between rows 2↔3/g, '')
    .replace(/ALL 9 CELLS MUST BE FILLED/g, 'ALL 3 CELLS MUST BE FILLED');
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
    note(`⬇ hijob fetching… ${String(job.hijabUrl ?? '').slice(0, 60)}`);
    const hijabBlob = await fetchImageAsBlob(job.hijabUrl);
    note(`✓ hijob fetched (${Math.round((hijabBlob.size || 0) / 1024)} KB)`);
    const hijabBase64 = await blobToBase64(hijabBlob);
    note('✓ hijob encoded');

    // 2. Open/reset ChatGPT tab.
    note('↻ ensureTab…');
    const tabId = await ensureTab();
    note(`✓ tab #${tabId}`);
    note('↺ fresh chat opening…');
    await freshChat(tabId);
    note('✓ fresh chat ready');

    // 3. Hand the DRESS request to the content script via a long-lived
    // port. The port keeps the service worker alive for the whole render.
    // We fan the job out into THREE 1×3 strips (one per body type) so
    // each cell gets GPT's full landscape width — ~512 px native vs the
    // ~340 px a 3×3 would give. Each strip comes back as 3 slices; we
    // concatenate them in body-type order and upload the 9 together.
    const basePrompt = buildPrompt(job);
    const styleRef = await loadStyleReference();
    note(styleRef
      ? `✓ style reference loaded (${Math.round((styleRef.base64.length * 3) / 4 / 1024)} KB)`
      : '⚠ style reference MISSING — attach failed');
    const BODY_TYPES = ['slim', 'medium', 'full'];
    const slices = [];
    for (const bodyType of BODY_TYPES) {
      note(`✏ GPT ga ${bodyType} 1×3 strip yuborilyapti…`);
      if (bodyType !== BODY_TYPES[0]) {
        // Start each follow-up body-type render in a brand-new chat so the
        // composer, context and attachments reset cleanly.
        note('↺ fresh chat for next body type…');
        await freshChat(tabId);
      }
      const prompt = narrowToBodyType(basePrompt, bodyType);
      const gridKeys = [`${bodyType}-short`, `${bodyType}-mid`, `${bodyType}-tall`];
      const resp = await askContentPort(tabId, {
        type: 'DRESS',
        prompt,
        hijabBase64,
        hijabMime: hijabBlob.type || 'image/jpeg',
        styleRefBase64: styleRef?.base64 ?? null,
        styleRefMime: styleRef?.mime ?? null,
        scene: null,
        gridKeys,
        rows: 1,
        cols: 3,
        timeoutMs: DRESS_TIMEOUT_MS,
      }, DRESS_TIMEOUT_MS + 30_000);
      if (!resp?.ok) throw new Error(`${bodyType}: ${resp?.error ?? 'content script failed'}`);
      const strip = Array.isArray(resp.slices) ? resp.slices : [];
      if (strip.length !== 3) throw new Error(`${bodyType}: expected 3 slices, got ${strip.length}`);
      slices.push(...strip);
      note(`✓ ${bodyType} 3 variant tayyor (jami ${slices.length}/9)`);
    }
    if (slices.length !== 9) throw new Error(`expected 9 slices total, got ${slices.length}`);

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
