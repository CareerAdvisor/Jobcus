// cookie.js
(function(){
  const CONSENT_COOKIE = "jobcus_consent";
  const CONSENT_TTL_DAYS = 180;

  function setCookie(name, value, days){
    const d = new Date(); d.setTime(d.getTime() + days*24*60*60*1000);
    document.cookie = name + "=" + encodeURIComponent(value) +
      "; expires=" + d.toUTCString() + "; path=/; SameSite=Lax; Secure";
  }
  function getCookie(name){
    const pair = document.cookie.split("; ").find(r => r.startsWith(name+"="));
    return pair ? pair.split("=")[1] : null;
  }
  function readConsent(){
    try { return JSON.parse(decodeURIComponent(getCookie(CONSENT_COOKIE) || "")) || null; }
    catch { return null; }
  }
  function writeConsent(obj){
    setCookie(CONSENT_COOKIE, JSON.stringify({ ...obj, ts: Date.now() }), CONSENT_TTL_DAYS);
  }
  function show(el){ if (el) { el.hidden = false; el.classList.add('show'); } }
  function hide(el){ if (el) { el.classList.remove('show'); el.hidden = true; } }

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
    }
  }

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

  if (saved) {
    applyConsent(saved);
  } else {
    show(banner);
    if (dnt) { cbAnalytics.checked = false; cbMarketing.checked = false; }
  }

  btnAccept?.addEventListener('click', () => {
    const consent = { necessary: true, analytics: true, marketing: true, version: 1 };
    writeConsent(consent); hide(banner); hide(panel); applyConsent(consent);
  });
  btnReject?.addEventListener('click', () => {
    const consent = { necessary: true, analytics: false, marketing: false, version: 1 };
    writeConsent(consent); hide(banner); hide(panel); applyConsent(consent);
  });
  btnCustomize?.addEventListener('click', () => { hide(banner); show(panel); });
  btnSave?.addEventListener('click', () => {
    const consent = { necessary: true, analytics: cbAnalytics.checked, marketing: cbMarketing.checked, version: 1 };
    writeConsent(consent); hide(panel); applyConsent(consent);
  });
})();
