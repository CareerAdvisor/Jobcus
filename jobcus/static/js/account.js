// static/js/account.js
// Jobcus Auth (Supabase v2 UMD). Requires window.supabase (loaded by account.html guarded loader).

(function () {
  // ---------------- Helpers ----------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const show = (el) => el && (el.style.display = "");
  const hide = (el) => el && (el.style.display = "none");
  const setText = (el, txt) => el && (el.textContent = txt);
  const trim = (v) => (v || "").trim();
  const sanitize = (s) =>
    String(s).replace(/[&<>"'`=\/]/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
      "'": "&#39;", "`": "&#96;", "=": "&#61;", "/": "&#47;",
    }[c]));

  // ---------------- DOM ----------------
  const form = $("#auth-form");
  const emailEl = $("#email");
  const passwordEl = $("#password");
  const nameWrap = $("#name-wrap");
  const fullNameEl = $("#full_name");
  const submitBtn = $("#submit-btn");
  const toSignup = $("#switch-to-signup");
  const toSignin = $("#switch-to-signin");
  const modeLabelEls = $$("[data-auth-mode-label]");
  const errorBox = $("#auth-error");
  const successBox = $("#auth-success");

  // Optional social buttons (placeholders)
  const btnGoogle   = document.querySelector(".social-btn.google");
  const btnFacebook = document.querySelector(".social-btn.fb");
  const btnLinkedin = document.querySelector(".social-btn.linkedin");
  const btnApple    = document.querySelector(".social-btn.apple");

  // ---------------- Config & Client ----------------
  const SUPABASE_URL = window.SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;
  const POST_LOGIN_REDIRECT = window.POST_LOGIN_REDIRECT || "/dashboard";

  if (typeof window.supabase !== "object" || !window.supabase.createClient) {
    console.error("Supabase library not found. Ensure the SDK loaded before account.js.");
  }

  let supabaseClient = null;
  if (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase && window.supabase.createClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    console.warn("Supabase URL/ANON KEY missing or SDK not available. Auth will error on submit.");
  }

  // ---------------- State & UI ----------------
  let mode = "signin"; // 'signin' | 'signup'

  function clearAlerts() {
    if (errorBox) { errorBox.hidden = true; errorBox.innerHTML = ""; }
    if (successBox) { successBox.hidden = true; successBox.innerHTML = ""; }
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

  function setBusy(isBusy) {
    if (!submitBtn) return;
    submitBtn.disabled = isBusy;
    setText(submitBtn, isBusy ? (mode === "signup" ? "Creating..." : "Signing in...") : (mode === "signup" ? "Create Account" : "Sign In"));
  }

  function renderMode() {
    const isUp = mode === "signup";
    modeLabelEls.forEach((el) => setText(el, isUp ? "Create your account" : "Sign in to your account"));
    if (nameWrap) (isUp ? show(nameWrap) : hide(nameWrap));
    if (toSignup) (isUp ? hide(toSignup) : show(toSignup));
    if (toSignin) (isUp ? show(toSignin) : hide(toSignin));
    setText(submitBtn, isUp ? "Create Account" : "Sign In");
    clearAlerts();
  }

  // ---------------- Auth ----------------
  async function doSignUp(email, password, fullName) {
    if (!supabaseClient) throw new Error("Auth is not configured. Please contact support.");
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: fullName ? { full_name: fullName } : undefined,
        emailRedirectTo: window.location.origin + "/account?confirmed=1",
      },
    });
    if (error) throw error;
    return data;
  }

  async function doSignIn(email, password) {
    if (!supabaseClient) throw new Error("Auth is not configured. Please contact support.");
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function onSubmit(e) {
    e.preventDefault();
    clearAlerts();

    const email = trim(emailEl && emailEl.value);
    const password = trim(passwordEl && passwordEl.value);
    const fullName = trim(fullNameEl && fullNameEl.value);

    if (!email || !password) {
      showError("Please enter your email and password.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "signup") {
        await doSignUp(email, password, fullName);
        showSuccess("Check your email to confirm your account. After confirming, return to sign in.");
      } else {
        await doSignIn(email, password);
        showSuccess("Signed in successfully. Redirecting…");
        setTimeout(() => (window.location.href = POST_LOGIN_REDIRECT), 600);
      }
    } catch (err) {
      showError(err?.message || "Authentication failed. Please try again.");
      console.error("Auth error:", err);
    } finally {
      setBusy(false);
    }
  }

  // React to auth state (e.g., deep link or email confirmation)
  if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN") {
        setTimeout(() => (window.location.href = POST_LOGIN_REDIRECT), 400);
      }
    });
  }

  // ---------------- Wire up ----------------
  form && form.addEventListener("submit", onSubmit);

  toSignup && toSignup.addEventListener("click", (e) => {
    e.preventDefault();
    mode = "signup";
    renderMode();
  });

  toSignin && toSignin.addEventListener("click", (e) => {
    e.preventDefault();
    mode = "signin";
    renderMode();
  });

  // Optional query param: ?mode=signup
  try {
    const params = new URLSearchParams(window.location.search);
    const m = (params.get("mode") || "").toLowerCase();
    if (m === "signup") mode = "signup";
  } catch (_) {}

  // Placeholder social auth buttons (enable with supabase.auth.signInWithOAuth later)
  function notImplemented(e) {
    e.preventDefault();
    showError("Social login isn’t enabled yet. Please use email & password.");
  }
  btnGoogle   && btnGoogle.addEventListener("click", notImplemented);
  btnFacebook && btnFacebook.addEventListener("click", notImplemented);
  btnLinkedin && btnLinkedin.addEventListener("click", notImplemented);
  btnApple    && btnApple.addEventListener("click", notImplemented);

  // Initial render
  renderMode();
})();
