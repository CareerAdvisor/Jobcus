// static/employer.js
document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("employer-form");
  const status = document.getElementById("form-status");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    status.innerHTML = "⏳ Sending...";
    status.style.color = "#333";

    const formData = new FormData(form);
    const payload = {};

    formData.forEach((value, key) => {
      payload[key] = value;
    });

    try {
      const response = await fetch("/api/employer-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok) {
        status.innerHTML = "✅ Message sent successfully!";
        status.style.color = "green";
        form.reset();
      } else {
        throw new Error(data.error || "Something went wrong.");
      }
    } catch (err) {
      console.error(err);
      status.innerHTML = "❌ Failed to send message. Please try again.";
      status.style.color = "red";
    }
  });
});

