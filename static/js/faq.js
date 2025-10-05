document.addEventListener("DOMContentLoaded", function () {
  const faqEntries = document.querySelectorAll(".faq-entry");

  faqEntries.forEach(entry => {
    const question = entry.querySelector(".faq-question");
    const answer = entry.querySelector(".faq-answer");
    const toggleIcon = entry.querySelector(".faq-toggle");
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

  document.getElementById("expandAll")?.addEventListener("click", () => {
    faqEntries.forEach(entry => {
      entry.classList.add("open");
      entry.querySelector(".faq-answer").style.display = "block";
      entry.querySelector(".faq-toggle").textContent = "−";
    });
  });

  document.getElementById("collapseAll")?.addEventListener("click", () => {
    faqEntries.forEach(entry => {
      entry.classList.remove("open");
      entry.querySelector(".faq-answer").style.display = "none";
      entry.querySelector(".faq-toggle").textContent = "+";
    });
  });
});
