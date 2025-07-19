document.getElementById('resumeForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const form = e.target;

  const education = Array.from(form.querySelectorAll('textarea[name="education[]"]')).map(e => e.value).join('\n');
  const experience = Array.from(form.querySelectorAll('textarea[name="experience[]"]')).map(e => e.value).join('\n');

  const formData = {
    fullName: form.fullName.value,
    email: form.email.value,
    phone: form.phone.value,
    summary: form.summary.value,
    education,
    experience,
    skills: form.skills.value,
    certifications: form.certifications.value,
    languages: form.languages.value,
    portfolio: form.portfolio.value,
  };

  const res = await fetch('/generate-resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData)
  });

  const data = await res.json();
  if (data.formatted_resume) {
    document.getElementById('resumeOutput').innerHTML = data.formatted_resume;
    document.getElementById('resumePreview').style.display = 'block';
  }
});

document.getElementById('downloadResumeBtn').addEventListener('click', function () {
  const content = document.getElementById('resumeOutput').innerHTML;
  const blob = new Blob([content], { type: 'text/html' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'resume.html';
  link.click();
});

document.getElementById('analyze-btn').addEventListener('click', async function () {
  const resultContainer = document.getElementById('analyzer-result');
  const textArea = document.getElementById('resume-text');
  const fileInput = document.getElementById('resume-upload');

  resultContainer.innerHTML = '<p>⏳ Analyzing...</p>';
  let resumeText = textArea.value.trim();

  if (!resumeText && fileInput.files.length > 0) {
    const file = fileInput.files[0];
    if (file.type.includes('pdf') || file.type.includes('text')) {
      resumeText = await file.text();
    } else {
      resultContainer.innerHTML = '<p style="color:red;">Unsupported file format.</p>';
      return;
    }
  }

  if (!resumeText) {
    resultContainer.innerHTML = '<p style="color:red;">Please paste or upload your resume.</p>';
    return;
  }

  try {
    const res = await fetch('/api/analyze-resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: resumeText })
    });
    const data = await res.json();

    resultContainer.innerHTML = `
      <div>
        <h3>✅ AI Feedback</h3>
        <p>${data.analysis}</p>
        <h3>📊 Keyword Match</h3>
        <ul>${data.keywords.map(k => `<li>${k}</li>`).join('')}</ul>
      </div>
    `;
  } catch (error) {
    resultContainer.innerHTML = '<p style="color:red;">Server Error. Try again later.</p>';
    console.error(error);
  }
});