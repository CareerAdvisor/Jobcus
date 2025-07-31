// base.js

// 1) Initialize AOS
AOS.init();

// 2) Dark mode toggle
;(function() {
  const btn = document.getElementById('darkModeToggle');
  const dark = localStorage.getItem('darkMode') === 'true';
  if (dark) document.body.classList.add('dark-mode');
  btn?.addEventListener('click', () => {
    const isNowDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', isNowDark);
  });
})();

// 3) Mobile menu toggle
function toggleMobileMenu() {
  document.getElementById('mobileMenu')?.classList.toggle('show');
}

// 4) Global click handler for closing menus
document.addEventListener('click', (e) => {
  // a) Close mobile menu if click outside
  const mobileMenu = document.getElementById('mobileMenu'),
        hamburger = document.querySelector('.hamburger');
  if (
    mobileMenu?.classList.contains('show') &&
    !mobileMenu.contains(e.target) &&
    !hamburger.contains(e.target)
  ) {
    mobileMenu.classList.remove('show');
  }

  // b) Close features dropdowns
  document.querySelectorAll('.dropdown-content').forEach(drop => {
    const btn = drop.previousElementSibling;
    if (!drop.contains(e.target) && !btn.contains(e.target)) {
      drop.style.display = 'none';
    }
  });

  // c) Close user menu
  const userMenu = document.getElementById('userMenu'),
        userIcon = document.getElementById('userIcon');
  if (
    userMenu?.classList.contains('show') &&
    !userMenu.contains(e.target) &&
    !userIcon.contains(e.target)
  ) {
    userMenu.classList.remove('show');
  }
});

// 5) Features dropdown toggle
document.querySelectorAll('.dropbtn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const drop = e.target.nextElementSibling;
    drop.style.display = drop.style.display === 'flex' ? 'none' : 'flex';
  });
});

// 6) User‐icon dropdown toggle
document.getElementById('userIcon')?.addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('userMenu')?.classList.toggle('show');
});

// 7) Hide user menu on scroll
window.addEventListener('scroll', () => {
  document.getElementById('userMenu')?.classList.remove('show');
});
