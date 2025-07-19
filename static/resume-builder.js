document.getElementById('resumeForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const form = e.target;
  const formData = {
    fullName: form.fullName.value,
    email: form.email.value,
    phone: form.phone.value,
    summary: form.summary.value,
    education: form.education.value,
    experience: form.experience.value,
    skills: form.skills.value,
    certifications: form.certifications.value,
    languages: form.languages.value,
    portfolio: form.portfolio.value
  };

  const preview = document.getElementById('resumePreview');
  const output = document.getElementById('resumeOutput');
  const scoreBox = document.getElementById('resumeScore');
  output.innerHTML = '<p>⏳ Generating your resume...</p>';
  preview.style.display = 'block';

  try {
    const res = await fetch('/generate-resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    const data = await res.json();
    if (data.formatted_resume) {
      output.innerHTML = data.formatted_resume;
      const resumeLength = data.formatted_resume.split(' ').length;
      const score = Math.min(100, Math.floor(resumeLength / 5 + 60));
      scoreBox.innerHTML = `<h3>📈 Resume Score: ${score}/100</h3>`;
    } else {
      output.innerHTML = '<p style="color:red;">❌ Could not generate resume.</p>';
    }
  } catch (err) {
    output.innerHTML = '<p style="color:red;">❌ Server Error: ' + err.message + '</p>';
  }
});
