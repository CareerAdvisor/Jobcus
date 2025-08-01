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
  const analyzeBtn       = document.getElementById("analyze-btn");
  const resumeText       = document.getElementById("resume-text");
  const resumeFile       = document.getElementById("resumeFile");
  const analyzerResult   = document.getElementById("analyzer-result");
  const scoreBar         = document.getElementById("score-bar");
  const keywordList      = document.getElementById("keyword-list");
  const postAnalysisCTA  = document.getElementById("post-analysis-cta");
  const optimizeBtn      = document.getElementById("optimizeResume");
  const optimizedLoading = document.getElementById("optimizedLoading");
  const optimizedOutput  = document.getElementById("analyzerResumeOutput");
  const optimizedDownloads = document.getElementById("optimizedDownloadOptions");

  // Utility to render an array of strings into a <ul>
  function renderList(container, items) {
    container.innerHTML = "";
    items.forEach(i => {
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
    if (!file) {
      alert("Please paste text or upload a file.");
      return;
    }

    // Show a loading spinner
    analyzerResult.innerHTML = "<p>⏳ Analyzing your resume…</p>";
    if (postAnalysisCTA) postAnalysisCTA.style.display = "none";
    optimizedOutput.style.display = "none";
    optimizedDownloads.style.display = "none";

    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = reader.result.split(",")[1];
      if (!b64) {
        analyzerResult.innerHTML = "<p style='color:red;'>Failed to read file</p>";
        return;
      }

      try {
        const res = await fetch("/api/resume-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdf: b64 })
        });
        if (!res.ok) throw new Error("Server returned " + res.status);

        const data = await res.json();
        console.log("📝 analysis result:", data);
        if (data.error) {
          analyzerResult.innerHTML = `<p style="color:red;">${data.error}</p>`;
          return;
        }

        // Build the result HTML
        analyzerResult.innerHTML = `
          <h3>Your ATS Resume Analysis</h3>
          <div class="score-container" style="margin:1em 0;">
            <strong>Score:</strong>
            <div id="score-bar" style="display:inline-block; width:0%; 
                 background:linear-gradient(to right, #f87171, #facc15, #4ade80);
                 color:#fff; text-align:center; border-radius:10px; height:20px; line-height:20px; padding:0 5px;">
              0%
            </div>
          </div>
          <div style="margin-top:1em;">
            <h4>⚠️ Issues Found</h4>
            <ul id="issues-list"></ul>
          </div>
          <div style="margin-top:1em;">
            <h4>✅ Strengths</h4>
            <ul id="strengths-list"></ul>
          </div>
          ${ data.suggestions && data.suggestions.length
             ? `<div style="margin-top:1em;">
                  <h4>💡 Suggestions</h4>
                  <ul id="suggestions-list"></ul>
                </div>`
             : ""
          }
        `;

        // Grab the new sub-elements
        const newScoreBar     = document.getElementById("score-bar");
        const issuesList      = document.getElementById("issues-list");
        const strengthsList   = document.getElementById("strengths-list");
        const suggestionsList = document.getElementById("suggestions-list");

        // Animate & populate
        animateScore(data.score || 0);
        renderList(issuesList, data.analysis.issues || []);
        renderList(strengthsList, data.analysis.strengths || []);
        if (suggestionsList) renderList(suggestionsList, data.suggestions || []);

        // Show your “Optimize My Resume” CTA
        if (postAnalysisCTA) postAnalysisCTA.style.display = "block";

      } catch (err) {
        console.error("⚠️ analysis error:", err);
        analyzerResult.innerHTML = `<p style="color:red;">Failed to analyze. Try again.</p>`;
      }
    };

    reader.readAsDataURL(file);
  }

  // Hook up the analyze button
  analyzeBtn.addEventListener("click", () => {
    const file = resumeFile.files[0]
               || new File([resumeText.value], "resume.txt", { type: "text/plain" });
    sendAnalysis(file);
  });

  // Optional: implement “Optimize My Resume”
  optimizeBtn?.addEventListener("click", async () => {
    // Show loading
    optimizedLoading.style.display = "block";
    optimizedOutput.style.display  = "none";
    optimizedDownloads.style.display = "none";

    // Grab the analysis text we just injected:
    const rawIssues    = Array.from(document.querySelectorAll("#issues-list li")).map(li => li.textContent);
    const rawStrengths = Array.from(document.querySelectorAll("#strengths-list li")).map(li => li.textContent);
    const rawSuggests  = Array.from(document.querySelectorAll("#suggestions-list li")).map(li => li.textContent);

    // Build a prompt to optimize
    const prompt = `
      Please take my resume text (which I will paste) and return an ATS-optimized version
      that fixes the following issues: ${rawIssues.join("; ")}.
      Preserve my strengths: ${rawStrengths.join("; ")}.
      Here is my resume:
    `;
    // Fallback: we don’t have the full resume text stored client-side, so you’d need to re-upload or store it.

    // You’d send this to your own /api/resume-optimize endpoint.
    // For now, we’ll just hide the loading indicator:
    setTimeout(() => {
      optimizedLoading.style.display = "none";
      optimizedOutput.innerHTML = "<p>(Optimize resume not yet implemented.)</p>";
      optimizedOutput.style.display = "block";
    }, 1000);
  });
});
