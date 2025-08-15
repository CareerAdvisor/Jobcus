// static/js/cover-letter.js
(function () {
  // Always send cookies on fetch like your other pages
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
      recipient: form.recipient?.value || "Hiring Manager",
      company: form.company?.value || "",
      role: form.role?.value || "",
      jobUrl: form.jobUrl?.value || "",
      tone: form.tone?.value || "professional",
      body: form.body?.value || ""
    };
  }

  async function aiSuggestCoverLetter(ctx) {
    const res = await fetch("/ai/suggest", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ field: "cover_letter", context: ctx })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error || "AI suggest failed");
    // Support both {text} or {suggestions:[]}
    const text = json.text || (Array.isArray(json.suggestions) ? json.suggestions.join("\n\n") : "");
    return text || "AI suggestion unavailable.";
  }

  async function renderLetter(ctx, format = "html") {
    const res = await fetch("/build-cover-letter", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ format, ...ctx })
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

    // Prefill from localStorage (set by builder/analyzer if you want)
    try {
      const seed = JSON.parse(localStorage.getItem("coverLetterSeed") || "{}");
      if (seed.firstName && form.firstName) form.firstName.value = seed.firstName;
      if (seed.lastName && form.lastName) form.lastName.value = seed.lastName;
      if (seed.contact && form.contact) form.contact.value = seed.contact;
      if (seed.role && form.role) form.role.value = seed.role;
      if (seed.company && form.company) form.company.value = seed.company;
    } catch {}

    // AI actions (Refresh → fetch draft, Insert → put into textarea)
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
        form.body.value = draft;
      }
    });

    // Preview & download
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
