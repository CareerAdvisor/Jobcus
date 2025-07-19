
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("resumeForm");
  const output = document.getElementById("resumeOutput");
  const previewSection = document.getElementById("resumePreview");
  const downloadBtn = document.getElementById("downloadResumeBtn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = {
      fullName: form.querySelector('[name="fullName"]').value,
      email: form.querySelector('[name="email"]').value,
      phone: form.querySelector('[name="phone"]').value,
      summary: form.querySelector('[name="summary"]').value,
      education: Array.from(form.querySelectorAll('[name="education[]"]')).map(e => e.value).join('\n'),
      experience: Array.from(form.querySelectorAll('[name="experience[]"]')).map(e => e.value).join('\n'),
      skills: form.querySelector('[name="skills"]').value,
      certifications: form.querySelector('[name="certifications"]').value,
      languages: form.querySelector('[name="languages"]').value,
      portfolio: form.querySelector('[name="portfolio"]').value,
    };

    try {
      const res = await fetch("/generate-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (data.formatted_resume) {
        output.innerHTML = data.formatted_resume;
        previewSection.style.display = "block";
      } else {
        output.innerHTML = "<p style='color:red;'>❌ Failed to generate resume.</p>";
      }
    } catch (error) {
      console.error(error);
      output.innerHTML = "<p style='color:red;'>⚠️ Error: Unable to generate resume.</p>";
    }
  });

  downloadBtn.addEventListener("click", () => {
    const resumeHTML = output.innerHTML;
    const blob = new Blob([resumeHTML], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resume.html";
    a.click();
    URL.revokeObjectURL(url);
  });
});
