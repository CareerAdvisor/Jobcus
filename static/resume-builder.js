// static/resume-builder.js

// — Ensure fetch() sends your session cookie —
;(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || "same-origin";
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  console.log("🚀 resume-builder.js loaded");

  // Grab all the elements we need
  const analyzeBtn = document.getElementById("analyze-btn");
  const resumeText = document.getElementById("resume-text");
  const resumeFile = document.getElementById("resumeFile");
  const analyzerResult = document.getElementById("analyzer-result");
  const scoreBar = document.getElementById("score-bar");
  const keywordList = document.getElementById("keyword-list");
  const postAnalysisCTA = document.getElementById("post-analysis-cta");
  const optimizeBtn = document.getElementById("optimizeResume");
  const optimizedLoading = document.getElementById("optimizedLoading");
  const optimizedOutput = document.getElementById("analyzerResumeOutput");
  const optimizedDownloads = document.getElementById("optimizedDownloadOptions");

  // Utility to render an array of strings into a <ul>
  function renderList(container, items) {
    container.innerHTML = "";
    items.forEach((i) => {
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
      scoreBar.innerText = `${current}%`;
    }, 15);
  }

  // Handle the API response
  async function handleAnalysisResponse(response) {
    if (!response.ok) {
      analyzerResult.innerHTML = `<p style='color:red;'>❌ Server error: ${response.status}</p>`;
      return;
    }

    const data = await response.json();
    console.log("✅ Analysis Result:", data);

    // Show results
    if (data.score !== undefined) animateScore(data.score);
    if (data.keywords) renderList(keywordList, data.keywords);
    analyzerResult.innerHTML = data.summary || "<p>Analysis complete.</p>";

    if (postAnalysisCTA) postAnalysisCTA.style.display = "block";
  }

  // Kick off the analysis using FormData
  async function sendAnalysis(file) {
    if (!file && !resumeText.value.trim()) {
      alert("Please paste text or upload a file.");
      return;
    }

    analyzerResult.innerHTML = "<p>⏳ Analyzing your resume…</p>";
    if (postAnalysisCTA) postAnalysisCTA.style.display = "none";
    optimizedOutput.style.display = "none";
    optimizedDownloads.style.display = "none";

    try {
      const formData = new FormData();
      if (file) formData.append("file", file);
      if (resumeText.value.trim()) formData.append("text", resumeText.value.trim());

      const response = await fetch("/api/resume/analyze", {
        method: "POST",
        body: formData,
      });

      await handleAnalysisResponse(response);
    } catch (err) {
      console.error("❌ Analysis failed:", err);
      analyzerResult.innerHTML = "<p style='color:red;'>❌ Failed to analyze your resume.</p>";
    }
  }

  // Event listener for the analyze button
  if (analyzeBtn) {
    analyzeBtn.addEventListener("click", () => {
      const file = resumeFile.files[0];
      sendAnalysis(file);
    });
  }

  // Optional: auto-analyze when a file is selected
  if (resumeFile) {
    resumeFile.addEventListener("change", () => {
      if (resumeFile.files.length > 0) {
        sendAnalysis(resumeFile.files[0]);
      }
    });
  }
});
