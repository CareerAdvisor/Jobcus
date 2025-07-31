// dashboard.js

// --- Toggle visibility for any dashboard section ---
function toggleSection(id) {
  const section = document.getElementById(id);
  if (section) {
    section.style.display = section.style.display === 'none' ? 'block' : 'none';
  }
}

// === Animate Progress Circle Smoothly ===
function animateProgressCircle(circle, targetScore) {
  if (!circle) return;

  const progressPath = circle.querySelector(".progress");
  const percentageText = circle.querySelector(".percentage");

  let currentScore = parseInt(percentageText.textContent) || 0;
  const step = targetScore > currentScore ? 1 : -1;

  const animation = setInterval(() => {
    if (currentScore === targetScore) {
      clearInterval(animation);
      return;
    }
    currentScore += step;
    progressPath.setAttribute("stroke-dasharray", `${currentScore}, 100`);
    percentageText.textContent = `${currentScore}%`;
  }, 20);
}

// === Animate Progress Bar Smoothly (Skill Gap / Interview Readiness) ===
function animateProgressBar(bar, targetWidth) {
  if (!bar) return;

  let currentWidth = parseInt(bar.style.width) || 0;
  const step = targetWidth > currentWidth ? 1 : -1;

  const animation = setInterval(() => {
    if (currentWidth === targetWidth) {
      clearInterval(animation);
      return;
    }
    currentWidth += step;
    bar.style.width = `${currentWidth}%`;
  }, 15);
}

// === Dynamic Resume Analysis Update ===
function updateDashboardWithAnalysis(data) {
  // --- Resume Score Circle ---
  const progressCircle = document.querySelector(".progress-circle");
  if (progressCircle) {
    const score = data.score || 0;
    animateProgressCircle(progressCircle, score);
  }

  // --- Skill Gap Progress Bar ---
  const skillGapBar = document.querySelector(".skill-gap-card .progress-fill");
  if (skillGapBar && data.skill_gap_percent !== undefined) {
    animateProgressBar(skillGapBar, data.skill_gap_percent);
  }

  // --- Interview Readiness Progress Bar ---
  const interviewBar = document.querySelector(".interview-readiness-card .progress-fill");
  if (interviewBar && data.interview_readiness_percent !== undefined) {
    animateProgressBar(interviewBar, data.interview_readiness_percent);
  }

  // --- Issues List ---
  const issuesList = document.getElementById('top-issues');
  if (issuesList) {
    issuesList.innerHTML = '';
    (data.analysis.issues || []).forEach(issue => {
      const li = document.createElement('li');
      li.textContent = issue;
      issuesList.appendChild(li);
    });
  }

  // --- Strengths List ---
  const strengthsList = document.getElementById('good-points');
  if (strengthsList) {
    strengthsList.innerHTML = '';
    (data.analysis.strengths || []).forEach(point => {
      const li = document.createElement('li');
      li.textContent = point;
      strengthsList.appendChild(li);
    });
  }
}

// === Fetch analysis automatically on page load ===
function fetchResumeAnalysis() {
  fetch('/api/resume-analysis', {
    method: 'POST',
    body: JSON.stringify({ fetch_latest: true }), // ✅ New key
    headers: { 'Content-Type': 'application/json' }
  })
    .then(res => res.json())
    .then(data => {
      if (!data.error) {
        if (data.skill_gap_percent === undefined) data.skill_gap_percent = 65;
        if (data.interview_readiness_percent === undefined) data.interview_readiness_percent = 45;
        updateDashboardWithAnalysis(data);
      } else {
        console.warn("Resume analysis error:", data.error);
      }
    })
    .catch(err => console.error("Resume analysis fetch error:", err));
}

document.addEventListener("DOMContentLoaded", function () {
  // --- Initialize Resume Score Circles ---
  const circles = document.querySelectorAll(".progress-circle");
  circles.forEach(circle => {
    const value = parseInt(circle.dataset.score || "0");
    const progressPath = circle.querySelector(".progress");
    const percentageText = circle.querySelector(".percentage");
    progressPath.setAttribute("stroke-dasharray", `${value}, 100`);
    percentageText.textContent = `${value}%`;
  });

  // --- Initialize Progress Bars (start from 0%) ---
  const progressBars = document.querySelectorAll(".progress-fill");
  progressBars.forEach(bar => bar.style.width = "0%");

  // --- Fetch initial resume analysis ---
  fetchResumeAnalysis();

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

  // --- Resume Upload Form Event Listener ---
  const uploadForm = document.getElementById("resumeUploadForm");
  if (uploadForm) {
    uploadForm.addEventListener("submit", async function (e) {
      e.preventDefault();

      const fileInput = document.getElementById("resumeFile");
      if (!fileInput || !fileInput.files.length) {
        return alert("Please select a resume file");
      }

      const file = fileInput.files[0];
      const reader = new FileReader();

      reader.onload = async function () {
        const base64Resume = reader.result.split(",")[1]; // Remove the prefix

        const res = await fetch("/api/resume-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdf: base64Resume })
        });

        const data = await res.json();
        if (!data.error) {
          // Ensure default values if missing
          if (data.skill_gap_percent === undefined) data.skill_gap_percent = 65;
          if (data.interview_readiness_percent === undefined) data.interview_readiness_percent = 45;
          updateDashboardWithAnalysis(data);
        } else {
          alert("Error analyzing resume: " + data.error);
        }
      };

      reader.readAsDataURL(file);
    });
  }
});
