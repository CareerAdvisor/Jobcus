// static/js/base.js
// Site-wide utilities, SAFE for auth pages.

(function () {
  "use strict";

  // ---------- Utilities ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Debounce helper
  function debounce(fn, ms = 150) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ---------- Navigation / UI ----------
  function initMenus() {
    const toggles = $$(".js-menu-toggle");
    toggles.forEach((btn) => {
      const targetSel = btn.getAttribute("data-target");
      const target = targetSel ? $(targetSel) : null;
      if (!target) return;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const visible = target.getAttribute("data-open") === "1";
        target.setAttribute("data-open", visible ? "0" : "1");
      });
    });
  }

  function initTheme() {
    // Simple theme persistence example
    const pref = localStorage.getItem("theme") || "auto";
    document.documentElement.setAttribute("data-theme", pref);
    $$(".js-theme-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cur = document.documentElement.getAttribute("data-theme") || "auto";
        const next = cur === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("theme", next);
      });
    });
  }

  // ---------- Supabase Load Monitor (helps debugging on /account) ----------
  function monitorSupabase() {
    // Only log on pages that include auth form
    if (!$("#auth-form")) return;
    window.addEventListener("DOMContentLoaded", () => {
      const present = typeof window.supabase;
      console.log("[base.js] Supabase present?", present);
      // If undefined here, the guarded loader in account.html will still try for 5s.
    });
  }

  // ---------- Init on load ----------
  window.addEventListener("DOMContentLoaded", () => {
    initMenus();
    initTheme();
    monitorSupabase();
  });

  // ---------- DO NOT monkey-patch fetch ----------
  // If you previously wrapped window.fetch to handle errors globally, ensure you:
  //  - never alter Requests for <script> loads,
  //  - never convert non-JSON to JSON,
  //  - and do not throw on non-2xx for GET <script>.
  // That kind of patch can break SDK loading and cause "Unexpected token '<'" downstream.

})();
