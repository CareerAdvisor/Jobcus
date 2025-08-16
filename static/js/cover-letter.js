// static/js/cover-letter.js
(function () {
  // Always send cookies for same-origin requests
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  function gatherContext(form) {
    const name = [form.firstName?.value, form.lastName?.value].filter(Boolean).join(" ").trim();
    return {
      // header
      name,
      contact: form.contact?.value || "",
      // role/company
      company: form.company?.value || "",
      role: form.role?.value || "",
      jobUrl: form.jobUrl?.value || "",
      tone: form.tone?.value || "professional",
      // sender (you)
      sender: {
        name,
        address1: form.senderAddress1?.value || "",
        city: form.senderCity?.value || "",
        postcode: form.senderPostcode?.value || "",
        email: form.senderEmail?.value || "",
        phone: form.senderPhone?.value || "",
        date: form.letterDate?.value || new Date().toISOString().slice(0,10)
      },
      // recipient (hiring manager/company)
      recipient: {
        name: form.recipient?.value || "Hiring Manager",
        company: form.company?.value || "",
        address1: form.companyAddress1?.value || "",
        city: form.companyCity?.value || "",
        postcode: form.companyPostcode?.value || ""
      },
      // cover letter body payload for backend
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

  // Remove “Dear …” and any trailing sign-off if the AI returns a full letter.
  function sanitizeDraft(text) {
    if (!text) return text;
    let t = String(text).trim();

    // Strip leading “Dear …” block up to the first blank line
    t = t.replace(/^dear[^\n]*\n(\s*\n)*/i, "");

    // Strip common sign-offs from the end (e.g., Yours sincerely, Sincerely, Kind regards) and anything that follows
    t = t.replace(/\n+\s*(yours sincerely|sincerely|kind regards|best regards)[\s\S]*$/i, "");

    // Also trim a trailing author name line if it’s alone at the bottom
    t = t.replace(/\n+\s*[A-Z][A-Za-z .'-]{1,80}\s*$/m, (match) => {
      // keep if it looks like part of a sentence; otherwise drop
      return /\.\s*$/.test(match) ? match : "";
    });

    return t.trim();
  }

  async function aiSuggestCoverLetter(ctx) {
    const field = document.getElementById("ai-cl")?.dataset?.field || "coverletter";
    const res = await fetch("/ai/suggest", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ field, context: ctx })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error || "AI suggest failed");

    const raw =
      json.text ||
      (Array.isArray(json.suggestions) ? json.suggestions.join("\n\n")
       : (Array.isArray(json.list) ? json.list.join("\n\n") : ""));

    // Ensure we only keep the body paragraphs
    return sanitizeDraft(raw || "");
  }

  async function renderLetter(ctx, format = "html") {
    const res = await fetch("/build-cover-letter", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        format,
        sender: ctx.sender,
        recipient: ctx.recipient,
        coverLetter: ctx.coverLetter
      })
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

    // Optional prefill
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
        if (draft) form.body.value = sanitizeDraft(draft);
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

// Analyzer quick-draft (if you use that mini form somewhere else)
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
    const raw = json.text || (Array.isArray(json.list) ? json.list.join("\n\n")
                : (Array.isArray(json.suggestions) ? json.suggestions.join("\n\n") : ""));
    const draft = sanitizeDraft(raw || "");
    const ta = document.getElementById("clDraft");
    ta.style.display = "block";
    ta.value = draft || "No draft produced.";
    localStorage.setItem("coverLetterDraft", ta.value);
  } catch (e) {
    alert(e.message || "Failed to draft cover letter.");
  }
});
