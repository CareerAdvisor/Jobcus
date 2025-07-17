// static/interview-coach.js

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("interviewPrepForm");
  const startBtn = document.getElementById("next-question-btn");
  const questionBox = document.getElementById("ai-question");
  const suggestionsBox = document.getElementById("suggestions-box");
  const responseForm = document.getElementById("user-response-form");
  const feedbackBox = document.getElementById("feedback-box");
  const roleInput = document.getElementById("role");
  const targetRoleInput = document.getElementById("targetRole");
  const experienceInput = document.getElementById("experience");
  const userAnswer = document.getElementById("userAnswer");

  let currentQuestion = "";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const role = roleInput.value.trim();
    const target = targetRoleInput.value.trim();
    const experience = experienceInput.value;

    if (!role || !experience) {
      questionBox.innerHTML = "⚠️ Please enter your previous and target role along with experience.";
      return;
    }

    questionBox.innerHTML = "⏳ Loading personalized questions...";

    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, target, experience })
      });

      const data = await res.json();
      currentQuestion = data.question || "Here’s a question to start with.";
      questionBox.innerHTML = `<strong>🤖 AI:</strong> ${currentQuestion}`;
      suggestionsBox.innerHTML = "";
      feedbackBox.style.display = "none";
    } catch (err) {
      console.error("Interview Coach API Error:", err);
      questionBox.innerHTML = "❌ Failed to load question. Try again.";
    }
  });

  startBtn.addEventListener("click", async () => {
    questionBox.innerHTML = "🎤 Generating next question...";
    feedbackBox.style.display = "none";
    suggestionsBox.style.display = "none";

    try {
      const res = await fetch("/api/interview/question", { method: "POST" });
      const data = await res.json();
      currentQuestion = data.question;
      questionBox.innerHTML = `<strong>🤖 AI:</strong> ${currentQuestion}`;
    } catch (err) {
      questionBox.innerHTML = "❌ Failed to fetch a new question.";
    }
  });

  responseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const answer = userAnswer.value.trim();
    if (!answer || !currentQuestion) return;

    feedbackBox.style.display = "block";
    feedbackBox.innerHTML = "⏳ Reviewing your answer...";

    try {
      const res = await fetch("/api/interview/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: currentQuestion, answer })
      });
      const data = await res.json();
      feedbackBox.innerHTML = `<pre>${data.feedback}</pre>`;

      if (data.fallback) {
        suggestionsBox.style.display = "block";
        suggestionsBox.innerHTML = `<strong>💡 Suggestions:</strong><ul>${data.fallback.map(item => `<li>${item}</li>`).join("")}</ul>`;
      }
    } catch (err) {
      feedbackBox.innerHTML = "❌ Couldn't fetch feedback. Try again.";
    }
  });
});
