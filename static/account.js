// static/account.js

// Force cookies on every fetch (so if you later protect endpoints, they’ll work)
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || 'same-origin';
    return _fetch(input, init);
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  const form        = document.getElementById('accountForm');
  const toggleLink  = document.getElementById('toggleMode');
  const formTitle   = document.getElementById('formTitle');
  const submitBtn   = document.getElementById('submitButton');
  const modeInput   = document.getElementById('mode');
  const nameGroup   = document.getElementById('nameGroup');
  const flash       = document.getElementById('flashMessages');

  let isSignup = false;

  // Toggle between Sign In / Sign Up
  toggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    isSignup = !isSignup;
    if (isSignup) {
      formTitle.textContent      = 'Sign Up for Jobcus';
      submitBtn.textContent      = 'Sign Up';
      toggleLink.textContent     = 'Sign In';
      modeInput.value            = 'signup';
      nameGroup.classList.remove('hidden');
    } else {
      formTitle.textContent      = 'Sign In to Jobcus';
      submitBtn.textContent      = 'Sign In';
      toggleLink.textContent     = 'Sign Up';
      modeInput.value            = 'login';
      nameGroup.classList.add('hidden');
    }
    flash.textContent = '';  // clear any old messages
  });

  // Handle form submit via fetch(JSON)
  form.addEventListener('submit', async (e) => {
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
        // Redirect to dashboard on success
        window.location.href = data.redirect;
      } else {
        // Show error message returned by server
        flash.textContent = data.message || 'Something went wrong. Please try again.';
      }
    } catch (err) {
      console.error('Account request failed:', err);
      flash.textContent = 'Server error. Please try again later.';
    }
  });
});
