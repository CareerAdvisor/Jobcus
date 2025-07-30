// account.js

document.addEventListener("DOMContentLoaded", () => {
  const toggleLink = document.getElementById("toggleMode");
  const formTitle = document.getElementById("formTitle");
  const nameGroup = document.getElementById("nameGroup");
  const submitBtn = document.getElementById("submitButton");
  const accountForm = document.getElementById("accountForm");

  let isSignup = false;

  // Toggle between Login and Sign Up
  if (toggleLink) {
    toggleLink.addEventListener("click", (e) => {
      e.preventDefault();
      isSignup = !isSignup;

      if (isSignup) {
        formTitle.textContent = "Create a Jobcus Account";
        submitBtn.textContent = "Sign Up";
        toggleLink.textContent = "Already have an account? Sign In";
        nameGroup.style.display = "block";
        document.getElementById("mode").value = "signup";
      } else {
        formTitle.textContent = "Sign In to Jobcus";
        submitBtn.textContent = "Sign In";
        toggleLink.textContent = "Don't have an account? Sign Up";
        nameGroup.style.display = "none";
        document.getElementById("mode").value = "login";
      }
    });
  }

  // Handle form submission with Fetch API
  if (accountForm) {
    accountForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const formData = new FormData(accountForm);
      formData.append("mode", isSignup ? "signup" : "login");

      try {
        const response = await fetch("/account", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Server returned error:", errorText);
          alert("Server error! Check console logs.");
        } else {
          // Reload to show flash messages
          window.location.reload();
        }
      } catch (err) {
        console.error("Request failed:", err);
        alert("Request failed. Check console logs.");
      }
    });
  }
});
