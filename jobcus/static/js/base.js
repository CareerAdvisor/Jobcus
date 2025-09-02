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
      // b is hex pairs with dashes every 2 bytes; convert to canonical 8-4-4-4-12:
      return (
        b.slice(0,8) + "-" +
        b.slice(9,13) + "-" +
        b.slice(14,18) + "-" +
        b.slice(19,23) + "-" +
        (b.slice(24,36).replace(/-/g,""))
      );
    }
    // Fallback (not crypto-strong, but acceptable as last resort)
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
    // expose for debugging if needed
    try {
      const val = document.cookie.split("; ").find(r => r.startsWith(NAME + "="))?.split("=")[1] || "";
      window.DEVICE_ID = decodeURIComponent(val);
    } catch {}
  }
})();

/* ─────────────────────────────────────────────────────────────
 * 0.2) Global fetch wrapper to always send cookies
 * ───────────────────────────────────────────────────────────── */
(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

/* ─────────────────────────────────────────────────────────────
 * 1) Global upgrade banner helper
 * ───────────────────────────────────────────────────────────── */
// Global upgrade banner helper
window.showUpgradeBanner = function (text) {
  const el = document.getElementById("upgrade-banner");
  if (!el) return alert(text || "You’ve reached your plan limit. Upgrade to continue.");

  el.textContent = text || "You’ve reached your plan limit. Upgrade to continue.";
  el.hidden = false;
  el.classList.add("show");

  // Auto-hide after a while (optional)
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.classList.remove("show");
    el.hidden = true;
    el.textContent = "";
  }, 8000);
};

// Optional manual hide
window.hideUpgradeBanner = function () {
  const el = document.getElementById("upgrade-banner");
  if (!el) return;
  clearTimeout(el._hideTimer);
  el.classList.remove("show");
  el.hidden = true;
  el.textContent = "";
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
