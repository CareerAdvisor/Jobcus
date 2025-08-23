<!-- static/js/resume-analyzer.js -->
<!-- keep this as the only script the page loads -->
// Keep cookies for SameSite/Lax
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  // ---------- shared helpers ----------
  function fileToBase64(file){
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result.split(",")[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }
  function formatSize(b){ return b<1024?`${b} B`:b<1048576?`${(b/1024).toFixed(1)} KB`:`${(b/1048576).toFixed(1)} MB`; }
  function incCount(){
    const n = parseInt(localStorage.getItem("analysisCount")||"0",10) + 1;
    localStorage.setItem("analysisCount", String(n));
  }

  // =========================================================
  // A) NEW dashboard-style uploader present on resume-builder
  //    (IDs: dropzone, dashResumeFile, dashAnalyzeBtn, etc.)
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

    // analyze then redirect to /dashboard
    dashAnalyzeBtn.addEventListener("click", async () => {
      const f = fileInput.files?.[0]; if(!f) return;
      analyzingEl && (analyzingEl.style.display = "inline");
      dashAnalyzeBtn.disabled = true;

      try {
        const b64  = await fileToBase64(f);
        const body = { jobDescription: jdInput?.value || "", jobRole: roleSelect?.value || "" };
        if (f.type === "application/pdf") body.pdf = b64;
        else if (f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") body.docx = b64;
        else { alert("Upload a PDF or DOCX file."); analyzingEl && (analyzingEl.style.display="none"); dashAnalyzeBtn.disabled=false; return; }

        const res  = await fetch("/api/resume-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        // read as text first so 500 HTML doesn't crash JSON.parse
        const text = await res.text();
        if (!res.ok) { console.error("Resume analysis failed:", text); alert("Resume analysis failed. Please try again."); return; }

        let data;
        try { data = JSON.parse(text); }
        catch { console.error("Invalid JSON from /api/resume-analysis:", text); alert("Unexpected server response."); return; }

        // persist for dashboard + optimize
        localStorage.setItem("resumeAnalysis", JSON.stringify(data));
        localStorage.setItem("resumeBase64", b64);
        localStorage.setItem("resumeKind", f.type);

        // free-usage counter
        incCount();

        // show results on dashboard
        window.location.href = "/dashboard";
      } catch (err) {
        console.error(err);
        alert("Analysis failed. Please try again.");
      } finally {
        analyzingEl && (analyzingEl.style.display = "none");
      }
    });

    // stop here; we don't want to bind the legacy UI below
    return;
  }

  // ===========================================
  // B) Legacy analyzer UI still on the page
  //    (IDs: analyze-btn, resume-text, resumeFile)
  // ===========================================
  const analyzeBtn         = document.getElementById("analyze-btn");
  const resumeText         = document.getElementById("resume-text");
  const resumeFile         = document.getElementById("resumeFile");
  const analyzingIndicator = document.getElementById("analyzingIndicator");
  const resultsWrap        = document.getElementById("analysisResults");
  const resultsSummary     = document.getElementById("analysisSummary");
  const rebuildBtn         = document.getElementById("rebuildButton");

  if (analyzeBtn) {
    async function sendAnalysis(file) {
      let payload, carriedText = "";

      if (!file && resumeText?.value?.trim()) {
        carriedText = resumeText.value.trim();
        payload = { text: carriedText };
      } else if (file) {
        const b64 = await fileToBase64(file);
        localStorage.setItem("resumeBase64", b64);
        if (file.type === "application/pdf") payload = { pdf: b64 };
        else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") payload = { docx: b64 };
        else return alert("Unsupported type. Upload PDF or DOCX.");
      } else {
        return alert("Paste text or upload a file.");
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
        if (!res.ok) { console.error("Resume analysis failed:", text); alert("Analysis failed. Try again."); return; }

        let data; try { data = JSON.parse(text); } catch { console.error(text); alert("Unexpected server response."); return; }

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

    analyzeBtn.addEventListener("click", () => {
      const file = resumeFile?.files?.[0] || null;
      sendAnalysis(file);
    });

    document.getElementById("rebuildButton")?.addEventListener("click", () => {
      window.location.href = "/resume-builder";
    });
  }
});

// --- Cover letter handoff (kept from your original file) ---
(function(){
  function guessNameFromText(txt="") {
    const firstLine = (txt.split(/\r?\n/).find(Boolean) || "").trim();
    if (firstLine && /\b[A-Za-z]+(?:\s+[A-Za-z\.\-']+){1,3}\b/.test(firstLine)) return firstLine;
    return "";
  }
  function toContactLine(txt=""){ return ""; }

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
