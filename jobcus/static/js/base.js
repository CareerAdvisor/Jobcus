document.addEventListener('DOMContentLoaded', () => {
  // Mobile menu toggle
  window.toggleMobileMenu = function () {
    const menu = document.getElementById('mobileMenu');
    const isOpen = menu.getAttribute('aria-expanded') === 'true';
    menu.setAttribute('aria-expanded', String(!isOpen));
    menu.classList.toggle('open');
  };

  // Header user menu toggle
  const userMenuBtn = document.getElementById('userMenuBtn');
  const userDropdown = document.getElementById('userDropdown');

  if (userMenuBtn && userDropdown) {
    userMenuBtn.addEventListener('click', () => {
      const expanded = userMenuBtn.getAttribute('aria-expanded') === 'true';
      userMenuBtn.setAttribute('aria-expanded', String(!expanded));
      userDropdown.classList.toggle('open');
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!userMenuBtn.contains(e.target) && !userDropdown.contains(e.target)) {
        userDropdown.classList.remove('open');
        userMenuBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Animate on scroll
  if (typeof AOS !== 'undefined') AOS.init({ once: true });
});
