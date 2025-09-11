// /static/js/cover-letter.js
(function () {
  // Always send cookies with fetch (SameSite=Lax)
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  // Helpers
  function escapeHtml(s = "") {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function stripTags(s = "") { return String(s).replace(/<[^>]*>/g, "").trim(); }

  // Analyzer-style inline banner (optional)
  function showInlineBanner(container, html) {
    if (!container) return;
    let b = container.querySelector(".inline-banner");
    if (!b) {
      b = document.createElement("div");
      b.className = "inline-banner";
      b.style.cssText = "margin-top:10px;padding:10px 12px;border-radius:6px;font-size:14px;background:#fff3cd;color:#856404;border:1px solid #ffeeba";
      container.appendChild(b);
    }
    b.innerHTML = html; // controlled content
  }

  const PRICING_URL = (window.PRICING_URL || "/pricing");

  // Small fallback to clear sticky banner after success
  if (!window.hideUpgradeBanner) {
    window.hideUpgradeBanner = function () {
      const el = document.getElementById("upgrade-banner");
      if (el) el.remove();
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Centralized error handling (auth/limits/abuse → banner/redirect)
  // ─────────────────────────────────────────────────────────────
  async function handleCommonErrors(res) {
    if (res.ok) return null;

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let body = null, text = "";
    try { if (ct.includes("application/json")) body = await res.json(); else text = await res.text(); } catch {}

    const msg = (body && (body.message || body.error)) || stripTags(text) || `Request failed (${res.status})`;

    // 402: quota/upgrade
    if (res.status === 402 || (body && (body.error === "upgrade_required" || body.error === "quota_exceeded"))) {
      const html = body?.message_html || `You’ve reached your plan limit. <a href="${PRICING_URL}">Upgrade now →</a>`;
      window.showUpgradeBanner?.(html);
      setTimeout(() => { window.location.href = PRICING_URL; }, 800);
      throw new Error(body?.message || "Upgrade required");
    }

    // 401/403: auth
    if (res.status === 401 || res.status === 403) {
      const authMsg = body?.message || "Please sign up or log in to use this feature.";
      window.showUpgradeBanner?.(authMsg);
      setTimeout(() => { window.location.href = "/account?mode=login"; }, 800);
      throw new Error(authMsg);
    }

    // 429: abuse/device
    if (res.status === 429 && (body?.error === "too_many_free_accounts" || body?.error === "device_limit")) {
      const ab = body?.message || "Too many free accounts detected from your network/device.";
      window.showUpgradeBanner?.(ab);
      throw new Error(ab);
    }

    // 5xx / other
    window.showUpgradeBanner?.(escapeHtml(msg));
    throw new Error(msg);
  }

  // Shared POST helper
  async function postAndMaybeError(url, payload, accept = "application/json") {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": accept },
      body: JSON.stringify(payload)
    });
    if (!res.ok) await handleCommonErrors(res);
    return res;
  }

  // Grab the body/draft textarea robustly (works if name != "body")
  function readDraftFromForm(form) {
    const el =
      form?.querySelector('textarea[name="body"], textarea[name="draft"], textarea[name="cover_body"], #body, #letterBody') || null;
    return el ? el.value : (form?.body?.value || "");
  }

  // cover-letter context used for preview/pdf
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
        draft: readDraftFromForm(form) || ""
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

  // PREVIEW (free) — success-only injection
  async function previewLetter(payload) {
    try {
      // Make sure draft is present for both back-end shapes
      const draft = sanitizeDraft(payload?.coverLetter?.draft || "");
      const enriched = {
        ...payload,
        coverLetter: { ...(payload.coverLetter || {}), draft },
        cover_body: draft,               // <-- duplicate for older route/templates
      };

      const res = await postAndMaybeError(
        "/build-cover-letter",
        { format: "html", letter_only: true, ...enriched },
        "text/html,application/json"
      );
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("text/html")) throw new Error("Unexpected response.");
      const html = await res.text();

      const wrap  = document.getElementById("clPreviewWrap");
      const frame = document.getElementById("clPreview") || document.getElementById("letterPreview");
      if (wrap) wrap.style.display = "block";
      if (frame) frame.srcdoc = html;

      window.hideUpgradeBanner?.(); // clear any previous gate message
    } catch (err) {
      console.warn("Cover letter preview error:", err);
    }
  }

  // AI: /ai/cover-letter
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

  // Optional: multiple variants
  async function aiSuggestVariants(n = 3) {
    const form = document.getElementById("clForm");
    const ctx  = gatherCLContext(form);
    const variants = [];
    for (let i = 0; i < n; i++) {
      try { const draft = await aiSuggestCoverLetter_min(ctx); if (draft) variants.push(draft); } catch {}
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

    // Prefill
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

    // AI handlers
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
          if (el) el.textContent = draft || "No draft yet.";
        } catch (err) {
          const el = getAiTextEl();
          if (el) el.textContent = err.message || "AI failed.";
          console.error("cover-letter AI error:", err);
        } finally { btn.disabled = false; }
      }

      if (btn.classList.contains("ai-add")) {
        const el = getAiTextEl();
        const draft = el ? el.textContent.trim() : "";
        const bodyEl =
          form?.querySelector('textarea[name="body"], textarea[name="draft"], textarea[name="cover_body"], #body, #letterBody');
        if (draft && bodyEl) bodyEl.value = sanitizeDraft(draft);
      }
    });

    // Variants button (optional)
    document.getElementById("ai-show-varia
