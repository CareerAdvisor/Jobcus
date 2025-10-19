// /static/js/chat.js

// --- global HTML-escaper used across the file ---
window.escapeHtml = function (s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

// One global helper
window.insertSuggestion = function (text) {
  const el = document.getElementById('userInput');
  if (!el) return;
  el.value = text;
  el.focus();
  window.autoResize?.(el);
};

// ===== GLOBAL HELPERS (place near the top, before DOMContentLoaded) =====
window.setChatActive = function (on) {
  document.body.classList.toggle('chat-active', !!on);
};
window.nukePromos = function () {
  document.querySelectorAll('.chat-promos').forEach(n => n.remove());
  document.getElementById('welcomeBanner')?.remove();
};

// Event delegation for any data-suggest button (no inline onclick needed)
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-suggest]');
  if (b && b.dataset.suggest) {
    window.insertSuggestion(b.dataset.suggest);
  }
});

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

// === Chat state + cleanup helpers (global) ===
function setChatActive(on) {
  document.body.classList.toggle('chat-active', !!on);
}
function nukePromos() {
  // remove any promo sections + welcome banner
  document.querySelectorAll('.chat-promos').forEach(n => n.remove());
  document.getElementById('welcomeBanner')?.remove();
}

// Minimal helpers your old code referenced
function showUpgradeBanner(msg) {
  let b = document.getElementById("upgradeBanner");
  const pricingUrl = (window.PRICING_URL || "/pricing");

  const esc = (t) => (typeof window.escapeHtml === "function" ? window.escapeHtml(String(t || "")) : String(t || ""));

  if (!b) {
    b = document.createElement("div");
    b.id = "upgradeBanner";
    b.setAttribute("role", "alert");
    b.setAttribute("aria-live", "polite");
    b.style.cssText = [
      "background:#fff3cd", "color:#856404", "border:1px solid #ffeeba",
      "padding:10px 12px", "border-radius:6px", "margin:8px 0",
      "font-size:14px", "display:flex", "align-items:center",
      "gap:12px", "flex-wrap:wrap"
    ].join(";");
    const box = document.querySelector(".chat-main") || document.body;
    box.insertBefore(b, box.firstChild);
  }

  b.innerHTML = `
    <span>${esc(msg || "You’ve reached your plan limit for chat. Upgrade to continue.")}</span>
    <span style="margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;">
      <a href="${pricingUrl}" class="btn-upgrade-link" style="text-decoration:underline;white-space:nowrap;">View pricing →</a>
      <button type="button" id="upgradeNotNowBtn" style="background:transparent;border:none;color:#856404;text-decoration:underline;cursor:pointer;white-space:nowrap;">Not now</button>
    </span>
  `;

  // Dismiss banner (no redirect) — chat remains paused (composer disabled)
  b.querySelector("#upgradeNotNowBtn")?.addEventListener("click", () => {
    b.remove();
    try { sessionStorage.setItem("jobcus:chat:upgradeBannerDismissed", "1"); } catch {}
  });

  try { b.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
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
// NEW — chat-only plan-limit detector that shows banner (no redirect)
// ──────────────────────────────────────────────────────────────
function handleChatLimitError(err) {
  // apiFetch throws: "Request failed <status>: <body>"
  const msg = String(err && err.message || "");
  const isLimit =
    /Request failed 402/.test(msg) ||
    /upgrade_required/.test(msg) ||
    /quota_exceeded/.test(msg);

  if (isLimit) {
    const copy = "You’ve reached your plan limit for chat. Upgrade to continue.";
    // ✅ Banner only, no modal, no auto-redirect
    if (typeof window.showUpgradeBanner === "function") {
      window.showUpgradeBanner(copy);
    }
    // Pause the composer so it's obvious chat is out of credits
    disableComposer?.(true);

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

// Closes any open history ellipsis menus when clicking outside
document.addEventListener("click", (e) => {
  document.querySelectorAll(".history-menu.open").forEach(m => {
    if (!m.contains(e.target) && !m.parentElement?.querySelector(".history-ellipsis")?.contains(e.target)) {
      m.classList.remove("open");
    }
  });
});

async function shareConversation(convId, title) {
  const url = `${location.origin}${location.pathname}?cid=${encodeURIComponent(convId)}`;
  try {
    if (navigator.share) {               // prefer OS share sheet
      await navigator.share({ title: title || "Conversation", url });
    } else {
      await navigator.clipboard.writeText(url);
      // lightweight toast
      alert("Share link copied to clipboard!");
    }
  } catch {}
}

async function renameConversation(convId, currentTitle, isServer = true) {
  const next = (prompt("Rename conversation:", currentTitle || "Conversation") || "").trim();
  if (!next) return;

  if (isServer) {
    try {
      await apiFetch(`/api/conversations/${convId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next })
      });
    } catch (e) {
      // 404 means your backend route doesn't exist
      console.warn("PATCH /api/conversations/:id not found; using local fallback");
      isServer = false;
    }
  }
  if (!isServer) {
    const STORAGE = { history: "jobcus:chat:history" };
    const hist = JSON.parse(localStorage.getItem(STORAGE.history) || "[]");
    const row = hist.find(h => h.id === convId);
    if (row) {
      row.title = next;
      localStorage.setItem(STORAGE.history, JSON.stringify(hist));
    }
  }
  await renderHistory();
}

async function deleteConversation(convId, isServer = true) {
  if (!confirm("Delete this conversation? This cannot be undone.")) return;

  if (isServer) {
    try {
      await apiFetch(`/api/conversations/${convId}`, { method: "DELETE" });
      // clear active id if you deleted the open one
      if (localStorage.getItem("chat:conversationId") === String(convId)) {
        localStorage.removeItem("chat:conversationId");
        window.renderChat?.([]);
      }
    } catch (e) {
      console.warn("DELETE /api/conversations/:id not found; using local fallback");
      isServer = false;
    }
  }
  if (!isServer) {
    const STORAGE = { history: "jobcus:chat:history", current: "jobcus:chat:current" };
    const next = (JSON.parse(localStorage.getItem(STORAGE.history) || "[]")).filter(h => h.id !== convId);
    localStorage.setItem(STORAGE.history, JSON.stringify(next));
    if (localStorage.getItem('jobcus:chat:activeId') === convId) {
      localStorage.removeItem('jobcus:chat:activeId');
      localStorage.removeItem(STORAGE.current);
      window.renderChat?.([]);
    }
  }
  await renderHistory();
}

// ──────────────────────────────────────────────────────────────
// SERVER-FIRST history with active highlight (+ local fallback)
// ──────────────────────────────────────────────────────────────
async function renderHistory(){
  const list = document.getElementById("chatHistory");
  const empty = document.getElementById("historyEmpty");
  if (!list) return;

  // Local store helpers
  const STORAGE = {
    current: "jobcus:chat:current",
    history: "jobcus:chat:history"
  };
  const getHistory = () => JSON.parse(localStorage.getItem(STORAGE.history) || "[]");
  const setHistory = (arr) => localStorage.setItem(STORAGE.history, JSON.stringify(arr));

  list.innerHTML = "";
  const activeServerId = (localStorage.getItem("chat:conversationId") || "").toString();

  // Try server-backed
  let rows = null;
  try {
    rows = await apiFetch("/api/conversations"); // [{id,title,created_at}]
    if (!Array.isArray(rows)) rows = [];
  } catch {
    rows = null;
  }

  if (rows && rows.length){
    if (empty) empty.hidden = true;
    rows.forEach(row => {
      const li = document.createElement("li");
      const rowId = String(row.id);
      li.className = "history-item" + (rowId === activeServerId ? " active" : "");
      li.dataset.id = rowId;
    
      // container for relative menu positioning
      const wrap = document.createElement("div");
      wrap.style.position = "relative";
      wrap.style.display = "flex";
      wrap.style.alignItems = "center";
      wrap.style.width = "100%";
    
      wrap.innerHTML = `
        <span class="history-item-title" title="${escapeHtml(row.title || 'Conversation')}">
          ${escapeHtml(row.title || 'Conversation')}
        </span>
        <button class="history-ellipsis" aria-label="More">
          <img src="/static/icons/ellipsis.svg" alt="">
        </button>
        <div class="history-menu" role="menu" aria-hidden="true">
          <button class="share"  role="menuitem">Share</button>
          <button class="rename" role="menuitem">Rename</button>
          <button class="delete danger" role="menuitem">Delete</button>
        </div>
      `;
    
      // open conversation when row (not menu) is clicked
      wrap.addEventListener("click", async (e) => {
        if (e.target.closest(".history-ellipsis") || e.target.closest(".history-menu")) return;
        try {
          const msgs = await apiFetch(`/api/conversations/${rowId}/messages`);
          const formatted = (msgs || []).map(m => ({ role: m.role, content: m.content }));
          localStorage.setItem(STORAGE.current, JSON.stringify(formatted));
          localStorage.setItem("chat:conversationId", rowId);
          renderChat(formatted);
          renderHistory();
          try { closeChatMenu?.(); } catch {}
        } catch (e) { console.error("Failed to load messages", e); }
      });
    
      // menu open/close
      const ellipsisBtn = wrap.querySelector(".history-ellipsis");
      const menu = wrap.querySelector(".history-menu");
      ellipsisBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        document.querySelectorAll(".history-menu.open").forEach(m => m.classList.remove("open"));
        menu.classList.toggle("open");
      });
    
      // actions
      menu.querySelector(".share") .addEventListener("click", (e) => { e.stopPropagation(); menu.classList.remove("open"); shareConversation(rowId, row.title); });
      menu.querySelector(".rename").addEventListener("click", async (e) => { e.stopPropagation(); menu.classList.remove("open"); await renameConversation(rowId, row.title, true); });
      menu.querySelector(".delete").addEventListener("click", async (e) => { e.stopPropagation(); menu.classList.remove("open"); await deleteConversation(rowId, true); });
    
      li.appendChild(wrap);
      list.appendChild(li);
    });
    return;
  }

  // Fallback to local history with local "activeId"
  const hist = getHistory();
  const activeLocalId = localStorage.getItem('jobcus:chat:activeId') || '';
  if (!hist.length){
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  hist.forEach(h => {
    const li = document.createElement("li");
    li.className = "history-item" + (h.id === activeLocalId ? " active" : "");
  
    const wrap = document.createElement("div");
    wrap.style.position = "relative";
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.width = "100%";
  
    wrap.innerHTML = `
      <span class="history-item-title" title="${escapeHtml(h.title)}">${escapeHtml(h.title)}</span>
      <button class="history-ellipsis" aria-label="More">
        <img src="/static/icons/ellipsis.svg" alt="">
      </button>
      <div class="history-menu" role="menu" aria-hidden="true">
        <button class="share"  role="menuitem">Share</button>
        <button class="rename" role="menuitem">Rename</button>
        <button class="delete danger" role="menuitem">Delete</button>
      </div>
    `;
  
    wrap.addEventListener("click", (e) => {
      if (e.target.closest(".history-ellipsis") || e.target.closest(".history-menu")) return;
      localStorage.setItem(STORAGE.current, JSON.stringify(h.messages || []));
      localStorage.setItem('jobcus:chat:activeId', h.id);
      renderChat(h.messages || []);
      renderHistory();
      try { closeChatMenu?.(); } catch {}
    });
  
    const ellipsisBtn = wrap.querySelector(".history-ellipsis");
    const menu = wrap.querySelector(".history-menu");
    ellipsisBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".history-menu.open").forEach(m => m.classList.remove("open"));
      menu.classList.toggle("open");
    });
  
    menu.querySelector(".share") .addEventListener("click", (e) => { e.stopPropagation(); menu.classList.remove("open"); shareConversation(h.id, h.title); });
    menu.querySelector(".rename").addEventListener("click", async (e) => { e.stopPropagation(); menu.classList.remove("open"); await renameConversation(h.id, h.title, false); });
    menu.querySelector(".delete").addEventListener("click", async (e) => { e.stopPropagation(); menu.classList.remove("open"); await deleteConversation(h.id, false); });
  
    li.appendChild(wrap);
    list.appendChild(li);
  });
}

// ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Inject minimal CSS for spinner if not present
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
  // Inject highlight style for active conversation in history
  if (!document.getElementById("historyActiveStyles")) {
    const st2 = document.createElement("style");
    st2.id = "historyActiveStyles";
    st2.textContent = `.history-item.active{background:#eef5ff}.history-item.active .history-item-title{color:#104879;font-weight:600}`;
    document.head.appendChild(st2);
  }

  // Delegated click for suggestion chips
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-suggest]');
    if (b && b.dataset.suggest) window.insertSuggestion(b.dataset.suggest);
  });

  // ACTION MENU styles (add alongside your other injected styles)
  if (!document.getElementById("historyActionStyles")) {
    const st = document.createElement("style");
    st.id = "historyActionStyles";
    st.textContent = `
      .history-item{
        display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px
      }
      .history-item .history-item-title{
        flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis
      }
      .history-ellipsis{
        width:28px;height:28px;border:none;background:transparent;cursor:pointer;
        display:inline-grid;place-items:center;border-radius:6px;
      }
      .history-ellipsis:hover{background:#f2f6ff}
      .history-ellipsis img{width:16px;height:16px}
  
      .history-menu{
        position:absolute; right:6px; top:100%;
        background:#fff; border:1px solid #e5e9f2; border-radius:10px;
        box-shadow:0 8px 24px rgba(16,24,40,.08);
        min-width:160px; padding:6px; z-index:50; display:none;
      }
      .history-menu.open{display:block}
      .history-menu button{
        width:100%; text-align:left; background:none; border:none; cursor:pointer;
        padding:8px 10px; border-radius:8px; font-size:13px; color:#102a43;
      }
      .history-menu button:hover{background:#f6f9ff}
      .history-menu .danger{color:#b42318}
    `;
    document.head.appendChild(st);
  }

  // Init model UI/logic first
  const modelCtl = initModelControls();

  // Server-backed conversation id (created on first send)
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

  // Bind scroll listener so scrolldown icon shows/hides properly
  chatbox?.addEventListener("scroll", () => maybeShowScrollIcon());

  // Keep textarea autosizing in sync
  input?.addEventListener("input", () => {
    window.autoResize?.(input);
    scrollToBottom();
  });
  // Initial size if prefilled
  window.autoResize?.(input);

  const getCurrent = () => JSON.parse(localStorage.getItem(STORAGE.current) || "[]");
  const setCurrent = (arr) => localStorage.setItem(STORAGE.current, JSON.stringify(arr));
  const getHistory = () => JSON.parse(localStorage.getItem(STORAGE.history) || "[]");
  const setHistory = (arr) => localStorage.setItem(STORAGE.history, JSON.stringify(arr));

  // Initial paint (do NOT wipe server-rendered welcome/promos if empty)
  const curr = getCurrent();
  if (Array.isArray(curr) && curr.length > 0) {
    setChatActive(true);
    renderChat(curr);
  } else {
    setChatActive(false);
    if (!document.getElementById('welcomeBanner')) renderWelcome();
  }

  // clear the "current" buffer unless the URL explicitly asks to continue.
  (function(){
    const url = new URL(location.href);
    const keep = url.searchParams.get("continue"); // use /chat?continue=1 to keep draft
    if (!keep) setCurrent([]);                     // force welcome + promos on first load
  })();

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
          <button type="button" class="chip" data-suggest="How do I improve my resume?">Improve my resume</button>
          <button type="button" class="chip" data-suggest="Interview tips for a UX role">Interview tips</button>
          <button type="button" class="chip" data-suggest="Show me job market insights for London">Job insights</button>
        </div>
      </div>
  
      <!-- Feature promos (empty state only) -->
      <section class="chat-promos" aria-label="Quick tools">
        <a class="promo-card" href="/resume-analyzer">
          <div class="promo-head">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V6h3.5L14 3.5zM8 9h8v1.6H8V9zm0 3h8v1.6H8V12zm0 3h5.5v1.6H8V15z"/></svg>
            <span class="promo-title">Resume Analyzer</span>
          </div>
          <p class="promo-copy">Upload your resume to get an ATS score, keyword match, and quick, actionable fixes.</p>
          <span class="promo-cta" aria-hidden="true">Open →</span>
        </a>
  
        <a class="promo-card" href="/interview-coach">
          <div class="promo-head">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V20H8.5v2H15v-2h-2v-2.08A7 7 0 0 0 19 11h-2z"/></svg>
          <span class="promo-title">Interview Coach</span>
          </div>
          <p class="promo-copy">Practice role-specific questions and get feedback on clarity, tone, and confidence.</p>
          <span class="promo-cta" aria-hidden="true">Start →</span>
        </a>
      </section>
    `;

    // Append feature promos under the welcome
    const tpl = document.getElementById("promosTemplate");
    if (tpl) chatbox.appendChild(tpl.content.cloneNode(true));
  }

  async function handleSend() {
    const userText = input.value.trim();
    if (!userText) return;
  
    setChatActive(true);   // << new
    nukePromos();          // << new
  
    // Hide welcome + promos immediately
    document.getElementById("welcomeBanner")?.remove();
    document.querySelector(".chat-promos")?.remove();
  
    // Existing logic below
    addUserMessage(userText);
    input.value = "";
    autoResize(input);
    await sendToAI(userText);
  }

  function renderChat(messages){
    chatbox.innerHTML = "";
  
    if (!messages.length){
      setChatActive(false);       // empty thread → show welcome/promos
      renderWelcome();
      scrollToBottom();
      maybeShowScrollIcon();
      return;
    }
  
    setChatActive(true);          // active thread → hide welcome/promos
    nukePromos();                 // in case a stray one exists outside chatbox

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
    maybeShowScrollIcon();
  }
  
  // 🔑 make it available to other click handlers (history, etc.)
  window.renderChat = renderChat;

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
      localStorage.removeItem('jobcus:chat:activeId'); // clear local active flag (fallback mode)
      conversationId = null;
      setChatActive(false);   // << new
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

  document.getElementById("newChatBtn")?.addEventListener("click", () => {
    clearChat();
    window.closeChatMenu?.();
  });
  document.getElementById("clearChatBtn")?.addEventListener("click", () => {
    clearChat();
    window.closeChatMenu?.();
  });

  // Initial paint (do NOT wipe server-rendered welcome/promos if empty)
  const curr = getCurrent();
  if (Array.isArray(curr) && curr.length > 0) {
    setChatActive(true);
    renderChat(curr);
  } else {
    setChatActive(false);
    // Keep the server-rendered welcome + feature promos visible
    if (!document.getElementById('welcomeBanner')) {
      renderWelcome(); // only if the server didn't print it
    }
  }
  
  renderHistory();
  refreshCreditsPanel();
  maybeShowScrollIcon();
  scrollToBottom();

  // ---- send handler (self-contained and async) ----
  form?.addEventListener("submit", async (evt) => {
    evt.preventDefault();
  
    const message = (input?.value || "").trim();
    if (!message) return;
  
    setChatActive(true);  // << add
    nukePromos();         // << add
    removeWelcome?.();    // you can keep this line; nukePromos removes it too

    const userMsg = document.createElement("div");
    userMsg.className = "chat-entry user";
    userMsg.innerHTML = `
      <h2 style="font-size:1.5rem;font-weight:600;margin:0 0 .5rem;color:#104879;">
        ${escapeHtml(message)}
      </h2>
    `;
    chatbox.appendChild(userMsg);
    scrollToBottom();
    maybeShowScrollIcon();

    // Save user message locally
    const msgs = getCurrent();
    msgs.push({ role: "user", content: message });
    setCurrent(msgs);

    if (input) {
      input.value = "";
      autoResize(input);
    }

    const aiBlock = document.createElement("div");
    aiBlock.className = "chat-entry ai-answer";

    const suggestRegion = document.createElement("div");
    suggestRegion.className = "feature-suggest-region";
    
    const answerRegion = document.createElement("div");
    answerRegion.className = "ai-answer-region";
    
    aiBlock.appendChild(suggestRegion);
    aiBlock.appendChild(answerRegion);
    chatbox.appendChild(aiBlock);

    const featureIntent = detectFeatureIntent(message);
    if (featureIntent) {
      // keep the inline CTAs so users still have buttons
      renderFeatureSuggestions(featureIntent, suggestRegion);

      // Auto-route when intent is explicit
      const veryStrong = /\b(open|start|take me|go to|launch|use|begin)\b/.test(message.toLowerCase())
                      || /^(scan|analy[sz]e|build|create|write)\b/.test(message.toLowerCase());
      const strongKeys = ["resume-analyzer", "resume-builder", "cover-letter", "interview-coach", "skill-gap", "job-insights"];
      const isSupported = strongKeys.includes(featureIntent.primary);
      if (isSupported && veryStrong) {
        const dest = FEATURE_LINKS[featureIntent.primary]?.url || "/";
        const bar = document.createElement("div");
        bar.className = "feature-autoroute";
        bar.innerHTML = `
          <span>Opening <strong>${FEATURE_LINKS[featureIntent.primary].label}</strong>…</span>
          <button type="button" class="cancel">Cancel</button>
        `;
        aiBlock.appendChild(bar);
        let cancelled = false;
        bar.querySelector(".cancel")?.addEventListener("click", () => { cancelled = true; bar.remove(); });
        setTimeout(() => { if (!cancelled) window.location.href = dest; }, 900);
      }
    }

    renderThinkingPlaceholder(answerRegion, "Thinking…");   // note answerRegion
    showAIStatus("Thinking…");
    scrollToAI(answerRegion);
    scrollToBottom();
    maybeShowScrollIcon();

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
        answerRegion.innerHTML = "";          // ✅ not aiBlock.innerHTML
        displayJobs(jobs, answerRegion);
        if (![...(jobs?.remotive||[]), ...(jobs?.adzuna||[]), ...(jobs?.jsearch||[])].length) {
          answerRegion.insertAdjacentHTML('beforeend',
            `<p style="margin-top:8px;color:#a00;">No jobs found right now. Try another role or location.</p>`);
        }
        // Save assistant summary to local thread
        const updated = [...getCurrent(), { role: "assistant", content: `Here are jobs for “${(jobIntent.queries || [jobIntent.query]).join(' | ')}”.` }];
        setCurrent(updated);

        await refreshCreditsPanel?.();
        window.syncState?.();
        hideAIStatus();
        scrollToBottom();
        maybeShowScrollIcon();
        return;
      }

      // Normal AI chat
      const data = await apiFetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, model: currentModel, conversation_id: conversationId })
      });

      // get the assistant text from the response (cover a few shapes)
      finalReply = String(
        data?.reply ??
        data?.content ??
        data?.text ??
        ""
      ).trim();
      
      // optional fallback so we never render “nothing”
      if (!finalReply) finalReply = "Here’s what I found.";

      // Save conv id after first reply and refresh history for highlight
      if (data.conversation_id && data.conversation_id !== conversationId) {
        conversationId = data.conversation_id;
        localStorage.setItem("chat:conversationId", conversationId);
        renderHistory(); // highlight current
      }
      
      // ✅ actually use the model's reply
      finalReply = (data.reply || data.content || data.message || "").toString();
      
      // add nudges after we have a reply
      finalReply = addJobcusNudges(finalReply);
    } catch (err) {
      hideAIStatus();  // ✅ ensure status bar is removed on error

      // NEW — show the banner and stay on page (no redirect)
      if (handleChatLimitError(err)) {
        aiBlock.innerHTML = ""; // suppress raw JSON message
        scrollToBottom();
        maybeShowScrollIcon();
        return;
      }

      if (err?.kind === "limit") {
        aiBlock.innerHTML = `<p style="margin:8px 0;color:#a00;">${escapeHtml(err.message || "Free limit reached.")}</p><hr class="response-separator" />`;
        scrollToBottom();
        maybeShowScrollIcon();
        return;
      }
      aiBlock.innerHTML = `<p style="margin:8px 0;color:#a00;">${escapeHtml(err.message || "Sorry, something went wrong.")}</p><hr class="response-separator" />`;
      scrollToBottom();
      maybeShowScrollIcon();
      return;
    } finally {
      // If we did NOT hit limit, re-enable composer; if limit, it's already disabled
      if (!document.getElementById("upgradeBanner")) {
        disableComposer(false);
      }
      input?.focus();
    }

    // ✅ Model returned — stop the status bar now (success path)
    hideAIStatus();

    answerRegion.innerHTML = "";   // ← add this here for the non-jobs path

    const copyId = `ai-${Date.now()}`;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="${copyId}" class="markdown"></div>
      <div class="response-footer">
        <span class="copy-wrapper">
          <img src="/static/icons/copy.svg" class="copy-icon" title="Copy" onclick="copyToClipboard('${copyId}')">
          <span class="copy-text">Copy</span>
        </span>
      </div>
      <hr class="response-separator" />
    `;
    answerRegion.appendChild(wrap);
    
    const targetDiv = document.getElementById(copyId);
    scrollToBottom();
    maybeShowScrollIcon();

    let i = 0, buffer = "";
    (function typeWriter() {
      if (i < finalReply.length) {
        buffer += finalReply[i++];
        targetDiv.textContent = buffer;
        scrollToAI(aiBlock);
        scrollToBottom();
        maybeShowScrollIcon();
        setTimeout(typeWriter, 5);
      } else {
        if (window.marked?.parse) {
          targetDiv.innerHTML = window.marked.parse(buffer);
        } else {
          targetDiv.textContent = buffer;
        }
        const updated = [...getCurrent(), { role: "assistant", content: finalReply }];
        setCurrent(updated);

        // 🔁 UPDATED: refresh from server instead of local "chatUsed"
        (async () => { await refreshCreditsPanel?.(); })();
        window.syncState?.();

        scrollToAI(aiBlock);
        scrollToBottom();
        maybeShowScrollIcon();
      }
    })();
  });

  function addJobcusNudges(finalReply) {
    const lower = (finalReply || "").toLowerCase();
  
    const NUDGES = [
      { test: /\bresume\b.*\b(analy[sz]e|score|ats|keyword)s?\b|\banaly[sz]e\b.*\bresume\b/,
        url:  "https://www.jobcus.com/resume-analyzer",
        copy: "Tip: You can also analyze your resume with **Jobcus Resume Analyzer** — https://www.jobcus.com/resume-analyzer" },
      { test: /\b(build|create|write|make)\b.*\bresume\b|\bresume builder\b/,
        url:  "https://www.jobcus.com/resume-builder",
        copy: "Tip: Try the **Jobcus Resume Builder** — https://www.jobcus.com/resume-builder" },
      { test: /\bcover letter|write.*cover.?letter|generate.*cover.?letter\b/,
        url:  "https://www.jobcus.com/cover-letter",
        copy: "Tip: Generate one with the **Jobcus Cover Letter tool** — https://www.jobcus.com/cover-letter" },
      { test: /\b(interview|mock|practice|questions?)\b.*\b(coach|prepare|practice|simulate)\b|\bjeni\b/,
        url:  "https://www.jobcus.com/interview-coach",
        copy: "Tip: Practice with **Jeni, the Interview Coach** — https://www.jobcus.com/interview-coach" },
      { test: /\b(skill gap|gap analysis|what skills|missing skills|upskilling|transition)\b/,
        url:  "https://www.jobcus.com/skill-gap",
        copy: "Tip: Run a **Skill Gap analysis** — https://www.jobcus.com/skill-gap" },
      { test: /\b(employer|recruiter|post(ing)?|job description|jd generator)\b/,
        url:  "https://www.jobcus.com/employers",
        copy: "Tip: Create a JD with **Jobcus Employer Tools** — https://www.jobcus.com/employers" }
    ];
  
    const tips = [];
    for (const n of NUDGES) {
      if (n.test.test(lower) && !lower.includes(n.url.toLowerCase())) {
        tips.push(`> ${n.copy}`);
      }
    }
    if (tips.length) finalReply += `\n\n${tips.slice(0,2).join("\n\n")}`;
    return finalReply;
  }

  const sendBtn = document.getElementById("sendButton");
  sendBtn?.addEventListener("click", () => {
    // Trigger the form submit programmatically
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  // If DOM changes inside chatbox (e.g., images/markdown), keep view at bottom
  new MutationObserver(() => {
    const box = document.getElementById("chatbox");
    if (box) box.scrollTop = box.scrollHeight;
    maybeShowScrollIcon();
  }).observe(chatbox, { childList: true, subtree: true });

  // Keep bottom on resize
  window.addEventListener("resize", () => { scrollToBottom(); maybeShowScrollIcon(); });
});

// Load by shared conversation id, if present
(function(){
  const params = new URLSearchParams(location.search);
  const cid = params.get("cid");
  if (!cid) return;
  apiFetch(`/api/conversations/${cid}/messages`).then(msgs => {
    const formatted = (msgs || []).map(m => ({ role: m.role, content: m.content }));
    localStorage.setItem("jobcus:chat:current", JSON.stringify(formatted));
    localStorage.setItem("chat:conversationId", cid);
    renderChat(formatted);
    renderHistory();
  }).catch(()=>{});
})();

// AUTO-CONSUME prefilled question from home page (skip if cid present)
(function(){
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('cid')) return; // shared view takes precedence
    const q = params.get('q') || localStorage.getItem('chat:prefill') || '';
    if (!q) return;
    localStorage.removeItem('chat:prefill');
    const input = document.getElementById('userInput');
    const form  = document.getElementById('chat-form');
    if (!input || !form) return;
    input.value = q;
    setTimeout(() => {
      form.dispatchEvent(new Event("submit", { bubbles:true, cancelable:true }));
      history.replaceState({}, "", location.pathname + location.hash);
    }, 100);
  } catch {}
})();

// --- AI caveat injector (robust, CSP-safe) ---
(function () {
  function buildCaveat(el) {
    const onceKey = 'ai-caveat-dismissed';
    if (el.dataset.caveatOnce === '1' && sessionStorage.getItem(onceKey)) return null;

    const text     = el.dataset.caveatText || 'AI-generated responses may contain mistakes.';
    const href     = el.dataset.caveatLink || '/ai-disclaimer';
    const inline   = el.dataset.caveatInline === '1';
    const closable = el.dataset.caveatClosable === '1';

    const box = document.createElement('div');
    box.className = inline ? 'ai-caveat-inline' : 'ai-caveat-box';
    box.setAttribute('data-ai-caveat-rendered', '1');
    box.innerHTML = inline
      ? `<span class="ai-caveat-dot" aria-hidden="true"></span>${text} <a href="${href}">Learn more</a>`
      : `<strong>Note:</strong> ${text} <a href="${href}">Learn more</a>`;

    if (closable) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'ai-caveat-close';
      x.setAttribute('aria-label', 'Dismiss');
      x.textContent = '×';
      x.addEventListener('click', () => {
        box.remove();
        if (el.dataset.caveatOnce === '1') sessionStorage.setItem(onceKey, '1');
      });
      box.appendChild(x);
    }
    return box;
  }

  function injectAICaveat() {
    const el = document.getElementById('inputContainer');
    if (!el || !el.dataset.aiCaveat) return;

    // Avoid duplicates
    if (el.nextElementSibling && el.nextElementSibling.matches('[data-ai-caveat-rendered]')) return;

    const box = buildCaveat(el);
    if (!box) return;

    // Place it directly under the input container, inside the same form
    el.insertAdjacentElement('afterend', box);
  }

  // Try on DOM ready…
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectAICaveat);
  } else {
    injectAICaveat();
  }

  // …and also observe in case the input dock is mounted later
  const obs = new MutationObserver(() => {
    if (document.getElementById('inputContainer')) {
      injectAICaveat();
      obs.disconnect();
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
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
  maybeShowScrollIcon();
}
