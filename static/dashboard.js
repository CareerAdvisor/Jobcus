// dashboard.js

// — Helpers for your existing analysis logic —

// Animate the circular score
function animateProgressCircle(circle, targetScore) {
  if (!circle) return;
  const progressPath = circle.querySelector(".progress");
  const percentageText = circle.querySelector(".percentage");
  let current = parseInt(percentageText.textContent) || 0;
  const step = targetScore > current ? 1 : -1;
  const anim = setInterval(() => {
    if (current === targetScore) return clearInterval(anim);
    current += step;
    progressPath.setAttribute("stroke-dasharray", `${current}, 100`);
    percentageText.textContent = `${current}%`;
  }, 20);
}

// Animate the skill-gap & interview bars
function animateProgressBar(bar, targetWidth) {
  if (!bar) return;
  let current = parseInt(bar.style.width) || 0;
  const step = targetWidth > current ? 1 : -1;
  const anim = setInterval(() => {
    if (current === targetWidth) return clearInterval(anim);
    current += step;
    bar.style.width = `${current}%`;
  }, 15);
}

// Inject analysis results into the page
function updateDashboardWithAnalysis(data) {
  // Resume circle
  const circle = document.querySelector(".progress-circle");
  if (circle) animateProgressCircle(circle, data.score || 0);

  // Issues
  const issuesList = document.getElementById("top-issues");
  if (issuesList) {
    issuesList.innerHTML = "";
    (data.analysis.issues || []).forEach(i => {
      const li = document.createElement("li");
      li.textContent = i;
      issuesList.appendChild(li);
    });
  }

  // Strengths
  const strengthsList = document.getElementById("good-points");
  if (strengthsList) {
    strengthsList.innerHTML = "";
    (data.analysis.strengths || []).forEach(s => {
      const li = document.createElement("li");
      li.textContent = s;
      strengthsList.appendChild(li);
    });
  }

  // Skill-Gap bar
  const skillBar = document.querySelectorAll(".dashboard-card .progress-fill")[1];
  if (skillBar && data.skill_gap_percent !== undefined) {
    animateProgressBar(skillBar, data.skill_gap_percent);
  }

  // Interview-Readiness bar
  const interviewBar = document.querySelectorAll(".dashboard-card .progress-fill")[2];
  if (interviewBar && data.interview_readiness_percent !== undefined) {
    animateProgressBar(interviewBar, data.interview_readiness_percent);
  }
}

// Fallback fetch if no localStorage result
function fetchResumeAnalysis() {
  fetch("/api/resume-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fetch_latest: true })
  })
    .then(r => r.json())
    .then(data => {
      if (!data.error) {
        if (data.skill_gap_percent === undefined) data.skill_gap_percent = 65;
        if (data.interview_readiness_percent === undefined) data.interview_readiness_percent = 45;
        updateDashboardWithAnalysis(data);
      }
    })
    .catch(console.error);
}

// — Page setup & custom features ——
document.addEventListener("DOMContentLoaded", () => {
  // 1) Nav buttons
  document.getElementById("backButton")
    ?.addEventListener("click", () => window.history.back());
  document.getElementById("homeButton")
    ?.addEventListener("click", () => window.location.href = "/");
  document.getElementById("logoutButton")
    ?.addEventListener("click", () => window.location.href = "/logout");

  // 2) Dark-mode toggle
  const dmToggle = document.getElementById("darkModeToggle");
  const root       = document.documentElement;
  const isDark     = localStorage.getItem("darkMode") === "true";
  if (isDark) {
    root.classList.add("dark-mode");
    dmToggle.textContent = "☀️";
  }
  dmToggle?.addEventListener("click", () => {
    const nowDark = root.classList.toggle("dark-mode");
    localStorage.setItem("darkMode", nowDark);
    dmToggle.textContent = nowDark ? "☀️" : "🌙";
  });

  // 3) Dynamic greeting
  const greetEl   = document.getElementById("dashboardGreeting");
  const userName  = "{{ current_user.name }}";
  const visited   = localStorage.getItem("dashboardVisited");
  if (greetEl) {
    if (!visited) {
      greetEl.textContent = `Welcome, ${userName}`;
      localStorage.setItem("dashboardVisited", "true");
    } else {
      greetEl.textContent = `Welcome Back, ${userName}`;
    }
  }

  // 4) Resume analysis flow
  //    If the resume-builder saved a result, use it…
  const saved = localStorage.getItem("resumeAnalysis");
  if (saved) {
    updateDashboardWithAnalysis(JSON.parse(saved));
    localStorage.removeItem("resumeAnalysis");
  } else {
    // …otherwise fallback to pulling the latest from the server
    fetchResumeAnalysis();
  }

  // 5) Initialize the SVG circles (in case you want a default before anim)
  document.querySelectorAll(".progress-circle").forEach(c => {
    const v = parseInt(c.dataset.score || "0");
    c.querySelector(".progress")
     .setAttribute("stroke-dasharray", `${v}, 100`);
    c.querySelector(".percentage")
     .textContent = `${v}%`;
  });

  // 6) Set all bar widths to 0 so they animate in
  document.querySelectorAll(".progress-fill")
    .forEach(b => b.style.width = "0%");
});
