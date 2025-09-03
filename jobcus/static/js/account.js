// static/js/account.js
// Self-initializing auth for Jobcus. Waits for SDK if slow, attaches handlers, shows clear errors.

(function () {
  "use strict";

  // ---------- Helpers ----------
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const show = (el) => el && (el.style.display = "");
  const hide = (el) => el && (el.style.display = "none");
  const setText = (el, txt) => el && (el.textContent = txt);
  const trim = (v) => (v || "").trim();
  const sanitize = (s) =>
    String(s).replace(/[&<>"'`=\/]/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","`":"&#96;","=":"&#61;","/":"&#47;"
    }[c]));

  // ---------- DOM refs ----------
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

  const btnGoogle   = document.querySelector(".social-btn.google");
  const btnFacebook = document.querySelector(".social-btn.fb");
  const btnLinkedin = document.querySelector(".social-btn.linkedin");
  const btnApple    = document.querySelector(".social-btn.apple");

  // ---------- State ----------
  let mode = "signin"; // 'signin' | 'signup'
  let supabaseClient = null;

  function clearAlerts() {
    if (errorBox) { errorBox.hidden = true; errorBox.innerHTML = ""; }
    if (successBox) { successBox.hidden = true; successBox.innerHTML = ""; }
  }
  function showError(msg) {
    if (!errorBox) return console.error(msg);
    errorBox.hidden = false; errorBox.innerHTML = sanitize(msg);
  }
  function showSuccess(msg) {
    if (!successBox) return console.log(msg);
    successBox.hidden = false; successBox.innerHTML = sanitize(msg);
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

  // ---------- Wait for Supabase SDK (up to 8s) ----------
  function waitForSupabase(maxMs = 8000, tick = 50) {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      (function check() {
        if (typeof window.supabase === "object" && window.supabase.createClient) return resolve(window.supabase);
        if (performance.now() - start >= maxMs) return reject(new Error("Supabase SDK not available"));
        setTimeout(check, tick);
      })();
    });
  }

  // ---------- Initialize client ----------
  async function initClient() {
    const url = window.SUPABASE_URL || "";
    const key = window.SUPABASE_ANON_KEY || "";
    if (!url || !key) throw new Error("Missing Supabase URL or ANON KEY.");
    const lib = await waitForSupabase();
    supabaseClient = lib.createClient(url, key);
    // Auth state listener
    supabaseClient.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        const to = window.POST_LOGIN_REDIRECT || "/dashboard";
        setTimeout(() => (window.location.href = to), 400);
      }
    });
  }

  // ---------- Auth calls ----------
  async function doSignUp(email, password, fullName) {
    if (!supabaseClient) throw new Error("Auth is not configured. Please refresh.");
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
    if (!supabaseClient) throw new Error("Auth is not configured. Please refresh.");
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  // ---------- Handlers ----------
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
      if (!supabaseClient) await initClient();
      if (mode === "signup") {
        await doSignUp(email, password, fullName);
        showSuccess("Check your email to confirm your account. After confirming, return to sign in.");
      } else {
        await doSignIn(email, password);
        showSuccess("Signed in successfully. Redirecting…");
        const to = window.POST_LOGIN_REDIRECT || "/dashboard";
        setTimeout(() => (window.location.href = to), 600);
      }
    } catch (err) {
      showError(err?.message || "Authentication failed. Please try again.");
      console.error("Auth error:", err);
    } finally {
      setBusy(false);
    }
  }

  // ---------- Wire up once DOM is ready ----------
  window.addEventListener("DOMContentLoaded", () => {
    if (!form) return; // not on /account
    // Toggle links
    toSignup && toSignup.addEventListener("click", (e) => { e.preventDefault(); mode = "signup"; renderMode(); });
    toSignin && toSignin.addEventListener("click", (e) => { e.preventDefault(); mode = "signin"; renderMode(); });
    // Form submit
    form.addEventListener("submit", onSubmit);

    // Preselect mode via ?mode=signup
    try {
      const p = new URLSearchParams(window.location.search);
      if ((p.get("mode") || "").toLowerCase() === "signup") mode = "signup";
    } catch (_) {}

    renderMode();
  });

  // ---------- Social buttons (placeholder) ----------
  function notImplemented(e) {
    e.preventDefault();
    showError("Social login isn’t enabled yet. Please use email & password.");
  }
  btnGoogle   && btnGoogle.addEventListener("click", notImplemented);
  btnFacebook && btnFacebook.addEventListener("click", notImplemented);
  btnLinkedin && btnLinkedin.addEventListener("click", notImplemented);
  btnApple    && btnApple.addEventListener("click", notImplemented);
})();
