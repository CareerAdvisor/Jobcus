<!-- Add this inside your <script> or in employers.js -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/docx/7.7.0/docx.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>

<script>
document.addEventListener("DOMContentLoaded", function () {
  const jobPostForm = document.getElementById("job-post-form");
  const output = document.getElementById("job-description-output");
  const downloadOptions = document.getElementById("download-options");

  const txtBtn = document.getElementById("download-txt");
  const docxBtn = document.getElementById("download-docx");
  const pdfBtn = document.getElementById("download-pdf");

  let generatedText = "";

  jobPostForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    const formData = new FormData(jobPostForm);
    const payload = Object.fromEntries(formData.entries());

    const response = await fetch("/api/employer/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (result.success) {
      generatedText = result.jobDescription;
      output.innerHTML = `<h3>Generated Description:</h3><p>${generatedText.replace(/\n/g, "<br>")}</p>`;
      downloadOptions.style.display = "flex";
      downloadOptions.style.gap = "10px";
      downloadOptions.style.flexWrap = "wrap";
    } else {
      output.innerText = "❌ Error generating job post.";
      downloadOptions.style.display = "none";
    }
  });

  // Download .txt
  txtBtn.addEventListener("click", () => {
    const blob = new Blob([generatedText], { type: "text/plain;charset=utf-8" });
    saveAs(blob, "job_description.txt");
  });

  // Download .docx using docx.js
  docxBtn.addEventListener("click", () => {
    const doc = new window.docx.Document({
      sections: [{
        properties: {},
        children: [
          new window.docx.Paragraph({
            children: generatedText.split("\n").map(line => new window.docx.Paragraph(line))
          })
        ]
      }]
    });

    window.docx.Packer.toBlob(doc).then(blob => {
      saveAs(blob, "job_description.docx");
    });
  });

  // Download .pdf using jsPDF
  pdfBtn.addEventListener("click", () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const lines = doc.splitTextToSize(generatedText, 180);
    doc.text(lines, 10, 20);
    doc.save("job_description.pdf");
  });
});
</script>
