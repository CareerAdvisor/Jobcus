// static/js/cover-letter.js
(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  function gatherContext(form) {
    const name = [form.firstName?.value, form.lastName?.value].filter(Boolean).join(" ").trim();
    return {
      name,
      contact: form.contact?.value || "",
      // keep top-level for header
      recipient: form.recipient?.value || "Hiring Manager",
      company: form.company?.value || "",
      role: form.role?.value || "",
      jobUrl: form.jobUrl?.value || "",
      tone: form.tone?.value || "professional",
      // send nested object for backend
      coverLetter: {
        manager: form.recipient?.value || "Hiring Manager",
        company: form.company?.value || "",
        role: form.role?.value || "",
        jobUrl: form.jobUrl?.value || "",
        tone: form.tone?.value || "professional",
        draft: form.body?.value || ""
      }
    };
  }

  async function aiSuggestCoverLetter(ctx) {
    const res = await fetch("/ai/suggest", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      // let the dataset override if present (your HTML uses data-field="cover_letter")
      body: JSON.stringify({
        field: (document.getElementById("ai-cl")?.dataset?.field) || "coverletter",
        context: ctx
      })
    });
    // ...
  }

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error || "AI suggest failed");
    const text =
      json.text
      || (Array.isArray(json.suggestions) ? json.suggestions.join("\n\n")
         : (Array.isArray(json.list) ? json.list.join("\n\n") : ""));
    return text || "AI suggestion unavailable.";

  }

  async function renderLetter(ctx, format = "html") {
    const res = await fetch("/build-cover-letter", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      // Backend expects {name, title?, contact, coverLetter:{draft:...}, format}
      body: JSON.stringify({ format, name: ctx.name, contact: ctx.contact, coverLetter: ctx.coverLetter })
    });

    if (!res.ok) throw new Error(`Build failed: ${res.status}`);
    if (format === "pdf") {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "cover-letter.pdf"; a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const html = await res.text();
    const wrap = document.getElementById("clPreviewWrap");
    const frame = document.getElementById("clPreview");
    if (wrap && frame) {
      wrap.style.display = "block";
      frame.srcdoc = html;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("clForm");
    const aiCard = document.getElementById("ai-cl");

    // Optional prefill from localStorage (if you set it from builder/analyzer)
    try {
      const seed = JSON.parse(localStorage.getItem("coverLetterSeed") || "{}");
      if (seed.firstName && form.firstName) form.firstName.value = seed.firstName;
      if (seed.lastName  && form.lastName)  form.lastName.value  = seed.lastName;
      if (seed.contact   && form.contact)   form.contact.value   = seed.contact;
      if (seed.role      && form.role)      form.role.value      = seed.role;
      if (seed.company   && form.company)   form.company.value   = seed.company;
    } catch {}

    aiCard?.addEventListener("click", async (e) => {
      const btn = e.target.closest(".ai-refresh, .ai-add");
      if (!btn) return;

      if (btn.classList.contains("ai-refresh")) {
        try {
          const ctx = gatherContext(form);
          const draft = await aiSuggestCoverLetter(ctx);
          aiCard.querySelector(".ai-text").textContent = draft;
        } catch (err) {
          aiCard.querySelector(".ai-text").textContent = err.message || "AI failed.";
        }
      }

      if (btn.classList.contains("ai-add")) {
        const draft = aiCard.querySelector(".ai-text")?.textContent?.trim();
        if (!draft) return;
        form.body.value = draft; // insert into textarea
      }
    });

    document.getElementById("cl-preview")?.addEventListener("click", async () => {
      try { await renderLetter(gatherContext(form), "html"); }
      catch (e) { alert(e.message || "Preview failed"); }
    });

    document.getElementById("cl-download")?.addEventListener("click", async () => {
      try { await renderLetter(gatherContext(form), "pdf"); }
      catch (e) { alert(e.message || "PDF failed"); }
    });
  });
})();

document.getElementById("genCLBtn")?.addEventListener("click", async () => {
  const company = document.getElementById("clCompany").value.trim();
  const role    = document.getElementById("clRole").value.trim();
  const jd      = document.getElementById("clJD").value.trim();
  const resumeText = document.getElementById("resume-text").value.trim();

  const context = { company, role, jd, resumeText };
  try {
    const res = await fetch("/ai/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field: "coverletter_from_analyzer", context }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    const draft = json.text || (Array.isArray(json.list) ? json.list.join("\n") : "");
    const ta = document.getElementById("clDraft");
    ta.style.display = "block";
    ta.value = draft || "No draft produced.";
    localStorage.setItem("coverLetterDraft", ta.value);
  } catch (e) {
    alert(e.message || "Failed to draft cover letter.");
  }
});

