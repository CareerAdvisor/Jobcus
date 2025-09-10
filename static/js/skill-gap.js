// /static/skill-gap.js
(function () {
  // Always send cookies with fetch (SameSite=Lax)
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  function escapeHtml(s = "") {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Centralized error handler — handle upgrade BEFORE generic 401/403
  async function handleCommonErrors(res) {
    if (res.ok) return null;

    const ct = res.headers.get("content-type") || "";
    let body = null;
    let rawText = "";
    try {
      if (ct.includes("application/json")) {
        body = await res.json();
      } else {
        rawText = await res.text();
      }
    } catch { body = null; }

    // ---- Upgrade / quota exceeded FIRST (covers 402 or 403 with upgrade_required) ----
    if (res.status === 402 || (body?.error === "upgrade_required")) {
      const html = body?.message_html;
      const text = body?.message || "You’ve reached your plan limit. Upgrade to continue.";
      window.showUpgradeBanner?.(html || text);  // sticky banner supports HTML links
      throw new Error(text);
    }

    // ---- Auth required (true 401/403 without upgrade flag) ----
    if (res.status === 401 || res.status === 403) {
      const msg = (body && body.message) || "Please sign up or log in to use this feature.";
      window.showUpgradeBanner?.(msg);
      setTimeout(() => { window.location.href = "/account?mode=login"; }, 800);
      throw new Error(msg);
    }

    // Abuse guard (network/device)
    if (res.status === 429 && body && (body.error === "too_many_free_accounts" || body.error === "device_limit")) {
      const msg = (body && body.message) || "Too many free accounts detected from your network/device.";
      window.showUpgradeBanner?.(msg);
      throw new Error(msg);
    }

    const msg = (body && body.message) || `Request failed (${res.status})`;
    throw new Error(msg);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form        = document.getElementById("skillGapForm");
    const goalInput   = document.getElementById("goal");
    const skillsInput = document.getElementById("skills");
    const resultBox   = document.getElementById("gapResult");

    if (!form || !goalInput || !skillsInput || !resultBox) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const goal   = (goalInput.value || "").trim();
      const skills = (skillsInput.value || "").trim();

      if (!goal || !skills) {
        resultBox.innerHTML = "⚠️ Please enter both your career goal and current skills.";
        resultBox.classList.add("show");
        return;
      }

      // Animated loading
      resultBox.innerHTML = '<span class="typing">Analyzing skill gaps<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>';
      resultBox.classList.remove("show");
      void resultBox.offsetWidth;
      resultBox.classList.add("show");

      try {
        const res = await fetch("/api/skill-gap", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({ goal, skills })
        });

        await handleCommonErrors(res);

        const ct = res.headers.get("content-type") || "";
        let data;
        if (ct.includes("application/json")) {
          data = await res.json().catch(() => ({}));
        } else {
          const txt = await res.text().catch(() => "");
          data = { result: txt };
        }

        const output = data.result || data.reply || data.message || "";
        if (!output) {
          resultBox.innerHTML = "⚠️ No result returned. Please try again.";
          return;
        }

        if (window.marked && typeof window.marked.parse === "function") {
          resultBox.innerHTML = '<div class="ai-response">' + window.marked.parse(String(output)) + "</div>";
        } else {
          resultBox.innerHTML = '<div class="ai-response"><pre>' + escapeHtml(String(output)) + "</pre></div>";
        }
      } catch (err) {
        console.error("Skill Gap Error:", err);
        const msg = err && err.message ? err.message : "Something went wrong. Please try again later.";
        resultBox.innerHTML = "❌ " + escapeHtml(msg);
      }
    });
  });
})();
