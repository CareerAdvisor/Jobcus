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
  // ─── 2) Grab all the elements we need ───
  const form         = document.getElementById('accountForm');
  const toggleLink   = document.getElementById('toggleMode');
  const formTitle    = document.querySelector('.auth-title');
  const subtitle     = document.querySelector('.auth-subtitle');
  const submitBtn    = document.getElementById('submitButton');
  const modeInput    = document.getElementById('mode');
  const nameGroup    = document.getElementById('nameGroup');
  const flash        = document.getElementById('flashMessages');
  const togglePrompt = document.getElementById('togglePrompt');

  // ─── 3) updateView() swaps between login/signup UI ───
  function updateView() {
    const mode = modeInput.value;
    if (mode === 'login') {
      nameGroup.classList.add('hidden');
      formTitle.innerHTML = 'Sign In to<br>Jobcus';
      subtitle.textContent = 'Good to see you again! Welcome back.';
      submitBtn.textContent = 'Sign In';
      togglePrompt.textContent = "Don’t have an account?";
      toggleLink.textContent = 'Sign Up';
    } else {
      nameGroup.classList.remove('hidden');
      formTitle.innerHTML = 'Sign Up to<br>Jobcus';
      subtitle.textContent = 'Create a free account to get started.';
      submitBtn.textContent = 'Sign Up';
      togglePrompt.textContent = 'Already have an account?';
      toggleLink.textContent = 'Sign In';
    }
    flash.textContent = '';  // clear old errors
  }

  // ─── 4) When the “Sign Up” / “Sign In” link is clicked ───
  toggleLink.addEventListener('click', e => {
    e.preventDefault();
    modeInput.value = (modeInput.value === 'login' ? 'signup' : 'login');
    updateView();
  });

  // ─── 5) Initialize on load ───
  updateView();

  // ─── 6) Submit the form via fetch(JSON) ───
  form.addEventListener('submit', async e => {
    e.preventDefault();
    flash.textContent = '';

    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const name     = document.getElementById('name').value.trim();
    const mode     = modeInput.value;

    try {
      const res = await fetch('/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, email, password, name })
      });
      const data = await res.json();

      if (data.success) {
        // on success, redirect as instructed by server
        window.location.href = data.redirect;
      } else {
        // show server-returned error
        flash.textContent = data.message || 'Something went wrong. Please try again.';
      }
    } catch (err) {
      console.error('Account request failed:', err);
      flash.textContent = 'Server error. Please try again later.';
    }
  });
});
