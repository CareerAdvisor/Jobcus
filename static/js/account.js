// static/js/account.js

// ─── 1) (Optional) Force cookies on every fetch ───
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || 'same-origin';
    return _fetch(input, init);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  const form        = document.getElementById("accountForm");
  const modeInput   = document.getElementById("mode");          // hidden input
  const toggleLink  = document.getElementById("toggleMode");    // the “Sign Up” / “Sign In” toggle
  const promptSpan  = document.getElementById("togglePrompt");  // “Don’t have an account?” text
  const submitBtn   = document.getElementById("submitButton");
  const titleEl     = document.querySelector(".auth-title");
  const subtitleEl  = document.querySelector(".auth-subtitle");
  const flashEl     = document.getElementById("flashMessages");

  // Create & return the Full Name field wrapper
  function createNameField() {
    const wrapper = document.createElement("div");
    wrapper.className = "form-group";
    wrapper.id = "nameGroup";
    wrapper.innerHTML = `
      <label for="name">Full Name</label>
      <input
        type="text"
        id="name"
        name="name"
        placeholder="Your full name"
        required
      />
    `;
    return wrapper;
  }

  // Insert or remove the name field just above the email group
  function syncNameField(show) {
    const emailGroup = document.getElementById("email").closest(".form-group");
    const existing   = document.getElementById("nameGroup");
    if (show && !existing) {
      form.insertBefore(createNameField(), emailGroup);
    } else if (!show && existing) {
      existing.remove();
    }
  }

  function updateView() {
    const isLogin = modeInput.value === "login";

    // 1) show/hide the Full Name field
    syncNameField(!isLogin);

    // 2) update titles, subtitles, buttons, prompts
    if (isLogin) {
      titleEl.innerHTML      = "Sign In to<br>Jobcus";
      subtitleEl.textContent = "Good to see you again! Welcome back.";
      submitBtn.textContent  = "Sign In";
      promptSpan.textContent = "Don’t have an account?";
      toggleLink.textContent = "Sign Up";
    } else {
      titleEl.innerHTML      = "Sign Up to<br>Jobcus";
      subtitleEl.textContent = "Create a free account to get started.";
      submitBtn.textContent  = "Sign Up";
      promptSpan.textContent = "Already have an account?";
      toggleLink.textContent = "Sign In";
    }

    // 3) clear any old flash
    flashEl.textContent = "";
  }

  // Toggle between login / signup
  toggleLink.addEventListener("click", e => {
    e.preventDefault();
    modeInput.value = (modeInput.value === "login" ? "signup" : "login");
    updateView();
  });

  // Initialize UI on page load
  updateView();

  // Handle actual form submission via fetch(JSON)
  form.addEventListener("submit", async e => {
    e.preventDefault();
    flashEl.textContent = "";

    const email    = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const name     = document.getElementById("name")?.value.trim() || "";
    const mode     = modeInput.value;

    try {
      const res  = await fetch("/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, email, password, name })
      });
      const data = await res.json();

      if (data.success) {
        window.location.href = data.redirect;
      } else {
        flashEl.textContent = data.message || "Something went wrong. Please try again.";
      }
    } catch (err) {
      console.error("Account request failed:", err);
      flashEl.textContent = "Server error. Please try again later.";
    }
  });
});
