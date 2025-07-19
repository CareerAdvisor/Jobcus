
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

  const output = document.getElementById('resumeOutput');
  const preview = document.getElementById('resumePreview');
  preview.style.display = 'block';
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

document.getElementById('downloadResumeBtn').addEventListener('click', function () {
  const content = document.getElementById('resumeOutput').innerHTML;
  const blob = new Blob([content], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'resume.html';
  link.click();
  URL.revokeObjectURL(url);
});

document.getElementById('analyze-btn').addEventListener('click', async function () {
  const resultContainer = document.getElementById('analyzer-result');
  const textArea = document.getElementById('resume-text');
  const fileInput = document.getElementById('resumeFile');

  resultContainer.innerHTML = '<p>⏳ Analyzing resume...</p>';
  let resumeText = textArea.value.trim();

  if (!resumeText && fileInput.files.length > 0) {
    const file = fileInput.files[0];
    if (file.type.includes('pdf')) {
      const reader = new FileReader();
      reader.onload = async function (e) {
        const base64PDF = e.target.result.split(',')[1];
        sendToAnalyzer({ pdf: base64PDF });
      };
      reader.readAsDataURL(file);
      return;
    } else {
      resumeText = await file.text();
    }
  }

  if (!resumeText) {
    resultContainer.innerHTML = '<p style="color:red;">Please paste your resume or upload a file.</p>';
    return;
  }

  sendToAnalyzer({ text: resumeText });

  async function sendToAnalyzer(payload) {
    try {
      const res = await fetch('/api/analyze-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      resultContainer.innerHTML = `
        <div>
          <h3>✅ AI Feedback</h3>
          <p>${data.analysis}</p>
          <h3>📊 ATS Keyword Match</h3>
          <ul>
            ${data.keywords.map(k => `<li>${k}</li>`).join('')}
          </ul>
        </div>
      `;
    } catch (err) {
      resultContainer.innerHTML = "<p style='color:red;'>⚠️ Error analyzing resume. Please try again.</p>";
    }
  }
});
