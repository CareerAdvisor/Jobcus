// /static/js/cover-letter.js
(function () {
  "use strict";

  // Always send cookies with fetch (SameSite=Lax)
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  const PRICING_URL = (window.PRICING_URL || "/pricing");

  /* ---------- tiny utils ---------- */
  const escapeHtml = (s="") =>
    String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");

  // ───────────────────────────────────────────────
  // Watermark helpers (tiled fallback + SPARSE big stamps)
  // ───────────────────────────────────────────────
  const __EMAIL_RE__ = /@.+\./;
  function __sanitizeWM__(t) {
    const raw = String(t || "").trim();
    return (!raw || __EMAIL_RE__.test(raw)) ? "JOBCUS.COM" : raw;
  }
  function __stripWatermarks__(root = document) {
    if (typeof window.stripExistingWatermarks === "function") {
      try { window.stripExistingWatermarks(root); return; } catch {}
    }
    try {
      const doc = (root.ownerDocument || root);
      if (doc && !doc.getElementById("wm-nuke-style")) {
        const st = doc.createElement("style");
        st.id = "wm-nuke-style";
        st.textContent = `
          * { background-image: none !important; }
          *::before, *::after { background-image: none !important; content: '' !important; }
        `;
        (doc.head || doc.documentElement).appendChild(st);
      }
      (root.querySelectorAll ? root.querySelectorAll(
        "[data-watermark], [data-watermark-tile], .wm-tiled, [style*='background-image']"
      ) : []).forEach(el => {
        el.removeAttribute?.("data-watermark-tile");
        el.classList?.remove("wm-tiled","wm-sparse");
        if (el.style) {
          el.style.backgroundImage = "";
          el.style.backgroundSize = "";
          el.style.backgroundBlendMode = "";
        }
      });
      (root.querySelectorAll ? root.querySelectorAll(".wm-overlay") : []).forEach(n => {
        try { n._ro?.disconnect?.(); } catch {}
        n.remove();
      });
    } catch {}
  }
  function __applySparseWM__(el, text = "JOBCUS.COM", opts = {}) {
    text = __sanitizeWM__(text);
    if (!el || !text) return;
    try { el.querySelectorAll(":scope > .wm-overlay").forEach(x => { x._ro?.disconnect?.(); x.remove(); }); } catch {}
    const overlay = document.createElement("canvas");
    overlay.className = "wm-overlay";
  
    /* NEW: keep the canvas out of normal flow */
    overlay.style.cssText = "position:fixed; inset:0; pointer-events:none; z-index:9999; display:block;";
  
    el.classList.add("wm-sparse");
    el.appendChild(overlay);

    const DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const angle = (opts.rotate != null ? opts.rotate : -30) * Math.PI / 180;
    const color = opts.color || "rgba(16,72,121,.12)";
    const baseFont = opts.fontFamily || "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";

    function draw() {
      const r = el.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(el.scrollHeight || r.height));
      overlay.style.width = w + "px";
      overlay.style.height = h + "px";
      overlay.width  = Math.round(w * DPR);
      overlay.height = Math.round(h * DPR);

      const ctx = overlay.getContext("2d");
      ctx.clearRect(0,0,overlay.width, overlay.height);
      ctx.save();
      ctx.scale(DPR, DPR);
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const count = (opts.count ? +opts.count : (h > (opts.threshold || 1400) ? 4 : 3));
      const fontPx = opts.fontSize || Math.max(96, Math.min(Math.floor((w + h) / 10), 180));
      ctx.font = `700 ${fontPx}px ${baseFont}`;

      let points;
      if (count <= 3) {
        points = [[0.22,0.30],[0.50,0.55],[0.78,0.80]];
      } else {
        points = [[0.28,0.30],[0.72,0.30],[0.28,0.72],[0.72,0.72]];
      }

      points.forEach(([fx, fy]) => {
        const x = fx * w, y = fy * h;
        ctx.save(); ctx.translate(x,y); ctx.rotate(angle); ctx.fillText(text,0,0); ctx.restore();
      });
      ctx.restore();
    }

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    overlay._ro = ro;
  }
  function __applyTiledWM__(el, text = "JOBCUS.COM", opts = { size: 460, alpha: 0.16, angles: [-32, 32] }) {
    text = __sanitizeWM__(text);
    if (!el || !text) return;
    __stripWatermarks__(el);
    const size = opts.size || 540;
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
      ctx.font = 'bold 48px Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
      ctx.fillStyle = "#000";
      const L = String(t).toUpperCase();
      const gap = 56;
      ctx.fillText(L, 0, -gap/2);
      ctx.fillText(L, 0,  gap/2);
      return c.toDataURL("image/png");
    }
    const urls = angles.map(a => makeTile(text, a));
    const sz = size + "px " + size + "px";
    el.classList.remove("wm-sparse");
    el.classList.add("wm-tiled");
    el.style.backgroundImage = urls.map(u => `url(${u})`).join(", ");
    el.style.backgroundSize = urls.map(() => sz).join(", ");
    el.style.backgroundBlendMode = "multiply, multiply";
    el.style.backgroundRepeat = "repeat";
  }
  function __applyWatermark__(el, text = "JOBCUS.COM", opts = {}) {
    text = __sanitizeWM__(text);
    if (!el || !text) return;
    __stripWatermarks__(el);
    if (opts && (opts.mode === "sparse" || opts.count || opts.fontSize)) {
      __applySparseWM__(el, text, opts);
    } else {
      __applyTiledWM__(el, text, opts);
    }
  }

  // Dynamic loader for docx (client fallback)
  async function ensureDocxBundle() {
    if (window.docx) return window.docx;
    const urls = [
      "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js",
      "https://cdn.jsdelivr.net/npm/docx@8.4.0/build/index.umd.js",
      "https://unpkg.com/docx@8.5.0/build/index.umd.js",
    ];
    for (const src of urls) {
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = src; s.async = true; s.crossOrigin = "anonymous";
          s.onload = () => window.docx ? resolve() : reject();
          s.onerror = reject;
          document.head.appendChild(s);
        });
        if (window.docx) return window.docx;
      } catch {}
    }
    throw new Error("DOCX library failed to load.");
  }

  async function handleCommonErrors(res) {
    if (res.ok) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let j=null, t="";
    try { if (ct.includes("application/json")) j=await res.json(); else t=await res.text(); } catch {}
    const msg = (j && (j.message || j.error)) || t || `Request failed (${res.status})`;

    if (res.status === 402 || (j && (j.error === "upgrade_required" || j.error === "quota_exceeded"))) {
      const url  = j?.pricing_url || PRICING_URL;
      const html = j?.message_html || `You’ve reached your plan limit. <a href="${url}">Upgrade now →</a>`;
      window.upgradePrompt?.(html, url, 1200);
      throw new Error(j?.message || "Upgrade required");
    }
    if (res.status === 401 || res.status === 403) {
      const authMsg = j?.message || "Please sign up or log in to use this feature.";
      window.showUpgradeBanner?.(authMsg);
      setTimeout(()=>{ window.location.href = "/account?mode=login"; }, 800);
      throw new Error(authMsg);
    }
    if (res.status === 429 && (j?.error === "too_many_free_accounts" || j?.error === "device_limit")) {
      const ab = j?.message || "Too many free accounts detected from your network/device.";
      window.showUpgradeBanner?.(ab);
      throw new Error(ab);
    }
    window.showUpgradeBanner?.(escapeHtml(msg));
    throw new Error(msg);
  }

  /* ---------- Gather + sanitize form context ---------- */
  function readDraftFromFormOrAI(form) {
    const ta = form?.querySelector('textarea[name="body"], textarea[name="draft"], textarea[name="cover_body"], #body, #letterBody');
    let val = ta?.value || "";
    if (!val) {
      const aiText = document.querySelector("#ai-cl .ai-text");
      val = aiText?.textContent?.trim() || "";
    }
    return val;
  }
  function sanitizeDraft(text) {
    if (!text) return text;
    let t = String(text).trim();
    t = t.replace(/^dear[^\n]*\n(\s*\n)*/i, "");
    t = t.replace(/\n+\s*(yours\s+sincerely|sincerely|kind\s+regards|best\s+regards|regards)[\s\S]*$/i, "");
    t = t.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    const paras = t.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    return paras.slice(0, 3).join("\n\n").trim();
  }
  function gatherContext(form) {
    const name = [form.firstName?.value, form.lastName?.value].filter(Boolean).join(" ").trim();
    const baseTone = (form.tone?.value || "professional").trim();
    const toneAugmented = `${baseTone}; human-like and natural; concise; maximum 3 short paragraphs`;
    const draft = sanitizeDraft(readDraftFromFormOrAI(form) || "");

    return {
      name,
      contact: form.contact?.value || "",
      company: form.company?.value || "",
      role: form.role?.value || "",
      jobUrl: form.jobUrl?.value || "",
      tone: toneAugmented,
      sender: {
        name,
        address1: form.senderAddress1?.value || "",
        city: form.senderCity?.value || "",
        postcode: form.senderPostcode?.value || "",
        email: form.senderEmail?.value || "",
        phone: form.senderPhone?.value || "",
        date: form.letterDate?.value || new Date().toISOString().slice(0,10)
      },
      recipient: {
        name: form.recipient?.value || "Hiring Manager",
        company: form.company?.value || "",
        address1: form.companyAddress1?.value || "",
        city: form.companyCity?.value || "",
        postcode: form.companyPostcode?.value || ""
      },
      cover_body: draft
    };
  }

  /* ---------- Wizard ---------- */
  function initWizard(onFinish) {
    const steps = Array.from(document.querySelectorAll(".rb-step"));
    const back  = document.getElementById("rb-back");
    const next  = document.getElementById("rb-next");
    let idx = Math.max(0, steps.findIndex(s => s.classList.contains("active")));
    if (idx < 0) idx = 0;

    function show(i) {
      idx = Math.max(0, Math.min(i, steps.length - 1));
      steps.forEach((s, k) => {
        const active = k === idx;
        s.classList.toggle("active", active);
        s.hidden = !active;
      });
      if (back) back.disabled = (idx === 0);
      if (next) next.textContent = (idx >= steps.length - 1) ? "Generate Cover Letter" : "Next";
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    back?.addEventListener("click", () => show(idx - 1));
    next?.addEventListener("click", async () => {
      if (idx < steps.length - 1) { show(idx + 1); return; }
      try { await onFinish?.(); } catch {}
    });

    steps.forEach((s, k) => { if (k !== idx) s.hidden = true; });
    show(idx);
  }

  /* ---------- Preview (returns when iframe loaded) ---------- */
  async function previewLetter(payload) {
    const wrap  = document.getElementById("clPreviewWrap");
    const frame = document.getElementById("clPreview");
    const dlBar = document.getElementById("cl-downloads");
    try {
      const res = await fetch("/build-cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "text/html,application/json" },
        body: JSON.stringify({ format: "html", letter_only: true, ...payload })
      });
      await handleCommonErrors(res);

      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("text/html")) throw new Error("Unexpected response.");
      const html = await res.text();

      if (wrap) { wrap.style.display = "block"; wrap.classList.remove("wm-active"); }

      if (frame) {
        frame.addEventListener("load", () => {
          if (wrap?.dataset?.watermark) wrap.classList.add("wm-active");
        
          try {
            const plan = (document.body.dataset.plan || "guest").toLowerCase();
            const isPaid       = (plan === "standard" || plan === "premium");
            const isSuperadmin = (document.body.dataset.superadmin === "1");
        
            const d    = frame.contentDocument || frame.contentWindow?.document;
            const host = d?.body || d?.documentElement;
            if (!host) return;
        
            // 1) Make letter HTML self-center and never overflow (inside iframe)
            const fix = d.createElement("style");
            fix.textContent = `
              html, body { margin:0; padding:0; overflow-x:hidden; }
              .cl {
                max-width: 740px !important;
                margin: 0 auto !important;
                padding: 0 18px !important;
                box-sizing: border-box;
              }
            `;
            (d.head || d.documentElement).appendChild(fix);
        
            // 2) Your watermark + protection (unchanged)
            __stripWatermarks__(d);
            if (!isPaid && !isSuperadmin) {
              __applyWatermark__(host, "JOBCUS.COM", {
                mode: "sparse",
                fontSize: 200,
                count: 4,
                rotate: -30
              });
              host.classList.add("nocopy");
              const kill = (e) => { e.preventDefault(); e.stopPropagation(); };
              ["copy","cut","dragstart","contextmenu","selectstart"].forEach(ev =>
                host.addEventListener(ev, kill, { passive: false })
              );
              d.addEventListener("keydown", (e) => {
                const k = (e.key || "").toLowerCase();
                if ((e.ctrlKey || e.metaKey) && ["c","x","s","p"].includes(k)) return kill(e);
              }, { passive: false });
            }
          } catch {}
        
          // 3) Make sure the controls row is visible after load
          if (dlBar) dlBar.style.display = "flex";
        }, { once: true });

        frame.setAttribute("sandbox", "allow-same-origin");
        frame.srcdoc = html;
      }
    } catch (err) {
      console.warn("Cover letter preview error:", err);
      window.showUpgradeBanner?.(err.message || "Preview failed.");
    }
  }

  /* ---------- AI: generate draft ---------- */
  async function aiSuggestCoverLetter(ctx) {
    const res = await fetch("/ai/cover-letter", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(ctx)
    });
    await handleCommonErrors(res);
    const json = await res.json().catch(() => ({}));
    if (!json.draft) throw new Error("No draft returned.");
    return sanitizeDraft(json.draft);
  }

  /* ---------- Downloads ---------- */
  async function downloadPDF(ctx) {
    try {
      const res = await fetch("/build-cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/pdf,application/json" },
        body: JSON.stringify({ format: "pdf", letter_only: true, ...ctx })
      });
      if (!res.ok) await handleCommonErrors(res);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "cover-letter.pdf"; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      window.showUpgradeBanner?.(err.message || "Download failed.");
    }
  }

  async function downloadDOCX(ctx) {
    // Same plan gate as PDF
    const plan = (document.body.dataset.plan || "guest").toLowerCase();
    const isPaid = (plan === "standard" || plan === "premium");
    const isSuperadmin = (document.body.dataset.superadmin === "1");
    if (!isPaid && !isSuperadmin) {
      const html = `File downloads are available on Standard and Premium. <a href="${PRICING_URL}">Upgrade now →</a>`;
      window.upgradePrompt?.(html, PRICING_URL, 1200);
      return;
    }

    // Try server route first
    try {
      const res = await fetch("/build-cover-letter-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/json" },
        body: JSON.stringify({ letter_only: true, ...ctx })
      });
      if (res.status === 404) throw new Error("route_404");
      if (!res.ok) await handleCommonErrors(res);

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "cover-letter.docx"; a.click();
      URL.revokeObjectURL(url);
      return;
    } catch (err) { /* fall through to client mode */ }

    // Client-side fallback using docx — styled to match the PDF
    try { await ensureDocxBundle(); } catch (e) {
      window.showUpgradeBanner?.(e.message || "DOCX library not loaded.");
      return;
    }
    const { Document, Packer, Paragraph, TextRun, AlignmentType } = window.docx;

    const lines = [];
    const body = (ctx.cover_body || "").split("\n");
    const sender = ctx.sender || {};
    const recipient = ctx.recipient || {};

    const A4 = { width: 11906, height: 16838 }; // twips
    const M  = 1020;                             // ~18mm margins
    const LINE = 276;                            // ~1.5 line height
    const NORMAL = { size: 24, font: "Arial" };  // 12pt
    const NAME   = { size: 64, font: "Arial", bold: true };

    const P = (text, {align="LEFT", run=NORMAL, after=120}={}) =>
      new Paragraph({
        alignment: AlignmentType[align],
        spacing: { line: LINE, after },
        children: [ new TextRun(Object.assign({ text }, run)) ],
      });

    if (ctx.name) lines.push(P(ctx.name, { align:"CENTER", run: NAME, after: 80 }));
    const contact = [sender.address1, sender.city, sender.postcode].filter(Boolean).join(", ");
    if (contact)  lines.push(P(contact, { align:"CENTER" }));
    const reach = [sender.email, sender.phone].filter(Boolean).join(" | ");
    if (reach)   lines.push(P(reach, { align:"CENTER", after: 160 }));

    if (sender.date) lines.push(P(sender.date));
    const recLines = [
      recipient.name, recipient.company, recipient.address1,
      [recipient.city, recipient.postcode].filter(Boolean).join(", ")
    ].filter(Boolean);
    recLines.forEach(l => lines.push(P(l)));
    lines.push(P("", { after: 80 }));

    lines.push(P(`Dear ${recipient.name || "Hiring Manager"},`));
    body.forEach(p => lines.push(P(p || "")));
    lines.push(P(""));
    lines.push(P("Yours sincerely,"));
    lines.push(P(ctx.name || "", { after: 0 }));

    const doc = new Document({
      sections: [{ properties:{ page:{ size:A4, margin:{ top:M, bottom:M, left:M, right:M } } }, children: lines }]
    });

    const blob = await Packer.toBlob(doc);
    const url  = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "cover-letter.docx"; a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------- Boot ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("clForm");

    // ====== PREVIEW MODE (replace form on desktop) ======
    const container   = document.querySelector(".rb-container.rb-layout");
    const formCol     = document.querySelector(".rb-main");
    const previewWrap = document.getElementById("clPreviewWrap");
    const previewBtn  = document.getElementById("cl-preview");
    const backBtn     = document.getElementById("cl-back-edit");
    const downloads   = document.getElementById("cl-downloads");
    const iframe      = document.getElementById("clPreview");
    
    function enterPreviewMode() {
      if (previewWrap) previewWrap.style.display = "block";
      if (downloads) downloads.style.display = "flex";        // force visible
      if (backBtn)    backBtn.style.display = "inline-block"; // desktop back link
    
      if (window.matchMedia("(min-width:1024px)").matches && container) {
        container.classList.add("is-preview-full");
      }
    }    
      // watermark overlay toggle if present
      try {
        const wm = previewWrap?.dataset?.watermark;
        if (wm && !previewWrap.classList.contains("wm-active")) {
          previewWrap.classList.add("wm-active");
        }
      } catch {}
    }
    
    function exitPreviewMode() {
      if (container) container.classList.remove("is-preview-full");
    
      // Keep downloads row if you want; or hide it here:
      // if (downloads) downloads.style.display = "none";
      if (backBtn) backBtn.style.display = "none";
    }


    // Resize guard: dropping below desktop cancels single-column preview
    window.addEventListener("resize", () => {
      if (!window.matchMedia("(min-width: 1024px)").matches) {
        exitPreviewMode();
      }
    });

    // ====== Wizard: last step triggers preview/generate ======
    initWizard(async () => {
      await previewLetter(gatherContext(form));
      enterPreviewMode();
    });

    // ====== AI refresh / insert ======
    const aiCard = document.getElementById("ai-cl");
    const getAiTextEl = () => aiCard?.querySelector(".ai-text");

    aiCard?.addEventListener("click", async (e) => {
      const btn = e.target.closest(".ai-refresh, .ai-add");
      if (!btn) return;

      if (btn.classList.contains("ai-refresh")) {
        try {
          btn.disabled = true;
          const el = getAiTextEl(); if (el) el.textContent = "Thinking…";
          const draft = await aiSuggestCoverLetter(gatherContext(form));
          if (el) el.textContent = draft || "No draft yet.";
        } catch (err) {
          const el = getAiTextEl(); if (el) el.textContent = err.message || "AI failed.";
        } finally { btn.disabled = false; }
      }

      if (btn.classList.contains("ai-add")) {
        const el = getAiTextEl();
        const draft = el ? el.textContent.trim() : "";
        const bodyEl = form?.querySelector('textarea[name="body"]');
        if (draft && bodyEl) {
          bodyEl.value = sanitizeDraft(draft);
          bodyEl.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    });

    // ====== Manual preview button ======
    document.getElementById("cl-preview")?.addEventListener("click", async (e) => {
      e.preventDefault();
      await previewLetter(gatherContext(form));
      enterPreviewMode();
    });

    // ====== Back to edit (desktop-only button shown via CSS in preview mode) ======
    backBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      exitPreviewMode();
      try { formCol?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
    });

    // ====== Downloads (revealed after preview loads) ======
    document.getElementById("cl-download-pdf")?.addEventListener("click", async () => {
      await downloadPDF(gatherContext(form));
    });
    document.getElementById("cl-download-docx")?.addEventListener("click", async () => {
      await downloadDOCX(gatherContext(form));
    });
  });
();
