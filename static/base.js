// Mobile menu toggle
function toggleMobileMenu() {
  const menu = document.getElementById("mobileMenu");
  menu?.classList.toggle("show");
}

// Features dropdown and mobile menu close
document.addEventListener("click", function (event) {
  const menu = document.getElementById("mobileMenu");
  const hamburger = document.querySelector(".hamburger");
  const isDropdownBtn = event.target.matches(".dropbtn");

  if (
    menu?.classList.contains("show") &&
    !menu.contains(event.target) &&
    !hamburger.contains(event.target)
  ) {
    menu.classList.remove("show");
  }

  document.querySelectorAll(".dropdown-content").forEach((dropdown) => {
    if (!dropdown.contains(event.target) && !dropdown.previousElementSibling.contains(event.target)) {
      dropdown.style.display = "none";
    }
  });

  if (isDropdownBtn) {
    const dropdownMenu = event.target.nextElementSibling;
    dropdownMenu.style.display = dropdownMenu.style.display === "flex" ? "none" : "flex";
  }
});

// Toggle user dropdown menu
function toggleUserMenu() {
  const menu = document.getElementById("userMenu");
  if (menu) {
    menu.style.display = menu.style.display === "block" ? "none" : "block";
  }
}

// Hide user menu when clicking outside
document.addEventListener("click", function (e) {
  const menu = document.getElementById("userMenu");
  const icon = document.querySelector(".header-user-icon");

  if (menu && icon && !menu.contains(e.target) && !icon.contains(e.target)) {
    menu.style.display = "none";
  }
});
