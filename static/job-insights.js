// job-insights.js

document.addEventListener("DOMContentLoaded", () => {
  fetchSalaryData();
  fetchJobCountData();
  fetchSkillTrends();
  fetchLocationData();
});

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
