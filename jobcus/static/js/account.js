/* static/js/account.js */

/* 1) Force cookies on every fetch */
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    init.credentials = init.credentials || 'same-origin';
    return _fetch(input, init);
  };
})();

/* 2) Supabase client guard */
function getSupabase() {
  const hasVars = !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY);
  const hasSDK  = typeof window.supabase !== "undefined" && typeof window.supabase.createClient === "function";
  if (!hasVars || !hasSDK) {
    console.error("Supabase not available on account page");
    return null;
  }
  return window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
}

/* 3) Helpers */
function nextUrl() {
  return new URLSearchParams(location.search).get("next") || "/dashboard";
}
async function exchangeSession(access_token) {
  const r = await fetch("/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token }),
  });
  if (!r.ok) throw new Error("Could not establish server session");
}

function setFlash(msg) {
  const flash = document.getElementById('flashMessages');
  if (!flash) return;
  flash.textContent = "";
  if (msg) {
    const div = document.createElement("div");
    div.className = "flash-item";
    div.textContent = msg;
    flash.appendChild(div);
  }
}

/* 4) UI & form logic */
document.addEventListener('DOMContentLoaded', async () => {
  // Try immediately…
  let sb = getSupabase();

  // …and if not ready, wait for window load once (covers slow CDN edge case)
  if (!sb) {
    await new Promise(res => window.addEventListener('load', res, { once: true }));
    sb = getSupabase();
    if (!sb) {
      // If env vars are missing, surface a clear message
      if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
        setFlash("Auth is temporarily unavailable (missing configuration). Please contact support.");
      } else {
        setFlash("Auth is temporarily unavailable. Please reload the page.");
      }
      return;
    }
  }

  // ─── Grab elements ───
  const form        = document.getElementById('accountForm');
  const modeInput   = document.getElementById('mode');
  const nameGroup   = document.getElementById('nameGroup');
  const formTitle   = document.querySelector('.auth-title');
  const subtitle    = document.querySelector('.auth-subtitle');
  const submitBtn   = document.getElementById('submitButton');
  const toggleLink  = document.getElementById('toggleMode');
  const togglePrompt= document.getElementById('togglePrompt');

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
    setFlash("");
  }

  toggleLink.addEventListener('click', e => {
    e.preventDefault();
    modeInput.value = (modeInput.value === 'login' ? 'signup' : 'login');
    updateView();
  });

  updateView();

  // Handle form submit using Supabase (no POST /account 405s anymore)
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFlash("");

    const mode     = modeInput.value;
    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const fullname = document.getElementById('name')?.value.trim() || "";

    try {
      if (mode === "login") {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;

        await exchangeSession(data.session.access_token);
        location.href = nextUrl();
        return;
      }

      // signup
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) {
        if (String(error.message || "").toLowerCase().includes("already")) {
          modeInput.value = 'login';
          updateView();
          document.getElementById('email').value = email;
          setFlash("Account already exists. Please log in.");
          return;
        }
        throw error;
      }

      // optional: inform backend about profile
      try {
        await fetch("/auth/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, fullname }),
        });
      } catch {}

      if (data.session?.access_token) {
        await exchangeSession(data.session.access_token);
        location.href = nextUrl();
      } else {
        setFlash("Check your email to confirm your account.");
      }
    } catch (err) {
      console.error("Auth error:", err);
      setFlash(err.message || "Request failed. Please try again.");
    }
  });
});
