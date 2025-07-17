// static/skill-gap.js

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("skillGapForm");
  const goalInput = document.getElementById("goal");
  const skillsInput = document.getElementById("skills");
  const resultBox = document.getElementById("gapResult");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const goal = goalInput.value.trim();
    const skills = skillsInput.value.trim();

    if (!goal || !skills) {
      resultBox.innerHTML = "⚠️ Please enter both your career goal and current skills.";
      resultBox.classList.add("show");
      return;
    }

    // Show animated loading dots
    resultBox.innerHTML = `<span class="typing">Analyzing skill gaps<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>`;
    resultBox.classList.remove("show");
    void resultBox.offsetWidth; // Force reflow
    resultBox.classList.add("show");

    try {
      const response = await fetch("/api/skill-gap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, skills })
      });

      const data = await response.json();

      if (data.result) {
        resultBox.innerHTML = `<div class="ai-response"><pre>${data.result}</pre></div>`;
      } else {
        resultBox.innerHTML = "⚠️ No result returned. Please try again.";
      }
    } catch (err) {
      console.error("Skill Gap Fetch Error:", err);
      resultBox.innerHTML = "❌ Something went wrong. Please try again later.";
    }
  });
});
