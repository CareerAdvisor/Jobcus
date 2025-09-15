// /static/js/employers.js
document.addEventListener("DOMContentLoaded", function () {
  /* Ensure cookies are sent (SameSite=Lax) */
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  /* Small helpers */
  function escapeHtml(s = "") {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function handleCommonErrors(res) {
    if (res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    let body = null;
    try { body = ct.includes("application/json") ? await res.json() : { message: await res.text() }; }
    catch { body = null; }

    // Auth
    if (res.status === 401 || res.status === 403) {
      const msg = body?.message || "Please sign in to continue.";
      window.showUpgradeBanner?.(msg);
      setTimeout(() => { window.location.href = "/account?mode=login"; }, 800);
      throw new Error(msg);
    }

    // Upgrade/quota
    if (res.status === 402 || (res.status === 403 && body?.error === "upgrade_required")) {
      const url  = body?.pricing_url || (window.PRICING_URL || "/pricing");
      const msg  = body?.message || "You’ve reached your plan limit. Upgrade to continue.";
      const html = body?.message_html || `${escapeHtml(msg)} <a href="${url}">Upgrade now →</a>`;
      (window.upgradePrompt || window.showUpgradeBanner || alert)(html);
      if (window.upgradePrompt) window.upgradePrompt(html, url, 1200);
      throw new Error(msg);
    }

    // Abuse guard
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
  const dlBox           = document.getElementById("download-options");
  const dlTxtBtn        = document.getElementById("download-txt");
  const dlPdfBtn        = document.getElementById("download-pdf");

  // helper to extract plain text from the output box
  function getJobText() {
    // If you render plain text inside <div>, innerText preserves line-breaks
    return (output?.innerText || "").trim();
  }
  
  // unified download call
  async function downloadJD(fmt) {
    const text = getJobText();
    if (!text) { alert("Generate a job description first."); return; }
  
    const res = await fetch("/api/employer/job-post/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ format: fmt, text })
    });
  
    // Gate: not upgraded
    if (res.status === 403) {
      let info = null;
      try { info = await res.json(); } catch {}
      const url  = info?.pricing_url || (window.PRICING_URL || "/pricing");
      const html = info?.message_html || `File downloads are available on Standard and Premium. <a href="${url}">Upgrade now →</a>`;
      window.upgradePrompt?.(html, url, 1200);  // centered modal + timed redirect
      return;
    }
  
    // Not signed in (Flask-Login may redirect to HTML page)
    if (res.status === 401 || res.redirected) {
      window.location.href = "/account?mode=login";
      return;
    }
  
    if (!res.ok) {
      const msg = (await res.text()) || "Download failed.";
      window.showUpgradeBanner?.(msg);
      return;
    }
  
    // Success: stream file to user
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (fmt === "pdf") ? "job-description.pdf" : "job-description.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }
  
  // bind buttons
  dlTxtBtn?.addEventListener("click", () => downloadJD("txt"));
  dlPdfBtn?.addEventListener("click", () => downloadJD("pdf"));

  // ----------------------------
  // 📨 Employer Inquiry Handler
  // ----------------------------
  if (inquiryForm) {
    inquiryForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      const statusEl = document.getElementById("inquiry-response");
      const endpoint = inquiryForm.dataset.endpoint; // injected by Jinja
      if (!endpoint) {
        console.error("No employer inquiry endpoint on form.");
        if (statusEl) statusEl.innerText = "❌ Missing endpoint.";
        return;
      }

      const payload = Object.fromEntries(new FormData(inquiryForm).entries());
      statusEl && (statusEl.innerText = "Sending…");

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        await handleCommonErrors(res);

        const data = await res.json().catch(() => ({}));
        const ok = !!(data && (data.success || data.ok || data.status === "ok"));
        statusEl && (statusEl.innerText = ok ? "✅ Inquiry submitted!" : "❌ Submission failed.");
        if (ok) inquiryForm.reset();
      } catch (error) {
        console.error("Employer Inquiry Error:", error);
        statusEl && (statusEl.innerText = `❌ ${error.message || "Something went wrong."}`);
      }
    });
  }

  // ----------------------------------
  // 🤖 AI Job Post Generator Handler
  // ----------------------------------
  if (jobPostForm) {
    jobPostForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      const endpoint = jobPostForm.dataset.endpoint; // injected by Jinja
      if (!endpoint) {
        console.error("No job-post endpoint on form.");
        output.innerHTML = `<div class="ai-response">❌ Missing endpoint.</div>`;
        return;
      }

      const payload = Object.fromEntries(new FormData(jobPostForm).entries());
      output.innerHTML = "Generating…";
      dlBox && (dlBox.style.display = "none");

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        await handleCommonErrors(res);

        const data = await res.json().catch(() => ({}));
        const text = data?.description || data?.jobDescription || "";

        if (text) {
          output.innerHTML = `<pre style="white-space:pre-wrap;margin:0">${escapeHtml(text)}</pre>`;
          dlBox && (dlBox.style.display = "");
        } else {
          output.innerHTML = `<div class="ai-response">No content returned.</div>`;
          dlBox && (dlBox.style.display = "none");
        }
      } catch (err) {
        console.error("Job Post Error:", err);
        output.innerHTML = `<div class="ai-response">❌ ${escapeHtml(err.message || "Something went wrong.")}</div>`;
        dlBox && (dlBox.style.display = "none");
      }
    });
  }

  // -----------------
  // ⬇️ Downloaders
  // -----------------
  function readOutputText() {
    const pre = output?.querySelector("pre");
    if (pre) return pre.innerText || pre.textContent || "";
    return output?.innerText || "";
  }

  dlTxtBtn?.addEventListener("click", () => {
    const txt = readOutputText();
    if (!txt.trim()) return alert("Nothing to download yet.");
    const blob = new Blob([txt], { type: "text/plain" });
    saveAs(blob, "job-description.txt");
  });

  dlPdfBtn?.addEventListener("click", () => {
    const txt = readOutputText();
    if (!txt.trim()) return alert("Nothing to download yet.");
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) return alert("PDF library not loaded.");
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const lines = pdf.splitTextToSize(txt, 180);
    let y = 10;
    lines.forEach(line => {
      if (y > 280) { pdf.addPage(); y = 10; }
      pdf.text(line, 10, y);
      y += 7;
    });
    pdf.save("job-description.pdf");
  });
});
