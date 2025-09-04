
// base.js – Navigation, user menu, etc.

function toggleMobileMenu() {
  const mobileMenu = document.getElementById("mobileMenu");
  const hamburger = document.querySelector(".hamburger");
  const expanded = hamburger.getAttribute("aria-expanded") === "true";
  hamburger.setAttribute("aria-expanded", !expanded);
  mobileMenu.classList.toggle("open");
}

// Toggle user dropdown menu
document.addEventListener("DOMContentLoaded", function () {
  const userBtn = document.getElementById("userMenuBtn");
  const userDropdown = document.getElementById("userDropdown");

  if (userBtn && userDropdown) {
    userBtn.addEventListener("click", function () {
      const expanded = this.getAttribute("aria-expanded") === "true";
      this.setAttribute("aria-expanded", !expanded);
      userDropdown.classList.toggle("show");
    });

    // Close dropdown on outside click
    document.addEventListener("click", function (e) {
      if (!userBtn.contains(e.target) && !userDropdown.contains(e.target)) {
        userDropdown.classList.remove("show");
        userBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  // Features menu dropdown (for mobile and desktop)
  const featureToggles = document.querySelectorAll(".dropbtn");
  featureToggles.forEach(btn => {
    btn.addEventListener("click", function (e) {
      const dropdown = this.nextElementSibling;
      dropdown.classList.toggle("show");
      e.stopPropagation();
    });
  });

  // Close any open dropdown when clicking elsewhere
  document.addEventListener("click", function () {
    document.querySelectorAll(".dropdown-content.show").forEach(menu => {
      menu.classList.remove("show");
    });
  });

  // Animate on scroll
  if (window.AOS) AOS.init({ once: true });
});
