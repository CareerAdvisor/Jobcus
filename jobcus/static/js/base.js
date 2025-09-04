// base.js – Navigation, user menu, etc.

// === Mobile hamburger toggle (your new function)
function toggleMobileMenu() {
  const menu = document.getElementById("mobileMenu");
  const isOpen = menu.getAttribute("data-open") === "true";

  menu.setAttribute("data-open", !isOpen);
  menu.style.display = !isOpen ? "block" : "none";
}

// Optional: close mobile menu when clicking outside
document.addEventListener("click", function (e) {
  const menu = document.getElementById("mobileMenu");
  const burger = document.querySelector(".hamburger");

  if (!menu || !burger) return;

  if (!menu.contains(e.target) && !burger.contains(e.target)) {
    menu.setAttribute("data-open", "false");
    menu.style.display = "none";
  }
});

// === Main DOM loaded logic
document.addEventListener("DOMContentLoaded", function () {
  // User dropdown
  const userBtn = document.getElementById("userMenuBtn");
  const userDropdown = document.getElementById("userDropdown");

  if (userBtn && userDropdown) {
    userBtn.addEventListener("click", function () {
      const expanded = this.getAttribute("aria-expanded") === "true";
      this.setAttribute("aria-expanded", !expanded);
      userDropdown.classList.toggle("show");
    });

    document.addEventListener("click", function (e) {
      if (!userBtn.contains(e.target) && !userDropdown.contains(e.target)) {
        userDropdown.classList.remove("show");
        userBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  // Features dropdown (desktop & mobile)
  const featureToggles = document.querySelectorAll(".dropbtn");
  featureToggles.forEach(btn => {
    btn.addEventListener("click", function (e) {
      const dropdown = this.nextElementSibling;
      dropdown.classList.toggle("show");
      e.stopPropagation();
    });
  });

  // Close any open dropdowns on outside click
  document.addEventListener("click", function () {
    document.querySelectorAll(".dropdown-content.show").forEach(menu => {
      menu.classList.remove("show");
    });
  });

  // Animate On Scroll
  if (window.AOS) AOS.init({ once: true });
});
