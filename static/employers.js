// static/employer.js
document.addEventListener('DOMContentLoaded', function () {
  const employerForm = document.getElementById('employer-form');
  const successMsg = document.getElementById('success-message');

  employerForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const formData = new FormData(employerForm);
    const data = {};

    formData.forEach((value, key) => {
      data[key] = value;
    });

    try {
      const res = await fetch('/api/employer/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await res.json();

      if (res.ok && result.success) {
        successMsg.innerHTML = `<p style="color: green;">✅ ${result.message}</p>`;
        employerForm.reset();
      } else {
        successMsg.innerHTML = `<p style="color: red;">❌ ${result.message || 'Something went wrong.'}</p>`;
      }

    } catch (err) {
      console.error('Submission error:', err);
      successMsg.innerHTML = `<p style="color: red;">⚠️ Error submitting form. Please try again later.</p>`;
    }
  });
});

