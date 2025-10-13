// /static/js/employers.js
(function () {
  "use strict";

  // ──────────────────────────────────────────────────────────────────────────
  // One-time init guard (prevents double-execution if the script is included
  // twice or re-run by client-side navigation)
  // ──────────────────────────────────────────────────────────────────────────
  if (window.__JOBCUS_EMPLOYERS_INIT__) return;
  window.__JOBCUS_EMPLOYERS_INIT__ = true;

  document.addEventListener("DOMContentLoaded", function () {
    // Ensure cookies are sent (SameSite=Lax)
    const _fetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      if (!("credentials" in init)) init.credentials = "same-origin";
      return _fetch(input, init);
    };

    // Small helpers
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
        (root.querySelectorAll ? root.querySelectorAll(".wm-overlay") : []).forEach(n => {
          try { n._ro?.disconnect?.(); } catch {}
          n.remove();
        });
      } catch {}
    }

    // Sparse big-stamp watermark (3–4 placements)
    function applySparseWM(el, text = "JOBCUS.COM", opts = {}) {
      text = sanitizeWM(text);
      if (!el || !text) return;

      try { el.querySelectorAll(":scope > .wm-overlay").forEach(x => { x._ro?.disconnect?.(); x.remove(); }); } catch {}

      const overlay = document.createElement("canvas");
      overlay.className = "wm-overlay";
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

        const count  = (opts.count ? +opts.count : (h > (opts.threshold || 1400) ? 3 : 2));
        const fontPx = opts.fontSize || Math.max(96, Math.min(Math.floor((w + h) / 10), 180));
        ctx.font = `700 ${fontPx}px ${baseFont}`;

        let points;
        if (count <= 2) {
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

    // Original tiled fallback (kept)
    function applyWM(el, text = "JOBCUS.COM", opts = { size: 460, alpha: 0.16, angles: [-32, 32] }) {
      text = sanitizeWM(text);
      if (!el || !text) return;
      if (typeof window.applyTiledWatermark === "function") {
        stripWatermarks(el);
        window.applyTiledWatermark(el, text, opts);
        return;
      }
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

    async function handleCommonErrors(res) {
      if (res.ok) return null;
      const ct = res.headers.get("content-type") || "";
      let body = null;
      try { body = ct.includes("application/json") ? await res.json() : { message: await res.text() }; }
      catch { body = null; }

      if (res.status === 401 || res.status === 403) {
        const msg = body?.message || "Please sign in to continue.";
        window.showUpgradeBanner?.(msg);
        setTimeout(() => { window.location.href = "/account?mode=login"; }, 800);
        throw new Error(msg);
      }

      if (res.status === 402 || (res.status === 403 && body?.error === "upgrade_required")) {
        const url  = body?.pricing_url || (window.PRICING_URL || "/pricing");
        const msg  = body?.message || "You’ve reached your plan limit. Upgrade to continue.";
        const html = body?.message_html || `${escapeHtml(msg)} <a href="${url}">Upgrade now →</a>`;
        (window.upgradePrompt || window.showUpgradeBanner || alert)(html);
        if (window.upgradePrompt) window.upgradePrompt(html, url, 1200);
        throw new Error(msg);
      }

      if (res.status === 429 && body?.error === "too_many_free_accounts") {
        const msg = body?.message || "You have reached the limit for the free version, upgrade to enjoy more features";
        window.showUpgradeBanner?.(msg);
        throw new Error(msg);
      }

      const msg = body?.message || `Request failed (${res.status})`;
      throw new Error(msg);
    }

    // Plan flags from <body data-*>, set in base.html
    const plan         = (document.body.dataset.plan || "guest").toLowerCase();
    const isPaid       = (plan === "standard" || plan === "premium");
    const isSuperadmin = (document.body.dataset.superadmin === "1");

    // Elements
    const inquiryForm     = document.getElementById("employer-inquiry-form");
    const jobPostForm     = document.getElementById("job-post-form");
    const output          = document.getElementById("job-description-output");
    const downloadOptions = document.getElementById("download-options");
    const dlPdfBtn        = document.getElementById("download-pdf");
    const dlDocxBtn       = document.getElementById("download-docx");

    const wrap = document.getElementById("jobDescriptionWrap");
    const out  = output;

    function renderJobDescription(html) {
      if (!out) return;
      out.innerHTML = html || "";
      if (wrap?.dataset?.watermark) wrap.classList.add("wm-active");
      downloadOptions?.classList.remove("hidden");
      if (downloadOptions) downloadOptions.style.display = "";
    }
    function clearJobDescription() {
      if (!out) return;
      out.textContent = "";
      wrap?.classList.remove("wm-active");
      downloadOptions?.classList.add("hidden");
    }

    // No-copy / no-screenshot guard (free tier only)
    function enableNoCopyNoShot(el){
      if (!el) return;
      const kill = e => { e.preventDefault(); e.stopPropagation(); };
      el.addEventListener("copy", kill);
      el.addEventListener("cut", kill);
      el.addEventListener("dragstart", kill);
      el.addEventListener("contextmenu", kill);
      el.addEventListener("selectstart", kill);
      document.addEventListener("keydown", (e) => {
        const k = (e.key || "").toLowerCase();
        if ((e.ctrlKey||e.metaKey) && ["c","x","s","p"].includes(k)) return kill(e);
        if (k === "printscreen") return kill(e);
      });
    }

    function paintJD(text) {
      if (!out) return;
      const html = `<pre style="white-space:pre-wrap;margin:0">${escapeHtml(text || "")}</pre>`;
      renderJobDescription(html);
      stripWatermarks(out);
      if (!isPaid && !isSuperadmin) {
        stripWatermarks(out);
        applySparseWM(out, "JOBCUS.COM", {
          fontSize: 150,
          rotate: -30,
          count: (out.scrollHeight > 1400 ? 4 : 3)
        });
        out.classList.add("nocopy");
        enableNoCopyNoShot(out);
      }
      downloadOptions?.classList.remove("hidden");
      if (downloadOptions) downloadOptions.style.display = "";
      if (dlPdfBtn) dlPdfBtn.disabled = false;
      if (dlDocxBtn) dlDocxBtn.disabled = false;
    }

    function hideDownloads() {
      downloadOptions?.classList.add("hidden");
      if (downloadOptions) downloadOptions.style.display = "none";
      if (dlPdfBtn) dlPdfBtn.disabled = true;
      if (dlDocxBtn) dlDocxBtn.disabled = true;

      if (out) {
        stripWatermarks(out);
        out.classList.remove("nocopy");
        wrap?.classList.remove("wm-active");
      }
    }

    function readOutputText() {
      const pre = out?.querySelector("pre");
      if (pre) return (pre.innerText || pre.textContent || "").trim();
      return (out?.innerText || "").trim();
    }

    // Local fallback (dev only)
    async function fallbackDownload(fmt) {
      const text = readOutputText();
      if (!text) { alert("Generate a job description first."); return; }

      if (fmt === "pdf") {
        const { jsPDF } = window.jspdf || {};
        if (!jsPDF) return alert("PDF library not loaded.");
        const pdf = new jsPDF({ unit: "mm", format: "a4" });
        const lines = pdf.splitTextToSize(text, 180);
        let y = 10;
        lines.forEach(line => {
          if (y > 280) { pdf.addPage(); y = 10; }
          pdf.text(line, 10, y);
          y += 7;
        });
        pdf.save("job-description.pdf");
        return;
      }

      if (fmt === "docx") {
        const docx = window.docx || window["docx"];
        if (!docx) return alert("DOCX library not loaded.");
        const { Document, Packer, Paragraph, TextRun } = docx;
        const doc = new Document({
          sections: [{
            children: text.split("\n").map(line =>
              new Paragraph({ children: [new TextRun({ text: line })] })
            )
          }]
        });
        const blob = await Packer.toBlob(doc);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "job-description.docx";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
        return;
      }

      alert("Unsupported format.");
    }

    // Unified (gated) downloader — CALLS SERVER FIRST
    async function downloadJD(fmt) {
      if (!["pdf", "docx"].includes(fmt)) { alert("Unsupported format."); return; }
      const text = readOutputText();
      if (!text) { alert("Generate a job description first."); return; }

      const res = await fetch("/api/employer/job-post/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ format: fmt, text })
      });

      if (res.status === 403) {
        const info = await res.json().catch(() => ({}));
        const url  = info?.pricing_url || (window.PRICING_URL || "/pricing");
        const html = info?.message_html || `File downloads are available on Standard and Premium. <a href="${url}">Upgrade now →</a>`;
        window.upgradePrompt?.(html, url, 1200);
        return;
      }
      if (res.status === 401 || res.redirected) {
        window.location.href = "/account?mode=login";
        return;
      }
      if (res.status === 400) {
        const t = (await res.text()).toLowerCase();
        if (t.includes("unsupported")) {
          window.showUpgradeBanner?.("DOCX download not available yet. Please use PDF for now.");
          return;
        }
        window.showUpgradeBanner?.("Download failed.");
        return;
      }
      if (res.status === 404) return fallbackDownload(fmt);

      if (!res.ok) {
        const msg = (await res.text()) || "Download failed.";
        window.showUpgradeBanner?.(msg);
        return;
      }

      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (fmt === "pdf") ? "job-description.pdf" : "job-description.docx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    }

    dlPdfBtn?.addEventListener("click",  () => downloadJD("pdf"));
    dlDocxBtn?.addEventListener("click", () => downloadJD("docx"));

    // 📨 Employer Inquiry Handler
    if (inquiryForm) {
      inquiryForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        const statusEl = document.getElementById("inquiry-response");
        const endpoint = inquiryForm.dataset.endpoint;
        if (!endpoint) {
          console.error("No employer inquiry endpoint on form.");
          if (statusEl) statusEl.innerText = "❌ Missing endpoint.";
          return;
        }

        const payload = Object.fromEntries(new FormData(inquiryForm).entries());
        statusEl && (statusEl.innerText = "Sending…");

        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          await handleCommonErrors(res);

          const data = await res.json().catch(() => ({}));
          const ok = !!(data && (data.success || data.ok || data.status === "ok"));
          statusEl && (statusEl.innerText = ok ? "✅ Inquiry submitted!" : "❌ Submission failed.");
          if (ok) inquiryForm.reset();
        } catch (error) {
          console.error("Employer Inquiry Error:", error);
          statusEl && (statusEl.innerText = `❌ ${error.message || "Something went wrong."}`);
        }
      });
    }

    // 🤖 AI Job Post Generator Handler
    if (jobPostForm) {
      jobPostForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        const endpoint = jobPostForm.dataset.endpoint;
        if (!endpoint) {
          console.error("No job-post endpoint on form.");
          out.innerHTML = `<div class="ai-response">❌ Missing endpoint.</div>`;
          return;
        }

        const payload = Object.fromEntries(new FormData(jobPostForm).entries());
        out.innerHTML = "Generating…";
        hideDownloads();

        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          await handleCommonErrors(res);

          const data = await res.json().catch(() => ({}));
          const text = data?.description || data?.jobDescription || "";

          if (text) {
            const html = `<pre style="white-space:pre-wrap;margin:0">${escapeHtml(text)}</pre>`;
            renderJobDescription(html);

            stripWatermarks(output);
            if (!isPaid && !isSuperadmin) {
              applySparseWM(output, "JOBCUS.COM", {
                fontSize: 150,
                rotate: -30,
                count: (output.scrollHeight > 1400 ? 4 : 3)
              });
              output.classList.add("nocopy");
              enableNoCopyNoShot(output);
            }
          } else {
            out.innerHTML = `<div class="ai-response">No content returned.</div>`;
            hideDownloads();
          }
        } catch (err) {
          console.error("Job Post Error:", err);
          out.innerHTML = `<div class="ai-response">❌ ${escapeHtml(err.message || "Something went wrong.")}</div>`;
          hideDownloads();
        }
      });
    }
  });
})();
