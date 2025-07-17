// static/interview-coach.js

document.addEventListener("DOMContentLoaded", () => {
  const nextBtn = document.getElementById("next-question-btn");
  const questionBox = document.getElementById("ai-question");
  const form = document.getElementById("user-response-form");
  const answerInput = document.getElementById("userAnswer");
  const feedbackBox = document.getElementById("feedback-box");
  const suggestionsBox = document.getElementById("suggestions-box");

  let currentQuestion = "";

  nextBtn.addEventListener("click", async () => {
    questionBox.innerHTML = "<em>🎤 Generating a new interview question...</em>";
    feedbackBox.style.display = "none";
    suggestionsBox.style.display = "none";

    try {
      const res = await fetch("/api/interview-question");
      const data = await res.json();
      if (data.question) {
        currentQuestion = data.question;
        questionBox.innerHTML = `<strong>Question:</strong> ${data.question}`;
      } else {
        questionBox.innerHTML = "⚠️ No question received. Try again.";
      }
    } catch (err) {
      questionBox.innerHTML = "❌ Error fetching question.";
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const userAnswer = answerInput.value.trim();
    if (!userAnswer || !currentQuestion) return;

    feedbackBox.innerHTML = "<em>✍️ Evaluating your answer...</em>";
    feedbackBox.style.display = "block";

    try {
      const res = await fetch("/api/interview-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: currentQuestion, answer: userAnswer })
      });
      const data = await res.json();

      if (data.feedback) {
        feedbackBox.innerHTML = `<pre>${data.feedback}</pre>`;
      } else {
        feedbackBox.innerHTML = "⚠️ No feedback returned.";
      }

      if (data.fallback) {
        suggestionsBox.style.display = "block";
        suggestionsBox.innerHTML = `<strong>💡 Tip:</strong> ${data.fallback}`;
      } else {
        suggestionsBox.style.display = "none";
      }
    } catch (err) {
      console.error("Interview Feedback Error:", err);
      feedbackBox.innerHTML = "❌ Error evaluating answer.";
    }
  });
});
