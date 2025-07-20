document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("resumeForm");
  const resumeOutput = document.getElementById("resumeOutput");
  const optimizePopup = document.getElementById("optimize-popup");
  const downloadOptions = document.getElementById("resumeDownloadOptions");
  const acceptBtn = document.getElementById("acceptOptimize");
  const declineBtn = document.getElementById("declineOptimize");

  let optimizeWithAI = true;
  let pendingSubmit = false;

  // Show popup on form submit
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    pendingSubmit = true;
    optimizePopup.classList.remove("hidden");
  });

  acceptBtn.onclick = () => {
    optimizeWithAI = true;
    optimizePopup.classList.add("hidden");
    if (pendingSubmit) processResume();
  };

  declineBtn.onclick = () => {
    optimizeWithAI = false;
    optimizePopup.classList.add("hidden");
    if (pendingSubmit) processResume();
  };

  async function processResume() {
    pendingSubmit = false;
    resumeOutput.innerHTML = "<p>⏳ Generating resume, please wait...</p>";

    const data = Object.fromEntries(new FormData(form).entries());

    try {
      const response = await fetch("/generate-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });

      const result = await response.json();

      if (result.formatted_resume) {
        const cleaned = cleanAIText(result.formatted_resume);
        resumeOutput.innerHTML = wrapResumeInContainer(cleaned);
        if (downloadOptions) downloadOptions.style.display = "block";
        window.scrollTo({ top: resumeOutput.offsetTop, behavior: "smooth" });
      } else {
        resumeOutput.innerHTML = `<p style="color:red;">❌ Failed to generate resume. Please try again.</p>`;
      }
    } catch (error) {
      console.error("Resume generation failed:", error);
      resumeOutput.innerHTML = `<p style="color:red;">❌ Failed to generate resume. Please check your connection or try again.</p>`;
    }
  }

  function wrapResumeInContainer(content) {
    return `
      <div class="resume-container">
        ${content.replace(
          /<h1>(.*?)<\/h1>/,
          (_, name) => `
            <h1 style="margin-bottom: 0;">${name}</h1>
            <p class="resume-title-line" style="margin-top: 2px;">${form.title.value}</p>
            <p class="resume-title-line">${form.contact.value}</p>
          `
        )}
      </div>`;
  }

  window.downloadResume = function (type) {
    const resumeHtml = resumeOutput.innerHTML;
    const cleanedHtml = cleanAIText(resumeHtml);

    let blob;
    if (type === 'txt') {
      blob = new Blob([stripHtmlTags(cleanedHtml)], { type: "text/plain" });
    } else if (type === 'doc') {
      const docContent = `<!DOCTYPE html><html><head><meta charset='utf-8'></head><body>${cleanedHtml}</body></html>`;
      blob = new Blob([docContent], { type: "application/msword" });
    } else {
      const htmlContent = `<!DOCTYPE html><html><head><meta charset='utf-8'></head><body>${cleanedHtml}</body></html>`;
      blob = new Blob([htmlContent], { type: "application/pdf" });
    }

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
