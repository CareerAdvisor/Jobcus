// === resume-analyzer-extras.js (patched for dashboard + builder) ===
// Works on both /dashboard and /resume-builder pages.
// Requires AI_ENDPOINT, handleCommonErrors, escapeHtml (we polyfill in resume-analyzer.js).

(function(){
  const $ = (s,root=document)=>root.querySelector(s);
  const $$ = (s,root=document)=>Array.from(root.querySelectorAll(s));

  // ------- Storage helpers -------
  function getStoredAnalysis(){
    try { return JSON.parse(localStorage.getItem("resumeAnalysis")||"null") || null; }
    catch { return null; }
  }
  function getStoredRawText(){
    // saved by legacy analyzer; may be empty
    return (localStorage.getItem("resumeTextRaw")||"").trim();
  }

  // ---- Collect current text/bullets (builder first, dashboard fallback) ----
  function currentResumeText(){
    // Prefer builder DOM
    const form = $("#resumeForm");
    if (form){
      const summary = form.summary?.value?.trim() || "";
      const bullets = $$("#exp-list .rb-item textarea[name='bullets']")
        .flatMap(t => (t.value||"").split(/\r?\n/))
        .map(s => s.replace(/^•\s*/,"").trim())
        .filter(Boolean);
      const paragraphs = [summary].filter(Boolean);
      return { summary, bullets, paragraphs };
    }

    // Dashboard: fall back to stored analysis/text
    const raw = getStoredRawText();
    const a = getStoredAnalysis();
    const bullets =
      // try to split raw text into lines that look like bullets
      (raw ? raw.split(/\r?\n/).map(s=>s.replace(/^•\s*/,"").trim()).filter(Boolean) : [])
      // if empty, derive pseudo-bullets from issues (so AI can still help)
      || (Array.isArray(a?.analysis?.issues) ? a.analysis.issues.slice(0,8) : []);
    return { summary:"", bullets, paragraphs:[raw] };
  }

  // ---- Simple client-side diagnostics if AI unavailable ----
  function heuristicIssues(text){
    const issues = [];
    const wordCount = (text.match(/\S+/g)||[]).length;
    if (wordCount < 10) issues.push("Too short — aim for at least 10–16 words.");
    if (!/[0-9%]/.test(text)) issues.push("No measurable impact — add metrics (e.g., %/time/$).");
    if (!/^[A-Z]/.test(text)) issues.push("Start with a strong, capitalized action verb.");
    if (/^(responsible|helped|worked|assisted|tasked)\b/i.test(text))
      issues.push("Weak opener — swap for a stronger action verb.");
    if (/I\s|my\s/i.test(text)) issues.push("Avoid first person (‘I’, ‘my’) in bullets.");
    return issues;
  }

  // ---- Resume analysis panel ----
  async function renderAnalysis(){
    const panel = $("#panel-analysis");
    if (!panel) return;

    panel.innerHTML = `<p>Analyzing your resume content…</p>`;
    const data = currentResumeText();

    let findings = [];
    try {
      // Prefer server AI if available and we have something to analyze
      if (window.AI_ENDPOINT && (data.bullets && data.bullets.length)){
        const res = await fetch(AI_ENDPOINT, {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({
            field: "resume_analysis",
            context: { bullets: data.bullets, summary: data.summary || "" }
          })
        });
        const err = await handleCommonErrors(res); if (err) throw err;
        const j = await res.json().catch(()=>({}));
        if (Array.isArray(j.issues)) findings = j.issues;
      }
    } catch (e) {
      console.warn("AI analysis unavailable, using heuristics:", e);
    }

    // Fallback: heuristics on first 8 bullets
    if (!findings.length){
      const src = (data.bullets||[]).slice(0,8);
      findings = src.map(b=>{
        const problems = heuristicIssues(b);
        return problems.length ? { text:b, problems, suggestion:null } : null;
      }).filter(Boolean);
    }

    // Final fallback: show stored issues from previous analyzer run
    if (!findings.length){
      const a = getStoredAnalysis();
      const arr = Array.isArray(a?.analysis?.issues) ? a.analysis.issues : [];
      if (arr.length){
        findings = arr.map(s => ({ text:String(s), problems:[], suggestion:null }));
      }
    }

    if (!findings.length){
      panel.innerHTML = `<p>Nice! We didn’t find obvious issues. You can still try the AI helper for punchier wording.</p>`;
      return;
    }

    panel.innerHTML = findings.map((f,idx)=>`
      <div class="rw-issue">
        <h4>Needs improvement <small>(${idx+1}/${findings.length})</small></h4>
        ${f.text ? `<p><em>${escapeHtml(f.text)}</em></p>` : ""}
        ${Array.isArray(f.problems) && f.problems.length ? `<ul>${f.problems.map(p=>`<li>${escapeHtml(p)}</li>`).join("")}</ul>` : ""}
        <div class="rw-suggest" data-src="${encodeURIComponent(f.text||"")}">
          <button type="button" class="btn btn-primary rw-ai-rewrite">AI helper: rewrite</button>
          <div class="rw-ai-out" style="margin-top:.5rem;"></div>
        </div>
        <small>How to fix: quantify impact, start with a strong verb, add a metric and an outcome, keep it concise (1 line), and include relevant tools.</small>
      </div>
    `).join("");

    // Wire AI rewrite
    $$(".rw-ai-rewrite", panel).forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const host = btn.closest(".rw-suggest");
        const out  = $(".rw-ai-out", host);
        const src  = decodeURIComponent(host.dataset.src||"").trim();
        out.textContent = "Thinking…";
        try{
          let suggestion = "";
          if (window.AI_ENDPOINT && src){
            const r = await fetch(AI_ENDPOINT, {
              method:"POST",
              headers:{ "Content-Type":"application/json" },
              body: JSON.stringify({ field:"rewrite_bullet", context:{ text: src } })
            });
            const err = await handleCommonErrors(r); if (err) throw err;
            const j = await r.json().catch(()=>({}));
            suggestion = j.text || (Array.isArray(j.list)? j.list.join(" ") : "");
          }
          if (!suggestion){
            // fallback template
            suggestion = src
              .replace(/^(responsible|helped|worked|assisted|tasked)\b.*?:?\s*/i,"")
              .replace(/^([a-z])/, (m)=>m.toUpperCase());
            suggestion = `Improved ${suggestion} by X% by doing Y, resulting in Z.`;
          }
          out.innerHTML = `
            <div><strong>Suggestion:</strong> ${escapeHtml(suggestion)}</div>
            <button type="button" class="btn rw-insert-bullet" style="margin-top:.4rem;">Insert into builder</button>
          `;
          $(".rw-insert-bullet", out)?.addEventListener("click", ()=>{
            const ta = $("#exp-list .rb-item textarea[name='bullets']");
            if (ta){
              const prefix = ta.value && !ta.value.endsWith("\n") ? "\n" : "";
              ta.value += prefix + "• " + suggestion;
              ta.dispatchEvent(new Event("input",{bubbles:true}));
            } else {
              // Dashboard: copy to clipboard
              navigator.clipboard?.writeText(`• ${suggestion}`);
            }
          });
        }catch(e){
          out.textContent = e?.message || "AI helper unavailable.";
        }
      });
    });
  }

  // ---- Power verbs panel ----
  const POWER_VERBS = [
    "Accelerated","Architected","Boosted","Consolidated","Deployed","Designed","Enabled",
    "Engineered","Enhanced","Expanded","Expedited","Implemented","Improved","Launched",
    "Led","Optimized","Orchestrated","Piloted","Reduced","Refactored","Resolved","Scaled",
    "Streamlined","Strengthened","Spearheaded","Standardized","Transformed","Unified"
  ];

  function renderVerbs(){
    const panel = $("#panel-verbs");
    if (!panel) return;
    panel.innerHTML = `
      <label class="full" style="display:block;margin-bottom:.5rem;">
        <input id="verbs-filter" type="text" placeholder="Filter verbs…" style="width:100%;padding:.5rem;border:1px solid #d6dbe1;border-radius:8px;">
      </label>
      <div id="verbs-wrap"></div>
      <small>Tip: start bullets with a strong verb + metric (%, $, time) + outcome.</small>
    `;
    const wrap = $("#verbs-wrap", panel);
    function paint(list){
      wrap.innerHTML = list.map(v=>`<span class="rw-verb-chip" data-v="${v}">${v}</span>`).join("");
      $$(".rw-verb-chip", wrap).forEach(chip=>{
        chip.addEventListener("click", async ()=>{
          const v = chip.dataset.v;
          const ta = $("#exp-list .rb-item textarea[name='bullets']");
          if (ta){
            const start = ta.selectionStart || 0;
            const end   = ta.selectionEnd || 0;
            const before = ta.value.slice(0,start);
            const after  = ta.value.slice(end);
            const insert = (start===0 || /\n$/.test(before)) ? `• ${v} ` : `${v} `;
            ta.value = before + insert + after;
            ta.focus();
            ta.selectionStart = ta.selectionEnd = (before+insert).length;
            ta.dispatchEvent(new Event("input",{bubbles:true}));
          } else {
            // Dashboard: copy to clipboard
            try { await navigator.clipboard.writeText(v + " "); } catch {}
          }
        });
      });
    }
    paint(POWER_VERBS);
    $("#verbs-filter").addEventListener("input", (e)=>{
      const q = (e.target.value||"").toLowerCase().trim();
      const list = POWER_VERBS.filter(v=>v.toLowerCase().includes(q));
      paint(list);
    });
  }

  // ---- AI helper button (opens analysis and triggers one rewrite) ----
  function wireAiHelper(){
    const btn = $("#ai-helper-btn");
    if (!btn) return;
    btn.addEventListener("click", async ()=>{
      selectPanel("analysis");
      await renderAnalysis();
      setTimeout(()=>{$(".rw-ai-rewrite")?.click();}, 150);
    });
  }

  // ---- Panel switching ----
  function selectPanel(name){
    $$(".rw-panel").forEach(p=>p.hidden = true);
    if (name === "analysis") $("#panel-analysis").hidden = false;
    if (name === "verbs")    $("#panel-verbs").hidden = false;
    $$(".rw-pill[data-panel]").forEach(b=>{
      b.classList.toggle("active", b.dataset.panel === name);
      b.setAttribute("aria-selected", b.dataset.panel === name ? "true":"false");
    });
  }

  document.addEventListener("click", async (e)=>{
    const btn = e.target.closest(".rw-pill[data-panel]");
    if (!btn) return;
    const panel = btn.dataset.panel;
    selectPanel(panel);
    if (panel === "analysis") await renderAnalysis();
    if (panel === "verbs")    renderVerbs();
  });

  // Initialize
  wireAiHelper();
})();
