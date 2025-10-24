// static/js/account.js  –– full version with Turnstile + original extras

;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || 'same-origin';
    return _fetch(input, init);
  };
})();

async function _localApiFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Request failed');
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}
const callAPI = (window.apiFetch || _localApiFetch);

// ─── Plan picker (kept if buttons exist) ───
window.pickPlan = async function pickPlan(plan) {
  try {
    await callAPI('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ plan })
    });
    location.reload();
  } catch (err) {
    if (err?.payload?.error === 'plan_denied') {
      alert(err.payload.message);
    } else {
      alert('Something went wrong.');
      console.error(err);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const form        = document.getElementById('accountForm');
  const modeInput   = document.getElementById('mode');
  const nameGroup   = document.getElementById('nameGroup');
  const formTitle   = document.querySelector('.auth-title');
  const subtitle    = document.querySelector('.auth-subtitle');
  const submitBtn   = document.getElementById('submitButton');
  const toggleLink  = document.getElementById('toggleMode');
  const togglePrompt= document.getElementById('togglePrompt');
  const flash       = document.getElementById('flashMessages');
  const qs = new URLSearchParams(location.search);

  // URL mode and optional email prefill
  const qsMode = (qs.get('mode') || '').toLowerCase();
  if (modeInput && (qsMode === 'login' || qsMode === 'signup')) modeInput.value = qsMode;

  const qsEmail = qs.get('email');
  if (qsEmail) {
    const emailEl = document.getElementById('email');
    if (emailEl) emailEl.value = qsEmail;
  }

  const verified = qs.get('verified');
  if (verified && flash) {
    flash.innerHTML = '<div class="flash-item success">Email verified! Please sign in.</div>';
  }

  const pwdInput = document.getElementById('password');
  const showPw   = document.getElementById('showPassword');
  showPw?.addEventListener('change', () => {
    if (pwdInput) pwdInput.type = showPw.checked ? 'text' : 'password';
  });

  function updateView() {
    const mode = modeInput?.value || 'signup';
    if (mode === 'login') {
      nameGroup.style.display = 'none';
      formTitle.innerHTML = 'Sign In to<br>Jobcus';
      subtitle.textContent = 'Good to see you again! Welcome back.';
      submitBtn.textContent = 'Sign In';
      togglePrompt.textContent = "Don’t have an account?";
      toggleLink.textContent = 'Sign Up';
    } else {
      nameGroup.style.display = 'block';
      formTitle.innerHTML = 'Sign Up to<br>Jobcus';
      subtitle.textContent = 'Create a free account to get started.';
      submitBtn.textContent = 'Sign Up';
      togglePrompt.textContent = 'Already have an account?';
      toggleLink.textContent = 'Sign In';
    }
    if (!verified && flash) flash.innerHTML = '';
  }

  toggleLink?.addEventListener('click', e => {
    e.preventDefault();
    modeInput.value = (modeInput.value === 'login' ? 'signup' : 'login');
    const url = new URL(location.href);
    url.searchParams.set('mode', modeInput.value);
    history.replaceState(null, '', url.toString());
    updateView();
  });

  updateView();

  // ─── Submit with Turnstile token ───
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (flash && !verified) flash.textContent = '';

    const tokenEl = form.querySelector('input[name="cf-turnstile-response"]');
    const token = tokenEl ? tokenEl.value : '';

    const payload = {
      mode:     modeInput?.value,
      email:    document.getElementById('email')?.value.trim(),
      password: document.getElementById('password')?.value,
      name:     document.getElementById('name')?.value.trim() || '',
      cf_turnstile_response: token,
    };

    try {
      const res = await fetch('/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });

      let data = {};
      try { data = await res.json(); } catch { data = {}; }

      if (!res.ok || data.success === false) {
        if (data.code === 'user_exists') {
          modeInput.value = 'login';
          updateView();
          const emailEl = document.getElementById('email');
          if (emailEl && payload.email) emailEl.value = payload.email;
          alert(data.message || 'Account already exists. Please log in.');
          return;
        }
        if (data.code === 'email_not_confirmed' && data.redirect) {
          window.location.assign(data.redirect);
          return;
        }
        if (flash) flash.textContent = data.message || 'Request failed. Please try again.';
        return;
      }

      if (data.redirect) {
        localStorage.removeItem('resumeAnalysis');
        localStorage.removeItem('resumeBase64');
        localStorage.removeItem('dashboardVisited');
        window.location.assign(data.redirect);
        return;
      }

      if (flash) flash.textContent = 'Unexpected response. Please try again.';
    } catch (err) {
      console.error('Account request failed:', err);
      if (flash) flash.textContent = 'Server error. Please try again later.';
    }
  });

  // ─── Disable Free if already used ───
  const shell = document.getElementById('accountShell');
  const freeUsed = (shell?.dataset.freeUsed === '1');
  const freeBtn = document.getElementById('chooseFreeBtn');
  if (freeUsed && freeBtn) {
    freeBtn.setAttribute('disabled', 'disabled');
    freeBtn.setAttribute('title', 'Free trial already used');
  }
});
