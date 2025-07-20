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

    const output = document.getElementById("job-description-output");
    const downloadOptions = document.getElementById("download-options");

    // Show branded Jobcus AI loading bar
output.innerHTML = `
  <div class="ai-loading-box">
    <div class="ai-loading-title">🤖 Jobcus AI is thinking...</div>
    <div class="loading-bar">
      <div class="loading-progress"></div>
    </div>
  </div>
`;
    downloadOptions.classList.add("hidden"); // Hide download buttons

    try {
      const response = await fetch("/api/employer/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (result.success) {
        const description = result.jobDescription;
        output.innerHTML = `<h3>Generated Description:</h3><p>${description.replace(/\n/g, "<br>")}</p>`;

        // Show download buttons
        downloadOptions.classList.remove("hidden");

        // Save for downloads
        window.generatedJobDescription = description;
      } else {
        output.innerText = "❌ Error generating job post.";
        downloadOptions.classList.add("hidden");
      }
    } catch (error) {
      console.error("Job Post Error:", error);
      output.innerText = "❌ Something went wrong.";
      downloadOptions.classList.add("hidden");
    }
  });
}
// Download handlers
document.getElementById("download-txt").addEventListener("click", () => {
  const blob = new Blob([window.generatedJobDescription || ""], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "job-description.txt";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("download-docx").addEventListener("click", async () => {
  const { Document, Packer, Paragraph } = window.docx;
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [new Paragraph(window.generatedJobDescription || "No content")],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "job-description.docx";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("download-pdf").addEventListener("click", () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.text(window.generatedJobDescription || "No content", 10, 10);
  doc.save("job-description.pdf");
});
