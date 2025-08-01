// static/resume-builder.js

// — Force all fetch() calls to include credentials —
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || 'same-origin';
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  console.log("🚀 [resume-builder] script loaded");

  // Element refs
  const analyzeBtn       = document.getElementById("analyze-btn");
  const resumeText       = document.getElementById("resume-text");
  const resumeFile       = document.getElementById("resumeFile");
  const analyzerResult   = document.getElementById("analyzer-result");
  const scoreBar         = document.getElementById("score-bar");
  const keywordList      = document.getElementById("keyword-list");
  const postAnalysisCTA  = document.getElementById("post-analysis-cta");
  const optimizedLoading = document.getElementById("optimizedLoading");

  // Clears any old analysis
  localStorage.removeItem("resumeAnalysis");

  // Utility: render lists
  function renderList(container, items) {
    container.innerHTML = "";
    items.forEach(i => {
      const li = document.createElement("li");
      li.textContent = i;
      container.appendChild(li);
    });
  }

  // Animate score bar from 0 to target
  function animateScore(to) {
    let curr = 0;
    scoreBar.style.width = "0%";
    scoreBar.innerText = "0%";
    const step = to > 0 ? 1 : -1;
    const iv = setInterval(() => {
      if (curr === to) return clearInterval(iv);
      curr += step;
      scoreBar.style.width = `${curr}%`;
      scoreBar.innerText = `${curr}%`;
    }, 15);
  }

  // Inject analysis into DOM
  function showAnalysis(data) {
    // Score
    animateScore(data.score || 0);

    // Issues and strengths
    renderList(analyzerResult.querySelector(".issues-list"), data.analysis.issues || []);
    renderList(analyzerResult.querySelector(".strengths-list"), data.analysis.strengths || []);

    // Suggestions (if you have a container)
    const sugCont = analyzerResult.querySelector(".suggestions-list");
    if (sugCont && data.suggestions) {
      renderList(sugCont, data.suggestions);
    }

    // Reveal CTA
    if (postAnalysisCTA) postAnalysisCTA.style.display = "block";
  }

  // Read file/text, call API, then showAnalysis
  async function sendAnalysis(file) {
    if (!file) {
      alert("Please select a file or paste text.");
      return;
    }

    // Show loader
    analyzerResult.innerHTML = "<p>⏳ Analyzing…</p>";
    if (postAnalysisCTA) postAnalysisCTA.style.display = "none";

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(",")[1];
      if (!base64) {
        analyzerResult.innerHTML = "<p style='color:red;'>Read error</p>";
        return;
      }

      try {
        const res = await fetch("/api/resume-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdf: base64 })
        });
        if (!res.ok) throw new Error("Server " + res.status);

        const data = await res.json();
        if (data.error) {
          analyzerResult.innerHTML = `<p style="color:red;">${data.error}</p>`;
          return;
        }
        console.log("📝 Analysis response:", data);

        // Store for later if you want
        localStorage.setItem("resumeAnalysis", JSON.stringify(data));

        // Build out analyzerResult HTML structure
        analyzerResult.innerHTML = `
          <h3>Your Resume Analysis</h3>
          <div class="score-container">
            <label>Score:</label>
            <div id="score-bar" class="score-bar">0%</div>
          </div>
          <div class="analysis-section">
            <h4>⚠️ Issues Found</h4>
            <ul class="issues-list"></ul>
          </div>
          <div class="analysis-section">
            <h4>✅ Strengths</h4>
            <ul class="strengths-list"></ul>
          </div>
          ${ data.suggestions
             ? `<div class="analysis-section">
                  <h4>💡 Suggestions</h4>
                  <ul class="suggestions-list"></ul>
                </div>`
             : ""
          }
        `;

        // Re-acquire the newly injected scoreBar and lists
        const newScoreBar   = document.getElementById("score-bar");
        const newIssuesList = analyzerResult.querySelector(".issues-list");
        const newStrengths  = analyzerResult.querySelector(".strengths-list");
        const newSugList    = analyzerResult.querySelector(".suggestions-list");

        // Animate & populate
        animateScore(data.score || 0);
        renderList(newIssuesList, data.analysis.issues || []);
        renderList(newStrengths, data.analysis.strengths || []);
        if (newSugList) renderList(newSugList, data.suggestions);

        // Reveal CTA
        if (postAnalysisCTA) postAnalysisCTA.style.display = "block";

      } catch (err) {
        console.error("⚠️ Analyzer error:", err);
        analyzerResult.innerHTML = `<p style="color:red;">Could not analyze resume. Try again.</p>`;
      }
    };

    reader.readAsDataURL(file);
  }

  // Hook up the Analyze button
  analyzeBtn.addEventListener("click", () => {
    const file = resumeFile.files[0]
               || new File([new Blob([resumeText.value], { type: "text/plain" })],
                          "resume.txt", { type: "text/plain" });
    sendAnalysis(file);
  });
});
