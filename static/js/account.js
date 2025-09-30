// static/js/account.js

// ─── 1) Force cookies on every fetch (SameSite/Lax) ───
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || 'same-origin';
    return _fetch(input, init);
  };
})();

// Local apiFetch fallback (prefer base.js's apiFetch if available)
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

// Expose pickPlan globally for inline onclick handlers
window.pickPlan = async function pickPlan(plan) {
  try {
    await callAPI('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ plan })
    });
    // simplest: reload to pick up updated plan/quota flags
    location.reload();
  } catch (err) {
    if (err?.payload?.error === 'plan_denied') {
      alert(err.payload.message); // "Free trial already used..."
    } else {
      alert('Something went wrong.');
      console.error(err);
    }
  }
};

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
      if (nameGroup) nameGroup.style.display = 'none';
      if (formTitle) formTitle.innerHTML     = 'Sign In to<br>Jobcus';
      if (subtitle)  subtitle.textContent    = 'Good to see you again! Welcome back.';
      if (submitBtn) submitBtn.textContent   = 'Sign In';
      if (togglePrompt) togglePrompt.textContent= "Don’t have an account?";
      if (toggleLink)   toggleLink.textContent  = 'Sign Up';
    } else {
      if (nameGroup) nameGroup.style.display = 'block';
      if (formTitle) formTitle.innerHTML     = 'Sign Up to<br>Jobcus';
      if (subtitle)  subtitle.textContent    = 'Create a free account to get started.';
      if (submitBtn) submitBtn.textContent   = 'Sign Up';
      if (togglePrompt) togglePrompt.textContent= 'Already have an account?';
      if (toggleLink)   toggleLink.textContent  = 'Sign In';
    }

    if (flash) flash.innerHTML = '';
  }

  // ─── 4) Toggle link click handler ───
  toggleLink?.addEventListener('click', e => {
    e.preventDefault();
    if (!modeInput) return;
    modeInput.value = (modeInput.value === 'login' ? 'signup' : 'login');
    updateView();
  });

  // ─── 5) Initialize on page load ───
  updateView();

  // ─── 6) Form submit via fetch(JSON) ───
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (flash) flash.textContent = '';

    const payload = {
      mode:     modeInput?.value,
      email:    document.getElementById('email')?.value.trim(),
      password: document.getElementById('password')?.value,
      name:     document.getElementById('name')?.value.trim() || ''
    };

    let data = {};
    try {
      const res = await fetch('/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      try { data = await res.json(); } catch { data = {}; }

      if (!res.ok || data.success === false) {
        if (data.code === 'user_exists') {
          if (modeInput) modeInput.value = 'login';
          updateView();
          const emailEl = document.getElementById('email');
          if (emailEl && payload.email) emailEl.value = payload.email;
          alert(data.message || 'Account already exists. Please log in.');
          return;
        }
        if (data.code === 'email_not_confirmed' && data.redirect) {
          window.location.assign(data.redirect); // /check-email
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

  // ─── 7) Disable Free if free_plan_used === true ───
  const shell = document.getElementById('accountShell');
  const freeUsed = (shell?.dataset.freeUsed === '1');
  const freeBtn = document.getElementById('chooseFreeBtn');

  if (freeUsed && freeBtn) {
    freeBtn.setAttribute('disabled', 'disabled');
    freeBtn.setAttribute('title', 'Free trial already used');
  }
});
