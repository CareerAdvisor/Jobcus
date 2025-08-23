// Keep cookies for SameSite/Lax
;(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

const PLAN_COPY = {
  free: {
    name: "Free",
    features: [
      "3 resume analyses / month",
      "Scorecard + formatting + readability",
      "Basic ATS keyword suggestions",
      "2 cover letters / month",
      "Store latest result on this device"
    ],
    next: () => { 
      localStorage.setItem("userPlan", "free");
      window.location.href = "/dashboard";
    }
  },
  standard: {
    name: "Standard",
    features: [
      "50 resume analyses / month",
      "AI Optimize + “Rebuild with AI”",
      "Deep ATS keywords & relevance",
      "10 cover letters / month",
      "Download optimized PDF/DOCX/TXT",
      "Save history across devices",
      "Email support"
    ],
    next: () => {
      const authed = document.body?.dataset?.authed === "1";
      if (authed) window.location.href = "/checkout?plan=standard";
      else window.location.href = "/account?next=/checkout?plan=standard";
    }
  },
  premium: {
    name: "Premium",
    features: [
      "Unlimited* resume analyses (fair use)",
      "Everything in Standard",
      "Priority scoring & relevance tuning",
      "Unlimited cover letters",
      "Multi-resume versions & template pack",
      "Job match insights & tracker",
      "Priority support"
    ],
    next: () => {
      const authed = document.body?.dataset?.authed === "1";
      if (authed) window.location.href = "/checkout?plan=premium";
      else window.location.href = "/account?next=/checkout?plan=premium";
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  // Highlight previously chosen plan (if any)
  const current = localStorage.getItem("userPlan");
  if (current) {
    document.querySelectorAll(".plan-card").forEach(c => {
      c.classList.toggle("is-current", c.dataset.plan === current);
    });
  }

  // Wire plan selection
  document.querySelectorAll(".select-plan").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const plan = btn.dataset.plan;
      openPlanModal(plan);
    });
  });

  // Modal controls
  const modal = document.getElementById("planModal");
  const closeBtn = document.getElementById("planModalClose");
  const cancelBtn = document.getElementById("planCancelBtn");
  const continueBtn = document.getElementById("planContinueBtn");

  closeBtn?.addEventListener("click", () => hideModal());
  cancelBtn?.addEventListener("click", () => hideModal());

  continueBtn?.addEventListener("click", () => {
    const plan = modal?.dataset?.plan;
    if (!plan || !PLAN_COPY[plan]) return hideModal();
    // Store selection locally so other pages can gate features immediately
    localStorage.setItem("userPlan", plan);
    PLAN_COPY[plan].next();
  });

  function openPlanModal(plan) {
    if (!PLAN_COPY[plan]) return;

    modal.dataset.plan = plan;
    document.getElementById("modalPlanName").textContent = PLAN_COPY[plan].name;

    const ul = document.getElementById("planModalFeatures");
    ul.innerHTML = "";
    PLAN_COPY[plan].features.forEach(f => {
      const li = document.createElement("li");
      li.textContent = f;
      ul.appendChild(li);
    });

    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
  }

  function hideModal() {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }
});
