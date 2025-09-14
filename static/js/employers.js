// /static/js/employer.js
document.addEventListener("DOMContentLoaded", function () {
  // Always send cookies (SameSite=Lax)
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  // CSRF (Flask-WTF compatible)
  function getCookie(name) {
    const prefix = name + "=";
    return (document.cookie || "")
      .split(";")
      .map(s => s.trim())
      .find(s => s.startsWith(prefix))
      ?.slice(prefix.length) || null;
  }
  const CSRF = getCookie("csrf_token") || getCookie("XSRF-TOKEN");

  // Safe HTML
  function escapeHtml(s = "") {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Common error handler
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
      const url  = body?.pricing_url || (window.PRICING_URL || "/pricing");
      const html = body?.message_html || `${body?.message || "You’ve reached your plan limit."} <a href="${url}">Upgrade now →</a>`;
      window.upgradePrompt?.(html, url, 1200);
      throw new Error(body?.message || "Upgrade required");
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
  const inquiryForm     = document.getElementById("employer-inquiry-form");
  const jobPostForm     = document.getElementById("job-post-form");
  const output          = document.getElementById("job-description-output");
  const downloadOptions = document.getElementById("download-options");
  const dlTxtBtn        = document.getElementById("download-txt");
  const dlPdfBtn        = document.getElementById("download-pdf");

  // Render helper
  function renderDescription(text = "") {
    const content = String(text || "");
    if (window.marked?.parse) {
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
      const submitBtn = inquiryForm.querySelector('button[type="submit"]');

      const formData = new FormData(inquiryForm);
      const payload  = Object.fromEntries(formData.entries());

      try {
        submitBtn && (submitBtn.disabled = true);
        statusEl && (statusEl.textContent = "Submitting…");

        const res = await fetch("/api/employer-inquiry", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(CSRF ? { "X-CSRFToken": CSRF } : {})
          },
          body: JSON.stringify(payload),
        });

        await handleCommonErrors(res);

        const data = await res.json().catch(() => ({}));
        const ok = !!(data && (data.success || data.ok));
        statusEl && (statusEl.textContent = ok ? "✅ Inquiry submitted!" : "❌ Submission failed.");
        if (ok) inquiryForm.reset();
      } catch (error) {
        console.error("Employer Inquiry Error:", error);
        statusEl && (statusEl.textContent = `❌ ${error.message || "Something went wrong."}`);
      } finally {
        submitBtn && (submitBtn.disabled = false);
      }
    });
  }

  // ------------------------------------
  // 🤖 AI Job Post Generator – Handler
  // ------------------------------------
  let lastGenerated = "";

  if (jobPostForm && output) {
    jobPostForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const submitBtn = jobPostForm.querySelector('button[type="submit"]');
      const formData  = new FormData(jobPostForm);
      const payload   = Object.fromEntries(formData.entries());

      try {
        submitBtn && (submitBtn.disabled = true);
        output.innerHTML = '<div class="spinner" aria-live="polite">Generating…</div>';

        const res = await fetch("/api/employer/job-post", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(CSRF ? { "X-CSRFToken": CSRF } : {})
          },
          body: JSON.stringify(payload),
        });

        await handleCommonErrors(res);

        const data = await res.json().catch(() => ({}));
        const text = data?.description || data?.text || "";
        lastGenerated = text;
        output.innerHTML = renderDescription(text);
        downloadOptions?.classList.remove("hidden");
      } catch (err) {
        console.error("Job post generator error:", err);
        output.innerHTML = `<div class="error">❌ ${escapeHtml(err.message || "Could not generate description.")}</div>`;
        downloadOptions?.classList.add("hidden");
      } finally {
        submitBtn && (submitBtn.disabled = false);
      }
    });
  }

  // -------------------
  // ⬇️ Download buttons
  // -------------------
  dlTxtBtn?.addEventListener("click", () => {
    const blob = new Blob([lastGenerated || ""], { type: "text/plain" });
    saveAs(blob, "job-description.txt");
  });

  dlPdfBtn?.addEventListener("click", () => {
    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      const lines = pdf.splitTextToSize((lastGenerated || ""), 180);
      let y = 15;
      lines.forEach(line => {
        if (y > 280) { pdf.addPage(); y = 15; }
        pdf.text(line, 15, y);
        y += 7;
      });
      pdf.save("job-description.pdf");
    } catch (e) {
      alert("PDF download failed.");
    }
  });
});
