document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("resumeForm");
  const popup = document.getElementById("optimize-popup");
  const resumeOutput = document.getElementById("resumeOutput");
  const downloadOptions = document.getElementById("resumeDownloadOptions");
  const acceptBtn = document.getElementById("acceptOptimize");
  const declineBtn = document.getElementById("declineOptimize");

  const analyzeBtn = document.getElementById("analyze-btn");
  const textInput = document.getElementById("resume-text");
  const fileInput = document.getElementById("resumeFile");
  const resultBox = document.getElementById("analyzer-result");
  const scoreVisual = document.getElementById("score-visual");
  const scoreBar = document.getElementById("score-bar");
  const keywordMatch = document.getElementById("keyword-match");

  let optimizeWithAI = true;
  let shouldBuild = false;

  if (!form || !popup || !acceptBtn || !declineBtn || !resumeOutput) {
    console.warn("Missing required elements for resume builder.");
    return;
  }

  // === Resume Builder ===
  form.addEventListener("submit", function (e) {
    if (!shouldBuild) {
      e.preventDefault();
      popup.classList.remove("hidden"); // Show popup
      return;
    }
    shouldBuild = false; // reset after popup decision
  });

  acceptBtn.onclick = () => {
    optimizeWithAI = true;
    popup.classList.add("hidden");
    shouldBuild = true;
    form.dispatchEvent(new Event("submit"));
  };

  declineBtn.onclick = () => {
    optimizeWithAI = false;
    popup.classList.add("hidden");
    shouldBuild = true;
    form.dispatchEvent(new Event("submit"));
  };

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!shouldBuild) return;

    resumeOutput.innerHTML = "⏳ Generating resume...";
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
        resumeOutput.innerHTML = cleaned;
        if (downloadOptions) downloadOptions.style.display = "block";
        window.scrollTo({ top: resumeOutput.offsetTop, behavior: "smooth" });
      } else {
        resumeOutput.innerHTML = `<p style='color:red;'>❌ Failed to generate resume.</p>`;
      }
    } catch (error) {
      console.error(error);
      resumeOutput.innerHTML = `<p style='color:red;'>⚠️ Server error. Try again.</p>`;
    }
  });

  function cleanAIText(content) {
    return content
      .replace(/```html|```/g, "")
      .replace(/(?:Certainly!|Here's a resume|This HTML).*?\n/gi, "")
      .trim();
  }

  window.downloadResume = function (format) {
    const text = resumeOutput.innerText || "Your resume content here";
    if (format === "txt") {
      const blob = new Blob([text], { type: "text/plain" });
      saveAs(blob, "resume.txt");
    } else if (format === "pdf") {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      const lines = doc.splitTextToSize(text, 180);
      doc.text(lines, 10, 10);
      doc.save("resume.pdf");
    } else if (format === "doc") {
      const blob = new Blob([text], { type: "application/msword" });
      saveAs(blob, "resume.doc");
    }
  };

  // === Resume Analyzer ===
  if (analyzeBtn && textInput && fileInput && resultBox) {
    analyzeBtn.addEventListener("click", async () => {
      resultBox.innerHTML = "⏳ Analyzing resume...";
      const text = textInput.value.trim();
      const file = fileInput.files[0];
      let payload = {};

      if (text) {
        payload.text = text;
      } else if (file) {
        try {
          const fileData = await file.arrayBuffer();
          const base64Pdf = btoa(String.fromCharCode(...new Uint8Array(fileData)));
          payload.pdf = base64Pdf;
        } catch (err) {
          console.error("File read error:", err);
          resultBox.innerHTML = "<p style='color:red;'>❌ Failed to read uploaded file.</p>";
          return;
        }
      } else {
        resultBox.innerHTML = "<p style='color:red;'>⚠️ Please paste your resume or upload a file.</p>";
        return;
      }

      try {
        const res = await fetch("/api/analyze-resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res.json();

        if (data.error) {
          resultBox.innerHTML = `<p style='color:red;'>❌ ${data.error}</p>`;
          return;
        }

        // Score Bar Logic
        if (scoreVisual && scoreBar) {
          const score = Math.min(data.score || 0, 100);
          scoreVisual.style.display = "block";
          scoreBar.style.width = score + "%";
          scoreBar.textContent = score + "%";

          if (score >= 75) {
            scoreBar.style.backgroundColor = "#16a34a";
          } else if (score >= 50) {
            scoreBar.style.backgroundColor = "#facc15";
          } else {
            scoreBar.style.backgroundColor = "#dc2626";
          }
        }

        if (data.keywords && data.keywords.length) {
          keywordMatch.innerHTML = `
            <p><strong>Matched Keywords:</strong></p>
            <ul style="padding-left: 20px;">
              ${data.keywords.map(kw => `<li>${kw}</li>`).join("")}
            </ul>
          `;
        }

        resultBox.innerHTML = `<p>${data.analysis}</p>`;
      } catch (err) {
        console.error("Analyzer error:", err);
        resultBox.innerHTML = "<p style='color:red;'>⚠️ Could not analyze resume. Try again.</p>";
      }
    });
  }
});
