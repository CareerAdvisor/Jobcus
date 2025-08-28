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
    const mode = modeInput.value;

    if (mode === 'login') {
      nameGroup.style.display = 'none';
      formTitle.innerHTML     = 'Sign In to<br>Jobcus';
      subtitle.textContent    = 'Good to see you again! Welcome back.';
      submitBtn.textContent   = 'Sign In';
      togglePrompt.textContent= "Don’t have an account?";
      toggleLink.textContent  = 'Sign Up';
    } else {
      nameGroup.style.display = 'block';
      formTitle.innerHTML     = 'Sign Up to<br>Jobcus';
      subtitle.textContent    = 'Create a free account to get started.';
      submitBtn.textContent   = 'Sign Up';
      togglePrompt.textContent= 'Already have an account?';
      toggleLink.textContent  = 'Sign In';
    }

    flash.innerHTML = '';
  }

  // ─── 4) Toggle link click handler ───
  toggleLink.addEventListener('click', e => {
    e.preventDefault();
    modeInput.value = (modeInput.value === 'login' ? 'signup' : 'login');
    updateView();
  });

  // ─── 5) Initialize on page load ───
  updateView();

  // ─── 6) Form submit via fetch(JSON) ───
  form.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!window.turnstileToken) {
    flash('Please complete the CAPTCHA to continue.', 'error');
    return;
  }

  const payload = {
    mode:     modeInput.value,
    email:    document.getElementById('email').value.trim(),
    password: document.getElementById('password').value,
    name:     document.getElementById('name')?.value.trim() || '',
    cf_turnstile_response: window.turnstileToken
  };

  let data = {};
  try {
    const res = await fetch('/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    data = await res.json();
  } catch (err) {
    flash('Network error. Please try again.', 'error');
    return;
  } finally {
    try { turnstile.reset('#cfWidget'); } catch(e){}
    window.turnstileToken = null;
    document.getElementById('submitButton').disabled = true;
  }

    // Try to parse JSON even on error responses
    try { data = await res.json(); } catch { data = {}; }

    // Handle known failure shapes
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
      flash.textContent = data.message || 'Request failed. Please try again.';
      return;
    }

    // Success → redirect (single call)
    if (data.redirect) {
      // clear any previous anon data
      localStorage.removeItem('resumeAnalysis');
      localStorage.removeItem('resumeBase64');
      localStorage.removeItem('dashboardVisited');
      window.location.assign(data.redirect);
      return;
    }

    flash.textContent = 'Unexpected response. Please try again.';
  } catch (err) {
    console.error('Account request failed:', err);
    flash.textContent = 'Server error. Please try again later.';
  }
});
});
