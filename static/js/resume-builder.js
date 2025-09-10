"use strict";

// Ensure fetch keeps cookies (SameSite=Lax safe)
(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

// ───────────────────────────────────────────────
// Tiny helpers
// ───────────────────────────────────────────────
function qs(root, sel)  { return (root || document).querySelector(sel); }
function qsa(root, sel) { return Array.from((root || document).querySelectorAll(sel)); }
function withinBuilder(sel) { return `#resume-builder ${sel}`; }
const AI_ENDPOINT = "/ai/suggest";

const escapeHtml = (s="") =>
  s.replace(/&/g,"&amp;").replace(/</g,"&lt;")
   .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");

// Put near the top of resume-builder.js:
const PRICING_URL = "/pricing.html"; // if your Flask route is /pricing use "/pricing"
                                     // otherwise keep the static "/pricing.html"

// Centralized server-response handling for plan/auth/abuse messages
async function handleCommonErrors(res) {
  if (res.ok) return null;

  const ct = res.headers.get("content-type") || "";
  let body = null;
  try {
    body = ct.includes("application/json") ? await res.json()
                                           : { message: await res.text() };
  } catch {
    body = null;
  }

  const PRICING_URL = "/pricing.html"; // or "/pricing" if routed in Flask

  // 🔁 PRIORITIZE UPGRADE FIRST
  if (res.status === 402 || (res.status === 403 && body?.error === "upgrade_required")) {
    const msg = body?.message || "You’ve reached your plan limit. Upgrade to continue.";
    // sticky banner + redirect to pricing
    window.showUpgradeBanner?.(body?.message_html || msg);
    setTimeout(() => { window.location.href = PRICING_URL; }, 800);
    throw new Error(msg);
  }

  // Then handle auth-required 401/403
  if (res.status === 401 || res.status === 403) {
    const msg = body?.message || "Please sign in to continue.";
    window.showUpgradeBanner?.(msg);
    setTimeout(() => { window.location.href = "/account?mode=login"; }, 800);
    throw new Error(msg);
  }

  // Abuse guard
  if (res.status === 429 && (body?.error === "too_many_free_accounts" || body?.error === "device_limit")) {
    const msg = body?.message || "Too many free accounts detected from your network/device.";
    window.showUpgradeBanner?.(msg);
    throw new Error(msg);
  }

  // Generic
  const msg = body?.message || `Request failed (${res.status})`;
  throw new Error(msg);
}

// ───────────────────────────────────────────────
// Context gatherers
// ───────────────────────────────────────────────
function gatherContext(form) {
  try {
    const builder = qs(document, "#resume-builder");
    const name = [form.firstName?.value, form.lastName?.value].filter(Boolean).join(" ").trim();

    const contactParts = [];
    const loc = [form.city?.value, form.country?.value].filter(Boolean).join(", ").trim();
    if (loc) contactParts.push(loc);
    if (form.phone?.value) contactParts.push(form.phone.value.trim());
    if (form.email?.value) contactParts.push(form.email.value.trim());

    const expNodes = qsa(builder, "#exp-list .rb-item");
    const experience = expNodes.map((node) => {
      const g = (n) => qs(node, `[name="${n}"]`);
      const bullets = (g("bullets")?.value || "")
        .split(/\r?\n/).map(t => t.replace(/^•\s*/, "").trim()).filter(Boolean);
      return {
        role: g("role")?.value?.trim() || "",
        company: g("company")?.value?.trim() || "",
        location: g("location")?.value?.trim() || "",
        start: g("start")?.value?.trim() || "",
        end:   g("end")?.value?.trim() || "",
        bullets
      };
    });

    const eduNodes = qsa(builder, "#edu-list .rb-item");
    const education = eduNodes.map((node) => {
      const g = (n) => qs(node, `[name="${n}"]`);
      return {
        degree:    g("degree")?.value?.trim() || "",
        school:    g("school")?.value?.trim() || "",
        location:  g("location")?.value?.trim() || "",
        graduated: g("graduated")?.value?.trim() || g("graduatedStart")?.value?.trim() || ""
      };
    });

    const skillsRaw = (form.elements["skills"]?.value || "").trim();
    const skills = skillsRaw
      ? skillsRaw.split(/[,;\r\n]+/).map(s => s.trim()).filter(Boolean)
      : [];

    return {
      name,
      title: form.title?.value?.trim() || "",
      contact: contactParts.join(" | "),
      summary: form.summary?.value?.trim() || "",
      links: form.portfolio?.value?.trim()
        ? [{ url: form.portfolio.value.trim(), label: "Portfolio" }]
        : [],
      experience,
      education,
      skills
    };
  } catch (e) {
    console.error("gatherContext error:", e);
    return { name:"", title:"", contact:"", summary:"", links:[], experience:[], education:[], skills:[] };
  }
}

// ───────────────────────────────────────────────
// AI helpers
// ───────────────────────────────────────────────
async function aiSuggest(field, ctx, index) {
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, index, context: ctx })
    });

    await handleCommonErrors(res);

    const json = await res.json().catch(() => ({}));
    if (json.error) throw new Error(json.error || `AI suggest failed for ${field}`);

    const list = Array.isArray(json.list) ? json.list : null;
    const text = typeof json.text === "string" ? json.text : "";
    const lines = list && list.length
      ? list
      : (text ? text.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : []);
    return lines.length ? lines : ["AI suggestion currently unavailable. Try again."];
  } catch (e) {
    console.warn("aiSuggest:", e?.message || e);
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
      const type = btn.dataset.ai || "general";
      textEl.textContent = "Thinking…";
      try {
        const ctx = gatherContext(form);
        let lines = [];
        if (type === "summary") {
          lines = await aiSuggest("summary", ctx);
          textEl.textContent = lines.join(" ");
        } else if (type === "highlights") { // NOTE: leave exactly as in your repo if already working
          const allItems = qsa(builder, "#exp-list .rb-item");
          const itemEl = btn.closest(".rb-item");
          const idx = Math.max(0, allItems.findIndex(n => n === itemEl));
          lines = await aiSuggest("highlights", ctx, idx);
          textEl.textContent = lines.join("\n");
        } else {
          lines = await aiSuggest("general", ctx);
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

// ───────────────────────────────────────────────
// Repeaters
// ───────────────────────────────────────────────
function cloneFromTemplate(tplId) {
  const tpl = qs(document, withinBuilder(`#${tplId}`));
  if (!tpl) return null;
  const node = tpl.content.firstElementChild.cloneNode(true);
  qs(node, ".rb-remove")?.addEventListener("click", () => node.remove());
  if (window.USER_AUTHENTICATED) {
    setTimeout(() => { qs(node, ".ai-suggest .ai-refresh")?.click(); }, 0);
  }
  return node;
}
function addExperienceFromObj(obj = {}) {
  const list = qs(document, withinBuilder("#exp-list"));
  const node = cloneFromTemplate("tpl-experience");
  if (!node || !list) return;
  const g = (n) => qs(node, `[name="${n}"]`);
  if (g("role"))     g("role").value     = obj.role || "";
  if (g("company"))  g("company").value  = obj.company || "";
  if (g("start"))    g("start").value    = obj.start || "";
  if (g("end"))      g("end").value      = obj.end || "";
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
  if (g("school"))         g("school").value         = obj.school || "";
  if (g("degree"))         g("degree").value         = obj.degree || "";
  if (g("graduatedStart")) g("graduatedStart").value = obj.graduatedStart || "";
  if (g("graduated"))      g("graduated").value      = obj.graduated || "";
  if (g("location"))       g("location").value       = obj.location || "";
  list.appendChild(node);
}

// ───────────────────────────────────────────────
// Skills chips
// ───────────────────────────────────────────────
function initSkills() {
  const builder = qs(document, "#resume-builder");
  const skillInput   = qs(builder, "#skillInput");
  const skillChips   = qs(builder, "#skillChips");
  const skillsHidden = qs(builder, 'input[name="skills"]');
  const skillsSet = new Set(
    (skillsHidden?.value || "")
      .split(/[,;\r\n]+/)
      .map(s => s.trim())
      .filter(Boolean)
  );

  function refreshChips() {
    if (!skillChips || !skillsHidden) return;
    skillChips.innerHTML = "";
    skillsHidden.value = Array.from(skillsSet).join(",");
    skillsSet.forEach((s) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = `${escapeHtml(s)} <button type="button" aria-label="Remove">×</button>`;
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
  skillInput?.addEventListener("paste", (e) => {
    const text = (e.clipboardData?.getData("text") || "").trim();
    if (!text) return;
    text.split(/[,;\r\n]+/).map(s => s.trim()).filter(Boolean).forEach(s => skillsSet.add(s));
    setTimeout(refreshChips, 0);
  });

  refreshChips();
  return { refreshChips, skillsSet };
}

// ───────────────────────────────────────────────
// Render with server templates (HTML/PDF/DOCX)
// ───────────────────────────────────────────────
async function renderWithTemplateFromContext(ctx, format = "html", theme = "modern") {
  async function postAndMaybeError(url, payload) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      await handleCommonErrors(res);
    }
    return res;
  }

  if (format === "pdf") {
    const res = await postAndMaybeError("/build-resume", { format: "pdf", theme, ...ctx });
    const blob = await res.blob();
    const ct   = res.headers.get("content-type") || "";
    if (!ct.includes("application/pdf")) {
      throw new Error("PDF generation failed.");
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "resume.pdf"; a.click();
    URL.revokeObjectURL(url);
    return;
  }

  if (format === "docx") {
    const res = await postAndMaybeError("/build-resume-docx", { ...ctx });
    const blob = await res.blob();
    const ct   = res.headers.get("content-type") || "";
    if (!ct.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
      throw new Error("DOCX generation failed.");
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "resume.docx"; a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const res = await fetch("/build-resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "html", theme, ...ctx })
  });

  if (!res.ok) {
    await handleCommonErrors(res);
  }

  const ct = res.headers.get("content-type") || "";
  const wrap  = qs(document, withinBuilder("#resumePreviewWrap, #resumePreviewWrapFinish"));
  const frame = qs(document, withinBuilder("#resumePreview, #resumePreviewFinish"));

  if (ct.includes("text/html")) {
    const html = await res.text();
    if (wrap && frame) { wrap.style.display = "block"; frame.srcdoc = html; }
  } else if (ct.includes("application/json")) {
    const data = await res.json().catch(() => ({}));
    if (data?.message) window.showUpgradeBanner?.(data.message);
    throw new Error(data?.message || "Preview failed.");
  } else {
    const txt = await res.text().catch(() => "");
    throw new Error(`Preview failed. ${txt ? "Server said: " + txt : ""}`);
  }
}

// ───────────────────────────────────────────────
// Wizard
// ───────────────────────────────────────────────
function initWizard() {
  const builder = qs(document, "#resume-builder");
  const form = qs(builder, "#resumeForm");
  if (!builder || !form) {
    console.error("Resume builder root or form not found.");
    return;
  }

  const steps = qsa(builder, ".rb-step");
  if (!steps.length) {
    console.error("No wizard steps found (.rb-step).");
    return;
  }

  const tabs      = qsa(builder, ".rb-tabs button");
  const back      = qs(builder, "#rb-back");
  const next      = qs(builder, "#rb-next");
  const submitBtn = qs(builder, "#rb-submit");
  let idx = Math.max(0, steps.findIndex(s => s.classList.contains("active")));
  if (idx < 0) idx = 0;

  function stepIndexById(id) {
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
      if (window.USER_AUTHENTICATED) qs(node, "#ai-summary .ai-refresh")?.click();
    }
    if (node.id === "step-experience" && !qs(builder, "#exp-list .rb-item")) addExperienceFromObj();
    if (node.id === "step-education"  && !qs(builder, "#edu-list .rb-item")) addEducationFromObj();
    if (node.id === "step-experience" && !node.dataset.loaded) {
      node.dataset.loaded = "1";
      if (window.USER_AUTHENTICATED) {
        qsa(builder, "#exp-list .ai-suggest .ai-refresh").forEach(btn => btn.click());
      }
    }
    try { window.syncState?.({ builder_step: node.id }); } catch {}
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

  tabs.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const target = btn.getAttribute("data-target");
      const i = stepIndexById(target);
      if (i >= 0) showStep(i);
    });
  });

  back?.addEventListener("click", (e) => { e.preventDefault(); showStep(idx - 1); });
  next?.addEventListener("click", (e) => { e.preventDefault(); showStep(idx + 1); });

  builder.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-add]");
    if (!addBtn) return;
    const type = addBtn.getAttribute("data-add");
    if (type === "experience") addExperienceFromObj();
    if (type === "education") addEducationFromObj();
  });

  // Photo upload
  let _photoUrl;
  qs(builder, "#photoBtn")?.addEventListener("click", () => qs(builder, "#photoInput")?.click());
  qs(builder, "#photoInput")?.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    const img = qs(builder, "#photoPreview");
    if (file && img) {
      if (_photoUrl) URL.revokeObjectURL(_photoUrl);
      _photoUrl = URL.createObjectURL(file);
      img.src = _photoUrl; img.hidden = false;
    }
  });

  // Submit → generate → jump to Finish
  let generating = false;
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (generating) return;
    generating = true;

    const indicator = qs(builder, "#builderGeneratingIndicator");
    try {
      if (indicator) indicator.style.display = "block";
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await handleCommonErrors(gen);

      const genJson = await gen.json().catch(() => ({}));
      if (genJson.error) throw new Error(genJson.error || "Resume generation failed");

      window._resumeCtx = { ...ctxForTemplate, ...(genJson.context || {}) };

      try {
        localStorage.setItem("resume_latest", JSON.stringify(window._resumeCtx));
        window.syncState?.({ resume_latest: window._resumeCtx, resume_generated: true });
      } catch {}

      const finishIdx = steps.findIndex(s => s && s.id === "step-finish");
      showStep(finishIdx >= 0 ? finishIdx : steps.length - 1);
    } catch (err) {
      console.error("Generate/build error:", err);
      alert(err.message || "Resume generation failed.");
    } finally {
      if (indicator) indicator.style.display = "none";
      generating = false;
    }
  });

  const previewBtn   = qs(builder, "#previewTemplate");
  const pdfBtn       = qs(builder, "#downloadTemplatePdf");
  const docxBtn      = qs(builder, "#downloadTemplateDocx");
  const themeSelect  = qs(builder, "#themeSelect");

  async function buildAndRender(kind) {
    const indicator = qs(builder, "#builderGeneratingIndicator");
    try {
      if (indicator) indicator.style.display = "block";
      const live = gatherContext(qs(builder, "#resumeForm"));
      const ctx = { ...(window._resumeCtx || {}), ...live };
      const theme = themeSelect?.value || "modern";
      await renderWithTemplateFromContext(ctx, kind, theme);
    } catch (e) {
      console.error(e);
      alert(e.message || (kind === "pdf" ? "PDF build failed" : kind === "docx" ? "DOCX build failed" : "Preview failed"));
    } finally {
      if (indicator) indicator.style.display = "none";
    }
  }

  previewBtn?.addEventListener("click", () => buildAndRender("html"));
  pdfBtn?.addEventListener("click",     () => buildAndRender("pdf"));
  docxBtn?.addEventListener("click",    () => buildAndRender("docx"));

  qs(builder, "#previewTemplateFinish")?.addEventListener("click", () => previewBtn?.click());
  qs(builder, "#downloadTemplatePdfFinish")?.addEventListener("click", () => pdfBtn?.click());
  qs(builder, "#downloadTemplateDocxFinish")?.addEventListener("click", () => docxBtn?.click());

  showStep(idx || 0);
  window.__rbWizard = { steps, showStep, get index(){return idx;} };
}

