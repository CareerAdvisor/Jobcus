// /static/js/auth.js
(function () {
  // guard
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY || !window.supabase) {
    console.error("Supabase config missing on page");
    return;
  }
  const client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  async function exchangeForServerSession(access_token) {
    const r = await fetch("/api/session/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ access_token }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || "Could not start session");
    return j;
  }

  function nextUrl() {
    const p = new URLSearchParams(location.search);
    return p.get("next") || "/dashboard";
  }

  // Login
  const loginForm = document.querySelector("#loginForm");
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = loginForm.email.value.trim();
    const password = loginForm.password.value;
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await exchangeForServerSession(data.session.access_token);
      location.href = nextUrl();
    } catch (err) {
      alert(err.message || "Request failed. Please try again.");
    }
  });

  // Signup
  const signupForm = document.querySelector("#signupForm");
  signupForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = signupForm.email.value.trim();
    const password = signupForm.password.value;
    try {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw error;

      // If email confirmation is ON: show a “check email” page instead.
      if (!data.session) {
        location.href = "/check-email";
        return;
      }
      await exchangeForServerSession(data.session.access_token);
      location.href = nextUrl();
    } catch (err) {
      alert(err.message || "Request failed. Please try again.");
    }
  });
})();
