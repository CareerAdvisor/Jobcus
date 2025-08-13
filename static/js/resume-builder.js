// Ensure fetch keeps cookies
(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

function qs(root, sel)  { return (root || document).querySelector(sel); }
function qsa(root, sel) { return Array.from((root || document).querySelectorAll(sel)); }
function withinBuilder(sel){ return `#resume-builder ${sel}`; }

// Debounce
function debounce(fn, wait = 400){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }

const AI_ENDPOINT = "/ai/suggest";

function gatherContext(form) {
  const builder = qs(document, "#resume-builder");
  const name = [form.firstName?.value, form.lastName?.value].filter(Boolean).join(" ").trim();
  const contactParts = [];
  const loc = [form.city?.value, form.country?.value].filter(Boolean).join(", ");
  if (loc) contactParts.push(loc);
  if (form.phone?.value) contactParts.push(form.phone.value);
  if (form.email?.value) contactParts.push(form.email.value);

  const expNodes = qsa(builder, "#exp-list .rb-item");
  const experience = expNodes.map((node) => {
    const g = (n) => qs(node, `[name="${n}"]`);
    const bullets = (g("bullets").value || "")
      .split("\n").map(t => t.replace(/^•\s*/, "").trim()).filter(Boolean);
    return {
      role: g("role").value, company: g("company").value, location: g("location").value,
      start: g("start").value, end: g("end").value, bullets
    };
  });

  const eduNodes = qsa(builder, "#edu-list .rb-item");
  const education = eduNodes.map((node) => {
    const g = (n) => qs(node, `[name="${n}"]`);
    return {
      degree: g("degree").value, school: g("school").value,
      location: g("location").value,
      graduated: g("graduated").value || g("graduatedStart").value
    };
  });

  const skills = (form.elements["skills"]?.value || "").split(",").map(s => s.trim()).filter(Boolean);

  return {
    name,
    title: form.title?.value.trim() || "",
    contact: contactParts.join(" | "),
    summary: form.summary?.value.trim() || "",
    links: form.portfolio?.value ? [{ url: form.portfolio.value, label: "Portfolio" }] : [],
    experience, education, skills
  };
}

async function aiSuggest(field, ctx, index) {
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, index, context: ctx }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error || `AI suggest failed for ${field}`);
    return json;
  } catch (e) {
    console.warn(e);
    return { text: "AI suggestion currently unavailable. Try again." };
  }
}

function attachAISuggestionHandlers() {
  const builder = qs(document, "#resume-builder");
  builder.addEventListener("click", async (e) => {
    const btn = e.target.closest(".ai-refresh, .ai-add");
    if (!btn) return;

    const card = btn.closest(".ai-suggest");
    const form = qs(builder, "#resumeForm");

    if (btn.classList.contains("ai-refresh")) {
      const field = btn.dataset.ai;
      const ctx = gatherContext(form);

      if (field === "summary") {
        const sug = await aiSuggest("summary", ctx);
        const p = qs(card, ".ai-text");
        p.textContent = sug.text || p.textContent;
      } else if (field === "highlights") {
        const all = qsa(builder, "#exp-list .rb-item");
        const idx = all.findIndex((n) => n.contains(card));
        const sug = await aiSuggest("highlights", ctx, idx);
        const p = qs(card, ".ai-text");
        p.textContent = Array.isArray(sug.list) && sug.list.length
          ? sug.list.map((b) => `• ${b}`).join("\n")
          : (sug.text || p.textContent);
      }
      return;
    }

    if (btn.classList.contains("ai-add")) {
      const step = btn.closest(".rb-step");
      const cardWrap = btn.closest(".rb-card, .rb-item");
      const suggestion = qs(card, ".ai-text")?.textContent?.trim() || "";
      if (!suggestion) return;

      let ta = null;
      if (card.dataset.field === "summary") ta = qs(step, 'textarea[name="summary"]');
      else if (card.dataset.field === "bullets") ta = qs(cardWrap, 'textarea[name="bullets"]');
      if (!ta) ta = qs(cardWrap, "textarea");
      if (!ta) return;

      if (ta.name === "bullets") {
        const prefix = ta.value && !ta.value.endsWith("\n") ? "\n" : "";
        const cleaned = suggestion.split("\n").map(s => s.replace(/^•\s*/, "").trim()).filter(Boolean);
        ta.value += `${prefix}${cleaned.map(b => `• ${b}`).join("\n")}`;
      } else {
        ta.value = suggestion.replace(/^•\s*/g, "");
      }
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

// Repeaters
function cloneFromTemplate(tplId) {
  const tpl = qs(document, withinBuilder(`#${tplId}`));
  if (!tpl) return null;
  const node = tpl.content.firstElementChild.cloneNode(true);
  qs(node, ".rb-remove")?.addEventListener("click", () => node.remove());
  setTimeout(() => { qs(node, ".ai-suggest .ai-refresh")?.click(); }, 0);
  return node;
}
function addExperienceFromObj(obj = {}) {
  const list = qs(document, withinBuilder("#exp-list"));
  const node = cloneFromTemplate("tpl-experience");
  if (!node || !list) return;
  const g = (n) => qs(node, `[name="${n}"]`);
  g("role").value = obj.role || "";
  g("company").value = obj.company || "";
  g("start").value = obj.start || "";
  g("end").value = obj.end || "";
  g("location").value = obj.location || "";
  g("bullets").value = (obj.bullets || []).join("\n");
  list.appendChild(node);
}
function addEducationFromObj(obj = {}) {
  const list = qs(document, withinBuilder("#edu-list"));
  const node = cloneFromTemplate("tpl-education");
  if (!node || !list) return;
  const g = (n) => qs(node, `[name="${n}"]`);
  g("school").value = obj.school || "";
  g("degree").value = obj.degree || "";
  g("graduatedStart").value = obj.graduatedStart || "";
  g("graduated").value = obj.graduated || "";
  g("location").value = obj.location || "";
  list.appendChild(node);
}

// Skills chips
function initSkills() {
  const builder = qs(document, "#resume-builder");
  const skillInput = qs(builder, "#skillInput");
  const skillChips = qs(builder, "#skillChips");
  const skillsHidden = qs(builder, 'input[name="skills"]');
  const skillsSet = new Set();

  function refreshChips() {
    if (!skillChips || !skillsHidden) return;
    skillChips.innerHTML = "";
    skillsHidden.value = Array.from(skillsSet).join(",");
    skillsSet.forEach((s) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = `${s} <button type="button" aria-label="Remove">×</button>`;
      chip.querySelector("button").onclick = () => { skillsSet.delete(s); refreshChips(); };
      skillChips.appendChild(chip);
    });
  }

  skillInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && skillInput.value.trim()) {
      e.preventDefault();
      skillsSet.add(skillInput.value.trim());
      skillInput.value = "";
      refreshChips();
    }
  });

  return { refreshChips, skillsSet };
}

