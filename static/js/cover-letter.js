// /static/js/cover-letter.js
(function () {
  "use strict";

  // Always send cookies with fetch (SameSite=Lax)
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  const PRICING_URL = (window.PRICING_URL || "/pricing");

  // Utilities
  const escapeHtml = (s="") => String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  const stripTags  = (s="") => String(s).replace(/<[^>]*>/g, "").trim();

  // Watermark helpers (compatible with your base.js)
  const EMAIL_RE = /@.+\./;
  const sanitizeWM = (t) => (!String(t||"").trim() || EMAIL_RE.test(t)) ? "JOBCUS.COM" : String(t).trim();
  function stripWatermarks(root=document){
    if (typeof window.stripExistingWatermarks === "function") {
      try { window.stripExistingWatermarks(root); return; } catch {}
    }
    try {
      const doc = root.ownerDocument || root;
      if (doc && !doc.getElementById("wm-nuke-style")) {
        const st = doc.createElement("style");
        st.id = "wm-nuke-style";
        st.textContent = `*{background-image:none!important}*::before,*::after{background-image:none!important;content:''!important}`;
        (doc.head || doc.documentElement).appendChild(st);
      }
      (root.querySelectorAll ? root.querySelectorAll("[data-watermark], [data-watermark-tile], .wm-tiled, [style*='background-image']") : [])
        .forEach(el => {
          el.removeAttribute?.("data-watermark");
          el.removeAttribute?.("data-watermark-tile");
          el.classList?.remove("wm-tiled");
          if (el.style) {
            el.style.backgroundImage = "";
            el.style.backgroundSize  = "";
            el.style.backgroundBlendMode = "";
          }
        });
    } catch {}
  }
  function applyWM(el, text="JOBCUS.COM", opts={ size:460, alpha:0.16, angles:[-32,32] }){
    text = sanitizeWM(text); if (!el || !text) return;
    if (typeof window.applyTiledWatermark === "function"){
      stripWatermarks(el);
      window.applyTiledWatermark(el, text, opts);
      return;
    }
    // minimal tiler fallback
    stripWatermarks(el);
    const size = opts.size || 420;
    const angles = Array.isArray(opts.angles) && opts.angles.length ? opts.angles : [-32, 32];
    function tile(t,a,alpha=0.18){
      const c=document.createElement("canvas"); c.width=size; c.height=size;
      const x=c.getContext("2d");
      x.clearRect(0,0,size,size);
      x.globalAlpha=(opts.alpha ?? alpha);
      x.translate(size/2,size/2); x.rotate((a*Math.PI)/180);
      x.textAlign="center"; x.textBaseline="middle";
      x.font='bold 36px Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
      x.fillStyle="#000";
      const L=String(t).toUpperCase(), gap=44;
      x.fillText(L,0,-gap/2); x.fillText(L,0,gap/2);
      return c.toDataURL("image/png");
    }
    const urls=angles.map(a=>tile(text,a)), sz=size+"px "+size+"px";
    el.classList.add("wm-tiled");
    el.style.backgroundImage = urls.map(u=>`url(${u})`).join(", ");
    el.style.backgroundSize  = urls.map(()=>sz).join(", ");
    el.style.backgroundBlendMode="multiply, multiply";
    el.style.backgroundRepeat="repeat";
  }

  // Errors (upgrade/auth first)
  async function handleCommonErrors(res){
    if (res.ok) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let j=null, t="";
    try { if (ct.includes("application/json")) j=await res.json(); else t=await res.text(); } catch {}
    const msg = (j && (j.message || j.error)) || stripTags(t) || `Request failed (${res.status})`;

    if (res.status === 402 || (j && (j.error === "upgrade_required" || j.error === "quota_exceeded"))) {
      const url  = j?.pricing_url || PRICING_URL;
      const html = j?.message_html || `You’ve reached your plan limit. <a href="${url}">Upgrade now →</a>`;
      window.upgradePrompt?.(html, url, 1200);
      throw new Error(j?.message || "Upgrade required");
    }
    if (res.status === 401 || res.status === 403) {
      const auth = j?.message || "Please sign up or log in to use this feature.";
      window.showUpgradeBanner?.(auth);
      setTimeout(()=>{ window.location.href="/account?mode=login"; }, 800);
      throw new Error(auth);
    }
    if (res.status === 429 && (j?.error === "too_many_free_accounts" || j?.error === "device_limit")) {
      const ab = j?.message || "Too many free accounts detected from your network/device.";
      window.showUpgradeBanner?.(ab);
      throw new Error(ab);
    }
    window.showUpgradeBanner?.(escapeHtml(msg));
    throw new Error(msg);
  }

  async function postAndMaybeError(url, payload, accept){
    const res = await fetch(url, {
      method:"POST",
      headers:{ "Content-Type":"application/json", "Accept": accept || "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) await handleCommonErrors(res);
    return res;
  }

  function gatherContext(form){
    const name = [form.firstName?.value, form.lastName?.value].filter(Boolean).join(" ").trim();
    const baseTone = (form.tone?.value || "professional").trim();
    const toneAugmented = `${baseTone}; human-like and natural; concise; maximum 3 short paragraphs`;
    const draft = (form.querySelector('textarea[name="body"]')?.value || "").trim();

    return {
      name,
      contact: form.contact?.value || "",
      company: form.company?.value || "",
      role:    form.role?.value || "",
      jobUrl:  form.jobUrl?.value || "",
      tone:    toneAugmented,
      sender: {
        name,
        address1: form.senderAddress1?.value || "",
        city:     form.senderCity?.value || "",
        postcode: form.senderPostcode?.value || "",
        email:    form.senderEmail?.value || "",
        phone:    form.senderPhone?.value || "",
        date:     form.letterDate?.value || new Date().toISOString().slice(0,10)
      },
      recipient: {
        name:     form.recipient?.value || "Hiring Manager",
        company:  form.company?.value || "",
        address1: form.companyAddress1?.value || "",
        city:     form.companyCity?.value || "",
        postcode: form.companyPostcode?.value || ""
      },
      cover_body: draft
    };
  }

  // Preview (HTML in iframe)
  async function previewLetter(payload){
    const wrap  = document.getElementById("clPreviewWrap");
    const frame = document.getElementById("clPreview");
    try{
      const res = await postAndMaybeError(
        "/build-cover-letter",
        { format:"html", letter_only:true, ...payload },
        "text/html,application/json"
      );
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("text/html")) throw new Error("Unexpected response.");
      const html = await res.text();

      if (wrap) wrap.style.display = "block";
      if (!frame) return;

      // Prepare and inject; bind load first
      frame.setAttribute("sandbox","allow-same-origin");
      frame.addEventListener("load", () => {
        try{
          const plan = (document.body.dataset.plan || "guest").toLowerCase();
          const isPaid = (plan === "standard" || plan === "premium");
          const isSuperadmin = document.body.dataset.superadmin === "1";
          const d = frame.contentDocument || frame.contentWindow?.document;
          const host = d?.body || d?.documentElement;
          if (!host) return;
          stripWatermarks(d);
          if (!isPaid && !isSuperadmin) {
            applyWM(host, "JOBCUS.COM", { size: 460, alpha: 0.16, angles: [-32, 32] });
            host.classList.add("nocopy");
          }
        }catch{}
      }, { once:true });

      frame.srcdoc = html;
    }catch(err){
      console.warn("Cover letter preview error:", err);
      window.showUpgradeBanner?.(err.message || "Preview failed.");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("clForm");

    // Preview button
    document.getElementById("cl-preview")?.addEventListener("click", async () => {
      if (!form) return;
      await previewLetter(gatherContext(form));
    });

    // Download button (PDF, gated on server)
    document.getElementById("cl-download")?.addEventListener("click", async () => {
      if (!form) return;
      const ctx = gatherContext(form);
      try{
        const res = await fetch("/build-cover-letter", {
          method:"POST",
          headers:{ "Content-Type":"application/json", "Accept":"application/pdf,application/json" },
          body: JSON.stringify({ format:"pdf", letter_only:true, ...ctx })
        });

        if (!res.ok){
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("application/json")){
            const j = await res.json().catch(()=>({}));
            if (res.status === 403 && j.error === "upgrade_required"){
              const url  = j.pricing_url || PRICING_URL;
              const html = j.message_html || `File downloads are available on Standard and Premium. <a href="${url}">Upgrade now →</a>`;
              window.upgradePrompt?.(html, url, 1200);
              return;
            }
            window.showUpgradeBanner?.(j.message || j.error || "Download failed.");
            return;
          }
          window.showUpgradeBanner?.("Download failed.");
          return;
        }

        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href = url; a.download = "cover-letter.pdf"; a.click();
        URL.revokeObjectURL(url);
      }catch(err){
        window.showUpgradeBanner?.(err.message || "Download failed.");
      }
    });
  });
})();
