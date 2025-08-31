// /static/js/interview-coach.js

// Always send cookies with fetch (SameSite=Lax)
(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

// Simple HTML escaper to keep dynamic content safe
function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Centralized error handling consistent with other pages
async function handleCommonErrors(res) {
  if (res.ok) return null;

  const ct = res.headers.get("content-type") || "";
  let data = null;
  try {
    if (ct.includes("application/json")) {
      data = await res.json();
    } else {
      const txt = await res.text();
      data = txt ? { message: txt } : null;
    }
  } catch {
    data = null;
  }

  const msg =
    data?.message ||
    data?.error ||
    `Request failed (${res.status})`;

  // Auth required
  if (res.status === 401 || res.status === 403) {
    // Distinguish upgrade_required vs auth
    if (data?.error === "upgrade_required") {
      window.showUpgradeBanner?.(msg || "This feature requires a paid plan.");
      throw new Error(msg);
    }
    // default to login flow
    window.showUpgradeBanner?.(msg || "Please sign in to continue.");
    setTimeout(() => { window.location.href = "/account?mode=login"; }, 800);
    throw new Error(msg);
  }

  // Plan limits
  if (res.status === 402 || data?.error === "upgrade_required") {
    window.showUpgradeBanner?.(msg || "You’ve reached your plan limit. Upgrade to continue.");
    throw new Error(msg);
  }

  // Abuse guard (network/device)
  if (res.status === 429 && (data?.error === "too_many_free_accounts" || data?.error === "device_limit")) {
    window.showUpgradeBanner?.(msg || "Too many free accounts detected from your network/device.");
    throw new Error(msg);
  }

  throw new Error(msg);
}

// Shared API helper (POST JSON + shared error branches)
async function apiPost(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  await handleCommonErrors(res);

  // prefer JSON; tolerate empty/text
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return (await res.json().catch(() => ({}))) || {};
  }
  const txt = await res.text().catch(() => "");
  try { return JSON.parse(txt); } catch { return { message: txt || null }; }
}

// Keep a local session history (Q/A pairs + feedback)
const history = [];

