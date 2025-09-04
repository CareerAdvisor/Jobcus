// /static/js/chat.js

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
// Small utilities (kept from your original, with a couple helpers)
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
// Server call helper (tries /api/ask then falls back to /chat/ask)
// also handles auth + JSON/HTML responses robustly
// ──────────────────────────────────────────────────────────────
// inside the submit handler, after you set currentModel
  async function sendMessage(msg) {
    const data = await apiFetch('/api/ask', { ... });
  }
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const finalReply = (data && data.reply) ? String(data.reply) : "Sorry, I didn't get a response.";

    // Handle auth redirects/401s clearly
    if (res.status === 401) {
      window.location = '/account?next=' + encodeURIComponent(location.pathname);
      throw { kind: 'auth', message: 'Unauthorized' };
    }

    const ct = res.headers.get('content-type') || '';

    if (!res.ok) {
      // Helpful guard to avoid Unexpected token '<'
      const text = await res.text();
      // special-case limit/quota signaling
      let data = null;
      try { data = JSON.parse(text); } catch {}
      if ((res.status === 402 && data?.error === 'quota_exceeded') ||
          (res.status === 429 && (data?.error === 'too_many_free_accounts' || data?.error === 'quota_exceeded'))) {
        showUpgradeBanner('You have reached the limit for the free version, upgrade to enjoy more features');
        throw { kind: 'limit', message: data?.message || 'Free limit reached' };
      }
      throw { kind: 'server', message: (data?.message || data?.reply || `Request failed (${res.status})`) };
    }

    if (ct.includes('application/json')) {
      return res.json();
    } else {
      // last-ditch parse if server mislabeled JSON
      try { return JSON.parse(await res.text()); } catch { return null; }
    }
  }

  // Your two requested snippets, combined:
  // 1) Try '/api/ask'
  //    await fetch('/api/ask', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
  // 2) If that 404s, fall back to '/chat/ask'
  //    await fetch('/chat/ask', { ... });

  try {
    return await post('/api/ask');
  } catch (e) {
    // only fall back on not-found/misdirected endpoints
    if (e?.kind === 'limit' || e?.kind === 'auth' || e?.kind === 'server') throw e; // real error
    try {
      return await post('/chat/ask');
    } catch (e2) {
      throw e2;
    }
  }
}

// ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Init model UI/logic first
  const modelCtl = initModelControls();

  // Storage keys
  const STORAGE = {
    current: "jobcus:chat:current",   // [{role:'user'|'assistant', content:'...'}]
    history: "jobcus:chat:history"    // [{id,title,created,messages:[...] }]
  };

  // DOM refs
  const chatbox = document.getElementById("chatbox");
  const form    = document.getElementById("chat-form");
  const input   = document.getElementById("userInput");

  const escapeHtml = (s='') => s
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

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
    const shell   = document.getElementById("chatShell");
    const fname   = (shell?.dataset.firstName || "there");
    chatbox.innerHTML = `
      <div class="welcome" id="welcomeBanner">
        <p class="welcome-title">Welcome back, ${escapeHtml(fname)}. How can I help you today?</p>
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
      renderChat([]);
      renderHistory();
    } finally {
      setTimeout(() => { clearInProgress = false; }, 50);
    }
  };

  function refreshCreditsPanel() {
    const planEl  = document.getElementById("credits-plan");
    const leftEl  = document.getElementById("credits-left");
    const resetEl = document.getElementById("credits-reset");
    if (!planEl && !leftEl && !resetEl) return;

    const serverPlan = planEl?.dataset.plan;
    const PLAN = (serverPlan || localStorage.getItem("userPlan") || "free");
    if (serverPlan) localStorage.setItem("userPlan", serverPlan);

    const QUOTAS = {
      free:     { label: "Free",     reset: "Trial",           max: 15 },
      weekly:   { label: "Weekly",   reset: "Resets weekly",   max: 200 },
      standard: { label: "Standard", reset: "Resets monthly",  max: 800 },
      premium:  { label: "Premium",  reset: "Resets yearly",   max: 12000 }
    };
    const q    = QUOTAS[PLAN] || QUOTAS.free;
    const used = Number(localStorage.getItem("chatUsed") || 0);
    const left = Math.max(q.max - used, 0);

    planEl  && (planEl.textContent  = q.label);
    leftEl  && (leftEl.textContent  = `${left} of ${q.max}`);
    resetEl && (resetEl.textContent = q.reset);
  }

  const chatMenuToggle = document.getElementById("chatMenuToggle");
  const chatMenu       = document.getElementById("chatSidebar");
  const chatOverlay    = document.getElementById("chatOverlay");
  const chatCloseBtn   = document.getElementById("chatSidebarClose");

  function openChatMenu(){
    if (!chatMenu) return;
    chatMenu.classList.add("is-open");
    chatMenu.setAttribute("aria-hidden","false");
    if (chatOverlay) chatOverlay.hidden = false;
    document.documentElement.style.overflow = "hidden";
  }
  function closeChatMenu(){
    if (!chatMenu) return;
    chatMenu.classList.remove("is-open");
    chatMenu.setAttribute("aria-hidden","true");
    if (chatOverlay) chatOverlay.hidden = true;
    document.documentElement.style.overflow = "";
  }
  window.closeChatMenu = closeChatMenu;

  chatMenuToggle?.addEventListener("click", openChatMenu);
  chatOverlay?.addEventListener("click", closeChatMenu);
  chatCloseBtn?.addEventListener("click", closeChatMenu);
  document.addEventListener("keydown", (e)=>{ if (e.key === "Escape") closeChatMenu(); });

  document.getElementById("newChatBtn")?.addEventListener("click", () => { clearChat(); closeChatMenu(); });
  document.getElementById("clearChatBtn")?.addEventListener("click", () => { clearChat(); closeChatMenu(); });

  renderChat(getCurrent());
  renderHistory();
  refreshCreditsPanel();
  maybeShowScrollIcon();

  // ---- send handler (drop-in) ----
  form.addEventListener("submit", async (evt) => {
    evt.preventDefault();
  
    const message = (input.value || "").trim();
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
  
    saveMessage("user", message);
  
    input.value = "";
    autoResize(input);
  
    const aiBlock = document.createElement("div");
    aiBlock.className = "chat-entry ai-answer";
    chatbox.appendChild(aiBlock);
    scrollToAI(aiBlock);
  
    let finalReply = "";
    const currentModel = modelCtl.getSelectedModel();
  
    try {
      disableComposer(true);
  
      // POST to your API; apiFetch is from base.js (adds CSRF + credentials)
      const payload = { message, model: currentModel };
      const data = await apiFetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }); // must return { reply, modelUsed }
  
      finalReply = (data && data.reply) ? String(data.reply) : "Sorry, I didn't get a response.";
    } catch (err) {
      if (err?.kind === "limit") {
        aiBlock.innerHTML = `<p style="margin:8px 0;color:#a00;">${escapeHtml(err.message || "Free limit reached.")}</p><hr class="response-separator" />`;
        return;
      }
      aiBlock.innerHTML = `<p style="margin:8px 0;color:#a00;">${escapeHtml(err.message || "Sorry, something went wrong.")}</p><hr class="response-separator" />`;
      return;
    } finally {
      disableComposer(false);
      input.focus();
    }
  
    const copyId = `ai-${Date.now()}`;
    aiBlock.innerHTML = `
      <div id="${copyId}" class="markdown"></div>
      <div class="response-footer">
        <span class="copy-wrapper">
          <img src="/static/icons/copy.svg" class="copy-icon"
               title="Copy" onclick="copyToClipboard('${copyId}')">
          <span class="copy-text">Copy</span>
        </span>
      </div>
      <hr class="response-separator" />
    `;
    const targetDiv = document.getElementById(copyId);
  
    let i = 0, buffer = "";
    (function typeWriter() {
      if (i < finalReply.length) {
        buffer += finalReply[i++];
        targetDiv.textContent = buffer;
        scrollToAI(aiBlock);
        setTimeout(typeWriter, 5);
      } else {
        if (window.marked && typeof window.marked.parse === "function") {
          targetDiv.innerHTML = window.marked.parse(buffer);
        } else {
          targetDiv.textContent = buffer;
        }
        saveMessage("assistant", finalReply);
  
        const usedNow = Number(localStorage.getItem("chatUsed") || 0) + 1;
        localStorage.setItem("chatUsed", usedNow);
        refreshCreditsPanel();
        if (window.syncState) window.syncState();
  
        scrollToAI(aiBlock);
        maybeShowScrollIcon();
      }
    })();
  });

    const sendBtn = document.getElementById("sendButton");
    sendBtn?.addEventListener("click", () => form.dispatchEvent(new Event("submit")));

    new MutationObserver(() => {
      const box = document.getElementById("chatbox");
      if (box) box.scrollTop = box.scrollHeight;
    }).observe(chatbox, { childList: true, subtree: true });
  }
});

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
  } catch (err) {
    console.error("Job fetch error:", err);
  }
}
function displayJobs(data, aiBlock) {
  const jobsContainer = document.createElement("div");
  jobsContainer.className = "job-listings";
  const allJobs = [...(data.remotive || []), ...(data.adzuna || []), ...(data.jsearch || [])];
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
}
