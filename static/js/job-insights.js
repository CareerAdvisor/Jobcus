// job-insights.js

function renderError(canvasId, message) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const parent = canvas.closest(".chart-box") || canvas.parentElement;
  if (!parent) return;
  const msg = document.createElement("div");
  msg.className = "chart-error";
  msg.textContent = message || "Sorry — couldn’t load this chart.";
  msg.style.cssText = "padding:12px;border:1px solid #f2d6d6;background:#fff3f3;color:#a40000;border-radius:8px;margin-top:8px;";
  parent.appendChild(msg);
}

function fetchJSON(url) {
  return fetch(url).then(async (res) => {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} – ${text.slice(0,120)}`);
    }
    return res.json();
  });
}

// === 1. Salary Insights ===
function fetchSalaryData() {
  const params = new URLSearchParams(window.location.search);
  const role = params.get("role") || "";
  const location = params.get("location") || "";
  const qs = new URLSearchParams();
  if (role) qs.set("role", role);
  if (location) qs.set("location", location);

  fetchJSON(`/api/salary?${qs.toString()}`)
    .then(data => {
      if (!data || !Array.isArray(data.labels) || !Array.isArray(data.salaries)) {
        throw new Error("Invalid salary data shape");
      }
      renderBarChart("salary-chart", data.labels, data.salaries, "Average Salary (£)");
    })
    .catch(err => {
      console.error("Salary Data Error:", err);
      renderError("salary-chart", "Couldn’t load salary data right now.");
    });
}

// === Utility to Render Bar Charts ===
function renderBarChart(canvasId, labels, data, labelText) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.warn(`Canvas not found: ${canvasId}`);
    return;
  }

  // Clear previous chart if needed
  if (canvas.chartInstance) {
    canvas.chartInstance.destroy();
  }

  const ctx = canvas.getContext("2d");
  canvas.chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: labelText,
          data: data,
          backgroundColor: "#104879",
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            color: "#333",
            precision: 0,
          },
        },
        x: {
          ticks: {
            color: "#333",
          },
        },
      },
      plugins: {
        legend: {
          display: true,
          labels: {
            color: "#104879",
            font: {
              weight: "bold"
            }
          }
        }
      }
    },
  });
}

function qs(params = {}) {
  const pairs = Object.entries(params).filter(([, v]) => v && String(v).trim() !== "");
  return new URLSearchParams(Object.fromEntries(pairs)).toString();
}

// === 1. Salary Insights ===
function fetchSalaryData(filters = {}) {
  fetch("/api/salary?" + qs(filters))
    .then(res => res.json())
    .then(data => {
      if (!data || !data.labels || !data.salaries) return console.error("Invalid salary data format", data);
      renderBarChart("salary-chart", data.labels, data.salaries, "Average Salary (£)");
    })
    .catch(err => console.error("Salary Data Error:", err));
}

// === 2. Job Count ===
function fetchJobCountData(filters = {}) {
  fetch("/api/job-count?" + qs(filters))
    .then(res => res.json())
    .then(data => {
      if (!data || !data.labels || !data.counts) return console.error("Invalid job count data format", data);
      renderBarChart("jobcount-chart", data.labels, data.counts, "Open Positions");
    })
    .catch(err => console.error("Job Count Error:", err));
}

// === 3. Skill Trends ===
function fetchSkillTrends(filters = {}) {
  fetch("/api/skills?" + qs(filters))
    .then(res => res.json())
    .then(data => {
      if (!data || !data.labels || !data.frequency) return console.error("Invalid skill data format", data);
      renderBarChart("skill-chart", data.labels, data.frequency, "Demand Level");
    })
    .catch(err => console.error("Skill Trends Error:", err));
}

// === 4. Location Insights ===
function fetchLocationData(filters = {}) {
  fetch("/api/locations?" + qs(filters))
    .then(res => res.json())
    .then(data => {
      if (!data || !data.labels || !data.counts) return console.error("Invalid location data format", data);
      renderBarChart("location-chart", data.labels, data.counts, "Hiring Demand");
    })
    .catch(err => console.error("Location Data Error:", err));
}

// === DOM Ready ===
document.addEventListener("DOMContentLoaded", () => {
  const roleEl = document.getElementById("roleInput");
  const locEl  = document.getElementById("locationInput");
  const btn    = document.getElementById("applyFilters");

  const runAll = () => {
    const filters = {
      role: roleEl?.value.trim(),
      location: locEl?.value.trim(),
    };
    fetchSalaryData(filters);
    fetchJobCountData(filters);
    fetchSkillTrends(filters);
    fetchLocationData(filters);
  };

  btn?.addEventListener("click", runAll);
  // Enter key on either input
  [roleEl, locEl].forEach(el => el?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); runAll(); }
  }));

  // Initial load (no filters)
  runAll();
});

