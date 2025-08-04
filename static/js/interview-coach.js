// static/interview-coach.js

// Interview history array
const history = [];

document.addEventListener("DOMContentLoaded", () => {
  const roleForm = document.getElementById("interview-role-form");
  const form = document.getElementById("user-response-form");
  const answerInput = document.getElementById("userAnswer");
  const questionBox = document.getElementById("ai-question");
  const feedbackBox = document.getElementById("feedback-box");
  const suggestionsBox = document.getElementById("suggestions-box");
  const nextBtn = document.getElementById("next-question-btn");
  const historyContainer = document.getElementById("history-container");
  const toggleHistoryBtn = document.getElementById("toggle-history-btn");

  let currentQuestion = "";
  let previousRole = "";
  let targetRole = "";
  let experience = "";

  async function getNextQuestion() {
    feedbackBox.style.display = "none";
    suggestionsBox.style.display = "none";
    questionBox.innerHTML = "<em>🤖 Generating a new interview question...</em>";

    try {
      const response = await fetch("/api/interview/question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previousRole, targetRole, experience })
      });

      const data = await response.json();
      currentQuestion = data.question || "Sorry, no question returned.";
      questionBox.innerHTML = `<strong>🗨️ ${currentQuestion}</strong>`;
    } catch (err) {
      questionBox.innerHTML = "⚠️ Error fetching interview question.";
    }
  }

  if (roleForm) {
    roleForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      previousRole = document.getElementById("previousRole").value;
      targetRole = document.getElementById("targetRole").value;
      experience = document.getElementById("experience").value;

      await getNextQuestion(); // Only start interview after user details are submitted

      // ✅ Add these lines to show the session block
      document.querySelector(".interview-session").style.display = "block";
      document.getElementById("user-response-form").style.display = "block";
    });
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

      history.push({
        question: currentQuestion,
        answer,
        feedback: data.feedback || "",
        tips: data.fallbacks || []
      });

      renderHistory();
    } catch (err) {
      feedbackBox.innerHTML = "❌ Error analyzing your answer.";
    }
  });

  function renderHistory() {
    if (!historyContainer) return;
    historyContainer.innerHTML = history.map((entry, index) => `
      <div class="history-entry">
        <h4>Question ${index + 1}</h4>
        <p><strong>Q:</strong> ${entry.question}</p>
        <p><strong>Your Answer:</strong> ${entry.answer}</p>
        <p><strong>Feedback:</strong> ${entry.feedback}</p>
        ${entry.tips.length ? `<p><strong>Tips:</strong> <ul>${entry.tips.map(t => `<li>${t}</li>`).join("")}</ul></p>` : ""}
      </div>
    `).join("");
  }

  if (toggleHistoryBtn && historyContainer) {
    toggleHistoryBtn.addEventListener("click", () => {
      const isVisible = historyContainer.style.display === "block";
      historyContainer.style.display = isVisible ? "none" : "block";
      toggleHistoryBtn.textContent = isVisible ? "📜 Show History" : "🙈 Hide History";
    });
  }

  nextBtn.addEventListener("click", getNextQuestion);
});
