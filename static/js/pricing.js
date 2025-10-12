// Keep cookies for SameSite/Lax
;(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

// Remember intended plan when clicking a subscribe link
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll('.plan a[href*="/subscribe"]').forEach(a => {
    a.addEventListener('click', () => {
      try {
        const url = new URL(a.href, window.location.origin);
        const plan = url.searchParams.get('plan') || '';
        localStorage.setItem('intendedPlan', plan);
      } catch (_) { /* ignore */ }
    });
  });

  // Ensure all plan links behave consistently (go to /subscribe first)
  document.querySelectorAll('.plan a[href*="/subscribe"]').forEach(a => {
    a.classList.add('subscribe-link');
  });
});

// Helper: always start at /subscribe?plan=...
function navigateToSubscribe(plan) {
  if (!plan) plan = 'free';
  const params = new URLSearchParams({ plan });
  // Preserve "next" if present on current URL
  const currentNext = new URLSearchParams(location.search).get('next');
  if (currentNext) params.set('next', currentNext);
  window.location.assign(`/subscribe?${params.toString()}`);
  // Remember for UI highlights
  localStorage.setItem("userPlan", plan);
}

const PLAN_ROUTES = {
  free()       { navigateToSubscribe("free"); },
  weekly()     { navigateToSubscribe("weekly"); },
  standard()   { navigateToSubscribe("standard"); },
  premium()    { navigateToSubscribe("premium"); },
  employer_jd(){ navigateToSubscribe("employer_jd"); } // NEW
};

// (Old direct-checkout path fixed, but unused now)
// Kept for reference; if you ever restore direct checkout, fix the interpolation.
// function routePaid(plan) {
//   localStorage.setItem("userPlan", plan);
//   const authed = document.body?.dataset?.authed === "1";
//   if (authed) window.location.href = `/checkout?plan=${encodeURIComponent(plan)}`;
//   else window.location.href = `/account?next=${encodeURIComponent("/checkout?plan=" + plan)}`;
// }

document.addEventListener("DOMContentLoaded", () => {
  // Highlight previously chosen plan (optional)
  const current = localStorage.getItem("userPlan");
  if (current) {
    document.querySelectorAll(".plan").forEach(card => {
      card.classList.toggle("is-current", card.dataset.plan === current);
    });
  }

  // Intercept clicks on subscribe links so all plans route uniformly
  document.querySelectorAll('.plan a[href*="/subscribe"]').forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      let plan = "";
      try {
        const url = new URL(a.getAttribute("href"), location.origin);
        plan = url.searchParams.get("plan");
      } catch { /* ignore */ }
      if (!plan) {
        plan = a.closest(".plan")?.dataset?.plan || "free";
      }
      (PLAN_ROUTES[plan] || PLAN_ROUTES.free)();
    });
  });
});
