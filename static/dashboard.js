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
  const step = targetScore > currentScore ? 1 : -1; // determine direction

  const animation = setInterval(() => {
    if (currentScore === targetScore) {
      clearInterval(animation);
      return;
    }
    currentScore += step;
    progressPath.setAttribute("stroke-dasharray", `${currentScore}, 100`);
    percentageText.textContent = `${currentScore}%`;
  }, 20); // adjust speed here (20ms per step)
}

// === Dynamic Resume Analysis Update ===
function updateDashboardWithAnalysis(data) {
  const progressCircle = document.querySelector(".progress-circle");
  if (progressCircle) {
    const score = data.score || 0;
    animateProgressCircle(progressCircle, score);
  }

  // Update Issues List
  const issuesList = document.getElementById('top-issues');
  if (issuesList) {
    issuesList.innerHTML = '';
    (data.analysis.issues || []).forEach(issue => {
      const li = document.createElement('li');
      li.textContent = issue;
      issuesList.appendChild(li);
    });
  }

  // Update Strengths List
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
    body: JSON.stringify({ text: "" }),
    headers: { 'Content-Type': 'application/json' }
  })
    .then(res => res.json())
    .then(data => {
      if (!data.error) {
        updateDashboardWithAnalysis(data);
      } else {
        console.warn("Resume analysis error:", data.error);
      }
    })
    .catch(err => console.error("Resume analysis fetch error:", err));
}

document.addEventListener("DOMContentLoaded", function () {
  // --- Initialize Progress Circles ---
  const circles = document.querySelectorAll(".progress-circle");
  circles.forEach(circle => {
    const value = parseInt(circle.dataset.score || "0");
    const progressPath = circle.querySelector(".progress");
    const percentageText = circle.querySelector(".percentage");
    progressPath.setAttribute("stroke-dasharray", `${value}, 100`);
    percentageText.textContent = `${value}%`;
  });

  // Fetch initial resume analysis
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
          body: JSON.stringify({ pdf: base64Resume }) // or { text: resumeText }
        });

        const data = await res.json();
        if (!data.error) {
          updateDashboardWithAnalysis(data);
        } else {
          alert("Error analyzing resume: " + data.error);
        }
      };

      reader.readAsDataURL(file);
    });
  }
});
