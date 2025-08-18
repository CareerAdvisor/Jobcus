// static/js/dashboard.js

// 0) Keep cookies for SameSite/Lax
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  // 1) Greeting
  const greetEl = document.getElementById("dashboardGreeting");
  if (greetEl) {
    const first = !localStorage.getItem("dashboardVisited");
    greetEl.textContent = first ? "Welcome" : "Welcome Back";
    localStorage.setItem("dashboardVisited", "true");
  }

  // 2) Elements we’ll need
  const card            = document.getElementById("resume-score-card");
  const noCTA           = document.getElementById("no-analysis-cta");
  const analysisSection = document.getElementById("resume-analysis");
  const metricNote      = document.getElementById("metric-note");
  const atsGrid         = document.getElementById("ats-grid");

  // Upload panel
  const fileInput   = document.getElementById("dashResumeFile");
  const textInput   = document.getElementById("dashResumeText");
  const jobDesc     = document.getElementById("dashJobDesc");
  const analyzeBtn  = document.getElementById("dashAnalyzeBtn");
  const analyzingEl = document.getElementById("dashAnalyzing");
  const openReBtn   = document.getElementById("openReanalyze");

  // Lists
  const issuesUL       = document.getElementById("top-issues");
  const strengthsUL    = document.getElementById("good-points");
  const suggestionsUL  = document.getElementById("suggestions-list");
  const kwPanel        = document.getElementById("kw-panel");
  const kwMatchedUL    = document.getElementById("kw-matched");
  const kwMissingUL    = document.getElementById("kw-missing");
  const sectionsPanel  = document.getElementById("sections-panel");
  const secPresentUL   = document.getElementById("sec-present");
  const secMissingUL   = document.getElementById("sec-missing");

  // 3) Helpers
  const colorForScore = (s=0) => {
    if (s >= 80) return "#16A34A"; // green
    if (s >= 60) return "#F59E0B"; // amber
    return "#E11D48";              // red
  };

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
      if (val == null) return; // skip if backend didn’t send it
      const color = colorForScore(val);
      const pill  = document.createElement("div");
      pill.style.border = "1px solid #e5e7eb";
      pill.style.borderRadius = "10px";
      pill.style.padding = "10px";
      pill.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:600;">${label}</span>
          <span style="font-weight:700;color:${color};">${val}%</span>
        </div>
        <div style="height:6px;margin-top:6px;background:#f1f5f9;border-radius:6px;overflow:hidden;">
          <div style="height:100%;width:${Math.max(0, Math.min(100, val))}%;background:${color};"></div>
        </div>
      `;
      atsGrid.appendChild(pill);
    });
  }

  function renderScore(score=0, lastAnalyzed=null) {
    const circle = document.querySelector(".progress-circle");
    if (!circle) return;
    const path = circle.querySelector(".progress");
    const text = circle.querySelector(".percentage");

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
      if (card) card.style.display = "none";
      if (analysisSection) analysisSection.style.display = "none";
      if (noCTA) noCTA.style.display = "block";
      return;
    }

    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (card) card.style.display = "block";
    if (analysisSection) analysisSection.style.display = "block";
    if (noCTA) noCTA.style.display = "none";

    renderScore(data.score || 0, data.lastAnalyzed || null);
    renderATSBreakdown(data.breakdown || null);

    listFill(issuesUL,      data.analysis?.issues || []);
    listFill(strengthsUL,   data.analysis?.strengths || []);
    listFill(suggestionsUL, data.suggestions || []);

    // Optional panels
    const matched = data.keywords?.matched || [];
    const missing = data.keywords?.missing || [];
    if (matched.length || missing.length) {
      if (kwPanel) kwPanel.style.display = "block";
      listFill(kwMatchedUL, matched);
      listFill(kwMissingUL, missing);
    } else {
      if (kwPanel) kwPanel.style.display = "none";
    }

    const secPresent = data.sections?.present || [];
    const secMissing = data.sections?.missing || [];
    if (secPresent.length || secMissing.length) {
      if (sectionsPanel) sectionsPanel.style.display = "block";
      listFill(secPresentUL, secPresent);
      listFill(secMissingUL, secMissing);
    } else {
      if (sectionsPanel) sectionsPanel.style.display = "none";
    }
  }

  // 4) File → base64
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        try { resolve(fr.result.split(",")[1]); } catch(e){ reject(e); }
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  // 5) Run analysis (dashboard)
  async function runDashboardAnalysis() {
    if (analyzingEl) analyzingEl.style.display = "inline";

    try {
      // Build payload from file or text
      let payload = {};
      const file = fileInput?.files?.[0] || null;
      const pasted = (textInput?.value || "").trim();

      if (file) {
        const b64 = await fileToBase64(file);
        localStorage.setItem("resumeBase64", b64);
        if (file.type === "application/pdf") {
          payload.pdf = b64;
        } else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
          payload.docx = b64;
        } else {
          alert("Unsupported file. Upload PDF or DOCX.");
          return;
        }
      } else if (pasted) {
        payload.text = pasted;
        localStorage.setItem("resumeTextRaw", pasted);
      } else {
        alert("Please upload a PDF/DOCX or paste your resume text.");
        return;
      }

      const jd = (jobDesc?.value || "").trim();
      if (jd) payload.jobDescription = jd;

      const res = await fetch("/api/resume-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || res.statusText);

      // Enrich and persist
      data.lastAnalyzed = new Date().toLocaleString();
      localStorage.setItem("resumeAnalysis", JSON.stringify(data));

      // Show
      showStateFromStorage();

      // Reset file input for consecutive uploads
      if (fileInput) fileInput.value = "";

      // Scroll to score
      document.getElementById("resume-score-card")?.scrollIntoView({ behavior: "smooth", block: "start" });

    } catch (err) {
      console.error("Dashboard analysis error:", err);
      alert("Analysis failed. Please try again.");
    } finally {
      if (analyzingEl) analyzingEl.style.display = "none";
    }
  }

  // 6) Wire events
  analyzeBtn?.addEventListener("click", runDashboardAnalysis);
  openReBtn?.addEventListener("click", () => {
    document.getElementById("dashResumeFile")?.focus();
    document.getElementById("dashResumeFile")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // 7) Optimize flow (unchanged)
  const optimizeBtn  = document.getElementById("optimize-btn");
  const loadingEl    = document.getElementById("optimized-loading");
  const outputEl     = document.getElementById("optimized-output");
  const downloadsEl  = document.getElementById("optimized-downloads");
  const resumeBase64 = localStorage.getItem("resumeBase64");

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

  // 8) Initial paint
  showStateFromStorage();
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
