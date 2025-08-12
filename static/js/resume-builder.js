// Keep cookies for SameSite/Lax
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  //
  // Builder only
  //
  const form             = document.getElementById("resumeForm");
  const builderIndicator = document.getElementById("builderGeneratingIndicator");
  const outputContainer  = document.getElementById("builderGeneratedContent");
  const downloadOptions  = document.getElementById("resumeDownloadOptions");

  const previewBtn = document.getElementById("previewTemplate");
  const pdfBtn     = document.getElementById("downloadTemplatePdf");

  const previewWrap = document.getElementById("resumePreviewWrap");
  const previewEl   = document.getElementById("resumePreview"); // <iframe>

  function getTheme() {
    return document.getElementById("themeSelect")?.value || "modern";
  }

  /* ──────────────────────────────────────────────────────────────
     NEW UI: tabs/steps, repeaters, chip input, and NEW coerce()
     (inserted here so the rest of the script can use them)
  ────────────────────────────────────────────────────────────── */

  // Tabs / sections
  const tabs = document.querySelectorAll('.rb-tabs button');
  tabs.forEach(btn => btn?.addEventListener('click', () => {
    tabs.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.rb-step').forEach(s => s.hidden = true);
    document.querySelector(btn.dataset.target)?.removeAttribute('hidden');
  }));

  // Step footer nav
  const steps = Array.from(document.querySelectorAll('.rb-step'));
  let stepIndex = 0;
  const backBtn = document.getElementById('rb-back');
  const nextBtn = document.getElementById('rb-next');
  function showStep(i){
    stepIndex = Math.max(0, Math.min(i, steps.length-1));
    steps.forEach((s, idx) => s.hidden = idx !== stepIndex);
    tabs.forEach((t, idx) => t.classList.toggle('active', idx === stepIndex));
    if (backBtn) backBtn.disabled = stepIndex === 0;
    if (nextBtn) nextBtn.disabled = stepIndex === steps.length-1;
  }
  backBtn?.addEventListener('click', () => showStep(stepIndex-1));
  nextBtn?.addEventListener('click', () => showStep(stepIndex+1));
  if (steps.length) showStep(0);

  // Repeater helpers (experience / education)
  function cloneFromTemplate(tplId){
    const tpl = document.getElementById(tplId);
    if (!tpl) return null;
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.rb-remove')?.addEventListener('click', () => node.remove());
    return node;
  }

  function addExperienceFromObj(obj = {}){
    const list = document.getElementById('exp-list');
    const node = cloneFromTemplate('tpl-experience');
    if (!node || !list) return;
    node.querySelector('[name="role"]').value      = obj.role || '';
    node.querySelector('[name="company"]').value   = obj.company || '';
    node.querySelector('[name="start"]').value     = obj.start || '';
    node.querySelector('[name="end"]').value       = obj.end || '';
    node.querySelector('[name="location"]').value  = obj.location || '';
    node.querySelector('[name="bullets"]').value   = (obj.bullets || []).join('\n');
    list.appendChild(node);
  }

  function addEducationFromObj(obj = {}){
    const list = document.getElementById('edu-list');
    const node = cloneFromTemplate('tpl-education');
    if (!node || !list) return;
    node.querySelector('[name="school"]').value          = obj.school || '';
    node.querySelector('[name="degree"]').value          = obj.degree || '';
    node.querySelector('[name="graduatedStart"]').value  = obj.graduatedStart || '';
    node.querySelector('[name="graduated"]').value       = obj.graduated || '';
    node.querySelector('[name="location"]').value        = obj.location || '';
    list.appendChild(node);
  }

  // Add one blank block to each list on load (if empty)
  if (!document.querySelector('#exp-list .rb-item')) addExperienceFromObj();
  if (!document.querySelector('#edu-list .rb-item')) addEducationFromObj();

  // Buttons to add more
  document.querySelector('[data-add="experience"]')
    ?.addEventListener('click', () => addExperienceFromObj());
  document.querySelector('[data-add="education"]')
    ?.addEventListener('click', () => addEducationFromObj());

  // Chips input for skills
  const skillInput   = document.getElementById('skillInput');
  const skillChips   = document.getElementById('skillChips');
  const skillsHidden = document.querySelector('input[name="skills"]');
  const skillsSet    = new Set();

  function refreshChips(){
    if (!skillChips || !skillsHidden) return;
    skillChips.innerHTML = '';
    skillsHidden.value = Array.from(skillsSet).join(',');
    skillsSet.forEach(s => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${s} <button type="button" aria-label="remove">×</button>`;
      chip.querySelector('button').onclick = () => { skillsSet.delete(s); refreshChips(); };
      skillChips.appendChild(chip);
    });
  }
  skillInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && skillInput.value.trim()){
      e.preventDefault();
      skillsSet.add(skillInput.value.trim());
      skillInput.value = '';
      refreshChips();
    }
  });

  // Compose contact → single string for template
  function contactString(f){
    const parts = [];
    const loc = [f.city?.value, f.country?.value].filter(Boolean).join(', ');
    if (loc) parts.push(loc);
    if (f.phone?.value) parts.push(f.phone.value);
    if (f.email?.value) parts.push(f.email.value);
    return parts.join(' | ');
  }

  // NEW coerce used by Preview/PDF (replaces old version)
  window.coerceFormToTemplateContext = function(){
    const f = document.getElementById('resumeForm');

    const name = [f.firstName?.value, f.lastName?.value].filter(Boolean).join(' ').trim();
    const links = f.portfolio?.value ? [{ url: f.portfolio.value, label: 'Portfolio' }] : [];

    // experience[]
    const exp = Array.from(document.querySelectorAll('#exp-list .rb-item')).map(node => {
      const g = n => node.querySelector(`[name="${n}"]`);
      const bullets = (g('bullets').value || '')
        .split('\n').map(t => t.replace(/^•\s*/,'').trim()).filter(Boolean);
      return {
        role: g('role').value, company: g('company').value,
        location: g('location').value, start: g('start').value, end: g('end').value,
        bullets
      };
    });

    // education[]
    const edu = Array.from(document.querySelectorAll('#edu-list .rb-item')).map(node => {
      const g = n => node.querySelector(`[name="${n}"]`);
      return {
        degree: g('degree').value,
        school: g('school').value,
        location: g('location').value,
        graduated: g('graduated').value || g('graduatedStart').value
      };
    });

    const skillsArr = (form.querySelector('input[name="skills"]')?.value || '')
      .split(',').map(s => s.trim()).filter(Boolean);

    return {
      name,
      title: form.title?.value.trim() || '',
      contact: contactString(form),
      summary: form.summary?.value.trim() || '',
      links,
      experience: exp,
      education: edu,
      skills: skillsArr
    };
  };

  /* ──────────────────────────────────────────────────────────────
     END of new UI block
  ────────────────────────────────────────────────────────────── */

  // Try to pre-fill from analyzer (when user pasted text there)
  (async function maybePrefillFromAnalyzer(){
    const raw = localStorage.getItem("resumeTextRaw");
    if (!raw || !form) return;

    // Only prefill if the "Write" step is basically empty (no name/title/summary and no custom blocks)
    const isEmpty =
      !(form.firstName?.value || form.lastName?.value || form.title?.value || form.summary?.value) &&
      !document.querySelector('#exp-list .rb-item input[value]');

    if (!isEmpty) return;

    try {
      // Send raw text to generator; use it as summary/experience seed
      const gen = await fetch("/generate-resume", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({
          fullName: "", title: "", contact: "",
          summary: raw, education: "", experience: raw, skills: "", certifications: "", portfolio: ""
        })
      });
      const genJson = await gen.json().catch(() => ({}));
      if (!gen.ok || genJson.error) throw new Error(genJson.error || "Generate failed");

      fillFormFromContext(genJson.context || {});
      window._resumeCtx = genJson.context; // keep context for instant preview
    } catch (e) {
      console.warn("Prefill from analyzer failed:", e);
    }
  })();

  // Fill the new form (repeaters/chips) from a context object
  function fillFormFromContext(ctx) {
    if (!form) return;
    const name = (ctx.name || '').trim();
    if (name){
      const parts = name.split(' ');
      form.firstName && (form.firstName.value = parts.shift() || '');
      form.lastName  && (form.lastName.value  = parts.join(' '));
    }
    form.title    && (form.title.value    = ctx.title   || '');
    form.summary  && (form.summary.value  = ctx.summary || '');
    if (ctx.links && ctx.links[0] && form.portfolio) form.portfolio.value = ctx.links[0].url || '';

    // Skills → chips
    if (Array.isArray(ctx.skills) && ctx.skills.length){
      ctx.skills.forEach(s => skillsSet.add(s));
      refreshChips();
    }

    // Experience
    const expList = document.getElementById('exp-list');
    expList && (expList.innerHTML = '');
    (ctx.experience || []).forEach(e => addExperienceFromObj(e));
    if (expList && !expList.children.length) addExperienceFromObj();

    // Education
    const eduList = document.getElementById('edu-list');
    eduList && (eduList.innerHTML = '');
    (ctx.education || []).forEach(ed => addEducationFromObj(ed));
    if (eduList && !eduList.children.length) addEducationFromObj();
  }

  // Render preview / build PDF with server templates
  async function renderWithTemplateFromContext(ctx, format = "html", theme = "modern") {
    if (format === "pdf") {
      const res = await fetch("/build-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "pdf", theme, ...ctx })
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`PDF build failed: ${res.status} ${t}`);
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "resume.pdf"; a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const r = await fetch("/build-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "html", theme, ...ctx })
    });
    const html = await r.text();
    if (!r.ok) throw new Error(`HTML build failed: ${r.status} ${html}`);

    // keep the page clean; show in iframe
    outputContainer.innerHTML = "";
    if (previewWrap && previewEl) {
      previewWrap.style.display = "block";
      previewEl.srcdoc = html; // isolate CSS/JS
    }
  }

  // Submit → AI → template
  form?.addEventListener("submit", async e => {
    e.preventDefault();
    builderIndicator && (builderIndicator.style.display = "block");
    outputContainer && (outputContainer.innerHTML = "");
    downloadOptions && (downloadOptions.style.display = "none");

    // Build generator payload from the new form
    const ctxForTemplate = window.coerceFormToTemplateContext();
    const fullName = ctxForTemplate.name || '';

    // Flatten repeaters to simple strings for /generate-resume prompt
    const educationStr = (ctxForTemplate.education || [])
      .map(ed => [ed.degree, ed.school, ed.location, ed.graduated].filter(Boolean).join(" – "))
      .join("\n");

    const experienceStr = (ctxForTemplate.experience || [])
      .map(e => `${e.role}${e.company ? " – " + e.company : ""}\n${(e.bullets||[]).map(b=>"• "+b).join("\n")}`)
      .join("\n\n");

    const payload = {
      fullName,
      title:          ctxForTemplate.title || '',
      contact:        ctxForTemplate.contact || '',
      summary:        ctxForTemplate.summary || '',
      education:      educationStr,
      experience:     experienceStr,
      skills:         (ctxForTemplate.skills || []).join(", "),
      certifications: form.elements["certifications"]?.value?.trim() || "",
      portfolio:      (ctxForTemplate.links?.[0]?.url) || ""
    };

    try {
      const gen = await fetch("/generate-resume", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
      const genJson = await gen.json().catch(() => ({}));
      if (!gen.ok || genJson.error) throw new Error(genJson.error || "Generate failed");

      const ctx = genJson.context;
      window._resumeCtx = ctx;

      await renderWithTemplateFromContext(ctx, "html", getTheme());
      downloadOptions && (downloadOptions.style.display = "block");
    } catch (err) {
      console.error("Generate/build error:", err);
      alert("Resume generation failed.");
    } finally {
      builderIndicator && (builderIndicator.style.display = "none");
    }
  });

  // Preview button
  previewBtn?.addEventListener("click", async () => {
    try {
      builderIndicator && (builderIndicator.style.display = "block");
      const ctx = window._resumeCtx || window.coerceFormToTemplateContext();
      await renderWithTemplateFromContext(ctx, "html", getTheme());
      downloadOptions && (downloadOptions.style.display = "block");
    } catch (e) {
      console.error(e);
      alert(e.message || "Preview failed");
    } finally {
      builderIndicator && (builderIndicator.style.display = "none");
    }
  });

  // PDF button
  pdfBtn?.addEventListener("click", async () => {
    try {
      builderIndicator && (builderIndicator.style.display = "block");
      const ctx = window._resumeCtx || window.coerceFormToTemplateContext();
      await renderWithTemplateFromContext(ctx, "pdf", getTheme());
    } catch (e) {
      console.error(e);
      alert(e.message || "PDF build failed");
    } finally {
      builderIndicator && (builderIndicator.style.display = "none");
    }
  });
});

// Legacy TXT; PDF handled via server template
async function downloadResume(format) {
  const container = document.getElementById("builderGeneratedContent");
  const text = container?.innerText || "";

  if (format === "txt") {
    saveAs(new Blob([text], {type:"text/plain"}), "resume.txt");
  }
}
