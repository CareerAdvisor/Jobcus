// account.js

document.addEventListener("DOMContentLoaded", function () {
  const toggleLink = document.getElementById("toggleMode");
  const formTitle = document.getElementById("formTitle");
  const nameGroup = document.getElementById("nameGroup");
  const submitBtn = document.getElementById("submitButton");
  const accountForm = document.getElementById("accountForm");

  let isSignup = false;

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

  accountForm.addEventListener("submit", function (e) {
    e.preventDefault();

    const formData = new FormData(accountForm);
    formData.append("mode", isSignup ? "signup" : "login");

    fetch("/account", {
      method: "POST",
      body: formData,
    })
      .then((res) => {
        if (res.redirected) {
          window.location.href = res.url;
        } else {
          return res.text().then((html) => {
            document.body.innerHTML = html; // re-renders the returned template
          });
        }
      })
      .catch((err) => {
        console.error("Error:", err);
        alert("Something went wrong.");
      });
  });
});
