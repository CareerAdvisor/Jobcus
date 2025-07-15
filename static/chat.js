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
    if (data.suggestJobs) fetchJobs(message);
  })
  .catch(() => {
    appendAIMessage("⚠️ An error occurred while getting your response.");
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
  .catch(err => console.error("Job fetch error:", err));
}

function appendUserMessage(text) {
  const chatbox = document.getElementById("chatbox");
  const div = document.createElement("div");
  div.className = "chat-entry user";
  div.innerHTML = `<p style="font-size: 1.1rem; font-weight: 600; color: #111;">${text}</p>`;
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

function displayJobListings(data) {
  const container = document.getElementById("job-results");
  container.innerHTML = ""; // Clear previous

  const allJobs = [...(data.remotive || []), ...(data.adzuna || []), ...(data.jsearch || [])];

  if (!allJobs.length) return;

  allJobs.forEach(job => {
    const div = document.createElement("div");
    div.className = "job-card";
    div.innerHTML = `
      <h3>${job.title}</h3>
      <p class="company">${job.company}</p>
      <p class="location">${job.location}</p>
      <a href="${job.url}" target="_blank" class="view-link">View Job</a>
    `;
    container.appendChild(div);
  });
}

function saveChatToStorage() {
  localStorage.setItem("chatHistory", document.getElementById("chatbox").innerHTML);
  localStorage.setItem("jobResults", document.getElementById("job-results").innerHTML);
}

function loadChatFromStorage() {
  const chatSaved = localStorage.getItem("chatHistory");
  const jobSaved = localStorage.getItem("jobResults");

  if (chatSaved) {
    document.getElementById("chatbox").innerHTML = chatSaved;
  }
  if (jobSaved) {
    document.getElementById("job-results").innerHTML = jobSaved;
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
  localStorage.removeItem("jobResults");
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
