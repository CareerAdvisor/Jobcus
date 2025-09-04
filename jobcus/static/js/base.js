// static/js/base.js – Navigation, dropdowns, hamburger menu, etc.

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

document.addEventListener("DOMContentLoaded", function () {
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

  const featureToggles = document.querySelectorAll(".dropbtn");
  featureToggles.forEach(btn => {
    btn.addEventListener("click", function (e) {
      const dropdown = this.nextElementSibling;
      dropdown.classList.toggle("show");
      e.stopPropagation();
    });
  });

  document.addEventListener("click", function () {
    document.querySelectorAll(".dropdown-content.show").forEach(menu => {
      menu.classList.remove("show");
    });
  });

  if (window.AOS) AOS.init({ once: true });
});
