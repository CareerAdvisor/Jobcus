document.addEventListener("DOMContentLoaded", () => {
  const entries = document.querySelectorAll(".faq-entry");

  entries.forEach(entry => {
    const question = entry.querySelector(".faq-question");
    const toggle = entry.querySelector(".faq-toggle");
    const answer = entry.querySelector(".faq-answer");

    question.addEventListener("click", () => {
      const isOpen = entry.classList.contains("open");

      // Close all other entries (optional)
      entries.forEach(e => {
        e.classList.remove("open");
        e.querySelector(".faq-toggle").textContent = "+";
      });

      // Toggle current entry
      if (!isOpen) {
        entry.classList.add("open");
        toggle.textContent = "−";
      } else {
        entry.classList.remove("open");
        toggle.textContent = "+";
      }
    });
  });

  // Expand All
  document.getElementById("expandAll").addEventListener("click", () => {
    entries.forEach(entry => {
      entry.classList.add("open");
      entry.querySelector(".faq-toggle").textContent = "−";
    });
  });

  // Collapse All
  document.getElementById("collapseAll").addEventListener("click", () => {
    entries.forEach(entry => {
      entry.classList.remove("open");
      entry.querySelector(".faq-toggle").textContent = "+";
    });
  });
});
