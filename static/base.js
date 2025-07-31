// === Mobile Menu Toggle ===
function toggleMobileMenu() {
  const menu = document.getElementById("mobileMenu");
  menu?.classList.toggle("show");
}

// === Features Dropdown & Mobile Menu Close ===
document.addEventListener("click", function (event) {
  // Mobile menu auto-close
  const mobileMenu = document.getElementById("mobileMenu");
  const hamburger = document.querySelector(".hamburger");
  if (
    mobileMenu?.classList.contains("show") &&
    !mobileMenu.contains(event.target) &&
    !hamburger.contains(event.target)
  ) {
    mobileMenu.classList.remove("show");
  }

  // Features submenu
  document.querySelectorAll(".dropdown-content").forEach((dropdown) => {
    const btn = dropdown.previousElementSibling;
    if (
      !dropdown.contains(event.target) &&
      !btn.contains(event.target)
    ) {
      dropdown.style.display = "none";
    }
  });
  if (event.target.matches(".dropbtn")) {
    const dd = event.target.nextElementSibling;
    dd.style.display = dd.style.display === "flex" ? "none" : "flex";
  }

  // User menu auto-close
  const userMenu = document.getElementById("userMenu");
  const userIcon = document.getElementById("userIcon");
  if (
    userMenu?.classList.contains("show") &&
    !userMenu.contains(event.target) &&
    !userIcon.contains(event.target)
  ) {
    userMenu.classList.remove("show");
  }
});

// === User Menu Toggle ===
document.getElementById("userIcon")?.addEventListener("click", function (e) {
  e.stopPropagation();            // prevent the document click handler
  const menu = document.getElementById("userMenu");
  menu?.classList.toggle("show");
});

// === Hide User Menu on Scroll ===
window.addEventListener("scroll", function () {
  const menu = document.getElementById("userMenu");
  if (menu?.classList.contains("show")) {
    menu.classList.remove("show");
  }
});
