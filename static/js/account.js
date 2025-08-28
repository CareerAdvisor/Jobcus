// static/js/account.js

// ─── 0) Always include cookies on fetch (session) ───
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || 'same-origin';
    return _fetch(input, init);
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  // ─── 1) Grab elements ───
  const form         = document.getElementById('accountForm');
  const modeInput    = document.getElementById('mode');           // "login" | "signup"
  const nameGroup    = document.getElementById('nameGroup');      // full name wrapper
  const formTitle    = document.querySelector('.auth-title');
  const subtitle     = document.querySelector('.auth-subtitle');
  const submitBtn    = document.getElementById('submitButton');
  const toggleLink   = document.getElementById('toggleMode');
  const togglePrompt = document.getElementById('togglePrompt');
  const flashBox     = document.getElementById('flashMessages');

  // ─── 2) Flash helper (writes into #flashMessages) ───
  function flash(message, level='error'){
    if (!flashBox) { alert(message); return; }
    flashBox.innerHTML = `<div class="flash-item ${level}">${message}</div>`;
  }
  function clearFlash(){ if (flashBox) flashBox.innerHTML = ''; }

  // ─── 3) Update UI for mode (login/signup) ───
  function updateView() {
    const mode = modeInput.value;
    if (mode === 'login') {
      if (nameGroup) nameGroup.style.display = 'none';
      if (formTitle) formTitle.innerHTML = 'Sign In to<br>Jobcus';
      if (subtitle)  subtitle.textContent = 'Good to see you again! Welcome back.';
      if (submitBtn) submitBtn.textContent = 'Sign In';
      if (togglePrompt) togglePrompt.textContent = 'Don’t have an account?';
      if (toggleLink)   toggleLink.textContent   = 'Sign Up';
    } else {
      if (nameGroup) nameGroup.style.display = 'block';
      if (formTitle) formTitle.innerHTML = 'Sign Up to<br>Jobcus';
      if (subtitle)  subtitle.textContent = 'Create a free account to get started.';
      if (submitBtn) submitBtn.textContent = 'Sign Up';
      if (togglePrompt) togglePrompt.textContent = 'Already have an account?';
      if (toggleLink)   toggleLink.textContent   = 'Sign In';
    }
    clearFlash();
  }

  // ─── 4) Toggle mode without reloading the page ───
  toggleLink?.addEventListener('click', (e) => {
    e.preventDefault();
    modeInput.value = (modeInput.value === 'login' ? 'signup' : 'login');
    updateView();
    // Reset CAPTCHA when switching modes (optional)
    try { turnstile.reset('#cfWidget'); } catch(e){}
    window.turnstileToken = null;
    if (submitBtn) submitBtn.disabled = true;
  });

  // Initialize the view
  updateView();

  // ─── 5) Cloudflare Turnstile integration ───
  // Make sure your template includes:
  // <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  // <div class="cf-turnstile" id="cfWidget"
  //      data-sitekey="{{ turnstile_site_key }}"
  //      data-callback="onTurnstileToken"
  //      data-error-callback="onTurnstileError"
  //      data-timeout-callback="onTurnstileTimeout"
  //      data-theme="light" data-size="flexible"></div>

  window.turnstileToken = null;

  function syncSubmitEnabled(){
    if (submitBtn) submitBtn.disabled = !window.turnstileToken;
  }

  window.onTurnstileToken = function(token){
    window.turnstileToken = token;
    syncSubmitEnabled();
  };
  window.onTurnstileError = function(){
    window.turnstileToken = null;
    syncSubmitEnabled();
  };
  window.onTurnstileTimeout = function(){
    window.turnstileToken = null;
    syncSubmitEnabled();
    try { turnstile.reset('#cfWidget'); } catch(e){}
  };

  // Start disabled until user passes CAPTCHA
  syncSubmitEnabled();

  // ─── 6) Submit handler ───
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const mode     = (modeInput?.value || 'signup').toLowerCase();
    const email    = document.getElementById('email')?.value.trim() || '';
    const password = document.getElementById('password')?.value || '';
    const name     = document.getElementById('name')?.value.trim() || '';

    if (!email || !password) {
      flash('Email and password are required.');
      return;
    }
    if (mode === 'signup' && !name) {
      flash('Please enter your full name.');
      return;
    }

    // Require a real Turnstile pass
    if (!window.turnstileToken) {
      flash('Please complete the CAPTCHA to continue.');
      return;
    }

    const payload = {
      mode,
      email,
      password,
      name,
      cf_turnstile_response: window.turnstileToken
    };

    // Prevent double-submits
    if (submitBtn) submitBtn.disabled = true;

    let data = {};
    let ok   = false;

    try {
      const res = await fetch('/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      ok   = res.ok;
      data = await res.json().catch(() => ({}));
    } catch (err) {
      console.error('Network error:', err);
      flash('Network error. Please try again.');
      return;
    } finally {
      // Always reset Turnstile for a fresh token
      try { turnstile.reset('#cfWidget'); } catch(e){}
      window.turnstileToken = null;
      syncSubmitEnabled(); // remains disabled until user clicks again
    }

    // Success path (server returns {success:true, redirect:"/..."})
    if (ok && data?.success && data?.redirect) {
      // Clear any local cache that could cause state confusion
      localStorage.removeItem('resumeAnalysis');
      localStorage.removeItem('resumeBase64');
      localStorage.removeItem('dashboardVisited');
      window.location.assign(data.redirect);
      return;
    }

    // Known flows
    if (data?.code === 'user_exists') {
      // Switch to login mode and pre-fill the email
      modeInput.value = 'login';
      updateView();
      const emailEl = document.getElementById('email');
      if (emailEl) emailEl.value = email;
      flash(data?.message || 'Account already exists. Please log in.', 'info');
      return;
    }
    if (data?.code === 'email_not_confirmed' && data?.redirect) {
      window.location.assign(data.redirect); // usually /check-email
      return;
    }

    // Generic failure
    flash(data?.message || 'Request failed. Please try again.');
  });
});
