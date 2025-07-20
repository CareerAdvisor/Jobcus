document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("resumeForm");
  const resumeOutput = document.getElementById("resumeOutput");
  const resumePreview = document.getElementById("resumePreview");
  const downloadBtn = document.getElementById("downloadResumeBtn");
  const optimizePopup = document.getElementById("optimize-popup");

  let optimizeWithAI = true;

  // Handle AI optimization popup
  document.getElementById("acceptOptimize").onclick = () => {
    optimizeWithAI = true;
    optimizePopup.classList.add("hidden");
    form.dispatchEvent(new Event("submit"));
  };

  document.getElementById("declineOptimize").onclick = () => {
    optimizeWithAI = false;
    optimizePopup.classList.add("hidden");
    form.dispatchEvent(new Event("submit"));
  };

  // Form submission handler
  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    if (!optimizePopup.classList.contains("hidden")) return;

    const data = Object.fromEntries(new FormData(form).entries());

    const response = await fetch("/generate-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (result.formatted_resume) {
      resumeOutput.innerHTML = result.formatted_resume;
      downloadBtn.style.display = "block";
      window.scrollTo({ top: resumeOutput.offsetTop, behavior: "smooth" });
    } else {
      resumeOutput.innerHTML = `<p style="color:red;">❌ Failed to generate resume. Please try again.</p>`;
    }
  });

  // Trigger popup once before generating
  form.addEventListener("submit", function (e) {
    if (optimizePopup.classList.contains("hidden")) return;
    e.preventDefault();
    optimizePopup.classList.remove("hidden");
  });

  // Download as PDF
  downloadBtn.onclick = () => {
    const content = resumeOutput.innerHTML;
    const win = window.open('', '', 'height=842,width=595');
    win.document.write('<html><head><title>Resume</title>');
    win.document.write('</head><body>');
    win.document.write(content);
    win.document.write('</body></html>');
    win.document.close();
    win.print();
  };

  // Resume Analyzer
  document.getElementById("analyze-btn").addEventListener("click", async () => {
    const textArea = document.getElementById("resume-text").value.trim();
    const file = document.getElementById("resumeFile").files[0];
    const resultContainer = document.getElementById("analyzer-result");

    let resumeText = textArea;
    if (!resumeText && file) {
      resumeText = await file.text();
    }

    if (!resumeText) {
      resultContainer.innerHTML = "<p style='color:red;'>Please paste your resume or upload a file.</p>";
      return;
    }

    resultContainer.innerHTML = "⏳ Analyzing...";

    try {
      const res = await fetch("/api/analyze-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: resumeText })
      });
      const data = await res.json();

      if (data.error) {
        resultContainer.innerHTML = `<p style='color:red;'>${data.error}</p>`;
        return;
      }

      resultContainer.innerHTML = `
        <h3>✅ Resume Score: ${data.score || 'N/A'}/100</h3>
        <h4>Recommendations:</h4>
        <ul>${data.suggestions ? data.suggestions.map(item => `<li>${item}</li>`).join("") : data.keywords.map(item => `<li>${item}</li>`).join("")}</ul>
        <p>${data.analysis || ''}</p>
      `;
    } catch (err) {
      console.error(err);
      resultContainer.innerHTML = "<p style='color:red;'>⚠️ Could not analyze resume.</p>";
    }
  });
});
