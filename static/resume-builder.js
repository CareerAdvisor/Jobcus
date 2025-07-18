document.getElementById('analyze-btn').addEventListener('click', async function () {
  const resultContainer = document.getElementById('analyzer-result');
  const textArea = document.getElementById('resume-text');
  const fileInput = document.getElementById('resumeFile');

  // Show spinner
  resultContainer.innerHTML = `
    <div class="spinner"></div>
    <p style="text-align: center;">⏳ Analyzing your resume...</p>
  `;

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
        <div class="fade-in">
          <h3>✅ AI Feedback</h3>
          <p>${data.analysis}</p>
          <h3>📊 ATS Keyword Match</h3>
          <ul>
            ${data.keywords.map(k => `<li>${k}</li>`).join('')}
          </ul>
        </div>
      `;
    } catch (err) {
      console.error(err);
      resultContainer.innerHTML = "<p style='color:red;'>⚠️ Error analyzing resume. Please try again.</p>";
    }
  }
});
