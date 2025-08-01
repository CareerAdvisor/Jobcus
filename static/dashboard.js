// dashboard.js

document.addEventListener("DOMContentLoaded", () => {
  // Dynamic greeting
  const greetEl  = document.getElementById("dashboardGreeting");
  const firstVisit = !localStorage.getItem("dashboardVisited");
  if (greetEl) {
    greetEl.textContent = firstVisit ? "Welcome" : "Welcome Back";
    localStorage.setItem("dashboardVisited", "true");
  }

  // Get stored analysis
  const saved = localStorage.getItem("resumeAnalysis");
  if (!saved) {
    // No analysis yet: leave the CTA
    return;
  }

  // We have analysis data
  const data = JSON.parse(saved);
  document.getElementById("no-analysis-cta").style.display     = "none";
  document.getElementById("resume-analysis").style.display      = "block";
  const circle = document.querySelector(".progress-circle");
  const issues = document.getElementById("top-issues");
  const strengths = document.getElementById("good-points");

  // Animate circle
  const score = data.score || 0;
  const path  = circle.querySelector(".progress");
  const text  = circle.querySelector(".percentage");
  let current = 0;
  const step = score > 0 ? 1 : -1;
  circle.dataset.score = score;
  const ani = setInterval(() => {
    if (current === score) return clearInterval(ani);
    current += step;
    path.setAttribute("stroke-dasharray", `${current},100`);
    text.textContent = `${current}%`;
  }, 20);

  // Fill issues & strengths
  issues.innerHTML    = "";
  strengths.innerHTML= "";
  (data.analysis.issues || []).forEach(i => {
    const li = document.createElement("li");
    li.textContent = i;
    issues.appendChild(li);
  });
  (data.analysis.strengths || []).forEach(s => {
    const li = document.createElement("li");
    li.textContent = s;
    strengths.appendChild(li);
  });
});
