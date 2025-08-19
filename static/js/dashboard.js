// Keep cookies for SameSite/Lax
;(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  // Greeting
  const greetEl = document.getElementById("dashboardGreeting");
  if (greetEl) {
    const first = !localStorage.getItem("dashboardVisited");
    greetEl.textContent = first ? "Welcome" : "Welcome Back";
    localStorage.setItem("dashboardVisited", "true");
  }

  // Elements
  const card            = document.getElementById("resume-score-card");
  const noCTA           = document.getElementById("no-analysis-cta");
  const analysisSection = document.getElementById("resume-analysis");
  const metricNote      = document.getElementById("metric-note");
  const atsGrid         = document.getElementById("ats-grid");

  const fileInput   = document.getElementById("dashResumeFile");
  const jobDesc     = document.getElementById("dashJobDesc");
  const analyzeBtn  = document.getElementById("dashAnalyzeBtn");
  const analyzingEl = document.getElementById("dashAnalyzing");
  const openReBtn   = document.getElementById("openReanalyze");

  const dropzone     = document.getElementById("dropzone");
  const dzFileNameEl = document.getElementById("dzFileName");

  const issuesUL      = document.getElementById("top-issues");
  const strengthsUL   = document.getElementById("good-points");
  const suggestionsUL = document.getElementById("suggestions-list");

  const kwPanel     = document.getElementById("kw-panel");
  const kwMatchedUL = document.getElementById("kw-matched");
  const kwMissingUL = document.getElementById("kw-missing");

  const sectionsPanel = document.getElementById("sections-panel");
  const secPresentUL  = document.getElementById("sec-present");
  const secMissingUL  = document.getElementById("sec-missing");

  // Helpers
  const colorForScore = (s = 0) => (s >= 80 ? "#16A34A" : s >= 60 ? "#F59E0B" : "#E11D48");

  function renderATSBreakdown(breakdown = null) {
    atsGrid.innerHTML = "";
    if (!breakdown) return;

    const rows = [
      ["Formatting",  breakdown.formatting],
      ["Keywords",    breakdown.keywords],
      ["Sections",    breakdown.sections],
      ["Readability", breakdown.readability],
      ["Length",      breakdown.length],
      ["Parseable",   breakdown.parseable === true ? 100 : (breakdown.parseable === false ? 0 : null)]
    ];

    rows.forEach(([label, val]) => {
      if (val == null) return;
      const color = colorForScore(val);
      const pill  = document.createElement("div");
      pill.className = "ats-pill";
      pill.innerHTML = `
        <div class="ats-top">
          <span class="ats-label">${label}</span>
          <span class="ats-percent" style="color:${color}">${Math.round(val)}%</span>
        </div>
        <div class="ats-bar">
          <div class="ats-bar__fill" style="width:${Math.max(0, Math.min(100, val))}%;background:${color}"></div>
        </div>`;
      atsGrid.appendChild(pill);
    });
  }

  function renderScore(score = 0, lastAnalyzed = null) {
    const circle = document.querySelector(".progress-circle");
    if (!circle) return;
    const path = circle.querySelector(".ring-progress");
    const text = circle.querySelector(".ring-text");

    const color = colorForScore(score);
    path.setAttribute("stroke", color);

    let current = 0;
    path.setAttribute("stroke-dasharray", `0,100`);
    text.textContent = `0%`;

    const step = score > 0 ? 1 : -1;
    const iv = setInterval(() => {
      if (current === score) { clearInterval(iv); return; }
      current += step;
      path.setAttribute("stroke-dasharray", `${current},100`);
      text.textContent = `${current}%`;
    }, 15);

    if (metricNote && lastAnalyzed) {
      metricNote.textContent = `Last analyzed: ${lastAnalyzed}`;
    }
  }

  function listFill(ul, items) {
    if (!ul) return;
    ul.innerHTML = "";
    (items || []).forEach(t => {
      const li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    });
    if ((items || []).length === 0) {
      const li = document.createElement("li");
      li.style.color = "#64748b";
      li.textContent = "No items.";
      ul.appendChild(li);
    }
  }

  function showStateFromStorage() {
    const raw = localStorage.getItem("resumeAnalysis");
    if (!raw) {
      card && (card.style.display = "none");
      analysisSection && (analysisSection.style.display = "none");
      noCTA && (noCTA.style.display = "block");
      return;
    }

    let data;
    try { data = JSON.parse(raw); } catch { return; }

    card && (card.style.display = "block");
    analysisSection && (analysisSection.style.display = "block");
    noCTA && (noCTA.style.display = "none");

    renderScore(data.score || 0, data.lastAnalyzed || null);
    renderATSBreakdown(data.breakdown || null);
    listFill(issuesUL,      data.analysis?.issues || []);
    listFill(strengthsUL,   data.analysis?.strengths || []);
    listFill(suggestionsUL, data.suggestions || []);

    const matched = data.keywords?.matched || [];
    const missing = data.keywords?.missing || [];
    if (matched.length || missing.length) {
      kwPanel && (kwPanel.style.display = "block");
      listFill(kwMatchedUL, matched);
      listFill(kwMissingUL, missing);
    } else {
      kwPanel && (kwPanel.style.display = "none");
    }

    const secPresent = data.sections?.present || [];
    const secMissing = data.sections?.missing || [];
    if (secPresent.length || secMissing.length) {
      sectionsPanel && (sectionsPanel.style.display = "block");
      listFill(secPresentUL, secPresent);
      listFill(secMissingUL, secMissing);
    } else {
      sectionsPanel && (sectionsPanel.style.display = "none");
    }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => { try { resolve(fr.result.split(",")[1]); } catch (e) { reject(e); } };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  async function runDashboardAnalysis() {
    analyzingEl && (analyzingEl.style.display = "inline");

    try {
      const file = fileInput?.files?.[0] || null;
      if (!file) { alert("Please choose a PDF or DOCX."); return; }

      const b64 = await fileToBase64(file);
      localStorage.setItem("resumeBase64", b64);

      const payload = { jobDescription: (jobDesc?.value || "").trim() };
      if (file.type === "application/pdf") {
        payload.pdf = b64;
      } else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        payload.docx = b64;
      } else {
        alert("Unsupported file. Upload PDF or DOCX."); return;
      }

      const res = await fetch("/api/resume-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || res.statusText);

      data.lastAnalyzed = new Date().toLocaleString();
      localStorage.setItem("resumeAnalysis", JSON.stringify(data));

      showStateFromStorage();
      document.getElementById("resume-score-card")?.scrollIntoView({ behavior: "smooth", block: "start" });

      // reset chosen file name
      if (fileInput) fileInput.value = "";
      if (dzFileNameEl) { dzFileNameEl.style.display = "none"; dzFileNameEl.textContent = ""; }

    } catch (err) {
      console.error("Dashboard analysis error:", err);
      alert("Analysis failed. Please try again.");
    } finally {
      analyzingEl && (analyzingEl.style.display = "none");
    }
  }

  // Dropzone UX
  function setDZFilename(name) {
    if (!dzFileNameEl) return;
    dzFileNameEl.textContent = name;
    dzFileNameEl.style.display = "block";
  }

  if (dropzone && fileInput) {
    const openPicker = () => fileInput.click();
    dropzone.addEventListener("click", openPicker);
    dropzone.addEventListener("keypress", (e) => {
      if (e.key === "Enter" || e.key === " ") openPicker();
    });

    ["dragenter", "dragover"].forEach(evt =>
      dropzone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.add("dragover"); })
    );
    ["dragleave", "drop"].forEach(evt =>
      dropzone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove("dragover"); })
    );

    dropzone.addEventListener("drop", (e) => {
      const files = e.dataTransfer?.files || [];
      if (files.length) {
        fileInput.files = files;
        setDZFilename(files[0].name);
      }
    });

    fileInput.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (f) setDZFilename(f.name);
    });
  }

  // Wire buttons
  analyzeBtn?.addEventListener("click", runDashboardAnalysis);

  // Fix: make “Analyze updated resume” actually open the picker and scroll
  openReBtn?.addEventListener("click", () => {
    dropzone?.scrollIntoView({ behavior: "smooth", block: "center" });
    dropzone?.focus();
    fileInput?.click();
  });

  // Optimize
  const optimizeBtn  = document.getElementById("optimize-btn");
  const loadingEl    = document.getElementById("optimized-loading");
  const outputEl     = document.getElementById("optimized-output");
  const downloadsEl  = document.getElementById("optimized-downloads");

  optimizeBtn?.addEventListener("click", async () => {
    if (loadingEl)   loadingEl.style.display    = "block";
    if (outputEl)    outputEl.style.display     = "none";
    if (downloadsEl) downloadsEl.style.display  = "none";

    const b64 = localStorage.getItem("resumeBase64");
    if (!b64) {
      alert("Missing your original resume file. Upload it above and analyze again.");
      if (loadingEl) loadingEl.style.display = "none";
      return;
    }

    try {
      const res = await fetch("/api/optimize-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf: b64 })
      });
      const js = await res.json();
      if (!res.ok || js.error) throw new Error(js.error || res.statusText);

      if (loadingEl)   loadingEl.style.display   = "none";
      if (outputEl) { outputEl.textContent = js.optimized; outputEl.style.display = "block"; }
      if (downloadsEl) downloadsEl.style.display = "block";
    } catch (err) {
      console.error("Optimize error:", err);
      if (loadingEl) loadingEl.style.display = "none";
      alert("Failed to optimize resume. Try again.");
    }
  });

  // First paint
  showStateFromStorage();
});

// — Download helper —
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

window.downloadOptimizedResume = function (format) {
  const text = document.getElementById("optimized-output").innerText || "";
  downloadHelper(format, text, "resume-optimized");
};
