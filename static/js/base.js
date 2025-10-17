// /static/js/base.js
"use strict";

/* ─────────────────────────────────────────────────────────────
 * 0) Safe init for AOS (if present)
 * ───────────────────────────────────────────────────────────── */
try {
  if (window.AOS && typeof window.AOS.init === "function") {
    window.AOS.init();
  }
} catch { /* ignore */ }


// Sticky header: add shadow when scrolled
(function(){
  const header = document.querySelector('.site-header');
  if (!header) return;
  const onScroll = () => {
    if (window.scrollY > 8) header.classList.add('is-stuck');
    else header.classList.remove('is-stuck');
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();


/* ─────────────────────────────────────────────────────────────
 * 0.05) Tiny global helpers needed by inline HTML on any page
 * ───────────────────────────────────────────────────────────── */
window.autoResize = window.autoResize || function (ta) {
  if (!ta) return;
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + "px";
};

/* ─────────────────────────────────────────────────────────────
 * 0.1) Ensure a persistent device identifier for abuse guard
 *      - Matches backend: abuse_guard._device_id() looks for "jobcus_device"
 * ───────────────────────────────────────────────────────────── */
(function ensureDeviceCookie(){
  const NAME = "jobcus_device";
  const ttlDays = 730; // ~2 years
  function hasCookie(n){ return document.cookie.split("; ").some(c => c.startsWith(n + "=")); }
  function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax; Secure`;
  }
  function v4(){
    // crypto-safe UUID v4
    if (crypto && crypto.getRandomValues) {
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      a[6] = (a[6] & 0x0f) | 0x40;
      a[8] = (a[8] & 0x3f) | 0x80;
      const b = [...a].map((x,i)=> (i===4||i===6||i===8||i===10 ? "-" : "") + x.toString(16).padStart(2,"0")).join("");
      // Convert to canonical 8-4-4-4-12:
      return (
        b.slice(0,8) + "-" +
        b.slice(9,13) + "-" +
        b.slice(14,18) + "-" +
        b.slice(19,23) + "-" +
        (b.slice(24,36).replace(/-/g,""))
      );
    }
    // Fallback
    return "xxxxxxxxyxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  if (!hasCookie(NAME)) {
    const id = v4();
    setCookie(NAME, id, ttlDays);
    window.DEVICE_ID = id; // optional: surface for debugging
  } else {
    try {
      const val = document.cookie.split("; ").find(r => r.startsWith(NAME + "="))?.split("=")[1] || "";
      window.DEVICE_ID = decodeURIComponent(val);
    } catch {}
  }
})();

/* ─────────────────────────────────────────────────────────────
 * 0.2) Global fetch wrapper to always send cookies
 * ───────────────────────────────────────────────────────────── */

(function () {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || 'include'; // send cookies

    const token = (typeof getCSRFToken === 'function') ? getCSRFToken() : null;
    if (token) {
      init.headers = Object.assign(
        { 'X-CSRF-Token': token },   // or 'X-CSRFToken' / 'X-XSRF-TOKEN' based on your server
        init.headers || {}
      );
    }

    return originalFetch(input, init);
  };
})();

/* ─────────────────────────────────────────────────────────────
 * 0.3) Centralized API fetch (401 handling + JSON/HTML guard)
 *      + CSRF header injection
 *      Use: const data = await apiFetch('/api/foo', { method:'POST', body: ... })
 * ───────────────────────────────────────────────────────────── */

// CSRF cookie reader (Flask-WTF default cookie names vary; adjust if needed)
function getCookie(name) {
  const prefix = name + "=";
  const parts = (document.cookie || "").split(";");
  for (let p of parts) {
    p = p.trim();
    if (p.startsWith(prefix)) {
      return decodeURIComponent(p.slice(prefix.length));
    }
  }
  return null;
}

// Add this just below getCookie(...)
function getCSRFToken() {
  // Try a <meta name="csrf-token" content="..."> if you set one
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta && meta.content) return meta.content;

  // Try common cookie names (Flask-WTF / many setups)
  return getCookie('csrf_token') || getCookie('XSRF-TOKEN') || null;
}

window.apiFetch = async function apiFetch(url, options = {}) {
  const merged = {
    headers: { 'Accept': 'application/json', ...(options.headers || {}) },
    ...options
  };
 
  // Inject CSRF header if a token is present
  const csrf = getCookie('csrf_token') || getCookie('XSRF-TOKEN');
  if (csrf) merged.headers['X-CSRFToken'] = csrf;

  const resp = await fetch(url, merged);
  const contentType = resp.headers.get('content-type') || '';

  if (!resp.ok) {
    if (resp.status === 401) {
      window.location = '/account?next=' + encodeURIComponent(location.pathname);
      throw new Error('Unauthorized');
    }
    const text = await resp.text();
    throw new Error(`Request failed ${resp.status}: ${text.slice(0, 200)}`);
  }

  return contentType.includes('application/json') ? resp.json() : resp.text();
};

/* ─────────────────────────────────────────────────────────────
 * 0.35) Plan & role bootstrap for the UI (sets data attributes)
 *       Lets page scripts/CSS key off plan/role without reloading
 * ───────────────────────────────────────────────────────────── */
(function () {
  // If the server already rendered data attributes in <body>, this is harmless.
  // It also refreshes values on client-side nav or cached pages.
  fetch("/api/me", { credentials: "same-origin" })
    .then((r) => r.ok ? r.json() : null)
    .then((u) => {
      if (!u) return;
      document.body.dataset.plan = (u.plan || "free");
      document.body.dataset.superadmin = (u.role === "superadmin" ? "1" : "0");
    })
    .catch(() => {});
})();

/* ─────────────────────────────────────────────────────────────
 * 1) Centered Upgrade Modal (replaces old sticky banner)
 *    Exposes: window.showUpgradeBanner(html), window.hideUpgradeBanner()
 * ───────────────────────────────────────────────────────────── */
(function () {
  function ensureModal() {
    let layer = document.getElementById("upgrade-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "upgrade-layer";
      layer.innerHTML = `
        <div class="upgrade-backdrop" data-upgrade-dismiss></div>
        <div id="upgrade-banner" class="upgrade-modal" role="dialog" aria-modal="true" aria-label="Upgrade required">
          <button class="upgrade-close" type="button" aria-label="Close" data-upgrade-dismiss>×</button>
          <div class="upgrade-body"></div>
        </div>
      `;
      document.body.appendChild(layer);

      // Close handlers
      layer.addEventListener("click", (e) => {
        if (e.target.matches("[data-upgrade-dismiss]")) window.hideUpgradeBanner();
      });
      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") window.hideUpgradeBanner();
      });
    }
    return layer;
  }

  window.showUpgradeBanner = function (html) {
    const layer = ensureModal();
    const modal = layer.querySelector("#upgrade-banner");
    const body  = layer.querySelector(".upgrade-body");

    // reset any legacy inline positioning
    modal.style.cssText = "";

    body.innerHTML = html || "Upgrade required.";
    layer.style.display = "block";
    document.body.classList.add("has-upgrade-banner");

    // focus close for a11y
    setTimeout(() => modal.querySelector(".upgrade-close")?.focus(), 0);
  };

  window.hideUpgradeBanner = function () {
    const layer = document.getElementById("upgrade-layer");
    if (layer) layer.style.display = "none";
    document.body.classList.remove("has-upgrade-banner");
  };
})();

/* ─────────────────────────────────────────────────────────────
 * 1.1) Upgrade redirect helpers (append ?next= to URLs)
 * ───────────────────────────────────────────────────────────── */
(function () {
  function withNext(url) {
    try {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      // if URL already has a next=, leave it
      if (/[?&]next=/.test(url)) return url;
      const sep = url.includes("?") ? "&" : "?";
      return url + sep + "next=" + next;
    } catch {
      return url;
    }
  }

  // expose if you want to deep-link to a specific plan from anywhere
  window.goToUpgrade = function goToUpgrade(plan /* "standard" | "premium" | "weekly" */) {
    const p = plan || "premium";
    window.location.href = withNext(`/subscribe?plan=${encodeURIComponent(p)}`);
  };

  // -- show banner, then auto-redirect to pricing/subscribe with ?next=
  const DEFAULT_PRICING_URL = window.PRICING_URL || "/pricing";
  let timer = null;

  window.upgradePrompt = function upgradePrompt(
    html,
    url = DEFAULT_PRICING_URL,
    delayMs = 1200 // adjust if you want longer/shorter view time
  ) {
    window.showUpgradeBanner?.(
      html || `You’ve reached your plan limit. <a href="${withNext(url)}">Upgrade now →</a>`
    );
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { window.location.href = withNext(url); }, delayMs);
  };
})();

// 1.1b) One-liner you can call from anywhere to push users to pricing carrying ?next=
(function () {
  window.forceUpgrade = function forceUpgrade(plan = "premium") {
    const next = encodeURIComponent(location.pathname + location.search);
    window.location.href = `/pricing?plan=${encodeURIComponent(plan)}&next=${next}`;
  };
})();

/* ─────────────────────────────────────────────────────────────
 * 2) User menu (avatar) & general UI toggles
 *     + Chat sidebar open/close (a11y-safe: focus + inert)
 * ───────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  // User menu
  const userBtn = document.getElementById("userMenuBtn");
  const userDrop = document.getElementById("userDropdown");

  function toggleUserMenu(forceOpen) {
    if (!userBtn || !userDrop) return;
    const open = (typeof forceOpen === "boolean")
      ? forceOpen
      : !userDrop.classList.contains("show");
    userDrop.classList.toggle("show", open);
    userBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  userBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleUserMenu();
  });

  // Features submenu
  document.querySelectorAll(".dropbtn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = btn.nextElementSibling;
      menu?.classList.toggle("show");
    });
  });

  // Close menus on outside click
  document.addEventListener("click", (e) => {
    // a) Mobile menu
    const mobileMenu = document.getElementById("mobileMenu");
    const hamburger = document.querySelector(".hamburger");
    if (
      mobileMenu?.classList.contains("show") &&
      !mobileMenu.contains(e.target) &&
      !hamburger?.contains(e.target)
    ) {
      mobileMenu.classList.remove("show");
    }

    // b) Feature dropdowns
    document.querySelectorAll(".dropdown-content").forEach((drop) => {
      const btn = drop.previousElementSibling;
      if (
        drop.classList.contains("show") &&
        !drop.contains(e.target) &&
        !btn?.contains(e.target)
      ) {
        drop.classList.remove("show");
      }
    });

    // c) User dropdown
    if (
      userDrop?.classList.contains("show") &&
      !userDrop.contains(e.target) &&
      !userBtn?.contains(e.target)
    ) {
      toggleUserMenu(false);
    }
  });

  // Close menus on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.getElementById("mobileMenu")?.classList.remove("show");
      document.querySelectorAll(".dropdown-content.show")
        .forEach((el) => el.classList.remove("show"));
      toggleUserMenu(false);
      // Also close chat sidebar on Escape
      window.closeChatMenu?.();
    }
  });

  // Expose mobile menu toggle for header button
  window.toggleMobileMenu = function toggleMobileMenu() {
    document.getElementById("mobileMenu")?.classList.toggle("show");
  };


  // ── Chat sidebar (A11Y-friendly open/close) ─────────────────
  const chatMenuToggle = document.getElementById("chatMenuToggle");
  const chatMenu       = document.getElementById("chatSidebar");
  const chatOverlay    = document.getElementById("chatOverlay");
  const chatCloseBtn   = document.getElementById("chatSidebarClose");

  function openChatMenu(){
    if (!chatMenu) return;
    // Remove inert first so it can receive focus
    chatMenu.removeAttribute('inert');
    chatMenu.classList.add("is-open");
    chatMenu.setAttribute("aria-hidden","false");
    if (chatOverlay) chatOverlay.hidden = false;
    document.documentElement.style.overflow = "hidden";

    // Move focus *into* the sidebar
    (chatCloseBtn ||
     chatMenu.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    )?.focus();
  }

  function closeChatMenu(){
    if (!chatMenu) return;

    // 1) Move focus OUT of the subtree before hiding it
    chatMenuToggle?.focus();

    // 2) Now hide + make unfocusable
    chatMenu.classList.remove("is-open");
    chatMenu.setAttribute("aria-hidden","true");
    chatMenu.setAttribute('inert',''); // prevents focus and interaction
    if (chatOverlay) chatOverlay.hidden = true;
    document.documentElement.style.overflow = "";
  }

  // binders
  chatMenuToggle?.addEventListener("click", openChatMenu);
  chatOverlay?.addEventListener("click", closeChatMenu);
  chatCloseBtn?.addEventListener("click", closeChatMenu);

  // expose globally if other scripts (chat.js) need them
  window.openChatMenu = openChatMenu;
  window.closeChatMenu = closeChatMenu;
});

/* ─────────────────────────────────────────────────────────────
 * 3) Cloud state sync (GET on load; POST on changes)
 *     - /api/state returns/accepts { data: {...} }
 * ───────────────────────────────────────────────────────────── */
(function () {
  // pull once on load if authenticated
  if (window.USER_AUTHENTICATED) {
    fetch("/api/state", { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(({ data }) => {
        if (data && typeof data === "object") {
          if (data.chatUsed != null) {
            localStorage.setItem("chatUsed", String(data.chatUsed));
          }
          if (data.resume_latest) {
            localStorage.setItem("resume_latest", JSON.stringify(data.resume_latest));
          }
        }
      })
      .catch(() => { /* best-effort */ });
  }

  // one canonical syncState
  window.syncState = function syncState(extra = {}) {
    if (!window.USER_AUTHENTICATED) return;
    const payload = {
      chatUsed: Number(localStorage.getItem("chatUsed") || 0),
      resume_latest: JSON.parse(localStorage.getItem("resume_latest") || "null"),
      ...extra,
    };
    fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ data: payload }),
    }).catch(() => { /* best-effort */ });
  };

  // push on tab hide as a best-effort
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      try { window.syncState(); } catch { /* ignore */ }
    }
  });

  // small example: record basic page view state
  document.addEventListener("DOMContentLoaded", () => {
    if (typeof window.USER_AUTHENTICATED !== "undefined") {
      window.syncState({
        path: location.pathname,
        authed: !!window.USER_AUTHENTICATED,
      });
    }
  });
})();

/* ─────────────────────────────────────────────────────────────
 * 4) Cookie Consent (banner + conditional analytics loading)
 *     - CONSENT_COOKIE is defined once in cookie.js and read here.
 * ───────────────────────────────────────────────────────────── */
const CONSENT_COOKIE = (window.JOBCUS && window.JOBCUS.CONSENT_COOKIE)
  ? window.JOBCUS.CONSENT_COOKIE
  : "jobcus_consent"; // fallback if cookie.js not loaded
const CONSENT_TTL_DAYS = 180;

function setCookie(name, value, days) {
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax; Secure`;
}
function getCookieConsent(name) {
  return document.cookie.split("; ").find((r) => r.startsWith(name + "="))?.split("=")[1] || null;
}
function readConsent() {
  try { return JSON.parse(decodeURIComponent(getCookieConsent(CONSENT_COOKIE) || "")) || null; }
  catch { return null; }
}
function writeConsent(obj) {
  setCookie(CONSENT_COOKIE, JSON.stringify({ ...obj, ts: Date.now() }), CONSENT_TTL_DAYS);
}
function show(el) {
  if (!el) return;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("is-visible"));
}
function hide(el) {
  if (!el) return;
  el.classList.remove("is-visible");
  setTimeout(() => { el.hidden = true; }, 300);
}

/** Apply consent: set Consent Mode defaults and load scripts only if granted */
function applyConsent(consent) {
  // GA4 Consent Mode (defaults: denied)
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  gtag("consent", "default", {
    ad_storage: "denied",
    analytics_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });

  if (consent?.analytics) {
    gtag("consent", "update", { analytics_storage: "granted" });

    // Load GA4 only after consent
    (function () {
      var s = document.createElement("script");
      s.async = 1;
      s.src = "https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX"; // TODO: replace with your GA4 ID
      document.head.appendChild(s);
    })();
    gtag("js", new Date());
    gtag("config", "G-XXXXXXX", {
      anonymize_ip: true,
      allow_google_signals: false,
    });
  }

  if (consent?.marketing) {
    gtag("consent", "update", {
      ad_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
    });
    // Load other marketing/remarketing tags here (only after consent)
  }
}

// Wire up the banner if it exists on the page
(function () {
  const banner = document.getElementById("consentBanner");
  if (!banner) return;

  const panel       = document.getElementById("ccPanel");
  const dim         = document.getElementById("ccDim");
  const btnAccept   = document.getElementById("ccAccept");
  const btnReject   = document.getElementById("ccReject");
  const btnCustomize= document.getElementById("ccCustomize");
  const btnSave     = document.getElementById("ccSave");
  const cbAnalytics = document.getElementById("ccAnalytics");
  const cbMarketing = document.getElementById("ccMarketing");

  const saved = readConsent();
  const dnt   = (navigator.doNotTrack == "1" || window.doNotTrack == "1");

  if (saved) {
    applyConsent(saved);
  } else {
    show(banner);
    if (dnt) {
      if (cbAnalytics) cbAnalytics.checked = false;
      if (cbMarketing) cbMarketing.checked = false;
    }
  }

  // Preferences panel open/close
  function openPanel() {
    show(panel);
    if (dim) {
      dim.hidden = false;
      requestAnimationFrame(() => dim.classList.add("is-visible"));
    }
  }
  function closePanel() {
    hide(panel);
    if (dim) {
      dim.classList.remove("is-visible");
      setTimeout(() => { dim.hidden = true; }, 300);
    }
  }

  btnCustomize?.addEventListener("click", openPanel);
  dim?.addEventListener("click", closePanel);

  btnAccept?.addEventListener("click", () => {
    const consent = { necessary: true, analytics: true, marketing: true, version: 1 };
    writeConsent(consent);
    hide(banner);
    applyConsent(consent);
  });

  btnReject?.addEventListener("click", () => {
    const consent = { necessary: true, analytics: false, marketing: false, version: 1 };
    writeConsent(consent);
    hide(banner);
    applyConsent(consent);
  });

  btnSave?.addEventListener("click", () => {
    const consent = {
      necessary: true,
      analytics: !!cbAnalytics?.checked,
      marketing: !!cbMarketing?.checked,
      version: 1,
    };
    writeConsent(consent);
    hide(banner);
    applyConsent(consent);
    closePanel();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });
})();

/* ── Watermark helper (global; add once) ───────────────────── */
(function () {
  if (window.__wm_inited__) return;
  window.__wm_inited__ = true;

  const EMAIL_RE = /@.+\./;

  function sanitizeWatermarkText(t) {
    const raw = String(t || "").trim();
    // Never allow emails or empty strings to become the watermark
    if (!raw || EMAIL_RE.test(raw)) return "JOBCUS.COM";
    return raw;
  }

  // Remove any prior watermarks/inline backgrounds in a document or subtree
  function stripExistingWatermarks(root = document) {
    try {
      const doc = root.ownerDocument || root; // works for iframes, too
      // 1) Brutal CSS override to kill pseudo-element watermarks & tiled bg
      if (!doc.getElementById("wm-nuke-style")) {
        const st = doc.createElement("style");
        st.id = "wm-nuke-style";
        st.textContent = `
          * { background-image: none !important; }
          *::before, *::after { background-image: none !important; content: '' !important; }
        `;
        (doc.head || doc.documentElement).appendChild(st);
      }
      // 2) Remove attributes/classes our or server code might have set
      (root.querySelectorAll
        ? root.querySelectorAll("[data-watermark], [data-watermark-tile], .wm-tiled, [style*='background-image']")
        : []
      ).forEach(el => {
        el.removeAttribute?.("data-watermark");
        el.removeAttribute?.("data-watermark-tile");
        el.classList?.remove("wm-tiled");
        el.style && (el.style.backgroundImage = el.style.backgroundSize = el.style.backgroundBlendMode = "");
      });
    } catch {}
  }

  // Make a single tile
  function makeTile(text, { size=420, alpha=0.18, angle=-30, font='bold 36px Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'}={}) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.clearRect(0,0,size,size);
    ctx.globalAlpha = alpha;
    ctx.translate(size/2, size/2);
    ctx.rotate((angle * Math.PI)/180);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font;
    ctx.fillStyle = '#000';
    const L = String(text).toUpperCase();
    const gap = 44;
    ctx.fillText(L, 0, -gap/2);
    ctx.fillText(L, 0,  gap/2);
    return c.toDataURL('image/png');
  }

  // Public: apply tiled watermark
  function applyTiledWatermark(el, text, opts={}) {
    text = sanitizeWatermarkText(text);
    if (!el || !text) return;

    // clean any previous backgrounds first
    stripExistingWatermarks(el);

    const angles = Array.isArray(opts.angles) && opts.angles.length ? opts.angles : [-32, 32];
    const urls   = angles.map(a => makeTile(text, { ...opts, angle:a }));
    const sizePx = (opts.size || 420) + 'px ' + (opts.size || 420) + 'px';

    el.classList.add('wm-tiled');
    el.style.backgroundImage = urls.map(u => `url(${u})`).join(', ');
    el.style.backgroundSize  = urls.map(() => sizePx).join(', ');
    el.style.backgroundBlendMode = 'multiply, multiply';
    el.style.backgroundRepeat = 'repeat';
  }

  // Auto-apply for declarative elements but never allow emails
  function scan(root) {
    if (!root || typeof root.querySelectorAll !== "function") root = document;
    root.querySelectorAll('[data-watermark][data-watermark-tile="1"]').forEach(el => {
      if (el.__wm_applied__) return;
      el.__wm_applied__ = true;
      applyTiledWatermark(el, sanitizeWatermarkText(el.getAttribute('data-watermark') || 'JOBCUS.COM'));
    });
  }

  // Helper you can call anywhere (answers, previews, etc.)
  window.stripExistingWatermarks = stripExistingWatermarks;
  window.applyTiledWatermark     = applyTiledWatermark;

  document.addEventListener('DOMContentLoaded', () => scan(document));
  new MutationObserver(() => scan()).observe(document.documentElement, { childList: true, subtree: true });
})();
