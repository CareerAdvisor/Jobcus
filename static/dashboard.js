// dashboard.js

// Toggle visibility of each dashboard section
function toggleSection(id) {
  const section = document.getElementById(id);
  if (section) {
    section.style.display = section.style.display === 'none' ? 'block' : 'none';
  }
}

// Simulate loading resume score
document.addEventListener("DOMContentLoaded", function () {
  const circles = document.querySelectorAll(".progress-circle");

  circles.forEach(circle => {
    const value = circle.dataset.score || 0;
    const progressPath = circle.querySelector(".progress");
    progressPath.setAttribute("stroke-dasharray", `${value}, 100`);
    const percentageText = circle.querySelector(".percentage");
    percentageText.textContent = `${value}%`;
  });
});

document.addEventListener("DOMContentLoaded", function () {
  const ctx = document.getElementById('userProgressChart').getContext('2d');

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Resume Score', 'Skill Gap Filled', 'Job Matches'],
      datasets: [{
        label: 'Progress (%)',
        data: [85, 70, 60], // You can dynamically replace these with actual values
        backgroundColor: ['#104879', '#0077b6', '#48cae4'],
        borderWidth: 1,
        borderRadius: 5
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { stepSize: 20 }
        }
      }
    }
  });
});
