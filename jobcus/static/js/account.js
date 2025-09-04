// static/js/account.js (Backend-Driven Authentication Version)

// 1. Force fetch() to include credentials
(() => {
  const nativeFetch = window.fetch;
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || 'same-origin';
    return nativeFetch(input, init);
  };
})();

// 2. Flash message helper
function setFlash(message) {
  const flashBox = document.getElementById("flashMessages");
  if (!flashBox) return;
  flashBox.innerHTML = message ? `<div class="flash-item">${message}</div>` : "";
}

// 3. DOM ready + Backend-driven Auth (clean version)
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("accountForm");
  const modeInput = document.getElementById("mode");
  const nameGroup = document.getElementById("nameGroup");
  const submitBtn = document.getElementById("submitButton");
  const toggleMode = document.getElementById("toggleMode");
  const togglePrompt = document.getElementById("togglePrompt");
  const formTitle = document.querySelector(".auth-title");
  const subtitle = document.querySelector(".auth-subtitle");

  function updateView() {
    const mode = modeInput.value;
    if (mode === "login") {
      nameGroup.style.display = "none";
      submitBtn.textContent = "Sign In";
      togglePrompt.textContent = "Don’t have an account?";
      toggleMode.textContent = "Sign Up";
      formTitle.innerHTML = "Sign In to<br>Jobcus";
      subtitle.textContent = "Good to see you again! Welcome back.";
    } else {
      nameGroup.style.display = "block";
      submitBtn.textContent = "Sign Up";
      togglePrompt.textContent = "Already have an account?";
      toggleMode.textContent = "Sign In";
      formTitle.innerHTML = "Sign Up to<br>Jobcus";
      subtitle.textContent = "Create a free account to get started.";
    }
  }

  updateView();

  // Toggle sign in / sign up view
  toggleMode.addEventListener("click", (e) => {
    e.preventDefault();
    const newMode = modeInput.value === "login" ? "signup" : "login";
    modeInput.value = newMode;
    window.location.href = `/account?mode=${newMode}`;
  });

  // Form submission
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setFlash("");

    const mode = modeInput.value;
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const name = document.getElementById("name")?.value.trim() || "";

    try {
      const response = await fetch("/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, email, password, name }),
      });

      const data = await response.json();
      if (data.success && data.redirect) {
        window.location.href = data.redirect;
      } else {
        setFlash(data.message || "Login or signup failed. Please try again.");
      }
    } catch (err) {
      console.error("Auth error:", err);
      setFlash("Server error. Try again.");
    }
  });
});
