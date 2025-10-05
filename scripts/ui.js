// /scripts/ui.js
import { logout } from './auth.js';

/** Mount top nav (keeps existing links) + global dark/light toggle */
export function mountNav(active = '') {
  const el = document.querySelector('#nav');
  if (!el) return;

  el.innerHTML = `
    <div class="nav">
      <div class="bar" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="badge">Clinic PWA</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <a class="btn ghost" href="/dashboard.html">Dashboard</a>
          <a class="btn ghost" href="/bookings.html">Bookings</a>
          <a class="btn ghost" href="/opd.html">OPD</a>
          <a class="btn ghost" href="/pharmacy.html">Pharmacy</a>
          <a class="btn ghost" href="/lab-hub.html">Lab</a>
          <a class="btn ghost" href="/backup.html">Backup</a>
          <button class="btn ghost" id="themeToggle" title="Toggle Dark/Light">🌓</button>
          <button class="btn muted" id="logoutBtn">Logout</button>
        </div>
      </div>
    </div>
  `;

  // Wire logout
  const out = document.getElementById('logoutBtn');
  if (out) out.addEventListener('click', () => logout());

  // Theme init + toggle
  applyStoredTheme();
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const current = localStorage.getItem('theme') || detectTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme(next);
  });
}

/** Register service worker (unchanged) */
export function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/public/service-worker.js');
  }
}

/* ---------------- Theme helpers ---------------- */
function detectTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
function applyStoredTheme() {
  const stored = localStorage.getItem('theme');
  applyTheme(stored || detectTheme());
}
function applyTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  // Fallback body colors (won’t override your own CSS variables if present)
  if (mode === 'dark') {
    document.body.style.background = '#0f172a';
    document.body.style.color = '#f1f5f9';
  } else {
    document.body.style.background = '#f8fafc';
    document.body.style.color = '#0f172a';
  }
}
