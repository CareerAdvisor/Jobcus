// ──────────────────────────────────────────────────────────────
// Small utilities
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

// ──────────────────────────────────────────────────────────────
// Model selection helpers (read from data-* on #chatShell)
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

  // Expose to other modules in this file
  return { getSelectedModel, setSelectedModel, isPaid, allowedModels };
}

// ---- Server call helper (handles limit + generic errors) ----
async function sendMessage(payload) {
  const res = await fetch('/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  function showUpgradeBanner(text){ alert(text); }
  function disableComposer(disabled){
    const i = document.getElementById('userInput');   // your IDs
    const b = document.getElementById('sendButton');
    if (i) i.disabled = !!disabled;
    if (b) b.disabled = !!disabled;
  }
  function showTransientError(text){ console.warn(text); }


  if (res.status === 402 || res.status === 403 || res.status === 429) {
    const body = await res.json().catch(() => ({}));
    const msg = body.message || body.reply || 'Limit reached.';
    // Throw a structured error so the submit handler can react
    throw { kind: 'limit', message: msg };
  }

  if (!res.ok) {
    throw { kind: 'server', message: 'Sorry, I ran into an issue. Please try again.' };
  }

  return res.json(); // expected { reply: "...", modelUsed: "..." }
}

// ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Init model UI/logic first
  const modelCtl = initModelControls();

  // ───── Storage model
  const STORAGE = {
    current: "jobcus:chat:current",   // [{role:'user'|'assistant', content:'...'}]
    history: "jobcus:chat:history"    // [{id,title,created,messages:[...] }]
  };

  // ───── DOM refs
  const chatbox = document.getElementById("chatbox");
  const form    = document.getElementById("chat-form");
  const input   = document.getElementById("userInput");

  // Build a user entry matching your renderChat() markup
  function makeUserEntry(text){
    const div = document.createElement("div");
    div.className = "chat-entry user";
    div.innerHTML = `
      <h2 style="font-size:1.5rem;font-weight:600;margin:0 0 .5rem;color:#104879;">
        ${escapeHtml(text)}
      </h2>`;
    return div;
  }

  // Build an assistant entry (same structure your renderer uses)
  function makeAssistantEntry(content){
    const div = document.createElement("div");
    div.className = "chat-entry ai-answer";
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
      <hr class="response-separator" />`;
    const target = div.querySelector(`#${id}`);
    if (window.marked && typeof window.marked.parse === "function") {
      target.innerHTML = window.marked.parse(content);
    } else {
      target.textContent = content;
    }
    return div;
  }

  // ───── Storage helpers
  const getCurrent = () => JSON.parse(localStorage.getItem(STORAGE.current) || "[]");
  const setCurrent = (arr) => localStorage.setItem(STORAGE.current, JSON.stringify(arr));
  const getHistory = () => JSON.parse(localStorage.getItem(STORAGE.history) || "[]");
  const setHistory = (arr) => localStorage.setItem(STORAGE.history, JSON.stringify(arr));

  const escapeHtml = (s='') => s
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  function firstUserTitle(messages){
    const firstUser = messages.find(m => m.role === "user");
    const raw = (firstUser?.content || "Conversation").trim();
    return raw.length > 60 ? raw.slice(0,60) + "…" : raw;
  }

  // ───── Welcome rendering (shown when no messages)
  function renderWelcome(){
    const chatbox = document.getElementById("chatbox");
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

  // ───── Message rendering (main stream)
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

  // ───── History UI (sidebar list)
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
      // open conversation
      li.addEventListener("click", (e) => {
        if (e.target.closest(".delete")) return;
        setCurrent(h.messages || []);
        renderChat(getCurrent());
        try { closeChatMenu?.(); } catch {}
      });
      // delete conversation
      li.querySelector(".delete").addEventListener("click", (e) => {
        e.stopPropagation();
        setHistory(getHistory().filter(x => x.id !== h.id));
        renderHistory();
      });
      list.appendChild(li);
    });
  }

  // ───── Save one message
  window.saveMessage = function(role, content){
    const msgs = getCurrent();
    msgs.push({ role, content });
    setCurrent(msgs);
  };

  // ───── Clear conversation (archive → history, then reset current)
  let clearInProgress = false;
  window.clearChat = function(){
    if (clearInProgress) return;
    clearInProgress = true;
    try {
      const current = getCurrent();
      if (current.length){
        const hist = getHistory();

        // prevent duplicate pushes
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

  // ───── Credits panel updater
  function refreshCreditsPanel() {
    const planEl  = document.getElementById("credits-plan");
    const leftEl  = document.getElementById("credits-left");
    const resetEl = document.getElementById("credits-reset");
    if (!planEl && !leftEl && !resetEl) return;

    const serverPlan = planEl?.dataset.plan; // from Jinja
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

  // ───── Left drawer (sidebar) toggle
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

  // Wire sidebar buttons
  document.getElementById("newChatBtn")?.addEventListener("click", () => { clearChat(); closeChatMenu(); });
  document.getElementById("clearChatBtn")?.addEventListener("click", () => { clearChat(); closeChatMenu(); });

  // ───── Initial render on page load
  renderChat(getCurrent());   // if empty -> welcome
  renderHistory();
  refreshCreditsPanel();
  maybeShowScrollIcon();

  // ───── Send flow
  if (form && input && chatbox) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const message = input.value.trim();
      if (!message) return;

      removeWelcome();

      // 1) UI: show user message
      const userMsg = document.createElement("div");
      userMsg.className = "chat-entry user";
      userMsg.innerHTML = `
        <h2 style="font-size:1.5rem;font-weight:600;margin:0 0 .5rem;color:#104879;">
          ${escapeHtml(message)}
        </h2>
      `;
      chatbox.appendChild(userMsg);

      // 2) Persist user message
      saveMessage("user", message);

      // 3) Clear input & keep sizing tidy
      input.value = "";
      autoResize(input);

      // 4) Placeholder for AI reply
      const aiBlock = document.createElement("div");
      aiBlock.className = "chat-entry ai-answer";
      chatbox.appendChild(aiBlock);
      scrollToAI(aiBlock);

      // 5) Count a message and sync
      const usedNow = Number(localStorage.getItem("chatUsed") || 0) + 1;
      localStorage.setItem("chatUsed", usedNow);
      refreshCreditsPanel();                  // keep this to update the sidebar numbers
      if (window.syncState) window.syncState();


      // 6) Fetch AI (send chosen model if any)
      let finalReply = "";
      let data = null;
      try {
        const payload = { message, model: modelCtl.getSelectedModel() };
        data = await sendMessage(payload); // <— use the helper
        finalReply = data.reply || data.message || "";
      
        // reflect server's model if provided
        if (data.modelUsed) modelCtl.setSelectedModel(data.modelUsed);
      
      } catch (err) {
        if (err && err.kind === 'limit') {
          // Quota reached
          finalReply = err.message;
          showUpgradeBanner(err.message);
          disableComposer(true);
        } else {
          // Generic server/network issue
          finalReply = "Sorry, I ran into an issue. Please try again.";
          showTransientError(finalReply);
        }
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

      // 7) Typewriter effect → then render markdown and persist assistant message
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
          // Persist assistant message after finished
          saveMessage("assistant", finalReply);

          // Optional: job suggestions if API flags it
          if (data && data.suggestJobs) {
            fetchJobs(message, aiBlock);
          }

          scrollToAI(aiBlock);
          maybeShowScrollIcon();
        }
      })();
    });

    // paper-plane icon
    const sendBtn = document.getElementById("sendButton");
    sendBtn?.addEventListener("click", () => form.dispatchEvent(new Event("submit")));

    // Auto-scroll on new nodes
    new MutationObserver(() => {
      chatbox.scrollTop = chatbox.scrollHeight;
    }).observe(chatbox, { childList: true, subtree: true });
  }
});

// ──────────────────────────────────────────────────────────────
// Optional job suggestions (unchanged)
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
