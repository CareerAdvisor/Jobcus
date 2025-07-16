// job-insights.js

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

// === 1. Salary Insights ===
function fetchSalaryData() {
  fetch("/api/salary")
    .then(res => res.json())
    .then(data => {
      if (!data || !data.labels || !data.salaries) {
        console.error("Invalid salary data format", data);
        return;
      }
      renderBarChart("salary-chart", data.labels, data.salaries, "Average Salary (£)");
    })
    .catch(err => console.error("Salary Data Error:", err));
}

// === 2. Job Count ===
function fetchJobCountData() {
  fetch("/api/job-count")
    .then(res => res.json())
    .then(data => {
      if (!data || !data.labels || !data.counts) {
        console.error("Invalid job count data format", data);
        return;
      }
      renderBarChart("jobcount-chart", data.labels, data.counts, "Open Positions");
    })
    .catch(err => console.error("Job Count Error:", err));
}

// === 3. Skill Trends ===
function fetchSkillTrends() {
  fetch("/api/skills")
    .then(res => res.json())
    .then(data => {
      if (!data || !data.labels || !data.frequency) {
        console.error("Invalid skill data format", data);
        return;
      }
      renderBarChart("skill-chart", data.labels, data.frequency, "Demand Level");
    })
    .catch(err => console.error("Skill Trends Error:", err));
}

// === 4. Location Insights ===
function fetchLocationData() {
  fetch("/api/locations")
    .then(res => res.json())
    .then(data => {
      if (!data || !data.labels || !data.counts) {
        console.error("Invalid location data format", data);
        return;
      }
      renderBarChart("location-chart", data.labels, data.counts, "Hiring Demand");
    })
    .catch(err => console.error("Location Data Error:", err));
}

// === DOM Ready ===
document.addEventListener("DOMContentLoaded", () => {
  fetchSalaryData();
  fetchJobCountData();
  fetchSkillTrends();
  fetchLocationData();
});
