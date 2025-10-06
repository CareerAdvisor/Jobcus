// Home hero chat → redirect to /chat with the message
(function(){
  const input = document.getElementById('homeChatInput');
  const btn   = document.getElementById('homeChatSend');
  if(!input || !btn) return;

  function go(){
    const q = (input.value || '').trim();
    if(!q) { input.focus(); return; }
    try { localStorage.setItem('chat:prefill', q); } catch {}
    window.location.href = '/chat?q=' + encodeURIComponent(q);
  }
  btn.addEventListener('click', go);
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); go(); }});
})();

// FAQ accordion logic (same behavior as old faq.js)
(function(){
  const faqEntries = document.querySelectorAll(".faq-entry");

  faqEntries.forEach(entry => {
    const question = entry.querySelector(".faq-question");
    const answer = entry.querySelector(".faq-answer");
    const toggleIcon = entry.querySelector(".faq-toggle");
    if (answer) answer.style.display = "none";

    question?.addEventListener("click", () => {
      const isOpen = entry.classList.contains("open");
      if (isOpen) {
        entry.classList.remove("open");
        if (answer) answer.style.display = "none";
        if (toggleIcon) toggleIcon.textContent = "+";
      } else {
        entry.classList.add("open");
        if (answer) answer.style.display = "block";
        if (toggleIcon) toggleIcon.textContent = "−";
      }
    });
  });

  document.getElementById("expandAll")?.addEventListener("click", () => {
    faqEntries.forEach(entry => {
      const a = entry.querySelector(".faq-answer");
      const t = entry.querySelector(".faq-toggle");
      entry.classList.add("open");
      if (a) a.style.display = "block";
      if (t) t.textContent = "−";
    });
  });

  document.getElementById("collapseAll")?.addEventListener("click", () => {
    faqEntries.forEach(entry => {
      const a = entry.querySelector(".faq-answer");
      const t = entry.querySelector(".faq-toggle");
      entry.classList.remove("open");
      if (a) a.style.display = "none";
      if (t) t.textContent = "+";
    });
  });
})();

(function(){
  function fixPictureFallback(){
    const mq = window.matchMedia('(min-width: 701px)');
    document.querySelectorAll('.ad-banner picture').forEach(pic => {
      const source = pic.querySelector('source[media*="min-width"]');
      const img    = pic.querySelector('img');
      if (!source || !img) return;

      function choose(){
        if (!mq.matches) return;               // mobile uses <img> already
        const url = source.getAttribute('srcset');
        if (!url) return;
        // Probe the desktop URL; if it loads, swap into <img>; else keep mobile
        const probe = new Image();
        probe.onload  = () => { img.src = url; };
        probe.onerror = () => { /* keep mobile */ };
        probe.src = url;
      }
      choose();
      mq.addEventListener?.('change', choose);
    });
  }
  fixPictureFallback();
})();
