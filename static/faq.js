document.addEventListener("DOMContentLoaded", () => {
  const entries = document.querySelectorAll(".faq-entry");

  entries.forEach(entry => {
    const toggle = entry.querySelector(".faq-toggle");

    toggle.addEventListener("click", () => {
      const isOpen = entry.classList.contains("open");
      if (isOpen) {
        entry.classList.remove("open");
        toggle.textContent = "+";
      } else {
        entry.classList.add("open");
        toggle.textContent = "−";
      }
    });
  });

  const expandAllBtn = document.getElementById("expandAll");
  const collapseAllBtn = document.getElementById("collapseAll");

  if (expandAllBtn) {
    expandAllBtn.addEventListener("click", () => {
      entries.forEach(entry => {
        entry.classList.add("open");
        entry.querySelector(".faq-toggle").textContent = "−";
      });
    });
  }

  if (collapseAllBtn) {
    collapseAllBtn.addEventListener("click", () => {
      entries.forEach(entry => {
        entry.classList.remove("open");
        entry.querySelector(".faq-toggle").textContent = "+";
      });
    });
  }
});
