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

if (form && input && chatbox) {
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
    const rawText = data.reply;
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
    let i = 0;
    let buffer = "";

    function typeWriterEffect() {
      if (i < rawText.length) {
        buffer += rawText[i];
        targetDiv.textContent = buffer;
        i++;
        scrollToBottom();
        setTimeout(typeWriterEffect, 5);
      } else {
        targetDiv.innerHTML = marked.parse(buffer);
        saveChatToStorage();
      }
    }

    typeWriterEffect();

    if (data.suggestJobs) await fetchJobs(message, aiBlock);

    saveChatToStorage(); // extra save after job fetch
    scrollToBottom();
    maybeShowScrollIcon();
  });
}

function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

// === On Page Load Restore Chat ===
window.addEventListener("DOMContentLoaded", () => {
  const chatbox = document.getElementById("chatbox"); // re-declare it here just in case
  if (!chatbox) return;

  const saved = localStorage.getItem("chatHistory");
  if (saved) {
    chatbox.innerHTML = saved;
  }

  maybeShowScrollIcon();
});

function saveChatToStorage() {
  localStorage.setItem("chatHistory", chatbox.innerHTML);
}

function scrollToBottom() {
  chatbox.scrollTop = chatbox.scrollHeight;
}

function maybeShowScrollIcon() {
  const chatbox = document.getElementById("chatbox");
  const scrollIcon = document.getElementById("scrollDown");

  if (!scrollIcon) return;
  if (chatbox.scrollHeight > chatbox.clientHeight + 20) {
    scrollIcon.style.display = "block";
  } else {
    scrollIcon.style.display = "none";
  }
}

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
