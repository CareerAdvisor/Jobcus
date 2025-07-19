document.getElementById("resumeForm").addEventListener("submit", async function (e) {
  e.preventDefault();
  const form = e.target;
  const payload = {
    fullName: form.fullName.value,
    summary: form.summary.value,
    education: form.education.value,
    experience: form.experience.value,
    skills: form.skills.value,
    certifications: form.certifications.value,
    languages: form.languages.value,
    portfolio: form.portfolio.value,
  };

  const res = await fetch("/generate-resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  const output = document.getElementById("resumeOutput");

  if (data.formatted_resume) {
    output.innerHTML = `<iframe id="resumePreview" style="width: 100%; height: 700px; border: 1px solid #ccc;"></iframe>`;
    const iframe = document.getElementById("resumePreview").contentWindow.document;
    iframe.open();
    iframe.write(data.formatted_resume);
    iframe.close();

    document.getElementById("downloadResumeBtn").style.display = "inline-block";
    document.getElementById("downloadResumeBtn").onclick = function () {
      const doc = document.getElementById("resumePreview").contentWindow;
      const blob = new Blob([doc.documentElement.outerHTML], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "Resume.html";
      link.click();
    };
  } else {
    output.innerHTML = "<p style='color:red;'>Failed to generate resume</p>";
  }
});

// Resume Analyzer
document.getElementById("analyze-btn").addEventListener("click", async function () {
  const resultContainer = document.getElementById("analyzer-result");
  const textArea = document.getElementById("resume-text");
  const fileInput = document.getElementById("resumeFile");

  resultContainer.innerHTML = `<p>⏳ Analyzing...</p>`;

  let resumeText = textArea.value.trim();

  if (!resumeText && fileInput.files.length > 0) {
    const file = fileInput.files[0];
    if (file.type.includes("pdf")) {
      const reader = new FileReader();
      reader.onload = async function (e) {
        const base64PDF = e.target.result.split(",")[1];
        sendToAnalyzer({ pdf: base64PDF });
      };
      reader.readAsDataURL(file);
      return;
    } else {
      resumeText = await file.text();
    }
  }

  if (!resumeText) {
    resultContainer.innerHTML = "<p style='color:red;'>Paste your resume or upload a file</p>";
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

      resultContainer.innerHTML = `
        <div>
          <h3>✅ Score: ${data.score || "N/A"}</h3>
          <p><strong>Suggestions:</strong></p>
          <p>${data.analysis.replace(/\n/g, "<br>")}</p>
          <p><strong>Recommended Keywords:</strong></p>
          <ul>${(data.keywords || []).map(k => `<li>${k}</li>`).join("")}</ul>
        </div>
      `;
    } catch (err) {
      resultContainer.innerHTML = "<p style='color:red;'>Error analyzing resume.</p>";
      console.error(err);
    }
  }
});