// Server render helpers (unchanged)
async function renderWithTemplateFromContext(ctx, format = "html", theme = "modern") {
  if (format === "pdf") {
    const res = await fetch("/build-resume", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "pdf", theme, ...ctx }),
    });
    if (!res.ok) throw new Error(`PDF build failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "resume.pdf"; a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const r = await fetch("/build-resume", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "html", theme, ...ctx }),
  });
  const html = await r.text();
  if (!r.ok) throw new Error(`HTML build failed: ${r.status} ${html}`);
  const wrap  = qs(document, withinBuilder("#resumePreviewWrap, #resumePreviewWrapFinish"));
  const frame = qs(document, withinBuilder("#resumePreview, #resumePreviewFinish"));
  if (wrap && frame) { wrap.style.display = "block"; frame.srcdoc = html; }
}

function initWizard() {
  const builder = qs(document, "#resume-builder");
  const form = qs(builder, "#resumeForm");

  const steps = [
    "#step-personal",
    "#step-contact",
    "#step-summary",
    "#step-experience",
    "#step-skills",
    "#step-education",
    "#step-design",
    "#step-finish",
  ].map(sel => qs(builder, sel));

  const tabs = qsa(builder, ".rb-tabs button");
  const back = qs(builder, "#rb-back");
  const next = qs(builder, "#rb-next");
  const submitBtn = qs(builder, "#rb-submit");
  let idx = 0;

  function stepIndexById(id){ return steps.findIndex(s => s && ("#" + s.id) === id); }

  function updateButtons() {
    if (back) back.disabled = idx === 0;
    if (next) next.style.display = idx >= steps.length - 2 ? "none" : "inline-block";
    if (submitBtn) submitBtn.style.display = (idx === steps.length - 2) ? "inline-block" : "none";
  }

  async function onEnterStep(i) {
    const node = steps[i]; if (!node) return;
    if (node.id === "step-summary" && !node.dataset.loaded) {
      node.dataset.loaded = "1";
      qs(node, "#ai-summary .ai-refresh")?.click();
    }
    if (node.id === "step-experience" && !qs(builder, "#exp-list .rb-item")) addExperienceFromObj();
    if (node.id === "step-education" && !qs(builder, "#edu-list .rb-item")) addEducationFromObj();
    if (node.id === "step-experience" && !node.dataset.loaded) {
      node.dataset.loaded = "1";
      qsa(builder, "#exp-list .ai-suggest .ai-refresh").forEach(btn => btn.click());
    }
  }

  function showStep(i) {
    idx = Math.max(0, Math.min(i, steps.length - 1));
    steps.forEach((s, k) => {
      if (!s) return;
      const active = k === idx;
      s.hidden = !active;
      s.classList.toggle("active", active);
    });
    // Sync tab active state to the current step (based on data-target)
    tabs.forEach(btn => {
      const tId = btn.getAttribute("data-target");
      const isActive = tId && steps[idx] && ("#" + steps[idx].id) === tId;
      btn.classList.toggle("active", !!isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
    updateButtons();
    onEnterStep(idx);
  }

  // Tab clicks: jump to their mapped step
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-target");
      const i = stepIndexById(target);
      if (i >= 0) showStep(i);
    });
  });

  back?.addEventListener("click", () => showStep(idx - 1));
  next?.addEventListener("click", () => showStep(idx + 1));

  // Add buttons (experience/education)
  builder.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-add]");
    if (!addBtn) return;
    const type = addBtn.getAttribute("data-add");
    if (type === "experience") addExperienceFromObj();
    if (type === "education") addEducationFromObj();
  });

  // Photo upload
  qs(builder, "#photoBtn")?.addEventListener("click", () => qs(builder, "#photoInput")?.click());
  qs(builder, "#photoInput")?.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    const img = qs(builder, "#photoPreview");
    if (file && img) {
      const url = URL.createObjectURL(file);
      img.src = url; img.hidden = false;
    }
  });

  // Submit → generate, then go to Finish
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      qs(builder, "#builderGeneratingIndicator").style.display = "block";
      const ctxForTemplate = gatherContext(form);

      const educationStr = (ctxForTemplate.education || [])
        .map(ed => [ed.degree, ed.school, ed.location, ed.graduated].filter(Boolean).join(" – "))
        .join("\n");
      const experienceStr = (ctxForTemplate.experience || [])
        .map(e => `${e.role}${e.company ? " – " + e.company : ""}\n${(e.bullets || []).map(b => "• " + b).join("\n")}`)
        .join("\n\n");
      const payload = {
        fullName: ctxForTemplate.name || "",
        title: ctxForTemplate.title || "",
        contact: ctxForTemplate.contact || "",
        summary: ctxForTemplate.summary || "",
        education: educationStr,
        experience: experienceStr,
        skills: (ctxForTemplate.skills || []).join(", "),
        certifications: form.elements["certifications"]?.value?.trim() || "",
        portfolio: (ctxForTemplate.links?.[0]?.url) || "",
      };

      const gen = await fetch("/generate-resume", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const genJson = await gen.json().catch(() => ({}));
      if (!gen.ok || genJson.error) throw new Error(genJson.error || "Generate failed");

      window._resumeCtx = genJson.context || ctxForTemplate;
      showStep(stepIndexById("#step-finish"));
    } catch (err) {
      console.error("Generate/build error:", err);
      alert("Resume generation failed.");
    } finally {
      qs(builder, "#builderGeneratingIndicator").style.display = "none";
    }
  });

  // Preview / PDF (Design + Finish)
  const previewBtn  = qs(builder, "#previewTemplate");
  const pdfBtn      = qs(builder, "#downloadTemplatePdf");
  const themeSelect = qs(builder, "#themeSelect");

  previewBtn?.addEventListener("click", async () => {
    try {
      qs(builder, "#builderGeneratingIndicator").style.display = "block";
      const ctx = window._resumeCtx || gatherContext(qs(builder, "#resumeForm"));
      await renderWithTemplateFromContext(ctx, "html", themeSelect?.value || "modern");
    } catch (e) { console.error(e); alert(e.message || "Preview failed"); }
    finally { qs(builder, "#builderGeneratingIndicator").style.display = "none"; }
  });

  pdfBtn?.addEventListener("click", async () => {
    try {
      qs(builder, "#builderGeneratingIndicator").style.display = "block";
      const ctx = window._resumeCtx || gatherContext(qs(builder, "#resumeForm"));
      await renderWithTemplateFromContext(ctx, "pdf", themeSelect?.value || "modern");
    } catch (e) { console.error(e); alert(e.message || "PDF build failed"); }
    finally { qs(builder, "#builderGeneratingIndicator").style.display = "none"; }
  });

  qs(builder, "#previewTemplateFinish")?.addEventListener("click", () => previewBtn?.click());
  qs(builder, "#downloadTemplatePdfFinish")?.addEventListener("click", () => pdfBtn?.click());

  // Start
  showStep(0);
}

async function maybePrefillFromAnalyzer(form, helpers) {
  const raw = localStorage.getItem("resumeTextRaw");
  if (!raw || !form) return;
  const builder = qs(document, "#resume-builder");
  const isEmpty = !(form.firstName?.value || form.lastName?.value || form.title?.value || form.summary?.value) &&
                  !qs(builder, "#exp-list .rb-item input[value]");
  if (!isEmpty) return;

  try {
    const gen = await fetch("/generate-resume", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName:"", title:"", contact:"", summary: raw, education:"", experience: raw, skills:"", certifications:"", portfolio:"" }),
    });
    const genJson = await gen.json().catch(() => ({}));
    if (!gen.ok || genJson.error) throw new Error(genJson.error || "Generate failed");

    const ctx = genJson.context || {};
    const name = (ctx.name || "").trim().split(" ");
    if (form.firstName) form.firstName.value = name.shift() || "";
    if (form.lastName)  form.lastName.value  = name.join(" ");
    if (form.title)   form.title.value   = ctx.title || "";
    if (form.summary) form.summary.value = ctx.summary || "";
    if (ctx.links && ctx.links[0] && form.portfolio) form.portfolio.value = ctx.links[0].url || "";

    if (Array.isArray(ctx.skills) && ctx.skil
