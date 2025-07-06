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
const form = document.getElementById("inputContainer");
const input = document.getElementById("userInput");
const chatbox = document.getElementById("chatbox");
const prompt = document.getElementById("prompt");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  console.log("Sending message:", message);  // <== Add this

  const res = await fetch("/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  const data = await res.json();
  console.log("Received AI reply:", data);  // <== Add this

  input.value = "";
  prompt.style.display = 'none';
  document.getElementById('mainContainer').classList.add('chat-started'); 
  document.getElementById('inputContainer').classList.remove('centered-input');
  document.getElementById('inputContainer').classList.add('chat-started-input');

  const aiBlock = document.createElement("div");
  aiBlock.className = "chat-entry";
  const existingEntries = document.querySelectorAll(".chat-entry").length;
  aiBlock.innerHTML = `
    <div class='user-question'><h2>\${message}</h2></div>
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
      await new Promise(res => setTimeout(res, typingSpeed));
    }
    
    aiBlock.querySelector(".copy-icon").onclick = () => navigator.clipboard.writeText(data.reply);
    const existingHistory = localStorage.getItem("chatHistory") || "";
    const updatedHistory = aiBlock.outerHTML + existingHistory;
    localStorage.setItem("chatHistory", updatedHistory);
    maybeShowScrollIcon();

    if (data.suggestJobs) {
      await fetchJobs(message);
    }
  })();
  });

// === On Page Load Restore Chat ===
window.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem("chatHistory");
  if (saved) {
    chatbox.innerHTML = saved;
    prompt.style.display = 'none';
    document.querySelector("main").classList.add("chat-started");
  }
  maybeShowScrollIcon();
});

// === Voice Input ===
document.getElementById("mic-button").addEventListener("click", () => {
  const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
  recognition.lang = 'en-US';
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
  prompt.style.display = 'block';
  localStorage.removeItem("chatHistory");
  document.querySelector("main").classList.remove("chat-started");
  const scrollIcon = document.getElementById("scrollDown");
  if (scrollIcon) scrollIcon.style.display = "none";
}

// === Scroll Control ===
function scrollToBottom() {
  chatbox.scrollTo({ top: 0, behavior: 'smooth' });
}

function maybeShowScrollIcon() {
  const chatbox = document.getElementById("chatbox");
  const scrollIcon = document.getElementById("scrollDown");
  if (chatbox.scrollHeight > chatbox.clientHeight) {
    scrollIcon.style.display = "block";
  } else {
    scrollIcon.style.display = "none";
  }
}
window.addEventListener("load", maybeShowScrollIcon);
window.addEventListener("resize", maybeShowScrollIcon);

// === Fetch Jobs ===
async function fetchJobs(query) {
  try {
    const res = await fetch("/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, location: "", jobType: "" }),
    });
    const data = await res.json();
    displayJobs(data);
  } catch (err) {
    console.error("Job fetch error:", err);
  }
}

function displayJobs(data) {
  const aiAnswerBlock = document.querySelector(".chatbox .chat-entry .ai-answer:last-child");
  if (!aiAnswerBlock) return;

  const jobsContainer = document.createElement("div");
  jobsContainer.className = "job-listings";

  const allJobs = [...(data.remotive || []), ...(data.adzuna || [])];

  if (allJobs.length === 0) {
    jobsContainer.innerHTML = "<p>No jobs found for this query.</p>";
  } else {
    allJobs.forEach(job => {
      const jobCard = document.createElement("div");
      jobCard.className = "job-card";
      jobCard.innerHTML = `
        <h3>\${job.title}</h3>
        <p><strong>${job.company}</strong> – ${job.location}</p>
        <a href="${job.url}" target="_blank">View Job</a>
      `;
      jobsContainer.appendChild(jobCard);
    });
  }

  aiAnswerBlock.appendChild(jobsContainer);

  function toggleMobileMenu() {
    const menu = document.getElementById("mobileMenu");
    menu.classList.toggle("show");
  }
