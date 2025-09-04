// === 1. Force fetch() to include credentials
(() => {
  const nativeFetch = window.fetch;
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || 'same-origin';
    return nativeFetch(input, init);
  };
})();

// === 2. Supabase client helper
function getSupabase() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
  if (!window.supabase || typeof window.supabase.createClient !== "function") return null;

  try {
    return window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  } catch (e) {
    console.error("Supabase init failed:", e);
    return null;
  }
}

// === 3. Flash messaging
function setFlash(message) {
  const flashBox = document.getElementById("flashMessages");
  if (!flashBox) return;
  flashBox.innerHTML = message ? `<div class="flash-item">${message}</div>` : "";
}

// === 4. Exchange session with Flask backend
async function exchangeSession(token) {
  const res = await fetch("/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: token })
  });
  if (!res.ok) throw new Error("Session exchange failed");
}

// === 5. DOM Ready
document.addEventListener("DOMContentLoaded", () => {
  const sb = getSupabase();
  if (!sb) {
    console.warn("Supabase not available on account page; using fallback.");
    setFlash("Supabase not available. Please try again later.");
    return;
  }

  const form = document.getElementById("accountForm");
  const modeInput = document.getElementById("mode");
  const nameGroup = document.getElementById("nameGroup");
  const submitBtn = document.getElementById("submitButton");
  const toggleMode = document.getElementById("toggleMode");
  const togglePrompt = document.getElementById("togglePrompt");
  const formTitle = document.querySelector(".auth-title");
  const subtitle = document.querySelector(".auth-subtitle");

  // --- Update form appearance based on mode ---
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

  toggleMode.addEventListener("click", e => {
    e.preventDefault();
    modeInput.value = (modeInput.value === "login") ? "signup" : "login";
    updateView();
  });

  updateView(); // Initial state

  // --- Submit form ---
  form.addEventListener("submit", async e => {
    e.preventDefault();
    setFlash("");

    const mode = modeInput.value;
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const fullname = document.getElementById("name")?.value.trim() || "";

    try {
      if (mode === "login") {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
        await exchangeSession(data.session.access_token);
        location.href = "/dashboard";
      } else {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullname },
            emailRedirectTo: `${location.origin}/account`
          }
        });
        if (error) throw new Error(error.message);

        // Optional: add profile to server DB
        await fetch("/auth/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, fullname })
        });

        if (data.session?.access_token) {
          await exchangeSession(data.session.access_token);
          location.href = "/dashboard";
        } else {
          setFlash("Check your email to confirm your account.");
        }
      }
    } catch (err) {
      console.error(err);
      setFlash(err.message || "Something went wrong.");
    }
  });
});
