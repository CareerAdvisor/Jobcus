// static/resume-builder.js

// — ensure cookies are included on every fetch() —
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!('credentials' in init)) init.credentials = 'same-origin';
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  const analyzeBtn         = document.getElementById("analyze-btn");
  const resumeText         = document.getElementById("resume-text");
  const resumeFile         = document.getElementById("resumeFile");
  const analyzingIndicator = document.getElementById("analyzingIndicator");

  if (!analyzeBtn) {
    console.warn("[resume-builder] No #analyze-btn found, skipping setup.");
    return;
  }

  // Helper: File → Base64
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result.split(",")[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  // 1) turn file or pasted text into base64,
  // 2) call the API, 
  // 3) stash result + redirect
  async function sendAnalysis(file) {
    if (!file) {
      alert("Please paste your resume or upload a file.");
      return;
    }
    if (analyzingIndicator) analyzingIndicator.style.display = "block";

    try {
      const b64 = await fileToBase64(file);
      const res = await fetch("/api/resume-analysis", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ pdf: b64 })
      });
      if (!res.ok) throw new Error("Server returned " + res.status);

      const data = await res.json();
      if (data.error) {
        alert("Error analyzing resume: " + data.error);
        if (analyzingIndicator) analyzingIndicator.style.display = "none";
        return;
      }

      // ✅ Save & redirect
      localStorage.setItem("resumeAnalysis", JSON.stringify(data));
      window.location.href = "/dashboard";

    } catch (err) {
      console.error("Analyzer error:", err);
      alert("Could not analyze resume. Please try again.");
      if (analyzingIndicator) analyzingIndicator.style.display = "none";
    }
  }

  analyzeBtn.addEventListener("click", () => {
    const file = resumeFile.files[0]
               || new File([resumeText.value], "resume.txt", { type: "text/plain" });
    sendAnalysis(file);
  });
});
