// Animate the circular resume score
function animateProgressCircle(circle, targetScore) {
  if (!circle) return;
  const path = circle.querySelector(".progress");
  const text = circle.querySelector(".percentage");
  let current = parseInt(text.textContent) || 0;
  const step = targetScore > current ? 1 : -1;
  const anim = setInterval(() => {
    if (current === targetScore) {
      clearInterval(anim);
      return;
    }
    current += step;
    path.setAttribute("stroke-dasharray", `${current}, 100`);
    text.textContent = `${current}%`;
  }, 20);
}

// Animate a horizontal progress bar
function animateProgressBar(bar, targetWidth) {
  if (!bar) return;
  let current = parseInt(bar.style.width) || 0;
  const step = targetWidth > current ? 1 : -1;
  const anim = setInterval(() => {
    if (current === targetWidth) {
      clearInterval(anim);
      return;
    }
    current += step;
    bar.style.width = `${current}%`;
  }, 15);
}

// Inject analysis data into the DOM
function updateDashboardWithAnalysis(data) {
  // Resume score circle
  const circle = document.querySelector(".progress-circle");
  if (circle) {
    circle.dataset.score = data.score;
    animateProgressCircle(circle, data.score || 0);
  }

  // Issues
  const issues = document.getElementById("top-issues");
  if (issues) {
    issues.innerHTML = "";
    (data.analysis.issues || []).forEach(i => {
      const li = document.createElement("li");
      li.textContent = i;
      issues.appendChild(li);
    });
  }

  // Strengths
  const strengths = document.getElementById("good-points");
  if (strengths) {
    strengths.innerHTML = "";
    (data.analysis.strengths || []).forEach(s => {
      const li = document.createElement("li");
      li.textContent = s;
      strengths.appendChild(li);
    });
  }

  // Skill gap & interview readiness bars
  const bars = document.querySelectorAll(".progress-fill");
  if (bars[1] && data.skill_gap_percent !== undefined) {
    animateProgressBar(bars[1], data.skill_gap_percent);
  }
  if (bars[2] && data.interview_readiness_percent !== undefined) {
    animateProgressBar(bars[2], data.interview_readiness_percent);
  }
}

// Fetch the latest analysis if none stored locally
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

// Handle re-uploading a resume from the dashboard
function handleResumeUpload(e) {
  e.preventDefault();
  const input = document.getElementById("resumeFile");
  if (!input.files.length) {
    alert("Please select a resume file to upload.");
    return;
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
      console.error("Upload error:", err);
      alert("Server error while analyzing resume.");
    }
  };
  reader.readAsDataURL(file);
}

// On DOM ready…
document.addEventListener("DOMContentLoaded", () => {
  // 1) Dynamic greeting
  const greetEl  = document.getElementById("dashboardGreeting");
  const userName = greetEl?.dataset.userName || "there";
  const firstVisit = !localStorage.getItem("dashboardVisited");
  if (greetEl) {
    greetEl.textContent = firstVisit
      ? `Welcome, ${userName}`
      : `Welcome Back, ${userName}`;
    localStorage.setItem("dashboardVisited", "true");
  }

  // 2) Initialize visuals at 0%
  document.querySelectorAll(".progress-circle").forEach(c => {
    c.querySelector(".progress")
     .setAttribute("stroke-dasharray", "0, 100");
    c.querySelector(".percentage").textContent = "0%";
  });
  document.querySelectorAll(".progress-fill")
          .forEach(b => b.style.width = "0%");

  // 3) Hook up the upload form
  const uploadForm = document.getElementById("resumeUploadForm");
  if (uploadForm) uploadForm.addEventListener("submit", handleResumeUpload);

  // 4) Populate analysis: prefer localStorage, else fetch_latest
  const saved = localStorage.getItem("resumeAnalysis");
  if (saved) {
    updateDashboardWithAnalysis(JSON.parse(saved));
    localStorage.removeItem("resumeAnalysis");
  } else {
    fetchResumeAnalysis();
  }
});
