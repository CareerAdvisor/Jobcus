// /static/js/cover-letter.js
(function () {
  // Always send cookies with fetch (SameSite=Lax)
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  // Tiny helpers
  function escapeHtml(s = "") {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function stripTags(s = "") { return String(s).replace(/<[^>]*>/g, "").trim(); }

  // Optional inline banner (Analyzer-style)
  function showInlineBanner(container, msg) {
    if (!container) return;
    let b = container.querySelector(".inline-banner");
    if (!b) {
      b = document.createElement("div");
      b.className = "inline-banner";
      b.style.cssText = "margin-top:10px;padding:10px 12px;border-radius:6px;font-size:14px;background:#fff3cd;color:#856404;border:1px solid #ffeeba";
      container.appendChild(b);
    }
    b.innerHTML = msg; // we control content
  }

  // Use global pricing URL if base.js set it; otherwise default
  const PRICING_URL = (window.PRICING_URL || "/pricing");

  // ─────────────────────────────────────────────────────────────
  // Centralized error handling (auth/limits/abuse → banner/redirect)
  // ─────────────────────────────────────────────────────────────
  async function handleCommonErrors(res) {
    if (res.ok) return null;

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let body = null, text = "";
    try {
      if (ct.includes("application/json")) body = await res.json();
      else text = await res.text();
    } catch {}

    const msg = (body && (body.message || body.error)) || stripTags(text) || `Request failed (${res.status})`;

    // 402: upgrade required / quota exceeded
    if (res.status === 402 || (body && (body.error === "upgrade_required" || body.error === "quota_exceeded"))) {
      const html = body?.message_html || `You’ve reached your plan limit. <a href="${PRICING_URL}">Upgrade now →</a>`;
      window.showUpgradeBanner?.(html);
      setTimeout(() => { window.location.href = PRICING_URL; }, 800);
      throw new Error(body?.message || "Upgrade required");
    }

    // 401/403: auth required
    if (res.status === 401 || res.status === 403) {
      const authMsg = body?.message || "Please sign up or log in to use this feature.";
      window.showUpgradeBanner?.(authMsg);
      setTimeout(() => { window.location.href = "/account?mode=login"; }, 800);
      throw new Error(authMsg);
    }

    // 429: abuse/device guard
    if (res.status === 429 && (body?.error === "too_many_free_accounts" || body?.error === "device_limit")) {
      const ab = body?.message || "Too many free accounts detected from your network/device.";
      window.showUpgradeBanner?.(ab);
      throw new Error(ab);
    }

    // 5xx or anything else: friendly banner
    window.showUpgradeBanner?.(escapeHtml(msg));
    throw new Error(msg);
  }

  // Shared POST helper
  async function postAndMaybeError(url, payload, accept = "application/json") {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": accept
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) await handleCommonErrors(res);
    return res;
  }

  // Context used for preview/pdf
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

  // Normalize AI text
  function sanitizeDraft(text) {
    if (!text) return text;
    let t = String(text).trim();
    t = t.replace(/^dear[^\n]*\n(\s*\n)*/i, "");
    t = t.replace(/\n+\s*(yours\s+sincerely|sincerely|kind\s+regards|best\s+regards|regards)[\s\S]*$/i, "");
    t = t.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    const paras = t.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    return paras.slice(0, 3).join("\n\n").trim();
  }

  // PREVIEW (free)
  async function previewLetter(payload) {
    try {
      const res = await postAndMaybeError(
        "/build-cover-letter",
        { format: "html", letter_only: true, ...payload },
        "text/html,application/json"
      );
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("text/html")) throw new Error("Unexpected response.");
      const html = await res.text();

      const wrap  = document.getElementById("clPreviewWrap");
      const frame = document.getElementById("clPreview") || document.getElementById("letterPreview");
      if (wrap) wrap.style.display = "block";
      if (frame) frame.srcdoc = html;

      window.hideUpgradeBanner?.(); // success → clear any old banner
    } catch (err) {
      console.warn("Cover letter preview error:", err);
    }
  }

  // AI helpers
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
    return { tone: get("tone") || "professional", job_url: get("jobUrl"), sender, recipient };
  }
  async function aiSuggestCoverLetter(ctx) {
    const res = await fetch("/ai/cover-letter", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(ctx)
    });
    await handleCommonErrors(res);
    const json = await res.json().catch(() => ({}));
    if (!json.draft) throw new Error("No draft returned.");
    return sanitizeDraft(json.draft);
  }
  window.aiSuggestCoverLetter_min = async function(ctx){ return aiSuggestCoverLetter(ctx); };

  // Multiple variants (optional button #ai-show-variants)
  async function aiSuggestVariants(n = 3) {
    const form = document.getElementById("clForm");
    const ctx  = gatherCLContext(form);
    const variants = [];
    for (let i = 0; i < n; i++) {
      try {
        const draft = await aiSuggestCoverLetter_min(ctx);
        if (draft) variants.push(draft);
      } catch {}
    }
    return variants;
  }

  // ─────────────────────────────────────────────────────────────
  // Boot & UI bindings
  // ─────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    const form   = document.getElementById("clForm");
    const aiCard = document.getElementById("ai-cl");
    const getAiTextEl = () => aiCard?.querySelector(".ai-text");

    // Optional prefill
    (function maybePrefillFromSeed() {
      if (!form) return;
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
    })();

    // AI refresh / add
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

    // Variants button (optional)
    document.getElementById("ai-show-variants")?.addEventListener("click", async () => {
      const box = document.querySelector("#ai-cl .ai-text");
      if (!box) return;
      box.textContent = "Generating options…";
      const drafts = await aiSuggestVariants(3);
      if (!drafts.length) { box.textContent = "No suggestions."; return; }
      box.innerHTML = drafts.map((d, i) =>
        `<div class="option"><strong>Option ${i+1}</strong><br>${escapeHtml(d).replace(/\n/g,"<br>")}</div>`
      ).join("<hr>");
    });

    // Preview (free)
    document.getElementById("cl-preview")?.addEventListener("click", async () => {
      try { await previewLetter(gatherContext(form)); }
      catch {}
    });

    // DOWNLOAD (gated like Analyzer/Builder)
    document.getElementById("cl-download")?.addEventListener("click", async () => {
      if (!form) return;
      const payload = gatherContext(form);

      try {
        const res = await fetch("/build-cover-letter", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // PDF on success, JSON (or anything) on errors
            "Accept": "application/pdf,application/json"
          },
          body: JSON.stringify({ format: "pdf", letter_only: true, ...payload })
        });

        // Gating + banners
        if (!res.ok) {
          let j = null;
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("application/json")) {
            try { j = await res.json(); } catch {}
          }
          // Treat 403/upgrade_required OR 402 as plan gating
          if (res.status === 403 && j?.error === "upgrade_required" || res.status === 402) {
            const html = (j?.message_html) ||
              `File downloads are available on Standard and Premium. <a href="${PRICING_URL}">Upgrade now →</a>`;
            window.showUpgradeBanner?.(html);
            alert(j?.message || "File downloads are available on Standard and Premium.");

            // Optional inline banner like Analyzer (append a link too)
            const container =
              document.getElementById("cl-download")?.closest(".card, .rb-card, .actions, form, #clForm") || document.getElementById("clForm");
            showInlineBanner(container, html);
            return;
          }

          // Any other error → friendly banner
          window.showUpgradeBanner?.(j?.message || j?.error || "Download failed.");
          return;
        }

        // Success → stream file
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "cover-letter.pdf"; a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("Cover-letter PDF error:", err);
        window.showUpgradeBanner?.(err.message || "Download failed.");
      }
    });
  });
})();
