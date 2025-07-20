// resume-builder.js

document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("resumeForm");
  const resumeOutput = document.getElementById("resumeOutput");
  const optimizePopup = document.getElementById("optimize-popup");
  const downloadOptions = document.getElementById("resumeDownloadOptions");
  const generateBtn = document.getElementById("generateBtn");

  let optimizeWithAI = true;

  // Show popup ONLY on button click
  generateBtn.addEventListener("click", function (e) {
    e.preventDefault();
    optimizePopup.classList.remove("hidden");
  });

  // Accept optimization
  document.getElementById("acceptOptimize").onclick = () => {
    optimizeWithAI = true;
    optimizePopup.classList.add("hidden");
    form.dispatchEvent(new Event("submit"));
  };

  // Decline optimization
  document.getElementById("declineOptimize").onclick = () => {
    optimizeWithAI = false;
    optimizePopup.classList.add("hidden");
    form.dispatchEvent(new Event("submit"));
  };

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    resumeOutput.innerHTML = "<p>⏳ Generating resume, please wait...</p>";

    const data = Object.fromEntries(new FormData(form).entries());

    const response = await fetch("/generate-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, optimize: optimizeWithAI })
    });

    const result = await response.json();

    if (result.formatted_resume) {
      const cleaned = cleanAIText(result.formatted_resume);
      resumeOutput.innerHTML = cleaned;
      if (downloadOptions) downloadOptions.style.display = "block";
      window.scrollTo({ top: resumeOutput.offsetTop, behavior: "smooth" });
    } else {
      resumeOutput.innerHTML = `<p style="color:red;">❌ Failed to generate resume. Please try again.</p>`;
    }
  });

  // Download logic
  window.downloadResume = function (type) {
    const resumeHtml = resumeOutput.innerHTML;
    const cleanedHtml = cleanAIText(resumeHtml);

    let content;
    let mime;
    if (type === "txt") {
      content = stripHtmlTags(cleanedHtml);
      mime = "text/plain";
    } else {
      content = cleanedHtml;
      mime = type === "pdf" ? "application/pdf" : "application/msword";
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Resume.${type}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  function cleanAIText(content) {
    return content
      .replace(/Certainly!.*?resume in HTML format.*?\n/i, "")
      .replace(/```html|```/g, "")
      .replace(/This HTML resume is structured.*?section\./is, "")
      .replace(/Here is a professional.*?```html/i, "")
      .replace(/```\n*This HTML code organizes.*?customize it as needed\./is, "")
      .trim();
  }

  function stripHtmlTags(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || "";
  }

  // Resume Analyzer logic
  const analyzerBtn = document.getElementById("analyze-btn");
  if (analyzerBtn) {
    analyzerBtn.addEventListener("click", async () => {
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

        const bullets = data.suggestions || data.keywords || [];
        const bulletList = bullets.length ? `<ul>${bullets.map(i => `<li>${i}</li>`).join('')}</ul>` : "";

        resultContainer.innerHTML = `
          <div style="padding: 1rem; border: 1px solid #ccc; background: #f9f9f9; border-radius: 4px;">
            <h3 style="color: #104879;">✅ Resume Score: ${data.score || 'N/A'}/100</h3>
            <h4 style="margin-top: 1rem; color: #333;">Recommendations:</h4>
            ${bulletList}
            ${data.analysis ? `<p style="margin-top:1rem;">${data.analysis}</p>` : ""}
          </div>
        `;
      } catch (err) {
        console.error(err);
        resultContainer.innerHTML = "<p style='color:red;'>⚠️ Could not analyze resume.</p>";
      }
    });
  }
});
