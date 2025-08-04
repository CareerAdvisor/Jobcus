// static/base.js

// ───── 1) Initialize AOS ─────
AOS.init();

// ───── 2) User menu toggle ─────
function toggleUserMenu() {
  document.getElementById('userDropdown')?.classList.toggle('show');
}

// ───── 3) Mobile menu toggle ─────
function toggleMobileMenu() {
  document.getElementById('mobileMenu')?.classList.toggle('show');
}

// ───── 4) Global click handler ─────
//    - Closes mobile menu if clicking outside
//    - Closes any open Features or User dropdowns
document.addEventListener('click', (e) => {
  // a) Mobile menu
  const mobileMenu = document.getElementById('mobileMenu');
  const hamburger  = document.querySelector('.hamburger');
  if (
    mobileMenu?.classList.contains('show') &&
    !mobileMenu.contains(e.target) &&
    !hamburger.contains(e.target)
  ) {
    mobileMenu.classList.remove('show');
  }

  // b) Features dropdown(s)
  document.querySelectorAll('.dropdown-content').forEach(drop => {
    const btn = drop.previousElementSibling;
    if (!drop.contains(e.target) && !btn.contains(e.target)) {
      drop.style.display = 'none';
    }
  });

  // c) User dropdown
  const userDropdown = document.getElementById('userDropdown');
  const userIcon     = document.getElementById('userIcon');
  if (
    userDropdown?.classList.contains('show') &&
    !userDropdown.contains(e.target) &&
    !userIcon.contains(e.target)
  ) {
    userDropdown.classList.remove('show');
  }
});
