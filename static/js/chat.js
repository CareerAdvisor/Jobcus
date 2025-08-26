// static/js/chat.js

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
document.addEventListener("DOMContentLoaded", () => {
  // ───── Storage model
  const STORAGE = {
    current: "jobcus:chat:current",   // [{role:'user'|'assistant', content:'...'}]
    history: "jobcus:chat:history"    // [{id,title,created,messages:[...] }]
  };

  // ───── DOM refs
  const chatbox = document.getElementById("chatbox");
  const form    = document.getElementById("chat-form");
  const input   = document.getElementById("userInput");

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
    const existing = document.getElementById("welcomeBanner");
    chatbox.innerHTML = "";
    if (existing) {
      chatbox.appendChild(existing.cloneNode(true));
      return;
    }
    chatbox.innerHTML = `
      <div class="welcome" id="welcomeBanner">
        <p class="welcome-title">👋 Welcome! How can I help you today?</p>
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
        // user message: show as a heading-like title
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

  // ───── Clear conversation: archive → history, then reset current
  window.clearChat = function(){
    const current = getCurrent();
    if (current.length){
      const entry = {
        id: Date.now().toString(36),
        title: firstUserTitle(current),
        created: new Date().toISOString(),
        messages: current
      };
      const hist = getHistory();
      hist.unshift(entry);          // most recent first
      setHistory(hist);
    }
    setCurrent([]);                 // reset current
    renderChat([]);                 // show suggestions/welcome
    renderHistory();                // refresh sidebar history
  };

  // ───── Save one message (call this wherever you add messages)
  window.saveMessage = function(role, content){
    const msgs = getCurrent();
    msgs.push({ role, content });
    setCurrent(msgs);
  };

  // ───── Credits panel updater (kept from your code)
  function refreshCreditsPanel() {
    const planEl  = document.getElementById("credits-plan");
    const leftEl  = document.getElementById("credits-left");
    const resetEl = document.getElementById("credits-reset");
    if (!planEl && !leftEl && !resetEl) return;
  
    const serverPlan = planEl?.dataset.plan;              // ← from Jinja
    const PLAN = (serverPlan || localStorage.getItem("userPlan") || "free");
  
    // keep localStorage in sync if server provided a value
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
  chatMenuToggle?.addEventListener("click", openChatMenu);
  chatOverlay?.addEventListener("click", closeChatMenu);
  chatCloseBtn?.addEventListener("click", closeChatMenu);
  document.addEventListener("keydown", (e)=>{ if (e.key === "Escape") closeChatMenu(); });

  // ───── Wire “New chat” & “Clear conversation” buttons (support either ids or inline onclick)
  document.getElementById("newChatBtn")?.addEventListener("click", () => { clearChat(); closeChatMenu(); });
  document.getElementById("clearChatBtn")?.addEventListener("click", () => { clearChat(); closeChatMenu(); });

  // ───── Initial render
  renderChat(getCurrent());
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

      // Add user message to UI + storage
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

      // Placeholder AI block
      const aiBlock = document.createElement("div");
      aiBlock.className = "chat-entry ai-answer";
      chatbox.appendChild(aiBlock);
      scrollToAI(aiBlock);

      // count a message for credits
      const usedNow = Number(localStorage.getItem("chatUsed") || 0) + 1;
      localStorage.setItem("chatUsed", usedNow);
      refreshCreditsPanel();

      // Fetch AI
      let finalReply = "";
      try {
        const res = await fetch("/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });
        const data = await res.json();
        finalReply = data.reply || "";
      } catch (err) {
        console.error("AI error:", err);
        finalReply = "Sorry, I ran into an issue. Please try again.";
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

      // Typewriter effect
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
          // Save assistant message after it completes
          saveMessage("assistant", finalReply);
          scrollToAI(aiBlock);
          maybeShowScrollIcon();
        }
      })();

      // Optionally fetch jobs if API returns suggestJobs
      // (uncomment if your /ask returns { suggestJobs: true })
      /*
      if (data && data.suggestJobs) {
        await fetchJobs(message, aiBlock);
      }
      */
    });

    // Wire the paper-plane icon
    const sendBtn = document.getElementById("sendButton");
    sendBtn?.addEventListener("click", () => form.dispatchEvent(new Event("submit")));

    // Auto-scroll on new nodes
    new MutationObserver(() => {
      chatbox.scrollTop = chatbox.scrollHeight;
    }).observe(chatbox, { childList: true, subtree: true });
  }
});

// ──────────────────────────────────────────────────────────────
// Optional job suggestions (kept from your previous code)
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
      <p><strong>${job.company}</strong><br>${job.location}</p>
      <a href="${job.url}" target="_blank">View Job</a>
    `;
    jobsContainer.appendChild(jobCard);
  });
  aiBlock.appendChild(jobsContainer);
}
