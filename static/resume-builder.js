// static/resume-builder.js

// Force cookies on fetch
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

  // Helper to fill a <ul> from an array
  function renderList(ul, items) {
    ul.innerHTML = "";
    items.forEach(i => {
      const li = document.createElement("li");
      li.textContent = i;
      ul.appendChild(li);
    });
  }

  // Animate the existing score-bar from 0→n
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
    if (!file) {
      alert("Please paste text or upload a file.");
      return;
    }

    // Reset UI
    analyzerResult.innerHTML = "⏳ Analyzing…";
    keywordList.innerHTML    = "";
    animateScore(0);
    if (postAnalysisCTA) postAnalysisCTA.style.display = "none";

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(",")[1];
      try {
        const res = await fetch("/api/resume-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdf: base64 })
        });
        if (!res.ok) throw new Error(res.statusText);

        const data = await res.json();
        console.log("📝 Analysis:", data);
        if (data.error) {
          analyzerResult.innerHTML = `<p style="color:red;">${data.error}</p>`;
          return;
        }

        // 1) Animate score
        animateScore(data.score || 0);

        // 2) Populate keywords
        if (Array.isArray(data.keywords)) {
          renderList(keywordList, data.keywords);
        }

        // 3) Show issues & strengths
        const issuesHtml = (data.analysis.issues || [])
          .map(i => `<li>${i}</li>`).join("");
        const strengthsHtml = (data.analysis.strengths || [])
          .map(s => `<li>${s}</li>`).join("");

        analyzerResult.innerHTML = `
          <h4>⚠️ Issues Found</h4>
          <ul>${issuesHtml}</ul>
          <h4>✅ Strengths</h4>
          <ul>${strengthsHtml}</ul>
        `;

        // 4) Reveal CTA
        if (postAnalysisCTA) postAnalysisCTA.style.display = "block";

      } catch (err) {
        console.error("⚠️ Analyzer error:", err);
        analyzerResult.innerHTML =
          `<p style="color:red;">Could not analyze resume. Please try again.</p>`;
      }
    };

    reader.readAsDataURL(file);
  }

  analyzeBtn.addEventListener("click", () => {
    const file = resumeFile.files[0]
               || new File(
                    [resumeText.value],
                    "resume.txt",
                    { type: "text/plain" }
                  );
    sendAnalysis(file);
  });
});
