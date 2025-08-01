// dashboard.js

document.addEventListener("DOMContentLoaded", () => {
  // 1) Greeting
  const greetEl = document.getElementById("dashboardGreeting");
  const first   = !localStorage.getItem("dashboardVisited");
  if (greetEl) {
    greetEl.textContent = first ? "Welcome" : "Welcome Back";
    localStorage.setItem("dashboardVisited", "true");
  }

  // 2) Read stored analysis
  const raw = localStorage.getItem("resumeAnalysis");
  console.log("🚀 [dashboard] raw resumeAnalysis from localStorage:", raw);
  if (!raw) {
    // no analysis yet
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

  // dashboard.js

console.log("🚀 [dashboard] script loaded");            // ← top

document.addEventListener("DOMContentLoaded", () => {
  const raw = localStorage.getItem("resumeAnalysis");
  console.log("🚀 [dashboard] raw resumeAnalysis:", raw); // ← immediately
  if (!raw) return;

  const data = JSON.parse(raw);
  console.log("✅ [dashboard] parsed data:", data);      // ← and here

  // … rest of your code …
});


  // 3) Show/hide sections
  document.getElementById("no-analysis-cta").style.display    = "none";
  document.getElementById("resume-analysis").style.display   = "block";

  // 4) Animate the score circle
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

  // 5) Populate issues & strengths
  const issues    = document.getElementById("top-issues");
  const strengths = document.getElementById("good-points");
  issues.innerHTML    = "";
  strengths.innerHTML = "";

  (data.analysis.issues || []).forEach(i => {
    const li = document.createElement("li"); li.textContent = i;
    issues.appendChild(li);
  });
  (data.analysis.strengths || []).forEach(s => {
    const li = document.createElement("li"); li.textContent = s;
    strengths.appendChild(li);
  });
});
