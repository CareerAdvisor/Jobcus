// === Chat Suggestions Insertion ===
function insertSuggestion(text) {
  document.getElementById("userInput").value = text;
  document.getElementById("userInput").focus();
}

// === Toggle Mobile Menu ===
function toggleMobileMenu() {
  const menu = document.getElementById("mobileMenu");
  if (menu) menu.classList.toggle("show");
}

// === Share Page ===
function sharePage() {
  navigator.clipboard.writeText(window.location.href);
  alert("Link copied!");
}

// === Chat Form Submission ===
const form = document.getElementById("inputContainer");
const input = document.getElementById("userInput");
const chatbox = document.getElementById("chatbox");
const prompt = document.getElementById("prompt");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  const res = await fetch("/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  const data = await res.json();
  input.value = "";
  if (prompt) prompt.style.display = "none";

  document.getElementById("mainContainer").classList.add("chat-started");
  document.getElementById("inputContainer").classList.remove("centered-input");
  document.getElementById("inputContainer").classList.add("chat-started-input");

  const aiBlock = document.createElement("div");
  aiBlock.className = "chat-entry";
  const existingEntries = document.querySelectorAll(".chat-entry").length;

  aiBlock.innerHTML = `
    <div class='user-question'><h2>${message}</h2></div>
    <div class='ai-answer'>
      <img src='/static/icons/copy.svg' alt='Copy' class='copy-icon'>
      <span class="typed-response"></span>
    </div>
    ${existingEntries > 0 ? "<hr>" : ""}
  `;
  chatbox.prepend(aiBlock);

  const typedSpan = aiBlock.querySelector(".typed-response");
  const replyText = marked.parse(data.reply);
  const typingSpeed = 2;

  (async () => {
    for (let i = 0; i <= replyText.length; i++) {
      typedSpan.innerHTML = replyText.slice(0, i);
      await new Promise((res) => setTimeout(res, typingSpeed));
    }

    aiBlock.querySelector(".copy-icon").onclick = () => navigator.clipboard.writeText(data.reply);
    const existingHistory = localStorage.getItem("chatHistory") || "";
    const updatedHistory = aiBlock.outerHTML + existingHistory;
    localStorage.setItem("chatHistory", updatedHistory);
    maybeShowScrollIcon();

    if (data.suggestJobs) {
      await fetchJobs(message, aiBlock);
    }
  })();
});

// === Auto Resize Textarea ===
function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

// === Restore Chat History on Load ===
window.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem("chatHistory");
  if (saved) {
    chatbox.innerHTML = saved;
    if (prompt) prompt.style.display = "none";
    document.querySelector("main").classList.add("chat-started");
  }
  maybeShowScrollIcon();
});

// === Voice Input ===
document.getElementById("mic-button").addEventListener("click", () => {
  const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
  recognition.lang = "en-US";
  recognition.start();
  recognition.onresult = (e) => {
    input.value = e.results[0][0].transcript;
  };
});

// === Enter to Send ===
input.addEventListener("keypress", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.dispatchEvent(new Event("submit"));
  }
});

// === Clear Chat ===
function clearChat() {
  chatbox.innerHTML = "";
  if (prompt) prompt.style.display = "block";
  localStorage.removeItem("chatHistory");
  document.querySelector("main").classList.remove("chat-started");
  const scrollIcon = document.getElementById("scrollDown");
  if (scrollIcon) scrollIcon.style.display = "none";
}

// === Scroll Control ===
function scrollToBottom() {
  chatbox.scrollTo({ top: 0, behavior: "smooth" });
}

function maybeShowScrollIcon() {
  const chatbox = document.getElementById("chatbox");
  const scrollIcon = document.getElementById("scrollDown");
  if (!chatbox || !scrollIcon) return;

  scrollIcon.style.display = chatbox.scrollHeight > chatbox.clientHeight ? "block" : "none";
}

window.addEventListener("load", maybeShowScrollIcon);
window.addEventListener("resize", maybeShowScrollIcon);

// === Fetch Jobs ===
async function fetchJobs(query, aiBlock) {
  try {
    const res = await fetch("/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, location: "", jobType: "" }),
    });
    const data = await res.json();
    displayJobs(data, aiBlock);
  } catch (err) {
    console.error("Job fetch error:", err);
  }
}

function displayJobs(data, aiBlock) {
  const aiAnswerBlock = aiBlock.querySelector(".ai-answer");
  if (!aiAnswerBlock) return;

  const jobsContainer = document.createElement("div");
  jobsContainer.className = "job-listings";

  const allJobs = [...(data.remotive || []), ...(data.adzuna || []), ...(data.jsearch || [])];

  if (allJobs.length === 0) {
    jobsContainer.innerHTML = "<p>No jobs found for this query.</p>";
  } else {
    allJobs.forEach((job) => {
      const jobCard = document.createElement("div");
      jobCard.className = "job-card";
      jobCard.innerHTML = `
        <h3>${job.title}</h3>
        <p><strong>${job.company}</strong> – ${job.location}</p>
        <a href="${job.url}" target="_blank">View Job</a>
      `;
      jobsContainer.appendChild(jobCard);
    });
  }

  aiBlock.appendChild(jobsContainer);
}
