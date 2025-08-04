// static/base.js

// ───── 1) Initialize AOS ─────
AOS.init();

// ───── 2) Mobile menu toggle ─────
function toggleMobileMenu() {
  document.getElementById('mobileMenu')?.classList.toggle('show');
}

// ───── 3) Global click handler ─────
//    - Closes mobile menu if clicking outside
//    - Closes any open Features dropdowns
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
    const btn = drop.previousElementSibling; // the corresponding .dropbtn
    if (!drop.contains(e.target) && !btn.contains(e.target)) {
      drop.style.display = 'none';
    }
  });
});
