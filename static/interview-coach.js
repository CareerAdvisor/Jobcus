// static/interview-coach.js

document.addEventListener("DOMContentLoaded", () => {
  const nextBtn = document.getElementById("next-question-btn");
  const form = document.getElementById("user-response-form");
  const answerBox = document.getElementById("userAnswer");
  const aiBox = document.getElementById("ai-question");
  const feedbackBox = document.getElementById("feedback-box");
  const suggestionsBox = document.getElementById("suggestions-box");
  const toggleVoiceBtn = document.getElementById("toggle-voice-btn");

  let currentQuestion = "";
  let voiceEnabled = true;
  let interviewHistory = [];

  // Voice synthesis
  function speakText(text) {
    if (!voiceEnabled || !("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }

  // Load next question
  nextBtn.addEventListener("click", async () => {
    aiBox.innerHTML = "⏳ Generating interview question...";
    feedbackBox.style.display = "none";
    suggestionsBox.style.display = "none";
    answerBox.value = "";

    try {
      const response = await fetch("/api/interview-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await response.json();

      currentQuestion = data.question;
      aiBox.innerHTML = currentQuestion;
      speakText(currentQuestion);
    } catch (err) {
      aiBox.innerHTML = "❌ Error fetching question. Try again.";
    }
  });

  // Submit answer
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const answer = answerBox.value.trim();
    if (!currentQuestion || !answer) return;

    feedbackBox.innerHTML = "⏳ Evaluating your response...";
    feedbackBox.style.display = "block";
    suggestionsBox.style.display = "none";

    try {
      const response = await fetch("/api/interview-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: currentQuestion, answer })
      });
      const data = await response.json();

      feedbackBox.innerHTML = `<pre>${data.feedback}</pre>`;
      suggestionsBox.innerHTML = `<strong>💡 Suggestion:</strong> ${data.fallback || "None."}`;
      suggestionsBox.style.display = "block";

      speakText(data.feedback);

      // Save history
      interviewHistory.push({ question: currentQuestion, answer, feedback: data.feedback });
    } catch (err) {
      feedbackBox.innerHTML = "❌ Error fetching feedback.";
    }
  });

  // Toggle voice on/off
  if (toggleVoiceBtn) {
    toggleVoiceBtn.addEventListener("click", () => {
      voiceEnabled = !voiceEnabled;
      toggleVoiceBtn.innerText = voiceEnabled ? "🔊 Voice On" : "🔇 Voice Off";
    });
  }
});
