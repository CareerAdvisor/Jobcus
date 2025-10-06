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
  const root   = document.querySelector('.home-page .ad-slider');
  if(!root) return;

  const slides = Array.from(root.querySelectorAll('.ad-slide'));
  const dots   = Array.from(root.querySelectorAll('.ad-dot'));
  const prev   = root.querySelector('.ad-nav.prev');
  const next   = root.querySelector('.ad-nav.next');

  let i = 0, timer = null, reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function show(idx){
    i = (idx + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('is-active', k === i));
    dots.forEach((d, k) => d.setAttribute('aria-selected', k === i));
  }

  function start(){
    if(reduce) return;          // don’t auto-advance if user prefers less motion
    stop();
    timer = setInterval(() => show(i+1), 5000);
  }
  function stop(){ if(timer) { clearInterval(timer); timer = null; } }

  // Init
  show(0);
  start();

  // Controls
  prev?.addEventListener('click', () => { show(i-1); start(); });
  next?.addEventListener('click', () => { show(i+1); start(); });
  dots.forEach((d, k) => d.addEventListener('click', () => { show(k); start(); }));

  // Pause on hover/focus (desktop)
  root.addEventListener('mouseenter', stop);
  root.addEventListener('mouseleave', start);
  root.addEventListener('focusin', stop);
  root.addEventListener('focusout', start);

  // Basic swipe (mobile)
  let sx = 0;
  root.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; stop(); }, {passive:true});
  root.addEventListener('touchend',   (e) => {
    const dx = (e.changedTouches[0].clientX - sx);
    if(Math.abs(dx) > 40){ show(i + (dx < 0 ? 1 : -1)); }
    start();
  });
})();
