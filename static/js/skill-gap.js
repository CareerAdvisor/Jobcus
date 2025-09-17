// /static/js/skill-gap.js
(function () {
  "use strict";

  // Always send cookies with fetch (SameSite=Lax)
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  function escapeHtml(s = "") {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ───────────────────────────────────────────────
  // Watermark helpers (email-safe + strip fallbacks)
  // ───────────────────────────────────────────────
  const EMAIL_RE = /@.+\./;
  function sanitizeWM(t) {
    const raw = String(t || "").trim();
    return (!raw || EMAIL_RE.test(raw)) ? "JOBCUS.COM" : raw;
  }
  function stripWatermarks(root = document) {
    // Prefer global helper from base.js
    if (typeof window.stripExistingWatermarks === "function") {
      try { window.stripExistingWatermarks(root); return; } catch {}
    }
    // Local fallback (kills bg images & pseudo-element content)
    try {
      const doc = root.ownerDocument || root;
      if (doc && !doc.getElementById("wm-nuke-style")) {
        const st = doc.createElement("style");
        st.id = "wm-nuke-style";
        st.textContent = `
          * { background-image: none !important; }
          *::before, *::after { background-image: none !important; content: '' !important; }
        `;
        (doc.head || doc.documentElement).appendChild(st);
      }
      (root.querySelectorAll
        ? root.querySelectorAll("[data-watermark], [data-watermark-tile], .wm-tiled, [style*='background-image']")
        : []
      ).forEach(el => {
        el.removeAttribute?.("data-watermark");
        el.removeAttribute?.("data-watermark-tile");
        el.classList?.remove("wm-tiled");
        if (el.style) {
          el.style.backgroundImage = "";
          el.style.backgroundSize = "";
          el.style.backgroundBlendMode = "";
        }
      });
    } catch {}
  }
  function applyWM(el, text = "JOBCUS.COM", opts = { size: 460, alpha: 0.16, angles: [-32, 32] }) {
    text = sanitizeWM(text);
    if (!el || !text) return;
    // Prefer global tiler from base.js
    if (typeof window.applyTiledWatermark === "function") {
      stripWatermarks(el);
      window.applyTiledWatermark(el, text, opts);
      return;
    }
    // Local minimal fallback
    stripWatermarks(el);
    const size = opts.size || 420;
    const angles = Array.isArray(opts.angles) && opts.angles.length ? opts.angles : [-32, 32];
    function makeTile(t, angle, alpha = 0.18) {
      const c = document.createElement("canvas");
      c.width = size; c.height = size;
      const ctx = c.getContext("2d");
      ctx.clearRect(0,0,size,size);
      ctx.globalAlpha = (opts.alpha ?? alpha);
      ctx.translate(size/2, size/2);
      ctx.rotate((angle * Math.PI)/180);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = 'bold 36px Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
      ctx.fillStyle = "#000";
      const L = String(t).toUpperCase();
      const gap = 44;
      ctx.fillText(L, 0, -gap/2);
      ctx.fillText(L, 0,  gap/2);
      return c.toDataURL("image/png");
    }
    const urls = angles.map(a => makeTile(text, a));
    const sz = size + "px " + size + "px";
    el.classList.add("wm-tiled");
    el.style.backgroundImage = urls.map(u => `url(${u})`).join(", ");
    el.style.backgroundSize = urls.map(() => sz).join(", ");
    el.style.backgroundBlendMode = "multiply, multiply";
    el.style.backgroundRepeat = "repeat";
  }

  // Centralized error handler — handle upgrade BEFORE generic 401/403
  async function handleCommonErrors(res) {
    if (res.ok) return null;

    const ct = res.headers.get("content-type") || "";
    let body = null;
    let rawText = "";
    try {
      if (ct.includes("application/json")) {
        body = await res.json();
      } else {
        rawText = await res.text();
      }
    } catch { body = null; }

    // ---- Upgrade / quota exceeded FIRST ----
    if (res.status === 402 || (body?.error === "upgrade_required")) {
      const html = body?.message_html;
      const text = body?.message || "You’ve reached your plan limit. Upgrade to continue.";
      window.showUpgradeBanner?.(html || text);
      throw new Error(text);
    }

    // ---- Auth required ----
    if (res.status === 401 || res.status === 403) {
      const msg = (body && body.message) || "Please sign up or log in to use this feature.";
      window.showUpgradeBanner?.(msg);
      setTimeout(() => { window.location.href = "/account?mode=login"; }, 800);
      throw new Error(msg);
    }

    // Abuse guard
    if (res.status === 429 && body && (body.error === "too_many_free_accounts" || body.error === "device_limit")) {
      const msg = (body && body.message) || "Too many free accounts detected from your network/device.";
      window.showUpgradeBanner?.(msg);
      throw new Error(msg);
    }

    const msg = (body && body.message) || `Request failed (${res.status})`;
    throw new Error(msg);
  }

  // ── Plan flags ─────────────────
  function readFlags() {
    const plan = (document.body.dataset.plan || "guest").toLowerCase();
    return {
      isPaid: (plan === "standard" || plan === "premium"),
      isSuperadmin: document.body.dataset.superadmin === "1",
    };
  }

  // nocopy + key guards (for free users)
  function enableNoCopyNoShot(box) {
    if (!box) return;
    box.classList.add("nocopy");
    const kill = (e) => { e.preventDefault(); e.stopPropagation(); };
    const keyBlock = (e) => {
      const k = (e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ["c","x","s","p"].includes(k)) return kill(e);
      if (k === "printscreen") return kill(e);
    };
    ["copy","cut","dragstart","contextmenu","selectstart"].forEach(ev =>
      box.addEventListener(ev, kill, { passive: false })
    );
    document.addEventListener("keydown", keyBlock, { passive: false });

    // Hide on print
    const style = document.createElement("style");
    style.textContent = "@media print { #gapResult { visibility:hidden !important; } }";
    document.head.appendChild(style);
  }

  // Enforce watermark policy on the result box
  function protectResultBox(box) {
    const { isPaid, isSuperadmin } = readFlags();
    // Always strip any pre-existing (email/user) watermark first
    stripWatermarks(box);
    if (!isPaid && !isSuperadmin) {
      applyWM(box, "JOBCUS.COM", { size: 460, alpha: 0.16, angles: [-32, 32] });
      enableNoCopyNoShot(box);
    }
  }

  // ── Main form wire-up ───────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    const form        = document.getElementById("skillGapForm");
    const goalInput   = document.getElementById("goal");
    const skillsInput = document.getElementById("skills");
    const resultBox   = document.getElementById("gapResult");

    if (!form || !goalInput || !skillsInput || !resultBox) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const goal   = (goalInput.value || "").trim();
      const skills = (skillsInput.value || "").trim();

      if (!goal || !skills) {
        resultBox.innerHTML = "⚠️ Please enter both your career goal and current skills.";
        resultBox.classList.add("show");
        return;
      }

      // Reset + loading
      stripWatermarks(resultBox);
      resultBox.innerHTML = '<span class="typing">Analyzing skill gaps<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>';
      resultBox.classList.remove("show");
      void resultBox.offsetWidth; // reflow for animation
      resultBox.classList.add("show");

      try {
        const res = await fetch("/api/skill-gap", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ goal, skills })
        });

        await handleCommonErrors(res);

        const ct = res.headers.get("content-type") || "";
        let data;
        if (ct.includes("application/json")) {
          data = await res.json().catch(() => ({}));
        } else {
          const txt = await res.text().catch(() => "");
          data = { result: txt };
        }

        const output = data.result || data.reply || data.analysis || data.description || "";
        if (!output) {
          resultBox.innerHTML = "⚠️ No result returned. Please try again.";
          return;
        }

        // Render: markdown if available, else escape+pre
        if (window.marked?.parse) {
          resultBox.innerHTML = '<div class="ai-response">' + window.marked.parse(String(output)) + "</div>";
        } else {
          resultBox.innerHTML = '<div class="ai-response"><pre>' + escapeHtml(String(output)) + "</pre></div>";
        }

        // After content exists, enforce the policy (free users only get JOBCUS.COM)
        protectResultBox(resultBox);
      } catch (err) {
        console.error("Skill Gap Error:", err);
        const msg = err?.message || "Something went wrong. Please try again later.";
        resultBox.innerHTML = "❌ " + escapeHtml(msg);
      }
    });
  });
})();
