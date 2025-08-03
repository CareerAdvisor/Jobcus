// — ensure cookies are included on fetch() —
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!('credentials' in init)) init.credentials = 'same-origin';
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  //
  // Part 1: AI Resume Analyzer
  //
  const analyzeBtn         = document.getElementById("analyze-btn");
  const resumeText         = document.getElementById("resume-text");
  const resumeFile         = document.getElementById("resumeFile");
  const analyzingIndicator = document.getElementById("analyzingIndicator");

  // Helper: File → Base64
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result.split(",")[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  // 1) Build payload (text, PDF, or DOCX)
  // 2) POST to /api/resume-analysis
  // 3) stash → localStorage → redirect to /dashboard
  async function sendAnalysis(file) {
    let payload;

    if (!file && resumeText.value.trim()) {
      payload = { text: resumeText.value.trim() };
    } else if (file) {
      const b64 = await fileToBase64(file);
      localStorage.setItem("resumeBase64", b64);

      if (file.type === "application/pdf") {
        payload = { pdf: b64 };
      } else if (
        file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        payload = { docx: b64 };
      } else {
        alert("Unsupported type. Upload PDF or DOCX.");
        return;
      }
    } else {
      alert("Please paste or upload your resume.");
      return;
    }

    if (analyzingIndicator) analyzingIndicator.style.display = "block";

    try {
      const res = await fetch("/api/resume-analysis", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Server returned " + res.status);

      const data = await res.json();
      if (data.error) {
        alert("Analysis error: " + data.error);
        throw new Error(data.error);
      }

      localStorage.setItem("resumeAnalysis", JSON.stringify(data));
      window.location.href = "/dashboard";

    } catch (err) {
      console.error("Analyzer error:", err);
      alert("Could not analyze resume. Try again.");
      if (analyzingIndicator) analyzingIndicator.style.display = "none";
    }
  }

  if (analyzeBtn) {
    analyzeBtn.addEventListener("click", () => {
      const file = resumeFile.files[0] || null;
      sendAnalysis(file);
    });
  }


  //
  // Part 2: “Build Your Resume with AI” form → /generate-resume
  //
  const form             = document.getElementById("resumeForm");
  const builderIndicator = document.getElementById("builderGeneratingIndicator");
  const output           = document.getElementById("builderResumeOutput");
  const downloads        = document.getElementById("resumeDownloadOptions");

  if (form) {
    form.addEventListener("submit", async e => {
      e.preventDefault();

      if (builderIndicator) builderIndicator.style.display = "block";
      if (downloads)        downloads.style.display = "none";
      if (output)           output.innerHTML = "";

      // Gather form data
      const data = {
        fullName:       form.elements.fullName.value.trim(),
        title:          form.elements.title.value.trim(),
        contact:        form.elements.contact.value.trim(),
        summary:        form.elements.summary.value.trim(),
        education:      form.elements.education.value.trim(),
        experience:     form.elements.experience.value.trim(),
        skills:         form.elements.skills.value.trim(),
        certifications: form.elements.certifications.value.trim(),
        portfolio:      form.elements.portfolio.value.trim(),
      };

      try {
        const res  = await fetch("/generate-resume", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(data),
        });
        if (!res.ok) throw new Error(res.statusText);
        const json = await res.json();
        if (json.error) throw new Error(json.error);

        if (builderIndicator) builderIndicator.style.display = "none";
        output.innerHTML = json.formatted_resume;
        if (downloads)     downloads.style.display = "block";

      } catch (err) {
        console.error("🚨 Generate resume error:", err);
        if (builderIndicator) builderIndicator.style.display = "none";
        alert("Failed to generate resume. Please try again.");
      }
    });
  }
});


// — Simple download helper for the generated resume —
function downloadResume(format) {
  const outputEl = document.getElementById("builderResumeOutput");
  const text     = (outputEl && outputEl.innerText) || "";
  if (format === "txt") {
    const blob = new Blob([text], { type: "text/plain" });
    saveAs(blob, `resume.${format}`);
  } else if (format === "docx") {
    const { Document, Packer, Paragraph, TextRun } = window.docx;
    const doc = new Document({
      sections: [{
        children: text.split("\n").map(line =>
          new Paragraph({ children:[ new TextRun({ text: line }) ] })
        )
      }]
    });
    Packer.toBlob(doc).then(blob => saveAs(blob, `resume.${format}`));
  } else if (format === "pdf") {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit:"mm", format:"a4" });
    const lines = pdf.splitTextToSize(text, 180);
    let y = 10;
    lines.forEach(line => {
      if (y > 280) { pdf.addPage(); y = 10; }
      pdf.text(line, 10, y);
      y += 8;
    });
    pdf.save(`resume.${format}`);
  }
}
