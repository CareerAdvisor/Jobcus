// /static/js/cover-letter.js
(function(){
  "use strict";

  /* Always send cookies (SameSite=Lax) */
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };

  /* Tiny helpers */
  const PRICING_URL = (window.PRICING_URL || "/pricing");
  const qs  = (sel, root=document) => root.querySelector(sel);
  const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const escapeHtml = (s="") => String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");

  /* Watermark helpers (strip + apply fallback) */
  const EMAIL_RE=/@.+\./;
  const sanitizeWM = (t)=>(!t||EMAIL_RE.test(String(t)))?"JOBCUS.COM":String(t).trim();
  function stripWatermarks(root=document){
    if (typeof window.stripExistingWatermarks==="function"){ try{ window.stripExistingWatermarks(root); return; }catch{} }
    try{
      const doc = root.ownerDocument || root;
      if (doc && !doc.getElementById("wm-nuke-style")){
        const st = doc.createElement("style");
        st.id="wm-nuke-style";
        st.textContent="*{background-image:none!important}*::before,*::after{background-image:none!important;content:''!important}";
        (doc.head||doc.documentElement).appendChild(st);
      }
      (root.querySelectorAll?root.querySelectorAll("[data-watermark],[data-watermark-tile],.wm-tiled,[style*='background-image']"):[])
        .forEach(el=>{ el.removeAttribute?.("data-watermark"); el.removeAttribute?.("data-watermark-tile"); el.classList?.remove("wm-tiled"); if(el.style){ el.style.backgroundImage=""; el.style.backgroundSize=""; el.style.backgroundBlendMode=""; }});
    }catch{}
  }
  function applyWM(el, text="JOBCUS.COM", opts={ size:460, alpha:0.16, angles:[-32,32] }){
    text=sanitizeWM(text);
    if (!el || !text) return;
    if (typeof window.applyTiledWatermark==="function"){
      stripWatermarks(el);
      window.applyTiledWatermark(el, text, opts);
      return;
    }
    // minimal canvas tiler fallback
    stripWatermarks(el);
    const size = opts.size || 420;
    const angles = Array.isArray(opts.angles)&&opts.angles.length?opts.angles:[-32,32];
    function tile(t, angle, alpha=0.18){
      const c=document.createElement("canvas"); c.width=size; c.height=size;
      const ctx=c.getContext("2d"); ctx.clearRect(0,0,size,size);
      ctx.globalAlpha = (opts.alpha ?? alpha);
      ctx.translate(size/2,size/2); ctx.rotate((angle*Math.PI)/180);
      ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.font='bold 36px Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
      ctx.fillStyle="#000";
      const L=String(t).toUpperCase(); const gap=44;
      ctx.fillText(L, 0, -gap/2); ctx.fillText(L, 0, gap/2);
      return c.toDataURL("image/png");
    }
    const urls=angles.map(a=>tile(text,a));
    const sz=size+"px "+size+"px";
    el.classList.add("wm-tiled");
    el.style.backgroundImage=urls.map(u=>`url(${u})`).join(", ");
    el.style.backgroundSize=urls.map(()=>sz).join(", ");
    el.style.backgroundBlendMode="multiply, multiply";
    el.style.backgroundRepeat="repeat";
  }

  /* Error handling (auth/upgrade first) */
  async function handleCommonErrors(res){
    if (res.ok) return null;
    const ct=(res.headers.get("content-type")||"").toLowerCase();
    let j=null, t="";
    try{ if(ct.includes("application/json")) j=await res.json(); else t=await res.text(); }catch{}
    // Upgrade / quota
    if(res.status===402 || (j && (j.error==="upgrade_required"||j.error==="quota_exceeded"))){
      const url=j?.pricing_url || PRICING_URL;
      const html=j?.message_html || `You’ve reached your plan limit. <a href="${url}">Upgrade now →</a>`;
      window.upgradePrompt?.(html, url, 1200);
      throw new Error(j?.message || "Upgrade required");
    }
    // Auth
    if(res.status===401 || res.status===403){
      const msg=j?.message || "Please sign up or log in to use this feature.";
      window.showUpgradeBanner?.(msg);
      setTimeout(()=>{ window.location.href="/account?mode=login"; }, 800);
      throw new Error(msg);
    }
    // Abuse
    if(res.status===429 && j && (j.error==="too_many_free_accounts"||j.error==="device_limit")){
      const msg=j?.message || "Too many free accounts detected from your network/device.";
      window.showUpgradeBanner?.(msg); throw new Error(msg);
    }
    const msg=(j && (j.message||j.error)) || t || `Request failed (${res.status})`;
    window.showUpgradeBanner?.(msg); throw new Error(msg);
  }
  async function postJSON(url, payload, accept="application/json"){
    const res=await fetch(url,{ method:"POST", headers:{ "Content-Type":"application/json","Accept":accept }, body:JSON.stringify(payload) });
    if(!res.ok) await handleCommonErrors(res);
    return res;
  }

  /* Gather + sanitize */
  function sanitizeDraft(text){
    if(!text) return "";
    let t=String(text).trim();
    t=t.replace(/^dear[^\n]*\n(\s*\n)*/i,"");
    t=t.replace(/\n+\s*(yours\s+sincerely|sincerely|kind\s+regards|best\s+regards|regards)[\s\S]*$/i,"");
    t=t.replace(/\r/g,"").replace(/\n{3,}/g,"\n\n").trim();
    const paras=t.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
    return paras.slice(0,3).join("\n\n").trim();
  }
  function gather(form){
    const name=[form.firstName?.value, form.lastName?.value].filter(Boolean).join(" ").trim();
    const baseTone=(form.tone?.value||"professional").trim();
    const toneAug=`${baseTone}; human-like and natural; concise; maximum 3 short paragraphs`;

    // if user hasn’t typed, try AI box text
    const ta=form?.querySelector('textarea[name="body"]');
    let draft=ta?.value || qs("#ai-cl .ai-text")?.textContent || "";
    draft=sanitizeDraft(draft);

    return {
      name,
      contact:"",
      company:form.company?.value || "",
      role:form.role?.value || "",
      jobUrl:form.jobUrl?.value || "",
      tone:toneAug,
      sender:{
        name,
        address1:form.senderAddress1?.value || "",
        city:form.senderCity?.value || "",
        postcode:form.senderPostcode?.value || "",
        email:form.senderEmail?.value || "",
        phone:form.senderPhone?.value || "",
        date:form.letterDate?.value || new Date().toISOString().slice(0,10)
      },
      recipient:{
        name:form.recipient?.value || "Hiring Manager",
        company:form.company?.value || "",
        address1:form.companyAddress1?.value || "",
        city:form.companyCity?.value || "",
        postcode:form.companyPostcode?.value || ""
      },
      coverLetter:{
        manager:form.recipient?.value || "Hiring Manager",
        company:form.company?.value || "",
        role:form.role?.value || "",
        jobUrl:form.jobUrl?.value || "",
        tone:toneAug,
        draft
      },
      cover_body:draft
    };
  }

  /* AI helpers */
  function gatherAI(form){
    const get=n=>(form?.elements?.[n]?.value||"").trim();
    return {
      tone: get("tone") || "professional",
      job_url: get("jobUrl"),
      sender: {
        first_name: get("firstName"),
        last_name:  get("lastName"),
        email:      get("senderEmail"),
        phone:      get("senderPhone"),
        address1:   get("senderAddress1"),
        city:       get("senderCity"),
        postcode:   get("senderPostcode"),
        date:       get("letterDate"),
      },
      recipient: {
        name:    get("recipient") || "Hiring Manager",
        company: get("company"),
        address1:get("companyAddress1"),
        city:    get("companyCity"),
        postcode:get("companyPostcode"),
        role:    get("role"),
      }
    };
  }
  async function aiSuggestCoverLetter(ctx){
    const res=await postJSON("/ai/cover-letter", ctx, "application/json");
    const j=await res.json().catch(()=>({}));
    if(!j?.draft) throw new Error("AI didn’t return a draft.");
    return sanitizeDraft(j.draft);
  }

  /* Preview builder */
  async function previewLetter(payload){
    const wrap=qs("#clPreviewWrap");
    const frame=qs("#clPreview");
    // request HTML
    const res=await postJSON("/build-cover-letter", { format:"html", letter_only:true, ...payload }, "text/html,application/json");
    const ct=res.headers.get("content-type")||"";
    if(!ct.includes("text/html")) throw new Error("Unexpected response.");
    const html=await res.text();

    wrap.style.display="block";
    // bind load before setting
    frame.addEventListener("load", ()=>{
      try{
        const plan=(document.body.dataset.plan||"guest").toLowerCase();
        const isPaid=(plan==="standard"||plan==="premium");
        const isSuper=document.body.dataset.superadmin==="1";
        const d = frame.contentDocument || frame.contentWindow?.document;
        const host = d?.body || d?.documentElement;
        if(!host) return;
        stripWatermarks(d);
        if(!isPaid && !isSuper){
          applyWM(host,"JOBCUS.COM",{ size:460, alpha:0.16, angles:[-32,32] });
          host.classList.add("nocopy");
        }
      }catch{}
      // show overlay watermark only after content is ready (if you use ::after style)
      const wm = wrap?.dataset?.watermark;
      if (wm) wrap.classList.add("wm-active");
    }, { once:true });
    frame.setAttribute("sandbox","allow-same-origin");
    frame.srcdoc = html;
  }

  /* Download (gated via server) */
  async function downloadPDF(payload){
    const res=await fetch("/build-cover-letter",{
      method:"POST",
      headers:{ "Content-Type":"application/json", "Accept":"application/pdf,application/json" },
      body:JSON.stringify({ format:"pdf", letter_only:true, ...payload })
    });
    if(!res.ok){
      const ct=res.headers.get("content-type")||"";
      if(ct.includes("application/json")){
        const j=await res.json().catch(()=>({}));
        if(res.status===403 && j.error==="upgrade_required"){
          const url=j.pricing_url || PRICING_URL;
          const html=j.message_html || `File downloads are available on Standard and Premium. <a href="${url}">Upgrade now →</a>`;
          window.upgradePrompt?.(html,url,1200);
          return;
        }
        window.showUpgradeBanner?.(j.message || j.error || "Download failed.");
        return;
      }
      window.showUpgradeBanner?.("Download failed.");
      return;
    }
    const blob=await res.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download="cover-letter.pdf"; a.click();
    URL.revokeObjectURL(url);
  }

  /* Wizard */
  function initWizard(){
    const steps=qsa(".rb-step");
    let idx=Math.max(0, steps.findIndex(s=>s.classList.contains("active")));
    if(idx<0) idx=0;

    const back=qs("#cl-back");
    const next=qs("#cl-next");

    function show(i){
      idx=Math.max(0, Math.min(i, steps.length-1));
      steps.forEach((s,k)=>{
        const active=(k===idx);
        s.classList.toggle("active", active);
        s.hidden = !active;
      });
      back.disabled = (idx===0);
      next.textContent = (idx===steps.length-1) ? "Finish" : "Next →";
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    // initial state
    steps.forEach((s,k)=>{ if(k!==idx){ s.hidden=true; s.classList.remove("active"); }});
    steps[idx].hidden=false; steps[idx].classList.add("active");
    back.disabled=true;

    back.addEventListener("click", ()=> show(idx-1));
    next.addEventListener("click", ()=>{
      if (idx < steps.length-1) show(idx+1);
      else show(idx); // last step stays
    });

    return { showIndex: show, get index(){return idx;} };
  }

  /* Boot */
  document.addEventListener("DOMContentLoaded", ()=>{
    const form = qs("#clForm");
    const wizard = initWizard();

    // AI handlers
    const aiCard = qs("#ai-cl");
    const btnRefresh = qs("#ai-refresh");
    const btnAdd = qs("#ai-add");
    const aiTextEl = ()=> qs(".ai-text", aiCard);

    btnRefresh?.addEventListener("click", async ()=>{
      try{
        btnRefresh.disabled=true;
        const el=aiTextEl(); if(el) el.textContent="Thinking…";
        const draft=await aiSuggestCoverLetter(gatherAI(form));
        if(el) el.textContent=draft || "No draft yet.";
      }catch(err){
        const el=aiTextEl(); if(el) el.textContent = err?.message || "AI failed.";
      }finally{
        btnRefresh.disabled=false;
      }
    });

    btnAdd?.addEventListener("click", ()=>{
      const el=aiTextEl(); const draft=el?el.textContent.trim():"";
      const ta=qs('textarea[name="body"]', form);
      if (draft && ta){
        ta.value = sanitizeDraft(draft);
        ta.dispatchEvent(new Event("input", { bubbles:true }));
      }
    });

    // Preview
    qs("#cl-preview")?.addEventListener("click", async ()=>{
      try{ await previewLetter(gather(form)); }catch(e){ console.warn(e); }
    });

    // Download
    qs("#cl-download")?.addEventListener("click", async ()=>{
      try{ await downloadPDF(gather(form)); }catch(e){ console.warn(e); }
    });
  });
})();
