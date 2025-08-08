// static/js/account.js

// ─── 1) Force cookies on every fetch ───
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || 'same-origin';
    return _fetch(input, init);
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  // ─── 2) Grab elements ───
  const form        = document.getElementById('accountForm');
  const modeInput   = document.getElementById('mode');
  const nameGroup   = document.getElementById('nameGroup');
  const formTitle   = document.querySelector('.auth-title');
  const subtitle    = document.querySelector('.auth-subtitle');
  const submitBtn   = document.getElementById('submitButton');
  const toggleLink  = document.getElementById('toggleMode');
  const togglePrompt= document.getElementById('togglePrompt');
  const flash       = document.getElementById('flashMessages');

  // ─── 3) updateView() swaps login ↔ signup UI ───
  function updateView() {
    const mode = modeInput.value; // 'login' or 'signup'

    if (mode === 'login') {
      // hide name field
      nameGroup.style.display = 'none';
      formTitle.innerHTML     = 'Sign In to<br>Jobcus';
      subtitle.textContent    = 'Good to see you again! Welcome back.';
      submitBtn.textContent   = 'Sign In';
      togglePrompt.textContent= "Don’t have an account?";
      toggleLink.textContent  = 'Sign Up';
    } else {
      // show name field
      nameGroup.style.display = 'block';
      formTitle.innerHTML     = 'Sign Up to<br>Jobcus';
      subtitle.textContent    = 'Create a free account to get started.';
      submitBtn.textContent   = 'Sign Up';
      togglePrompt.textContent= 'Already have an account?';
      toggleLink.textContent  = 'Sign In';
    }

    // clear any old flash messages
    flash.innerHTML = '';
  }

  // ─── 4) Toggle link click handler ───
  toggleLink.addEventListener('click', e => {
    e.preventDefault();
    // flip mode
    modeInput.value = (modeInput.value === 'login' ? 'signup' : 'login');
    updateView();
  });

  // ─── 5) Initialize on page load ───
  updateView();

  // ─── 6) Form submit via fetch(JSON) ───
  form.addEventListener('submit', async e => {
  e.preventDefault();
  flash.innerHTML = '';

  const payload = {
    mode:     modeInput.value,  // "login" or "signup"
    email:    document.getElementById('email').value.trim(),
    password: document.getElementById('password').value,
    name:     document.getElementById('name')?.value.trim() || ''
  };

  try {
    const res  = await fetch('/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      window.location.href = data.redirect;
    } else if (payload.mode === "signup" && data.message && data.message.toLowerCase().includes("already exist")) {
      // Switch to login mode, inform user
      modeInput.value = "login";
      updateView();
      flash.textContent = "Account already exists. Please log in.";
      // Optionally: document.getElementById('email').value = payload.email;
    } else {
      flash.textContent = data.message || 'Something went wrong. Please try again.';
    }
  } catch (err) {
    console.error('Account request failed:', err);
    flash.textContent = 'Server error. Please try again later.';
  }
});
