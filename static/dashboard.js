// dashboard.js

// --- Toggle visibility for any dashboard section ---
function toggleSection(id) {
  const section = document.getElementById(id);
  if (section) {
    section.style.display = section.style.display === 'none' ? 'block' : 'none';
  }
}

document.addEventListener("DOMContentLoaded", function () {
  // --- Animate Resume Score Circles ---
  const circles = document.querySelectorAll(".progress-circle");
  circles.forEach(circle => {
    const value = circle.dataset.score || 0;
    const progressPath = circle.querySelector(".progress");
    progressPath.setAttribute("stroke-dasharray", `${value}, 100`);
    const percentageText = circle.querySelector(".percentage");
    percentageText.textContent = `${value}%`;
  });

  // --- Fetch Resume Analysis from backend ---
  fetch('/api/resume-analysis')
    .then(res => res.json())
    .then(data => {
      // ✅ Update Resume Score Circle
      const circle = document.querySelector('.progress-circle');
      if (circle) {
        const progressPath = circle.querySelector(".progress");
        const percentageText = circle.querySelector(".percentage");
        const score = data.score || 0;
        progressPath.setAttribute("stroke-dasharray", `${score}, 100`);
        percentageText.textContent = `${score}%`;
      }

      // ✅ Populate issues dynamically
      const issuesList = document.getElementById('top-issues');
      if (issuesList) {
        issuesList.innerHTML = '';
        (data.analysis?.issues || []).forEach(issue => {
          const li = document.createElement('li');
          li.textContent = issue;
          issuesList.appendChild(li);
        });
      }

      // ✅ Populate strengths dynamically
      const strengthsList = document.getElementById('good-points');
      if (strengthsList) {
        strengthsList.innerHTML = '';
        (data.analysis?.strengths || []).forEach(point => {
          const li = document.createElement('li');
          li.textContent = point;
          strengthsList.appendChild(li);
        });
      }
    })
    .catch(err => console.error("Resume analysis fetch error:", err));

  // --- User Progress Chart (Bar Chart) ---
  const chartCanvas = document.getElementById('userProgressChart');
  if (chartCanvas) {
    const ctx = chartCanvas.getContext('2d');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Resume Score', 'Skill Gap Filled', 'Job Matches'],
        datasets: [{
          label: 'Progress (%)',
          data: [85, 70, 60], // ✅ Replace with actual values if available
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
  }
});
