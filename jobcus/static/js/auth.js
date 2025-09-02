(function () {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    console.error("Supabase config missing");
    return;
  }
  const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  // Example: handle login form submit
  const form = document.querySelector('#loginForm'); // adjust selectors to your markup
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // Success → reload or redirect to next
      const next = new URLSearchParams(location.search).get('next') || '/dashboard';
      location.href = next;
    } catch (err) {
      alert(err.message || "Request failed. Please try again.");
    }
  });

  // Example: handle signup form submit similarly with supabase.auth.signUp(...)
})();
