function handleKey(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    sendMessage();
  }
}

function sendMessage() {
  const input = document.getElementById("userInput");
  const message = input.value.trim();
  if (!message) return;

  appendUserMessage(message);
  input.value = "";
  autoResize(input);

  fetch("/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  })
  .then(res => res.json())
  .then(data => {
    appendAIMessage(data.reply);
    if (data.suggestJobs) fetchJobs(message);  // ✅ Required
  })
  .catch(() => {
    appendAIMessage("⚠️ Something went wrong. Please try again.");
  });
}

function fetchJobs(query) {
  fetch("/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  })
  .then(res => res.json())
  .then(data => displayJobListings(data))
  .catch(() => appendAIMessage("⚠️ Something went wrong. Please try again."));
}

function displayJobListings(data) {
  const container = document.getElementById("job-results");
  container.innerHTML = "";
  const allJobs = [...data.remotive, ...data.adzuna, ...data.jsearch];

  if (allJobs.length === 0) {
    container.innerHTML = "<p>No job listings found.</p>";
    return;
  }

  allJobs.forEach(job => {
    const div = document.createElement("div");
    div.className = "job-item";
    div.innerHTML = `
      <a href="${job.url}" target="_blank">
        <h4>${job.title}</h4>
        <p>${job.company} - ${job.location}</p>
      </a>
    `;
    container.appendChild(div);
  });
}

function appendUserMessage(text) {
  const chatbox = document.getElementById("chatbox");
  const div = document.createElement("div");
  div.className = "chat-entry user";
  div.innerHTML = `<p>${text}</p>`;
  chatbox.appendChild(div);
  saveChatToStorage();
  scrollToBottom();
}

function appendAIMessage(text) {
  const chatbox = document.getElementById("chatbox");
  const div = document.createElement("div");
  div.className = "chat-entry ai-answer";
  const copyId = `copy-${Date.now()}`;
  div.innerHTML = `
    <div style="display: flex; justify-content: flex-end;">
      <img src="/static/icons/copy.svg" class="copy-icon" title="Copy" onclick="copyToClipboard('${copyId}')">
    </div>
    <div id="${copyId}" class="markdown">${marked.parse(text)}</div>
  `;
  chatbox.appendChild(div);
  saveChatToStorage();
  scrollToBottom();
}

function saveChatToStorage() {
  localStorage.setItem("chatHistory", document.getElementById("chatbox").innerHTML);
}

function loadChatFromStorage() {
  const saved = localStorage.getItem("chatHistory");
  if (saved) {
    document.getElementById("chatbox").innerHTML = saved;
  }
}

document.addEventListener("DOMContentLoaded", loadChatFromStorage);

function scrollToBottom() {
  const chatbox = document.getElementById("chatbox");
  chatbox.scrollTop = chatbox.scrollHeight;
}

function copyToClipboard(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = el.innerText;
  navigator.clipboard.writeText(text).then(() => {
    alert("Copied!");
  });
}

function clearChat() {
  document.getElementById("chatbox").innerHTML = "";
  document.getElementById("job-results").innerHTML = "";
  localStorage.removeItem("chatHistory");
}

function handleAttach() {
  alert("File upload coming soon!");
}

function handleMic() {
  alert("Voice input coming soon!");
}

function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

function toggleMobileMenu() {
  const menu = document.getElementById("mobileMenu");
  if (menu) menu.classList.toggle("show");
}
