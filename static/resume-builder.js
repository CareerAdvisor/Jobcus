// resume-builder.js

document.addEventListener("DOMContentLoaded", function () {
  // ——— DOM elements ———
  const form                  = document.getElementById("resumeForm");
  const builderResumeOutput   = document.getElementById("builderResumeOutput");
  const analyzerResumeOutput  = document.getElementById("analyzerResumeOutput");
  const resumeText            = document.getElementById("resume-text");
  const resumeFile            = document.getElementById("resumeFile");
  const analyzeBtn            = document.getElementById("analyze-btn");
  const analyzerResult        = document.getElementById("analyzer-result");
  const scoreBar              = document.getElementById("score-bar");
  const keywordList           = document.getElementById("keyword-list");
  const downloadOptions       = document.getElementById("resumeDownloadOptions");
  const optimizedDownloadOpts = document.getElementById("optimizedDownloadOptions");

  let optimizeWithAI = true;
  let shouldBuild    = true;

  if (!form || !analyzerResult || !analyzeBtn) {
    console.warn("Missing required elements for resume builder.");
    return;
  }

  // ——— Utility to clean up AI-generated HTML ———
  function cleanAIText(content) {
    return content
      .replace(/```html|```/g, "")
      .replace(/(?:Certainly!|Here's a resume|This HTML).*?\n/gi, "")
      .trim();
  }

  // ——— 1) “Build Your Resume” form ———
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!shouldBuild) return;

    builderResumeOutput.innerHTML = "⏳ Generating resume...";
    const data = Object.fromEntries(new FormData(form).entries());
    data.optimize = optimizeWithAI;

    try {
      const res = await fetch("/generate-resume", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      });
      const result = await res.json();

      if (result.formatted_resume) {
        const cleaned = cleanAIText(result.formatted_resume);
        builderResumeOutput.innerHTML = cleaned;
        if (downloadOptions) downloadOptions.style.display = "block";
        window.scrollTo({ top: builderResumeOutput.offsetTop, behavior: "smooth" });
      } else {
        builderResumeOutput.innerHTML = `<p style="color:red;">❌ Failed to generate resume.</p>`;
      }
    } catch (err) {
      console.error("Builder error:", err);
      builderResumeOutput.innerHTML = `<p style="color:red;">⚠️ Server error. Try again.</p>`;
    }
  });

  // ——— Download helpers ———
  function downloadHelper(format, text, filename) {
    if (format === "txt") {
      const blob = new Blob([text], { type: "text/plain" });
      saveAs(blob, `${filename}.txt`);
    } else if (format === "docx") {
      const { Document, Packer, Paragraph, TextRun } = window.docx;
      const doc = new Document();
      const lines = text.split("\n").map(line =>
        new Paragraph({ children: [new TextRun({ text: line })] })
      );
      doc.addSection({ children: lines });
      Packer.toBlob(doc).then(blob => saveAs(blob, `${filename}.docx`));
    } else if (format === "pdf") {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const lines = doc.splitTextToSize(text, 180);
      let y = 10;
      lines.forEach(line => {
        if (y > 280) { doc.addPage(); y = 10; }
        doc.text(line, 10, y);
        y += 8;
      });
      doc.save(`${filename}.pdf`);
    }
  }

  window.downloadResume = format => {
    const text = builderResumeOutput.innerText || "Your resume content here";
    downloadHelper(format, text, "resume");
  };
  window.downloadOptimizedResume = format => {
    const content = analyzerResumeOutput.innerText || "Optimized resume content";
    downloadHelper(format, content, "resume-optimized");
  };

  // ——— 2) “Analyze Resume” flow ———
  async function sendAnalysis(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = reader.result.split(",")[1];
      if (!b64) {
        alert("Failed to read file. Please try another PDF or TXT file.");
        return;
      }

      try {
        const res = await fetch("/api/resume-analysis", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ pdf: b64 }),
        });
        if (!res.ok) throw new Error("Server returned " + res.status);

        const data = await res.json();
        if (data.error) {
          alert("Error analyzing resume: " + data.error);
          return;
        }

        // Save & redirect
        localStorage.setItem("resumeAnalysis", JSON.stringify(data));
        window.location.href = "/dashboard";

      } catch (err) {
        console.error("Analyzer error:", err);
        alert("⚠️ Could not analyze resume. Please try again.");
      }
    };
    reader.readAsDataURL(file);
  }

  analyzeBtn.addEventListener("click", () => {
    analyzerResult.innerHTML = "⏳ Analyzing...";
    keywordList.innerHTML  = "";
    scoreBar.style.width   = "0%";
    scoreBar.innerText     = "0%";

    const file = resumeFile.files[0] ||
                 (resumeText.value.trim()
                   ? new File([resumeText.value], "resume.txt", { type: "text/plain" })
                   : null);

    if (!file) {
      return alert("Please enter resume text or upload a file.");
    }
    sendAnalysis(file);
  });
});
