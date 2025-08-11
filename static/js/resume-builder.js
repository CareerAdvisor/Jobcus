// Ensure cookies on every fetch (keeps session with SameSite/Lax)
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  //
  // Part 1: ATS Resume Analyzer
  //
  const analyzeBtn         = document.getElementById("analyze-btn");
  const resumeText         = document.getElementById("resume-text");
  const resumeFile         = document.getElementById("resumeFile");
  const analyzingIndicator = document.getElementById("analyzingIndicator");

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result.split(",")[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  async function sendAnalysis(file) {
    let payload;
    if (!file && resumeText.value.trim()) {
      payload = { text: resumeText.value.trim() };
    } else if (file) {
      const b64 = await fileToBase64(file);
      localStorage.setItem("resumeBase64", b64);
      if (file.type === "application/pdf") {
        payload = { pdf: b64 };
      } else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        payload = { docx: b64 };
      } else {
        return alert("Unsupported type. Upload PDF or DOCX.");
      }
    } else {
      return alert("Paste text or upload a file.");
    }

    analyzingIndicator.style.display = "block";
    try {
      const res = await fetch("/api/resume-analysis", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || res.statusText);

      localStorage.setItem("resumeAnalysis", JSON.stringify(data));
      window.location.href = "/dashboard";
    } catch (err) {
      console.error("Analyzer error:", err);
      alert("Analysis failed. Try again.");
    } finally {
      analyzingIndicator.style.display = "none";
    }
  }

  analyzeBtn?.addEventListener("click", () => {
    const file = resumeFile.files[0] || null;
    sendAnalysis(file);
  });

  //
  // Part 2: “Build Your Resume with AI” (JSON -> template)
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

  // ▼▼ Coerce form values into a minimal template context ▼▼
  function coerceFormToTemplateContext() {
    const f = document.getElementById("resumeForm");
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
  // ▲▲ END coerce ▲▲

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

    // HTML preview
    const r = await fetch("/build-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "html", theme, ...ctx })
    });
    const html = await r.text();
    if (!r.ok) throw new Error(`HTML build failed: ${r.status} ${html}`);

    // Do NOT inline into the page to avoid duplication; use the iframe instead.
    outputContainer.innerHTML = "";

    if (previewWrap && previewEl) {
      previewWrap.style.display = "block";
      // isolate the resume page (no duplication / no CSS collisions)
      previewEl.srcdoc = html;
    }
  }

  // Submit
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
  previewBtn?.addEventListener("click", async () => {
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
  pdfBtn?.addEventListener("click", async () => {
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

// Legacy downloads (TXT keeps client-side; PDF now uses server template)
async function downloadResume(format) {
  const container = document.getElementById("builderGeneratedContent");
  const text = container?.innerText || "";

  if (format === "txt") {
    saveAs(new Blob([text], {type:"text/plain"}), "resume.txt");
    return;
  }

  if (format === "pdf") {
    const theme = document.getElementById("themeSelect")?.value || "modern";
    const ctx = window._resumeCtx || (function coerce(){
      // tiny fallback if preview wasn't used yet
      const f = document.getElementById("resumeForm");
      return {
        fullName: f.elements["fullName"].value.trim(),
        title:    f.elements["title"].value.trim(),
        contact:  f.elements["contact"].value.trim(),
      };
    })();

    try {
      const res = await fetch("/build-resume", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ format:"pdf", theme, ...ctx })
      });
      if (!res.ok) throw new Error("PDF build failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "resume.pdf"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("Unable to download PDF.");
    }
  }
}
