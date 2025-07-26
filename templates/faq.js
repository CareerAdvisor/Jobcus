document.addEventListener("DOMContentLoaded", function () {
  // === Accordion Toggle Logic ===
  const faqItems = document.querySelectorAll(".faq-item");

  faqItems.forEach(item => {
    const question = item.querySelector(".faq-question");
    const answer = item.querySelector(".faq-answer");
    const icon = question.querySelector(".toggle-icon");

    question.addEventListener("click", () => {
      const isOpen = item.classList.contains("open");

      // Close all items
      faqItems.forEach(i => {
        i.classList.remove("open");
        i.querySelector(".faq-answer").style.maxHeight = null;
        i.querySelector(".toggle-icon").textContent = "+";
      });

      // Open current item
      if (!isOpen) {
        item.classList.add("open");
        answer.style.maxHeight = answer.scrollHeight + "px";
        icon.textContent = "−";
      }
    });
  });

  // === Smooth Scroll to Anchors with Highlight ===
  const faqLinks = document.querySelectorAll(".faq-nav a");

  faqLinks.forEach(link => {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      const targetId = this.getAttribute("href").substring(1);
      const target = document.getElementById(targetId);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.classList.add("highlight-faq");
        setTimeout(() => target.classList.remove("highlight-faq"), 1500);
      }
    });
  });
});
