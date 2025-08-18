// Ensure fetch keeps cookies
(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

function qs(root, sel){ return (root || document).querySelector(sel); }
function qsa(root, sel){ return Array.from((root || document).querySelectorAll(sel)); }
function withinBuilder(sel){ return `#resume-builder ${sel}`; }

const AI_ENDPOINT = "/ai/suggest";

// ------- Context gatherers -------
function gatherContext(form) {
  try {
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
      const bullets = (g("bullets")?.value || "")
        .split("\n").map(t => t.replace(/^•\s*/, "").trim()).filter(Boolean);
      return {
        role: g("role")?.value || "", company: g("company")?.value || "",
        location: g("location")?.value || "",
        start: g("start")?.value || "", end: g("end")?.value || "", bullets
      };
    });

    const eduNodes = qsa(builder, "#edu-list .rb-item");
    const education = eduNodes.map((node) => {
      const g = (n) => qs(node, `[name="${n}"]`);
      return {
        degree: g("degree")?.value || "", school: g("school")?.value || "",
        location: g("location")?.value || "",
        graduated: g("graduated")?.value || g("graduatedStart")?.value || ""
      };
    });

    const skills = (form.elements["skills"]?.value || "")
      .split(",").map(s => s.trim()).filter(Boolean);

    return {
      name,
      title: form.title?.value.trim() || "",
      contact: contactParts.join(" | "),
      summary: form.summary?.value.trim() || "",
      links: form.portfolio?.value ? [{ url: form.portfolio.value, label: "Portfolio" }] : [],
      experience, education, skills
    };
  } catch (e) {
    console.error("gatherContext error:", e);
    return { name:"", title:"", contact:"", summary:"", links:[], experience:[], education:[], skills:[] };
  }
}

// ------- AI helpers -------
async function aiSuggest(field, ctx, index) {
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, index, context: ctx }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error || `AI suggest failed for ${field}`);
    const lines = Array.isArray(json.list) && json.list.length
      ? json.list
      : (json.text ? json.text.split(/\r?\n/).filter(Boolean) : []);
    return lines;
  } catch (e) {
    console.warn(e);
    return ["AI suggestion currently unavailable. Try again."];
  }
}

