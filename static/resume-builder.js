// — ensure cookies on fetch()
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  //
  // Part 1: ATS Resume Analyzer
  //
  const analyzeBtn         = document.getElementById("analyze-btn");
  const resumeText         = document.getElementById("resume-text");
  const resumeFile         = document.getElementById("resumeFile");
  const analyzingIndicator = document.getElementById("analyzingIndicator");

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result.split(",")[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  async function sendAnalysis(file) {
    let payload;
    // pasted text
    if (!file && resumeText.value.trim()) {
      payload = { text: resumeText.value.trim() };
    }
    // uploaded file
    else if (file) {
      const b64 = await fileToBase64(file);
      localStorage.setItem("resumeBase64", b64);
      if (file.type === "application/pdf") {
        payload = { pdf: b64 };
      } else if (
        file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        payload = { docx: b64 };
      } else {
        alert("Unsupported file type. Please upload PDF or DOCX.");
        return;
      }
    } else {
      alert("Please paste your resume or upload a file.");
      return;
    }

    // show analyzing spinner
    if (analyzingIndicator) analyzingIndicator.style.display = "block";

    try {
      const res = await fetch("/api/resume-analysis", {
        method:  "POST",
        headers: { "Content-Type":"application/json" },
        body:    JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }

      // stash result + go dashboard
      localStorage.setItem("resumeAnalysis", JSON.stringify(data));
      window.location.href = "/dashboard";
    } catch (err) {
      console.error("Analyzer error:", err);
      alert("Failed to analyze. Try again.");
    } finally {
      if (analyzingIndicator) analyzingIndicator.style.display = "none";
    }
  }

  analyzeBtn?.addEventListener("click", () => {
    const file = resumeFile.files[0] || null;
    sendAnalysis(file);
  });


  //
  // Part 2: “Build Your Resume with AI”
  //
  const form               = document.getElementById("resumeForm");
  const builderIndicator   = document.getElementById("builderGeneratingIndicator");
  const outputContainer    = document.getElementById("builderResumeOutput");
  const downloadOptions    = document.getElementById("resumeDownloadOptions");

  form?.addEventListener("submit", async e => {
    e.preventDefault();
    // show generating spinner
    if (builderIndicator)    builderIndicator.style.display = "block";
    if (downloadOptions)     downloadOptions.style.display  = "none";
    if (outputContainer)     outputContainer.innerHTML       = "";

    // collect form values
    const data = {
      fullName:       form.elements["fullName"].value.trim(),
      title:          form.elements["title"].value.trim(),
      contact:        form.elements["contact"].value.trim(),
      summary:        form.elements["summary"].value.trim(),
      education:      form.elements["education"].value.trim(),
      experience:     form.elements["experience"].value.trim(),
      skills:         form.elements["skills"].value.trim(),
      certifications: form.elements["certifications"].value.trim(),
      portfolio:      form.elements["portfolio"].value.trim()
    };

    try {
      const res  = await fetch("/generate-resume", {
        method:  "POST",
        headers: { "Content-Type":"application/json" },
        body:    JSON.stringify(data)
      });
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      if (json.error) throw new Error(json.error);

      // inject AI‐returned HTML
      outputContainer.innerHTML = json.formatted_resume;
      // reveal download buttons
      if (downloadOptions) downloadOptions.style.display = "block";
    } catch (err) {
      console.error("Generate error:", err);
      alert("Failed to generate. Try again.");
    } finally {
      if (builderIndicator) builderIndicator.style.display = "none";
    }
  });
});

// — Download helper for generated resume —
function downloadResume(format) {
  const out = document.getElementById("builderResumeOutput");
  const text = out?.innerText || "";
  if (format === "txt") {
    const blob = new Blob([text], { type:"text/plain" });
    saveAs(blob, `resume.${format}`);
  } else if (format === "docx") {
    const { Document,Packer,Paragraph,TextRun } = window.docx;
    const doc = new Document({
      sections: [{ children: text.split("\n").map(l =>
        new Paragraph({ children:[ new TextRun({ text:l }) ] })
      ) }]
    });
    Packer.toBlob(doc).then(b => saveAs(b, `resume.${format}`));
  } else if (format === "pdf") {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit:"mm", format:"a4" });
    const lines = pdf.splitTextToSize(text, 180);
    let y = 10;
    lines.forEach(line => {
      if (y > 280) { pdf.addPage(); y=10; }
      pdf.text(line, 10, y);
      y += 8;
    });
    pdf.save(`resume.${format}`);
  }
}
