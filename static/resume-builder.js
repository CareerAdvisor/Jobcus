document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("resumeForm");
  const popup = document.getElementById("optimize-popup");
  const resumeOutput = document.getElementById("resumeOutput");
  const downloadOptions = document.getElementById("resumeDownloadOptions");

  const acceptBtn = document.getElementById("acceptOptimize");
  const declineBtn = document.getElementById("declineOptimize");

  let optimizeWithAI = true;
  let shouldBuild = false;

  if (!form || !popup || !acceptBtn || !declineBtn || !resumeOutput) {
    console.warn("Missing required elements for resume builder.");
    return;
  }

  // STEP 1: Intercept form submit and show popup first
  form.addEventListener("submit", function (e) {
    if (!shouldBuild) {
      e.preventDefault();
      popup.classList.remove("hidden"); // Show popup
      return;
    }
    shouldBuild = false; // reset after popup decision
  });

  // STEP 2: User chooses to optimize or not
  acceptBtn.onclick = () => {
    optimizeWithAI = true;
    popup.classList.add("hidden");
    shouldBuild = true;
    form.dispatchEvent(new Event("submit"));
  };

  declineBtn.onclick = () => {
    optimizeWithAI = false;
    popup.classList.add("hidden");
    shouldBuild = true;
    form.dispatchEvent(new Event("submit"));
  };

  // STEP 3: Actual resume submission
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!shouldBuild) return;

    resumeOutput.innerHTML = "⏳ Generating resume...";
    const data = Object.fromEntries(new FormData(form).entries());
    data.optimize = optimizeWithAI;

    try {
      const response = await fetch("/generate-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (result.formatted_resume) {
        const cleaned = cleanAIText(result.formatted_resume);
        resumeOutput.innerHTML = cleaned;
        if (downloadOptions) downloadOptions.style.display = "block";
        window.scrollTo({ top: resumeOutput.offsetTop, behavior: "smooth" });
      } else {
        resumeOutput.innerHTML = `<p style="color:red;">❌ Failed to generate resume.</p>`;
      }
    } catch (error) {
      console.error(error);
      resumeOutput.innerHTML = `<p style="color:red;">⚠️ Server error. Try again.</p>`;
    }
  });

  function cleanAIText(content) {
    return content
      .replace(/```html|```/g, "")
      .replace(/(?:Certainly!|Here's a resume|This HTML).*?\n/gi, "")
      .trim();
  }

  // OPTIONAL: Download buttons if using FileSaver/jsPDF
  window.downloadResume = function (format) {
    const text = resumeOutput.innerText || "Your resume content here";
    if (format === "txt") {
      const blob = new Blob([text], { type: "text/plain" });
      saveAs(blob, "resume.txt");
    } else if (format === "pdf") {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      const lines = doc.splitTextToSize(text, 180);
      doc.text(lines, 10, 10);
      doc.save("resume.pdf");
    } else if (format === "doc") {
      const blob = new Blob([text], { type: "application/msword" });
      saveAs(blob, "resume.doc");
    }
  };
});
