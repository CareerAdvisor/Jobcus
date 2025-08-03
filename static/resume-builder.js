// static/resume-builder.js

// — ensure cookies are included on every fetch() —
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!('credentials' in init)) init.credentials = 'same-origin';
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  // grab only the elements we actually use on this page
  const analyzeBtn         = document.getElementById("analyze-btn");
  const resumeText         = document.getElementById("resume-text");
  const resumeFile         = document.getElementById("resumeFile");
  const analyzingIndicator = document.getElementById("analyzingIndicator");

  if (!analyzeBtn) {
    console.warn("[resume-builder] No #analyze-btn found, skipping setup.");
    return;
  }

  // Helper: File → Base64 string
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result.split(",")[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  // Send resume to the API, store result, then redirect
  async function sendAnalysis(file) {
    if (!file) {
      alert("Please paste your resume or upload a file.");
      return;
    }
    // show the little “analyzing” message
    if (analyzingIndicator) analyzingIndicator.style.display = "block";

    try {
      const b64 = await fileToBase64(file);
      const res = await fetch("/api/resume-analysis", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ pdf: b64 })
      });
      if (!res.ok) throw new Error("Server returned " + res.status);

      const data = await res.json();
      if (data.error) {
        alert("Error analyzing resume: " + data.error);
        if (analyzingIndicator) analyzingIndicator.style.display = "none";
        return;
      }

      // ✅ stash it and send the user to the dashboard
      localStorage.setItem("resumeAnalysis", JSON.stringify(data));
      window.location.href = "/dashboard";

    } catch (err) {
      console.error("Analyzer error:", err);
      alert("Could not analyze resume. Please try again.");
      if (analyzingIndicator) analyzingIndicator.style.display = "none";
    }
  }

  // wire up the Analyze button
  analyzeBtn.addEventListener("click", () => {
    // either the uploaded file or the pasted text
    const file = resumeFile.files[0]
               || new File([resumeText.value], "resume.txt", { type: "text/plain" });
    sendAnalysis(file);
  });
});

  // — Optimize My Resume flow —
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

  // — Download helper for the optimized resume —
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
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      const lines = pdf.splitTextToSize(text, 180);
      let y = 10;
      lines.forEach(line => {
        if (y > 280) { pdf.addPage(); y = 10; }
        pdf.text(line, 10, y);
        y += 8;
      });
      pdf.save(`${filename}.pdf`);
    }
  }

  // — Expose downloadOptimizedResume globally —
  window.downloadOptimizedResume = (format) => {
    const text = optimizedOutput.innerText || "";
    downloadHelper(format, text, "resume-optimized");
  };
