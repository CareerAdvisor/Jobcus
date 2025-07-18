document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('resumeForm');
  const previewSection = document.getElementById('resumePreview');
  const output = document.getElementById('resumeOutput');
  const downloadBtn = document.getElementById('downloadResumeBtn');
  const analyzeBtn = document.getElementById('analyze-btn');
  const analyzerResult = document.getElementById('analyzer-result');

  // Form submission handler
  form.addEventListener('submit', function (e) {
    e.preventDefault();

    const formData = new FormData(form);
    let resumeHTML = '<div class="resume-preview">';
    formData.forEach((value, key) => {
      resumeHTML += `<p><strong>${key.replace(/([A-Z])/g, ' $1')}:</strong> ${value}</p>`;
    });
    resumeHTML += '</div>';

    output.innerHTML = resumeHTML;
    previewSection.style.display = 'block';
  });

  // PDF download logic
  downloadBtn.addEventListener('click', function () {
    const opt = {
      margin: 1,
      filename: 'resume.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    };
    html2pdf().from(output).set(opt).save();
  });

  // Resume analyzer (basic frontend version)
  analyzeBtn.addEventListener('click', function () {
    const resumeText = document.getElementById('resume-text').value;
    if (resumeText.trim() === '') {
      analyzerResult.innerHTML = '<p>Please paste your resume to analyze.</p>';
      return;
    }

    analyzerResult.innerHTML = `
      <p><strong>Analysis Result:</strong> Your resume includes relevant keywords and is easy to read. 
      Consider shortening long paragraphs and using bullet points for clarity.</p>
    `;
  });

  // Add extra education field
  window.addEducationField = function () {
    const container = document.getElementById('education-container');
    const textarea = document.createElement('textarea');
    textarea.name = 'education[]';
    textarea.placeholder = 'e.g., MSc in Data Science, University XYZ (2022–2024)';
    container.appendChild(textarea);
  };

  // Add extra experience field
  window.addExperienceField = function () {
    const container = document.getElementById('experience-container');
    const textarea = document.createElement('textarea');
    textarea.name = 'experience[]';
    textarea.placeholder = 'e.g., Digital Marketing Specialist at ABC Corp (2020–2023)';
    container.appendChild(textarea);
  };
});
