// /static/js/resume-analyzer.js

// Keep cookies for SameSite/Lax on all fetches
(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

/* ---------- QUICK FORM-DATA FLOW (optional page variant) ---------- */
/* Binds to:
 *   - Button:  #analyzeBtn
 *   - Form:    #resumeForm (contains file/text fields)
 * Calls /api/resume-analysis with FormData and guards 401.
 */
(function(){
  const analyzeBtn = document.getElementById('analyzeBtn');
  if (!analyzeBtn) return;

  analyzeBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    const form = document.getElementById('resumeForm'); // adjust to your form id if different
    if (!form) { console.error('resumeForm not found'); return; }
    const formData = new FormData(form);

    if (!resp.ok) {
      const text = await resp.text();
      let data = null; try { data = JSON.parse(text); } catch {}
    
      if (resp.status === 402) {
        const url  = data?.pricing_url || (window.PRICING_URL || "/pricing");
        const msg  = data?.message || "You’ve reached your plan limit for this feature.";
        const html = data?.message_html || `${msg} <a href="${url}">Upgrade now →</a>`;
        window.upgradePrompt(html, url, 1200);
        return;
      }
      if (resp.status === 401) {
        window.location = '/account?next=' + encodeURIComponent(location.pathname);
        return;
      }
      console.error('resume-analysis failed', resp.status, text);
      window.showUpgradeBanner?.(data?.message || data?.error || "Resume analysis failed.");
      return;
    }

    const data = await resp.json();
    try {
      // Expect a page-defined renderer
      renderAnalysis?.(data);
    } catch (err) {
      console.error('renderAnalysis failed or missing:', err);
    }
  });
})();

/* ---------- Role <datalist> loader with small cache ---------- */
async function initRoleDatalist() {
  const input = document.getElementById("dashRoleSelect");
  const dl    = document.getElementById("roleList");
  if (!input || !dl) return;

  try {
    const cached = sessionStorage.getItem("jobcus:roles");
    let roles;
    if (cached) {
      roles = JSON.parse(cached);
    } else {
      const res = await fetch("/static/data/roles.json", { credentials: "same-origin" });
      roles = await res.json();
      sessionStorage.setItem("jobcus:roles", JSON.stringify(roles));
    }

    const seen = new Set();
    roles
      .filter(r => r && typeof r === "string")
      .map(r => r.trim())
      .filter(r => r && !seen.has(r) && seen.add(r))
      .sort((a,b) => a.localeCompare(b))
      .forEach(role => {
        const opt = document.createElement("option");
        opt.value = role;
        dl.appendChild(opt);
      });
  } catch (e) {
    console.warn("Could not load roles.json; using a small fallback list.", e);
    [
      "Business Analyst","Azure Architect","Animator",
      "IT Support Specialist","Systems Administrator","Network Engineer",
      "Product Manager","Software Engineer","Project Manager","UI/UX Designer",
      "QA Engineer","Data Analyst","Data Scientist","DevOps Engineer"
    ].forEach(role => {
      const opt = document.createElement("option");
      opt.value = role;
      dl.appendChild(opt);
    });
  }
}
document.addEventListener("DOMContentLoaded", initRoleDatalist);

