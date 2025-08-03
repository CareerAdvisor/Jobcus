// static/dashboard.js

document.addEventListener("DOMContentLoaded", () => {
  //
  // 1) Greeting
  //
  const greetEl = document.getElementById("dashboardGreeting");
  if (greetEl) {
    const first = !localStorage.getItem("dashboardVisited");
    greetEl.textContent = first ? "Welcome" : "Welcome Back";
    localStorage.setItem("dashboardVisited", "true");
  }

  //
  // 2) Load analysis JSON
  //
  const raw = localStorage.getItem("resumeAnalysis");
  if (!raw) {
    // no analysis → leave CTA visible
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("Could not parse resumeAnalysis");
    return;
  }

  //
  // 3) Hide the “no-analysis” CTA, show the analysis section
  //
  const noCTA = document.getElementById("no-analysis-cta");
  if (noCTA) noCTA.style.display = "none";

  const analysisSection = document.getElementById("resume-analysis");
  if (analysisSection) analysisSection.style.display = "block";

  //
  // 4) Animate the circle
  //
  const circle = document.querySelector(".progress-circle");
  if (circle) {
    const path = circle.querySelector(".progress");
    const text = circle.querySelector(".percentage");
    const target = data.score || 0;
    let current = 0;
    const step = target > 0 ? 1 : -1;
    circle.dataset.score = target;
    const iv = setInterval(() => {
      if (current === target) return clearInterval(iv);
      current += step;
      path.setAttribute("stroke-dasharray", `${current},100`);
      text.textContent = `${current}%`;
    }, 20);
  }

  //
  // 5) Populate Issues, Strengths, Suggestions
  //
  const issuesUL = document.getElementById("top-issues");
  if (issuesUL) {
    issuesUL.innerHTML = "";
    (data.analysis.issues || []).forEach(i => {
      const li = document.createElement("li");
      li.textContent = i;
      issuesUL.appendChild(li);
    });
  }

  const strengthsUL = document.getElementById("good-points");
  if (strengthsUL) {
    strengthsUL.innerHTML = "";
    (data.analysis.strengths || []).forEach(s => {
      const li = document.createElement("li");
      li.textContent = s;
      strengthsUL.appendChild(li);
    });
  }

  const suggestionsUL = document.getElementById("suggestions-list");
  if (suggestionsUL) {
    suggestionsUL.innerHTML = "";
    (data.suggestions || []).forEach(s => {
      const li = document.createElement("li");
      li.textContent = s;
      suggestionsUL.appendChild(li);
    });
  }

  //
  // 6) Optimize-flow: wire up #optimize-btn
  //
  const optimizeBtn = document.getElementById("optimize-btn");
  const loadingEl   = document.getElementById("optimized-loading");
  const outputEl    = document.getElementById("optimized-output");
  const downloadsEl = document.getElementById("optimized-downloads");
  // Make sure you saved this in resume-builder.js:
  //   localStorage.setItem("resumeBase64", b64);
  const resumeBase64 = localStorage.getItem("resumeBase64");

  if (optimizeBtn) {
    optimizeBtn.addEventListener("click", async () => {
      if (loadingEl)   loadingEl.style.display    = "block";
      if (outputEl)    outputEl.style.display     = "none";
      if (downloadsEl) downloadsEl.style.display  = "none";

      if (!resumeBase64) {
        alert("Missing your original resume data for optimization.");
        if (loadingEl) loadingEl.style.display = "none";
        return;
      }

      try {
        const res = await fetch("/api/optimize-resume", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ pdf: resumeBase64 })
        });
        const js = await res.json();
        if (!res.ok || js.error) throw new Error(js.error || res.statusText);

        if (loadingEl)   loadingEl.style.display   = "none";
        if (outputEl) {
          outputEl.textContent    = js.optimized;
          outputEl.style.display  = "block";
        }
        if (downloadsEl) downloadsEl.style.display = "block";

      } catch (err) {
        console.error("Optimize error:", err);
        if (loadingEl) loadingEl.style.display = "none";
        alert("Failed to optimize resume. Try again.");
      }
    });
  }

});
