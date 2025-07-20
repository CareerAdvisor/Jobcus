document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("resumeForm");
  const resumeOutput = document.getElementById("resumeOutput");
  const resumePreview = document.getElementById("resumePreview");
  const downloadBtn = document.getElementById("downloadResumeBtn");
  const optimizePopup = document.getElementById("optimize-popup");

  let optimizeWithAI = true;

  document.getElementById("acceptOptimize").onclick = () => {
    optimizeWithAI = true;
    optimizePopup.classList.add("hidden");
    form.dispatchEvent(new Event("submit"));
  };
  document.getElementById("declineOptimize").onclick = () => {
    optimizeWithAI = false;
    optimizePopup.classList.add("hidden");
    form.dispatchEvent(new Event("submit"));
  };

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    if (!optimizePopup.classList.contains("hidden")) return;

    const data = Object.fromEntries(new FormData(form));
    const response = await fetch("/generate-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    const result = await response.json();
    resumeOutput.innerHTML = result.formatted_resume;
    resumePreview.style.display = "block";
  });

  // Trigger popup before resume is generated
  form.addEventListener("submit", function (e) {
    if (optimizePopup.classList.contains("hidden")) return;
    e.preventDefault();
    optimizePopup.classList.remove("hidden");
  });

  // Resume Download as PDF
  downloadBtn.onclick = () => {
    const content = resumeOutput.innerHTML;
    const win = window.open('', '', 'height=842,width=595');
    win.document.write('<html><head><title>Resume</title>');
    win.document.write('</head><body>');
    win.document.write(content);
    win.document.write('</body></html>');
    win.document.close();
    win.print();
  };

  // Resume Analyzer
document.getElementById("analyze-btn").addEventListener("click", async () => {
  const textArea = document.getElementById("resume-text").value.trim();
  const file = document.getElementById("resumeFile").files[0];
  const resultContainer = document.getElementById("analyzer-result");

  let resumeText = textArea;
  if (!resumeText && file) {
    resumeText = await file.text();
  }

  if (!resumeText) {
    resultContainer.innerHTML = "<p style='color:red;'>Please paste your resume or upload a file.</p>";
    return;
  }

  resultContainer.innerHTML = "⏳ Analyzing...";

  try {
    const res = await fetch("/api/analyze-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: resumeText })
    });
    const data = await res.json();

    // Display text result
    resultContainer.innerHTML = `
      <h3>✅ Resume Score: ${data.score || 'N/A'}/100</h3>
      <h4>Recommendations:</h4>
      <ul>${data.suggestions?.map(item => `<li>${item}</li>`).join("") || "<li>No suggestions returned</li>"}</ul>
    `;

    // Draw chart
    const ctx = document.getElementById("scoreChart").getContext("2d");
    new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Score", "Remaining"],
        datasets: [{
          label: "Resume Score",
          data: [data.score || 0, 100 - (data.score || 0)],
          backgroundColor: ["#4CAF50", "#ddd"],
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false }
        }
      }
    });

  } catch (err) {
    resultContainer.innerHTML = "<p style='color:red;'>⚠️ Could not analyze resume.</p>";
    console.error(err);
  }
});
