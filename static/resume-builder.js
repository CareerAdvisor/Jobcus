document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("resumeForm");
  const resumeOutput = document.getElementById("resumeOutput");
  const optimizePopup = document.getElementById("optimize-popup");
  const downloadOptions = document.getElementById("resumeDownloadOptions");

  let optimizeWithAI = true;
  let shouldBuild = false;

  // 1. First click shows the popup
  form.addEventListener("submit", function (e) {
    if (!shouldBuild) {
      e.preventDefault();
      optimizePopup.classList.remove("hidden");
      return;
    }
    // reset state after decision
    shouldBuild = false;
  });

  // 2. User accepts optimization
  document.getElementById("acceptOptimize").onclick = () => {
    optimizeWithAI = true;
    optimizePopup.classList.add("hidden");
    shouldBuild = true;
    form.dispatchEvent(new Event("submit"));
  };

  // 3. User declines optimization
  document.getElementById("declineOptimize").onclick = () => {
    optimizeWithAI = false;
    optimizePopup.classList.add("hidden");
    shouldBuild = true;
    form.dispatchEvent(new Event("submit"));
  };

  // 4. Main submit logic
  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    // Only run after popup interaction
    if (!shouldBuild) return;

    resumeOutput.innerHTML = "<p>⏳ Generating resume, please wait...</p>";

    const data = Object.fromEntries(new FormData(form).entries());
    data.optimize = optimizeWithAI;

    const response = await fetch("/generate-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
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

  function cleanAIText(content) {
    return content
      .replace(/Certainly!.*?resume in HTML format.*?\n/i, "")
      .replace(/```html|```/g, "")
      .replace(/This HTML resume is structured.*?section\./is, "")
      .replace(/Here is a professional.*?```html/i, "")
      .replace(/```\n*This HTML code organizes.*?customize it as needed\./is, "")
      .trim();
  }
});

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
