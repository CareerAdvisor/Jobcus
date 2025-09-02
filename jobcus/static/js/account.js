/* static/js/account.js */

/* 1) Always send cookies on fetch (SameSite/Lax) */
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

/* 2) Supabase client (optional) */
function getSupabase() {
  // If keys missing or SDK not loaded, return null and let legacy path run
  if (window.__SUPABASE_MISSING__) return null;
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
  if (!window.supabase || typeof window.supabase.createClient !== "function") return null;
  try {
    return window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  } catch (e) {
    console.error("Supabase init failed:", e);
    return null;
  }
}

/* 3) Helpers */
function nextUrl() {
  const p = new URLSearchParams(location.search).get("next");
  return p || "/dashboard";
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
  const flash = document.getElementById("flashMessages");
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
document.addEventListener("DOMContentLoaded", () => {
  const form        = document.getElementById('accountForm');
  const modeInput   = document.getElementById('mode');
  const nameGroup   = document.getElementById('nameGroup');
  const formTitle   = document.querySelector('.auth-title');
  const subtitle    = document.querySelector('.auth-subtitle');
  const submitBtn   = document.getElementById('submitButton');
  const toggleLink  = document.getElementById('toggleMode');
  const togglePrompt= document.getElementById('togglePrompt');

  function updateView() {
    const mode = modeInput.value || "login";
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

  /* 5) Choose auth mode: Supabase (if available) or legacy /account */
  const sb = getSupabase();
  const usingSupabase = !!sb;

  if (!usingSupabase) {
    // Informative (but non-blocking) message if config is missing
    if (window.__SUPABASE_MISSING__) {
      setFlash("Auth is temporarily unavailable (missing configuration). Using fallback sign-in.");
      console.warn("Supabase config missing on account page; using legacy /account login.");
    } else {
      console.warn("Supabase not available on account page; using legacy /account login.");
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFlash("");

    const mode     = (modeInput.value || "login").toLowerCase();
    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const fullname = document.getElementById('name')?.value.trim() || "";

    try {
      if (usingSupabase) {
        if (mode === "login") {
          const { data, error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw new Error(error.message || "Login failed");
          await exchangeSession(data.session.access_token);
          location.href = nextUrl();
          return;
        } else {
          const { data, error } = await sb.auth.signUp({
            email,
            password,
            // Optionally set redirect URL after email confirmation:
            // options: { emailRedirectTo: `${location.origin}/account` }
          });
          if (error) {
            const msg = String(error.message || "");
            if (msg.toLowerCase().includes("already")) {
              modeInput.value = 'login';
              updateView();
              document.getElementById('email').value = email;
              setFlash("Account already exists. Please log in.");
              return;
            }
            throw new Error(msg || "Sign up failed");
          }

          // Optional: profile seed on backend
          try {
            await fetch("/auth/profile", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, fullname }),
            });
          } catch { /* best-effort */ }

          if (data.session?.access_token) {
            await exchangeSession(data.session.access_token);
            location.href = nextUrl();
          } else {
            setFlash("Check your email to confirm your account.");
          }
          return;
        }
      }

      // ─── Legacy fallback: POST to /account (existing server auth) ───
      const payload = { mode, email, password, name: fullname };
      let data = {};
      const res = await fetch('/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      try { data = await res.json(); } catch { data = {}; }

      if (!res.ok || data.success === false) {
        if (data.code === 'user_exists') {
          modeInput.value = 'login';
          updateView();
          document.getElementById('email').value = email;
          setFlash(data.message || 'Account already exists. Please log in.');
          return;
        }
        if (data.code === 'email_not_confirmed' && data.redirect) {
          window.location.assign(data.redirect);
          return;
        }
        setFlash(data.message || 'Request failed. Please try again.');
        return;
      }

      if (data.redirect) {
        // tidy up client cache used elsewhere
        localStorage.removeItem('resumeAnalysis');
        localStorage.removeItem('resumeBase64');
        localStorage.removeItem('dashboardVisited');
        window.location.assign(data.redirect);
        return;
      }

      setFlash('Unexpected response. Please try again.');
    } catch (err) {
      console.error('Auth error:', err);
      setFlash(err.message || 'Server error. Please try again later.');
    }
  });
});