/* ----------------------------- Main logic ----------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  // ---------- shared helpers ----------
  function fileToBase64(file){
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => {
        const s = String(fr.result || "");
        const idx = s.indexOf(",");
        resolve(idx >= 0 ? s.slice(idx+1) : s);
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }
  function formatSize(b){ return b<1024?`${b} B`:b<1048576?`${(b/1024).toFixed(1)} KB`:`${(b/1048576).toFixed(1)} MB`; }
  function incCount(){
    const n = parseInt(localStorage.getItem("analysisCount")||"0",10) + 1;
    localStorage.setItem("analysisCount", String(n));
  }
  function showInlineBanner(container, msg, kind="warn"){
    if (!container) { alert(msg); return; }
    let b = container.querySelector(".inline-banner");
    if (!b) {
      b = document.createElement("div");
      b.className = "inline-banner";
      b.style.cssText = "margin-top:10px;padding:10px 12px;border-radius:6px;font-size:14px;";
      container.appendChild(b);
    }
    b.style.background = kind === "error" ? "#fdecea" : "#fff3cd";
    b.style.color      = kind === "error" ? "#611a15" : "#856404";
    b.style.border     = kind === "error" ? "1px solid #f5c2c7" : "1px solid #ffeeba";
    b.textContent = msg;
  }
  // mirror the chat page UX text when limits hit
  function showUpgradeBanner(msg, container){
    showInlineBanner(container || document.querySelector(".upload-card"), msg || "You have reached the limit for the free version, upgrade to enjoy more features");
  }
  function isDocx(file){
    return file && (
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      /\.docx$/i.test(file.name || "")
    );
  }
  function isPdf(file){
    return file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""));
  }
  async function parseJsonSafe(res, text){
    try { return JSON.parse(text); } catch { return null; }
  }

  // =========================================================
  // A) Dashboard-style uploader (preferred)
  // =========================================================
  const dashAnalyzeBtn = document.getElementById("dashAnalyzeBtn");
  if (dashAnalyzeBtn) {
    const dropzone    = document.getElementById("dropzone");
    const fileInput   = document.getElementById("dashResumeFile");
    const fileNameEl  = document.getElementById("fileName");
    const jdInput     = document.getElementById("dashJobDesc");
    const roleSelect  = document.getElementById("dashRoleSelect");
    const analyzingEl = document.getElementById("dashAnalyzing");

    function showFileName(f){
      if (!fileNameEl) return;
      fileNameEl.textContent = f ? `Selected: ${f.name} (${formatSize(f.size)})` : "";
    }

    // dropzone behavior
    function openPicker(){ fileInput?.click(); }
    dropzone?.addEventListener("click", openPicker);
    dropzone?.addEventListener("keydown", (e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openPicker(); }});
    dropzone?.addEventListener("dragover",(e)=>{ e.preventDefault(); dropzone.classList.add("is-drag"); });
    dropzone?.addEventListener("dragleave",()=> dropzone.classList.remove("is-drag"));
    dropzone?.addEventListener("drop",(e)=>{
      e.preventDefault(); dropzone.classList.remove("is-drag");
      const f = e.dataTransfer.files?.[0]; if(!f) return;
      fileInput.files = e.dataTransfer.files; dashAnalyzeBtn.disabled = false; showFileName(f);
    });
    fileInput?.addEventListener("change",()=>{
      const f = fileInput.files?.[0]; dashAnalyzeBtn.disabled = !f; showFileName(f||null);
    });

    dashAnalyzeBtn.addEventListener("click", async () => {
      const f = fileInput.files?.[0]; if(!f) return;
      const card = dashAnalyzeBtn.closest(".upload-card");
      analyzingEl && (analyzingEl.style.display = "inline");
      dashAnalyzeBtn.disabled = true;

      try {
        if (!isPdf(f) && !isDocx(f)) {
          showInlineBanner(card, "Upload a PDF or DOCX file.", "error");
          return;
        }

        const b64  = await fileToBase64(f);
        const body = {
          jobDescription: jdInput?.value || "",
          jobRole: roleSelect?.value || ""
        };
        if (isPdf(f)) body.pdf = b64;
        else if (isDocx(f)) body.docx = b64;

        const res  = await fetch("/api/resume-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        const text = await res.text();

       // helper (put near the top of the file once)
      function escapeHtml(s=""){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
        .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
      
      // … inside the click handler, after reading `text`:
      let data = null;
      try { data = JSON.parse(text); } catch {}
      
      if (res.status === 402) {
        const msgText = data?.message || "You’ve reached your plan limit for this feature.";
        const pricing = data?.pricing_url || "/pricing";
        const msgHtml = data?.message_html || `${escapeHtml(msgText)} <a href="${pricing}">Upgrade now →</a>`;
      
        window.showUpgradeBanner?.(msgHtml);  // sticky banner (clickable)
        alert(msgText);                        // keep the legacy alert
      
        // Inline (card) banner stays plain text, then append a link element
        showInlineBanner(card, msgText, "warn");
        const b = card?.querySelector(".inline-banner");
        if (b) {
          const a = document.createElement("a");
          a.href = pricing;
          a.textContent = " Upgrade now →";
          a.style.marginLeft = "8px";
          a.style.textDecoration = "underline";
          a.style.color = "#664d03";
          b.appendChild(a);
        }
        return;
      }

        // ⇧⇧⇧ END INSERT ⇧⇧⇧

        // Handle device/IP abuse guard from backend (429)
        if (res.status === 429) {
          window.showUpgradeBanner?.(
            data?.message || 'You have reached the limit for the free version, upgrade to enjoy more features'
          );
          showInlineBanner(
            card,
            data?.message || 'You have reached the limit for the free version, upgrade to enjoy more features',
            "warn"
          );
          return;
        }

        // CHANGE: prefer message over error when failing
        if (!res.ok) {
          const msg = (data?.message || data?.error) || "Resume analysis failed. Please try again.";
          console.error("Resume analysis failed:", text);
          showInlineBanner(card, msg, "error");
          return;
        }

        if (!data) {
          console.error("Invalid JSON from /api/resume-analysis:", text);
          showInlineBanner(card, "Unexpected server response.", "error");
          return;
        }

        // persist for dashboard + optimize
        localStorage.setItem("resumeAnalysis", JSON.stringify(data));
        localStorage.setItem("resumeBase64", b64);
        localStorage.setItem("resumeKind", isPdf(f) ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

        incCount();
        window.location.href = "/dashboard";
      } catch (err) {
        console.error(err);
        showInlineBanner(dashAnalyzeBtn.closest(".upload-card"), "Analysis failed. Please try again.", "error");
      } finally {
        analyzingEl && (analyzingEl.style.display = "none");
        dashAnalyzeBtn.disabled = false;
      }
    });

    // stop here; we don't want to bind the legacy UI below
    return;
  }

  // ===========================================
  // B) Legacy analyzer UI (still supported)
  // ===========================================
  const analyzeBtnLegacy   = document.getElementById("analyze-btn");
  const resumeText         = document.getElementById("resume-text");
  const resumeFile         = document.getElementById("resumeFile");
  const analyzingIndicator = document.getElementById("analyzingIndicator");
  const resultsWrap        = document.getElementById("analysisResults");
  const resultsSummary     = document.getElementById("analysisSummary");

  if (analyzeBtnLegacy) {
    async function sendAnalysis(file) {
      let payload, carriedText = "";

      if (!file && resumeText?.value?.trim()) {
        carriedText = resumeText.value.trim();
        payload = { text: carriedText };
      } else if (file) {
        if (!isPdf(file) && !isDocx(file)) { alert("Unsupported type. Upload PDF or DOCX."); return; }
        const b64 = await fileToBase64(file);
        localStorage.setItem("resumeBase64", b64);
        payload = isPdf(file) ? { pdf: b64 } : { docx: b64 };
      } else {
        alert("Paste text or upload a file.");
        return;
      }

      analyzingIndicator && (analyzingIndicator.style.display = "block");
      resultsWrap && (resultsWrap.style.display = "none");

      try {
        const res = await fetch("/api/resume-analysis", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(payload)
        });

        const text = await res.text();
        let data   = await parseJsonSafe(res, text);

        if (res.status === 401 || res.status === 403) {
          alert("Please sign in to analyze resumes.");
          window.location.href = "/account?mode=login";
          return;
        }

        // ⇩⇩⇩ INSERTED: 402 ➜ banner + alert + return ⇩⇩⇩
        if (res.status === 402) {
          const msg = (data?.message || "You’ve reached your plan limit for this feature.");
          window.showUpgradeBanner?.(msg);
          alert(msg);
          return;
        }
        // ⇧⇧⇧ END INSERT ⇧⇧⇧

        if (res.status === 429 && (data?.error === "too_many_free_accounts" || data?.error === "quota_exceeded")) {
          alert("You have reached the limit for the free version, upgrade to enjoy more features");
          return;
        }
        if (!res.ok) {
          const msg = (data?.message || data?.error) || "Analysis failed. Try again.";
          console.error("Resume analysis failed:", text);
          alert(msg);
          return;
        }
        if (!data) { console.error(text); alert("Unexpected server response."); return; }

        // basic summary on-page
        const score = typeof data.score === "number" ? data.score : "—";
        const issues = (data.analysis?.issues || []).slice(0,5).map(i => `<li>${i}</li>`).join("");
        const strengths = (data.analysis?.strengths || []).slice(0,5).map(s => `<li>${s}</li>`).join("");
        const suggestions = (data.suggestions || []).slice(0,5).map(s => `<li>${s}</li>`).join("");

        resultsSummary && (resultsSummary.innerHTML = `
          <div><strong>Score:</strong> ${score}/100</div>
          ${issues ? `<div style="margin-top:8px;"><strong>Issues</strong><ul>${issues}</ul></div>` : ""}
          ${strengths ? `<div style="margin-top:8px;"><strong>Strengths</strong><ul>${strengths}</ul></div>` : ""}
          ${suggestions ? `<div style="margin-top:8px;"><strong>Suggestions</strong><ul>${suggestions}</ul></div>` : ""}
        `);
        resultsWrap && (resultsWrap.style.display = "block");

        if (carriedText) localStorage.setItem("resumeTextRaw", carriedText);
        incCount();
      } catch (err) {
        console.error("Analyzer error:", err);
        alert("Analysis failed. Try again.");
      } finally {
        analyzingIndicator && (analyzingIndicator.style.display = "none");
      }
    }

    analyzeBtnLegacy.addEventListener("click", () => {
      const file = resumeFile?.files?.[0] || null;
      sendAnalysis(file);
    });

    document.getElementById("rebuildButton")?.addEventListener("click", () => {
      window.location.href = "/resume-builder";
    });
  }
});

/* --- Cover letter handoff (unchanged logic, hardened) --- */
(function(){
  function guessNameFromText(txt="") {
    const firstLine = (txt.split(/\r?\n/).find(Boolean) || "").trim();
    if (firstLine && /\b[A-Za-z]+(?:\s+[A-Za-z\.\-']+){1,3}\b/.test(firstLine)) return firstLine;
    return "";
  }
  function toContactLine(){ return ""; }

  const openCLBtn = document.getElementById("openCoverLetter");
  if (!openCLBtn) return;

  openCLBtn.addEventListener("click", () => {
    try {
      const raw = document.getElementById("resume-text")?.value?.trim() || "";
      let firstName="", lastName="";
      const fullName = guessNameFromText(raw);
      if (fullName) {
        const parts = fullName.split(/\s+/);
        firstName = parts.shift() || "";
        lastName  = parts.join(" ");
      }
      const seed = { firstName, lastName, contact: toContactLine(raw), role: "", company: "" };
      localStorage.setItem("coverLetterSeed", JSON.stringify(seed));
    } catch (e) {
      console.warn("CL seed not set:", e);
    }
    window.location.href = "/cover-letter";
  });
})();
