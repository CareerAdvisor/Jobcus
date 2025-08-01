// dashboard.js

document.addEventListener("DOMContentLoaded", () => {
  // Greeting
  const greetEl = document.getElementById("dashboardGreeting");
  const first   = !localStorage.getItem("dashboardVisited");
  if (greetEl) {
    greetEl.textContent = first ? "Welcome" : "Welcome Back";
    localStorage.setItem("dashboardVisited", "true");
  }

  // Pull analysis from localStorage
  const saved = localStorage.getItem("resumeAnalysis");
  if (!saved) return;  // leaves the "Analyze your resume" CTA visible

  const data = JSON.parse(saved);
  document.getElementById("no-analysis-cta").style.display  = "none";
  document.getElementById("resume-analysis").style.display = "block";

  // Animate the score circle
  const circle = document.querySelector(".progress-circle");
  const path   = circle.querySelector(".progress");
  const text   = circle.querySelector(".percentage");
  let score    = data.score || 0,
      curr     = 0,
      step     = score > 0 ? 1 : -1;

  circle.dataset.score = score;
  const ani = setInterval(() => {
    if (curr === score) return clearInterval(ani);
    curr += step;
    path.setAttribute("stroke-dasharray", `${curr},100`);
    text.textContent = `${curr}%`;
  }, 20);

  // Fill issues & strengths lists
  const issues    = document.getElementById("top-issues");
  const strengths = document.getElementById("good-points");
  issues.innerHTML    = "";
  strengths.innerHTML = "";

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
