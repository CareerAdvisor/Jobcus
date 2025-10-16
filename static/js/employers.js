// /static/js/employers.js
(function () {
  "use strict";
  if (window.__JOBCUS_EMPLOYERS_INIT__) return;
  window.__JOBCUS_EMPLOYERS_INIT__ = true;

  document.addEventListener("DOMContentLoaded", function () {
    // Ensure fetch always includes same-origin cookies for auth-gated endpoints
    const _fetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      if (!("credentials" in init)) init.credentials = "same-origin";
      return _fetch(input, init);
    };

    // ───────────────────────────────────────────────
    // Utilities
    // ───────────────────────────────────────────────
    function escapeHtml(s = "") {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

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
        (root.querySelectorAll ? root.querySelectorAll("[data-watermark], [data-watermark-tile], .wm-tiled, [style*='background-image']") : [])
          .forEach(el => {
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
        if (count <= 2) points = [[0.22,0.30],[0.50,0.55],[0.78,0.80]];
        else points = [[0.28,0.30],[0.72,0.30],[0.28,0.72],[0.72,0.72]];

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
        window.upgradePrompt?.(html, url, 0); // show immediately, no redirect
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

    // ───────────────────────────────────────────────
    // Plan flags & DOM
    // ───────────────────────────────────────────────
    const plan         = (document.body.dataset.plan || "guest").toLowerCase();
    const isPaid       = (plan === "standard" || plan === "premium" || plan === "employer_jd" || plan === "employer");
    const isSuperadmin = (document.body.dataset.superadmin === "1");

    const inquiryForm     = document.getElementById("employer-inquiry-form");
    const jobPostForm     = document.getElementById("job-post-form");
    const output          = document.getElementById("job-description-output");
    const downloadOptions = document.getElementById("download-options");
    const dlPdfBtn        = document.getElementById("download-pdf");
    const dlDocxBtn       = document.getElementById("download-docx");
    const clearBtn        = document.getElementById("clear-jd"); // optional

    const wrap = document.getElementById("jobDescriptionWrap");
    const out  = output;

    // ───────────────────────────────────────────────
    // Skills suggest (unchanged)
    // ───────────────────────────────────────────────
    const suggestBtn  = document.getElementById("suggest-skills");
    const titleInput  = document.getElementById("jp-title");
    const suggestBox  = document.getElementById("skills-suggest-box");
    const skillsText  = document.getElementById("jp-skills");
    const skillsHidden= document.getElementById("jp-skills-hidden");
    const includeTaxo = document.getElementById("jp-include-taxonomy");

    function setSkillsValue(arr) {
      const val = arr.join(", ");
      if (skillsText) {
        skillsText.style.display = "block";
        skillsText.value = val;
      }
      if (skillsHidden) skillsHidden.value = val;
    }
    function getSkillsValue() {
      const raw = (skillsText?.value || skillsHidden?.value || "").trim();
      if (!raw) return [];
      return raw.split(",").map(s => s.trim()).filter(Boolean);
    }

    function renderChips(skills = []) {
      if (!suggestBox) return;
      suggestBox.innerHTML = "";
      const current = new Set(getSkillsValue().map(s => s.toLowerCase()));
      skills.forEach(skill => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip";
        btn.textContent = skill;
        btn.setAttribute("aria-pressed", current.has(skill.toLowerCase()) ? "true" : "false");
        btn.addEventListener("click", () => {
          const selected = getSkillsValue();
          const i = selected.findIndex(s => s.toLowerCase() === skill.toLowerCase());
          if (i === -1) selected.push(skill);
          else selected.splice(i, 1);
          setSkillsValue(selected);
          btn.setAttribute("aria-pressed", i === -1 ? "true" : "false");
        });
        suggestBox.appendChild(btn);
      });
    }

    function refreshSuggestState() {
      const ok = (titleInput?.value || "").trim().length >= 2;
      if (suggestBtn) {
        suggestBtn.disabled = !ok;
        suggestBtn.setAttribute("aria-disabled", String(!ok));
      }
    }
    titleInput?.addEventListener("input", refreshSuggestState);
    refreshSuggestState();

    suggestBtn?.addEventListener("click", async () => {
      if (suggestBtn.disabled) return;
      const jobTitle = (titleInput?.value || "").trim();
      if (!jobTitle) return;

      const original = suggestBtn.textContent;
      suggestBtn.textContent = "Suggesting…";
      suggestBtn.disabled = true;

      try {
        const body = { jobTitle };
        if (includeTaxo) body.includeTaxonomy = !!includeTaxo.checked;

        const res = await fetch("/api/employer/skills-suggest", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify(body)
        });
        await handleCommonErrors(res);
        const data = await res.json().catch(() => ({}));
        const skills = Array.isArray(data?.skills) ? data.skills : [];

        if (!skills.length) {
          window.showUpgradeBanner?.("No skills found for this title.");
        } else {
          renderChips(skills);
          if (getSkillsValue().length === 0) setSkillsValue(skills.slice(0, 5));
        }
      } catch (e) {
        console.error(e);
        window.showUpgradeBanner?.(e.message || "Could not suggest skills.");
      } finally {
        suggestBtn.textContent = original;
        refreshSuggestState();
      }
    });

    // ───────────────────────────────────────────────
    // Output + watermark + button states
    // ───────────────────────────────────────────────
    function renderJobDescription(html) {
      if (!out) return;
      out.innerHTML = html || "";
      if (wrap?.dataset?.watermark) wrap.classList.add("wm-active");
      downloadOptions?.classList.remove("hidden");
      if (downloadOptions) downloadOptions.style.display = "";
      // Enable buttons (remove attribute too so DevTools doesn't show 'disabled')
      dlPdfBtn?.removeAttribute("disabled");
      dlDocxBtn?.removeAttribute("disabled");
      if (dlPdfBtn) dlPdfBtn.disabled = false;
      if (dlDocxBtn) dlDocxBtn.disabled = false;
    }
    function clearJobDescription() {
      if (!out) return;
      out.textContent = "";
      wrap?.classList.remove("wm-active");
      downloadOptions?.classList.add("hidden");
    }

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
    }

    function hideDownloads() {
      downloadOptions?.classList.add("hidden");
      if (downloadOptions) downloadOptions.style.display = "none";
      if (dlPdfBtn) { dlPdfBtn.disabled = true; dlPdfBtn.setAttribute("disabled", ""); }
      if (dlDocxBtn){ dlDocxBtn.disabled = true; dlDocxBtn.setAttribute("disabled", ""); }

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

    // ───────────────────────────────────────────────
    // Lazy loader + client fallback (PDF/DOCX)
    // ───────────────────────────────────────────────
    async function loadScriptOnce(url, testReady) {
      if (testReady && testReady()) return;
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = url;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error("Failed to load " + url));
        document.head.appendChild(s);
      });
    }

    async function fallbackDownload(fmt) {
      const text = readOutputText();
      if (!text) { alert("Generate a job description first."); return; }

      if (fmt === "pdf") {
        if (!(window.jspdf && window.jspdf.jsPDF)) {
          await loadScriptOnce(
            "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
            () => !!(window.jspdf && window.jspdf.jsPDF)
          );
        }
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: "mm", format: "a4" });
        const lines = pdf.splitTextToSize(text, 180);
        let y = 10;
        for (const line of lines) {
          if (y > 280) { pdf.addPage(); y = 10; }
          pdf.text(line, 10, y);
          y += 7;
        }
        pdf.save("job-description.pdf");
        return;
      }

      if (fmt === "docx") {
        if (!window.docx) {
          await loadScriptOnce(
            "https://cdnjs.cloudflare.com/ajax/libs/docx/7.7.0/docx.umd.min.js",
            () => !!window.docx
          );
        }
        const { Document, Packer, Paragraph, TextRun } = window.docx;
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

    // ───────────────────────────────────────────────
    // Server-first download with graceful fallback
    // ───────────────────────────────────────────────
    async function downloadJD(fmt) {
      if (!["pdf", "docx"].includes(fmt)) { alert("Unsupported format."); return; }
      const text = readOutputText();
      if (!text) { alert("Generate a job description first."); return; }

      let res;
      try {
        res = await fetch("/api/employer/job-post/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ format: fmt, text })
        });

        // 403: paywall (show upgrade and stop)
        if (res.status === 403) {
          const info = await res.json().catch(() => ({}));
          const url  = info?.pricing_url || (window.PRICING_URL || "/pricing");
          const html = info?.message_html || `File downloads are available on the JD Generator and Premium plans. <a href="${url}">Upgrade now →</a>`;
          window.upgradePrompt?.(html, url, 0);
          return;
        }

        // 401 or redirect: force login
        if (res.status === 401 || res.redirected) {
          window.location.href = "/account?mode=login";
          return;
        }

        // 400: bad input → message, do NOT fallback
        if (res.status === 400) {
          const t = (await res.text()).toLowerCase();
          if (t.includes("no text")) {
            window.showUpgradeBanner?.("Please generate a job description first.");
          } else {
            window.showUpgradeBanner?.("Download failed.");
          }
          return;
        }

        // Any other non-OK (e.g., 500) → log + fallback
        if (!res.ok) {
          const msg = (await res.text()) || "Download failed.";
          console.warn("Server download failed:", msg);
          await fallbackDownload(fmt);
          return;
        }

        // Success → stream to file
        const blob = await res.blob();
        const a = document.createElement("a");
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = (fmt === "pdf" ? "job-description.pdf"
                  : fmt === "docx" ? "job-description.docx"
                  : "job-description.txt");
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("Server download error:", err);
        // Network or unexpected error → fallback
        await fallbackDownload(fmt);
      }
    }

    // Attach download handlers (outside of any function!)
    dlPdfBtn?.addEventListener("click",  () => downloadJD("pdf"));
    dlDocxBtn?.addEventListener("click", () => downloadJD("docx"));

    // Clear button (optional)
    clearBtn?.addEventListener("click", () => {
      clearJobDescription();
      hideDownloads();
      jobPostForm?.reset();
      if (suggestBox) suggestBox.innerHTML = "";
      setSkillsValue([]);
    });

    // ───────────────────────────────────────────────
    // Employer Inquiry Handler
    // ───────────────────────────────────────────────
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

    // ───────────────────────────────────────────────
    // AI Job Post Generator Handler
    // ───────────────────────────────────────────────
    if (jobPostForm) {
      jobPostForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        const endpoint = jobPostForm.dataset.endpoint;
        if (!endpoint) {
          console.error("No job-post endpoint on form.");
          out.innerHTML = `<div class="ai-response">❌ Missing endpoint.</div>`;
          return;
        }

        // Ensure selected skills & taxonomy flag are in the payload
        const fd = new FormData(jobPostForm);
        const selectedSkills = getSkillsValue();
        if (selectedSkills.length) fd.set("skills", selectedSkills.join(", "));
        if (includeTaxo) fd.set("includeTaxonomy", includeTaxo.checked ? "true" : "false");

        const payload = Object.fromEntries(fd.entries());
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

// === Upgrade modal (hard override; no auto-redirect) ===
window.upgradePrompt = function upgradePrompt(messageHtml, pricingUrl, delayMs = 0) {
  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Upgrade required");
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,.4);
    display: flex; align-items: center; justify-content: center;
    padding: 16px;
  `;

  const card = document.createElement("div");
  card.style.cssText = `
    max-width: 520px; width: 100%;
    background: #fff; color: #111; border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0,0,0,.15);
    padding: 20px;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, sans-serif;
  `;
  const pricing = pricingUrl || (window.PRICING_URL || "/pricing");
  const html = messageHtml || `You’ve reached your plan limit for this feature. <a href="${pricing}">Upgrade now →</a>`;

  card.innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-start">
      <div style="font-size:22px;line-height:1.1">🔓 Upgrade to continue</div>
    </div>
    <div style="margin-top:10px;font-size:14px;line-height:1.5">${html}</div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
      <a href="${pricing}" style="text-decoration:none; padding:10px 14px; border-radius:8px; border:1px solid #111;">View plans</a>
      <button type="button" id="upgrade-ok" style="padding:10px 14px;border-radius:8px;border:0;background:#111;color:#fff;">OK</button>
    </div>
  `;

  overlay.appendChild(card);

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    document.documentElement.style.overflow = prevOverflow;
  }
  function onKey(e) { if (e.key === "Escape") close(); }

  const prevOverflow = document.documentElement.style.overflow;

  function mount() {
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
    document.documentElement.style.overflow = "hidden";
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector("#upgrade-ok")?.addEventListener("click", close);
    overlay.querySelector("#upgrade-ok")?.focus();
  }

  setTimeout(mount, Math.max(0, delayMs || 0));
};

// Route any legacy "banner" calls to the same modal UX
window.showUpgradeBanner = function (msg) {
  const pricing = window.PRICING_URL || "/pricing";
  const esc = (s) => String(s || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  const html = `${esc(msg || "You’ve reached the current limit.")} <a href="${pricing}">Upgrade now →</a>`;
  window.upgradePrompt(html, pricing, 0);
};
