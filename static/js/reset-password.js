(async () => {
  const supabaseUrl = window.SUPABASE_URL;
  const supabaseAnonKey = window.SUPABASE_ANON_KEY;
  const supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  const statusEl = document.getElementById('resetStatus');
  const formEl = document.getElementById('resetForm');
  const btnEl = document.getElementById('resetBtn');

  function show(msg, kind = 'info') {
    statusEl.textContent = msg;
    statusEl.className = 'flash-message ' + kind;
    statusEl.style.display = 'block';
  }

  // --- establish session from email link ---
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const access_token  = hashParams.get('access_token');
  const refresh_token = hashParams.get('refresh_token');
  const type          = hashParams.get('type');

  try {
    // 1) Prefer recovery tokens in the hash fragment
    if (type === 'recovery' && access_token) {
      const sessionPayload = refresh_token
        ? { access_token, refresh_token }
        : { access_token };

      const { data, error } = await supabase.auth.setSession(sessionPayload);
      if (error || !data?.session) {
        throw error || new Error('No session from recovery token');
      }

      // Clean up the URL so tokens are not left in the address bar
      history.replaceState({}, document.title, window.location.pathname);
    }
    // 2) Fallback: if you ever use PKCE `code` flow for auth,
    // handle it *after* the recovery case.
    else if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error || !data?.session) {
        throw error || new Error('No session from code exchange');
      }
    }
    // 3) Nothing useful in the URL
    else {
      show('Your reset link is invalid or expired. Please request a new one.', 'error');
      return;
    }

    // If we got here, we have a valid session
    btnEl.disabled = false;
  } catch (e) {
    console.error('Error establishing recovery session:', e);
    show('Your reset link is invalid or expired. Please request a new one.', 'error');
    return;
  }

  // --- actually change the password ---
  formEl.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    btnEl.disabled = true;

    const password = document.getElementById('newPassword').value.trim();
    if (!password) {
      show('Please enter a new password.', 'error');
      btnEl.disabled = false;
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      console.error('updateUser error:', error);
      show('Could not reset your password. Please request a new link and try again.', 'error');
      btnEl.disabled = false;
      return;
    }

    await supabase.auth.signOut();
    show('Password updated successfully. Redirecting to sign in…', 'success');
    setTimeout(() => { window.location.href = "/account?mode=login"; }, 1500);
  });
})();
