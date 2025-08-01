document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("resumeForm");
  const resumeOutput = document.getElementById("resumeOutput");
  const downloadOptions = document.getElementById("resumeDownloadOptions");
  const optimizedDownloadOptions = document.getElementById("optimizedDownloadOptions");

  let optimizeWithAI = true;
  let shouldBuild = true;

  if (!form || !resumeOutput) {
    console.warn("Missing required elements for resume builder.");
    return;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!shouldBuild) return;

    resumeOutput.innerHTML = "⏳ Generating resume...";
    const data = Object.fromEntries(new FormData(form).entries());
    data.optimize = optimizeWithAI;

    try {
      const response = await fetch("/generate-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (result.formatted_resume) {
        const cleaned = cleanAIText(result.formatted_resume);
        resumeOutput.innerHTML = cleaned;
        if (downloadOptions) downloadOptions.style.display = "block";
        window.scrollTo({ top: resumeOutput.offsetTop, behavior: "smooth" });
      } else {
        resumeOutput.innerHTML = `<p style="color:red;">❌ Failed to generate resume.</p>`;
      }
    } catch (error) {
      console.error(error);
      resumeOutput.innerHTML = `<p style="color:red;">⚠️ Server error. Try again.</p>`;
    }
  });

  function cleanAIText(content) {
    return content
      .replace(/```html|```/g, "")
      .replace(/(?:Certainly!|Here's a resume|This HTML).*?\n/gi, "")
      .trim();
  }

  window.downloadResume = function (format) {
    const container = document.getElementById("resumeOutput");
    const text = container.innerText || "Your resume content here";

    if (format === "txt") {
      const blob = new Blob([text], { type: "text/plain" });
      saveAs(blob, "resume.txt");
    } else if (format === "doc") {
      const blob = new Blob([text], { type: "application/msword" });
      saveAs(blob, "resume.doc");
    } else if (format === "pdf") {
      const element = container.cloneNode(true);
      element.style.fontFamily = 'Arial, sans-serif';
      element.style.padding = '20px';
      html2pdf().set({
        margin: 0.5,
        filename: 'resume.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
      }).from(element).save();
    }
  };

  window.downloadOptimizedResume = function (format) {
    const container = document.getElementById("resumeOutput");
    const text = container.innerText || "Optimized resume content";

    if (format === "txt") {
      const blob = new Blob([text], { type: "text/plain" });
      saveAs(blob, "resume-optimized.txt");
    } else if (format === "doc") {
      const blob = new Blob([text], { type: "application/msword" });
      saveAs(blob, "resume-optimized.doc");
    } else if (format === "pdf") {
      const element = container.cloneNode(true);
      element.style.fontFamily = 'Arial, sans-serif';
      element.style.padding = '20px';
      html2pdf().set({
        margin: 0.5,
        filename: 'resume-optimized.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
      }).from(element).save();
    }
  };

  const optimizeBtn = document.getElementById("optimizeResume");
  if (optimizeBtn) {
    optimizeBtn.addEventListener("click", async () => {
      const resumeText = document.getElementById("resume-text")?.value.trim();
      if (!resumeText) {
        alert("Please paste your resume text above first.");
        return;
      }

      resumeOutput.innerHTML = "⏳ Optimizing your resume...";
      try {
        const response = await fetch("/generate-resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: "Candidate",
            summary: resumeText,
            education: "",
            experience: "",
            skills: "",
            certifications: "",
            portfolio: "",
            optimize: true
          })
        });

        const result = await response.json();
        if (result.formatted_resume) {
          const cleaned = cleanAIText(result.formatted_resume);
          resumeOutput.innerHTML = cleaned;
          if (optimizedDownloadOptions) optimizedDownloadOptions.style.display = "block";
          window.scrollTo({ top: resumeOutput.offsetTop, behavior: "smooth" });
        } else {
          resumeOutput.innerHTML = `<p style="color:red;">❌ Optimization failed.</p>`;
        }
      } catch (error) {
        console.error(error);
        resumeOutput.innerHTML = `<p style="color:red;">⚠️ Optimization error. Try again.</p>`;
      }
    });
  }

  // ===== RESUME ANALYZER =====
  const analyzeBtn = document.getElementById("analyze-btn");
  const resumeText = document.getElementById("resume-text");
  const resumeFile = document.getElementById("resumeFile");
  const analyzerResult = document.getElementById("analyzer-result");
  const scoreBar = document.getElementById("score-bar");
  const keywordList = document.getElementById("keyword-list");

  if (analyzeBtn && resumeText && analyzerResult && scoreBar && keywordList) {
    analyzeBtn.addEventListener("click", async () => {
      analyzerResult.innerHTML = "⏳ Analyzing...";
      keywordList.innerHTML = "";
      scoreBar.style.width = "0%";
      scoreBar.innerText = "0%";

      let resumeData = resumeText.value.trim();
      let pdfData = "";

      if (!resumeData && resumeFile.files.length > 0) {
        const reader = new FileReader();
        reader.onload = async function (e) {
          const base64 = e.target.result.split(",")[1];
          pdfData = base64;
          await sendAnalysis(pdfData);
        };
        reader.readAsDataURL(resumeFile.files[0]);
      } else {
        await sendAnalysis(null, resumeData);
      }
    });
  }

  async function sendAnalysis(pdf = null, text = "") {
    try {
      const response = await fetch("/api/analyze-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pdf ? { pdf } : { text })
      });

      const result = await response.json();
      if (result.error) throw new Error(result.error);

      analyzerResult.innerHTML = marked.parse(result.analysis || "No analysis returned.");
      if (result.keywords && Array.isArray(result.keywords)) {
        result.keywords.forEach(kw => {
          const li = document.createElement("li");
          li.innerText = kw;
          keywordList.appendChild(li);
        });
      }

      const score = Math.min(100, result.keywords.length * 20);
      scoreBar.style.width = `${score}%`;
      scoreBar.innerText = `${score}%`;

      const cta = document.getElementById("post-analysis-cta");
      if (cta) cta.style.display = "block";
    } catch (err) {
      console.error("Analyzer error:", err);
      analyzerResult.innerHTML = `<p style="color:red;">❌ Failed to analyze resume. Please try again.</p>`;
    }
  }
});
