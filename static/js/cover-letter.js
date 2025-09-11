// /static/js/cover-letter.js
(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  function escapeHtml(s = "") {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function stripTags(s = "") { return String(s).replace(/<[^>]*>/g, "").trim(); }
  const PRICING_URL = (window.PRICING_URL || "/pricing");

  // minimal hide helper (in case base.js didn't provide one)
  if (!window.hideUpgradeBanner) window.hideUpgradeBanner = function(){
    document.getElementById("upgrade-banner")?.remove();
  };

  async function handleCommonErrors(res) {
    if (res.ok) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let j=null, t="";
    try { if (ct.includes("application/json")) j=await res.json(); else t=await res.text(); } catch {}
    const msg = (j && (j.message || j.error)) || stripTags(t) || `Request failed (${res.status})`;

    if (res.status === 402 || (j && (j.error === "upgrade_required" || j.error === "quota_exceeded"))) {
      const html = j?.message_html || `You’ve reached your plan limit. <a href="${PRICING_URL}">Upgrade now →</a>`;
      window.showUpgradeBanner?.(html);
      setTimeout(()=>{ window.location.href = PRICING_URL; }, 800);
      throw new Error(j?.message || "Upgrade required");
    }
    if (res.status === 401 || res.status === 403) {
      const authMsg = j?.message || "Please sign up or log in to use this feature.";
      window.showUpgradeBanner?.(authMsg);
      setTimeout(()=>{ window.location.href = "/account?mode=login"; }, 800);
      throw new Error(authMsg);
    }
    if (res.status === 429 && (j?.error === "too_many_free_accounts" || j?.error === "device_limit")) {
      const ab = j?.message || "Too many free accounts detected from your network/device.";
      window.showUpgradeBanner?.(ab);
      throw new Error(ab);
    }
    window.showUpgradeBanner?.(escapeHtml(msg));
    throw new Error(msg);
  }

  async function postAndMaybeError(url, payload, accept) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": accept || "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) await handleCommonErrors(res);
    return res;
  }

  // ---- robust draft reader (textarea OR AI box fallback) ----
  function readDraftFromFormOrAI(form) {
    const ta = form?.querySelector(
      'textarea[name="body"], textarea[name="draft"], textarea[name="cover_body"], #body, #letterBody'
    );
    let val = ta?.value || "";
    if (!val) {
      const aiText = document.querySelector("#ai-cl .ai-text");
      val = aiText?.textContent?.trim() || "";
    }
    return val;
  }

  function sanitizeDraft(text) {
    if (!text) return text;
    let t = String(text).trim();
    t = t.replace(/^dear[^\n]*\n(\s*\n)*/i, "");
    t = t.replace(/\n+\s*(yours\s+sincerely|sincerely|kind\s+regards|best\s+regards|regards)[\s\S]*$/i, "");
    t = t.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    const paras = t.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    return paras.slice(0, 3).join("\n\n").trim();
  }

  function gatherContext(form) {
    const name = [form.firstName?.value, form.lastName?.value].filter(Boolean).join(" ").trim();
    const baseTone = (form.tone?.value || "professional").trim();
    const toneAugmented = `${baseTone}; human-like and natural; concise; maximum 3 short paragraphs`;
    // IMPORTANT: read draft robustly
    const draft = sanitizeDraft(readDraftFromFormOrAI(form) || "");

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
        draft
      },
      // also provide legacy key the template might use:
      cover_body: draft
    };
  }

  // ---- PREVIEW (free) ----
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

      // refuse to inject the full builder page into itself
      if (/<form[^>]+id=["']clForm["']/i.test(html) || /cover-letter\.js/i.test(html)) {
        console.error("Server returned builder page instead of letter-only HTML");
        window.showUpgradeBanner?.("Preview temporarily unavailable. Please try again.");
        return;
      }

      const wrap  = document.getElementById("clPreviewWrap");
      const frame = document.getElementById("clPreview") || document.getElementById("letterPreview");
      if (wrap) wrap.style.display = "block";
      if (frame) {
        // sandbox to reduce extension errors inside the preview
        frame.setAttribute("sandbox", "allow-same-origin");
        frame.srcdoc = html;
      }
      window.hideUpgradeBanner?.();
    } catch (err) {
      console.warn("Cover letter preview error:", err);
    }
  }

  // ---- AI helpers (unchanged server call) ----
  function gatherCLContext(form) {
    const get = (n) => (form?.elements?.[n]?.value || "").trim();
    return {
      tone: get("tone") || "professional",
      job_url: get("jobUrl"),
      sender: {
        first_name: get("firstName"),
        last_name:  get("lastName"),
        email:      get("senderEmail"),
        phone:      get("senderPhone"),
        address1:   get("senderAddress1"),
        city:       get("senderCity"),
        postcode:   get("senderPostcode"),
        date:       get("letterDate"),
      },
      recipient: {
        name:    get("recipient") || "Hiring Manager",
        company: get("company"),
        address1:get("companyAddress1"),
        city:    get("companyCity"),
        postcode:get("companyPostcode"),
        role:    get("role"),
      }
    };
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
  window.aiSuggestCoverLetter_min = async (ctx) => aiSuggestCoverLetter(ctx);

  async function aiSuggestVariants(n = 3) {
    const form = document.getElementById("clForm");
    const ctx  = gatherCLContext(form);
    const out = [];
    for (let i=0;i<n;i++){ try { const d = await aiSuggestCoverLetter_min(ctx); if (d) out.push(d); } catch {} }
    return out;
  }

  // ---- Boot & UI ----
  document.addEventListener("DOMContentLoaded", () => {
    const form   = document.getElementById("clForm");
    const aiCard = document.getElementById("ai-cl");
    const getAiTextEl = () => aiCard?.querySelector(".ai-text");

    // AI refresh/add
    aiCard?.addEventListener("click", async (e) => {
      const btn = e.target.closest(".ai-refresh, .ai-add, [data-ai='refresh'], [data-ai='add']");
      if (!btn) return;

      if (btn.classList.contains("ai-refresh") || btn.dataset.ai === "refresh") {
        try {
          btn.disabled = true;
          const el = getAiTextEl(); if (el) el.textContent = "Thinking…";
          const draft = await aiSuggestCoverLetter_min(gatherCLContext(form));
          if (el) el.textContent = draft || "No draft yet.";
        } catch (err) {
          const el = getAiTextEl(); if (el) el.textContent = err.message || "AI failed.";
        } finally { btn.disabled = false; }
      }

      if (btn.classList.contains("ai-add") || btn.dataset.ai === "add") {
        const el = getAiTextEl();
        const draft = el ? el.textContent.trim() : "";
        const bodyEl = form?.querySelector(
          'textarea[name="body"], textarea[name="draft"], textarea[name="cover_body"], #body, #letterBody'
        );
        if (draft && bodyEl) {
          bodyEl.value = sanitizeDraft(draft);
          bodyEl.dispatchEvent(new Event("input", { bubbles: true })); // so any live bindings notice
        }
      }
    });

    // Optional "show variants" button
    document.getElementById("ai-show-variants")?.addEventListener("click", async () => {
      const box = document.querySelector("#ai-cl .ai-text"); if (!box) return;
      box.textContent = "Generating options…";
      const drafts = await aiSuggestVariants(3);
      if (!drafts.length) { box.textContent = "No suggestions."; return; }
      box.innerHTML = drafts.map((d,i)=> `<div class="option"><strong>Option ${i+1}</strong><br>${escapeHtml(d).replace(/\n/g,"<br>")}</div>`).join("<hr>");
    });

    // Preview (free)
    document.getElementById("cl-preview")?.addEventListener("click", async () => {
      try { await previewLetter(gatherContext(form)); } catch {}
    });

    // Download (gated)
    document.getElementById("cl-download")?.addEventListener("click", async () => {
      if (!form) return;
      const ctx = gatherContext(form);
      try {
        const res = await fetch("/build-cover-letter", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/pdf,application/json" },
          body: JSON.stringify({ format: "pdf", letter_only: true, ...ctx })
        });

        if (!res.ok) {
          let j=null; const ct=res.headers.get("content-type")||"";
          if (ct.includes("application/json")) { try { j=await res.json(); } catch {} }

          if ((res.status === 403 && j?.error === "upgrade_required") || res.status === 402) {
            const html = j?.message_html || `File downloads are available on Standard and Premium. <a href="${PRICING_URL}">Upgrade now →</a>`;
            window.showUpgradeBanner?.(html);
            alert(j?.message || "File downloads are available on Standard and Premium.");
            const container = document.getElementById("cl-download")?.closest(".card, .rb-card, .actions, form, #clForm") || document.getElementById("clForm");
            if (container) { // inline too
              let b = container.querySelector(".inline-banner");
              if (!b) { b = document.createElement("div"); b.className="inline-banner"; b.style.cssText="margin-top:10px;padding:10px 12px;border-radius:6px;font-size:14px;background:#fff3cd;color:#856404;border:1px solid #ffeeba"; container.appendChild(b); }
              b.innerHTML = html;
            }
            return;
          }
          window.showUpgradeBanner?.(j?.message || j?.error || "Download failed.");
          return;
        }

        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "cover-letter.pdf"; a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        window.showUpgradeBanner?.(err.message || "Download failed.");
      }
    });
  });
})();
