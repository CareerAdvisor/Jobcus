// Keep cookies for SameSite/Lax
;(function(){
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
  const uploadCard   = document.getElementById("uploadCard");
  const dropZone     = document.getElementById("dropZone");
  const fileInput    = document.getElementById("dashResumeFile");
  const jobDesc      = document.getElementById("dashJobDesc");
  const roleSelect   = document.getElementById("roleSelect");
  const analyzeBtn   = document.getElementById("dashAnalyzeBtn");
  const analyzingEl  = document.getElementById("dashAnalyzing");
  const openReBtn    = document.getElementById("openReanalyze");
  const panel        = document.getElementById("optimize-panel");
  const noCTA        = document.getElementById("no-analysis-cta");

  // Score ring bits
  const ringProgress = document.querySelector(".ring-progress");
  const ringLabel    = document.querySelector(".ring-label");
  const metricNote   = document.getElementById("metric-note");

  // Mini metrics
  const mini = {
    formatting: { m: "m-formatting", b: "b-formatting" },
    sections:   { m: "m-sections",   b: "b-sections" },
    readability:{ m: "m-readability",b: "b-readability" },
    length:     { m: "m-length",     b: "b-length" },
    parseable:  { m: "m-parseable",  b: "b-parseable" }
  };

  // Role → sample ATS keywords (expand as needed)
  const ROLE_KEYWORDS = {
    "IT Support Specialist": [
      "Troubleshooting","Ticketing","Active Directory","Windows Server","SLA",
      "Customer Support","Hardware","Software","Networking","Incident Management"
    ],
    "Software Engineer": [
      "Algorithms","Data Structures","APIs","REST","Unit Testing",
      "CI/CD","Git","Microservices","Cloud","Agile"
    ],
    "Data Analyst": [
      "SQL","Excel","Data Cleaning","Visualization","Tableau",
      "Power BI","A/B Testing","Regression","Python","Statistics"
    ],
    "Project Manager": [
      "Stakeholders","Roadmap","Scheduling","Risk Management","Budget",
      "Scrum","Agile","KPIs","Resource Planning","Communication"
    ],
    "UX Designer": [
      "Wireframes","Prototyping","User Research","Usability Testing","Personas",
      "Figma","Information Architecture","Accessibility","Interaction Design","Heuristics"
    ],
    "Cybersecurity Analyst": [
      "SIEM","Incident Response","Threat Hunting","Vulnerability Management","IDS/IPS",
      "NIST","SOC","Risk Assessment","OSINT","Security Monitoring"
    ]
  };

  // ---------- helpers ----------
  const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0));

  function setMiniMetric(key, value) {
    const ids = mini[key]; if (!ids) return;
    const v = clamp(value);
    const mEl = document.getElementById(ids.m);
    const bEl = document.getElementById(ids.b);
    if (mEl) mEl.textContent = v === 0 && value !== 0 ? "—" : `${v}%`;
    if (bEl) {
      bEl.style.width = `${v}%`;
      bEl.style.background = v >= 80 ? "#16A34A" : (v >= 60 ? "#F59E0B" : "#E11D48");
    }
  }

  function animateRing(score) {
    const target = clamp(score);
    let cur = 0;
    ringProgress.setAttribute("stroke-dasharray", "0,100");
    ringLabel.textContent = "0%";
    ringProgress.setAttribute("stroke", target >= 80 ? "#16A34A" : (target >= 60 ? "#F59E0B" : "#E11D48"));
    const iv = setInterval(() => {
      if (cur === target) return clearInterval(iv);
      cur += (target > cur ? 1 : -1);
      ringProgress.setAttribute("stroke-dasharray", `${cur},100`);
      ringLabel.textContent = `${cur}%`;
    }, 12);
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result.split(",")[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  // ---------- renderers ----------
  function renderFromStorage() {
    const raw = localStorage.getItem("resumeAnalysis");
    if (!raw) {
      document.querySelector(".score-card")?.classList.add("hidden");
      noCTA?.classList.remove("hidden");
      return;
    }
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    // Show score card; hide empty state
    document.querySelector(".score-card")?.classList.remove("hidden");
    noCTA?.classList.add("hidden");

    // Score ring + timestamp
    animateRing(data.score || 0);
    if (metricNote && data.lastAnalyzed) metricNote.textContent = `Last analyzed: ${data.lastAnalyzed}`;

    // Mini metrics (will be "—" if not provided)
    const br = data.breakdown || {};
    setMiniMetric("formatting",  br.formatting);
    setMiniMetric("sections",    br.sections);
    setMiniMetric("readability", br.readability);
    setMiniMetric("length",      br.length);
    setMiniMetric("parseable",   br.parseable === true ? 100 : br.parseable === false ? 0 : br.parseable);

    // Render default panel (fixes) on load
    const active = document.querySelector(".opt-tab.is-active")?.dataset.target || "fixes";
    renderPanel(active, data);
  }

  function bulletList(arr) {
    if (!arr || !arr.length) return '<p class="empty">Nothing to show.</p>';
    return `<ul class="list">${arr.map(x => `<li>${x}</li>`).join("")}</ul>`;
  }

  function renderFixes(data) {
    const issues = data.analysis?.issues || [];
    const suggestions = data.suggestions || [];
    return `
      <h3>⚠️ Fixes needed</h3>
      ${bulletList(issues)}
      <h4>Recommendations</h4>
      ${bulletList(suggestions)}
    `;
  }

  function renderStrengths(data) {
    const good = data.analysis?.strengths || [];
    return `
      <h3>✅ What you did well</h3>
      ${bulletList(good)}
    `;
  }

  function renderATS(data) {
    // Try using keywords from server; else role-based samples
    const matched = data.keywords?.matched || [];
    const missing = data.keywords?.missing || [];

    let rows = "";
    const all = matched.map(k => ({ k, inRes: true }))
      .concat(missing.map(k => ({ k, inRes: false })));

    if (all.length) {
      rows = all.map(({k,inRes}) => `
        <tr>
          <td>${k}</td>
          <td class="${inRes ? 'yes' : 'no'}">${inRes ? "✓" : "✕"}</td>
        </tr>`).join("");
    } else {
      const role = roleSelect?.value || "";
      const samples = ROLE_KEYWORDS[role] || ROLE_KEYWORDS["IT Support Specialist"];
      rows = samples.map(k => `<tr><td>${k}</td><td class="na">—</td></tr>`).join("");
    }

    return `
      <h3>🎯 ATS keywords</h3>
      <p class="muted">These are skills/terms recruiters often search for. Add the ones you genuinely have.</p>
      <div class="table-wrap">
        <table class="kw-table">
          <thead><tr><th>Keyword</th><th>In Resume?</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function renderWriting(data) {
    const writing = data.writing || {};
    const repetition = writing.repetition || {};
    const grammar    = writing.grammar || {};

    // If backend didn’t send details, show helpful defaults
    const repScore = repetition.score ?? null;
    const repItems = repetition.items || [];
    const hasRep   = repItems.length > 0;

    const gramIssues = grammar.issues || [];
    const gramNote = gramIssues.length ? bulletList(gramIssues) : `<p class="empty">No critical grammar issues detected.</p>`;

    // Suggestions to diversify action verbs
    const diversify = [
      "managed → led / coordinated / oversaw / orchestrated",
      "responsible for → owned / delivered / executed",
      "worked on → built / implemented / developed",
      "helped → supported / enabled / facilitated"
    ];

    return `
      <h3>✍️ Writing quality</h3>
      <p class="muted">Readability, phrasing and repetition affect how quickly hiring managers grasp impact.</p>

      <h4>Repetition</h4>
      ${repScore != null ? `<p>Score: <strong>${repScore}/10</strong> (higher is better)</p>` : ``}
      ${hasRep ? bulletList(repItems) : `<ul class="list"><li>✅ No repetitive phrases</li><li>✅ No repetitive bullet points</li><li>✅ Varied action verbs</li></ul>`}

      <h4>Grammar & clarity</h4>
      ${gramNote}

      <h4>Stronger phrasing (ideas)</h4>
      ${bulletList(diversify)}
    `;
  }

  function renderPanel(which, data) {
    let html = "";
    if (which === "fixes")       html = renderFixes(data);
    else if (which === "strengths") html = renderStrengths(data);
    else if (which === "ats")    html = renderATS(data);
    else if (which === "writing")html = renderWriting(data);
    panel.innerHTML = html || `<p class="empty">No details available yet.</p>`;
    // Keep “Optimize My Resume” section always visible (separate card)
  }

  // ---------- analysis flow ----------
  async function runDashboardAnalysis() {
    const file = fileInput?.files?.[0] || null;
    if (!file) { alert("Choose a PDF or DOCX first."); return; }

    try {
      analyzingEl.hidden = false;
      analyzeBtn.disabled = true;

      const b64 = await fileToBase64(file);
      const payload = { jobDescription: (jobDesc?.value || "").trim() };
      if (file.type === "application/pdf") payload.pdf = b64;
      else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") payload.docx = b64;
      else { alert("Unsupported type. Upload PDF or DOCX."); return; }

      const res = await fetch("/api/resume-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || res.statusText);

      data.lastAnalyzed = new Date().toLocaleString();
      // Persist for score/mini/panels; keep file for optimizer
      localStorage.setItem("resumeAnalysis", JSON.stringify(data));
      localStorage.setItem("resumeBase64", b64);

      renderFromStorage();
      // Reset input for consecutive uploads
      fileInput.value = "";

      // Scroll to score card
      document.querySelector(".score-card")?.scrollIntoView({ behavior: "smooth", block: "start" });

    } catch (e) {
      console.error("Dashboard analysis error:", e);
      alert("Analysis failed. Please try again.");
    } finally {
      analyzingEl.hidden = true;
      analyzeBtn.disabled = false;
    }
  }

  // ---------- events ----------
  analyzeBtn?.addEventListener("click", runDashboardAnalysis);

  openReBtn?.addEventListener("click", () => {
    uploadCard?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Also open native picker
    fileInput?.click();
  });

  // Dropzone interactions
  function highlight(on) {
    dropZone.classList.toggle("is-hover", !!on);
  }
  dropZone?.addEventListener("click", () => fileInput?.click());
  dropZone?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput?.click(); }
  });
  dropZone?.addEventListener("dragover", (e) => { e.preventDefault(); highlight(true); });
  dropZone?.addEventListener("dragleave", () => highlight(false));
  dropZone?.addEventListener("drop", (e) => {
    e.preventDefault(); highlight(false);
    const f = e.dataTransfer.files?.[0];
    if (f) { fileInput.files = e.dataTransfer.files; }
  });

  // Optimize menu (single active panel)
  document.querySelectorAll(".opt-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".opt-tab").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      const key = btn.dataset.target;
      try {
        const data = JSON.parse(localStorage.getItem("resumeAnalysis") || "{}");
        renderPanel(key, data);
      } catch { panel.innerHTML = `<p class="empty">No analysis yet.</p>`; }
    });
  });

  // Optimize action (unchanged)
  const optimizeBtn  = document.getElementById("optimize-btn");
  const loadingEl    = document.getElementById("optimized-loading");
  const outputEl     = document.getElementById("optimized-output");
  const downloadsEl  = document.getElementById("optimized-downloads");

  optimizeBtn?.addEventListener("click", async () => {
    loadingEl.hidden   = false;
    outputEl.hidden    = true;
    downloadsEl && (downloadsEl.hidden = true);

    const b64 = localStorage.getItem("resumeBase64");
    if (!b64) {
      alert("Missing your original resume file. Upload it above and analyze again.");
      loadingEl.hidden = true;
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

      loadingEl.hidden = true;
      outputEl.textContent = js.optimized || "";
      outputEl.hidden = false;
      downloadsEl && (downloadsEl.hidden = false);
    } catch (err) {
      console.error("Optimize error:", err);
      loadingEl.hidden = true;
      alert("Failed to optimize resume. Try again.");
    }
  });

  // Initial paint
  renderFromStorage();
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