document.addEventListener("DOMContentLoaded", () => {
  const roleForm         = document.getElementById("interview-role-form");
  const form             = document.getElementById("user-response-form");
  const answerInput      = document.getElementById("userAnswer");
  const questionBox      = document.getElementById("ai-question");
  const feedbackBox      = document.getElementById("feedback-box");
  const suggestionsBox   = document.getElementById("suggestions-box");
  const nextBtn          = document.getElementById("next-question-btn");
  const historyContainer = document.getElementById("history-container");
  const toggleHistoryBtn = document.getElementById("toggle-history-btn");
  const sessionSection   = document.querySelector(".interview-session");

  let currentQuestion = "";
  let previousRole    = "";
  let targetRole      = "";
  let experience      = "";
  let asking          = false;

  // Small helpers
  function setBusy(el, busy) {
    if (!el) return;
    el.disabled = !!busy;
    el.setAttribute("aria-busy", busy ? "true" : "false");
  }
  function setLive(el, html) {
    if (!el) return;
    el.innerHTML = html;
  }
  function ensureVisible(el) {
    try { el?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
  }

  async function getNextQuestion() {
    if (asking) return;
    asking = true;

    // Reset UI areas
    if (feedbackBox) { feedbackBox.style.display = "none"; setLive(feedbackBox, ""); }
    if (suggestionsBox) { suggestionsBox.style.display = "none"; setLive(suggestionsBox, ""); }
    if (answerInput) answerInput.value = "";

    // Loading state
    setLive(questionBox, "<em>🤖 Generating a new interview question...</em>");
    questionBox?.setAttribute("aria-busy", "true");
    setBusy(nextBtn, true);

    try {
      const data = await apiPost("/api/interview/question", {
        previousRole,
        targetRole,
        experience,
      });

      currentQuestion = data?.question || "Sorry, no question returned.";
      setLive(questionBox, `<strong>🗨️ ${escapeHtml(currentQuestion)}</strong>`);

      // best-effort telemetry
      try { window.syncState?.({ interview_last_q: currentQuestion }); } catch {}
    } catch (err) {
      console.error("Question fetch error:", err);
      setLive(questionBox, "⚠️ Error fetching interview question.");
    } finally {
      questionBox?.setAttribute("aria-busy", "false");
      setBusy(nextBtn, false);
      ensureVisible(questionBox);
      answerInput?.focus();
      asking = false;
    }
  }

  // Start the interview after role form submission
  if (roleForm) {
    roleForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const prev = document.getElementById("previousRole")?.value.trim();
      const targ = document.getElementById("targetRole")?.value.trim();
      const exp  = document.getElementById("experience")?.value;

      if (!prev || !targ || !exp) {
        alert("Please fill in your previous role, target role, and experience level.");
        return;
      }

      previousRole = prev;
      targetRole   = targ;
      experience   = exp;

      // Reveal the live session & first question
      if (sessionSection) sessionSection.style.display = "block";
      if (form) form.style.display = "block";

      await getNextQuestion();
    });
  }

  // Submit an answer → get feedback
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"]');
      const answer = (answerInput?.value || "").trim();
      if (!answer) return;

      setLive(feedbackBox, "<em>⏳ Analyzing your answer...</em>");
      feedbackBox.style.display = "block";
      suggestionsBox.style.display = "none";
      setBusy(submitBtn, true);

      try {
        const data = await apiPost("/api/interview/feedback", {
          question: currentQuestion,
          answer,
          previousRole,
          targetRole,
          experience,
        });

        // Feedback (escaped, but keep formatting in <pre>)
        if (data?.feedback) {
          setLive(
            feedbackBox,
            `<div class="ai-response"><pre>${escapeHtml(data.feedback)}</pre></div>`
          );
        } else {
          setLive(feedbackBox, "<em>No feedback returned.</em>");
        }

        // Optional tips
        const tips = Array.isArray(data?.fallbacks) ? data.fallbacks : [];
        if (tips.length) {
          suggestionsBox.style.display = "block";
          setLive(
            suggestionsBox,
            `<h4>💡 Suggested Tips:</h4><ul>${
              tips.map(t => `<li>${escapeHtml(t)}</li>`).join("")
            }</ul>`
          );
        }

        // Save to history
        history.push({
          question: currentQuestion,
          answer,
          feedback: data?.feedback || "",
          tips,
        });
        renderHistory();
        ensureVisible(feedbackBox);

        // best-effort telemetry
        try {
          window.syncState?.({
            interview_qas: history.length,
            interview_last_feedback_len: (data?.feedback || "").length
          });
        } catch {}
      } catch (err) {
        console.error("Feedback error:", err);
        setLive(feedbackBox, `❌ ${escapeHtml(err.message || "Error analyzing your answer.")}`);
        feedbackBox.style.display = "block";
      } finally {
        setBusy(submitBtn, false);
      }
    });
  }

  // Render the Q&A history panel
  function renderHistory() {
    if (!historyContainer) return;
    if (!history.length) {
      historyContainer.innerHTML = "<p>No history yet.</p>";
      return;
    }
    historyContainer.innerHTML = history
      .map((entry, idx) => {
        const tipsHtml = entry.tips?.length
          ? `<p><strong>Tips:</strong><ul>${entry.tips
              .map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul></p>`
          : "";
        return `
          <div class="history-entry">
            <h4>Question ${idx + 1}</h4>
            <p><strong>Q:</strong> ${escapeHtml(entry.question)}</p>
            <p><strong>Your Answer:</strong> ${escapeHtml(entry.answer)}</p>
            <p><strong>Feedback:</strong></p>
            <pre>${escapeHtml(entry.feedback)}</pre>
            ${tipsHtml}
          </div>
        `;
      })
      .join("");
  }

  // Toggle history visibility
  if (toggleHistoryBtn && historyContainer) {
    toggleHistoryBtn.addEventListener("click", () => {
      const isVisible = historyContainer.style.display === "block";
      historyContainer.style.display = isVisible ? "none" : "block";
      toggleHistoryBtn.textContent = isVisible ? "📜 Show History" : "🙈 Hide History";
      if (!isVisible) ensureVisible(historyContainer);
    });
  }

  // Next question
  if (nextBtn) {
    nextBtn.addEventListener("click", async () => {
      if (answerInput) answerInput.value = "";
      await getNextQuestion();
    });
  }
});
