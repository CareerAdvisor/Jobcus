// Keep cookies for SameSite/Lax on fetch
(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  const form            = document.getElementById("resumeForm");
  const builderSpinner  = document.getElementById("builderGeneratingIndicator"); // optional
  const outputContainer = document.getElementById("builderGeneratedContent");    // optional
  const downloadOptions = document.getElementById("resumeDownloadOptions");      // optional

  const previewBtn   = document.getElementById("previewTemplate");
  const pdfBtn       = document.getElementById("downloadTemplatePdf");
  const previewWrap  = document.getElementById("resumePreviewWrap");
  const previewFrame = document.getElementById("resumePreview");
  const themeSelect  = document.getElementById("themeSelect");

  const getTheme = () => themeSelect?.value || "modern";

  /* ──────────────────────────────────
     Tabs + stepper (Write / Design / Improve)
  ───────────────────────────────────*/
  const tabs  = Array.from(document.querySelectorAll(".rb-tabs button"));
  const steps = ["#write", "#design", "#improve"].map(sel => document.querySelector(sel));
  const back  = document.getElementById("rb-back");
  const next  = document.getElementById("rb-next");
  let idx = 0;

  function showStep(i) {
    idx = Math.max(0, Math.min(i, steps.length - 1));
    steps.forEach((s, k) => { if (s) { s.hidden = k !== idx; s.classList.toggle("active", k === idx); }});
    tabs.forEach((t, k) => {
      t.classList.toggle("active", k === idx);
      t.setAttribute("aria-selected", k === idx ? "true" : "false");
    });
    if (back) back.disabled = idx === 0;
    if (next) next.textContent = idx === steps.length - 1 ? "Finish" : "Next";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  tabs.forEach((btn, i) => btn.addEventListener("click", () => showStep(i)));
  back?.addEventListener("click", () => showStep(idx - 1));
  next?.addEventListener("click", () => {
    if (idx < steps.length - 1) showStep(idx + 1);
    else form?.requestSubmit?.();
  });
  showStep(0);

  /* ──────────────────────────────────
     Repeaters: experience / education
  ───────────────────────────────────*/
  function cloneFromTemplate(tplId) {
    const tpl = document.getElementById(tplId);
    if (!tpl) return null;
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector(".rb-remove")?.addEventListener("click", () => node.remove());
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

  if (!document.querySelector("#exp-list .rb-item")) addExperienceFromObj();
  if (!document.querySelector("#edu-list .rb-item")) addEducationFromObj();

  document.querySelector('[data-add="experience"]')
    ?.addEventListener("click", () => addExperienceFromObj());
  document.querySelector('[data-add="education"]')
    ?.addEventListener("click", () => addEducationFromObj());

  /* ──────────────────────────────────
     Skills: chips
  ───────────────────────────────────*/
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

  /* ──────────────────────────────────
     AI helper: “Add” to nearest textarea
  ───────────────────────────────────*/
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    if (!e.target.classList.contains("ai-add")) return;
    const card = e.target.closest(".rb-card, .rb-item");
    const suggestion = e.target.closest(".ai-suggest")?.querySelector(".ai-text")?.textContent?.trim() || "";
    if (!suggestion) return;
    let ta = card?.querySelector('textarea[name="summary"]') ||
             card?.querySelector('textarea[name="bullets"]') ||
             card?.querySelector("textarea");
    if (!ta) return;

    if (ta.name === "bullets") {
      const prefix = ta.value && !ta.value.endsWith("\n") ? "\n" : "";
      ta.value += `${prefix}• ${suggestion}`;
    } else {
      ta.value = suggestion;
    }
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });

  /* ──────────────────────────────────
     Build context helpers
  ───────────────────────────────────*/
  const contactString = (f) => {
    const parts = [];
    const loc = [f.city?.value, f.country?.value].filter(Boolean).join(", ");
    if (loc) parts.push(loc);
    if (f.phone?.value) parts.push(f.phone.value);
    if (f.email?.value) parts.push(f.email.value);
    return parts.join(" | ");
  };

  window.coerceFormToTemplateContext = function () {
    const f = form;
    const name = [f.firstName?.value, f.lastName?.value].filter(Boolean).join(" ").trim();
    const links = f.portfolio?.value ? [{ url: f.portfolio.value, label: "Portfolio" }] : [];

    const exp = Array.from(document.querySelectorAll("#exp-list .rb-item")).map((node) => {
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

    const edu = Array.from(document.querySelectorAll("#edu-list .rb-item")).map((node) => {
      const g = (n) => node.querySelector(`[name="${n}"]`);
      return {
        degree: g("degree").value,
        school: g("school").value,
        location: g("location").value,
        graduated: g("graduated").value || g("graduatedStart").value,
      };
    });

    const skillsArr = (skillsHidden?.value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    return {
      name,
      title: f.title?.value.trim() || "",
      contact: contactString(f),
      summary: f.summary?.value.trim() || "",
      links,
      experience: exp,
      education: edu,
      skills: skillsArr,
    };
  };

  /* ──────────────────────────────────
     Optional: prefill from analyzer
  ───────────────────────────────────*/
  (async function maybePrefillFromAnalyzer() {
    const raw = localStorage.getItem("resumeTextRaw");
    if (!raw || !form) return;

    const isEmpty =
      !(form.firstName?.value || form.lastName?.value || form.title?.value || form.summary?.value) &&
      !document.querySelector("#exp-list .rb-item input[value]");

    if (!isEmpty) return;

    try {
      const gen = await fetch("/generate-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "", title: "", contact: "",
          summary: raw, education: "", experience: raw, skills: "", certifications: "", portfolio: ""
        }),
      });
      const genJson = await gen.json().catch(() => ({}));
      if (!gen.ok || genJson.error) throw new Error(genJson.error || "Generate failed");

      fillFormFromContext(genJson.context || {});
      window._resumeCtx = genJson.context;
    } catch (e) {
      console.warn("Prefill from analyzer failed:", e);
    }
  })();

  function fillFormFromContext(ctx) {
    if (!form) return;
    const name = (ctx.name || "").trim();
    if (name) {
      const parts = name.split(" ");
      if (form.firstName) form.firstName.value = parts.shift() || "";
      if (form.lastName)  form.lastName.value  = parts.join(" ");
    }
    if (form.title)   form.title.value   = ctx.title || "";
    if (form.summary) form.summary.value = ctx.summary || "";
    if (ctx.links && ctx.links[0] && form.portfolio) form.portfolio.value = ctx.links[0].url || "";

    // skills
    if (Array.isArray(ctx.skills) && ctx.skills.length) {
      ctx.skills.forEach((s) => skillsSet.add(s));
      refreshChips();
    }

    // experience
    const expList = document.getElementById("exp-list");
    if (expList) {
      expList.innerHTML = "";
      (ctx.experience || []).forEach((e) => addExperienceFromObj(e));
      if (!expList.children.length) addExperienceFromObj();
    }

    // education
    const eduList = document.getElementById("edu-list");
    if (eduList) {
      eduList.innerHTML = "";
      (ctx.education || []).forEach((ed) => addEducationFromObj(ed));
      if (!eduList.children.length) addEducationFromObj();
    }
  }

  /* ──────────────────────────────────
     Server render helpers
  ───────────────────────────────────*/
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

    if (outputContainer) outputContainer.innerHTML = "";
    if (previewWrap && previewFrame) {
      previewWrap.style.display = "block";
      previewFrame.srcdoc = html;
    }
  }

  /* ──────────────────────────────────
     Form submit / Preview / PDF
  ───────────────────────────────────*/
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (builderSpinner) builderSpinner.style.display = "block";
    if (outputContainer) outputContainer.innerHTML = "";
    if (downloadOptions) downloadOptions.style.display = "none";

    const ctxForTemplate = window.coerceFormToTemplateContext();
    const fullName = ctxForTemplate.name || "";

    const educationStr = (ctxForTemplate.education || [])
      .map((ed) => [ed.degree, ed.school, ed.location, ed.graduated].filter(Boolean).join(" – "))
      .join("\n");

    const experienceStr = (ctxForTemplate.experience || [])
      .map((e) => `${e.role}${e.company ? " – " + e.company : ""}\n${(e.bullets || []).map((b) => "• " + b).join("\n")}`)
      .join("\n\n");

    const payload = {
      fullName,
      title:          ctxForTemplate.title || "",
      contact:        ctxForTemplate.contact || "",
      summary:        ctxForTemplate.summary || "",
      education:      educationStr,
      experience:     experienceStr,
      skills:         (ctxForTemplate.skills || []).join(", "),
      certifications: form.elements["certifications"]?.value?.trim() || "",
      portfolio:      (ctxForTemplate.links?.[0]?.url) || "",
    };

    try {
      const gen = await fetch("/generate-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const genJson = await gen.json().catch(() => ({}));
      if (!gen.ok || genJson.error) throw new Error(genJson.error || "Generate failed");

      const ctx = genJson.context;
      window._resumeCtx = ctx;

      await renderWithTemplateFromContext(ctx, "html", getTheme());
      if (downloadOptions) downloadOptions.style.display = "block";
    } catch (err) {
      console.error("Generate/build error:", err);
      alert("Resume generation failed.");
    } finally {
      if (builderSpinner) builderSpinner.style.display = "none";
    }
  });

  previewBtn?.addEventListener("click", async () => {
    try {
      if (builderSpinner) builderSpinner.style.display = "block";
      const ctx = window._resumeCtx || window.coerceFormToTemplateContext();
      await renderWithTemplateFromContext(ctx, "html", getTheme());
      if (downloadOptions) downloadOptions.style.display = "block";
    } catch (e) {
      console.error(e);
      alert(e.message || "Preview failed");
    } finally {
      if (builderSpinner) builderSpinner.style.display = "none";
    }
  });

  pdfBtn?.addEventListener("click", async () => {
    try {
      if (builderSpinner) builderSpinner.style.display = "block";
      const ctx = window._resumeCtx || window.coerceFormToTemplateContext();
      await renderWithTemplateFromContext(ctx, "pdf", getTheme());
    } catch (e) {
      console.error(e);
      alert(e.message || "PDF build failed");
    } finally {
      if (builderSpinner) builderSpinner.style.display = "none";
    }
  });
});

// Legacy TXT download (optional)
async function downloadResume(format) {
  const container = document.getElementById("builderGeneratedContent");
  const text = container?.innerText || "";
  if (format === "txt") {
    saveAs(new Blob([text], { type: "text/plain" }), "resume.txt");
  }
}
