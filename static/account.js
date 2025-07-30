// account.js
document.addEventListener("DOMContentLoaded", function () {
  const toggleLink = document.getElementById("toggleMode");
  const formTitle = document.getElementById("formTitle");
  const nameGroup = document.getElementById("nameGroup");
  const submitBtn = document.getElementById("submitButton");
  const accountForm = document.getElementById("accountForm");
  const modeInput = document.getElementById("mode");

  let isSignup = false;

  // Toggle between Login and Signup
  toggleLink.addEventListener("click", function (e) {
    e.preventDefault();
    isSignup = !isSignup;

    if (isSignup) {
      formTitle.textContent = "Create a Jobcus Account";
      submitBtn.textContent = "Sign Up";
      toggleLink.textContent = "Already have an account? Sign In";
      nameGroup.style.display = "block";
      modeInput.value = "signup";
    } else {
      formTitle.textContent = "Sign In to Jobcus";
      submitBtn.textContent = "Sign In";
      toggleLink.textContent = "Don't have an account? Sign Up";
      nameGroup.style.display = "none";
      modeInput.value = "login";
    }
  });

  // Handle form submission via Fetch
  accountForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    const formData = new FormData(accountForm);

    try {
      const response = await fetch("/account", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        alert(result.message);
        window.location.href = result.redirect || "/dashboard";
      } else {
        alert(result.message || "Something went wrong!");
      }
    } catch (err) {
      console.error("Request failed:", err);
      alert("Request failed. Check console logs.");
    }
  });
});
