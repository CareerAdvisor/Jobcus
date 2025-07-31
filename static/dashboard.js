// static/dashboard.js

// — Circular score animation —
function animateProgressCircle(circle, targetScore) {
  if (!circle) return;
  const path = circle.querySelector(".progress");
  const text = circle.querySelector(".percentage");
  let current = parseInt(text.textContent) || 0;
  const step = targetScore > current ? 1 : -1;
  const anim = setInterval(() => {
    if (current === targetScore) return clearInterval(anim);
    current += step;
    path.setAttribute("stroke-dasharray", `${current}, 100`);
    text.textContent = `${current}%`;
  }, 20);
}

// — Bar animation for skill-gap & interview readiness —
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

// — Inject the API’s analysis into the UI —
function updateDashboardWithAnalysis(data) {
  console.debug("Applying analysis data:", data);

  // 1) Score circle
  const circle = document.querySelector(".progress-circle");
  if (circle) animateProgressCircle(circle, data.score || 0);

  // 2) Issues list
  const issues = document.getElementById("top-issues");
  if (issues) {
    issues.innerHTML = "";
    ;(data.analysis.issues || []).forEach(i => {
      const li = document.createElement("li");
      li.textContent = i;
      issues.appendChild(li);
    });
  }

  // 3) Strengths list
  const strengths = document.getElementById("good-points");
  if (strengths) {
    strengths.innerHTML = "";
    ;(data.analysis.strengths || []).forEach(s => {
      const li = document.createElement("li");
      li.textContent = s;
      strengths.appendChild(li);
    });
  }

  // 4) Skill-Gap & Interview bars
  const bars = document.querySelectorAll(".progress-fill");
  if (bars[1] && data.skill_gap_percent !== undefined) {
    animateProgressBar(bars[1], data.skill_gap_percent);
  }
  if (bars[2] && data.interview_readiness_percent !== undefined) {
    animateProgressBar(bars[2], data.interview_readiness_percent);
  }
}

// — Fallback fetch if no LocalStorage data — 
function fetchResumeAnalysis() {
  fetch("/api/resume-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fetch_latest: true })
  })
    .then(r => r.json())
    .then(data => {
      if (!data.error) updateDashboardWithAnalysis(data);
    })
    .catch(console.error);
}

// — Handle the “Upload Resume” form on the dashboard —
function handleResumeUpload(e) {
  e.preventDefault();
  const input = document.getElementById("resumeFile");
  if (!input.files.length) {
    return alert("Please select a resume file to upload.");
  }
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = async () => {
    const b64 = reader.result.split(",")[1];
    try {
      const res = await fetch("/api/resume-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf: b64 })
      });
      const data = await res.json();
      if (data.error) {
        alert("Error analyzing resume: " + data.error);
      } else {
        updateDashboardWithAnalysis(data);
      }
    } catch (err) {
      console.error("Upload analysis error:", err);
      alert("Server error while analyzing resume.");
    }
  };
  reader.readAsDataURL(file);
}

document.addEventListener("DOMContentLoaded", () => {
  // — 0) Dynamic greeting (unchanged) —
  const greetEl  = document.getElementById("dashboardGreeting");
  const userName = "{{ current_user.name }}";
  const firstVisit = !localStorage.getItem("dashboardVisited");
  if (greetEl) {
    greetEl.textContent = firstVisit 
      ? `Welcome, ${userName}` 
      : `Welcome Back, ${userName}`;
    localStorage.setItem("dashboardVisited", "true");
  }

  // — 1) Initialize everything to 0% so our real data can override it —
  document.querySelectorAll(".progress-circle").forEach(c => {
    c.querySelector(".progress")
     .setAttribute("stroke-dasharray", "0, 100");
    c.querySelector(".percentage").textContent = "0%";
  });
  document.querySelectorAll(".progress-fill")
          .forEach(b => b.style.width = "0%");

  // — 2) Hook up the upload form —
  const uploadForm = document.getElementById("resumeUploadForm");
  if (uploadForm) {
    uploadForm.addEventListener("submit", handleResumeUpload);
  }

  // — 3) Inject analysis: prefer LocalStorage (post-builder), else fetch_latest —
  const saved = localStorage.getItem("resumeAnalysis");
  if (saved) {
    updateDashboardWithAnalysis(JSON.parse(saved));
    localStorage.removeItem("resumeAnalysis");
  } else {
    fetchResumeAnalysis();
  }
});
