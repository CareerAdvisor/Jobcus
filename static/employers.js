document.addEventListener("DOMContentLoaded", function () {
  const inquiryForm = document.getElementById("employer-inquiry-form");
  const jobPostForm = document.getElementById("job-post-form");
  const output = document.getElementById("job-description-output");

  // ============================
  // 📨 Employer Inquiry Handler
  // ============================
  if (inquiryForm) {
    inquiryForm.addEventListener("submit", async function (e) {
      e.preventDefault();

      const formData = new FormData(inquiryForm);
      const payload = Object.fromEntries(formData.entries());

      try {
        const response = await fetch("/api/employer-inquiry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const result = await response.json();

        document.getElementById("inquiry-response").innerText = result.success
          ? "✅ Inquiry submitted!"
          : "❌ Submission failed.";
      } catch (error) {
        console.error("Employer Inquiry Error:", error);
        document.getElementById("inquiry-response").innerText = "❌ Something went wrong.";
      }
    });
  }

  // =====================================
  // 🤖 AI-Powered Job Post Generator
  // =====================================
  if (jobPostForm) {
    jobPostForm.addEventListener("submit", async function (e) {
      e.preventDefault();

      const formData = new FormData(jobPostForm);
      const payload = Object.fromEntries(formData.entries());

      try {
        const response = await fetch("/api/employer/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const result = await response.json();

        if (result.success) {
          output.innerHTML = `<h3>Generated Description:</h3><p>${result.jobDescription.replace(/\n/g, "<br>")}</p>`;
        } else {
          output.innerText = "❌ Error generating job post.";
        }
      } catch (error) {
        console.error("Job Post Generation Error:", error);
        output.innerText = "❌ Something went wrong.";
      }
    });
  }
});
