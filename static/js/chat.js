// static/js/chat.js

// === Utility: remove welcome once chat starts ===
function removeWelcome() {
  const banner = document.getElementById("welcomeBanner");
  if (banner) banner.remove();
}

// === Chat Suggestions Insertion ===
function insertSuggestion(text) {
  const input = document.getElementById("userInput");
  input.value = text;
  input.focus();
}

// === Toggle Mobile Menu ===
const hamburger   = document.getElementById("hamburger");
const mobileMenu  = document.getElementById("mobileMenu");
const menuOverlay = document.getElementById("menuOverlay");

if (hamburger && mobileMenu && menuOverlay) {
  hamburger.addEventListener("click", () => {
    mobileMenu.classList.toggle("active");
    menuOverlay.classList.toggle("active");
  });
  menuOverlay.addEventListener("click", () => {
    mobileMenu.classList.remove("active");
    menuOverlay.classList.remove("active");
  });
}

// === Share Page ===
function sharePage() {
  navigator.clipboard.writeText(window.location.href);
  alert("Link copied!");
}

// === Auto-resize textarea ===
function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

// === Copy to clipboard for AI replies ===
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

// === Clear chat history ===
function clearChat() {
  const chatboxEl = document.getElementById("chatbox");
  chatboxEl.innerHTML = "";
  document.getElementById("job-results").innerHTML = "";
  localStorage.removeItem("chatHistory");
}

// === Mic & Attach placeholders ===
function handleMic() {
  alert("Voice input coming soon!");
}
function handleAttach() {
  alert("File upload coming soon!");
}

// === Fetch job suggestions after AI reply ===
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
  saveChatToStorage();
  scrollToAI(aiBlock);
}

// === Save & restore chat history ===
function saveChatToStorage() {
  const chatboxEl = document.getElementById("chatbox");
  localStorage.setItem("chatHistory", chatboxEl.innerHTML);
}

// === Scroll helpers ===
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

// === Main chat logic ===
window.addEventListener("DOMContentLoaded", () => {
  const form      = document.getElementById("chat-form");
  const input     = document.getElementById("userInput");
  const chatboxEl = document.getElementById("chatbox");

  if (form && input && chatboxEl) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const message = input.value.trim();
      if (!message) return;

      // 1) Remove welcome banner & suggestions
      removeWelcome();

      // 2) Display user message
      const userMsg = document.createElement("div");
      userMsg.className = "chat-entry user";
      userMsg.innerHTML = `
        <h2 style="
          font-size: 1.5rem;
          font-weight: 600;
          margin: 0 0 0.5rem;
          color: #104879;
        ">
          ${message}
        </h2>
      `;

      chatboxEl.appendChild(userMsg);

      // 3) Clear & resize input
      input.value = "";
      autoResize(input);

      // 4) Placeholder for AI response
      const aiBlock = document.createElement("div");
      aiBlock.className = "chat-entry ai-answer";
      chatboxEl.appendChild(aiBlock);
      scrollToAI(aiBlock);

      // ✅ UPDATE CREDITS *right after* queuing the message, before the fetch:
      const usedNow = Number(localStorage.getItem("chatUsed") || 0) + 1;
      localStorage.setItem("chatUsed", usedNow);
      if (typeof refreshCreditsPanel === "function") refreshCreditsPanel();

      // 5) Fetch AI reply
      const res  = await fetch("/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      const raw  = data.reply || "";

      // 6) Typewriter effect + markdown
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
      // after aiBlock.innerHTML setup...
      const targetDiv = document.getElementById(copyId);
      let i = 0, buffer = "";

      (function typeWriter() {
        if (i < raw.length) {
          buffer += raw[i++];
          targetDiv.textContent = buffer;
          scrollToAI(aiBlock);
          setTimeout(typeWriter, 5);
        } else {
          // use marked if available, otherwise plain text
          if (window.marked && typeof window.marked.parse === 'function') {
            targetDiv.innerHTML = window.marked.parse(buffer);
          } else {
            targetDiv.textContent = buffer;
          }
          saveChatToStorage();
          scrollToAI(aiBlock);
        }
      })();

      // 7) Job suggestions if present
      if (data.suggestJobs) await fetchJobs(message, aiBlock);

      // 8) Finalize storage & scroll
      saveChatToStorage();
      maybeShowScrollIcon();
    });

    // Wire the send button (for mobile icon)
    const sendBtn = document.getElementById("sendButton");
    if (sendBtn) sendBtn.addEventListener("click", () => form.dispatchEvent(new Event("submit")));

    // Restore saved history
    const saved = localStorage.getItem("chatHistory");
    if (saved) chatboxEl.innerHTML = saved;
    maybeShowScrollIcon();

    // Auto-scroll on new messages
    new MutationObserver(() => {
      chatboxEl.scrollTop = chatboxEl.scrollHeight;
    }).observe(chatboxEl, { childList: true, subtree: true });
  }

  function refreshCreditsPanel() {
  const planEl  = document.getElementById("credits-plan");
  const leftEl  = document.getElementById("credits-left");
  const resetEl = document.getElementById("credits-reset");
  if (!planEl && !leftEl && !resetEl) return;

  const PLAN = (localStorage.getItem("userPlan") || "free");
  const QUOTAS = {
    free:     { label: "Free",     reset: "Trial",           max: 15    },
    weekly:   { label: "Weekly",   reset: "Resets weekly",   max: 200   },
    standard: { label: "Standard", reset: "Resets monthly",  max: 800   },
    premium:  { label: "Premium",  reset: "Resets yearly",   max: 12000 }
  };

  const q    = QUOTAS[PLAN] || QUOTAS.free;
  const used = Number(localStorage.getItem("chatUsed") || 0);
  const left = Math.max(q.max - used, 0);

  planEl  && (planEl.textContent  = q.label);
  leftEl  && (leftEl.textContent  = `${left} of ${q.max}`);
  resetEl && (resetEl.textContent = q.reset);
} 

  function gateChatStart() {
  const params = new URLSearchParams(location.search);
  const allowed = params.get('start') === '1';
  const form = document.getElementById('chat-form');
  const chatbox = document.getElementById('chatbox');

  if (!allowed && form && chatbox) {
    form.hidden = true;

    const gate = document.createElement('div');
    gate.className = 'chat-start-gate';
    gate.innerHTML = `
      <div style="max-width:760px;margin:16px auto;padding:16px;border:1px solid #e5e7eb;border-radius:12px;background:#fff">
        <h3 style="margin:0 0 8px;color:#104879">Ready to start?</h3>
        <p style="margin:0 0 12px;color:#475569">Review your credits above, then begin a conversation.</p>
        <button id="startChatBtn" class="btn btn-primary">Start chatting</button>
      </div>`;
    chatbox.prepend(gate);

    gate.querySelector('#startChatBtn').addEventListener('click', () => {
      form.hidden = false;
      gate.remove();
    });
  }
}
window.addEventListener('DOMContentLoaded', gateChatStart);

});
