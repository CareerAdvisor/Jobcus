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

  // ─── 2) Flash helper ───
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
  // When toggling login/signup, don’t disable the button anymore
  toggleLink?.addEventListener('click', (e) => {
    e.preventDefault();
    modeInput.value = (modeInput.value === 'login' ? 'signup' : 'login');
    updateView();
    try { turnstile.reset('#cfWidget'); } catch(e){}
    window.turnstileToken = null;
  });

  // Initialize the view
  updateView();

  // ─── 5) Cloudflare Turnstile (auto/invisible) ───
  // Requires in your template:
  //   <div id="cfWidget" class="cf-turnstile"
  //        data-sitekey="{{ turnstile_site_key }}"
  //        data-callback="onTurnstileToken"
  //        data-error-callback="onTurnstileError"
  //        data-timeout-callback="onTurnstileTimeout"
  //        data-theme="auto"
  //        data-appearance="execute"></div>
  // And loader:
  //   <script data-cfasync="false" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>

  window.turnstileToken = null;
  let waitingForToken = false;  // tracks if a submit is pending while we fetch a token

  function collectFormValues() {
    return {
      mode: (modeInput?.value || 'signup').toLowerCase(),
      email: document.getElementById('email')?.value.trim() || '',
      password: document.getElementById('password')?.value || '',
      name: document.getElementById('name')?.value.trim() || ''
    };
  }

  async function actuallySubmit() {
    const { mode, email, password, name } = collectFormValues();

    if (!email || !password) {
      flash('Email and password are required.');
      return;
    }
    if (mode === 'signup' && !name) {
      flash('Please enter your full name.');
      return;
    }
    if (!window.turnstileToken) {
      // Shouldn’t happen here, but guard just in case
      flash('Please try again (security check).');
      return;
    }

    const payload = {
      mode, email, password, name,
      cf_turnstile_response: window.turnstileToken
    };

    // Prevent double-submits during the request only
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
      // Always reset token for next action
      try { turnstile.reset('#cfWidget'); } catch(e){}
      window.turnstileToken = null;
      if (submitBtn) submitBtn.disabled = false;
    }

    if (ok && data?.success && data?.redirect) {
      // Clear any local cache that could cause state confusion
      localStorage.removeItem('resumeAnalysis');
      localStorage.removeItem('resumeBase64');
      localStorage.removeItem('dashboardVisited');
      window.location.assign(data.redirect);
      return;
    }

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
  }

  // Turnstile callbacks
  window.onTurnstileToken = function(token){
    // Called after execute() or any background challenge
    window.turnstileToken = token;
    if (waitingForToken) {
      waitingForToken = false;
      actuallySubmit(); // continue the submit flow automatically
    }
  };
  window.onTurnstileError = function(){
    waitingForToken = false;
    window.turnstileToken = null;
    flash('Security check failed. Please try again.');
  };
  window.onTurnstileTimeout = function(){
    waitingForToken = false;
    window.turnstileToken = null;
    try { turnstile.reset('#cfWidget'); } catch(e){}
    flash('Security check timed out. Please try again.');
  };

  // ─── 6) Submit handler ───
  form?.addEventListener('submit', (e) => {
    e.preventDefault();

    const { mode, email, password, name } = collectFormValues();

    if (!email || !password) {
      flash('Email and password are required.');
      return;
    }
    if (mode === 'signup' && !name) {
      flash('Please enter your full name.');
      return;
    }

    // If we already have a token, go right away.
    if (window.turnstileToken) {
      actuallySubmit();
      return;
    }

    // No token yet — run Turnstile invisibly and continue in onTurnstileToken.
    waitingForToken = true;
    try {
      // requires data-appearance="execute"
      if (window.turnstile?.execute) {
        turnstile.execute('#cfWidget');
      } else {
        waitingForToken = false;
        flash('Security script not loaded yet. Please wait a second and try again.');
      }
    } catch (err) {
      console.error('Turnstile execute error:', err);
      waitingForToken = false;
      flash('Security check failed to start. Please try again.');
    }
  });
});
