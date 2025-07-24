document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("resumeForm");
  const builderResumeOutput = document.getElementById("builderResumeOutput");
  const analyzerResumeOutput = document.getElementById("analyzerResumeOutput");
  const optimizedLoading = document.getElementById("optimizedLoading");
  const downloadOptions = document.getElementById("resumeDownloadOptions");
  const optimizedDownloadOptions = document.getElementById("optimizedDownloadOptions");

  let optimizeWithAI = true;
  let shouldBuild = true;

  if (!form || !builderResumeOutput || !analyzerResumeOutput) {
    console.warn("Missing required elements for resume builder.");
    return;
  }

  // ==== Resume Builder Submit ====
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!shouldBuild) return;

     builderResumeOutput.innerHTML = "⏳ Generating resume...";
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
        builderResumeOutput.innerHTML = cleaned;
        if (downloadOptions) downloadOptions.style.display = "block";
        window.scrollTo({ top: builderResumeOutput.offsetTop, behavior: "smooth" });
      } else {
        builderResumeOutput.innerHTML = `<p style="color:red;">❌ Failed to generate resume.</p>`;
      }
    } catch (error) {
      console.error(error);
      builderResumeOutput.innerHTML = `<p style="color:red;">⚠️ Server error. Try again.</p>`;
    }
  });
  
  // Clean AI Response
  function cleanAIText(content) {
    return content
      .replace(/```html|```/g, "")
      .replace(/(?:Certainly!|Here's a resume|This HTML).*?\n/gi, "")
      .trim();
  }

  // ==== Download Resume Builder ====
  window.downloadResume = function (format) {
    const text = builderResumeOutput.innerText || "Your resume content here";
    downloadHelper(format, text, "resume");
  };

  // ==== Download Optimized Resume ====
  window.downloadOptimizedResume = function (format) {
    const content = analyzerResumeOutput.innerText || "Optimized resume content";
    downloadHelper(format, content, "resume-optimized");
  };

  function downloadHelper(format, text, filename) {
    if (format === "txt") {
      const blob = new Blob([text], { type: "text/plain" });
      saveAs(blob, `${filename}.txt`);
    } else if (format === "doc") {
      const blob = new Blob([text], { type: "application/msword" });
      saveAs(blob, `${filename}.doc`);
    } else if (format === "pdf") {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const lines = doc.splitTextToSize(text, 180);
      let y = 10;
      lines.forEach((line) => {
        if (y > 280) {
          doc.addPage();
          y = 10;
        }
        doc.text(line, 10, y);
        y += 8;
      });
      doc.save(`${filename}.pdf`);
    }
  }

  // ==== Resume Optimizer from Analyzer ====
  const optimizeBtn = document.getElementById("optimizeResume");
  if (optimizeBtn) {
    optimizeBtn.addEventListener("click", async () => {
      const resumeText = document.getElementById("resume-text")?.value.trim();
      if (!resumeText) {
        alert("Please paste your resume text above first.");
        return;
      }

      optimizedLoading.style.display = "block";
      analyzerResumeOutput.innerHTML = "";
      analyzerResumeOutput.style.display = "none";

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
        optimizedLoading.style.display = "none";

        if (result.formatted_resume) {
          const cleaned = cleanAIText(result.formatted_resume);
          analyzerResumeOutput.innerHTML = cleaned;
          analyzerResumeOutput.style.display = "block";
          if (optimizedDownloadOptions) optimizedDownloadOptions.style.display = "block";
          window.scrollTo({ top: analyzerResumeOutput.offsetTop, behavior: "smooth" });
        } else {
          analyzerResumeOutput.innerHTML = `<p style="color:red;">❌ Optimization failed.</p>`;
          analyzerResumeOutput.style.display = "block";
        }
      } catch (error) {
        console.error(error);
        optimizedLoading.style.display = "none";
        analyzerResumeOutput.innerHTML = `<p style="color:red;">⚠️ Optimization error. Try again.</p>`;
        analyzerResumeOutput.style.display = "block";
      }
    });
  }

  // ==== Resume Analyzer Logic ====
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

    // ✅ Insert here to pre-fill optimizer textarea after PDF is analyzed
    if (text && document.getElementById("resume-text")) {
      document.getElementById("resume-text").value = text;
    }

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
