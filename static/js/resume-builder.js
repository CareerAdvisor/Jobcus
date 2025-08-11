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

  // Try to pre-fill from analyzer (when user pasted text there)
  (async function maybePrefillFromAnalyzer(){
    const raw = localStorage.getItem("resumeTextRaw");
    if (!raw) return;

    // Only prefill if form is basically empty
    const isEmpty =
      (!form.elements["fullName"].value &&
       !form.elements["title"].value &&
       !form.elements["summary"].value &&
       !form.elements["experience"].value);

    if (!isEmpty) return;

    try {
      // Send raw text to generator (put it in summary/experience fields of the prompt)
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
      // keep context for instant preview
      window._resumeCtx = genJson.context;
    } catch (e) {
      console.warn("Prefill from analyzer failed:", e);
    }
  })();

  function fillFormFromContext(ctx) {
    form.elements["fullName"].value = ctx.name || "";
    form.elements["title"].value    = ctx.title || "";
    form.elements["contact"].value  = ctx.contact || "";
    form.elements["summary"].value  = ctx.summary || "";
    form.elements["education"].value = (ctx.education || [])
      .map(ed => [ed.degree, ed.school, ed.location, ed.graduated].filter(Boolean).join(" – "))
      .join("\n");
    form.elements["experience"].value = (ctx.experience || [])
      .map(e => `${e.role}${e.company ? " – " + e.company : ""}\n${(e.bullets||[]).map(b=>"• "+b).join("\n")}`)
      .join("\n\n");
    form.elements["skills"].value   = (ctx.skills || []).join(", ");
    const link = (ctx.links || [])[0];
    form.elements["portfolio"].value = link ? (link.url || "") : "";
  }

  // Coerce form → minimal context for templates
  function coerceFormToTemplateContext() {
    const f = form;
    const name    = f.elements["fullName"].value.trim();
    const title   = f.elements["title"].value.trim();
    const contact = f.elements["contact"].value.trim();
    const summary = f.elements["summary"].value.trim();
    const eduTxt  = f.elements["education"].value.trim();
    const expTxt  = f.elements["experience"].value.trim();
    const skills  = f.elements["skills"].value.split(",").map(s => s.trim()).filter(Boolean);
    const portfolio = f.elements["portfolio"].value.trim();

    const education = eduTxt ? [{ degree: "", school: eduTxt, location: "", graduated: "" }] : [];
    const experience = expTxt ? [{
      role: title || "Experience",
      company: "",
      location: "",
      start: "",
      end: "",
      bullets: expTxt.split("\n").map(b => b.trim()).filter(Boolean)
    }] : [];
    const links = portfolio ? [{ url: portfolio, label: "Portfolio" }] : [];

    return { name, title, contact, summary, education, experience, skills, links };
  }

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
    builderIndicator.style.display = "block";
    outputContainer.innerHTML = "";
    downloadOptions.style.display = "none";

    const payload = {
      fullName:       form.elements["fullName"].value.trim(),
      title:          form.elements["title"].value.trim(),
      contact:        form.elements["contact"].value.trim(),
      summary:        form.elements["summary"].value.trim(),
      education:      form.elements["education"].value.trim(),
      experience:     form.elements["experience"].value.trim(),
      skills:         form.elements["skills"].value.trim(),
      certifications: form.elements["certifications"].value.trim(),
      portfolio:      form.elements["portfolio"].value.trim()
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
      downloadOptions.style.display = "block";
    } catch (err) {
      console.error("Generate/build error:", err);
      alert("Resume generation failed.");
    } finally {
      builderIndicator.style.display = "none";
    }
  });

  // Preview button
  document.getElementById("previewTemplate")?.addEventListener("click", async () => {
    try {
      builderIndicator.style.display = "block";
      const ctx = window._resumeCtx || coerceFormToTemplateContext();
      await renderWithTemplateFromContext(ctx, "html", getTheme());
      downloadOptions.style.display = "block";
    } catch (e) {
      console.error(e);
      alert(e.message || "Preview failed");
    } finally {
      builderIndicator.style.display = "none";
    }
  });

  // PDF button
  document.getElementById("downloadTemplatePdf")?.addEventListener("click", async () => {
    try {
      builderIndicator.style.display = "block";
      const ctx = window._resumeCtx || coerceFormToTemplateContext();
      await renderWithTemplateFromContext(ctx, "pdf", getTheme());
    } catch (e) {
      console.error(e);
      alert(e.message || "PDF build failed");
    } finally {
      builderIndicator.style.display = "none";
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
