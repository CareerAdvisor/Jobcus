// static/js/consent.js  (idempotent + locally scoped)
(function () {
  if (window.__jobcusConsentLoaded) return;
  window.__jobcusConsentLoaded = true;

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
  function show(el){ if (el) el.hidden = false; }
  function hide(el){ if (el) el.hidden = true; }

  // Consent → load scripts (GA4 example)
  function applyConsent(consent){
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
      (function(){
        var s=document.createElement('script');
        s.async=1; s.src='https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX';
        document.head.appendChild(s);
      }());
      gtag('js', new Date());
      gtag('config', 'G-XXXXXXX', { anonymize_ip: true, allow_google_signals: false });
    }

    if (consent?.marketing) {
      gtag('consent', 'update', {
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted'
      });
      // load your marketing tags here
    }
  }

  // Wire up banner
  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.getElementById('consentBanner');
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
      const c = { necessary:true, analytics:true, marketing:true, version:1 };
      writeConsent(c); hide(banner); applyConsent(c);
    });
    btnReject?.addEventListener('click', () => {
      const c = { necessary:true, analytics:false, marketing:false, version:1 };
      writeConsent(c); hide(banner); applyConsent(c);
    });
    btnCustomize?.addEventListener('click', () => { show(panel); });
    btnSave?.addEventListener('click', () => {
      const c = { necessary:true, analytics:!!cbAnalytics?.checked, marketing:!!cbMarketing?.checked, version:1 };
      writeConsent(c); hide(banner); applyConsent(c);
    });
  });
})();
