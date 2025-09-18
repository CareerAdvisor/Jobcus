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

  /* ---------- Tiny helpers ---------- */
  const EMAIL_RE = /@.+\./;
  const sanitizeWM = (t) => (!String(t||"").trim() || EMAIL_RE.test(t)) ? "JOBCUS.COM" : String(t).trim();
  const escapeHtml = (s="") => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");

  function stripWatermarks(root = document) {
    if (typeof window.stripExistingWatermarks === "function") {
      try { window.stripExistingWatermarks(root); return; } catch {}
    }
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
    if (typeof window.applyTiledWatermark === "function") {
      stripWatermarks(el);
      window.applyTiledWatermark(el, text, opts);
      return;
    }
    // Minimal canvas tiler
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

    // Upgrade/quota FIRST
    if (res.status === 402 || (j && (j.error === "upgrade_required" || j.error === "quota_exceeded"))) {
      const url  = j?.pricing_url || PRICING_URL;
      const html = j?.message_html || `You’ve reached your plan limit. <a href="${url}">Upgrade now →</a>`;
      window.upgradePrompt?.(html, url, 1200);
      throw new Error(j?.message || "Upgrade required");
    }
    // Auth
    if (res.status === 401 || res.status === 403) {
      const authMsg = j?.message || "Please sign up or log in to use this feature.";
      window.showUpgradeBanner?.(authMsg);
      setTimeout(()=>{ window.location.href = "/account?mode=login"; }, 800);
      throw new Error(authMsg);
    }
    // Abuse
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
      // last step → generate
      try { await onFinish?.(); } catch {}
    });

    // Initial visibility
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

      if (wrap) {
        wrap.style.display = "block";
        wrap.classList.remove("wm-active"); // overlay appears only after load
      }

      if (frame) {
        // bind before setting srcdoc
        frame.addEventListener("load", () => {
          if (wrap?.dataset?.watermark) wrap.classList.add("wm-active");

          try {
            const plan = (document.body.dataset.plan || "guest").toLowerCase();
            const isPaid       = (plan === "standard" || plan === "premium");
            const isSuperadmin = (document.body.dataset.superadmin === "1");

            const d    = frame.contentDocument || frame.contentWindow?.document;
            const host = d?.body || d?.documentElement;
            if (!host) return;

            // inside the iframe
            stripWatermarks(d);
            if (!isPaid && !isSuperadmin) {
              applyWM(host, "JOBCUS.COM", { size: 460, alpha: 0.16, angles: [-32, 32] });

              // nocopy guards
              host.classList.add("nocopy");
              const kill = (e) => { e.preventDefault(); e.stopPropagation(); };
              ["copy","cut","dragstart","contextmenu","selectstart"].forEach(ev =>
                host.addEventListener(ev, kill, { passive: false })
              );
              d.addEventListener("keydown", (e) => {
                const k = (e.key || "").toLowerCase();
                if ((e.ctrlKey || e.metaKey) && ["c","x","s","p"].includes(k)) return kill(e);
                if (k === "printscreen") return kill(e);
              }, { passive: false });
            }
          } catch {}
          // finally: reveal downloads
          if (dlBar) dlBar.style.display = "";
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
    } catch (err) {
      if (err && err.message !== "route_404") {
        // fall through to client mode anyway
      }
    }

    // Client-side fallback using docx
    try {
      await ensureDocxBundle();
    } catch (e) {
      window.showUpgradeBanner?.(e.message || "DOCX library not loaded.");
      return;
    }
    const { Document, Packer, Paragraph, TextRun } = window.docx;

    const lines = [];
    const body = (ctx.cover_body || "").split("\n");
    const sender = ctx.sender || {};
    const recipient = ctx.recipient || {};

    function push(text, bold=false) {
      lines.push(new Paragraph({ children: [new TextRun({ text, bold })] }));
    }

    if (ctx.name) push(ctx.name, true);
    const contact = [sender.address1, sender.city, sender.postcode].filter(Boolean).join(", ");
    if (contact) push(contact);
    const reach = [sender.email, sender.phone].filter(Boolean).join(" | ");
    if (reach) push(reach);
    push("");

    if (sender.date) push(sender.date);
    const recLines = [
      recipient.name, recipient.company, recipient.address1,
      [recipient.city, recipient.postcode].filter(Boolean).join(", ")
    ].filter(Boolean);
    recLines.forEach(l => push(l));
    push("");

    push(`Dear ${recipient.name || "Hiring Manager"},`);
    body.forEach(p => push(p || ""));
    push("");
    push("Yours sincerely,");
    push(ctx.name || "");

    const doc = new Document({ sections: [{ children: lines }] });
    const blob = await Packer.toBlob(doc);
    const url  = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "cover-letter.docx"; a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------- Boot ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("clForm");

    // wizard: last step triggers preview/generate
    initWizard(async () => {
      await previewLetter(gatherContext(form));
    });

    // AI refresh / insert
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

    // Manual preview
    document.getElementById("cl-preview")?.addEventListener("click", async () => {
      await previewLetter(gatherContext(form));
    });

    // Downloads (shown after preview load)
    document.getElementById("cl-download-pdf")?.addEventListener("click", async () => {
      await downloadPDF(gatherContext(form));
    });
    document.getElementById("cl-download-docx")?.addEventListener("click", async () => {
      await downloadDOCX(gatherContext(form));
    });
  });
})();
