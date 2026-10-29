/**
 * Options page — sign the extension into the admin backend. Mirrors the
 * admin-web login flow but stores the JWT in chrome.storage.local so the
 * service worker can attach it to subsequent /admin/* requests.
 */

const DEFAULT_API_BASE = 'https://api.2431.uz/api/v1';

// Preflight requests cannot follow redirects, so a saved http://api.2431.uz
// value would 301 to https and the browser aborts. Upgrade non-local http://
// origins to https:// transparently.
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

const apiBaseInput = document.getElementById('api-base');
const identifierInput = document.getElementById('identifier');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login');
const logoutBtn = document.getElementById('logout');
const statusEl = document.getElementById('status');
const logoutStatusEl = document.getElementById('logout-status');
const loggedInEl = document.getElementById('logged-in');
const loggedOutEl = document.getElementById('logged-out');
const whoEl = document.getElementById('who');

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = `status ${kind}`;
}

async function load() {
  const { apiBase, accessToken, user } = await chrome.storage.local.get(['apiBase', 'accessToken', 'user']);
  const clean = sanitizeApiBase(apiBase);
  if (clean !== apiBase) {
    try { await chrome.storage.local.set({ apiBase: clean }); } catch {}
  }
  apiBaseInput.value = clean;
  if (accessToken && user) {
    loggedInEl.style.display = '';
    loggedOutEl.style.display = 'none';
    whoEl.textContent = user.fullName || `@${user.username}`;
  } else {
    loggedInEl.style.display = 'none';
    loggedOutEl.style.display = '';
  }
}

apiBaseInput.addEventListener('change', async () => {
  const clean = sanitizeApiBase(apiBaseInput.value);
  apiBaseInput.value = clean;
  await chrome.storage.local.set({ apiBase: clean });
});

loginBtn.addEventListener('click', async () => {
  const apiBase = sanitizeApiBase(apiBaseInput.value);
  apiBaseInput.value = apiBase;
  const identifier = identifierInput.value.trim();
  const password = passwordInput.value;
  if (!identifier || !password) {
    setStatus(statusEl, 'Login va parolni kiriting', 'err');
    return;
  }
  loginBtn.disabled = true;
  setStatus(statusEl, 'Kirilyapti…', '');
  try {
    const res = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.user?.role !== 'admin' && data.user?.role !== 'moderator') {
      throw new Error(`Role ${data.user?.role} admin huquqlariga ega emas`);
    }
    await chrome.storage.local.set({
      apiBase,
      accessToken: data.tokens.accessToken,
      refreshToken: data.tokens.refreshToken,
      user: data.user,
    });
    setStatus(statusEl, 'Kirildi ✓', 'ok');
    passwordInput.value = '';
    await load();
    // Nudge the service worker to refresh the badge right away.
    chrome.runtime.sendMessage({ type: 'refresh' }).catch(() => {});
  } catch (e) {
    setStatus(statusEl, e?.message ?? 'xato', 'err');
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove(['accessToken', 'refreshToken', 'user', 'lastKnownCount']);
  setStatus(logoutStatusEl, 'Chiqildi', 'ok');
  chrome.action.setBadgeText({ text: '' });
  await load();
});

load();
