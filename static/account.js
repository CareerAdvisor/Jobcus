// account.js

document.addEventListener("DOMContentLoaded", function () {
  const toggleBtn = document.getElementById("toggleAuthMode");
  const authTitle = document.getElementById("authTitle");
  const submitBtn = document.getElementById("submitBtn");
  const authForm = document.getElementById("authForm");
  let isLogin = true;

  toggleBtn.addEventListener("click", function () {
    isLogin = !isLogin;

    authTitle.textContent = isLogin ? "Sign In to Jobcus" : "Create Your Jobcus Account";
    submitBtn.textContent = isLogin ? "Sign In" : "Sign Up";
    toggleBtn.textContent = isLogin
      ? "Don't have an account? Sign up"
      : "Already have an account? Sign in";
  });

  authForm.addEventListener("submit", function (e) {
    e.preventDefault();

    const formData = {
      email: authForm.email.value,
      password: authForm.password.value,
    };

    if (!isLogin) {
      formData.fullname = authForm.fullname.value;
    }

    console.log(isLogin ? "Logging in..." : "Signing up...", formData);
    alert(`This is a mock submission for ${isLogin ? "login" : "signup"}.`);
    authForm.reset();
  });

  // 👤 User Menu Toggle Logic
  function toggleUserMenu() {
    const menu = document.getElementById("userMenu");
    menu.style.display = menu.style.display === "block" ? "none" : "block";
  }

  window.toggleUserMenu = toggleUserMenu;

  // Hide menu when clicking outside
  document.addEventListener("click", function (e) {
    const menu = document.getElementById("userMenu");
    const icon = document.querySelector(".header-user-icon");

    if (menu && icon && !menu.contains(e.target) && !icon.contains(e.target)) {
      menu.style.display = "none";
    }
  });
});
