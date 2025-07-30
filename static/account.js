document.addEventListener("DOMContentLoaded", function () { 
  const toggleLink = document.getElementById("toggleMode");
  const formTitle = document.getElementById("formTitle");
  const nameGroup = document.getElementById("nameGroup");
  const submitBtn = document.getElementById("submitButton");
  const accountForm = document.getElementById("accountForm");
  const flashMessages = document.getElementById("flashMessages");

  let isSignup = false;

  // Toggle between Login and Sign Up
  toggleLink.addEventListener("click", function (e) {
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

  // Handle Form Submission
  accountForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    flashMessages.innerHTML = ""; // clear previous messages

    const formData = new FormData(accountForm);

    try {
      const response = await fetch("/account", {
        method: "POST",
        body: formData
      });
      const result = await response.json();

      // Show message dynamically
      const msg = document.createElement("p");
      msg.textContent = result.message;
      msg.classList.add(result.success ? "success" : "error");
      flashMessages.appendChild(msg);

      // Redirect on success
      if (result.success && result.redirect) {
        setTimeout(() => {
          window.location.href = result.redirect;
        }, 1000);
      }

    } catch (err) {
      console.error("Request failed:", err);
      const msg = document.createElement("p");
      msg.textContent = "Request failed. Please try again.";
      msg.classList.add("error");
      flashMessages.appendChild(msg);
    }
  });
});
