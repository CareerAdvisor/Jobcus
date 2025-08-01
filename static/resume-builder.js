// resume-builder.js

// — Force all fetch() calls to include credentials —
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || 'same-origin';
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", function () {
  const analyzeBtn     = document.getElementById("analyze-btn");
  const resumeText     = document.getElementById("resume-text");
  const resumeFile     = document.getElementById("resumeFile");
  const analyzerResult = document.getElementById("analyzer-result");
  const scoreBar       = document.getElementById("score-bar");
  const keywordList    = document.getElementById("keyword-list");

  // Clean up any old data
  localStorage.removeItem("resumeAnalysis");

  async function sendAnalysis(file) {
    if (!file) { alert("Please select a file."); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(",")[1];
      if (!base64) { alert("Read error"); return; }

      try {
        const res = await fetch("/api/resume-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdf: base64 })
        });
        if (!res.ok) throw new Error("Server returned " + res.status);

        const data = await res.json();
        console.log("📝 [resume-builder] Analysis response:", data);

        if (data.error) {
          alert("Error analyzing resume: " + data.error);
          return;
        }

        // **Save to LocalStorage for the dashboard**
        localStorage.setItem("resumeAnalysis", JSON.stringify(data));
        console.log("💾 [resume-builder] Stored resumeAnalysis:", localStorage.getItem("resumeAnalysis"));

        // Redirect to dashboard
        window.location.href = "/dashboard";

      } catch (err) {
        console.error("⚠️ [resume-builder] Analyzer error:", err);
        alert("Could not analyze resume. Please try again.");
      }
    };
    reader.readAsDataURL(file);
  }

  analyzeBtn.addEventListener("click", () => {
    analyzerResult.innerHTML = "⏳ Analyzing...";
    keywordList.innerHTML    = "";
    scoreBar.style.width     = "0%";
    scoreBar.innerText       = "0%";

    const file = resumeFile.files[0]
               || new File([new Blob([resumeText.value], { type: "text/plain" })], "resume.txt");
    sendAnalysis(file);
  });
});
