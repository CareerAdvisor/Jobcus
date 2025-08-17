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

// Gather overall context (name, contact, skills, exp, edu, certs)
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

  const skills = (form.elements["skills"]?.value || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  return {
    name,
    title: form.title?.value.trim() || "",
    contact: contactParts.join(" | "),
    summary: form.summary?.value.trim() || "",
    links: form.portfolio?.value ? [{ url: form.portfolio.value, label: "Portfolio" }] : [],
    experience, education, skills,
    certifications: form.elements["certifications"]?.value?.trim() || ""
  };
}

// --- AI suggest (unchanged) ---
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
  builder.addEventListener("click", async (e) => {
    const btn = e.target.closest(".ai-refresh, .ai-add");
    if (!btn) return;
    const card = btn.closest(".ai-suggest");
    const textEl = qs(card, ".ai-text");

    if (btn.classList.contains("ai-refresh")) {
      const type = btn.dataset.ai;
      textEl.textContent = "Thinking…";
      try {
        const ctx = gatherContext(form);
        const lines =
          type === "summary"    ? await aiSuggest("summary", ctx) :
          type === "highlights" ? await aiSuggest("highlights", ctx, Array.from(qsa(builder, "#exp-list .rb-item")).indexOf(btn.closest(".rb-item"))) :
                                  await aiSuggest("general", ctx);
        textEl.textContent = (Array.isArray(lines) ? lines : [String(lines||"")]).join(type==="summary" ? " " : "\n");
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

// --- Repeaters (unchanged) ---
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

// Skills chips UI (unchanged)
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

// Render helpers — MERGE live form over cached context
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
    "#step-certs",
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

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-target");
      const i = stepIndexById(target);
      if (i >= 0) showStep(i);
    });
  });

  back?.addEventListener("click", () => showStep(idx - 1));
  next?.addEventListener("click", () => showStep(idx + 1));

  // Add buttons
  builder.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-add]");
    if (!addBtn) return;
    const type = addBtn.getAttribute("data-add");
    if (type === "experience") addExperienceFromObj();
    if (type === "education") addEducationFromObj();
  });

  // Submit → generate, then go to Finish
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      qs(builder, "#builderGeneratingIndicator").style.display = "block";
      const liveCtx = gatherContext(form);

      const educationStr = (liveCtx.education || [])
        .map(ed => [ed.degree, ed.school, ed.location, ed.graduated].filter(Boolean).join(" – "))
        .join("\n");
      const experienceStr = (liveCtx.experience || [])
        .map(e => `${e.role}${e.company ? " – " + e.company : ""}\n${(e.bullets || []).map(b => "• " + b).join("\n")}`)
        .join("\n\n");

      const payload = {
        name: liveCtx.name || "",
        fullName: liveCtx.name || "",
        title: liveCtx.title || "",
        contact: liveCtx.contact || "",
        summary: liveCtx.summary || "",
        education: educationStr,
        experience: experienceStr,
        skills: (liveCtx.skills || []).join(", "),
        certifications: liveCtx.certifications || "",
        portfolio: (liveCtx.links?.[0]?.url) || "",
      };

      const gen = await fetch("/generate-resume", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const genJson = await gen.json().catch(() => ({}));
      if (!gen.ok || genJson.error) throw new Error(genJson.error || "Generate failed");

      // **Form values win** (so name/skills/certs never disappear)
      window._resumeCtx = { ...(genJson.context || {}), ...liveCtx };
      showStep(stepIndexById("#step-finish"));
    } catch (err) {
      console.error("Generate/build error:", err);
      alert("Resume generation failed.");
    } finally {
      qs(builder, "#builderGeneratingIndicator").style.display = "none";
    }
  });

  // Preview / PDF — **merge live form over any cached context**
  const previewBtn  = qs(builder, "#previewTemplate");
  const pdfBtn      = qs(builder, "#downloadTemplatePdf");
  const themeSelect = qs(builder, "#themeSelect");

  function mergedCtx() {
    const live = gatherContext(qs(builder, "#resumeForm"));
    return { ...(window._resumeCtx || {}), ...live };
  }

  previewBtn?.addEventListener("click", async () => {
    try {
      qs(builder, "#builderGeneratingIndicator").style.display = "block";
      await renderWithTemplateFromContext(mergedCtx(), "html", themeSelect?.value || "modern");
    } catch (e) { console.error(e); alert(e.message || "Preview failed"); }
    finally { qs(builder, "#builderGeneratingIndicator").style.display = "none"; }
  });

  pdfBtn?.addEventListener("click", async () => {
    try {
      qs(builder, "#builderGeneratingIndicator").style.display = "block";
      await renderWithTemplateFromContext(mergedCtx(), "pdf", themeSelect?.value || "modern");
    } catch (e) { console.error(e); alert(e.message || "PDF build failed"); }
    finally { qs(builder, "#builderGeneratingIndicator").style.display = "none"; }
  });

  qs(builder, "#previewTemplateFinish")?.addEventListener("click", () => previewBtn?.click());
  qs(builder, "#downloadTemplatePdfFinish")?.addEventListener("click", () => pdfBtn?.click());

  // Start wizard
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
    if (form.title)     form.title.value     = ctx.title || "";
    if (form.summary)   form.summary.value   = ctx.summary || "";
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

    // Don’t clobber live values later
    window._resumeCtx = { ...(window._resumeCtx || {}), ...ctx };
  } catch (e) {
    console.warn("Prefill from analyzer failed:", e);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const helpers = initSkills();
  if (!document.querySelector("#exp-list .rb-item")) addExperienceFromObj();
  if (!document.querySelector("#edu-list .rb-item")) addEducationFromObj();
  attachAISuggestionHandlers();
  initWizard();
  maybePrefillFromAnalyzer(document.getElementById("resumeForm"), helpers);
});
