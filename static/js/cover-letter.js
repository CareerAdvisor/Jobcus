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
      company: form.company?.value || "",
      role: form.role?.value || "",
      jobUrl: form.jobUrl?.value || "",
      tone: form.tone?.value || "professional",

      // Applicant (sender)
      sender: {
        name,
        address1: form.senderAddress1?.value || "",
        city: form.senderCity?.value || "",
        postcode: form.senderPostcode?.value || "",
        email: form.senderEmail?.value || "",
        phone: form.senderPhone?.value || "",
        date: form.letterDate?.value || new Date().toISOString().slice(0,10)
      },

      // Recruiter / company (recipient)
      recipient: {
        name: form.recipient?.value || "Hiring Manager",
        company: form.company?.value || "",
        address1: form.companyAddress1?.value || "",
        city: form.companyCity?.value || "",
        postcode: form.companyPostcode?.value || ""
      },

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

  // Keep only the letter body (no greeting/closing) even if AI returns them.
  function sanitizeDraft(text) {
    if (!text) return text;
    let t = String(text).trim();
    t = t.replace(/^dear[^\n]*\n(\s*\n)*/i, ""); // drop any leading "Dear ..."
    t = t.replace(/\n+\s*(yours sincerely|sincerely|kind regards|best regards)[\s\S]*$/i, ""); // drop sign-off
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

    return sanitizeDraft(raw || "");
  }

  async function renderLetter(ctx, format = "html") {
    const res = await fetch("/build-cover-letter", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        format,                      // "html" for preview, "pdf" for download
        letter_only: true,           // <— IMPORTANT: force the letter-only view in preview
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

    aiCard?.addEventListener("click", async (e) => {
      const btn = e.target.closest(".ai-refresh, .ai-add");
      if (!btn) return;

      if (btn.classList.contains("ai-refresh")) {
        try {
          const ctx = gatherContext(form);
          const draft = await aiSuggestCoverLetter(ctx);
          aiCard.querySelector(".ai-text").textContent = draft || "No draft yet.";
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
