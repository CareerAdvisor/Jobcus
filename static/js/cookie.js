// /static/js/cookie.js
(function(){
  "use strict";

  // Expose the cookie name via global namespace
  window.JOBCUS = window.JOBCUS || {};
  if (!('CONSENT_COOKIE' in window.JOBCUS)) {
    window.JOBCUS.CONSENT_COOKIE = 'jobcus_consent';
  }
  const CONSENT_COOKIE = window.JOBCUS.CONSENT_COOKIE;
  const CONSENT_TTL_DAYS = 180;
  const CONSENT_VERSION = "2025-10-01"; // bump when you change vendors/policy

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
    const record = { ...obj, ts: Date.now(), version: CONSENT_VERSION };
    setCookie(CONSENT_COOKIE, JSON.stringify(record), CONSENT_TTL_DAYS);
    // 🔹 optional: send to backend for logging
    try { navigator.sendBeacon?.("/api/consent-log", JSON.stringify(record)); } catch {}
  }
  function show(el){ if (el) { el.hidden = false; el.classList.add('show'); } }
  function hide(el){ if (el) { el.classList.remove('show'); el.hidden = true; } }

  // --- Helpers to activate deferred scripts ---
  function enableCategory(cat){
    document.querySelectorAll(`script[type="text/plain"][data-cc="${cat}"]`)
      .forEach(node => {
        const s = document.createElement("script");
        if (node.dataset.src) s.src = node.dataset.src;
        if (node.textContent) s.text = node.textContent;
        s.async = true;
        node.parentNode.insertBefore(s, node);
        node.remove();
      });
  }

  function applyConsent(consent){
    window.dataLayer = window.dataLayer || [];
    function gtag(){ window.dataLayer.push(arguments); }
    gtag('consent', 'default', {
      ad_storage: 'denied',
      analytics_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });

    if (consent?.analytics) {
      gtag('consent', 'update', { analytics_storage: 'granted' });
      enableCategory("analytics");
    }
    if (consent?.marketing) {
      gtag('consent', 'update', {
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted'
      });
      enableCategory("marketing");
    }
  }

  // --- DOM refs ---
  const banner = document.getElementById('consentBanner');
  const panel  = document.getElementById('ccPanel');
  const btnAccept    = document.getElementById('ccAccept');
  const btnReject    = document.getElementById('ccReject');
  const btnCustomize = document.getElementById('ccCustomize');
  const btnSave      = document.getElementById('ccSave');
  const cbAnalytics  = document.getElementById('ccAnalytics');
  const cbMarketing  = document.getElementById('ccMarketing');
  const btnManage    = document.getElementById('ccManage'); // footer "Manage cookies"

  const saved = readConsent();
  const dnt = (navigator.doNotTrack == "1" || window.doNotTrack == "1");

  if (saved && saved.version === CONSENT_VERSION) {
    applyConsent(saved);
  } else {
    show(banner);
    if (dnt) {
      cbAnalytics && (cbAnalytics.checked = false);
      cbMarketing && (cbMarketing.checked = false);
    }
  }

  btnAccept?.addEventListener('click', () => {
    const consent = { necessary: true, analytics: true, marketing: true };
    writeConsent(consent); hide(banner); hide(panel); applyConsent(consent);
  });
  btnReject?.addEventListener('click', () => {
    const consent = { necessary: true, analytics: false, marketing: false };
    writeConsent(consent); hide(banner); hide(panel); applyConsent(consent);
  });
  btnCustomize?.addEventListener('click', () => { hide(banner); show(panel); });
  btnSave?.addEventListener('click', () => {
    const consent = {
      necessary: true,
      analytics: !!cbAnalytics?.checked,
      marketing: !!cbMarketing?.checked
    };
    writeConsent(consent); hide(panel); applyConsent(consent);
  });
  btnManage?.addEventListener('click', () => { hide(banner); show(panel); });

  // Expose programmatic reopen
  window.JOBCUS.openConsent = () => { hide(banner); show(panel); };
})();
