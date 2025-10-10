// /static/js/chat.js

// ——— Safe global for inline onclick="insertSuggestion(...)" ———
window.insertSuggestion ||= function (text) {
  const el = document.getElementById('userInput');
  if (!el) return;
  el.value = text;
  el.focus();
  window.autoResize?.(el);
};

// ──────────────────────────────────────────────────────────────
// Ensure cookies (SameSite/Lax) are sent on all fetches
// ──────────────────────────────────────────────────────────────
(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

// ──────────────────────────────────────────────────────────────
/** Small utilities (now also exposed on window for inline handlers) */
// ──────────────────────────────────────────────────────────────
function removeWelcome() {
  const banner = document.getElementById("welcomeBanner");
  if (banner) banner.remove();
}
function insertSuggestion(text) {
  const input = document.getElementById("userInput");
  if (!input) return;
  input.value = text;
  input.focus();
  window.autoResize?.(input);
}
function autoResize(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}
function sharePage() {
  navigator.clipboard.writeText(window.location.href);
  alert("Link copied!");
}
function handleMic()   { alert("Voice input coming soon!"); }
function handleAttach(){ alert("File upload coming soon!"); }

function copyToClipboard(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = el.innerText;
  navigator.clipboard.writeText(text).then(() => {
    const wrapper = el.parentElement.querySelector(".copy-wrapper");
    if (!wrapper) return;
    wrapper.innerHTML = `<span class="copied-msg">Copied!</span>`;
    setTimeout(() => {
      wrapper.innerHTML = `
        <img src="/static/icons/copy.svg" class="copy-icon" title="Copy" onclick="copyToClipboard('${id}')">
        <span class="copy-text">Copy</span>
      `;
    }, 1500);
  });
}

function scrollToAI(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}
function maybeShowScrollIcon() {
  const chatboxEl = document.getElementById("chatbox");
  const scrollIcon = document.getElementById("scrollDown");
  if (!chatboxEl || !scrollIcon) return;
  scrollIcon.style.display =
    chatboxEl.scrollHeight > chatboxEl.clientHeight + 20 ? "block" : "none";
}

// NEW: always snap the chat view to the latest message
function scrollToBottom() {
  const box = document.getElementById("chatbox");
  if (!box) return;
  box.scrollTop = box.scrollHeight;
}

// Minimal helpers your old code referenced
function showUpgradeBanner(msg) {
  let b = document.getElementById("upgradeBanner");
  if (!b) {
    b = document.createElement("div");
    b.id = "upgradeBanner";
    b.style.cssText = "background:#fff3cd;color:#856404;border:1px solid #ffeeba;padding:10px 12px;border-radius:6px;margin:8px 0;font-size:14px;";
    const box = document.querySelector(".chat-main") || document.body;
    box.insertBefore(b, box.firstChild);
  }
  b.textContent = msg || "You’ve reached your plan limit.";
}
function disableComposer(disabled) {
  const input = document.getElementById("userInput");
  const sendBtn = document.getElementById("sendButton");
  if (input)  input.disabled  = !!disabled;
  if (sendBtn) sendBtn.style.opacity = disabled ? "0.5" : "";
}

// ──────────────────────────────────────────────────────────────
// NEW — Feature intent router → turn user ask into on-site links
// ──────────────────────────────────────────────────────────────
const FEATURE_LINKS = {
  "resume-analyzer": { url: "/resume-analyzer", label: "Resume Analyzer" },
  "resume-builder":  { url: "/resume-builder",  label: "Resume Builder"  },
  "cover-letter":    { url: "/cover-letter",    label: "Cover Letter"    },
  "interview-coach": { url: "/interview-coach", label: "Interview Coach (Jeni)" },
  "skill-gap":       { url: "/skill-gap",       label: "Skill Gap Analyzer" },
  "job-insights":    { url: "/job-insights",    label: "Job Insights" },
  "employers":       { url: "/employers",       label: "Employer Tools" },
  "pricing":         { url: "/pricing",         label: "Pricing" }
};

function detectFeatureIntent(message) {
  const m = String(message || "").toLowerCase();

  // priority-ordered checks
  if (/\b(analy[sz]e|scan|score|optimi[sz]e).*\bresume\b|\bresume\b.*\b(analy[sz]er|score|ats|keywords?)\b/.test(m))
    return { primary: "resume-analyzer", alts: ["resume-builder", "cover-letter", "skill-gap"] };

  if (/\b(build|create|write|make).*\bresume\b|\bresume builder\b/.test(m))
    return { primary: "resume-builder", alts: ["resume-analyzer", "cover-letter", "job-insights"] };

  if (/\bcover letter|write.*cover.?letter|generate.*cover.?letter\b/.test(m))
    return { primary: "cover-letter", alts: ["resume-analyzer", "resume-builder", "job-insights"] };

  if (/\b(interview|practice|mock|jeni|questions?).*\b(prepare|coach|help|practice|simulate)?\b/.test(m))
    return { primary: "interview-coach", alts: ["resume-analyzer", "cover-letter", "job-insights"] };

  if (/\b(skill gap|gap analysis|what skills|missing skills|upskilling|transition)\b/.test(m))
    return { primary: "skill-gap", alts: ["resume-analyzer", "job-insights", "cover-letter"] };

  if (/\b(job insights?|market|salary|salaries|demand|trends?|benchmark)\b/.test(m))
    return { primary: "job-insights", alts: ["resume-analyzer", "skill-gap", "cover-letter"] };

  if (/\b(employer|recruiter|post(ing)?|job description|jd generator)\b/.test(m))
    return { primary: "employers", alts: ["pricing"] };

  return null;
}

function renderFeatureSuggestions(intent, intoEl) {
  if (!intent || !intoEl) return;

  const primary = FEATURE_LINKS[intent.primary];
  const alts = (intent.alts || []).map(k => FEATURE_LINKS[k]).filter(Boolean);

  const wrap = document.createElement("div");
  wrap.className = "feature-suggest";
  wrap.innerHTML = `
    <div class="feature-suggest-head">Top recommendation</div>
    <a class="feature-suggest-primary" href="${primary.url}">
      <span>Open ${primary.label}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17l7-7v6h2V7h-9v2h6l-7 7z" fill="currentColor"/></svg>
    </a>
    ${alts.length ? `
      <div class="feature-suggest-alt-head">Other helpful tools</div>
      <div class="feature-suggest-alts">
        ${alts.map(a => `<a href="${a.url}">${a.label}</a>`).join("")}
      </div>` : ""}
    <hr class="response-separator" />
  `;
  intoEl.appendChild(wrap);
}

// ──────────────────────────────────────────────────────────────
// NEW — chat-only plan-limit detector that uses the global upgrade UI
// ──────────────────────────────────────────────────────────────
function handleChatLimitError(err) {
  // apiFetch throws: "Request failed <status>: <body>"
  const msg = String(err && err.message || "");
  const isLimit =
    /Request failed 402/.test(msg) ||
    /upgrade_required/.test(msg) ||
    /quota_exceeded/.test(msg);

  if (isLimit) {
    const copy = "You’ve reached your plan limit. Upgrade to continue.";
    // Uses the same site-wide prompt used by analyzer/builder (defined in base.js)
    if (typeof window.upgradePrompt === "function") {
      window.upgradePrompt(copy, (window.PRICING_URL || "/pricing"), 1200);
    } else if (typeof window.showUpgradeBanner === "function") {
      // Fallback: sticky banner only
      window.showUpgradeBanner(copy);
      setTimeout(() => { window.location.href = (window.PRICING_URL || "/pricing"); }, 1200);
    }
    // Mark so our catch block can short-circuit generic error UI
    err.kind = "limit";
    err.message = copy;
    return true;
  }
  return false;
}

// Expose functions used by inline HTML handlers
window.insertSuggestion = insertSuggestion;
window.copyToClipboard  = copyToClipboard;
window.autoResize       = autoResize;
window.sharePage        = sharePage;
window.handleMic        = handleMic;
window.handleAttach     = handleAttach;
window.removeWelcome    = removeWelcome;

// ──────────────────────────────────────────────────────────────
// Lightweight status bar shown above the input while AI works
// ──────────────────────────────────────────────────────────────
function showAIStatus(text = "Thinking…") {
  let bar = document.getElementById("aiStatusBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "aiStatusBar";
    bar.style.cssText = `
      position: sticky; bottom: 0; left: 0; right: 0;
      display: flex; align-items: center; gap: 8px;
      background: #f7fbff; border: 1px solid #d8e7ff;
      color: #104879; padding: 10px 12px; border-radius: 10px;
      margin: 8px 0 0; font-size: 14px; z-index: 5;
    `;
    const container = document.querySelector(".composer") || document.querySelector(".chat-footer") || document.body;
    container.parentNode.insertBefore(bar, container);
  }
  bar.innerHTML = `
    <span class="ai-spinner" aria-hidden="true"></span>
    <strong>${text}</strong>
  `;
  bar.style.display = "flex";
}
function hideAIStatus() {
  const bar = document.getElementById("aiStatusBar");
  if (bar) bar.style.display = "none";
}

// Create an inline “thinking” placeholder inside the assistant bubble
function renderThinkingPlaceholder(targetEl, label = "Thinking…") {
  if (!targetEl) return;
  const node = document.createElement("div");
  node.className = "ai-thinking";
  node.innerHTML = `
    <span class="ai-spinner" aria-hidden="true"></span>
    <span>${label}</span>
  `;
  targetEl.appendChild(node);             // <- append, do not replace
}

// ──────────────────────────────────────────────────────────────
// Model controls
// ──────────────────────────────────────────────────────────────
function initModelControls() {
  const shell = document.getElementById("chatShell");
  const modelSelect = document.getElementById("modelSelect");
  const modelBadge  = document.getElementById("modelBadge");
  const headerModel = document.getElementById("headerModel");

  const isPaid = (shell?.dataset.isPaid === "1");
  const defaultModel = shell?.dataset.defaultModel || "gpt-4o-mini";
  const freeModel    = shell?.dataset.freeModel    || "gpt-4o-mini";
  const allowedModels = (shell?.dataset.allowedModels || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  function getSelectedModel(){
    if (!isPaid) return freeModel || defaultModel;
    const saved = localStorage.getItem("chatModel");
    if (saved && allowedModels.includes(saved)) return saved;
    if (modelSelect && allowedModels.includes(modelSelect.value)) return modelSelect.value;
    return defaultModel;
  }

  function setSelectedModel(m){
    if (modelSelect && allowedModels.includes(m)) modelSelect.value = m;
    if (modelBadge)  modelBadge.textContent  = m;
    if (headerModel) headerModel.textContent = m;
    if (isPaid) localStorage.setItem("chatModel", m);
  }

  // Initialize UI
  setSelectedModel(getSelectedModel());
  if (isPaid && modelSelect) {
    modelSelect.addEventListener("change", () => setSelectedModel(modelSelect.value));
  }

  return { getSelectedModel, setSelectedModel, isPaid, allowedModels };
}

// ──────────────────────────────────────────────────────────────
/** Server call helper (POST to /api/ask and return JSON) */
// ──────────────────────────────────────────────────────────────
async function sendMessageToAPI(payload) {
  // apiFetch comes from base.js and already handles credentials + CSRF + 401s
  return apiFetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }); // expected: { reply, modelUsed }
}

