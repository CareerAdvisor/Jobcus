// job-insights.js

document.addEventListener("DOMContentLoaded", () => {
  const jobTitles = ["Software Engineer", "Data Analyst", "Project Manager", "Graphic Designer"];

  fetchSalaryData(jobTitles);
  fetchJobCount(jobTitles);
  fetchSkillTrends();
  fetchLocationData("software engineer");
});

// === 1. Salary Insights ===
async function fetchSalaryData(titles) {
  const labels = [];
  const salaries = [];

  for (const title of titles) {
    const response = await fetch(`/api/salary?title=${encodeURIComponent(title)}`);
    const data = await response.json();
    labels.push(title);
    salaries.push(data.average_salary || 0);
  }

  new Chart(document.getElementById("salary-chart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Average Salary (GBP)",
        data: salaries,
        backgroundColor: "#104879"
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

// === 2. Job Count ===
async function fetchJobCount(titles) {
  const labels = [];
  const counts = [];

  for (const title of titles) {
    const response = await fetch(`/api/job-count?title=${encodeURIComponent(title)}`);
    const data = await response.json();
    labels.push(title);
    counts.push(data.count || 0);
  }

  new Chart(document.getElementById("jobcount-chart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Open Positions",
        data: counts,
        backgroundColor: "#3f5f95"
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

// === 3. Skill Trends ===
async function fetchSkillTrends() {
  const response = await fetch("/api/skills");
  const data = await response.json();

  const labels = data.skills.map(s => s.name);
  const freq = data.skills.map(s => s.count);

  new Chart(document.getElementById("skill-chart"), {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        label: "Skill Demand",
        data: freq,
        backgroundColor: ["#104879", "#3f5f95", "#6d88b8", "#b5c6e0"]
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "bottom"
        }
      }
    }
  });
}

// === 4. Location Insights ===
async function fetchLocationData(title) {
  const response = await fetch(`/api/locations?title=${encodeURIComponent(title)}`);
  const data = await response.json();

  const labels = data.locations.map(loc => loc.name);
  const jobs = data.locations.map(loc => loc.count);

  new Chart(document.getElementById("location-chart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Jobs by Region",
        data: jobs,
        backgroundColor: "#104879"
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}
