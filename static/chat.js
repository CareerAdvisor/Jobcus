// === Chat Suggestions Insertion ===
function insertSuggestion(text) {
  document.getElementById("userInput").value = text;
  document.getElementById("userInput").focus();
}

// === Toggle Mobile Menu ===
const hamburger = document.getElementById("hamburger");
const mobileMenu = document.getElementById("mobileMenu");
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

// === Chat Form Submission ===
const form = document.getElementById("chat-form");
const input = document.getElementById("userInput");
const chatbox = document.getElementById("chatbox");
const prompt = document.getElementById("prompt");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  input.value = "";
  autoResize(input);

  const aiBlock = document.createElement("div");
  aiBlock.className = "chat-entry ai-answer";
  const userMsg = document.createElement("div");
  userMsg.className = "chat-entry user";
  userMsg.innerHTML = `<p style="font-size: 1.1em;"><strong>${message}</strong></p>`;
  chatbox.appendChild(userMsg);
  chatbox.appendChild(aiBlock);
  scrollToBottom();

  const res = await fetch("/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  const data = await res.json();
  const replyText = marked.parse(data.reply);
  const copyId = `ai-${Date.now()}`;
  
  aiBlock.innerHTML = `
  <div id="${copyId}" class="markdown">${replyText}</div>
  <div class="response-footer">
    <img src="/static/icons/copy.svg" class="copy-icon" title="Copy" onclick="copyToClipboard('${copyId}')">
  </div>
  <hr class="response-separator" />
`;

  if (data.suggestJobs) await fetchJobs(message, aiBlock);

  saveChatToStorage();
  scrollToBottom();
});

function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

// === On Page Load Restore Chat ===
window.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem("chatHistory");
  if (saved) {
    chatbox.innerHTML = saved;
  }
});

function saveChatToStorage() {
  localStorage.setItem("chatHistory", chatbox.innerHTML);
}

function scrollToBottom() {
  chatbox.scrollTop = chatbox.scrollHeight;
}

function copyToClipboard(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = el.innerText;
  navigator.clipboard.writeText(text).then(() => alert("Copied!"));
}

function clearChat() {
  chatbox.innerHTML = "";
  document.getElementById("job-results").innerHTML = "";
  localStorage.removeItem("chatHistory");
}

function handleMic() {
  alert("Voice input coming soon!");
}

function handleAttach() {
  alert("File upload coming soon!");
}

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

  if (allJobs.length === 0) return;

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
  scrollToBottom();
}

document.addEventListener("DOMContentLoaded", () => {
  const sendBtn = document.getElementById("sendButton");
  if (sendBtn) {
    sendBtn.addEventListener("click", () => {
      form.dispatchEvent(new Event("submit"));
    });
  }
});
