// === resume-analyzer-extras.js ===
// Assumes handleCommonErrors + AI_ENDPOINT from resume-builder.js are available.

(function(){
  const $ = (s,root=document)=>root.querySelector(s);
  const $$ = (s,root=document)=>Array.from(root.querySelectorAll(s));

  // ---- Helpers to grab the current resume text from the builder form ----
  function currentResumeText(){
    const form = $("#resumeForm");
    if (!form) return { summary:"", bullets:[], paragraphs:[] };

    const summary = form.summary?.value?.trim() || "";
    // Collect bullets from all experience items
    const bullets = $$("#exp-list .rb-item textarea[name='bullets']")
      .flatMap(t => (t.value||"").split(/\r?\n/))
      .map(s => s.replace(/^•\s*/,"").trim())
      .filter(Boolean);

    // Paragraphs: summary + any multi-line text fields you may add later
    const paragraphs = [summary].filter(Boolean);
    return { summary, bullets, paragraphs };
  }

  // ---- Simple client-side diagnostics if AI unavailable ----
  function heuristicIssues(text){
    const issues = [];
    const wordCount = (text.match(/\S+/g)||[]).length;
    if (wordCount < 10) issues.push("Too short — aim for at least 10–16 words.");
    if (!/[0-9%]/.test(text)) issues.push("No measurable impact — add metrics (e.g., %/time/$).");
    if (!/^[A-Z][a-z]+/.test(text)) issues.push("Start with a capitalized action verb.");
    if (/^(responsible|helped|worked|assisted|tasked)\b/i.test(text))
      issues.push("Weak opener — swap for a stronger action verb.");
    if (/I\s|my\s/i.test(text)) issues.push("First person pronouns — resumes typically omit 'I'/'my'.");
    return issues;
  }

  // ---- Render “Resume analysis” panel ----
  async function renderAnalysis(){
    const panel = $("#panel-analysis");
    if (!panel) return;

    panel.innerHTML = `<p>Analyzing your bullets…</p>`;
    const data = currentResumeText();

    let findings = [];
    try {
      // Prefer server AI if available
      if (window.AI_ENDPOINT){
        const res = await fetch(AI_ENDPOINT, {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({
            field: "resume_analysis",
            context: { bullets: data.bullets, summary: data.summary }
          })
        });
        await handleCommonErrors(res);
        const json = await res.json().catch(()=>({}));
        if (Array.isArray(json.issues) && json.issues.length){
          findings = json.issues; // each: { text, problems:[...], suggestion }
        }
      }
    } catch {}

    // Fallback: create issues for bullets that trip heuristics
    if (!findings.length){
      findings = data.bullets.map(b => {
        const problems = heuristicIssues(b);
        return problems.length ? { text:b, problems, suggestion:null } : null;
      }).filter(Boolean);
    }

    if (!findings.length){
      panel.innerHTML = `<p>Nice! We didn’t find obvious issues. You can still try the AI helper for punchier wording.</p>`;
      return;
    }

    panel.innerHTML = findings.map((f,idx)=>`
      <div class="rw-issue">
        <h4>Needs improvement <small>(${idx+1}/${findings.length})</small></h4>
        <p><em>${escapeHtml(f.text || "")}</em></p>
        <ul>${(f.problems||[]).map(p=>`<li>${escapeHtml(p)}</li>`).join("")}</ul>
        <div class="rw-suggest" data-src="${encodeURIComponent(f.text||"")}">
          <button type="button" class="btn btn-primary rw-ai-rewrite">AI helper: rewrite</button>
          <div class="rw-ai-out" style="margin-top:.5rem;"></div>
        </div>
        <small>How to fix: quantify impact, start with a strong verb, keep it concise (1 line), and include tools where relevant.</small>
      </div>
    `).join("");

    // wire “AI helper: rewrite” inside each issue card
    $$(".rw-ai-rewrite", panel).forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const host = btn.closest(".rw-suggest");
        const out  = $(".rw-ai-out", host);
        const src  = decodeURIComponent(host.dataset.src||"");
        out.textContent = "Thinking…";
        try{
          let suggestion = "";
          if (window.AI_ENDPOINT){
            const r = await fetch(AI_ENDPOINT, {
              method:"POST",
              headers:{ "Content-Type":"application/json" },
              body: JSON.stringify({ field:"rewrite_bullet", context:{ text:src }})
            });
            await handleCommonErrors(r);
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
            <button type="button" class="btn rw-insert-bullet" style="margin-top:.4rem;">Insert into current job</button>
          `;
          $(".rw-insert-bullet", out)?.addEventListener("click", ()=>{
            // Append into first bullets textarea
            const ta = $("#exp-list .rb-item textarea[name='bullets']");
            if (!ta) return;
            const prefix = ta.value && !ta.value.endsWith("\n") ? "\n" : "";
            ta.value += prefix + "• " + suggestion;
            ta.dispatchEvent(new Event("input",{bubbles:true}));
          });
        }catch(e){
          out.textContent = e?.message || "AI helper unavailable.";
        }
      });
    });
  }

  // ---- Power verbs panel (a curated list the user can click to copy/insert) ----
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
        chip.addEventListener("click", ()=>{
          const v = chip.dataset.v;
          // insert at cursor into the first bullets textarea
          const ta = $("#exp-list .rb-item textarea[name='bullets']");
          if (!ta) return;
          const start = ta.selectionStart || 0;
          const end   = ta.selectionEnd || 0;
          const before = ta.value.slice(0,start);
          const after  = ta.value.slice(end);
          const insert = (start===0 || /\n$/.test(before)) ? `• ${v} ` : `${v} `;
          ta.value = before + insert + after;
          ta.focus();
          ta.selectionStart = ta.selectionEnd = (before+insert).length;
          ta.dispatchEvent(new Event("input",{bubbles:true}));
        });
      });
    }
    paint(POWER_VERBS);
    $("#verbs-filter").addEventListener("input", (e)=>{
      const q = (e.target.value||"").trim().toLowerCase();
      paint(POWER_VERBS.filter(v=>v.toLowerCase().includes(q)));
    });
  }

  // ---- AI helper (global button) opens analysis panel and shows first rewrite ----
  function wireAiHelper(){
    const btn = $("#ai-helper-btn");
    if (!btn) return;
    btn.addEventListener("click", async ()=>{
      // Show analysis panel and trigger render
      selectPanel("analysis");
      await renderAnalysis();
      // auto-click first AI rewrite if present
      setTimeout(()=>{$(".rw-ai-rewrite")?.click();}, 150);
    });
  }

  // ---- Panel switching (works with any .rw-pill [data-panel]) ----
  function selectPanel(name){
    $$(".rw-panel").forEach(p=>p.hidden = true);
    if (name === "analysis") $("#panel-analysis").hidden = false;
    if (name === "verbs")    $("#panel-verbs").hidden = false;
    $$(".rw-pill[data-panel]").forEach(b=>{
      b.classList.toggle("active", b.dataset.panel === name);
      b.setAttribute("aria-selected", b.dataset.panel === name ? "true":"false");
    });
  }

  // Hook toolbar clicks
  document.addEventListener("click", async (e)=>{
    const btn = e.target.closest(".rw-pill[data-panel]");
    if (!btn) return;
    const panel = btn.dataset.panel;
    selectPanel(panel);
    if (panel === "analysis") await renderAnalysis();
    if (panel === "verbs")    renderVerbs();
  });

  // Boot: if you want one of the new tabs to pre-render, call here
  // renderVerbs(); // uncomment to preload verbs
  wireAiHelper();
})();
