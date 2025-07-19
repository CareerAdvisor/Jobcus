document.addEventListener("DOMContentLoaded", () => {
  // Resume Builder
  const form = document.getElementById("resumeForm");
  const output = document.getElementById("resumeOutput");
  const previewSection = document.getElementById("resumePreview");
  const downloadBtn = document.getElementById("downloadResumeBtn");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = {
      fullName: form.querySelector('[name="fullName"]').value,
      email: form.querySelector('[name="email"]').value,
      phone: form.querySelector('[name="phone"]').value,
      summary: form.querySelector('[name="summary"]').value,
      education: Array.from(form.querySelectorAll('[name="education[]"]')).map(e => e.value).join('\n'),
      experience: Array.from(form.querySelectorAll('[name="experience[]"]')).map(e => e.value).join('\n'),
      skills: form.querySelector('[name="skills"]').value,
      certifications: form.querySelector('[name="certifications"]').value,
      languages: form.querySelector('[name="languages"]').value,
      portfolio: form.querySelector('[name="portfolio"]').value,
    };

    try {
      const res = await fetch("/generate-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (data.formatted_resume) {
        output.innerHTML = data.formatted_resume;
        previewSection.style.display = "block";
      } else {
        output.innerHTML = "<p style='color:red;'>❌ Failed to generate resume.</p>";
      }
    } catch (error) {
      console.error(error);
      output.innerHTML = "<p style='color:red;'>⚠️ Error: Unable to generate resume.</p>";
    }
  });

  downloadBtn?.addEventListener("click", () => {
    const resumeHTML = output.innerHTML;
    const blob = new Blob([resumeHTML], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resume.html";
    a.click();
    URL.revokeObjectURL(url);
  });

  // Resume Analyzer
  const analyzeBtn = document.getElementById("analyze-btn");
  const resumeTextArea = document.getElementById("resume-text");
  const resumeFileInput = document.getElementById("resume-upload");
  const analyzerResult = document.getElementById("analyzer-result");

  analyzeBtn?.addEventListener("click", async () => {
    analyzerResult.innerHTML = `<p>⏳ Analyzing your resume...</p>`;
    let resumeText = resumeTextArea.value.trim();

    if (!resumeText && resumeFileInput?.files?.length > 0) {
      const file = resumeFileInput.files[0];
      const reader = new FileReader();

      if (file.type.includes("pdf")) {
        reader.onload = async (e) => {
          const base64PDF = e.target.result.split(',')[1];
          sendToAnalyzer({ pdf: base64PDF });
        };
        reader.readAsDataURL(file);
        return;
      } else {
        reader.onload = async (e) => {
          resumeText = e.target.result;
          sendToAnalyzer({ text: resumeText });
        };
        reader.readAsText(file);
        return;
      }
    }

    if (!resumeText) {
      analyzerResult.innerHTML = "<p style='color:red;'>⚠️ Please paste your resume or upload a file.</p>";
      return;
    }

    sendToAnalyzer({ text: resumeText });

    async function sendToAnalyzer(payload) {
      try {
        const res = await fetch("/api/analyze-resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();

        analyzerResult.innerHTML = `
          <h3>✅ AI Feedback</h3>
          <p>${data.analysis}</p>
          <h3>📊 ATS Keyword Match</h3>
          <ul>${data.keywords.map(k => `<li>${k}</li>`).join('')}</ul>
        `;
      } catch (error) {
        console.error(error);
        analyzerResult.innerHTML = "<p style='color:red;'>❌ Failed to analyze resume.</p>";
      }
    }
  });
});
