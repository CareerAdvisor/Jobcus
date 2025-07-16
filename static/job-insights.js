document.addEventListener("DOMContentLoaded", function () {
  // Salary Chart example
  const ctx = document.getElementById("salary-chart").getContext("2d");

  new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Software Engineer", "Data Analyst", "UX Designer", "Product Manager"],
      datasets: [{
        label: "Average Salary ($)",
        data: [85000, 70000, 75000, 90000],
        backgroundColor: "#104879"
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  });
});
