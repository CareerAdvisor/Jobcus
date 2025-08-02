// static/resume-builder.js

// — ensure cookies are included on every fetch() —
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || 'same-origin';
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  console.log("🚀 resume-builder.js loaded");

  // — Element refs —
  const analyzeBtn         = document.getElementById("analyze-btn");
  const optimizeBtn        = document.getElementById("optimizeResume");
  const resumeText         = document.getElementById("resume-text");
  const resumeFile         = document.getElementById("resumeFile");
  const analyzerResult     = document.getElementById("analyzer-result");
  const scoreBar           = document.getElementById("score-bar");
  const keywordList        = document.getElementById("keyword-list");
  const postAnalysisCTA    = document.getElementById("post-analysis-cta");
  const optimizedLoading   = document.getElementById("optimizedLoading");
  const optimizedOutput    = document.getElementById("analyzerResumeOutput");
  const optimizedDownloads = document.getElementById("optimizedDownloadOptions");

  // — Helpers for rendering lists & animating bars (still used by optimize section) —
  function renderList(ul, items) {
    ul.innerHTML = "";
    items.forEach(text => {
      const li = document.createElement("li");
      li.textContent = text;
      ul.appendChild(li);
    });
  }
  function animateScore(target) {
    let current = 0;
    scoreBar.style.width = "0%";
    scoreBar.textContent = "0%";
    const step = target > 0 ? 1 : -1;
    const iv = setInterval(() => {
      if (current === target) {
        clearInterval(iv);
        return;
      }
      current += step;
      scoreBar.style.width = `${current}%`;
      scoreBar.textContent = `${current}%`;
    }, 15);
  }

  // — REPLACE THIS with your new store+redirect flow —
  async function sendAnalysis(file) {
    if (!file) {
      alert("Please paste your resume or upload a file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(",")[1];
      try {
        const res = await fetch("/api/resume-analysis", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ pdf: base64 })
        });
        if (!res.ok) throw new Error("Server returned " + res.status);

        const data = await res.json();
        if (data.error) {
          alert("Error analyzing resume: " + data.error);
          return;
        }

        // ✅ Save the analysis into localStorage
        localStorage.setItem("resumeAnalysis", JSON.stringify(data));
        // 🔄 Redirect to the dashboard
        window.location.href = "/dashboard";

      } catch (err) {
        console.error("Analyzer error:", err);
        alert("Could not analyze resume. Please try again.");
      }
    };
    reader.readAsDataURL(file);
  }

  // — Wire up Analyze button to new sendAnalysis —
  analyzeBtn.addEventListener("click", () => {
    const file = resumeFile.files[0]
               || new File([resumeText.value], "resume.txt", { type: "text/plain" });
    sendAnalysis(file);
  });

  // — Convert File → base64 helper for optimize flow —
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result.split(",")[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  // — Optimize My Resume flow (unchanged) —
  optimizeBtn.addEventListener("click", async () => {
    optimizedLoading.style.display    = "block";
    optimizedOutput.style.display     = "none";
    optimizedDownloads.style.display  = "none";

    let payload = {};
    if (resumeFile.files.length) {
      try {
        payload.pdf = await fileToBase64(resumeFile.files[0]);
      } catch {
        alert("Failed to read the file for optimization.");
        optimizedLoading.style.display = "none";
        return;
      }
    } else if (resumeText.value.trim()) {
      payload.text = resumeText.value.trim();
    } else {
      alert("No resume content found to optimize.");
      optimizedLoading.style.display = "none";
      return;
    }

    try {
      const res  = await fetch("/api/optimize-resume", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      optimizedLoading.style.display   = "none";
      optimizedOutput.textContent      = data.optimized;
      optimizedOutput.style.display    = "block";
      optimizedDownloads.style.display = "block";

    } catch (err) {
      console.error("⚠️ Optimize error:", err);
      optimizedLoading.style.display = "none";
      alert("Failed to optimize resume. Try again.");
    }
  });

  // — Download helper (for optimized resume) —
  function downloadHelper(format, text, filename) {
    if (format === "txt") {
      const blob = new Blob([text], { type: "text/plain" });
      saveAs(blob, `${filename}.txt`);
    } else if (format === "docx") {
      const { Document, Packer, Paragraph, TextRun } = window.docx;
      const doc = new Document({
        sections: [{
          children: text.split("\n").map(line =>
            new Paragraph({ children: [new TextRun({ text: line })] })
          )
        }]
      });
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

  // — Expose download for the optimized resume —
  window.downloadOptimizedResume = (format) => {
    const text = optimizedOutput.innerText || "";
    downloadHelper(format, text, "resume-optimized");
  };
});
