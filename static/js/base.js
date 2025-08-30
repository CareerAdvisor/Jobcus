// static/js/base.js

// ───── 1) Initialize AOS ─────
AOS.init();

// ───── 2) User menu (avatar button) ─────
document.addEventListener('DOMContentLoaded', () => {
  const btn  = document.getElementById('userMenuBtn');
  const drop = document.getElementById('userDropdown');
  if (!btn || !drop) return;

  // click to open/close
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    drop.classList.toggle('show');
    const open = drop.classList.contains('show');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // keyboard support
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      btn.click();
    }
  });
});

// ───── 3) Mobile menu toggle ─────
function toggleMobileMenu() {
  document.getElementById('mobileMenu')?.classList.toggle('show');
}

// ───── 4) Features submenu toggle ─────
document.querySelectorAll('.dropbtn').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const menu = btn.nextElementSibling; // .dropdown-content
    menu?.classList.toggle('show');
  });
});

// ---- state sync (runs on all pages) ----
(function(){
  // pull once on load
  if (window.USER_AUTHENTICATED) {
    fetch('/api/state').then(r=>r.json()).then(({data})=>{
      if (data && typeof data === 'object') {
        if (data.chatUsed != null) localStorage.setItem('chatUsed', String(data.chatUsed));
        if (data.resume_latest) localStorage.setItem('resume_latest', JSON.stringify(data.resume_latest));
      }
    }).catch(()=>{});
  }

  // push periodically / on-demand
  window.syncState = function(){
    if (!window.USER_AUTHENTICATED) return;
    const payload = {
      chatUsed: Number(localStorage.getItem('chatUsed') || 0),
      resume_latest: JSON.parse(localStorage.getItem('resume_latest') || 'null'),
    };
    fetch('/api/state', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({data:payload})
    }).catch(()=>{});
  };

  // push on tab close as a best-effort
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { try{ window.syncState(); }catch(e){} }
  });
})();

// ───── 5) Global click handler ─────
//    - Closes mobile menu if clicking outside
//    - Closes any open Features or User dropdowns
document.addEventListener('click', (e) => {
  // a) Mobile menu
  const mobileMenu = document.getElementById('mobileMenu');
  const hamburger  = document.querySelector('.hamburger');
  if (
    mobileMenu?.classList.contains('show') &&
    !mobileMenu.contains(e.target) &&
    !hamburger?.contains(e.target)
  ) {
    mobileMenu.classList.remove('show');
  }

  // b) Features dropdown(s)
  document.querySelectorAll('.dropdown-content').forEach(drop => {
    const btn = drop.previousElementSibling;
    if (
      drop.classList.contains('show') &&
      !drop.contains(e.target) &&
      !btn?.contains(e.target)
    ) {
      drop.classList.remove('show');
    }
  });

  // c) User dropdown (UPDATED to use #userMenuBtn)
  const userDropdown = document.getElementById('userDropdown');
  const userBtn      = document.getElementById('userMenuBtn');
  if (
    userDropdown?.classList.contains('show') &&
    !userDropdown.contains(e.target) &&
    !userBtn?.contains(e.target)
  ) {
    userDropdown.classList.remove('show');
    userBtn?.setAttribute('aria-expanded', 'false');
  }

});


// ──────────────────────────────────────────────────────────────
// 6) Cookie Consent (banner + conditional analytics loading)
// ──────────────────────────────────────────────────────────────

const CONSENT_COOKIE = "jobcus_consent";
const CONSENT_TTL_DAYS = 180;

