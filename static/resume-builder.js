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

  // Send to /api/resume-analysis, then stash & redirect
  async function sendAnalysis(file) {
    let payload;

    // 1) Pasted text only
    if (!file && resumeText.value.trim()) {
      payload = { text: resumeText.value.trim() };

    // 2) Uploaded file (PDF or DOCX)
    } else if (file) {
      const b64 = await fileToBase64(file);
      // stash the original for optimize flow
      localStorage.setItem("resumeBase64", b64);

      if (file.type === "application/pdf") {
        payload = { pdf: b64 };
      } else if (
        file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        payload = { docx: b64 };
      } else {
        alert("Unsupported file type. Please upload PDF or DOCX.");
        return;
      }

    // 3) Neither: complain
    } else {
      alert("Please paste your resume or upload a file.");
      return;
    }

    // show indicator
    if (analyzingIndicator) analyzingIndicator.style.display = "block";

    try {
      const res = await fetch("/api/resume-analysis", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("Server returned " + res.status);

      const data = await res.json();
      if (data.error) {
        alert("Error analyzing resume: " + data.error);
        if (analyzingIndicator) analyzingIndicator.style.display = "none";
        return;
      }

      // ✅ Save analysis JSON & redirect
      localStorage.setItem("resumeAnalysis", JSON.stringify(data));
      window.location.href = "/dashboard";

    } catch (err) {
      console.error("Analyzer error:", err);
      alert("Could not analyze resume. Please try again.");
      if (analyzingIndicator) analyzingIndicator.style.display = "none";
    }
  }

  // Wire the button
  analyzeBtn.addEventListener("click", () => {
    const file = resumeFile.files[0]
               || new File([resumeText.value], "resume.txt", { type: "text/plain" });
    sendAnalysis(file);
  });
});

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("resumeForm");
  const output = document.getElementById("builderResumeOutput");
  const downloads = document.getElementById("resumeDownloadOptions");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    // collect all form fields
    const data = {
      fullName:       form.fullName.value,
      summary:        form.summary.value,
      education:      form.education.value,
      experience:     form.experience.value,
      skills:         form.skills.value,
      certifications: form.certifications.value,
      portfolio:      form.portfolio.value
    };
    try {
      const res = await fetch("/generate-resume", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data)
      });
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      if (json.error) throw new Error(json.error);

      // display the returned HTML
      output.innerHTML = json.formatted_resume;
      // show download buttons
      downloads.style.display = "block";
    } catch (err) {
      console.error("Resume gen error:", err);
      alert("Failed to generate resume. Please try again.");
    }
  });
});
