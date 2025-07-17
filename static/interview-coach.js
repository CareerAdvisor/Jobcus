// static/interview-coach.js

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("interviewForm");
  const roleInput = document.getElementById("role");
  const experienceInput = document.getElementById("experience");
  const switchInput = document.getElementById("careerSwitch");
  const output = document.getElementById("interviewOutput");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const role = roleInput.value.trim();
    const experience = experienceInput.value;
    const isSwitching = switchInput?.checked || false;

    if (!role || !experience) {
      output.innerHTML = "⚠️ Please provide both target role and experience level.";
      return;
    }

    output.innerHTML = "<em>⏳ Generating interview questions and feedback...</em>";

    try {
      const response = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, experience, isSwitching })
      });

      const data = await response.json();

      if (data.result) {
        output.innerHTML = `<div class='ai-response'><pre>${data.result}</pre></div>`;
      } else {
        output.innerHTML = "⚠️ No result returned. Try again.";
      }
    } catch (err) {
      console.error("Interview API Error:", err);
      output.innerHTML = "❌ Something went wrong. Please try again later.";
    }
  });
});
