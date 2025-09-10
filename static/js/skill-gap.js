// /static/skill-gap.js
(function () {
  // Always send cookies with fetch (SameSite=Lax)
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  // Simple escaper
  function escapeHtml(s = "") {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Centralized server-response handling (auth/limits/abuse)
  async function handleCommonErrors(res) {
    if (res.ok) return null;
  
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let bodyText = "";
    let bodyJson = null;
  
    try {
      if (ct.includes("application/json")) {
        bodyJson = await res.json();
      } else {
        bodyText = await res.text();
      }
    } catch {}
  
    // If it’s an API AUTH error, show a friendly message and DO NOT pass HTML through
    if (res.status === 401 || res.status === 403) {
      const msg = body?.message || 
        "Please **sign up or log in** to use this feature.";
      // optional: kick to login
      window.showUpgradeBanner?.(msg);
      setTimeout(() => { window.location.href = "/account?mode=login"; }, 800);
      throw new Error(msg);
    }
  
    // Don’t surface raw HTML to the user
    if (bodyText && /<html/i.test(bodyText)) {
      bodyText = ""; // discard noisy HTML
    }
  
    // Plan limits / feature gating
    if (res.status === 402 || (bodyJson && bodyJson.error === "upgrade_required")) {
      const msg = (bodyJson && bodyJson.message) || "You’ve reached your plan limit. Upgrade to continue.";
      window.showUpgradeBanner?.(msg);
      throw new Error(msg);
    }

    // Abuse guard (free network/device)
    if (res.status === 429 && bodyJson && bodyJson.error === "too_many_free_accounts") {
      const msg = bodyJson.message || "Too many free accounts detected from your network/device.";
      window.showUpgradeBanner?.(msg);
      throw new Error(msg);
    }
  
    const msg = (bodyJson && (bodyJson.message || bodyJson.error)) || bodyText || `Request failed (${res.status})`;
    throw new Error(msg);
  }


  document.addEventListener("DOMContentLoaded", () => {
    const form       = document.getElementById("skillGapForm");
    const goalInput  = document.getElementById("goal");
    const skillsInput= document.getElementById("skills");
    const resultBox  = document.getElementById("gapResult");

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

      // Show animated loading dots
      resultBox.innerHTML = `<span class="typing">Analyzing skill gaps<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>`;
      resultBox.classList.remove("show");
      void resultBox.offsetWidth; // Force reflow
      resultBox.classList.add("show");

      const res = await fetch("/api/skill-gap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"      // <— add this
        },
        body: JSON.stringify({ goal, skills })
      });

        await handleCommonErrors(res);

        // Prefer JSON; gracefully handle text
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

        // If you load marked.js on the page, render markdown; otherwise escape into <pre>
        if (window.marked && typeof window.marked.parse === "function") {
          resultBox.innerHTML = `<div class="ai-response">${window.marked.parse(String(output))}</div>`;
        } else {
          resultBox.innerHTML = `<div class="ai-response"><pre>${escapeHtml(String(output))}</pre></div>`;
        }
      } catch (err) {
        console.error("Skill Gap Error:", err);
        // handleCommonErrors already showed any banners; surface message to user
        resultBox.innerHTML = `❌ ${escapeHtml(err.message || "Something went wrong. Please try again later.")}`;
      }
    });
  });
})();
