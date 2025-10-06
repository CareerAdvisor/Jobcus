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

(function () {
  const AUTOPLAY_MS = 6000;

  /* ---------- Choose the right image per breakpoint + fallback ---------- */
  function applyAdImages() {
    const desktop = window.matchMedia('(min-width: 701px)').matches;
    document.querySelectorAll('.ad-slider .ad-img').forEach((img) => {
      const want = desktop ? img.dataset.desktop : img.dataset.mobile;
      if (!want) return;

      if (img.getAttribute('src') !== want) {
        img.onerror = function () {
          // If desktop asset fails, fall back to mobile
          if (desktop && img.dataset.mobile) img.src = img.dataset.mobile;
        };
        img.src = want;
      }
    });
  }

  /* --------------------------- Slider initializer --------------------------- */
  function initSliders() {
    document.querySelectorAll('.ad-slider').forEach((slider) => {
      const frame  = slider.querySelector('.ad-slider__frame');
      const slides = [...frame.querySelectorAll('.ad-slide')];

      // Ensure a dots container exists
      let dotsEl = frame.querySelector('.ad-dots');
      if (!dotsEl) {
        dotsEl = document.createElement('div');
        dotsEl.className = 'ad-dots';
        frame.appendChild(dotsEl);
      }

      const prev   = frame.querySelector('.ad-nav.prev');
      const next   = frame.querySelector('.ad-nav.next');

      if (!slides.length) return;

      // Build dots
      dotsEl.innerHTML = '';
      const dots = slides.map((_, i) => {
        const b = document.createElement('button');
        b.className = 'ad-dot';
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-label', `Go to slide ${i + 1}`);
        dotsEl.appendChild(b);
        b.addEventListener('click', () => go(i));
        return b;
      });

      let idx = 0, timer;

      function setActive(i) {
        slides.forEach((s, n) => s.classList.toggle('is-active', n === i));
        dots.forEach((d, n) =>
          d.setAttribute('aria-selected', n === i ? 'true' : 'false')
        );
      }
      function go(i) { idx = (i + slides.length) % slides.length; setActive(idx); restart(); }
      function nextSlide() { go(idx + 1); }
      function prevSlide() { go(idx - 1); }

      function restart() {
        clearInterval(timer);
        timer = setInterval(nextSlide, AUTOPLAY_MS);
      }

      prev?.addEventListener('click', prevSlide);
      next?.addEventListener('click', nextSlide);
      frame.addEventListener('mouseenter', () => clearInterval(timer));
      frame.addEventListener('mouseleave', restart);

      // Kickoff
      setActive(0);
      restart();
    });
  }

  /* --------------------------- Boot sequence --------------------------- */
  function boot() {
    applyAdImages();        // pick images (and fallback) first
    initSliders();          // then initialize sliders
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Swap images on breakpoint changes (debounced)
  window.addEventListener('resize', () => {
    clearTimeout(window.__adSwap);
    window.__adSwap = setTimeout(applyAdImages, 150);
  });
})();

