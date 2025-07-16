// static/job-insights.js

document.addEventListener("DOMContentLoaded", () => {
  // Example data - replace this with real-time fetched data later
  const salaryData = {
    labels: ["Software Engineer", "Data Analyst", "Project Manager", "UX Designer", "Cybersecurity Analyst"],
    salaries: [85000, 68000, 90000, 72000, 95000],
  };

  const jobCountData = {
    labels: ["Software Engineer", "Data Analyst", "Project Manager", "UX Designer", "Cybersecurity Analyst"],
    counts: [1200, 800, 950, 600, 500],
  };

  const skillData = {
    labels: ["Python", "SQL", "Project Management", "UI/UX", "Cloud Security"],
    frequency: [90, 80, 75, 70, 60],
  };

  const locationData = {
    labels: ["London", "Manchester", "Birmingham", "Leeds", "Glasgow"],
    counts: [300, 220, 180, 140, 130],
  };

  // Render each chart
  renderBarChart("salary-chart", salaryData.labels, salaryData.salaries, "Average Salary (£)");
  renderBarChart("jobcount-chart", jobCountData.labels, jobCountData.counts, "Open Positions");
  renderBarChart("skill-chart", skillData.labels, skillData.frequency, "Demand Level");
  renderBarChart("location-chart", locationData.labels, locationData.counts, "Hiring Demand");
});

function renderBarChart(canvasId, labels, data, labelText) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  new Chart(ctx, {
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