// ──────────────────────────────────────────────────────────────
// Detect if a message is about job search (natural language)
// ──────────────────────────────────────────────────────────────
function detectJobsIntent(raw) {
  if (!raw) return null;
  const message = String(raw).toLowerCase().trim();

  // Do NOT trigger on advice/strategy-style prompts
  if (/\b(advice|tips?|strategy|strategies|how to|guide|best practices?)\b/.test(message)) {
    return null;
  }

  // Trigger only if the user clearly wants listings
  const wantsListings =
    /\b(openings?|vacancies|list(?:ing)?s?|show (me )?jobs?|find (me )?jobs?|roles? available|positions? available)\b/.test(message) ||
    /^\s*jobs?:/i.test(message);

  if (!wantsListings) return null;

  // Extract role + location (same as before, simplified)
  const inLoc = /\b(in|near|around|at)\s+([a-z0-9\s\-,.'\/]+)/i;
  const remote = /\b(remote|work from home|hybrid)\b/i;

  let role = message
    .replace(/^\s*jobs?:/i, "")
    .replace(/\b(openings?|vacancies|show (me )?jobs?|find (me )?jobs?)\b/g, "")
    .replace(inLoc, "")
    .replace(/\b(remote|work from home|hybrid)\b/g, "")
    .replace(/\b(job|jobs|role|roles|position|positions)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  let location = null;
  const m = message.match(inLoc);
  if (m && m[2]) location = m[2].trim();
  else if (remote.test(message)) location = "remote";

  let queries = [];
  if (location) queries = [[role, location].filter(Boolean).join(" ").trim()];
  else if (role) queries = [role];

  return queries.length ? { query: queries.join(" | "), queries, role: role || null, location } : null;
}

// ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // (Optional) Inject minimal CSS for spinner if not present
  if (!document.getElementById("aiSpinnerStyles")) {
    const st = document.createElement("style");
    st.id = "aiSpinnerStyles";
    st.textContent = `
      .ai-spinner{width:16px;height:16px;border:2px solid rgba(16,72,121,.2);border-top-color:rgba(16,72,121,1);border-radius:50%;display:inline-block;animation:ai-spin .8s linear infinite}
      @keyframes ai-spin{to{transform:rotate(360deg)}}
      .ai-thinking{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#f6f9ff;border:1px solid #e1ecff;border-radius:10px;color:#104879;font-size:14px}
    `;
    document.head.appendChild(st);
  }

  // Init model UI/logic first
  const modelCtl = initModelControls();

  // 0) Server-backed conversation id (created on first send)
  let conversationId = localStorage.getItem("chat:conversationId") || null;

  // Storage keys
  const STORAGE = {
    current: "jobcus:chat:current",   // [{role:'user'|'assistant', content:'...'}]
    history: "jobcus:chat:history"    // [{id,title,created,messages:[...] }]
  };

  // DOM refs
  const chatbox = document.getElementById("chatbox");
  const form    = document.getElementById("chat-form");
  const input   = document.getElementById("userInput");

  // Keep textarea autosizing in sync
  input?.addEventListener("input", () => {
    window.autoResize?.(input);
    scrollToBottom();
  });
  // Initial size if prefilled
  window.autoResize?.(input);

  const escapeHtml = (s='') => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const getCurrent = () => JSON.parse(localStorage.getItem(STORAGE.current) || "[]");
  const setCurrent = (arr) => localStorage.setItem(STORAGE.current, JSON.stringify(arr));
  const getHistory = () => JSON.parse(localStorage.getItem(STORAGE.history) || "[]");
  const setHistory = (arr) => localStorage.setItem(STORAGE.history, JSON.stringify(arr));

  function firstUserTitle(messages){
    const firstUser = messages.find(m => m.role === "user");
    const raw = (firstUser?.content || "Conversation").trim();
    return raw.length > 60 ? raw.slice(0,60) + "…" : raw;
  }

  function renderWelcome(){
    const shell = document.getElementById("chatShell");
    const fname = (shell?.dataset.firstName || "there");
    chatbox.innerHTML = `
      <div class="welcome" id="welcomeBanner">
        <p class="welcome-title">👋 Welcome ${escapeHtml(fname)}! How can I help you today?</p>
        <div class="suggestion-chips">
          <button type="button" onclick="insertSuggestion('How do I improve my resume?')" class="chip">Improve my resume</button>
          <button type="button" onclick="insertSuggestion('Interview tips for a UX role')" class="chip">Interview tips</button>
          <button type="button" onclick="insertSuggestion('Show me job market insights for London')" class="chip">Job insights</button>
        </div>
      </div>`;
  }

  function renderChat(messages){
    chatbox.innerHTML = "";
    if (!messages.length){
      renderWelcome();
      scrollToBottom();
      return;
    }
    messages.forEach(msg => {
      const div = document.createElement("div");
      div.className = `chat-entry ${msg.role === "assistant" ? "ai-answer" : "user"}`;
      if (msg.role === "assistant") {
        const id = `ai-${Math.random().toString(36).slice(2)}`;
        div.innerHTML = `
          <div id="${id}" class="markdown"></div>
          <div class="response-footer">
            <span class="copy-wrapper">
              <img src="/static/icons/copy.svg" class="copy-icon"
                   title="Copy" onclick="copyToClipboard('${id}')">
              <span class="copy-text">Copy</span>
            </span>
          </div>
          <hr class="response-separator" />
        `;
        const target = div.querySelector(`#${id}`);
        if (window.marked && typeof window.marked.parse === "function") {
          target.innerHTML = window.marked.parse(msg.content);
        } else {
          target.textContent = msg.content;
        }
      } else {
        div.innerHTML = `
          <h2 style="font-size:1.5rem;font-weight:600;margin:0 0 .5rem;color:#104879;">
            ${escapeHtml(msg.content)}
          </h2>
        `;
      }
      chatbox.appendChild(div);
    });
    scrollToBottom();
  }

  function renderHistory(){
    const list = document.getElementById("chatHistory");
    if (!list) return;
    const hist = getHistory();
    list.innerHTML = "";
    hist.forEach(h => {
      const li = document.createElement("li");
      li.className = "history-item";
      li.innerHTML = `
        <span class="history-item-title" title="${escapeHtml(h.title)}">${escapeHtml(h.title)}</span>
        <button class="delete" aria-label="Delete">✕</button>
      `;
      li.addEventListener("click", (e) => {
        if (e.target.closest(".delete")) return;
        setCurrent(h.messages || []);
        renderChat(getCurrent());
        try { closeChatMenu?.(); } catch {}
      });
      li.querySelector(".delete").addEventListener("click", (e) => {
        e.stopPropagation();
        setHistory(getHistory().filter(x => x.id !== h.id));
        renderHistory();
      });
      list.appendChild(li);
    });
  }

  window.saveMessage = function(role, content){
    const msgs = getCurrent();
    msgs.push({ role, content });
    setCurrent(msgs);
  };

  let clearInProgress = false;
  window.clearChat = function(){
    if (clearInProgress) return;
    clearInProgress = true;
    try {
      const current = getCurrent();
      if (current.length){
        const hist = getHistory();
        const sig = JSON.stringify(current);
        const lastSig = hist.length ? JSON.stringify(hist[0].messages || []) : null;
        if (sig !== lastSig){
          hist.unshift({
            id: Date.now().toString(36),
            title: firstUserTitle(current),
            created: new Date().toISOString(),
            messages: current
          });
          setHistory(hist);
        }
      }
      setCurrent([]);
      localStorage.removeItem("chat:conversationId");
      conversationId = null;
      renderChat([]);
      renderHistory();
    } finally {
      setTimeout(() => { clearInProgress = false; }, 50);
    }
  };

  // 🔁 UPDATED: server-truth credits panel (USED of MAX)
  async function refreshCreditsPanel() {
    const planEl  = document.getElementById("credits-plan");
    const leftEl  = document.getElementById("credits-left");
    const resetEl = document.getElementById("credits-reset");
    if (!planEl && !leftEl && !resetEl) return;

    try {
      const c = await apiFetch("/api/credits"); // { plan, used, max, left, period_kind, period_key }
      const used = typeof c.used === "number" ? c.used : 0;
      const max  = typeof c.max  === "number" ? c.max  : 0;

      // Show USED of MAX (or Unlimited if max falsy)
      planEl  && (planEl.textContent  = (c.plan || "free").replace(/^\w/, s => s.toUpperCase()));
      leftEl  && (leftEl.textContent  = (max ? `${used} of ${max}` : "Unlimited"));

      const resets = { total: "Trial", week: "Resets weekly", month: "Resets monthly", year: "Resets yearly", day: "Resets daily", hour: "Resets hourly" };
      resetEl && (resetEl.textContent = resets[c.period_kind] || "");
    } catch (e) {
      // Keep UI from breaking on error; do nothing
    }
  }

  // Sidebar open/close (use functions exposed by base.js)
  const chatMenuToggle = document.getElementById("chatMenuToggle");
  const chatOverlay    = document.getElementById("chatOverlay");
  const chatCloseBtn   = document.getElementById("chatSidebarClose");

  chatMenuToggle?.addEventListener("click", window.openChatMenu);
  chatOverlay?.addEventListener("click", window.closeChatMenu);
  chatCloseBtn?.addEventListener("click", window.closeChatMenu);
  document.addEventListener("keydown", (e)=>{ if (e.key === "Escape") window.closeChatMenu?.(); });

  document.getElementById("newChatBtn")?.addEventListener("click", () => { clearChat(); window.closeChatMenu?.(); });
  document.getElementById("clearChatBtn")?.addEventListener("click", () => { clearChat(); window.closeChatMenu?.(); });

  renderChat(getCurrent());
  renderHistory();
  refreshCreditsPanel();
  maybeShowScrollIcon?.();
  scrollToBottom();

  // ---- send handler (self-contained and async) ----
  form?.addEventListener("submit", async (evt) => {
    evt.preventDefault();

    const message = (input?.value || "").trim();
    if (!message) return;

    removeWelcome?.();

    const userMsg = document.createElement("div");
    userMsg.className = "chat-entry user";
    userMsg.innerHTML = `
      <h2 style="font-size:1.5rem;font-weight:600;margin:0 0 .5rem;color:#104879;">
        ${escapeHtml(message)}
      </h2>
    `;
    chatbox.appendChild(userMsg);
    scrollToBottom();

    saveMessage("user", message);

    if (input) {
      input.value = "";
      autoResize(input);
    }

    const aiBlock = document.createElement("div");
    aiBlock.className = "chat-entry ai-answer";
    chatbox.appendChild(aiBlock);

    const featureIntent = detectFeatureIntent(message);
    if (featureIntent) {
      // keep the inline CTAs so users still have buttons
      renderFeatureSuggestions(featureIntent, aiBlock);
    
      // NEW: auto-route when intent is very explicit
      const veryStrong = /\b(open|start|take me|go to|launch|use|begin)\b/.test(message.toLowerCase())
                      || /^(scan|analy[sz]e|build|create|write)\b/.test(message.toLowerCase());
    
      // Optional: make analyzer/builder always strong when user mentions resume + action
      const strongKeys = ["resume-analyzer", "resume-builder", "cover-letter", "interview-coach", "skill-gap", "job-insights"];
      const isSupported = strongKeys.includes(featureIntent.primary);
    
      if (isSupported && veryStrong) {
        const dest = FEATURE_LINKS[featureIntent.primary]?.url || "/";
        // Tiny “opening…” strip the user can cancel
        const bar = document.createElement("div");
        bar.className = "feature-autoroute";
        bar.innerHTML = `
          <span>Opening <strong>${FEATURE_LINKS[featureIntent.primary].label}</strong>…</span>
          <button type="button" class="cancel">Cancel</button>
        `;
        aiBlock.appendChild(bar);
    
        let cancelled = false;
        bar.querySelector(".cancel")?.addEventListener("click", () => { cancelled = true; bar.remove(); });
    
        setTimeout(() => {
          if (!cancelled) window.location.href = dest;
        }, 900); // quick, but gives the user a moment to cancel
      }
    }

    renderThinkingPlaceholder(aiBlock, "Thinking…");
    showAIStatus("Thinking…");
    scrollToAI(aiBlock);
    scrollToBottom();

    const currentModel = modelCtl.getSelectedModel();
    let finalReply = "";

    try {
      disableComposer(true);

      // Jobs quick-intent (supports natural language + "jobs:" shortcut)
      const jobIntent = detectJobsIntent(message) || (
        (/^\s*jobs?:/i.test(message) ? { query: message.replace(/^\s*jobs?:/i, "").trim() || message.trim() } : null)
      );

      if (jobIntent) {
        // status while fetching
        showAIStatus("Finding jobs…");

        let jobs;
        if (Array.isArray(jobIntent.queries) && jobIntent.queries.length > 1) {
          const results = await Promise.all(jobIntent.queries.map(q =>
            apiFetch("/jobs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query: q })
            }).catch(() => ({ remotive:[], adzuna:[], jsearch:[] }))
          ));
          jobs = results.reduce((acc, r) => ({
            remotive: [...(acc.remotive||[]), ...(r.remotive||[])],
            adzuna:   [...(acc.adzuna  ||[]), ...(r.adzuna  ||[])],
            jsearch:  [...(acc.jsearch ||[]), ...(r.jsearch ||[])],
          }), {remotive:[], adzuna:[], jsearch:[]});
        } else {
          jobs = await apiFetch("/jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: jobIntent.query })
          });
        }

        // replace the thinking bubble with the actual job list
        aiBlock.innerHTML = "";
        displayJobs(jobs, aiBlock);
        if (![...(jobs?.remotive||[]), ...(jobs?.adzuna||[]), ...(jobs?.jsearch||[])].length) {
          aiBlock.insertAdjacentHTML('beforeend',
            `<p style="margin-top:8px;color:#a00;">No jobs found right now. Try another role or location.</p>`);
        }
        saveMessage("assistant", `Here are jobs for “${(jobIntent.queries || [jobIntent.query]).join(' | ')}”.`);

        await refreshCreditsPanel?.();
        window.syncState?.();
        hideAIStatus();               // ✅ hide the sticky status
        scrollToBottom();
        return;
      }

      // Normal AI chat
      const data = await apiFetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, model: currentModel, conversation_id: conversationId })
      });

      // Save conv id after first reply
      if (data.conversation_id && data.conversation_id !== conversationId) {
        conversationId = data.conversation_id;
        localStorage.setItem("chat:conversationId", conversationId);
      }

      finalReply = (data && data.reply) ? String(data.reply) : "Sorry, I didn't get a response.";
    } catch (err) {
      hideAIStatus();  // ✅ ensure status bar is removed on error

      // NEW — show the same upgrade modal/banner + gentle redirect (chat only)
      if (handleChatLimitError(err)) {
        aiBlock.innerHTML = ""; // suppress raw JSON message
        scrollToBottom();
        return;
      }

      if (err?.kind === "limit") {
        aiBlock.innerHTML = `<p style="margin:8px 0;color:#a00;">${escapeHtml(err.message || "Free limit reached.")}</p><hr class="response-separator" />`;
        scrollToBottom();
        return;
      }
      aiBlock.innerHTML = `<p style="margin:8px 0;color:#a00;">${escapeHtml(err.message || "Sorry, something went wrong.")}</p><hr class="response-separator" />`;
      scrollToBottom();
      return;
    } finally {
      disableComposer(false);
      input?.focus();
    }

    // ✅ Model returned — stop the status bar now (success path)
    hideAIStatus();

    const copyId = `ai-${Date.now()}`;
    aiBlock.innerHTML = `
      <div id="${copyId}" class="markdown"></div>
      <div class="response-footer">
        <span class="copy-wrapper">
          <img src="/static/icons/copy.svg" class="copy-icon" title="Copy" onclick="copyToClipboard('${copyId}')">
          <span class="copy-text">Copy</span>
        </span>
      </div>
      <hr class="response-separator" />
    `;
    const targetDiv = document.getElementById(copyId);
    scrollToBottom();

    let i = 0, buffer = "";
    (function typeWriter() {
      if (i < finalReply.length) {
        buffer += finalReply[i++];
        targetDiv.textContent = buffer;
        scrollToAI(aiBlock);
        scrollToBottom();
        setTimeout(typeWriter, 5);
      } else {
        if (window.marked?.parse) {
          targetDiv.innerHTML = window.marked.parse(buffer);
        } else {
          targetDiv.textContent = buffer;
        }
        saveMessage("assistant", finalReply);

        // 🔁 UPDATED: refresh from server instead of local "chatUsed"
        (async () => { await refreshCreditsPanel?.(); })();
        window.syncState?.();

        scrollToAI(aiBlock);
        scrollToBottom();
        maybeShowScrollIcon();
      }
    })();
  });

  const sendBtn = document.getElementById("sendButton");
  sendBtn?.addEventListener("click", () => {
    // Trigger the form submit programmatically
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  // If DOM changes inside chatbox (e.g., images/markdown), keep view at bottom
  new MutationObserver(() => {
    const box = document.getElementById("chatbox");
    if (box) box.scrollTop = box.scrollHeight;
  }).observe(chatbox, { childList: true, subtree: true });

  // Keep bottom on resize
  window.addEventListener("resize", scrollToBottom);
});

