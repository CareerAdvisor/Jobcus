// static/dashboard.js

document.addEventListener("DOMContentLoaded", () => {
  console.log("🚀 dashboard.js loaded");

  // 1) Dynamic greeting
  const greetEl    = document.getElementById("dashboardGreeting");
  const firstVisit = !localStorage.getItem("dashboardVisited");
  if (greetEl) {
    greetEl.textContent = firstVisit ? "Welcome" : "Welcome Back";
    localStorage.setItem("dashboardVisited", "true");
  }

  // 2) Load stored analysis
  const raw = localStorage.getItem("resumeAnalysis");
  console.log("🚀 [dashboard] raw resumeAnalysis:", raw);
  if (!raw) {
    // No analysis yet – leave CTA visible
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error("[dashboard] JSON parse error", e);
    return;
  }
  console.log("✅ [dashboard] parsed data:", data);

  // 3) Hide CTA, show analysis section
  document.getElementById("no-analysis-cta").style.display  = "none";
  document.getElementById("resume-analysis").style.display = "block";

  // 4) Animate the circular score
  const circle = document.querySelector(".progress-circle");
  const path   = circle.querySelector(".progress");
  const txt    = circle.querySelector(".percentage");
  let target   = data.score || 0;
  let current  = 0;
  const step   = target > 0 ? 1 : -1;
  circle.dataset.score = target;
  const iv = setInterval(() => {
    if (current === target) {
      clearInterval(iv);
      return;
    }
    current += step;
    path.setAttribute("stroke-dasharray", `${current},100`);
    txt.textContent = `${current}%`;
  }, 20);

  // 5) Populate issues & strengths
  const issuesUl    = document.getElementById("top-issues");
  const strengthsUl = document.getElementById("good-points");
  issuesUl.innerHTML    = "";
  strengthsUl.innerHTML = "";
  (data.analysis.issues || []).forEach(i => {
    const li = document.createElement("li");
    li.textContent = i;
    issuesUl.appendChild(li);
  });
  (data.analysis.strengths || []).forEach(s => {
    const li = document.createElement("li");
    li.textContent = s;
    strengthsUl.appendChild(li);
  });
});
