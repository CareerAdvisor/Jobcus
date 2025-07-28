// mydashboard.js

// Toggle visibility of each dashboard section
function toggleSection(id) {
  const section = document.getElementById(id);
  if (section) {
    section.style.display = section.style.display === 'none' ? 'block' : 'none';
  }
}

// Simulate loading resume score
window.addEventListener("DOMContentLoaded", () => {
  const resumeScore = document.getElementById("resumeScore");
  let score = 0;
  const interval = setInterval(() => {
    if (score >= 85) {
      clearInterval(interval);
    } else {
      score += 1;
      resumeScore.textContent = `${score}%`;
    }
  }, 30);
});
