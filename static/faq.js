document.addEventListener("DOMContentLoaded", function () {
  const faqItems = document.querySelectorAll(".faq-item");

  faqItems.forEach(item => {
    const question = item.querySelector(".faq-question");
    const answer = item.querySelector(".faq-answer");
    const icon = question.querySelector(".toggle-icon");

    question.addEventListener("click", () => {
      const isOpen = item.classList.contains("open");

      faqItems.forEach(i => {
        i.classList.remove("open");
        i.querySelector(".faq-answer").style.maxHeight = null;
        i.querySelector(".toggle-icon").textContent = "+";
      });

      if (!isOpen) {
        item.classList.add("open");
        answer.style.maxHeight = answer.scrollHeight + "px";
        icon.textContent = "−";
      }
    });
  });
});
