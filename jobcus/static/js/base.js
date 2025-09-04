document.addEventListener("DOMContentLoaded", function () {
  // Mobile menu toggle
  window.toggleMobileMenu = function () {
    const mobileMenu = document.getElementById("mobileMenu");
    if (mobileMenu) {
      mobileMenu.classList.toggle("open");
    }
  };

  // Dropdown toggles
  const dropdownButtons = document.querySelectorAll(".dropbtn");
  dropdownButtons.forEach((btn) => {
    btn.addEventListener("click", function () {
      const dropdown = this.nextElementSibling;
      if (dropdown) {
        dropdown.classList.toggle("show");
      }
    });
  });

  // Close dropdowns when clicking outside
  window.addEventListener("click", function (e) {
    if (!e.target.matches(".dropbtn")) {
      document.querySelectorAll(".dropdown-content.show").forEach((dropdown) => {
        dropdown.classList.remove("show");
      });
    }
  });

  // Close mobile menu on navigation
  const mobileLinks = document.querySelectorAll("#mobileMenu a");
  mobileLinks.forEach((link) => {
    link.addEventListener("click", () => {
      const mobileMenu = document.getElementById("mobileMenu");
      if (mobileMenu) mobileMenu.classList.remove("open");
    });
  });
});
