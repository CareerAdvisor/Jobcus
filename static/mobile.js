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
    appendAIMessage("⚠️ Something went wrong. Please try again.");
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
