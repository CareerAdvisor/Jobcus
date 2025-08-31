// static/js/base.js
"use strict";

/* ─────────────────────────────────────────────────────────────
 * 0) Safe init for AOS (if present)
 * ───────────────────────────────────────────────────────────── */
try {
  if (window.AOS && typeof window.AOS.init === "function") {
    window.AOS.init();
  }
} catch { /* ignore */ }

/* ─────────────────────────────────────────────────────────────
 * 1) Global upgrade banner helper
 * ───────────────────────────────────────────────────────────── */
window.showUpgradeBanner = function (text) {
  const el = document.getElementById("upgrade-banner");
  if (el) {
    el.textContent = text || "You’ve reached your plan limit. Upgrade to continue.";
    el.hidden = false;
  } else {
    alert(text || "You’ve reached your plan limit. Upgrade to continue.");
  }
};

/* ─────────────────────────────────────────────────────────────
 * 2) User menu (avatar) & general UI toggles
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

  // Features submenu (any .dropbtn → toggle its next .dropdown-content)
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
    }
  });

  // Expose mobile menu toggle for header button
  window.toggleMobileMenu = function toggleMobileMenu() {
    document.getElementById("mobileMenu")?.classList.toggle("show");
  };
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
 * ───────────────────────────────────────────────────────────── */
const CONSENT_COOKIE = "jobcus_consent";
const CONSENT_TTL_DAYS = 180;

function setCookie(name, value, days) {
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax; Secure`;
}
function getCookie(name) {
  return document.cookie.split("; ").find((r) => r.startsWith(name + "="))?.split("=")[1] || null;
}
function readConsent() {
  try { return JSON.parse(decodeURIComponent(getCookie(CONSENT_COOKIE) || "")) || null; }
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
