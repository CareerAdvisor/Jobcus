// static/js/account.js

// 1) Always send cookies with fetch (session, CSRF if any)
;(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || 'same-origin';
    return _fetch(input, init);
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  // 2) Grab elements
  const form         = document.getElementById('accountForm');
  const modeInput    = document.getElementById('mode');
  const nameGroup    = document.getElementById('nameGroup');
  const formTitle    = document.querySelector('.auth-title');
  const subtitle     = document.querySelector('.auth-subtitle');
  const submitBtn    = document.getElementById('submitButton');
  const toggleLink   = document.getElementById('toggleMode');
  const togglePrompt = document.getElementById('togglePrompt');
  const flash        = document.getElementById('flashMessages');

  // 3) UI swap login ↔ signup
  function updateView() {
    const mode = (modeInput.value || 'signup').toLowerCase();
    if (mode === 'login') {
      nameGroup.style.display  = 'none';
      formTitle.innerHTML      = 'Sign In to<br>Jobcus';
      subtitle.textContent     = 'Good to see you again! Welcome back.';
      submitBtn.textContent    = 'Sign In';
      togglePrompt.textContent = 'Don’t have an account?';
      toggleLink.textContent   = 'Sign Up';
    } else {
      nameGroup.style.display  = 'block';
      formTitle.innerHTML      = 'Sign Up to<br>Jobcus';
      subtitle.textContent     = 'Create a free account to get started.';
      submitBtn.textContent    = 'Sign Up';
      togglePrompt.textContent = 'Already have an account?';
      toggleLink.textContent   = 'Sign In';
    }
    if (flash) flash.innerHTML = '';
  }

  // 4) Toggle click
  toggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    modeInput.value = (modeInput.value === 'login' ? 'signup' : 'login');
    updateView();
  });

  // 5) Initialize
  updateView();

  // 6) Submit via JSON to Flask /account
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (flash) flash.textContent = '';

    const payload = {
      mode:     (modeInput.value || 'signup').toLowerCase(),
      email:    document.getElementById('email').value.trim(),
      password: document.getElementById('password').value,
      name:     document.getElementById('name')?.value.trim() || ''
    };

    try {
      const res = await fetch('/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      let data = {};
      try { data = await res.json(); } catch { data = {}; }

      // Known server responses (from old_app.py)
      if (!res.ok || data.success === false) {
        if (data.code === 'user_exists') {
          modeInput.value = 'login';
          updateView();
          document.getElementById('email').value = payload.email;
          alert(data.message || 'Account already exists. Please log in.');
          return;
        }
        if (data.code === 'email_not_confirmed' && data.redirect) {
          window.location.assign(data.redirect); // /check-email
          return;
        }
        (flash || {}).textContent = data.message || 'Request failed. Please try again.';
        return;
      }

      if (data.redirect) {
        // clear any previous anon data your app may store
        localStorage.removeItem('resumeAnalysis');
        localStorage.removeItem('resumeBase64');
        localStorage.removeItem('dashboardVisited');
        window.location.assign(data.redirect);
        return;
      }

      (flash || {}).textContent = 'Unexpected response. Please try again.';
    } catch (err) {
      console.error('Account request failed:', err);
      (flash || {}).textContent = 'Server error. Please try again later.';
    }
  });
});
