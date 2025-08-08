// static/js/dashboard.js

document.addEventListener("DOMContentLoaded", () => {
  //
  // 1) Greeting
  //
  const greetEl = document.getElementById("dashboardGreeting");
  if (greetEl) {
    const first = !localStorage.getItem("dashboardVisited");
    greetEl.textContent = first ? "Welcome" : "Welcome Back";
    localStorage.setItem("dashboardVisited", "true");
  }

  // 2) Show proper dashboard state
  const raw = localStorage.getItem("resumeAnalysis");
  const card = document.getElementById("resume-score-card");
  const noCTA = document.getElementById("no-analysis-cta");
  const analysisSection = document.getElementById("resume-analysis");
  const metricNote = document.getElementById("metric-note");

  if (!raw) {
    // Hide progress circle & analysis
    if (card) card.style.display = "none";
    if (analysisSection) analysisSection.style.display = "none";
    if (noCTA) noCTA.style.display = "block";
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("Could not parse resumeAnalysis");
    if (card) card.style.display = "none";
    if (analysisSection) analysisSection.style.display = "none";
    if (noCTA) noCTA.style.display = "block";
    return;
  }

  // Show card and analysis, hide CTA
  if (card) card.style.display = "block";
  if (noCTA) noCTA.style.display = "none";
  if (analysisSection) analysisSection.style.display = "block";

  // 3) Animate progress circle
  const circle = document.querySelector(".progress-circle");
  if (circle) {
    const path = circle.querySelector(".progress");
    const text = circle.querySelector(".percentage");
    const target = data.score || 0;
    let current = 0;
    const step = target > 0 ? 1 : -1;
    circle.dataset.score = target;

    // Animate score up to value
    const iv = setInterval(() => {
      if (current === target) return clearInterval(iv);
      current += step;
      path.setAttribute("stroke-dasharray", `${current},100`);
      text.textContent = `${current}%`;
    }, 20);

    // Update last analyzed
    if (metricNote && data.lastAnalyzed) {
      metricNote.textContent = `Last analyzed: ${data.lastAnalyzed}`;
    }
  }

  // 4) Populate Issues, Strengths, Suggestions
  const issuesUL = document.getElementById("top-issues");
  if (issuesUL) {
    issuesUL.innerHTML = "";
    (data.analysis?.issues || []).forEach(i => {
      const li = document.createElement("li");
      li.textContent = i;
      issuesUL.appendChild(li);
    });
  }

  const strengthsUL = document.getElementById("good-points");
  if (strengthsUL) {
    strengthsUL.innerHTML = "";
    (data.analysis?.strengths || []).forEach(s => {
      const li = document.createElement("li");
      li.textContent = s;
      strengthsUL.appendChild(li);
    });
  }

  const suggestionsUL = document.getElementById("suggestions-list");
  if (suggestionsUL) {
    suggestionsUL.innerHTML = "";
    (data.suggestions || []).forEach(s => {
      const li = document.createElement("li");
      li.textContent = s;
      suggestionsUL.appendChild(li);
    });
  }

  // 5) Optimize-flow: wire up #optimize-btn
  const optimizeBtn = document.getElementById("optimize-btn");
  const loadingEl   = document.getElementById("optimized-loading");
  const outputEl    = document.getElementById("optimized-output");
  const downloadsEl = document.getElementById("optimized-downloads");
  const resumeBase64 = localStorage.getItem("resumeBase64");

  if (optimizeBtn) {
    optimizeBtn.addEventListener("click", async () => {
      if (loadingEl)   loadingEl.style.display    = "block";
      if (outputEl)    outputEl.style.display     = "none";
      if (downloadsEl) downloadsEl.style.display  = "none";

      if (!resumeBase64) {
        alert("Missing your original resume data for optimization.");
        if (loadingEl) loadingEl.style.display = "none";
        return;
      }

      try {
        const res = await fetch("/api/optimize-resume", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ pdf: resumeBase64 })
        });
        const js = await res.json();
        if (!res.ok || js.error) throw new Error(js.error || res.statusText);

        if (loadingEl)   loadingEl.style.display   = "none";
        if (outputEl) {
          outputEl.textContent    = js.optimized;
          outputEl.style.display  = "block";
        }
        if (downloadsEl) downloadsEl.style.display = "block";

      } catch (err) {
        console.error("Optimize error:", err);
        if (loadingEl) loadingEl.style.display = "none";
        alert("Failed to optimize resume. Try again.");
      }
    });
  }
});

// — Download helper for optimized resume —
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

window.downloadOptimizedResume = function(format) {
  const text = document.getElementById("optimized-output").innerText || "";
  downloadHelper(format, text, "resume-optimized");
};