// ───────────────────────────────────────────────
// Prefill from analyzer (optional)
// ───────────────────────────────────────────────
async function maybePrefillFromAnalyzer(form, helpers) {
  const raw = localStorage.getItem("resumeTextRaw");
  if (!raw || !form) return;

  const builder = qs(document, "#resume-builder");
  const isEmpty =
    !(form.firstName?.value || form.lastName?.value || form.title?.value || form.summary?.value) &&
    !qs(builder, "#exp-list .rb-item input[value]");

  if (!isEmpty) return;

  try {
    const gen = await fetch("/generate-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "", title: "", contact: "", summary: raw,
        education: "", experience: raw, skills: "", certifications: "", portfolio: ""
      }),
    });

    await handleCommonErrors(gen);

    const genJson = await gen.json().catch(() => ({}));
    if (genJson.error) throw new Error(genJson.error || "Generate failed");

    const ctx = genJson.context || {};
    const name = (ctx.name || "").trim().split(/\s+/);
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

    window._resumeCtx = ctx;
    try {
      localStorage.setItem("resume_latest", JSON.stringify(ctx));
      window.syncState?.({ resume_latest: ctx });
    } catch {}
  } catch (e) {
    console.warn("Prefill from analyzer failed:", e);
  }
}

// ───────────────────────────────────────────────
// Boot
// ───────────────────────────────────────────────
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
