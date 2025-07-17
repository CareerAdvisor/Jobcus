// static/interview-coach.js

document.addEventListener("DOMContentLoaded", () => {
  const questionBox = document.getElementById("ai-question");
  const nextBtn = document.getElementById("next-question-btn");
  const suggestionsBox = document.getElementById("suggestions-box");
  const form = document.getElementById("user-response-form");
  const answerInput = document.getElementById("userAnswer");
  const feedbackBox = document.getElementById("feedback-box");

  let currentQuestion = "";

  // Voice playback function
  function speakText(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    speechSynthesis.speak(utterance);
  }

  // Fetch a new interview question
  nextBtn.addEventListener("click", async () => {
    feedbackBox.style.display = "none";
    suggestionsBox.style.display = "none";
    questionBox.textContent = "🎤 Loading question...";

    try {
      const response = await fetch("/api/interview-question");
      const data = await response.json();
      currentQuestion = data.question || "No question returned.";

      questionBox.textContent = currentQuestion;
      speakText(currentQuestion); // 👈 Play with voice
    } catch (err) {
      console.error("Question Error:", err);
      questionBox.textContent = "❌ Could not fetch question.";
    }
  });

  // Handle user answer submission
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const answer = answerInput.value.trim();
    if (!answer || !currentQuestion) return;

    feedbackBox.innerHTML = "⏳ Evaluating your response...";
    feedbackBox.style.display = "block";

    try {
      const response = await fetch("/api/interview-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: currentQuestion, answer })
      });

      const data = await response.json();

      if (data.feedback) {
        feedbackBox.innerHTML = `<pre>${data.feedback}</pre>`;
        speakText(data.feedback); // 👈 Optional: Play feedback too
      }

      if (data.fallback) {
        suggestionsBox.innerHTML = `<strong>💡 Suggested Tip:</strong><br>${data.fallback}`;
        suggestionsBox.style.display = "block";
      }
    } catch (err) {
      console.error("Feedback Error:", err);
      feedbackBox.innerHTML = "⚠️ Could not process your answer.";
    }
  });
});
