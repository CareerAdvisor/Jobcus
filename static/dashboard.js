// static/dashboard.js

document.addEventListener("DOMContentLoaded", () => {
  // --- 1) greeting + circle + issues/strengths (your existing code) ---
  const greetEl = document.getElementById("dashboardGreeting");
  const first   = !localStorage.getItem("dashboardVisited");
  if (greetEl) {
    greetEl.textContent = first ? "Welcome" : "Welcome Back";
    localStorage.setItem("dashboardVisited", "true");
  }

  const raw = localStorage.getItem("resumeAnalysis");
  if (!raw) return;  // no analysis yet

  const data = JSON.parse(raw);
  // show/hide
  document.getElementById("no-analysis-cta").style.display  = "none";
  document.getElementById("resume-analysis").style.display = "block";

  // animate the circle
  const circle = document.querySelector(".progress-circle");
  const path   = circle.querySelector(".progress");
  const txt    = circle.querySelector(".percentage");
  let score    = data.score || 0, curr = 0;
  const step   = score > 0 ? 1 : -1;
  circle.dataset.score = score;
  const iv = setInterval(() => {
    if (curr === score) return clearInterval(iv);
    curr += step;
    path.setAttribute("stroke-dasharray", `${curr},100`);
    txt.textContent = `${curr}%`;
  }, 20);

  // fill issues & strengths
  const issues    = document.getElementById("top-issues");
  const strengths = document.getElementById("good-points");
  issues.innerHTML    = "";
  strengths.innerHTML = "";
  (data.analysis.issues || []).forEach(i => {
    const li = document.createElement("li"); li.textContent = i;
    issues.appendChild(li);
  });
  (data.analysis.strengths || []).forEach(s => {
    const li = document.createElement("li"); li.textContent = s;
    strengths.appendChild(li);
  });

  // --- 2) optimize-resume wiring ---
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result.split(",")[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  const optimizeBtn = document.getElementById("optimize-btn");
  const loadingEl   = document.getElementById("optimized-loading");
  const outputEl    = document.getElementById("optimized-output");
  const downloadsEl = document.getElementById("optimized-downloads");
  const resumeBase64= localStorage.getItem("resumeBase64");

  if (optimizeBtn && resumeBase64) {
    optimizeBtn.addEventListener("click", async () => {
      loadingEl.style.display   = "block";
      outputEl.style.display    = "none";
      downloadsEl.style.display = "none";

      try {
        const res = await fetch("/api/optimize-resume", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ pdf: resumeBase64 })
        });
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        loadingEl.style.display   = "none";
        outputEl.textContent       = data.optimized;
        outputEl.style.display     = "block";
        downloadsEl.style.display  = "block";
      } catch (err) {
        console.error("Optimize error:", err);
        loadingEl.style.display = "none";
        alert("Failed to optimize resume. Try again.");
      }
    });
  }
});

// Download helper for optimized resume
function downloadHelper(format, text, filename) {
  if (format === "txt") {
    const blob = new Blob([text], { type: "text/plain" });
    saveAs(blob, `${filename}.txt`);
  } else if (format === "docx") {
    const { Document, Packer, Paragraph, TextRun } = window.docx;
    const doc = new Document({
      sections: [{ children: text.split("\n").map(line =>
        new Paragraph({ children: [ new TextRun({ text: line }) ] })
      ) }]
    });
    Packer.toBlob(doc).then(blob => saveAs(blob, `${filename}.docx`));
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
    pdf.save(`${filename}.pdf`);
  }
}

window.downloadOptimizedResume = format => {
  const text = document.getElementById("optimized-output").innerText || "";
  downloadHelper(format, text, "resume-optimized");
};
