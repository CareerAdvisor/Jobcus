// static/interview-coach.js

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("user-response-form");
  const answerInput = document.getElementById("userAnswer");
  const questionBox = document.getElementById("ai-question");
  const feedbackBox = document.getElementById("feedback-box");
  const suggestionsBox = document.getElementById("suggestions-box");
  const nextBtn = document.getElementById("next-question-btn");

  let currentQuestion = "";

  async function getNextQuestion() {
    feedbackBox.style.display = "none";
    suggestionsBox.style.display = "none";
    questionBox.innerHTML = "<em>🤖 Generating a new interview question...</em>";

    try {
      const response = await fetch("/api/interview/question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      const data = await response.json();
      currentQuestion = data.question || "Sorry, no question returned.";
      questionBox.innerHTML = `<strong>🗨️ ${currentQuestion}</strong>`;
    } catch (err) {
      questionBox.innerHTML = "⚠️ Error fetching interview question.";
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const answer = answerInput.value.trim();
    if (!answer) return;

    feedbackBox.innerHTML = "<em>⏳ Analyzing your answer...</em>";
    feedbackBox.style.display = "block";
    suggestionsBox.style.display = "none";

    try {
      const response = await fetch("/api/interview/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: currentQuestion, answer })
      });

      const data = await response.json();
      if (data.feedback) {
        feedbackBox.innerHTML = `<div class='ai-response'><pre>${data.feedback}</pre></div>`;
      }
      if (data.fallbacks) {
        suggestionsBox.style.display = "block";
        suggestionsBox.innerHTML = `<h4>💡 Suggested Tips:</h4><ul>` +
          data.fallbacks.map(tip => `<li>${tip}</li>`).join("") +
          `</ul>`;
      }
    } catch (err) {
      feedbackBox.innerHTML = "❌ Error analyzing your answer.";
    }
  });

  nextBtn.addEventListener("click", getNextQuestion);

  // Initialize with the first question
  getNextQuestion();
});
