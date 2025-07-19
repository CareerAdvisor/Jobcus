
document.getElementById('resumeForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const form = e.target;
  const formData = {
    fullName: form.fullName.value,
    summary: form.summary.value,
    education: form.education.value,
    experience: form.experience.value,
    skills: form.skills.value,
    certifications: form.certifications.value,
    languages: form.languages.value,
    portfolio: form.portfolio.value
  };

  const output = document.getElementById('resumePreview');
  output.innerHTML = '<p>⏳ Generating your resume...</p>';

  try {
    const res = await fetch('/generate-resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    const data = await res.json();
    if (data.formatted_resume) {
      output.innerHTML = data.formatted_resume;
    } else {
      output.innerHTML = '<p style="color:red;">❌ Failed to generate resume.</p>';
    }
  } catch (err) {
    output.innerHTML = '<p style="color:red;">❌ Error: ' + err.message + '</p>';
  }
});
