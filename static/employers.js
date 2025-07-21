document.addEventListener("DOMContentLoaded", function () {
  window.docx = window.docx || window["docx"];
  const inquiryForm = document.getElementById("employer-inquiry-form");
  const jobPostForm = document.getElementById("job-post-form");
  const output = document.getElementById("job-description-output");
  const downloadOptions = document.getElementById("download-options");

  // ----------------------------
  // 📨 Employer Inquiry Handler
  // ----------------------------
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

  // ----------------------------
  // 🤖 AI Job Post Generator
  // ----------------------------
  if (jobPostForm) {
    jobPostForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const formData = new FormData(jobPostForm);
      const payload = Object.fromEntries(formData.entries());

      // Show branded Jobcus AI loading bar
      output.innerHTML = `
        <div class="ai-loading-box">
          <div class="ai-loading-title">🤖 Jobcus AI is thinking...</div>
          <div class="loading-bar"><div class="loading-progress"></div></div>
        </div>
      `;
      downloadOptions.classList.add("hidden");

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
          downloadOptions.classList.remove("hidden");
          window.generatedJobDescription = description;
        } else {
          output.innerText = "❌ Error generating job post.";
        }
      } catch (error) {
        console.error("Job Post Error:", error);
        output.innerText = "❌ Something went wrong.";
      }
    });
  }

  // ----------------------------
  // 📄 Download .txt
  // ----------------------------
  document.getElementById("download-txt").addEventListener("click", () => {
    const blob = new Blob([window.generatedJobDescription || ""], { type: "text/plain" });
    saveAs(blob, "job-description.txt");
  });

  // ----------------------------
  // 📄 Download .pdf
  // ----------------------------
  document.getElementById("download-pdf").addEventListener("click", () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const margin = 10;
    const maxWidth = 190; // A4 width (210mm) − margins (10mm each side)
    const text = window.generatedJobDescription || "No content";
    const lines = doc.splitTextToSize(text, maxWidth);
    doc.text(lines, margin, margin);
    doc.save("job-description.pdf");
  });
});
