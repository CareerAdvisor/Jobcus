document.addEventListener("DOMContentLoaded", function () {
  // === EMPLOYER INQUIRY FORM ===
  const employerForm = document.getElementById("employer-inquiry-form");
  const responseBox = document.getElementById("inquiry-response");

  if (employerForm && responseBox) {
    employerForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      responseBox.innerHTML = "⏳ Submitting inquiry...";

      const formData = new FormData(employerForm);
      const data = Object.fromEntries(formData.entries());

      try {
        const res = await fetch("/api/employer-inquiry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();
        responseBox.innerHTML = result.message
          ? `<p style="color:green;">✅ ${result.message}</p>`
          : `<p style="color:green;">✅ Inquiry submitted successfully!</p>`;
      } catch (err) {
        console.error(err);
        responseBox.innerHTML = `<p style="color:red;">❌ Submission failed. Please try again.</p>`;
      }
    });
  }

  // === JOB POST GENERATOR ===
  const jobForm = document.getElementById("job-post-form");
  const outputBox = document.getElementById("job-description-output");
  const downloadOptions = document.getElementById("download-options");

  if (jobForm && outputBox && downloadOptions) {
    jobForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      outputBox.innerHTML = '<div class="spinner"></div>';
      downloadOptions.classList.add("hidden");

      const formData = new FormData(jobForm);
      const data = Object.fromEntries(formData.entries());

      try {
        const res = await fetch("/api/generate-job-description", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();

        if (result.description) {
          outputBox.innerHTML = `<div class="fade-in">${result.description}</div>`;
          downloadOptions.classList.remove("hidden");
        } else {
          outputBox.innerHTML = `<p style="color:red;">❌ Failed to generate job description.</p>`;
        }
      } catch (err) {
        console.error(err);
        outputBox.innerHTML = `<p style="color:red;">⚠️ Could not generate job description. Try again.</p>`;
      }
    });

    // === DOWNLOAD TXT ===
    document.getElementById("download-txt")?.addEventListener("click", () => {
      const text = outputBox.innerText;
      const blob = new Blob([text], { type: "text/plain" });
      saveAs(blob, "job-description.txt");
    });

    // === DOWNLOAD PDF ===
    document.getElementById("download-pdf")?.addEventListener("click", () => {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      const text = outputBox.innerText;
      const lines = doc.splitTextToSize(text, 180); // wrap lines
      doc.text(lines, 10, 10);
      doc.save("job-description.pdf");
    });
  }
});
