// account.js

document.addEventListener("DOMContentLoaded", function () {
  const toggleLink = document.getElementById("toggleMode");
  const formTitle = document.getElementById("formTitle");
  const nameGroup = document.getElementById("nameGroup");
  const submitBtn = document.getElementById("submitButton");
  const accountForm = document.getElementById("accountForm");

  let isSignup = false;

  // Toggle between Sign In / Sign Up
  toggleLink.addEventListener("click", function (e) {
    e.preventDefault();
    isSignup = !isSignup;

    if (isSignup) {
      formTitle.textContent = "Create a Jobcus Account";
      submitBtn.textContent = "Sign Up";
      toggleLink.textContent = "Already have an account? Sign In";
      nameGroup.style.display = "block";
    } else {
      formTitle.textContent = "Sign In to Jobcus";
      submitBtn.textContent = "Sign In";
      toggleLink.textContent = "Don't have an account? Sign Up";
      nameGroup.style.display = "none";
    }
  });

  // Handle Form Submit (with Fetch API)
  if (accountForm) {
    accountForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const formData = new FormData(accountForm);
      formData.append("mode", isSignup ? "signup" : "login"); // send mode to backend

      try {
        const response = await fetch("/account", {
          method: "POST",
          body: formData
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Server returned error:", errorText);
          alert("Server error! Check console logs.");
        } else if (response.redirected) {
          // If Flask sends a redirect
          window.location.href = response.url;
        } else {
          // Reload page to show flash messages
          window.location.reload();
        }
      } catch (err) {
        console.error("Request failed:", err);
        alert("Request failed. Check console logs.");
      }
    });
  }
});
