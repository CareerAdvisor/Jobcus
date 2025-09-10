<script>
(function () {
  // Always send cookies with fetch (SameSite=Lax)
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  // Simple escaper + strip tags helper
  function escapeHtml(s = "") {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function stripTags(s = "") {
    return String(s).replace(/<[^>]*>/g, "").trim();
  }

  // Centralized server-response handling (auth/limits/abuse)
  async function handleCommonErrors(res) {
    if (res.ok) return null;

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let msg = `Request failed (${res.status})`;

    try {
      if (ct.includes("application/json")) {
        const j = await res.json();
        msg = j?.message || j?.error || msg;

        // Auth
        if (res.status === 401 || res.status === 403) {
          const authMsg = msg || "Please sign up or log in to use this feature.";
          window.showUpgradeBanner?.(authMsg);
          setTimeout(() => { window.location.href = "/account?mode=login"; }, 800);
          throw new Error(authMsg);
        }

        // Plan limits / feature gating
        if (res.status === 402 || j?.error === "upgrade_required") {
          const up = msg || "You’ve reached your plan limit. Upgrade to continue.";
          window.showUpgradeBanner?.(up);
          throw new Error(up);
        }

        // Abuse guard
        if (res.status === 429 && (j?.error === "too_many_free_accounts" || j?.error === "device_limit")) {
          const ab = msg || "Too many free accounts detected from your network/device.";
          window.showUpgradeBanner?.(ab);
          throw new Error(ab);
        }
      } else {
        // Likely HTML error page — don't surface markup
        await res.text().catch(() => {});
        // Fall through to generic msg below
      }
    } catch {
      /* ignore parse errors */
    }
    throw new Error(stripTags(msg));
  }

  // ---------- cover-letter context for preview/PDF ----------
  function gatherContext(form) {
    const name = [form.firstName?.value, form.lastName?.value].filter(Boolean).join(" ").trim();
    const baseTone = (form.tone?.value || "professional").trim();
    const toneAugmented = `${baseTone}; human-like and natural; concise; maximum 3 short paragraphs`;

    return {
      name,
      contact: form.contact?.value || "",
      company: form.company?.value || "",
      role: form.role?.value || "",
      jobUrl: form.jobUrl?.value || "",
      tone: toneAugmented,

      sender: {
        name,
        address1: form.senderAddress1?.value || "",
        city: form.senderCity?.value || "",
        postcode: form.senderPostcode?.value || "",
        email: form.senderEmail?.value || "",
        phone: form.senderPhone?.value || "",
        date: form.letterDate?.value || new Date().toISOString().slice(0,10)
      },

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
        tone: toneAugmented,
        draft: form.body?.value || ""
      }
    };
  }

  // Keep only the body (no greeting/closing), cap to 3 paragraphs, normalize spacing
  function sanitizeDraft(text) {
    if (!text) return text;
    let t = String(text).trim();
    t = t.replace(/^dear[^\n]*\n(\s*\n)*/i, ""); // drop greeting
    t = t.replace(/\n+\s*(yours\s+sincerely|sincerely|kind\s+regards|best\s+regards|regards)[\s\S]*$/i, ""); // drop sign-off
    t = t.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim(); // normalize
    const paras = t.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    return paras.slice(0, 3).join("\n\n").trim(); // max 3 paras
  }

  // ---------- PREVIEW / PDF ----------
  async function renderLetter(ctx, format = "html") {
    const res = await fetch("/build-cover-letter", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": format === "pdf" ? "application/pdf" : "text/html,application/json"
      },
      body: JSON.stringify({
        format,            // "html" for preview, "pdf" for download
        letter_only: true, // ensure letter-only view for preview/download
        sender: ctx.sender,
        recipient: ctx.recipient,
        coverLetter: ctx.coverLetter
      })
    });

    if (!res.ok) {
      await handleCommonErrors(res); // throws with a clean message
    }

    if (format === "pdf") {
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/pdf")) {
        // Try to extract any JSON/text message but do not surface raw HTML
        let msg = "PDF generation failed.";
        try {
          if (ct.includes("application/json")) {
            const j = await res.json();
            msg = j?.message || j?.error || msg;
          } else {
            await res.text(); // discard HTML
          }
        } catch {}
        throw new Error(stripTags(msg));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "cover-letter.pdf"; a.click();
      URL.revokeObjectURL(url);
      return;
    }

    // HTML preview
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("text/html")) {
      let msg = "Preview failed.";
      try {
        if (ct.includes("application/json")) {
          const j = await res.json().catch(() => ({}));
          msg = j?.message || j?.error || msg;
        } else {
          await res.text(); // discard HTML
        }
      } catch {}
      window.showUpgradeBanner?.(msg);
      throw new Error(stripTags(msg));
    }

    const html = await res.text();
    const wrap  = document.getElementById("clPreviewWrap");
    const frame = document.getElementById("clPreview");
    if (wrap && frame) {
      wrap.style.display = "block";
      frame.srcdoc = html; // ✅ inject letter-only HTML (no full page duplication)
    }
  }

  // ---------- OPTIONAL prefill ----------
  function maybePrefillFromSeed(form) {
    try {
      const raw = localStorage.getItem("coverLetterSeed");
      if (!raw) return;
      const seed = JSON.parse(raw);
      if (seed.firstName && form.firstName) form.firstName.value = seed.firstName;
      if (seed.lastName  && form.lastName)  form.lastName.value  = seed.lastName;
      if (seed.role      && form.role)      form.role.value      = seed.role;
      if (seed.company   && form.company)   form.company.value   = seed.company;
      if (seed.contact   && form.contact)   form.contact.value   = seed.contact;
    } catch {}
  }

  // ------------------------------------------------------------------
  // AI: /ai/cover-letter
  // ------------------------------------------------------------------
  function gatherCLContext(form) {
    const get = (n) => (form?.elements?.[n]?.value || "").trim();
    const sender = {
      first_name: get("firstName"),
      last_name:  get("lastName"),
      email:      get("senderEmail"),
      phone:      get("senderPhone"),
      address1:   get("senderAddress1"),
      city:       get("senderCity"),
      postcode:   get("senderPostcode"),
      date:       get("letterDate"),
    };
    const recipient = {
      name:    get("recipient") || "Hiring Manager",
      company: get("company"),
      address1:get("companyAddress1"),
      city:    get("companyCity"),
      postcode:get("companyPostcode"),
      role:    get("role"),
    };
    return {
      tone: get("tone") || "professional",
      job_url: get("jobUrl"),
      sender,
      recipient
    };
  }

  async function aiSuggestCoverLetter(ctx) {
    const res = await fetch("/ai/cover-letter", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify(ctx)
    });
    await handleCommonErrors(res);
    const json = await res.json().catch(() => ({}));
    if (!json.draft) throw new Error("No draft returned.");
    return sanitizeDraft(json.draft);
  }

  // Legacy alias so old handlers keep working
  window.aiSuggestCoverLetter_min = async function(ctx) {
    return aiSuggestCoverLetter(ctx);
  };

  // ------------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", () => {
    const form   = document.getElementById("clForm");
    const aiCard = document.getElementById("ai-cl");
    const getAiTextEl = () => aiCard?.querySelector(".ai-text");

    if (form) maybePrefillFromSeed(form);

    // AI handlers (refresh / insert)
    aiCard?.addEventListener("click", async (e) => {
      const btn = e.target.closest(".ai-refresh, .ai-add");
      if (!btn) return;

      if (btn.classList.contains("ai-refresh")) {
        try {
          btn.disabled = true;
          const el = getAiTextEl();
          if (el) el.textContent = "Thinking…";
          const ctx = gatherCLContext(form);
          const draft = await aiSuggestCoverLetter_min(ctx);
          if (el) el.textContent = sanitizeDraft(draft) || "No draft yet.";
        } catch (err) {
          const el = getAiTextEl();
          if (el) el.textContent = err.message || "AI failed.";
          console.error("cover-letter AI error:", err);
        } finally {
          btn.disabled = false;
        }
      }

      if (btn.classList.contains("ai-add")) {
        const el = getAiTextEl();
        const draft = el ? el.textContent.trim() : "";
        if (draft && form?.body) form.body.value = sanitizeDraft(draft);
      }
    });

    // Preview / Download
    document.getElementById("cl-preview")?.addEventListener("click", async () => {
      try { await renderLetter(gatherContext(form), "html"); }
      catch (e) { alert(stripTags(e.message) || "Preview failed"); }
    });

    document.getElementById("cl-download")?.addEventListener("click", async () => {
      try { await renderLetter(gatherContext(form), "pdf"); }
      catch (e) { alert(stripTags(e.message) || "PDF failed"); }
    });
  });
})();
</script>