function attachAISuggestionHandlers() {
  const builder = qs(document, "#resume-builder");
  const form = qs(builder, "#resumeForm");
  if (!builder || !form) return;

  builder.addEventListener("click", async (e) => {
    const btn = e.target.closest(".ai-refresh, .ai-add");
    if (!btn) return;

    const card = btn.closest(".ai-suggest");
    const textEl = qs(card, ".ai-text");
    if (!textEl) return;

    if (btn.classList.contains("ai-refresh")) {
      const type = btn.dataset.ai;
      textEl.textContent = "Thinking…";
      try {
        const ctx = gatherContext(form);
        if (type === "summary") {
          const lines = await aiSuggest("summary", ctx);
          textEl.textContent = lines.join(" ");
        } else if (type === "highlights") {
          const allItems = qsa(builder, "#exp-list .rb-item");
          const itemEl = btn.closest(".rb-item");
          const idx = Math.max(0, allItems.findIndex(n => n === itemEl));
          const lines = await aiSuggest("highlights", ctx, idx);
          textEl.textContent = lines.join("\n");
        } else {
          const lines = await aiSuggest("general", ctx);
          textEl.textContent = lines.join("\n");
        }
      } catch (err) {
        textEl.textContent = err.message || "AI suggestion unavailable.";
      }
      return;
    }

    if (btn.classList.contains("ai-add")) {
      const wrap = btn.closest(".rb-card, .rb-item, .rb-step");
      const taSummary = qs(wrap, 'textarea[name="summary"]');
      const taBullets = qs(wrap, 'textarea[name="bullets"]');
      const suggestion = (textEl.textContent || "").trim();
      if (!suggestion) return;

      if (taSummary) {
        taSummary.value = suggestion.replace(/^•\s*/gm, "").replace(/\n+/g, " ").trim();
        taSummary.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      if (taBullets) {
        const cleaned = suggestion.split(/\r?\n/).map(s => s.replace(/^•\s*/, "").trim()).filter(Boolean);
        const prefix = taBullets.value && !taBullets.value.endsWith("\n") ? "\n" : "";
        taBullets.value += prefix + cleaned.map(b => `• ${b}`).join("\n");
        taBullets.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  });
}

// ------- Repeaters -------
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
  if (g("role")) g("role").value = obj.role || "";
  if (g("company")) g("company").value = obj.company || "";
  if (g("start")) g("start").value = obj.start || "";
  if (g("end")) g("end").value = obj.end || "";
  if (g("location")) g("location").value = obj.location || "";
  const bullets = g("bullets");
  if (bullets) bullets.value = (obj.bullets || []).join("\n");
  list.appendChild(node);
}
function addEducationFromObj(obj = {}) {
  const list = qs(document, withinBuilder("#edu-list"));
  const node = cloneFromTemplate("tpl-education");
  if (!node || !list) return;
  const g = (n) => qs(node, `[name="${n}"]`);
  if (g("school")) g("school").value = obj.school || "";
  if (g("degree")) g("degree").value = obj.degree || "";
  if (g("graduatedStart")) g("graduatedStart").value = obj.graduatedStart || "";
  if (g("graduated")) g("graduated").value = obj.graduated || "";
  if (g("location")) g("location").value = obj.location || "";
  list.appendChild(node);
}

// ------- Skills chips -------
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

// ------- Render helpers -------
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

// ------- Wizard -------
function initWizard() {
  const builder = qs(document, "#resume-builder");
  const form = qs(builder, "#resumeForm");
  if (!builder || !form) {
    console.error("Resume builder root or form not found.");
    return;
  }

  // 1) Build steps dynamically
  const steps = qsa(builder, ".rb-step");
  if (!steps.length) {
    console.error("No wizard steps found (.rb-step).");
    return;
  }

  // 2) Controls
  const tabs = qsa(builder, ".rb-tabs button");
  const back = qs(builder, "#rb-back");
  const next = qs(builder, "#rb-next");
  const submitBtn = qs(builder, "#rb-submit");
  let idx = Math.max(0, steps.findIndex(s => s.classList.contains("active")));
  if (idx < 0) idx = 0;

  function stepIndexById(id){
    if (!id) return -1;
    const targetId = id.startsWith("#") ? id.slice(1) : id;
    return steps.findIndex(s => s && s.id === targetId);
  }

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
    const maxIdx = steps.length - 1;
    idx = Math.max(0, Math.min(i, maxIdx));
    steps.forEach((s, k) => {
      if (!s) return;
      const active = k === idx;
      s.hidden = !active;
      s.classList.toggle("active", active);
    });
    tabs.forEach(btn => {
      const tId = btn.getAttribute("data-target");
      const isActive = !!(tId && steps[idx] && ("#" + steps[idx].id) === tId);
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    updateButtons();
    onEnterStep(idx);
  }

  // 3) Tab clicks: jump directly
  tabs.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const target = btn.getAttribute("data-target");
      const i = stepIndexById(target);
      if (i >= 0) showStep(i);
    });
  });

  // 4) Back / Next
  back?.addEventListener("click", (e) => { e.preventDefault(); showStep(idx - 1); });
  next?.addEventListener("click", (e) => { e.preventDefault(); showStep(idx + 1); });

  // 5) Add buttons (experience/education)
  builder.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-add]");
    if (!addBtn) return;
    const type = addBtn.getAttribute("data-add");
    if (type === "experience") addExperienceFromObj();
    if (type === "education") addEducationFromObj();
  });

  // 6) Photo upload (safe no-ops if elements absent)
  qs(builder, "#photoBtn")?.addEventListener("click", () => qs(builder, "#photoInput")?.click());
  qs(builder, "#photoInput")?.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    const img = qs(builder, "#photoPreview");
    if (file && img) {
      const url = URL.createObjectURL(file);
      img.src = url; img.hidden = false;
    }
  });

  // 7) Submit → generate, then go to Finish
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      qs(builder, "#builderGeneratingIndicator").style.display = "block";
      const ctxForTemplate = gatherContext(form);

      const educationStr = (ctxForTemplate.education || [])
        .map(ed => [ed.degree, ed.school, ed.location, ed.graduated].filter(Boolean).join(" – "))
        .join("\n");
      const experienceStr = (ctxForTemplate.experience || [])
        .map(ex => `${ex.role}${ex.company ? " – " + ex.company : ""}\n${(ex.bullets || []).map(b => "• " + b).join("\n")}`)
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

      // Merge AI-enriched context *into* the current form context (never lose fields)
      window._resumeCtx = { ...ctxForTemplate, ...(genJson.context || {}) };

      // jump to Finish
      const finishIdx = steps.findIndex(s => s && s.id === "step-finish");
      showStep(finishIdx >= 0 ? finishIdx : steps.length - 1);
    } catch (err) {
      console.error("Generate/build error:", err);
      alert("Resume generation failed.");
    } finally {
      const ind = qs(builder, "#builderGeneratingIndicator");
      if (ind) ind.style.display = "none";
    }
  });

  // 8) Preview / PDF (Design + Finish)
  const previewBtn  = qs(builder, "#previewTemplate");
  const pdfBtn      = qs(builder, "#downloadTemplatePdf");
  const themeSelect = qs(builder, "#themeSelect");

  previewBtn?.addEventListener("click", async () => {
  try {
    qs(builder, "#builderGeneratingIndicator").style.display = "block";
    const live = gatherContext(qs(builder, "#resumeForm"));
    const ctx = { ...(window._resumeCtx || {}), ...live }; // latest form values win
    await renderWithTemplateFromContext(ctx, "html", themeSelect?.value || "modern");
  } catch (e) { console.error(e); alert(e.message || "Preview failed"); }
  finally { qs(builder, "#builderGeneratingIndicator").style.display = "none"; }
});

