(async () => {
  const supabaseUrl = window.SUPABASE_URL;
  const supabaseAnonKey = window.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Supabase config missing on reset-password page");
    return;
  }

  const supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  const statusEl = document.getElementById("resetStatus");
  const formEl   = document.getElementById("resetForm");
  const btnEl    = document.getElementById("resetBtn");

  function show(msg, kind = "info") {
    statusEl.textContent = msg;
    statusEl.className = "flash-message " + kind;
    statusEl.style.display = "block";
  }

  // --- Establish session from Supabase recovery link ---
  const hashParams    = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const access_token  = hashParams.get("access_token");
  const refresh_token = hashParams.get("refresh_token");
  const type          = hashParams.get("type");

  console.log("Reset link params:", { type, access_token_present: !!access_token, refresh_token_present: !!refresh_token });

  try {
    if (type !== "recovery" || !access_token) {
      show("Your reset link is invalid or expired. Please request a new one.", "error");
      return;
    }

    // Build session payload – refresh_token may or may not be present
    const sessionPayload = refresh_token
      ? { access_token, refresh_token }
      : { access_token };

    const { data, error } = await supabase.auth.setSession(sessionPayload);
    if (error || !data?.session) {
      console.error("setSession error:", error);
      show("Your reset link is invalid or expired. Please request a new one.", "error");
      return;
    }

    // Remove tokens from the URL so they’re not left in the address bar
    history.replaceState({}, document.title, window.location.pathname);

    // We now have a valid Supabase session for this user
    btnEl.disabled = false;
  } catch (e) {
    console.error("Error establishing recovery session:", e);
    show("Your reset link is invalid or expired. Please request a new one.", "error");
    return;
  }

  // --- Actually change the password ---
  formEl.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    btnEl.disabled = true;

    const password = document.getElementById("newPassword").value.trim();
    if (!password) {
      show("Please enter a new password.", "error");
      btnEl.disabled = false;
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      console.error("updateUser error:", error);
      show("Could not reset your password. Please request a new link and try again.", "error");
      btnEl.disabled = false;
      return;
    }

    await supabase.auth.signOut();
    show("Password updated successfully. Redirecting to sign in…", "success");
    setTimeout(() => {
      window.location.href = "/account?mode=login";
    }, 1500);
  });
})();
