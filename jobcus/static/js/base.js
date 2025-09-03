// static/js/base.js
(function () {
  "use strict";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function initMenus() {
    $$(".js-menu-toggle").forEach((btn) => {
      const target = btn.getAttribute("data-target");
      const el = target ? $(target) : null;
      if (!el) return;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const open = el.getAttribute("data-open") === "1";
        el.setAttribute("data-open", open ? "0" : "1");
      });
    });
  }

  function initTheme() {
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

  window.addEventListener("DOMContentLoaded", () => {
    initMenus();
    initTheme();
    if ($("#auth-form")) {
      console.log("[base.js] account page detected");
    }
  });
})();
