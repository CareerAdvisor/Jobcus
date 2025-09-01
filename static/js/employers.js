// /static/js/employer.js
document.addEventListener("DOMContentLoaded", function () {
  // Ensure cookies are sent (SameSite=Lax)
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  // Safe HTML
  function escapeHtml(s = "") {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Unified server error handling (auth/limits/abuse)
  async function handleCommonErrors(res) {
    if (res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    let body = null;
    try { body = ct.includes("application/json") ? await res.json() : { message: await res.text() }; }
    catch { body = null; }

    if (res.status === 401 || res.status === 403) {
      const msg = body?.message || "Please sign in to continue.";
      window.showUpgradeBanner?.(msg);
      setTimeout(() => { window.location.href = "/account?mode=login"; }, 800);
      throw new Error(msg);
    }

    if (res.status === 402 || (res.status === 403 && body?.error === "upgrade_required")) {
      const msg = body?.message || "You’ve reached your plan limit. Upgrade to continue.";
      window.showUpgradeBanner?.(msg);
      throw new Error(msg);
    }

    if (res.status === 429 && body?.error === "too_many_free_accounts") {
      const msg = body?.message || "You have reached the limit for the free version, upgrade to enjoy more features";
      window.showUpgradeBanner?.(msg);
      throw new Error(msg);
    }

    const msg = body?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }

  // Elements
  window.docx = window.docx || window["docx"]; // (kept if you later add .docx export)
  const inquiryForm     = document.getElementById("employer-inquiry-form");
  const jobPostForm     = document.getElementById("job-post-form");
  const output          = document.getElementById("job-description-output");
  const downloadOptions = document.getElementById("download-options");
  const dlTxtBtn        = document.getElementById("download-txt");
  const dlPdfBtn        = document.getElementById("download-pdf");

  // Helper: render description safely (markdown if available, else escaped + <br>)
  function renderDescription(text = "") {
    const content = String(text || "");
    if (window.marked && typeof window.marked.parse === "function") {
      // If you’re worried about HTML in markdown, escape first:
      const escaped = escapeHtml(content);
      return `<div class="ai-response">${window.marked.parse(escaped)}</div>`;
    }
    return `<div class="ai-response"><p>${escapeHtml(content).replace(/\n/g, "<br>")}</p></div>`;
    }

  // ----------------------------
  // 📨 Employer Inquiry Handler
  // ----------------------------
  if (inquiryForm) {
    inquiryForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      const statusEl = document.getElementById("inquiry-response");
      const formData = new FormData(inquiryForm);
      const payload  = Object.fromEntries(formData.entries());

      try {
        const res = await fetch("/api/employer-inquiry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        await handleCommonErrors(res);

        const data = await res.json().catch(() => ({}));
        const ok = !!(data && (data.success || data.ok));
        if (statusEl) statusEl.innerText = ok ? "✅ Inquiry submitted!" : "❌ Submission failed.";
      } catch (error) {
        console.error("Employer Inquiry Error:", error);
        if (statusEl) statusEl.innerText = `❌ ${error.message || "Something went wrong."}`;
      }
    });
  }

  // ----------------------------