function setCookie(name, value, days){
  const d = new Date();
  d.setTime(d.getTime() + days*24*60*60*1000);
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax; Secure`;
}
function getCookie(name){
  return document.cookie.split('; ').find(r => r.startsWith(name+'='))?.split('=')[1] || null;
}
function readConsent(){
  try { return JSON.parse(decodeURIComponent(getCookie(CONSENT_COOKIE) || "")) || null; }
  catch { return null; }
}
function writeConsent(obj){
  setCookie(CONSENT_COOKIE, JSON.stringify({ ...obj, ts: Date.now() }), CONSENT_TTL_DAYS);
}

  function show(el){
    el.hidden = false;
    // allow layout to settle, then animate in
    requestAnimationFrame(() => el.classList.add('is-visible'));
  }
  function hide(el){
    el.classList.remove('is-visible');
    // wait for CSS transition to finish, then truly hide
    setTimeout(() => { el.hidden = true; }, 300);
  }

  // Open/close the preferences panel with dim
  (function(){
    const panel = document.getElementById('ccPanel');
    const dim   = document.getElementById('ccDim');
    const btnCustomize = document.getElementById('ccCustomize');
    const btnCancel    = document.getElementById('ccCancel');
    const btnSave      = document.getElementById('ccSave');

    function openPanel(){
      show(panel); dim.hidden = false;
      requestAnimationFrame(() => dim.classList.add('is-visible'));
    }
    function closePanel(){
      hide(panel);
      dim.classList.remove('is-visible');
      setTimeout(() => { dim.hidden = true; }, 300);
    }

    btnCustomize?.addEventListener('click', openPanel);
    btnCancel?.addEventListener('click', closePanel);
    dim?.addEventListener('click', closePanel);

    // If your existing consent script already wires btnSave, just close the panel after save
    btnSave?.addEventListener('click', () => { /* your save runs elsewhere */ closePanel(); });
  })();

/** Apply consent: set Consent Mode defaults and load scripts only if granted */
function applyConsent(consent){
  // GA4 Consent Mode (defaults: denied)
  window.dataLayer = window.dataLayer || [];
  function gtag(){ dataLayer.push(arguments); }

  gtag('consent', 'default', {
    ad_storage: 'denied',
    analytics_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied'
  });

  if (consent?.analytics) {
    gtag('consent', 'update', { analytics_storage: 'granted' });

    // Load GA4 only after consent
    (function(){
      var s=document.createElement('script');
      s.async=1;
      s.src='https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX'; // TODO: replace with your GA4 ID
      document.head.appendChild(s);
    }());
    gtag('js', new Date());
    gtag('config', 'G-XXXXXXX', {
      anonymize_ip: true,
      allow_google_signals: false
    });
  }

  if (consent?.marketing) {
    gtag('consent', 'update', {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted'
    });
    // Load other marketing/remarketing tags here (after consent)
  }
}

// IIFE: wire up the banner when present
(function(){
  const banner = document.getElementById('consentBanner');
  if (!banner) return; // page has no banner markup

  const panel  = document.getElementById('ccPanel');
  const btnAccept = document.getElementById('ccAccept');
  const btnReject = document.getElementById('ccReject');
  const btnCustomize = document.getElementById('ccCustomize');
  const btnSave = document.getElementById('ccSave');
  const cbAnalytics = document.getElementById('ccAnalytics');
  const cbMarketing = document.getElementById('ccMarketing');

  const saved = readConsent();
  const dnt = (navigator.doNotTrack == "1" || window.doNotTrack == "1");

  if (saved){
    applyConsent(saved);
  } else {
    show(banner);
    if (dnt){
      if (cbAnalytics) cbAnalytics.checked = false;
      if (cbMarketing) cbMarketing.checked = false;
    }
  }

  btnAccept?.addEventListener('click', () => {
    const consent = { necessary: true, analytics: true, marketing: true, version: 1 };
    writeConsent(consent); hide(banner); applyConsent(consent);
  });
  btnReject?.addEventListener('click', () => {
    const consent = { necessary: true, analytics: false, marketing: false, version: 1 };
    writeConsent(consent); hide(banner); applyConsent(consent);
  });
  btnCustomize?.addEventListener('click', () => { show(panel); });
  btnSave?.addEventListener('click', () => {
    const consent = {
      necessary: true,
      analytics: !!cbAnalytics?.checked,
      marketing: !!cbMarketing?.checked,
      version: 1
    };
    writeConsent(consent); hide(banner); applyConsent(consent);
  });
})();
