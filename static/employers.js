// static/employer.js
document.addEventListener('DOMContentLoaded', function () {
  const employerForm = document.getElementById('employer-form');
  const successMsg = document.getElementById('success-message');
  const outputContainer = document.getElementById('generated-output');

  employerForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    successMsg.innerHTML = "⏳ Generating job description...";
    outputContainer.innerHTML = "";

    const formData = new FormData(employerForm);
    const data = {};
    formData.forEach((value, key) => { data[key] = value; });

    try {
      const res = await fetch('/api/employer/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await res.json();

      if (res.ok && result.success) {
        successMsg.innerHTML = `<p style="color: green;">✅ ${result.message}</p>`;
        outputContainer.innerHTML = `
          <h3>📄 AI-Generated Job Description</h3>
          <div class="ai-job-desc" style="border:1px solid #ccc; padding: 12px; border-radius: 6px;">
            ${result.jobDescription.replace(/\n/g, '<br>')}
          </div>
        `;
      } else {
        successMsg.innerHTML = `<p style="color: red;">❌ ${result.message}</p>`;
      }

    } catch (err) {
      console.error('Submission error:', err);
      successMsg.innerHTML = `<p style="color: red;">⚠️ Error submitting form. Try again later.</p>`;
    }
  });
});
