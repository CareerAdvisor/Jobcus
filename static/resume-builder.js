// static/resume-builder.js

// — Force cookies on fetch() —
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || 'same-origin';
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  console.log("🚀 resume-builder.js loaded");

  const analyzeBtn      = document.getElementById("analyze-btn");
  const resumeText      = document.getElementById("resume-text");
  const resumeFile      = document.getElementById("resumeFile");
  const analyzerResult  = document.getElementById("analyzer-result");
  const scoreBar        = document.getElementById("score-bar");
  const keywordList     = document.getElementById("keyword-list");
  const postAnalysisCTA = document.getElementById("post-analysis-cta");

  // Helper to render a <ul> from an array
  function renderList(ul, items) {
    ul.innerHTML = "";
    items.forEach(text => {
      const li = document.createElement("li");
      li.textContent = text;
      ul.appendChild(li);
    });
  }

  // Animate the one, single scoreBar from 0 → target
  function animateScore(target) {
    let current = 0;
    scoreBar.style.width = "0%";
    scoreBar.textContent = "0%";
    const step = target > 0 ? 1 : -1;
    const iv = setInterval(() => {
      if (current === target) return clearInterval(iv);
      current += step;
      scoreBar.style.width = `${current}%`;
      scoreBar.textContent = `${current}%`;
    }, 15);
  }

  async function sendAnalysis(file) {
    if (!file) return alert("Please paste text or upload a file.");

    // Reset UI
    analyzerResult.innerHTML = "<p>⏳ Analyzing…</p>";
    keywordList.innerHTML    = "";
    animateScore(0);
    postAnalysisCTA.style.display = "none";

    // Read the file as base64
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = reader.result.split(",")[1];
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
          return analyzerResult.innerHTML = `<p style="color:red;">${data.error}</p>`;
        }

        // 1️⃣ Animate the bar
        animateScore(data.score || 0);

        // 2️⃣ Populate matched keywords
        if (Array.isArray(data.keywords)) {
          renderList(keywordList, data.keywords);
        }

        // 3️⃣ Show issues & strengths & suggestions
        analyzerResult.innerHTML = `
          <div class="analysis-section">
            <h4>⚠️ Issues Found</h4>
            <ul id="issues-list"></ul>
          </div>
          <div class="analysis-section">
            <h4>✅ Strengths</h4>
            <ul id="strengths-list"></ul>
          </div>
          ${ data.suggestions && data.suggestions.length
             ? `<div class="analysis-section">
                  <h4>💡 Suggestions</h4>
                  <ul id="suggestions-list"></ul>
                </div>`
             : ""
          }
        `;

        // Grab those new lists
        const issuesUL      = document.getElementById("issues-list");
        const strengthsUL   = document.getElementById("strengths-list");
        const suggestionsUL = document.getElementById("suggestions-list");

        renderList(issuesUL,    data.analysis.issues    || []);
        renderList(strengthsUL, data.analysis.strengths || []);
        if (suggestionsUL) renderList(suggestionsUL, data.suggestions);

        // 4️⃣ Reveal the CTA
        postAnalysisCTA.style.display = "block";

      } catch (err) {
        console.error("⚠️ analysis error:", err);
        analyzerResult.innerHTML = `<p style="color:red;">Failed to analyze. Try again.</p>`;
      }
    };

    reader.readAsDataURL(file);
  }

  // Wire up the button
  analyzeBtn.addEventListener("click", () => {
    const file = resumeFile.files[0]
               || new File([resumeText.value], "resume.txt", { type: "text/plain" });
    sendAnalysis(file);
  });
});
