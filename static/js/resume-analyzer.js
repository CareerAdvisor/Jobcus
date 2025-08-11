// Keep cookies for SameSite/Lax
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  const analyzeBtn         = document.getElementById("analyze-btn");
  const resumeText         = document.getElementById("resume-text");
  const resumeFile         = document.getElementById("resumeFile");
  const analyzingIndicator = document.getElementById("analyzingIndicator");
  const resultsWrap        = document.getElementById("analysisResults");
  const resultsSummary     = document.getElementById("analysisSummary");
  const rebuildBtn         = document.getElementById("rebuildButton");

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result.split(",")[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  async function sendAnalysis(file) {
    let payload, carriedText = "";

    if (!file && resumeText.value.trim()) {
      carriedText = resumeText.value.trim();
      payload = { text: carriedText };
    } else if (file) {
      const b64 = await fileToBase64(file);
      localStorage.setItem("resumeBase64", b64); // optional persistence
      if (file.type === "application/pdf") payload = { pdf: b64 };
      else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") payload = { docx: b64 };
      else return alert("Unsupported type. Upload PDF or DOCX.");
    } else {
      return alert("Paste text or upload a file.");
    }

    analyzingIndicator.style.display = "block";
    resultsWrap.style.display = "none";

    try {
      const res = await fetch("/api/resume-analysis", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || res.statusText);

      // Show a small summary
      const score = typeof data.score === "number" ? data.score : "—";
      const issues = (data.analysis?.issues || []).slice(0,5).map(i => `<li>${i}</li>`).join("");
      const strengths = (data.analysis?.strengths || []).slice(0,5).map(s => `<li>${s}</li>`).join("");
      const suggestions = (data.suggestions || []).slice(0,5).map(s => `<li>${s}</li>`).join("");

      resultsSummary.innerHTML = `
        <div><strong>Score:</strong> ${score}/100</div>
        ${issues ? `<div style="margin-top:8px;"><strong>Issues</strong><ul>${issues}</ul></div>` : ""}
        ${strengths ? `<div style="margin-top:8px;"><strong>Strengths</strong><ul>${strengths}</ul></div>` : ""}
        ${suggestions ? `<div style="margin-top:8px;"><strong>Suggestions</strong><ul>${suggestions}</ul></div>` : ""}
      `;
      resultsWrap.style.display = "block";

      // Carry pasted text into builder so we can prefill later (if available)
      if (carriedText) {
        localStorage.setItem("resumeTextRaw", carriedText);
      }
    } catch (err) {
      console.error("Analyzer error:", err);
      alert("Analysis failed. Try again.");
    } finally {
      analyzingIndicator.style.display = "none";
    }
  }

  analyzeBtn?.addEventListener("click", () => {
    const file = resumeFile.files[0] || null;
    sendAnalysis(file);
  });

  rebuildBtn?.addEventListener("click", () => {
    // Take user to builder. Builder will try to prefill from localStorage.resumeTextRaw
    window.location.href = "/resume-builder";
  });
});
