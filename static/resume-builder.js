document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("resumeForm");
  const builderResumeOutput = document.getElementById("builderResumeOutput");
  const analyzerResumeOutput = document.getElementById("analyzerResumeOutput");
  const optimizedLoading = document.getElementById("optimizedLoading");
  const downloadOptions = document.getElementById("resumeDownloadOptions");
  const optimizedDownloadOptions = document.getElementById("optimizedDownloadOptions");

  const analyzeBtn = document.getElementById("analyze-btn");
  const resumeText = document.getElementById("resume-text");
  const resumeFile = document.getElementById("resumeFile");
  const analyzerResult = document.getElementById("analyzer-result");
  const scoreBar = document.getElementById("score-bar");
  const keywordList = document.getElementById("keyword-list");

  let optimizeWithAI = true;
  let shouldBuild = true;

  if (!form || !builderResumeOutput || !analyzerResumeOutput) {
    console.warn("Missing required elements for resume builder.");
    return;
  }

  // === Clean AI Response ===
  function cleanAIText(content) {
    return content
      .replace(/```html|```/g, "")
      .replace(/(?:Certainly!|Here's a resume|This HTML).*?\n/gi, "")
      .trim();
  }

  // === Resume Builder Submit ===
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

  // === Download Resume Helper ===
  function downloadHelper(format, text, filename) {
    if (format === "txt") {
      const blob = new Blob([text], { type: "text/plain" });
      saveAs(blob, `${filename}.txt`);
    } else if (format === "docx") {
      const { Document, Packer, Paragraph, TextRun } = window.docx;
      const doc = new Document();
      const lines = text.split('\n').map(line =>
        new Paragraph({ children: [new TextRun({ text: line })] })
      );
      doc.addSection({ children: lines });
      Packer.toBlob(doc).then(blob => {
        saveAs(blob, `${filename}.docx`);
      });
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

  // === Public download functions ===
  window.downloadResume = function (format) {
    const text = builderResumeOutput.innerText || "Your resume content here";
    downloadHelper(format, text, "resume");
  };

  window.downloadOptimizedResume = function (format) {
    const content = analyzerResumeOutput.innerText || "Optimized resume content";
    downloadHelper(format, content, "resume-optimized");
  };

  // === Resume Analyzer Function (PDF or text) ===
  async function sendAnalysis(file) {
    if (!file) {
      alert("Please select a file to analyze.");
      return;
    }

    const reader = new FileReader();

    reader.onload = async function () {
      const base64Resume = reader.result.split(",")[1]; // Remove data: prefix
      if (!base64Resume) {
        alert("Failed to read file. Please try another PDF or TXT file.");
        return;
      }

      try {
        const res = await fetch("/api/resume-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdf: base64Resume })
        });

        if (!res.ok) throw new Error("Server returned " + res.status);

        const data = await res.json();
        if (data.error) {
          alert("Error analyzing resume: " + data.error);
          return;
        }

        // ✅ Save result to localStorage for the Dashboard
        localStorage.setItem("resumeAnalysis", JSON.stringify(data));

        // ✅ Redirect to Dashboard to show the analysis
        window.location.href = "/dashboard";

      } catch (err) {
        console.error("Analyzer error:", err);
        alert("Failed to analyze resume. Please try again.");
      }
    };

    reader.readAsDataURL(file);
  }

        // Update Analyzer Section
        analyzerResult.innerHTML = marked.parse(
          (data.analysis.issues || []).map(i => `- ${i}`).join("\n") || "No issues found."
        );

        // Populate Keywords
        keywordList.innerHTML = "";
        (data.keywords || []).forEach(kw => {
          const li = document.createElement("li");
          li.innerText = kw;
          keywordList.appendChild(li);
        });

        // Animate Score Bar
        let score = data.score || 0;
        let current = 0;
        const animate = setInterval(() => {
          if (current >= score) clearInterval(animate);
          scoreBar.style.width = `${current}%`;
          scoreBar.innerText = `${current}%`;
          current++;
        }, 15);

        // Reveal CTA if available
        const cta = document.getElementById("post-analysis-cta");
        if (cta) cta.style.display = "block";

      } catch (err) {
        console.error("Analyzer error:", err);
        analyzerResult.innerHTML = `<p style="color:red;">❌ Failed to analyze resume. Please try again.</p>`;
      }
    };

    reader.readAsDataURL(file);
  }

  // === Analyze Button Click Handler ===
  if (analyzeBtn && analyzerResult && scoreBar && keywordList) {
    analyzeBtn.addEventListener("click", async () => {
      analyzerResult.innerHTML = "⏳ Analyzing...";
      keywordList.innerHTML = "";
      scoreBar.style.width = "0%";
      scoreBar.innerText = "0%";

      const file = resumeFile.files.length > 0 ? resumeFile.files[0] : null;

      if (file) {
        await sendAnalysis(file);
      } else if (resumeText.value.trim()) {
        const blob = new Blob([resumeText.value], { type: "text/plain" });
        const fakeFile = new File([blob], "resume.txt", { type: "text/plain" });
        await sendAnalysis(fakeFile);
      } else {
        alert("Please enter resume text or upload a file.");
      }
    });
  }
});
