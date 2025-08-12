// Keep cookies for SameSite/Lax on fetch
(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

// Small helper: debounce
function debounce(fn, wait = 400) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

// AI endpoints (configure here if your backend differs)
const AI_ENDPOINT = "/ai/suggest"; // POST { field: 'summary'|'highlights', index?, context }

// Build a lightweight context for AI suggestions and template rendering
function gatherContext(form) {
  const name = [form.firstName?.value, form.lastName?.value].filter(Boolean).join(" ").trim();
  const contactParts = [];
  const loc = [form.city?.value, form.country?.value].filter(Boolean).join(", ");
  if (loc) contactParts.push(loc);
  if (form.phone?.value) contactParts.push(form.phone.value);
  if (form.email?.value) contactParts.push(form.email.value);

  const expNodes = Array.from(document.querySelectorAll("#exp-list .rb-item"));
  const experience = expNodes.map((node) => {
    const g = (n) => node.querySelector(`[name="${n}"]`);
    const bullets = (g("bullets").value || "")
      .split("\n").map((t) => t.replace(/^•\s*/, "").trim()).filter(Boolean);
    return {
      role: g("role").value,
      company: g("company").value,
      location: g("location").value,
      start: g("start").value,
      end: g("end").value,
      bullets,
    };
  });

  const eduNodes = Array.from(document.querySelectorAll("#edu-list .rb-item"));
  const education = eduNodes.map((node) => {
    const g = (n) => node.querySelector(`[name="${n}"]`);
    return {
      degree: g("degree").value,
      school: g("school").value,
      location: g("location").value,
      graduated: g("graduated").value || g("graduatedStart").value,
    };
  });

  const skills = (form.elements["skills"]?.value || "").split(",").map((s) => s.trim()).filter(Boolean);

  return {
    name,
    title: form.title?.value.trim() || "",
    contact: contactParts.join(" | "),
    summary: form.summary?.value.trim() || "",
    links: form.portfolio?.value ? [{ url: form.portfolio.value, label: "Portfolio" }] : [],
    experience,
    education,
    skills,
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
    // Expect json.text (string) OR json.list (array of bullets)
    return json;
  } catch (e) {
    console.warn(e);
    return { text: "AI suggestion currently unavailable. Try again." };
  }
}

// Insert text into the closest textarea
function attachAISuggestionHandlers(root) {
  root.addEventListener("click", async (e) => {
    const btn = e.target.closest(".ai-refresh, .ai-add");
    if (!btn) return;
    const card = btn.closest(".ai-suggest");
    const field = btn.classList.contains("ai-refresh") ? btn.dataset.ai : card?.dataset.field;
    const step = btn.closest(".rb-step");
    const form = document.getElementById("resumeForm");

    if (btn.classList.contains("ai-refresh")) {
      // Determine context and (for highlights) index of the experience item
      const ctx = gatherContext(form);
      if (field === "summary") {
        const sug = await aiSuggest("summary", ctx);
        const p = card.querySelector(".ai-text");
        p.textContent = sug.text || p.textContent;
      } else if (field === "highlights") {
        // Find which experience block this AI card belongs to
        const all = Array.from(document.querySelectorAll("#exp-list .rb-item"));
        const idx = all.findIndex((n) => n.contains(card));
        const sug = await aiSuggest("highlights", ctx, idx);
        const p = card.querySelector(".ai-text");
        if (Array.isArray(sug.list) && sug.list.length) {
          p.textContent = sug.list.map((b) => `• ${b}`).join("\n");
        } else {
          p.textContent = sug.text || p.textContent;
        }
      }
      return;
    }

    if (btn.classList.contains("ai-add")) {
      // Add suggestion text into the nearest textarea in this card/section
      const cardWrap = btn.closest(".rb-card, .rb-item");
      const suggestion = card.querySelector(".ai-text")?.textContent?.trim() || "";
      if (!suggestion) return;
      // Prefer field-specific target
      let ta = null;
      if (card.dataset.field === "summary") {
        ta = step.querySelector('textarea[name="summary"]');
      } else if (card.dataset.field === "bullets") {
        ta = cardWrap.querySelector('textarea[name="bullets"]');
      }
      if (!ta) ta = cardWrap.querySelector("textarea");

      if (!ta) return;
      if (ta.name === "bullets") {
        const prefix = ta.value && !ta.value.endsWith("\n") ? "\n" : "";
        // Allow multi-line paste
        const cleaned = suggestion.split("\n").map(s => s.replace(/^•\s*/, "").trim()).filter(Boolean);
        ta.value += `${prefix}${cleaned.map(b => `• ${b}`).join("\n")}`;
      } else {
        ta.value = suggestion.replace(/^•\s*/g, "");
      }
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

// Repeaters: experience / education
function cloneFromTemplate(tplId) {
  const tpl = document.getElementById(tplId);
  if (!tpl) return null;
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.querySelector(".rb-remove")?.addEventListener("click", () => node.remove());
  // Attach per-item AI refresh (first load)
  setTimeout(() => {
    const card = node.querySelector('.ai-suggest[data-field="bullets"]');
    if (card) card.querySelector(".ai-refresh")?.click();
  }, 0);
  return node;
}

function addExperienceFromObj(obj = {}) {
  const list = document.getElementById("exp-list");
  const node = cloneFromTemplate("tpl-experience");
  if (!node || !list) return;
  const g = (n) => node.querySelector(`[name="${n}"]`);
  g("role").value      = obj.role || "";
  g("company").value   = obj.company || "";
  g("start").value     = obj.start || "";
  g("end").value       = obj.end || "";
  g("location").value  = obj.location || "";
  g("bullets").value   = (obj.bullets || []).join("\n");
  list.appendChild(node);
}

function addEducationFromObj(obj = {}) {
  const list = document.getElementById("edu-list");
  const node = cloneFromTemplate("tpl-education");
  if (!node || !list) return;
  const g = (n) => node.querySelector(`[name="${n}"]`);
  g("school").value         = obj.school || "";
  g("degree").value         = obj.degree || "";
  g("graduatedStart").value = obj.graduatedStart || "";
  g("graduated").value      = obj.graduated || "";
  g("location").value       = obj.location || "";
  list.appendChild(node);
}

// Skills chips
function initSkills() {
  const skillInput   = document.getElementById("skillInput");
  const skillChips   = document.getElementById("skillChips");
  const skillsHidden = document.querySelector('input[name="skills"]');
  const skillsSet    = new Set();
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

// Server render helpers
async function renderWithTemplateFromContext(ctx, format = "html", theme = "modern") {
  if (format === "pdf") {
    const res = await fetch("/build-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "pdf", theme, ...ctx }),
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
    body: JSON.stringify({ format: "html", theme, ...ctx }),
  });
  const html = await r.text();
  if (!r.ok) throw new Error(`HTML build failed: ${r.status} ${html}`);

  const wrap = document.getElementById("resumePreviewWrap") || document.getElementById("resumePreviewWrapFinish");
  const frame = document.getElementById("resumePreview") || document.getElementById("resumePreviewFinish");
  if (wrap && frame) {
    wrap.style.display = "block";
    frame.srcdoc = html;
  }
}

function initWizard() {
  const form  = document.getElementById("resumeForm");
  const tabs  = Array.from(document.querySelectorAll(".rb-tabs button"));
  const steps = [
    "#step-personal",
    "#step-contact",
    "#step-summary",
    "#step-experience",
    "#step-skills",
    "#step-education",
    "#step-design",
    "#step-finish",
  ].map(sel => document.querySelector(sel));

  const back  = document.getElementById("rb-back");
  const next  = document.getElementById("rb-next");
  const submitBtn = document.getElementById("rb-submit");
  let idx = 0;

  function updateButtons() {
    if (back) back.disabled = idx === 0;
    if (next) next.style.display = idx >= steps.length - 2 ? "none" : "inline-block"; // hide on Design & Finish?
    // Show submit on Design to trigger generation before Finish
    if (submitBtn) submitBtn.style.display = idx === steps.length - 2 ? "inline-block" : "none";
  }

  async function onEnterStep(i) {
    const node = steps[i];
    if (!node) return;
    // Lazy-load AI suggestions on Summary step first enter
    if (node.id === "step-summary" && !node.dataset.loaded) {
      node.dataset.loaded = "1";
      const ctx = gatherContext(form);
      const card = node.querySelector("#ai-summary");
      if (card) card.querySelector(".ai-refresh")?.click();
    }
    // Ensure at least one exp + edu block exists when entering their steps
    if (node.id === "step-experience" && !document.querySelector("#exp-list .rb-item")) addExperienceFromObj();
    if (node.id === "step-education" && !document.querySelector("#edu-list .rb-item")) addEducationFromObj();
    // Auto-refresh AI suggestions for each experience on first enter
    if (node.id === "step-experience" && !node.dataset.loaded) {
      node.dataset.loaded = "1";
      Array.from(document.querySelectorAll('#exp-list .ai-suggest .ai-refresh')).forEach(btn => btn.click());
    }
  }

  function showStep(i) {
    idx = Math.max(0, Math.min(i, steps.length - 1));
    steps.forEach((s, k) => {
      if (!s) return;
      const active = k === idx;
      s.hidden = !active;
      s.classList.toggle("active", active);
      const t = tabs[k];
      if (t) {
        t.classList.toggle("active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      }
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    updateButtons();
    onEnterStep(idx);
  }

  tabs.forEach((btn, i) => btn.addEventListener("click", () => showStep(i)));
  back?.addEventListener("click", () => showStep(idx - 1));
  next?.addEventListener("click", () => showStep(idx + 1));

  // Submit triggers generation then jumps to Finish
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      document.getElementById("builderGeneratingIndicator").style.display = "block";
      const ctxForTemplate = gatherContext(form);

      // Build payload for /generate-resume (kept for your existing backend contract)
      const educationStr = (ctxForTemplate.education || [])
        .map((ed) => [ed.degree, ed.school, ed.location, ed.graduated].filter(Boolean).join(" – "))
        .join("\n");
      const experienceStr = (ctxForTemplate.experience || [])
        .map((e) => `${e.role}${e.company ? " – " + e.company : ""}\n${(e.bullets || []).map((b) => "• " + b).join("\n")}`)
        .join("\n\n");
      const payload = {
        fullName: ctxForTemplate.name || "",
        title:          ctxForTemplate.title || "",
        contact:        ctxForTemplate.contact || "",
        summary:        ctxForTemplate.summary || "",
        education:      educationStr,
        experience:     experienceStr,
        skills:         (ctxForTemplate.skills || []).join(", "),
        certifications: form.elements["certifications"]?.value?.trim() || "",
        portfolio:      (ctxForTemplate.links?.[0]?.url) || "",
      };

      const gen = await fetch("/generate-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const genJson = await gen.json().catch(() => ({}));
      if (!gen.ok || genJson.error) throw new Error(genJson.error || "Generate failed");

      // Keep full context for preview/PDF
      window._resumeCtx = genJson.context || ctxForTemplate;
      showStep(idx + 1); // move to Finish
    } catch (err) {
      console.error("Generate/build error:", err);
      alert("Resume generation failed.");
    } finally {
      document.getElementById("builderGeneratingIndicator").style.display = "none";
    }
  });

  // Preview / PDF (Design step)
  const previewBtn   = document.getElementById("previewTemplate");
  const pdfBtn       = document.getElementById("downloadTemplatePdf");
  const themeSelect  = document.getElementById("themeSelect");

  previewBtn?.addEventListener("click", async () => {
    try {
      document.getElementById("builderGeneratingIndicator").style.display = "block";
      const ctx = window._resumeCtx || gatherContext(form);
      await renderWithTemplateFromContext(ctx, "html", themeSelect?.value || "modern");
    } catch (e) { console.error(e); alert(e.message || "Preview failed"); }
    finally { document.getElementById("builderGeneratingIndicator").style.display = "none"; }
  });

  pdfBtn?.addEventListener("click", async () => {
    try {
      document.getElementById("builderGeneratingIndicator").style.display = "block";
      const ctx = window._resumeCtx || gatherContext(form);
      await renderWithTemplateFromContext(ctx, "pdf", themeSelect?.value || "modern");
    } catch (e) { console.error(e); alert(e.message || "PDF build failed"); }
    finally { document.getElementById("builderGeneratingIndicator").style.display = "none"; }
  });

  // Finish step buttons reuse same actions
  document.getElementById("previewTemplateFinish")?.addEventListener("click", () => previewBtn?.click());
  document.getElementById("downloadTemplatePdfFinish")?.addEventListener("click", () => pdfBtn?.click());

  // Init first step
  showStep(0);
}

// Optional: prefill from analyzer (kept from your previous version)
async function maybePrefillFromAnalyzer(form, { refreshChips, skillsSet }) {
  const raw = localStorage.getItem("resumeTextRaw");
  if (!raw || !form) return;
  const isEmpty = !(form.firstName?.value || form.lastName?.value || form.title?.value || form.summary?.value) &&
                  !document.querySelector("#exp-list .rb-item input[value]");
  if (!isEmpty) return;
  try {
    const gen = await fetch("/generate-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: "", title: "", contact: "", summary: raw, education: "", experience: raw, skills: "", certifications: "", portfolio: "" }),
    });
    const genJson = await gen.json().catch(() => ({}));
    if (!gen.ok || genJson.error) throw new Error(genJson.error || "Generate failed");
    const ctx = genJson.context || {};
    // fill
    const name = (ctx.name || "").trim().split(" ");
    if (form.firstName) form.firstName.value = name.shift() || "";
    if (form.lastName)  form.lastName.value  = name.join(" ");
    if (form.title)   form.title.value   = ctx.title || "";
    if (form.summary) form.summary.value = ctx.summary || "";
    if (ctx.links && ctx.links[0] && form.portfolio) form.portfolio.value = ctx.links[0].url || "";
    // skills
    if (Array.isArray(ctx.skills) && ctx.skills.length) { ctx.skills.forEach((s) => skillsSet.add(s)); refreshChips(); }
    // experience
    const expList = document.getElementById("exp-list"); if (expList) { expList.innerHTML = ""; (ctx.experience || []).forEach((e) => addExperienceFromObj(e)); if (!expList.children.length) addExperienceFromObj(); }
    // education
    const eduList = document.getElementById("edu-list"); if (eduList) { eduList.innerHTML = ""; (ctx.education || []).forEach((ed) => addEducationFromObj(ed)); if (!eduList.children.length) addEducationFromObj(); }
    window._resumeCtx = ctx;
  } catch (e) { console.warn("Prefill from analyzer failed:", e); }
}

// Boot
document.addEventListener("DOMContentLoaded", () => {
  const { refreshChips, skillsSet } = initSkills();
  if (!document.querySelector("#exp-list .rb-item")) addExperienceFromObj();
  if (!document.querySelector("#edu-list .rb-item")) addEducationFromObj();
  attachAISuggestionHandlers(document);
  initWizard();
  maybePrefillFromAnalyzer(document.getElementById("resumeForm"), { refreshChips, skillsSet });
});

// Legacy TXT download (optional)
async function downloadResume(format) {
  const container = document.getElementById("builderGeneratedContent");
  const text = container?.innerText || "";
  if (format === "txt") {
    saveAs(new Blob([text], { type: "text/plain" }), "resume.txt");
  }
}
