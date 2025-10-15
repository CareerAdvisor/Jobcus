// /static/js/resume-analyzer.js
(function () {
  "use strict";

  /* =================== Always send cookies (SameSite=Lax) =================== */
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  /* ======================== Pricing URL (robust) ======================== */
  const PRICING_URL = (() => {
    if (window.PRICING_URL) return window.PRICING_URL;
    const a = document.querySelector('a[href$="pricing.html"], a[href="/pricing"], a[href*="/pricing"]');
    return a?.getAttribute("href") || "/pricing.html";
  })();

  /* ================= Upgrade Modal (pop-up, no redirects) ================= */
  function showUpgradeModal(message) {
    // remove any existing first
    try { document.getElementById("upgrade-modal-overlay")?.remove(); } catch {}

    const overlay = document.createElement("div");
    overlay.id = "upgrade-modal-overlay";
    overlay.style.cssText = [
      "position:fixed","inset:0","z-index:2147483647",
      "background:rgba(0,0,0,.45)","display:flex",
      "align-items:center","justify-content:center","padding:24px"
    ].join(";");

    const card = document.createElement("div");
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-modal", "true");
    card.style.cssText = [
      "max-width:520px","width:100%","background:#fff","border-radius:12px",
      "box-shadow:0 12px 40px rgba(0,0,0,.25)","padding:20px","border:1px solid #e5e7eb",
      "font:14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    ].join(";");

    const msgHtml = (message || "You’ve reached your plan limit. Upgrade to continue.").toString();
    const url = PRICING_URL;

    card.innerHTML = `
      <div style="display:flex;gap:12px;align-items:flex-start;">
        <div style="flex:1;min-width:0;">
          <h3 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#111827">Upgrade required</h3>
          <div style="color:#374151;">${String(msgHtml).replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
        <a href="${url}" class="btn-upgrade" style="padding:8px 14px;border-radius:8px;background:#111827;color:#fff;text-decoration:none;font-weight:600">Upgrade</a>
        <button type="button" id="upgrade-modal-dismiss" style="padding:8px 14px;border-radius:8px;border:1px solid #d1d5db;background:#fff;color:#111827;">Not now</button>
      </div>
    `;

    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    card.querySelector("#upgrade-modal-dismiss")?.addEventListener("click", () => overlay.remove());

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // keep compatibility with any legacy calls
    if (!window.showUpgradeBanner) window.showUpgradeBanner = (m) => showUpgradeModal(m);
  }

  // ensure the modal never blocks picking files
  function __ensureNoModalBeforePicking() {
    try { document.getElementById("upgrade-modal-overlay")?.remove(); } catch {}
  }

  /* ============================ Small helpers ============================ */
  const escapeHtml = (s = "") =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  async function handleCommonErrors(res) {
    if (res.ok) return null;
    const ct = (res.headers?.get?.("content-type") || "").toLowerCase();
    let js=null, tx="";
    try { if (ct.includes("application/json")) js = await res.json(); else tx = await res.text(); } catch {}
    const msg = (js?.message || js?.error || tx || `Request failed (${res.status})`);

    // Upgrade / quota → modal (no redirect)
    if (res.status === 402 || js?.error === "upgrade_required" || js?.error === "quota_exceeded") {
      const url  = js?.pricing_url || PRICING_URL;
      const html = js?.message_html || `You’ve reached your plan limit. <a href="${url}">Upgrade now →</a>`;
      showUpgradeModal(html);
      throw new Error(js?.message || "Upgrade required");
    }
    // Auth → modal (no redirect)
    if (res.status === 401 || res.status === 403) {
      showUpgradeModal(js?.message || "Please log in to use this feature.");
      throw new Error(js?.message || "Auth required");
    }
    // Abuse / rate
    if (res.status === 429) {
      showUpgradeModal(js?.message || "You are rate limited right now.");
      throw new Error(js?.message || "Rate limited");
    }
    // Generic
    throw new Error(msg);
  }

  /* ============================ Main wiring ============================= */
  document.addEventListener("DOMContentLoaded", () => {
    // Elements (support multiple common IDs/classes)
    const dropzone   = document.getElementById("raDropzone")
                    || document.querySelector(".ra-dropzone, #dropzone, #resumeDrop, .resume-dropzone");
    const fileInput  = document.getElementById("raFile")
                    || document.querySelector('input[type="file"][name="resume"], #resumeFile, #file, input[type="file"]');
    const pickBtn    = document.getElementById("raPickBtn")
                    || document.querySelector('[data-action="pick-resume"], .pick-resume-btn, #attachResume');
    const fileNameEl = document.getElementById("raFileName")
                    || document.querySelector("#fileName, .file-name, [data-role='file-name']");
    const analyzeBtn = document.getElementById("raAnalyzeBtn")
                    || document.querySelector("#analyzeBtn, #analyze, .analyze-btn");
    const analyzingEl = document.getElementById("raAnalyzing")
                    || document.querySelector("#analyzing, .analyzing");
    const jobDescEl  = document.getElementById("raJobDesc")
                    || document.querySelector("#dashJobDesc, #jobDesc, textarea[name='job_description']");
    const roleEl     = document.getElementById("raRoleSelect")
                    || document.querySelector("#dashRoleSelect, #role, input[name='role']");

    // Route legacy helpers to modal (kills old redirects)
    window.upgradePrompt = function (msgHtml) { try { showUpgradeModal(msgHtml); } catch { alert("Upgrade required."); } };
    if (!window.showUpgradeBanner) window.showUpgradeBanner = (m) => showUpgradeModal(m);

    if (fileInput) {
      fileInput.setAttribute(
        "accept",
        ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
    }

    function showFileName(f) {
      if (!fileNameEl) return;
      fileNameEl.textContent = f ? `Selected: ${f.name} (${formatSize(f.size)})` : "";
    }

    function onPicked() {
      const f = fileInput?.files?.[0];
      showFileName(f || null);
      if (analyzeBtn) analyzeBtn.disabled = !f;
    }

    function openPicker() {
      __ensureNoModalBeforePicking();
      try { fileInput?.click(); } catch {}
    }

    // Click, keyboard
    pickBtn?.addEventListener("click", (e) => { e.preventDefault(); openPicker(); });
    dropzone?.addEventListener("click", (e) => {
      if (e.currentTarget === e.target) { e.preventDefault(); openPicker(); }
    });
    dropzone?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
    });

    // Drag & drop
    dropzone?.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("is-drag"); });
    dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("is-drag"));
    dropzone?.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("is-drag");
      const f = e.dataTransfer?.files?.[0];
      if (!f || !fileInput) return;
      try { const dt = new DataTransfer(); dt.items.add(f); fileInput.files = dt.files; }
      catch { fileInput.files = e.dataTransfer.files; }
      onPicked();
    });

    // Native selection
    fileInput?.addEventListener("change", onPicked);

    // ========== Submit for analysis ==========
    async function sendForAnalysis(file) {
      if (!file) throw new Error("No file selected.");
      if (analyzingEl) analyzingEl.style.display = "inline";
      if (analyzeBtn) analyzeBtn.disabled = true;

      // Gather optional context
      const jobDescription = jobDescEl?.value || "";
      const jobRole        = roleEl?.value || "";

      // Try JSON (base64) first
      const tryJson = async () => {
        const b64 = await fileToBase64(file);
        const body = { jobDescription, jobRole };
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")) {
          body.pdf = b64;
        } else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(file.name || "")) {
          body.docx = b64;
        } else {
          throw new Error("Unsupported file type. Upload PDF or DOCX.");
        }

        const res = await fetch("/api/resume-analysis", {
          method: "POST",
          headers: { "Content-Type":"application/json" },
          body: JSON.stringify(body),
          credentials: "same-origin"
        });
        await handleCommonErrors(res);
        return res.json().catch(() => ({}));
      };

      // Fallback: real multipart upload (server may expect file field)
      const tryMultipart = async () => {
        const fd = new FormData();
        fd.append("file", file, file.name);
        if (jobDescription) fd.append("jobDescription", jobDescription);
        if (jobRole)        fd.append("jobRole", jobRole);

        const res = await fetch("/api/resume-analysis", {
          method: "POST",
          body: fd,
          credentials: "same-origin"
        });
        await handleCommonErrors(res);
        return res.json().catch(() => ({}));
      };

      let data = null;
      try {
        data = await tryJson();
        if (!data || (typeof data !== "object")) throw new Error("Unexpected response.");
      } catch (e1) {
        const msg = String(e1?.message || "");
        if (/unsupported|content[- ]?type|unexpected|415|bad request|invalid/i.test(msg)) {
          data = await tryMultipart();
        } else {
          throw e1;
        }
      }

      // Persist + optional notify host page
      try {
        const when = new Date().toLocaleString();
        data = data || {};
        data.lastAnalyzed = when;
        localStorage.setItem("resumeAnalysis", JSON.stringify(data));

        const resultObject = {
          score: Number(data.score || 0),
          breakdown: {
            formatting:  data?.breakdown?.formatting ?? null,
            sections:    data?.breakdown?.sections ?? null,
            keywords:    data?.breakdown?.keywords ?? null,
            readability: data?.breakdown?.readability ?? null,
            length:      data?.breakdown?.length ?? null,
            parseable:   data?.breakdown?.parseable ?? null
          },
          fixes: Array.isArray(data?.analysis?.issues) ? data.analysis.issues : [],
          lastAnalyzed: when
        };
        localStorage.setItem("resume_latest", JSON.stringify(resultObject));
      } catch {}

      return data;
    }

    async function onAnalyze() {
      const f = fileInput?.files?.[0];
      if (!f) { alert("Please attach a PDF or DOCX resume first."); return; }
      try {
        const data = await sendForAnalysis(f);
        if (window.renderResumeAnalysis) {
          try { window.renderResumeAnalysis(data); } catch {}
        }
        try { document.getElementById("resume-score-card")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
      } catch (err) {
        console.error("[resume-analyzer] analyze failed:", err);
        const msg = err?.message || "Analysis failed. Please try again.";
        try { showUpgradeModal(msg); } catch { alert(msg); }
      } finally {
        if (analyzingEl) analyzingEl.style.display = "none";
        if (analyzeBtn) analyzeBtn.disabled = false;
      }
    }

    analyzeBtn?.addEventListener("click", (e) => { e.preventDefault(); onAnalyze(); });
  });
})();
