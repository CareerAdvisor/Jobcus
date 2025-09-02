/* static/js/account.js */
;(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

function getSupabase() {
  if (window.__SUPABASE_MISSING__) return null;
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
  if (!window.supabase || typeof window.supabase.createClient !== "function") return null;
  try { return window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY); }
  catch (e) { console.error("Supabase init failed:", e); return null; }
}

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

  const sb = getSupabase();
  const usingSupabase = !!sb;
  if (!usingSupabase && window.__SUPABASE_MISSING__) {
    setFlash("Auth is temporarily unavailable (missing configuration). Using fallback sign-in.");
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
          const { data, error } = await sb.auth.signUp({ email, password });
          if (error) {
            const m = String(error.message || "");
            if (m.toLowerCase().includes("already")) {
              modeInput.value = 'login'; updateView();
              document.getElementById('email').value = email;
              setFlash("Account already exists. Please log in.");
              return;
            }
            throw new Error(m || "Sign up failed");
          }
          try {
            await fetch("/auth/profile", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, fullname }),
            });
          } catch {}
          if (data.session?.access_token) {
            await exchangeSession(data.session.access_token);
            location.href = nextUrl();
          } else {
            setFlash("Check your email to confirm your account.");
          }
          return;
        }
      }

      // Legacy fallback – if your server doesn't support this, you'll see 405
      const payload = { mode, email, password, name: fullname };
      let data = {};
      const res = await fetch('/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // 405 indicates your backend doesn't implement POST /account
      if (res.status === 405) {
        setFlash("Server login endpoint is not enabled. Please contact support.");
        return;
      }

      try { data = await res.json(); } catch { data = {}; }

      if (!res.ok || data.success === false) {
        if (data.code === 'user_exists') {
          modeInput.value = 'login'; updateView();
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
