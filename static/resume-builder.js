// static/resume-builder.js

// — Ensure fetch() sends your session cookie —
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || 'same-origin';
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  console.log("🚀 resume-builder.js loaded");

  // Grab all the elements we need
  const analyzeBtn         = document.getElementById("analyze-btn");
  const resumeText         = document.getElementById("resume-text");
  const resumeFile         = document.getElementById("resumeFile");
  const analyzerResult     = document.getElementById("analyzer-result");
  const scoreBar           = document.getElementById("score-bar");
  const keywordList        = document.getElementById("keyword-list");
  const postAnalysisCTA    = document.getElementById("post-analysis-cta");
  const optimizeBtn        = document.getElementById("optimizeResume");
  const optimizedLoading   = document.getElementById("optimizedLoading");
  const optimizedOutput    = document.getElementById("analyzerResumeOutput");
  const optimizedDownloads = document.getElementById("optimizedDownloadOptions");

  // Utility to render an array of strings into a <ul>
  function renderList(container, items) {
    container.innerHTML = "";
    (items || []).forEach(i => {
      const li = document.createElement("li");
      li.textContent = i;
      container.appendChild(li);
    });
  }

  // Animate the score bar from 0 → target
  function animateScore(to) {
    let current = 0;
    scoreBar.style.width = "0%";
    scoreBar.innerText = "0%";
    const step = to > 0 ? 1 : -1;
    const iv = setInterval(() => {
      if (current === to) return clearInterval(iv);
      current += step;
      scoreBar.style.width = `${current}%`;
      scoreBar.innerText   = `${current}%`;
    }, 15);
  }

  // Kick off the analysis
  async function sendAnalysis(file) {
    const textInput = resumeText.value.trim();
    if (!file && !textInput) {
      alert("Please paste text or upload a file.");
      return;
    }

    // Show a loading spinner
    analyzerResult.innerHTML = "<p>⏳ Analyzing your resume…</p>";
    if (postAnalysisCTA) postAnalysisCTA.style.display = "none";
    optimizedOutput.style.display = "none";
    optimizedDownloads.style.display = "none";

    let fileBase64 = null;

    // If a file is provided, read it as Base64
    if (file) {
      fileBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const b64 = reader.result.split(",")[1];
          if (!b64) reject("Failed to read file");
          else resolve(b64);
        };
        reader.onerror = () => reject("Error reading file");
        reader.readAsDataURL(file);
      }).catch(err => {
        analyzerResult.innerHTML = `<p style="color:red;">${err}</p>`;
        return null;
      });

      if (!fileBase64) return;
    }

    try {
      const res = await fetch("/api/resume/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: fileBase64, text: textInput })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");

      // ✅ Update the UI
      analyzerResult.innerHTML = `<p>${data.summary || "Analysis complete!"}</p>`;
      animateScore(data.score || 0);
      if (data.keywords) renderList(keywordList, data.keywords);
      if (postAnalysisCTA) postAnalysisCTA.style.display = "block";

    } catch (err) {
      analyzerResult.innerHTML = `<p style='color:red;'>Error: ${err.message}</p>`;
    }
  }

  // Resume Optimization
  async function optimizeResume() {
    optimizedLoading.style.display = "block";
    optimizedOutput.style.display = "none";
    optimizedDownloads.style.display = "none";

    try {
      const res = await fetch("/api/resume/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: resumeText.value.trim() })
      });

      const data = await res.json();
      optimizedLoading.style.display = "none";

      if (!res.ok) throw new Error(data.error || "Optimization failed");

      optimizedOutput.style.display = "block";
      optimizedOutput.innerHTML = `<pre>${data.optimized}</pre>`;
      optimizedDownloads.style.display = "block";

    } catch (err) {
      optimizedLoading.style.display = "none";
      optimizedOutput.style.display = "block";
      optimizedOutput.innerHTML = `<p style='color:red;'>Error: ${err.message}</p>`;
    }
  }

  // Bind event listeners
  analyzeBtn?.addEventListener("click", () => {
    const file = resumeFile.files[0];
    sendAnalysis(file);
  });

  optimizeBtn?.addEventListener("click", optimizeResume);
});
