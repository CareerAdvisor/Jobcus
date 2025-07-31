// === Mobile Menu Toggle ===
function toggleMobileMenu() {
  const menu = document.getElementById("mobileMenu");
  if (menu) {
    menu.classList.toggle("show");
  }
}

// === Handle Clicks for Dropdowns and Mobile Menu Close ===
document.addEventListener("click", function (event) {
  const menu = document.getElementById("mobileMenu");
  const hamburger = document.querySelector(".hamburger");
  const isDropdownBtn = event.target.matches(".dropbtn");

  // Close mobile menu if clicking outside
  if (
    menu?.classList.contains("show") &&
    !menu.contains(event.target) &&
    !hamburger.contains(event.target)
  ) {
    menu.classList.remove("show");
  }

  // Close all dropdowns if clicking outside
  document.querySelectorAll(".dropdown-content").forEach((dropdown) => {
    if (
      !dropdown.contains(event.target) &&
      !dropdown.previousElementSibling.contains(event.target)
    ) {
      dropdown.style.display = "none";
    }
  });

  // Toggle clicked dropdown
  if (isDropdownBtn) {
    const dropdownMenu = event.target.nextElementSibling;
    if (dropdownMenu) {
      dropdownMenu.style.display =
        dropdownMenu.style.display === "flex" ? "none" : "flex";
    }
  }
});

// === Toggle User Dropdown Menu ===
function toggleUserMenu() {
  const menu = document.getElementById("userMenu");
  if (menu) {
    menu.classList.toggle("show");
  }
}

// === Hide User Menu on Outside Click ===
document.addEventListener("click", function (e) {
  const menu = document.getElementById("userMenu");
  const icon = document.querySelector(".header-user-icon");

  if (menu && icon && !menu.contains(e.target) && !icon.contains(e.target)) {
    menu.classList.remove("show");
  }
});

// === Hide User Menu on Scroll ===
window.addEventListener("scroll", function () {
  const menu = document.getElementById("userMenu");
  if (menu?.classList.contains("show")) {
    menu.classList.remove("show");
  }
});
