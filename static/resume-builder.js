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

  const analyzeBtn       = document.getElementById("analyze-btn");
  const resumeText       = document.getElementById("resume-text");
  const resumeFile       = document.getElementById("resumeFile");
  const analyzerResult   = document.getElementById("analyzer-result");
  const scoreBar         = document.getElementById("score-bar");
  const keywordList      = document.getElementById("keyword-list");
  const postAnalysisCTA  = document.getElementById("post-analysis-cta");
  const optimizedOutput  = document.getElementById("analyzerResumeOutput");
  const optimizedDownloads = document.getElementById("optimizedDownloadOptions");

  function renderList(container, items) {
    container.innerHTML = "";
    items.forEach((i) => {
      const li = document.createElement("li");
      li.textContent = i;
      container.appendChild(li);
    });
  }

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

  async function sendAnalysis(file) {
    const textContent = resumeText.value.trim();
    if (!file && !textContent) {
      alert("Please paste text or upload a file.");
      return;
    }

    analyzerResult.innerHTML = "<p>⏳ Analyzing your resume…</p>";
    if (postAnalysisCTA) postAnalysisCTA.style.display = "none";
    optimizedOutput.style.display = "none";
    optimizedDownloads.style.display = "none";

    let payload = {};

    if (file) {
      // Convert file to Base64
      const reader = new FileReader();
      reader.onload = async () => {
        const b64 = reader.result.split(",")[1];
        if (!b64) {
          analyzerResult.innerHTML =
            "<p style='color:red;'>❌ Failed to read file.</p>";
          return;
        }

        payload = { pdf: b64 };
        await sendRequest(payload);
      };
      reader.readAsDataURL(file);
    } else {
      payload = { text: textContent };
      await sendRequest(payload);
    }
  }

  async function sendRequest(payload) {
    try {
      const response = await fetch("/api/resume-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        analyzerResult.innerHTML =
          `<p style='color:red;'>❌ Error: ${err.error || "Analysis failed"}</p>`;
        return;
      }

      const data = await response.json();
      console.log("Analysis Result:", data);

      // Show results
      if (data.score !== undefined) animateScore(data.score);
      if (data.issues) renderList(keywordList, data.issues);

      analyzerResult.innerHTML = `
        <p>✅ Analysis Complete!</p>
        <p><strong>Score:</strong> ${data.score || 0}%</p>
        <p><strong>Strengths:</strong> ${data.strengths?.join(", ") || "N/A"}</p>
        <p><strong>Suggestions:</strong> ${data.suggestions?.join(", ") || "N/A"}</p>
      `;

      if (postAnalysisCTA) postAnalysisCTA.style.display = "block";
    } catch (error) {
      console.error(error);
      analyzerResult.innerHTML =
        "<p style='color:red;'>❌ Network or server error</p>";
    }
  }

  analyzeBtn?.addEventListener("click", () => {
    const file = resumeFile.files[0];
    sendAnalysis(file);
  });
});