pdfBtn?.addEventListener("click", async () => {
  try {
    qs(builder, "#builderGeneratingIndicator").style.display = "block";
    const live = gatherContext(qs(builder, "#resumeForm"));
    const ctx = { ...(window._resumeCtx || {}), ...live }; // latest form values win
    await renderWithTemplateFromContext(ctx, "pdf", themeSelect?.value || "modern");
  } catch (e) { console.error(e); alert(e.message || "PDF build failed"); }
  finally { qs(builder, "#builderGeneratingIndicator").style.display = "none"; }
});

  qs(builder, "#previewTemplateFinish")?.addEventListener("click", () => previewBtn?.click());
  qs(builder, "#downloadTemplatePdfFinish")?.addEventListener("click", () => pdfBtn?.click());

  // Start
  showStep(idx || 0);

  // Expose for quick debugging
  window.__rbWizard = { steps, showStep, get index(){return idx;} };
}

// ------- Prefill from analyzer (optional) -------
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

    if (Array.isArray(ctx.skills) && ctx.skills.length) {
      ctx.skills.forEach((s) => helpers.skillsSet.add(s));
      helpers.refreshChips();
    }
    const expList = document.querySelector("#exp-list");
    if (expList) {
      expList.innerHTML = "";
      (ctx.experience || []).forEach(addExperienceFromObj);
      if (!expList.children.length) addExperienceFromObj();
    }
    const eduList = document.querySelector("#edu-list");
    if (eduList) {
      eduList.innerHTML = "";
      (ctx.education || []).forEach(addEducationFromObj);
      if (!eduList.children.length) addEducationFromObj();
    }
    window._resumeCtx = ctx;
  } catch (e) {
    console.warn("Prefill from analyzer failed:", e);
  }
}

// ------- Boot -------
document.addEventListener("DOMContentLoaded", () => {
  try {
    const helpers = initSkills();
    if (!document.querySelector("#exp-list .rb-item")) addExperienceFromObj();
    if (!document.querySelector("#edu-list .rb-item")) addEducationFromObj();
    attachAISuggestionHandlers();
    initWizard();
    maybePrefillFromAnalyzer(document.getElementById("resumeForm"), helpers);
  } catch (e) {
    console.error("Resume builder init failed:", e);
  }
});
