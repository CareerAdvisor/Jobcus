// /static/js/interview-coach.js
"use strict";

// Always send cookies with fetch (SameSite=Lax)
(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

// ───────────────────────────────────────────────
// Watermark helpers (email-safe + strip fallbacks)
// ───────────────────────────────────────────────
const __EMAIL_RE__ = /@.+\./;
function __sanitizeWM__(t) {
  const raw = String(t || "").trim();
  return (!raw || __EMAIL_RE__.test(raw)) ? "JOBCUS.COM" : raw;
}
function __stripWatermarks__(root = document) {
  // Prefer the global helper from base.js if available
  if (typeof window.stripExistingWatermarks === "function") {
    try { window.stripExistingWatermarks(root); return; } catch {}
  }
  // Local fallback: nuke bg images & pseudo elements + known attrs/classes
  try {
    const doc = (root.ownerDocument || root);
    if (doc && !doc.getElementById("wm-nuke-style")) {
      const st = doc.createElement("style");
      st.id = "wm-nuke-style";
      st.textContent = `
        * { background-image: none !important; }
        *::before, *::after { background-image: none !important; content: '' !important; }
      `;
      (doc.head || doc.documentElement).appendChild(st);
    }
    (root.querySelectorAll
      ? root.querySelectorAll("[data-watermark], [data-watermark-tile], .wm-tiled, [style*='background-image']")
      : []
    ).forEach(el => {
      el.removeAttribute?.("data-watermark");
      el.removeAttribute?.("data-watermark-tile");
      el.classList?.remove("wm-tiled");
      if (el.style) {
        el.style.backgroundImage = "";
        el.style.backgroundSize = "";
        el.style.backgroundBlendMode = "";
      }
    });
  } catch {}
}
function __applyWatermark__(el, text = "JOBCUS.COM", opts = { size: 460, alpha: 0.16, angles: [-32, 32] }) {
  text = __sanitizeWM__(text);
  if (!el || !text) return;
  // Prefer global from base.js
  if (typeof window.applyTiledWatermark === "function") {
    __stripWatermarks__(el);
    window.applyTiledWatermark(el, text, opts);
    return;
  }
  // Local minimal tiler fallback
  __stripWatermarks__(el);
  const size = opts.size || 420;
  const angles = Array.isArray(opts.angles) && opts.angles.length ? opts.angles : [-32, 32];
  function makeTile(t, angle, alpha = 0.18) {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    ctx.clearRect(0,0,size,size);
    ctx.globalAlpha = (opts.alpha ?? alpha);
    ctx.translate(size/2, size/2);
    ctx.rotate((angle * Math.PI)/180);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = 'bold 36px Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
    ctx.fillStyle = "#000";
    const L = String(t).toUpperCase();
    const gap = 44;
    ctx.fillText(L, 0, -gap/2);
    ctx.fillText(L, 0,  gap/2);
    return c.toDataURL("image/png");
  }
  const urls = angles.map(a => makeTile(text, a));
  const sz = size + "px " + size + "px";
  el.classList.add("wm-tiled");
  el.style.backgroundImage = urls.map(u => `url(${u})`).join(", ");
  el.style.backgroundSize = urls.map(() => sz).join(", ");
  el.style.backgroundBlendMode = "multiply, multiply";
  el.style.backgroundRepeat = "repeat";
}

// Simple HTML escaper to keep dynamic content safe
function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Centralized error handling (auth/limits/abuse)
async function handleCommonErrors(res) {
  if (res.ok) return null;

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  let body = null;
  let text = "";
  try {
    if (ct.includes("application/json")) body = await res.json();
    else text = await res.text();
  } catch {}

  if (text && /<html/i.test(text)) text = "";

  // Auth required
  if (res.status === 401 || res.status === 403) {
    const msg = (body && body.message) || "Please sign up or log in to use this feature.";
    window.showUpgradeBanner?.(msg);
    setTimeout(() => { window.location.href = "/account?mode=login"; }, 800);
    throw new Error(msg);
  }

  // Plan limits / upgrade
  if (res.status === 402 || (body && body.error === "upgrade_required")) {
    const html = body?.message_html;
    const msg  = body?.message || "You’ve reached your plan limit. Upgrade to continue.";
    window.showUpgradeBanner?.(html || msg);
    throw new Error(msg);
  }

  // Abuse
  if (res.status === 429 && body && body.error === "too_many_free_accounts") {
    const msg = body.message || "Too many free accounts detected from your network/device.";
    window.showUpgradeBanner?.(msg);
    throw new Error(msg);
  }

  const fallback = (body && (body.message || body.error)) || text || `Request failed (${res.status})`;
  throw new Error(fallback);
}

// Shared POST helper
async function apiPost(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(payload),
  });
  await handleCommonErrors(res);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json().catch(() => ({}))) || {};
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

  // history UI
  const historyContainer = document.getElementById("history-container");
  const historyPanel     = document.getElementById("historyPanel");
  const historyContent   = document.getElementById("historyContent");
  const toggleHistoryBtn = document.getElementById("toggle-history-btn");

  const sessionSection   = document.querySelector(".interview-session");

  // 🔹 Your requested preview-wrap delayed watermark (for the optional iframe preview)
  const coachWrap  = document.getElementById("coachWrap");
  const coachFrame = document.getElementById("coachPreview");

  function loadCoachPreview(htmlOrUrl) {
    coachWrap?.classList.remove("wm-active"); // hide overlay until content is ready
    if (htmlOrUrl?.startsWith("<")) {
      coachFrame.srcdoc = htmlOrUrl;
    } else {
      coachFrame.src = htmlOrUrl || "about:blank";
    }
    coachFrame.addEventListener("load", () => {
      if (coachWrap?.dataset?.watermark) coachWrap.classList.add("wm-active");
      try {
        const d = coachFrame.contentDocument || coachFrame.contentWindow?.document;
        if (d?.body && window.applyTiledWatermark) {
          window.applyTiledWatermark(d.body, coachWrap.dataset.watermark, { size: 360, alpha: 0.12, angle: -28 });
        }
      } catch {}
    }, { once: true });
  }
  // expose if you want to call it elsewhere:
  window.loadCoachPreview = loadCoachPreview;

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

    // Reset UI
    if (feedbackBox) { feedbackBox.style.display = "none"; feedbackBox.innerHTML = ""; }
    if (suggestionsBox) { suggestionsBox.style.display = "none"; suggestionsBox.innerHTML = ""; }
    if (answerInput) answerInput.value = "";

    // Loading state
    setLive(questionBox, '<em>🤖 Generating a new interview question...</em>');
    if (questionBox) questionBox.setAttribute("aria-busy", "true");
    setBusy(nextBtn, true);

    try {
      const res = await fetch("/api/interview/question", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ previousRole, targetRole, experience })
      });

      await handleCommonErrors(res);

      const data = await res.json().catch(() => ({}));
      currentQuestion = (data && data.question)
        ? data.question
        : "Please sign up or log in to use this feature.";

      setLive(questionBox, '<strong>🗨️ ' + escapeHtml(currentQuestion) + '</strong>');
      try { window.syncState?.({ interview_last_q: currentQuestion }); } catch {}
    } catch (err) {
      console.error("Question fetch error:", err);
      const msg = (err && err.message) ? err.message : "Error fetching interview question.";
      setLive(questionBox, "⚠️ " + escapeHtml(msg));
    } finally {
      if (questionBox) questionBox.setAttribute("aria-busy", "false");
      setBusy(nextBtn, false);
      ensureVisible(questionBox);
      if (answerInput) answerInput.focus();
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

        // Feedback (Markdown if available; fallback to <pre>)
        if (data?.feedback) {
          const html = (window.marked?.parse)
            ? `<div class="ai-response">${window.marked.parse(String(data.feedback))}</div>`
            : `<div class="ai-response"><pre>${escapeHtml(String(data.feedback))}</pre></div>`;
          setLive(feedbackBox, html);
        } else {
          setLive(feedbackBox, "<em>No feedback returned.</em>");
        }

        // Enforce watermark rules on paid features:
        const plan = (document.body.dataset.plan || "guest").toLowerCase();
        const isPaid = (plan === "standard" || plan === "premium");
        const isSuperadmin = document.body.dataset.superadmin === "1";

        if (feedbackBox) {
          __stripWatermarks__(feedbackBox);
          if (!isPaid && !isSuperadmin) {
            __applyWatermark__(feedbackBox, "JOBCUS.COM", { size: 460, alpha: 0.16, angles: [-32, 32] });
            // nocopy + key guards for free users
            feedbackBox.classList.add("nocopy");
            const kill = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
            ["copy","cut","dragstart","contextmenu","selectstart"].forEach(ev =>
              feedbackBox.addEventListener(ev, kill, { passive: false })
            );
            document.addEventListener("keydown", (ev) => {
              const k = (ev.key || "").toLowerCase();
              if ((ev.ctrlKey || ev.metaKey) && ["c","x","s","p"].includes(k)) return kill(ev);
              if (k === "printscreen") return kill(ev);
            }, { passive: false });
          }
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

        // Save to history (only update content; DON'T show it)
        history.push({
          question: currentQuestion,
          answer,
          feedback: data?.feedback || "",
          tips,
        });

        renderHistory();
        suggestionsBox.style.display = "block";
        feedbackBox.style.display = "block";

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

  // Render the Q&A history panel (Markdown → HTML) but DO NOT change its visibility
  function renderHistory() {
    if (!historyContainer || !historyContent) return;
    if (!history.length) {
      historyContent.innerHTML = "<p>No history yet.</p>";
      return;
    }

    const entriesHtml = history.map((entry, idx) => {
      const feedbackHtml = (window.marked?.parse)
        ? window.marked.parse(String(entry.feedback || ""))
        : `<pre>${escapeHtml(String(entry.feedback || ""))}</pre>`;
      const tipsHtml = entry.tips?.length
        ? `<p><strong>Tips:</strong></p><ul>${entry.tips.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`
        : "";

      return `
        <div class="history-entry">
          <h4>Question ${idx + 1}</h4>
          <p><strong>Q:</strong> ${escapeHtml(entry.question)}</p>
          <p><strong>Your Answer:</strong> ${escapeHtml(entry.answer)}</p>
          <p><strong>Feedback:</strong></p>
          <div class="ai-response">${feedbackHtml}</div>
          ${tipsHtml}
        </div>
      `;
    }).join("");

    document.getElementById('historyContent').innerHTML = entriesHtml;
  }

  // Toggle history visibility
  if (toggleHistoryBtn && historyContainer) {
    toggleHistoryBtn.addEventListener("click", () => {
      const isVisible = historyContainer.style.display === "block";
      historyContainer.style.display = isVisible ? "none" : "block";
      toggleHistoryBtn.textContent = isVisible ? "📜 Show History" : "🙈 Hide History";
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
