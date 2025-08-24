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
});

const PLAN_ROUTES = {
  free() {
    localStorage.setItem("userPlan", "free");
    // lightweight onboarding: jump to dashboard
    window.location.href = "/dashboard";
  },
  weekly() {
    routePaid("weekly");
  },
  standard() {
    routePaid("standard");
  },
  premium() {
    routePaid("premium");
  }
};

function routePaid(plan) {
  localStorage.setItem("userPlan", plan);
  // depends on body data-authed provided by base.html
  const authed = document.body?.dataset?.authed === "1";
  if (authed) window.location.href = `/checkout?plan=${encodeURIComponent(plan)}`;
  else window.location.href = `/account?next=${encodeURIComponent("/checkout?plan=" + plan)}`;
}

document.addEventListener("DOMContentLoaded", () => {
  // Highlight previously chosen plan (optional)
  const current = localStorage.getItem("userPlan");
  if (current) {
    document.querySelectorAll(".plan").forEach(card => {
      card.classList.toggle("is-current", card.dataset.plan === current);
    });
  }

  // Intercept clicks on subscribe links
  document.querySelectorAll(".subscribe-link").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      let plan;
      try {
        const url = new URL(a.getAttribute("href"), location.origin);
        plan = url.searchParams.get("plan");
      } catch { /* ignore */ }
      plan = plan || a.closest(".plan")?.dataset?.plan || "free";
      (PLAN_ROUTES[plan] || PLAN_ROUTES.free)();
    });
  });
});
