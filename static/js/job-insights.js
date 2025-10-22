// job-insights.js

// --- Helpers -------------------------------------------------
function $(id) { return document.getElementById(id); }

function readFilters() {
  // URL params (role, location) prefill if present
  const params = new URLSearchParams(location.search);
  const roleParam = (params.get("role") || "").trim();
  const locParam  = (params.get("location") || "").trim();

  const roleEl = $("roleInput");
  const locEl  = $("locationInput");

  if (roleEl && roleParam && !roleEl.value) roleEl.value = roleParam;
  if (locEl  && locParam  && !locEl.value)  locEl.value  = locParam;

  return {
    role: (roleEl?.value || roleParam || "").trim(),
    location: (locEl?.value || locParam || "").trim(),
  };
}

function qs(params) {
  const url = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) url.set(k, v); });
  const s = url.toString();
  return s ? `?${s}` : "";
}

function showError(msg) {
  const el = $("filtersError");
  if (!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
}

// --- Charts --------------------------------------------------
function renderBarChart(canvasId, labels, data, labelText) {
  const canvas = $(canvasId);
  if (!canvas) {
    console.warn(`Canvas not found: ${canvasId}`);
    return;
  }

  if (canvas.chartInstance) {
    canvas.chartInstance.destroy();
  }

  const ctx = canvas.getContext("2d");
  canvas.chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: labelText,
        data,
        backgroundColor: "#104879",
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, ticks: { color: "#333", precision: 0 } },
        x: { ticks: { color: "#333" } }
      },
      plugins: {
        legend: { display: true, labels: { color: "#104879", font: { weight: "bold" } } },
        tooltip: { intersect: false }
      }
    }
  });
}

// --- API fetchers (each passes role/location) ----------------
async function fetchJSON(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 401) {
    // If your endpoints are protected by @api_login_required
    throw new Error("signin-required");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Request failed ${res.status}: ${text.slice(0, 140)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function fetchSalaryData() {
  const { role, location } = readFilters();
  return fetchJSON(`/api/salary${qs({ role, location })}`)
    .then(data => {
      if (!data || !Array.isArray(data.labels) || !Array.isArray(data.salaries)) {
        throw new Error("Bad salary payload");
      }
      renderBarChart("salary-chart", data.labels, data.salaries, "Average Salary (£)");
    });
}

function fetchJobCountData() {
  const { role, location } = readFilters();
  return fetchJSON(`/api/job-count${qs({ role, location })}`)
    .then(data => {
      if (!data || !Array.isArray(data.labels) || !Array.isArray(data.counts)) return;
      renderBarChart("jobcount-chart", data.labels, data.counts, "Open Positions");
    });
}

function fetchSkillTrends() {
  const { role, location } = readFilters();
  return fetchJSON(`/api/skills${qs({ role, location })}`)
    .then(data => {
      if (!data || !Array.isArray(data.labels) || !Array.isArray(data.frequency)) return;
      renderBarChart("skill-chart", data.labels, data.frequency, "Demand Level");
    });
}

function fetchLocationData() {
  const { role, location } = readFilters();
  return fetchJSON(`/api/locations${qs({ role, location })}`)
    .then(data => {
      if (!data || !Array.isArray(data.labels) || !Array.isArray(data.counts)) return;
      renderBarChart("location-chart", data.labels, data.counts, "Hiring Demand");
    });
}

// Run all (and show friendly errors)
function runAll() {
  showError(""); // clear
  Promise.allSettled([
    fetchSalaryData(),
    fetchJobCountData(),
    fetchSkillTrends(),
    fetchLocationData()
  ]).then(results => {
    // if any failed because of auth, surface one clear message
    const authFail = results.find(r => r.status === "rejected" && r.reason?.message === "signin-required");
    if (authFail) {
      showError("Please sign in to view full insights.");
      return;
    }
    const genericFail = results.find(r => r.status === "rejected");
    if (genericFail) {
      console.error("Insights load error:", genericFail.reason);
      showError("We couldn’t load all insights. Please try again.");
    }
  });
}

// --- Wire up -------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const roleEl = $("roleInput");
  const locEl  = $("locationInput");
  const btn    = $("applyFilters");

  // Apply button
  btn?.addEventListener("click", runAll);

  // Enter key submits
  [roleEl, locEl].forEach(el => {
    el?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runAll();
      }
    });
  });

  // Initial load
  runAll();
});
