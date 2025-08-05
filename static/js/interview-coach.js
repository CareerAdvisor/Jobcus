// static/js/interview-coach.js

// Interview history array
const history = [];

document.addEventListener("DOMContentLoaded", () => {
  const roleForm         = document.getElementById("interview-role-form");
  const form             = document.getElementById("user-response-form");
  const answerInput      = document.getElementById("userAnswer");
  const questionBox      = document.getElementById("ai-question");
  const feedbackBox      = document.getElementById("feedback-box");
  const suggestionsBox   = document.getElementById("suggestions-box");
  const nextBtn          = document.getElementById("next-question-btn");
  const historyContainer = document.getElementById("history-container");
  const toggleHistoryBtn = document.getElementById("toggle-history-btn");

  let currentQuestion = "";
  let previousRole    = "";
  let targetRole      = "";
  let experience      = "";

  async function getNextQuestion() {
    // Hide any old feedback or tips
    feedbackBox.style.display     = "none";
    suggestionsBox.style.display  = "none";

    // **Clear out the previous answer**
    answerInput.value = "";

    // Show a loading prompt
    questionBox.innerHTML = "<em>🤖 Generating a new interview question...</em>";

    try {
      const response = await fetch("/api/interview/question", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ previousRole, targetRole, experience })
      });
      const data = await response.json();
      currentQuestion = data.question || "Sorry, no question returned.";
      questionBox.innerHTML = `<strong>🗨️ ${currentQuestion}</strong>`;
    } catch (err) {
      console.error("Question fetch error:", err);
      questionBox.innerHTML = "⚠️ Error fetching interview question.";
    }
  }

  // When user submits their role info, start the session
  if (roleForm) {
    roleForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      previousRole = document.getElementById("previousRole").value;
      targetRole   = document.getElementById("targetRole").value;
      experience   = document.getElementById("experience").value;

      await getNextQuestion();

      document.querySelector(".interview-session").style.display     = "block";
      document.getElementById("user-response-form").style.display   = "block";
    });
  }

  // Handle answer submission (feedback & history)
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const answer = answerInput.value.trim();
    if (!answer) return;

    feedbackBox.innerHTML    = "<em>⏳ Analyzing your answer...</em>";
    feedbackBox.style.display = "block";
    suggestionsBox.style.display = "none";

    try {
      const response = await fetch("/api/interview/feedback", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ question: currentQuestion, answer })
      });
      const data = await response.json();

      // Display feedback
      if (data.feedback) {
        feedbackBox.innerHTML = `<div class='ai-response'><pre>${data.feedback}</pre></div>`;
      }
      if (data.fallbacks) {
        suggestionsBox.style.display = "block";
        suggestionsBox.innerHTML = `<h4>💡 Suggested Tips:</h4><ul>` +
          data.fallbacks.map(tip => `<li>${tip}</li>`).join("") +
          `</ul>`;
      }

      // Save history
      history.push({
        question: currentQuestion,
        answer,
        feedback: data.feedback || "",
        tips: data.fallbacks || []
      });
      renderHistory();

    } catch (err) {
      console.error("Feedback error:", err);
      feedbackBox.innerHTML = "❌ Error analyzing your answer.";
    }
  });

  // Render the Q&A history
  function renderHistory() {
    if (!historyContainer) return;
    historyContainer.innerHTML = history.map((entry, idx) => `
      <div class="history-entry">
        <h4>Question ${idx + 1}</h4>
        <p><strong>Q:</strong> ${entry.question}</p>
        <p><strong>Your Answer:</strong> ${entry.answer}</p>
        <p><strong>Feedback:</strong> ${entry.feedback}</p>
        ${entry.tips.length
          ? `<p><strong>Tips:</strong><ul>${entry.tips.map(t => `<li>${t}</li>`).join("")}</ul></p>`
          : ``}
      </div>
    `).join("");
  }

  // Toggle history visibility
  if (toggleHistoryBtn && historyContainer) {
    toggleHistoryBtn.addEventListener("click", () => {
      const isVisible = historyContainer.style.display === "block";
      historyContainer.style.display = isVisible ? "none" : "block";
      toggleHistoryBtn.textContent   = isVisible ? "📜 Show History" : "🙈 Hide History";
    });
  }

  // “Next Question” clears the textarea and fetches a new one
  nextBtn.addEventListener("click", () => {
    answerInput.value = "";
    getNextQuestion();
  });
});
