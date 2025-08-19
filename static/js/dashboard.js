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
  const scoreCard   = document.getElementById("resume-score-card");
  const ring        = document.querySelector(".ring__progress");
  const ringLabel   = document.querySelector(".ring__label");

  const metrics = {
    formatting: { meter: document.getElementById("bFormatting"), label: document.getElementById("mFormatting") },
    sections:   { meter: document.getElementById("bSections"),   label: document.getElementById("mSections") },
    readability:{ meter: document.getElementById("bReadability"),label: document.getElementById("mReadability") },
    length:     { meter: document.getElementById("bLength"),     label: document.getElementById("mLength") },
    parseable:  { meter: document.getElementById("bParseable"),  label: document.getElementById("mParseable") }
  };

  const noCTA       = document.getElementById("no-analysis-cta");
  const metricNote  = document.getElementById("metric-note");

  // Upload
  const dropzone    = document.getElementById("dropzone");
  const fileInput   = document.getElementById("dashResumeFile");
  const jdInput     = document.getElementById("dashJobDesc");
  const roleSelect  = document.getElementById("dashRoleSelect");
  const analyzeBtn  = document.getElementById("dashAnalyzeBtn");
  const analyzingEl = document.getElementById("dashAnalyzing");

  // Optimize
  const optNav      = document.querySelector(".opt-nav");
  const optPanel    = document.getElementById("optPanel");
  const optimizeBtn = document.getElementById("optimize-btn");
  const loadingEl   = document.getElementById("optimized-loading");
  const outputEl    = document.getElementById("optimized-output");
  const downloadsEl = document.getElementById("optimized-downloads");

  // “Analyze updated resume” jumps to dropzone
  document.getElementById("openReanalyze")?.addEventListener("click", () => {
    dropzone?.scrollIntoView({ behavior: "smooth", block: "center" });
    dropzone?.classList.add("pulse");
    setTimeout(() => dropzone?.classList.remove("pulse"), 800);
  });

  // ------------- helpers -------------
  const clamp = (n) => Math.max(0, Math.min(100, n || 0));

  const paletteFor = (v) => {
    if (v >= 80) return "#16a34a";
    if (v >= 60) return "#f59e0b";
    return "#e11d48";
  };

  function setMetric(m, val){
    const v = clamp(val);
    if (m.meter){
      m.meter.style.width = `${v}%`;
      m.meter.style.background = paletteFor(v);
    }
    if (m.label){
      m.label.textContent = v === 0 && val !== 0 ? "—%" : `${v}%`;
      m.label.style.color = paletteFor(v);
    }
  }

  function animateRing(score){
    const v = clamp(score);
    const C = 2 * Math.PI * 52; // circumference with r=52
    ring.style.stroke = paletteFor(v);
    let cur = 0;
    const step = v > 0 ? 1 : -1;
    const iv = setInterval(() => {
      if (cur === v) return clearInterval(iv);
      cur += step;
      const dash = (cur/100) * C;
      ring.setAttribute("stroke-dasharray", `${dash} ${C}`);
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

  function renderFromStorage(){
    const raw = localStorage.getItem("resumeAnalysis");
    if (!raw){
      scoreCard.style.display = "none";
      noCTA.style.display = "block";
      return;
    }
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    scoreCard.style.display = "block";
    noCTA.style.display = "none";

    // ring + note
    animateRing(data.score || 0);
    if (metricNote && data.lastAnalyzed) metricNote.textContent = `Last analyzed: ${data.lastAnalyzed}`;

    // metrics
    const b = data.breakdown || {};
    setMetric(metrics.formatting,  b.formatting);
    setMetric(metrics.sections,    b.sections);
    setMetric(metrics.readability, b.readability);
    setMetric(metrics.length,      b.length);
    setMetric(metrics.parseable,   b.parseable === true ? 100 : (b.parseable === false ? 0 : null));

    // paint the default optimize panel
    paintPanel("fixes", data);
  }

  // ------------- dropzone -------------
  function openPicker(){ fileInput?.click(); }
  dropzone?.addEventListener("click", openPicker);
  dropzone?.addEventListener("keydown", (e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openPicker(); } });

  dropzone?.addEventListener("dragover", (e)=>{ e.preventDefault(); dropzone.classList.add("is-drag"); });
  dropzone?.addEventListener("dragleave", ()=> dropzone.classList.remove("is-drag"));
  dropzone?.addEventListener("drop", (e)=>{
    e.preventDefault(); dropzone.classList.remove("is-drag");
    const f = e.dataTransfer.files?.[0]; if (!f) return;
    fileInput.files = e.dataTransfer.files;
    analyzeBtn.disabled = false;
  });

  fileInput?.addEventListener("change", ()=>{
    analyzeBtn.disabled = !fileInput.files?.length;
  });

  // ------------- run analysis -------------
  async function runAnalysis(){
    if (!fileInput.files?.length){ return; }

    analyzingEl.style.display = "inline";  // show only when user clicks
    analyzeBtn.disabled = true;

    try{
      const file = fileInput.files[0];
      const b64 = await fileToBase64(file);
      const body = {
        jobDescription: jdInput?.value || "",
        jobRole: roleSelect?.value || ""
      };
      if (file.type === "application/pdf") body.pdf = b64;
      else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") body.docx = b64;
      else { alert("Unsupported type. Upload PDF or DOCX."); analyzingEl.style.display="none"; analyzeBtn.disabled=false; return; }

      const res = await fetch("/api/resume-analysis", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || res.statusText);

      data.lastAnalyzed = new Date().toLocaleString();
      localStorage.setItem("resumeAnalysis", JSON.stringify(data));
      localStorage.setItem("resumeBase64", b64);

      // reset picker, repaint UI
      fileInput.value = "";
      analyzeBtn.disabled = true;
      renderFromStorage();
      scoreCard.scrollIntoView({behavior:"smooth", block:"start"});
    }catch(err){
      console.error(err);
      alert("Analysis failed. Please try again.");
    }finally{
      analyzingEl.style.display = "none";
    }
  }
  document.getElementById("dashAnalyzeBtn")?.addEventListener("click", runAnalysis);

  // ------------- optimize panel -------------
  function paintPanel(view, data){
    // highlight menu
    optNav.querySelectorAll(".opt-btn").forEach(b=>{
      b.classList.toggle("is-active", b.dataset.view===view);
    });

    const a = data?.analysis || {};
    const w = data?.writing || {};
    const kw = data?.keywords || {};
    const sec = data?.sections || {};

    if (view === "fixes"){
      optPanel.innerHTML = `
        <h3 class="panel-title">⚠️ Fixes needed</h3>
        <p class="panel-sub">The most important issues to address first.</p>
        <ul class="list">${(a.issues||[]).map(i=>`<li>${i}</li>`).join("") || "<li>No issues detected.</li>"}</ul>
      `;
      return;
    }

    if (view === "done"){
      optPanel.innerHTML = `
        <h3 class="panel-title">✅ What you did well</h3>
        <p class="panel-sub">Strengths that are already working for you.</p>
        <ul class="list">${(a.strengths||[]).map(s=>`<li>${s}</li>`).join("") || "<li>No strengths extracted.</li>"}</ul>
      `;
      return;
    }

    if (view === "keywords"){
      const samples = ["Troubleshooting","Ticketing","Active Directory","Windows Server","SLA","Customer Support","Hardware","Software","Networking","Incident Management"];
      const matched = new Set((kw.matched||[]).map(s=>String(s).toLowerCase()));
      const rows = (kw.missing||[]).concat(kw.matched||[]).length
        ? [...new Set([...(kw.matched||[]), ...(kw.missing||[]), ...samples])]
        : samples;

      optPanel.innerHTML = `
        <h3 class="panel-title">🎯 ATS keywords</h3>
        <p class="panel-sub">These are skills/terms recruiters often search for. Add only the ones you genuinely have.</p>
        ${rows.map(k=>{
          const has = matched.has(String(k).toLowerCase());
          return `<div class="kv"><span>${k}</span><strong style="color:${has ? '#16a34a' : '#ef4444'}">${has ? "Yes" : "No"}</strong></div>`;
        }).join("")}
        ${ (sec.missing||[]).length ? `<p class="panel-sub" style="margin-top:10px">Missing sections: ${(sec.missing||[]).join(", ")}</p>` : "" }
      `;
      return;
    }

    // writing quality
    const rep = Array.isArray(w.repetition) ? w.repetition : [];
    optPanel.innerHTML = `
      <h3 class="panel-title">✍️ Writing quality</h3>
      <p class="panel-sub">Readability, phrasing and repetition.</p>

      <div class="kv"><span>Readability</span><strong>${w.readability || "—"}</strong></div>

      <h4 class="panel-title" style="font-size:16px;margin-top:12px;">Repetition</h4>
      ${
        rep.length
          ? rep.map(r => `<div class="kv"><span>“${r.term}” × ${r.count}<br><small class="panel-sub">Try: ${(r.alternatives||[]).join(", ") || "—"}</small></span><strong>Repeated</strong></div>`).join("")
          : `<div class="kv"><span>No repetitive phrases</span><strong style="color:#16a34a">Pass</strong></div>`
      }

      <h4 class="panel-title" style="font-size:16px;margin-top:12px;">Grammar & style</h4>
      <ul class="list">${(w.grammar||[]).map(g=>`<li>${g}</li>`).join("") || "<li>No grammar suggestions returned.</li>"}</ul>
    `;
  }

  optNav.addEventListener("click", (e)=>{
    const btn = e.target.closest(".opt-btn");
    if (!btn) return;
    const data = JSON.parse(localStorage.getItem("resumeAnalysis") || "{}");
    paintPanel(btn.dataset.view, data);
  });

  // ------------- optimize action -------------
  optimizeBtn?.addEventListener("click", async () => {
    loadingEl.style.display = "block";   // only show after click
    outputEl.style.display  = "none";
    downloadsEl && (downloadsEl.style.display = "none");

    const b64 = localStorage.getItem("resumeBase64");
    if (!b64){
      loadingEl.style.display = "none";
      alert("Missing your original resume file. Upload and analyze again first.");
      return;
    }

    try{
      const res = await fetch("/api/optimize-resume", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ pdf: b64 })
      });
      const js = await res.json();
      if (!res.ok || js.error) throw new Error(js.error || res.statusText);

      loadingEl.style.display = "none";
      outputEl.textContent = js.optimized || "";
      outputEl.style.display = "block";
      downloadsEl && (downloadsEl.style.display = "flex");
    }catch(err){
      console.error(err);
      loadingEl.style.display = "none";
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
