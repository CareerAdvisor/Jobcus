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

