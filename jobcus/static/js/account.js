// 1) Ensure fetch always sends credentials (cookies)
(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

// 2) Supabase client (optional)
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

// 3) Helpers
(function () {
  // ---------- Helpers ----------
  const q = (sel) => document.querySelector(sel);
  const qa = (sel) => Array.from(document.querySelectorAll(sel));
  const setHidden = (el, hidden) => el && (el.style.display = hidden ? "none" : "");
  const setText = (el, txt) => el && (el.textContent = txt);
  const trim = (v) => (v || "").trim();

  // ---------- DOM ----------
  const form = q("#auth-form");
  const emailEl = q("#email");
  const passwordEl = q("#password");
  const nameWrap = q("#name-wrap");      // container div for name (shown in Sign Up)
  const nameEl = q("#full_name");        // input for name (optional)
  const submitBtn = q("#submit-btn");
  const switchToSignUp = q("#switch-to-signup");
  const switchToSignIn = q("#switch-to-signin");
  const modeLabels = qa("[data-auth-mode-label]");
  const errorBox = q("#auth-error");
  const successBox = q("#auth-success");

  // ---------- Config checks ----------
  const SUPABASE_URL = window.SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("Supabase keys missing. Set window.SUPABASE_URL and window.SUPABASE_ANON_KEY.");
  }
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ---------- State ----------
  let mode = "signin"; // 'signin' | 'signup'

  function renderMode() {
    const isSignUp = mode === "signup";
    // Update labels/buttons
    modeLabels.forEach((el) => setText(el, isSignUp ? "Create your account" : "Sign in to your account"));
    setHidden(nameWrap, !isSignUp);
    setHidden(switchToSignUp, isSignUp);
    setHidden(switchToSignIn, !isSignUp);
    setText(submitBtn, isSignUp ? "Create Account" : "Sign In");
    clearAlerts();
  }

  function clearAlerts() {
    if (errorBox) { errorBox.innerHTML = ""; errorBox.hidden = true; }
    if (successBox) { successBox.innerHTML = ""; successBox.hidden = true; }
  }

  function showError(msg) {
    if (!errorBox) return console.error(msg);
    errorBox.hidden = false;
    errorBox.innerHTML = sanitize(msg);
  }

  function showSuccess(msg) {
    if (!successBox) return console.log(msg);
    successBox.hidden = false;
    successBox.innerHTML = sanitize(msg);
  }

  // Simple sanitization to avoid inserting HTML
  function sanitize(s) {
    return String(s).replace(/[&<>"'`=\/]/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
      "'": "&#39;", "`": "&#96;", "=": "&#61;", "/": "&#47;"
    }[c]));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    clearAlerts();

    const email = trim(emailEl?.value);
    const password = trim(passwordEl?.value);
    const fullName = trim(nameEl?.value);

    if (!email || !password) {
      showError("Please enter your email and password.");
      return;
    }

    submitBtn.disabled = true;
    setText(submitBtn, mode === "signup" ? "Creating..." : "Signing in...");

    try {
      if (mode === "signup") {
        // Sign Up
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: fullName ? { full_name: fullName } : undefined,
            emailRedirectTo: window.location.origin + "/account?confirmed=1",
          },
        });

        if (error) throw error;

        // If email confirmation is on, Supabase will send a link
        showSuccess("Check your email to confirm your account. Once confirmed, return here to sign in.");
      } else {
        // Sign In
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        showSuccess("Signed in successfully. Redirecting...");
        // Optional redirect after a short delay
        const to = window.POST_LOGIN_REDIRECT || "/";
        setTimeout(() => (window.location.href = to), 600);
      }
    } catch (err) {
      // err.message from supabase-js is safe text
      showError(err?.message || "Authentication failed. Please try again.");
      console.error("Auth error:", err);
    } finally {
      submitBtn.disabled = false;
      setText(submitBtn, mode === "signup" ? "Create Account" : "Sign In");
    }
  }

  // Optional: react to auth state changes (e.g., magic link, email confirm)
  supabase.auth.onAuthStateChange(async (event, session) => {
    // You could update UI or redirect based on session
    if (event === "SIGNED_IN") {
      const to = window.POST_LOGIN_REDIRECT || "/";
      setTimeout(() => (window.location.href = to), 400);
    }
  });

  // ---------- Wire up ----------
  form?.addEventListener("submit", handleSubmit);
  switchToSignUp?.addEventListener("click", (e) => {
    e.preventDefault();
    mode = "signup";
    renderMode();
  });
  switchToSignIn?.addEventListener("click", (e) => {
    e.preventDefault();
    mode = "signin";
    renderMode();
  });

  // If URL has ?mode=signup preselect it
  try {
    const params = new URLSearchParams(window.location.search);
    if ((params.get("mode") || "").toLowerCase() === "signup") {
      mode = "signup";
    }
  } catch (_) {}
  renderMode();
})();
