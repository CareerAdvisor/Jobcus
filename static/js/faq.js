document.addEventListener("DOMContentLoaded", function () {
  const faqEntries = document.querySelectorAll(".faq-entry");

  faqEntries.forEach(entry => {
    const question = entry.querySelector(".faq-question");
    const answer = entry.querySelector(".faq-answer");
    const toggleIcon = entry.querySelector(".faq-toggle");

    // Initially hide all answers
    answer.style.display = "none";

    question.addEventListener("click", () => {
      const isOpen = entry.classList.contains("open");

      if (isOpen) {
        entry.classList.remove("open");
        answer.style.display = "none";
        toggleIcon.textContent = "+";
      } else {
        entry.classList.add("open");
        answer.style.display = "block";
        toggleIcon.textContent = "−";
      }
    });
  });

  // Expand all
  document.getElementById("expandAll").addEventListener("click", () => {
    faqEntries.forEach(entry => {
      const answer = entry.querySelector(".faq-answer");
      const toggleIcon = entry.querySelector(".faq-toggle");
      entry.classList.add("open");
      answer.style.display = "block";
      toggleIcon.textContent = "−";
    });
  });

  // Collapse all
  document.getElementById("collapseAll").addEventListener("click", () => {
    faqEntries.forEach(entry => {
      const answer = entry.querySelector(".faq-answer");
      const toggleIcon = entry.querySelector(".faq-toggle");
      entry.classList.remove("open");
      answer.style.display = "none";
      toggleIcon.textContent = "+";
    });
  });
});
