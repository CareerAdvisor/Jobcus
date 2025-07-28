// myaccount.js

document.addEventListener("DOMContentLoaded", function () {
  // Resume score chart
  const ctx = document.getElementById("resumeScoreChart").getContext("2d");
  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Your Score", "Remaining"],
      datasets: [
        {
          label: "Resume Score",
          data: [57, 43], // Example score
          backgroundColor: ["#104879", "#eee"],
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              return `${context.label}: ${context.raw}%`;
            },
          },
        },
      },
      cutout: "75%",
    },
  });

  // Show more feedback
  const showMoreBtn = document.getElementById("showMoreBtn");
  if (showMoreBtn) {
    showMoreBtn.addEventListener("click", function () {
      const hiddenFeedback = document.querySelectorAll(".feedback-item.hidden");
      hiddenFeedback.forEach((item) => item.classList.remove("hidden"));
      showMoreBtn.style.display = "none";
    });
  }

  // Dropdown toggles for fix actions
  document.querySelectorAll(".fix-button").forEach((btn) => {
    btn.addEventListener("click", () => {
      alert("This would open a fix modal or redirect to the relevant tool.");
    });
  });
});
