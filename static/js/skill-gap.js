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
  // Watermark helpers (email-safe + strip + SPARSE stamps)
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
        el.classList?.remove("wm-tiled","wm-sparse");
        if (el.style) {
          el.style.backgroundImage = "";
          el.style.backgroundSize = "";
          el.style.backgroundBlendMode = "";
        }
      });
      // Also remove any prior sparse overlays so stamps don’t stack
      (root.querySelectorAll ? root.querySelectorAll(".wm-overlay") : []).forEach(n => {
        try { n._ro?.disconnect?.(); } catch {}
        n.remove();
      });
    } catch {}
  }
  
  // --- Watermark helpers: sparse, 2-stamp overlay (no tiling) ---
  function applySparseWM(el, text = "JOBCUS.COM", opts = {}) {
    if (!el || !text) return;
    // Remove any previous overlays
    try { el.querySelectorAll(":scope > .wm-overlay").forEach(n => { n._ro?.disconnect?.(); n.remove(); }); } catch {}
  
    const overlay = document.createElement("canvas");
    overlay.className = "wm-overlay";
    el.appendChild(overlay);
  
    const DPR   = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const angle = ((opts.rotate ?? -28) * Math.PI) / 180;
    const color = opts.color || "rgba(16,72,121,.12)";
    const font  = opts.fontFamily || "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
    const count = 2;                 // ✅ exactly two stamps
  
    function draw() {
      const r = el.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(el.scrollHeight || r.height));
  
      overlay.style.width = w + "px";
      overlay.style.height = h + "px";
      overlay.width  = Math.round(w * DPR);
      overlay.height = Math.round(h * DPR);
  
      const ctx = overlay.getContext("2d");
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      ctx.save();
      ctx.scale(DPR, DPR);
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
  
      const fontPx = opts.fontSize || Math.max(110, Math.min(Math.floor((w + h) / 8), 200));
      ctx.font = `700 ${fontPx}px ${font}`;
  
      // Two large stamps — upper-left-ish & lower-right-ish
      const points = [[0.28, 0.32], [0.72, 0.74]];
      points.forEach(([fx, fy]) => {
        const x = fx * w, y = fy * h;
        ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.fillText(text, 0, 0); ctx.restore();
      });
  
      ctx.restore();
    }
  
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    overlay._ro = ro;
  }
  
  function stripWatermarks(root = document) {
    try {
      root.querySelectorAll(".wm-overlay").forEach(n => { n._ro?.disconnect?.(); n.remove(); });
      (root.querySelectorAll ? root.querySelectorAll("[style*='background-image']") : [])
        .forEach(el => { el.style.backgroundImage = ""; el.style.backgroundSize = ""; el.style.backgroundBlendMode = ""; });
    } catch {}
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
    style.textContent = "@media print { #gapResult, #skillGapOutput { visibility:hidden !important; } }";
    document.head.appendChild(style);
  }

  // Enforce watermark policy on the result box
  function protectResultBox(box) {
    const plan = (document.body.dataset.plan || "guest").toLowerCase();
    const isPaid = (plan === "standard" || plan === "premium");
    const isSuperadmin = (document.body.dataset.superadmin === "1");
  
    stripWatermarks(box);                 // clear any previous WM/canvas/tiling
    if (!isPaid && !isSuperadmin) {
      applySparseWM(box, "JOBCUS.COM", {  // exactly two big stamps (via applySparseWM)
        fontSize: 160,
        rotate: -28
      });
      enableNoCopyNoShot(box);            // keep your free-tier guard
    }
  }

  // ── Main form wire-up ───────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    const form        = document.getElementById("skillGapForm");
    // 🔹 Your requested overlay wrap (shows watermark only after content exists)
    const sgWrap      = document.getElementById("skillGapWrap");
    const sgOut       = document.getElementById("skillGapOutput") || document.getElementById("gapResult"); // fallback

    function renderSkillGap(html) {
      if (!sgOut) return;
      sgOut.innerHTML = html || "";
    }
    
    function clearSkillGap() {
      if (!sgOut) return;
      sgOut.textContent = "Result appears here...";
      stripWatermarks(sgOut);        // ✅ also clear any prior canvas overlays
    }
    
    // Expose if you want to call elsewhere:
    window.renderSkillGap = renderSkillGap;
    window.clearSkillGap  = clearSkillGap;

    const goalInput   = document.getElementById("goal");
    const skillsInput = document.getElementById("skills");
    const resultBox   = sgOut; // use new output box (or fallback)

    if (!form || !goalInput || !skillsInput || !resultBox) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const goal   = (goalInput.value || "").trim();
      const skills = (skillsInput.value || "").trim();

      if (!goal || !skills) {
        renderSkillGap("⚠️ Please enter both your career goal and current skills.");
        resultBox.classList.add("show");
        return;
      }

      // Reset + loading
      stripWatermarks(resultBox);
      clearSkillGap();
      renderSkillGap('<span class="typing">Analyzing skill gaps<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>');
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
          renderSkillGap("⚠️ No result returned. Please try again.");
          return;
        }

        // Render (markdown if available)
        const html = window.marked?.parse
          ? '<div class="ai-response">' + window.marked.parse(String(output)) + "</div>"
          : '<div class="ai-response"><pre>' + escapeHtml(String(output)) + "</pre></div>";

        renderSkillGap(html);        // show content first (this also toggles the overlay WM)
        protectResultBox(resultBox); // then apply sparse stamps for free users
      } catch (err) {
        console.error("Skill Gap Error:", err);
        const msg = err?.message || "Something went wrong. Please try again later.";
        renderSkillGap("❌ " + escapeHtml(msg));
      }
    });
  });
})();
