// Keep cookies for SameSite/Lax
;(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

// -------- Datalist (roles) --------
async function initRoleDatalist() {
  const input = document.getElementById("dashRoleSelect");
  const dl    = document.getElementById("roleList");
  if (!input || !dl) return;

  try {
    const res = await fetch("/static/data/roles.json", { credentials: "same-origin" });
    const roles = await res.json();
    const seen = new Set();
    roles
      .filter(r => r && typeof r === "string")
      .map(r => r.trim())
      .filter(r => r && !seen.has(r) && seen.add(r))
      .sort((a,b) => a.localeCompare(b))
      .forEach(role => {
        const opt = document.createElement("option");
        opt.value = role;
        dl.appendChild(opt);
      });
  } catch (e) {
    console.warn("Could not load roles.json; using fallback.", e);
    [
      "Business Analyst","Azure Architect","Animator","IT Support Specialist","Systems Administrator",
      "Network Engineer","Product Manager","Software Engineer","Project Manager","UI/UX Designer",
      "QA Engineer","Data Analyst","Data Scientist","DevOps Engineer"
    ].forEach(role => {
      const opt = document.createElement("option");
      opt.value = role;
      dl.appendChild(opt);
    });
  }
}

// -------- Merge fixes (issues + suggestions) with fuzzy de-dup --------
function mergeFixes(data){
  const issues = Array.isArray(data?.analysis?.issues) ? data.analysis.issues : [];
  const recs   = Array.isArray(data?.suggestions) ? data.suggestions : [];

  // ---- helpers for fuzzy de-dup ----
  const STOP = new Set(["the","a","an","is","are","of","and","to","for","with","at","on","in","your","resume","document","section","sections"]);
  const MAP  = [
    [/reverse-?chronological/gi, "reverse chronological"],
    [/objective\s*\/\s*summary|summary\s*\/\s*objective|objective or summary/gi, "summary"],
    [/\bensure\b/gi, ""],
    [/\bmake sure\b/gi, ""],
    [/\bclearly\b/gi, ""],
    [/\bthroughout the resume\b/gi, "throughout the document"],
    [/\bformatting and spacing\b/gi, "formatting spacing"],
    [/\bskills section\b/gi, "skills"],
    [/\bexperience section\b/gi, "experience"],
    [/[“”"]/g, "'"],
    [/[—–]/g, "-"],
  ];

  const canon = (s="") => {
    let t = String(s).toLowerCase().trim();
    MAP.forEach(([re, rep]) => { t = t.replace(re, rep); });
    t = t.replace(/[^a-z0-9\s\-']/g, " ").replace(/\s+/g, " ").trim();
    return t;
  };

  const tokens = (s) => canon(s).split(/\s+/).filter(w => w && !STOP.has(w));
  const sim = (a, b) => {
    const A = new Set(tokens(a)), B = new Set(tokens(b));
    if (A.size === 0 || B.size === 0) return 0;
    let inter = 0; A.forEach(x => { if (B.has(x)) inter++; });
    // similarity vs the *shorter* sentence to be conservative
    return inter / Math.min(A.size, B.size);
  };

  // ---- prefer Issues wording; add recs only if not too similar ----
  const out = [];
  const keep = (x) => {
    const isDup = out.some(y => sim(x, y) >= 0.72 || canon(y).includes(canon(x)) || canon(x).includes(canon(y)));
    if (!isDup) out.push(x);
  };

  issues.forEach(keep);
  recs.forEach(keep);
  return out;
}

document.addEventListener("DOMContentLoaded", () => {
  // Greeting
  const greetEl = document.getElementById("dashboardGreeting");
  if (greetEl) {
    const first = !localStorage.getItem("dashboardVisited");
    greetEl.textContent = first ? "Welcome" : "Welcome Back";
    localStorage.setItem("dashboardVisited", "true");
  }

  // Core elements
  const scoreCard  = document.getElementById("resume-score-card");
  const ring       = document.querySelector(".ring__progress");
  const ringLabel  = document.querySelector(".ring__label");
  const metricNote = document.getElementById("metric-note");
  const noCTA      = document.getElementById("no-analysis-cta");

  const metrics = {
    formatting:  { meter: document.getElementById("bFormatting"),  label: document.getElementById("mFormatting") },
    sections:    { meter: document.getElementById("bSections"),    label: document.getElementById("mSections") },
    keywords:    { meter: document.getElementById("bKeywords"),    label: document.getElementById("mKeywords") },
    readability: { meter: document.getElementById("bReadability"), label: document.getElementById("mReadability") },
    length:      { meter: document.getElementById("bLength"),      label: document.getElementById("mLength") },
    parseable:   { meter: document.getElementById("bParseable"),   label: document.getElementById("mParseable") },
  };

  // Free-usage nudge
  const registerNudge = document.getElementById("registerNudge");
  const dismissNudge  = document.getElementById("dismissNudge");
  function maybeShowRegisterNudge() {
    const used = parseInt(localStorage.getItem("analysisCount") || "0", 10);
    const authed = (document.body.dataset.authed === "1");
    const dismissed = localStorage.getItem("nudgeDismissed") === "1";
    if (!authed && used >= 3 && !dismissed && registerNudge) {
      registerNudge.style.display = "block";
    }
  }
  dismissNudge?.addEventListener("click", () => {
    localStorage.setItem("nudgeDismissed", "1");
    registerNudge.style.display = "none";
  });

  // Upload controls
  const dropzone    = document.getElementById("dropzone");
  const fileInput   = document.getElementById("dashResumeFile");
  const fileNameEl  = document.getElementById("fileName");
  const jdInput     = document.getElementById("dashJobDesc");
  const roleSelect  = document.getElementById("dashRoleSelect");
  const analyzeBtn  = document.getElementById("dashAnalyzeBtn");
  const analyzingEl = document.getElementById("dashAnalyzing");

  initRoleDatalist();

  // Optimize controls
  const optNav   = document.querySelector(".opt-nav");
  const optPanel = document.getElementById("optPanel");

  // “Analyze updated resume” button
  const openReBtn = document.getElementById("openReanalyze");
  openReBtn?.addEventListener("click", () => {
    openReBtn.classList.add("is-hot");
    setTimeout(() => openReBtn.classList.remove("is-hot"), 700);
    dropzone?.scrollIntoView({ behavior: "smooth", block: "center" });
    dropzone?.classList.add("pulse");
    setTimeout(() => dropzone?.classList.remove("pulse"), 800);
  });

  // Helpers
  const clamp = (n) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
  const paletteFor = (v) => (v >= 80 ? "#16a34a" : v >= 60 ? "#f59e0b" : "#e11d48");

  function setMetric(m, val) {
    if (!m) return;
    const v = clamp(val);
    if (m.meter) {
      m.meter.style.width = `${v}%`;
      m.meter.style.background = paletteFor(v);
    }
    if (m.label) {
      m.label.textContent = v === 0 && val !== 0 ? "—%" : `${v}%`;
      m.label.style.color = paletteFor(v);
    }
  }

  function animateRing(score) {
    const v = clamp(score);
    const C = 2 * Math.PI * 52; // r=52
    ring?.setAttribute("stroke", paletteFor(v));
    let cur = 0;
    const step = v > 0 ? 1 : -1;
    const iv = setInterval(() => {
      if (!ring) return clearInterval(iv);
      if (cur === v) return clearInterval(iv);
      cur += step;
      const dash = (cur / 100) * C;
      ring.setAttribute("stroke-dasharray", `${dash} ${C}`);
      if (ringLabel) ringLabel.textContent = `${cur}%`;
    }, 12);
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function showFileName(f) {
    if (!fileNameEl) return;
    fileNameEl.textContent = f ? `Selected: ${f.name} (${formatSize(f.size)})` : "";
  }

  // -------- Render from localStorage --------
  function renderFromStorage() {
    const raw = localStorage.getItem("resumeAnalysis");
    if (!raw) {
      scoreCard?.style && (scoreCard.style.display = "none");
      noCTA?.style && (noCTA.style.display = "block");
      return;
    }

    let data; try { data = JSON.parse(raw); } catch { return; }
    scoreCard?.style && (scoreCard.style.display = "block");
    noCTA?.style && (noCTA.style.display = "none");

    animateRing(data.score || 0);
    if (metricNote && data.lastAnalyzed) {
      metricNote.textContent = `Last analyzed: ${data.lastAnalyzed}`;
    }

    const b = data.breakdown || {};
    setMetric(metrics.formatting,  b.formatting);
    setMetric(metrics.sections,    b.sections);
    setMetric(metrics.keywords,    b.keywords);
    setMetric(metrics.readability, b.readability);
    setMetric(metrics.length,      b.length);
    setMetric(metrics.parseable,   b.parseable === true ? 100 : (b.parseable === false ? 0 : null));

    // Default to Fixes
    paintPanel("fixes", data);
    maybeShowRegisterNudge();
  }

  renderFromStorage();
  maybeShowRegisterNudge();

  // -------- Copy fixes (merged) to clipboard --------
  document.getElementById("copy-recs-btn")?.addEventListener("click", async () => {
    try {
      const data = JSON.parse(localStorage.getItem("resumeAnalysis") || "{}");
      const merged = mergeFixes(data);
      const text = merged.length ? ("• " + merged.join("\n• ")) : "No fixes available yet.";
      await navigator.clipboard.writeText(text);
      alert("Fixes copied to clipboard.");
    } catch (e) {
      console.error(e);
      alert("Couldn't copy fixes.");
    }
  });

  // -------- Dropzone / picker --------
  function openPicker(){ fileInput?.click(); }
  dropzone?.addEventListener("click", openPicker);
  dropzone?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
  });
  dropzone?.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("is-drag"); });
  dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("is-drag"));
  dropzone?.addEventListener("drop", (e) => {
    e.preventDefault(); dropzone.classList.remove("is-drag");
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    if (fileInput) fileInput.files = e.dataTransfer.files;
    if (analyzeBtn) analyzeBtn.disabled = false;
    showFileName(f);
  });

  fileInput?.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (analyzeBtn) analyzeBtn.disabled = !f;
    showFileName(f || null);
  });

  // -------- Run analysis --------
  async function runAnalysis() {
    const f = fileInput?.files?.[0];
    if (!f) return;

    if (analyzingEl) analyzingEl.style.display = "inline";
    if (analyzeBtn) analyzeBtn.disabled = true;

    try {
      const b64 = await fileToBase64(f);
      const body = {
        jobDescription: jdInput?.value || "",
        jobRole: roleSelect?.value || ""
      };
      if (f.type === "application/pdf") {
        body.pdf = b64;
      } else if (f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        body.docx = b64;
      } else {
        alert("Unsupported type. Upload PDF or DOCX.");
        if (analyzingEl) analyzingEl.style.display = "none";
        if (analyzeBtn) analyzeBtn.disabled = false;
        return;
      }

      const res = await fetch("/api/resume-analysis", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify(body)
      });

      const text = await res.text();
      let data = null; try { data = JSON.parse(text); } catch {}

      if (res.status === 402) {
        const msgText = data?.message || "You’ve reached your plan limit for this feature.";
        const pricing = data?.pricing_url || (window.PRICING_URL || "/pricing");
        const msgHtml = data?.message_html || `${msgText} <a href="${pricing}">Upgrade now →</a>`;
        window.upgradePrompt?.(msgHtml, pricing, 1200);
        return;
      }

      if (res.status === 429) {
        window.showUpgradeBanner?.(
          data?.message || "You have reached the limit for the free version, upgrade to enjoy more features"
        );
        return;
      }

      if (!res.ok) {
        const msg = (data?.message || data?.error) || "Resume analysis failed. Please try again.";
        console.error("Resume analysis failed:", text);
        alert(msg);
        return;
      }

      if (!data) { alert("Unexpected server response."); return; }

      data.lastAnalyzed = new Date().toLocaleString();
      localStorage.setItem("resumeAnalysis", JSON.stringify(data));
      localStorage.setItem("resumeBase64", b64);
      localStorage.setItem("resumeKind", f.type);

      const resultObject = {
        score: Number(data.score || 0),
        breakdown: {
          formatting:  data?.breakdown?.formatting ?? null,
          sections:    data?.breakdown?.sections ?? null,
          keywords:    data?.breakdown?.keywords ?? null,
          readability: data?.breakdown?.readability ?? null,
          length:      data?.breakdown?.length ?? null,
          parseable:   data?.breakdown?.parseable ?? null
        },
        fixes: mergeFixes(data),
        lastAnalyzed: data.lastAnalyzed
      };
      localStorage.setItem("resume_latest", JSON.stringify(resultObject));
      if (window.syncState) window.syncState();

      if (fileInput) fileInput.value = "";
      showFileName(null);
      if (analyzeBtn) analyzeBtn.disabled = true;
      renderFromStorage();
      scoreCard?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      console.error(err);
      alert("Analysis failed. Please try again.");
    } finally {
      if (analyzingEl) analyzingEl.style.display = "none";
    }
  }

  analyzeBtn?.addEventListener("click", runAnalysis);

  // -------- Optimize side panel --------
  function paintPanel(view, data) {
    // Hide the Recommendations button entirely (in case the template still includes it)
    document.querySelector('.opt-btn[data-view="recs"]')?.setAttribute("hidden", "hidden");

    optNav?.querySelectorAll(".opt-btn").forEach(b => {
      b.classList.toggle("is-active", b.dataset.view === view);
    });

    const a  = data?.analysis  || {};
    const w  = data?.writing   || {};
    const kw = data?.keywords  || {};
    const sc = data?.sections  || {};

    if (view === "fixes") {
      const merged = mergeFixes(data);
      optPanel.innerHTML = `
        <h3 class="panel-title">⚠️ Fixes needed</h3>
        <p class="panel-sub">The most important issues to address first.</p>
        <ul class="list">${merged.length ? merged.map(i => `<li>${i}</li>`).join("") : "<li>No issues detected.</li>"}</ul>`;
      return;
    }

    if (view === "done") {
      optPanel.innerHTML = `
        <h3 class="panel-title">✅ What you did well</h3>
        <p class="panel-sub">Strengths that are already working for you.</p>
        <ul class="list">${(a.strengths || []).map(s => `<li>${s}</li>`).join("") || "<li>No strengths extracted.</li>"}</ul>`;
      return;
    }

    if (view === "keywords") {
      const role = (roleSelect?.value || data?.relevance?.role || "").toLowerCase();
      const SAMPLE_KEYS = {
        "project manager": ["Agile","Scrum","Waterfall","Stakeholders","RAID log","Risk Register","Scope","Timeline","Budget",
                      "Dependencies","Roadmap","Jira","MS Project","Change Control","KPIs","Delivery","Sprint Planning"],
        "it support specialist": ["Troubleshooting","Ticketing","Active Directory","Windows Server","SLA","Hardware","Software",
                            "Networking","Incident Management"],
        "default": ["Stakeholders","Deliverables","Timeline","Budget","Risks","Dependencies","KPIs","Reporting"]
      };
      const samples = SAMPLE_KEYS[role] || SAMPLE_KEYS["default"];

      const matched = new Set((kw.matched || []).map(s => String(s).toLowerCase()));
      const hasKW = (kw.matched && kw.matched.length) || (kw.missing && kw.missing.length);
      const rows = hasKW
        ? [...new Set([...(kw.matched || []), ...(kw.missing || [])])]
        : samples;

      optPanel.innerHTML = `
        <h3 class="panel-title">🎯 ATS keywords</h3>
        <p class="panel-sub">These are skills/terms recruiters often search for. Add only the ones you genuinely have.</p>
        ${rows.map(k => {
          const has = matched.has(String(k).toLowerCase());
          return `<div class="kv"><span>${k}</span><strong style="color:${has ? '#16a34a' : '#ef4444'}">${has ? "Yes" : "No"}</strong></div>`;
        }).join("")}
        ${(sc.missing || []).length ? `<p class="panel-sub" style="margin-top:10px">Missing sections: ${(sc.missing || []).join(", ")}</p>` : ""}`;
      return;
    }

    // Writing quality
    const rep = Array.isArray(w.repetition) ? w.repetition : [];
    optPanel.innerHTML = `
      <h3 class="panel-title">✍️ Writing quality</h3>
      <p class="panel-sub">Readability, phrasing and repetition.</p>
      <div class="kv"><span>Readability</span><strong>${w.readability || "—"}</strong></div>
      <h4 class="panel-title" style="font-size:16px;margin-top:12px;">Repetition</h4>
      ${
        rep.length
          ? rep.map(r =>
              `<div class="kv"><span>“${r.term}” × ${r.count}<br><small class="panel-sub">Try: ${(r.alternatives||[]).join(", ") || "—"}</small></span><strong>Repeated</strong></div>`
            ).join("")
          : `<div class="kv"><span>No repetitive phrases</span><strong style="color:#16a34a">Pass</strong></div>`
      }
      <h4 class="panel-title" style="font-size:16px;margin-top:12px;">Grammar & style</h4>
      <ul class="list">${(w.grammar || []).map(g => `<li>${g}</li>`).join("") || "<li>No grammar suggestions returned.</li>"}</ul>`;
  }

  optNav?.addEventListener("click", (e) => {
    const btn = e.target.closest(".opt-btn");
    if (!btn) return;
    const data = JSON.parse(localStorage.getItem("resumeAnalysis") || "{}");
    paintPanel(btn.dataset.view, data);
  });

  // Initial paint (again, in case DOM changed while wiring)
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

window.downloadOptimizedResume = function (format) {
  const text = document.getElementById("optimized-output")?.innerText || "";
  downloadHelper(format, text, "resume-optimized");
};