// AUTO-CONSUME prefilled question from home page
// AUTO-CONSUME prefilled question from home page
(function(){
  try {
    const params = new URLSearchParams(location.search);
    const q = params.get('q') || localStorage.getItem('chat:prefill') || '';
    if (!q) return;
    localStorage.removeItem('chat:prefill');
    const input = document.getElementById('userInput');
    const form  = document.getElementById('chat-form');
    if (!input || !form) return;
    input.value = q;
    // small delay lets the page finish wiring handlers
    setTimeout(() => {
      form.dispatchEvent(new Event("submit", { bubbles:true, cancelable:true }));
      // Clean the querystring so refreshes don't resend
      const nextURL = location.pathname + location.hash;
      history.replaceState({}, "", nextURL);
    }, 100);
  } catch {}
})();

// ──────────────────────────────────────────────────────────────
// Optional job suggestions (kept from your original)
// ──────────────────────────────────────────────────────────────
async function fetchJobs(query, aiBlock) {
  try {
    const res = await fetch("/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    displayJobs(data, aiBlock);
    // Also show a friendly fallback if nothing came back when called directly
    if (![...(data?.remotive||[]), ...(data?.adzuna||[]), ...(data?.jsearch||[])].length) {
      aiBlock.insertAdjacentHTML('beforeend',
        `<p style="margin-top:8px;color:#a00;">No jobs found right now. Try another role or location.</p>`);
    }
  } catch (err) {
    console.error("Job fetch error:", err);
  }
}
function displayJobs(data, aiBlock) {
  const jobsContainer = document.createElement("div");
  jobsContainer.className = "job-listings";
  const allJobs = [...(data?.remotive || []), ...(data?.adzuna || []), ...(data?.jsearch || [])];
  if (!allJobs.length) return;
  const heading = document.createElement("p");
  heading.innerHTML = `<strong>Here are some job opportunities that match your interest:</strong>`;
  heading.style.marginTop = "16px";
  jobsContainer.appendChild(heading);
  allJobs.forEach(job => {
    const jobCard = document.createElement("div");
    jobCard.className = "job-card";
    jobCard.innerHTML = `
      <h3>${job.title}</h3>
      <p><strong>${job.company}</strong><br>${job.location || ""}</p>
      <a href="${job.url}" target="_blank" rel="noopener noreferrer">View Job</a>
    `;
    jobsContainer.appendChild(jobCard);
  });
  aiBlock.appendChild(jobsContainer);
  scrollToBottom();
}
