// Keep cookies for SameSite/Lax
;(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

// --- Helpers ---
async function whoami() {
  const r = await fetch('/api/me', { credentials: 'same-origin' });
  if (!r.ok) return { authenticated: false };
  return r.json();
}

async function pickPlan(plan) {
  const me = await whoami();

  if (!me || !me.authenticated) {
    // redirect unauth’d user to login with next=/subscribe
    const next = `/subscribe?plan=${encodeURIComponent(plan)}`;
    location.href = `/account?mode=login&next=${encodeURIComponent(next)}`;
    return;
  }

  if (plan === 'free') {
    const r = await fetch('/api/plan/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ plan })
    });
    const j = await r.json();
    if (j.success && j.redirect) location.href = j.redirect;
    else alert(j.message || 'Could not activate Free.');
    return;
  }

  // Paid plans -> Stripe Checkout
  const r = await fetch('/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ plan })
  });
  const j = await r.json();
  if (j.success && j.url) location.href = j.url;
  else alert(j.message || 'Could not start checkout.');
}

// --- Attach handlers ---
document.addEventListener("DOMContentLoaded", () => {
  // Old logic: highlight current plan
  const current = localStorage.getItem("userPlan");
  if (current) {
    document.querySelectorAll(".plan").forEach(card => {
      card.classList.toggle("is-current", card.dataset.plan === current);
    });
  }

  // Intercept clicks on plan buttons
  document.querySelectorAll(".plan a[href*='plan=']").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      let plan;
      try {
        const url = new URL(a.getAttribute("href"), location.origin);
        plan = url.searchParams.get("plan");
      } catch { /* ignore */ }
      plan = plan || a.closest(".plan")?.dataset?.plan || "free";

      localStorage.setItem("userPlan", plan);
      pickPlan(plan);
    });
  });
});
