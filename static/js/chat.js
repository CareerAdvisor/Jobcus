// /static/js/chat.js

// ——— Safe global for inline onclick="insertSuggestion(...)" ———
window.insertSuggestion ||= function (text) {
  const el = document.getElementById('userInput');
  if (!el) return;
  el.value = text;
  el.focus();
  window.autoResize?.(el);
};

// ──────────────────────────────────────────────────────────────
// Ensure cookies (SameSite/Lax) are sent on all fetches
// ──────────────────────────────────────────────────────────────
(function(){
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!("credentials" in init)) init.credentials = "same-origin";
    return _fetch(input, init);
  };
})();

// ──────────────────────────────────────────────────────────────
/** Small utilities (also exposed on window for inline handlers) */
// ──────────────────────────────────────────────────────────────
function removeWelcome() {
  const banner = document.getElementById("welcomeBanner");
  if (banner) banner.remove();
}
function insertSuggestion(text) {
  const input = document.getElementById("userInput");
  if (!input) return;
  input.value = text;
  input.focus();
  window.autoResize?.(input);
}
function autoResize(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}
function sharePage() {
  navigator.clipboard.writeText(window.location.href);
  alert("Link copied!");
}

// --- Attachments (front-end tray & upload trigger) ---
let _attachments = []; // [{filename, size, text}]
function renderAttachmentTray() {
  let tray = document.getElementById("attachTray");
  if (!_attachments.length) {
    if (tray) tray.remove();
    return;
  }
  if (!tray) {
    tray = document.createElement("div");
    tray.id = "attachTray";
    tray.className = "attach-tray";
    tray.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;";
    const composer = document.querySelector(".composer") || document.getElementById("chat-form");
    composer?.parentNode?.insertBefore(tray, composer);
  }
  tray.innerHTML = _attachments.map((att, i) => `
    <span class="attach-chip" style="display:inline-flex;align-items:center;gap:6px;background:#f1f5ff;border:1px solid #dbe6ff;border-radius:9999px;padding:6px 10px;font-size:12px">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 13l5-5 5 5" fill="none" stroke="#104879" stroke-width="2"/></svg>
      <span title="${att.filename}">${att.filename.length>26?att.filename.slice(0,23)+'…':att.filename}</span>
      <button type="button" aria-label="Remove" onclick="removeAttachment(${i})" style="border:0;background:transparent;color:#104879;font-weight:700;cursor:pointer">×</button>
    </span>
  `).join("");
  updateScrollButtonVisibility?.();
}
window.removeAttachment = function(i){
  _attachments.splice(i,1);
  renderAttachmentTray();
};
function ensureUploadInput() {
  if (document.getElementById("chatUpload")) return;
  const inp = document.createElement("input");
  inp.type = "file";
  inp.id = "chatUpload";
  inp.accept = ".pdf,.doc,.docx,.txt,.rtf";
  inp.multiple = true;
  inp.style.display = "none";
  inp.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    for (const f of files) {
      await uploadOneFile(f);
    }
    e.target.value = "";
  });
  document.body.appendChild(inp);
}
window.handleAttach = function(){
  ensureUploadInput();
  document.getElementById("chatUpload").click();
};
async function uploadOneFile(file) {
  const maxBytes = 5 * 1024 * 1024; // 5 MB
  const allowed = /\.(pdf|docx?|txt|rtf)$/i.test(file.name);
  if (!allowed) { alert("Please upload PDF, DOC, DOCX, TXT, or RTF."); return; }
  if (file.size > maxBytes) { alert("Max file size is 5 MB."); return; }

  _attachments.push({ filename: file.name, size: file.size, text: "Uploading…" });
  renderAttachmentTray();

  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    const data = await res.json(); // { filename, size, text }
    const idx = _attachments.findIndex(a => a.filename === file.name && a.text === "Uploading…");
    if (idx >= 0) _attachments[idx] = { filename: data.filename || file.name, size: data.size || file.size, text: data.text || "" };
    renderAttachmentTray();
  } catch (e) {
    const idx = _attachments.findIndex(a => a.filename === file.name && a.text === "Uploading…");
    if (idx >= 0) _attachments[idx].text = "(upload failed)";
    renderAttachmentTray();
    alert(`Could not upload ${file.name}.`);
  }
}

function handleMic()   { alert("Voice input coming soon!"); }

function copyToClipboard(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = el.innerText;
  navigator.clipboard.writeText(text).then(() => {
    const wrapper = el.parentElement.querySelector(".copy-wrapper");
    if (!wrapper) return;
    wrapper.innerHTML = `<span class="copied-msg">Copied!</span>`;
    setTimeout(() => {
      wrapper.innerHTML = `
        <img src="/static/icons/copy.svg" class="copy-icon" title="Copy" onclick="copyToClipboard('${id}')">
        <span class="copy-text">Copy</span>
      `;
    }, 1500);
  });
}

function scrollToAI(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// NEW: always snap the chat view to the latest message (instant)
function scrollToBottom() {
  const box = document.getElementById("chatbox");
  if (!box) return;
  box.scrollTop = box.scrollHeight;
  updateScrollButtonVisibility?.();
}
function scrollToBottomSmooth() {
  const box = document.getElementById("chatbox");
  if (!box) return;
  box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  setTimeout(() => updateScrollButtonVisibility?.(), 250);
}

// Minimal helpers your old code referenced
function showUpgradeBanner(msg) {
  let b = document.getElementById("upgradeBanner");
  if (!b) {
    b = document.createElement("div");
    b.id = "upgradeBanner";
    b.style.cssText = "background:#fff3cd;color:#856404;border:1px solid #ffeeba;padding:10px 12px;border-radius:6px;margin:8px 0;font-size:14px;";
    const box = document.querySelector(".chat-main") || document.body;
    box.insertBefore(b, box.firstChild);
  }
  b.textContent = msg || "You’ve reached your plan limit.";
}
function disableComposer(disabled) {
  const input = document.getElementById("userInput");
  const sendBtn = document.getElementById("sendButton");
  if (input)  input.disabled  = !!disabled;
  if (sendBtn) sendBtn.style.opacity = disabled ? "0.5" : "";
}

// ──────────────────────────────────────────────────────────────
// Feature intent router → on-site links
// ──────────────────────────────────────────────────────────────
const FEATURE_LINKS = {
  "resume-analyzer": { url: "/resume-analyzer", label: "Resume Analyzer" },
  "resume-builder":  { url: "/resume-builder",  label: "Resume Builder"  },
  "cover-letter":    { url: "/cover-letter",    label: "Cover Letter"    },
  "interview-coach": { url: "/interview-coach", label: "Interview Coach (Jeni)" },
  "skill-gap":       { url: "/skill-gap",       label: "Skill Gap Analyzer" },
  "job-insights":    { url: "/job-insights",    label: "Job Insights" },
  "employers":       { url: "/employers",       label: "Employer Tools" },
  "pricing":         { url: "/pricing",         label: "Pricing" }
};

function detectFeatureIntent(message) {
  const m = String(message || "").toLowerCase();

  if (/\b(analy[sz]e|scan|score|optimi[sz]e).*\bresume\b|\bresume\b.*\b(analy[sz]er|score|ats|keywords?)\b/.test(m))
    return { primary: "resume-analyzer", alts: ["resume-builder", "cover-letter", "skill-gap"] };

  if (/\b(build|create|write|make).*\bresume\b|\bresume builder\b/.test(m))
    return { primary: "resume-builder", alts: ["resume-analyzer", "cover-letter", "job-insights"] };

  if (/\bcover letter|write.*cover.?letter|generate.*cover.?letter\b/.test(m))
    return { primary: "cover-letter", alts: ["resume-analyzer", "resume-builder", "job-insights"] };

  if (/\b(interview|practice|mock|jeni|questions?).*\b(prepare|coach|help|practice|simulate)?\b/.test(m))
    return { primary: "interview-coach", alts: ["resume-analyzer", "cover-letter", "job-insights"] };

  if (/\b(skill gap|gap analysis|what skills|missing skills|upskilling|transition)\b/.test(m))
    return { primary: "skill-gap", alts: ["resume-analyzer", "job-insights", "cover-letter"] };

  if (/\b(job insights?|market|salary|salaries|demand|trends?|benchmark)\b/.test(m))
    return { primary: "job-insights", alts: ["resume-analyzer", "skill-gap", "cover-letter"] };

  if (/\b(employer|recruiter|post(ing)?|job description|jd generator)\b/.test(m))
    return { primary: "employers", alts: ["pricing"] };

  return null;
}

function renderFeatureSuggestions(intent, intoEl) {
  if (!intent || !intoEl) return;
  const primary = FEATURE_LINKS[intent.primary];
  const alts = (intent.alts || []).map(k => FEATURE_LINKS[k]).filter(Boolean);

  const wrap = document.createElement("div");
  wrap.className = "feature-suggest";
  wrap.innerHTML = `
    <div class="feature-suggest-head">Top recommendation</div>
    <a class="feature-suggest-primary" href="${primary.url}">
      <span>Open ${primary.label}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17l7-7v6h2V7h-9v2h6l-7 7z" fill="currentColor"/></svg>
    </a>
    ${alts.length ? `
      <div class="feature-suggest-alt-head">Other helpful tools</div>
      <div class="feature-suggest-alts">
        ${alts.map(a => `<a href="${a.url}">${a.label}</a>`).join("")}
      </div>` : ""}
    <hr class="response-separator" />
  `;
  intoEl.appendChild(wrap);
}

/* 🚫 Auto-redirect disabled: keep users on /chat, just show links */
function maybeAutoRedirect(){ return false; }

/* Helper: remove only the spinner/thinking line */
function removeThinking(el){
  try { el?.querySelectorAll(".ai-thinking")?.forEach(n => n.remove()); } catch {}
}

/* Helper: append an assistant answer block (do NOT replace suggestions) */
function appendAssistantAnswer(aiBlock, markdownText){
  const copyId = `ai-${Date.now()}`;
  const outWrap = document.createElement("div");
  outWrap.innerHTML = `
    <div id="${copyId}" class="markdown"></div>
    <div class="response-footer">
      <span class="copy-wrapper">
        <img src="/static/icons/copy.svg" class="copy-icon" title="Copy" onclick="copyToClipboard('${copyId}')">
        <span class="copy-text">Copy</span>
      </span>
    </div>
    <hr class="response-separator" />
  `;
  aiBlock.appendChild(outWrap);
  const targetDiv = outWrap.querySelector("#" + CSS.escape(copyId));

  // typewriter feel
  let i = 0, buffer = "";
  (function typeWriter() {
    if (i < markdownText.length) {
      buffer += markdownText[i++];
      targetDiv.textContent = buffer;
      scrollToAI(aiBlock);
      scrollToBottom();
      setTimeout(typeWriter, 5);
    } else {
      if (window.marked?.parse) targetDiv.innerHTML = window.marked.parse(buffer);
      else targetDiv.textContent = buffer;
      scrollToAI(aiBlock);
      scrollToBottom();
      maybeShowScrollIcon();
    }
  })();

  return { id: copyId, node: outWrap };
}

/* Compose a concise site-aware reply for feature intents */
function composeFeatureReply(intent) {
  if (!intent) return null;
  const primary = FEATURE_LINKS[intent.primary];
  const alts    = (intent.alts || []).map(k => FEATURE_LINKS[k]).filter(Boolean);

  let msg = `**Yes — I can help with that.** You can use **${primary.label}** here: [${primary.url}](${primary.url}).`;
  if (alts.length) {
    const links = alts.map(a => `[${a.label}](${a.url})`).join(", ");
    msg += `\n\nYou might also like: ${links}.`;
  }
  return msg;
}

// ──────────────────────────────────────────────────────────────
// Directory intent: curated lists with outbound links
// ──────────────────────────────────────────────────────────────
const RESUME_ANALYZERS = [
  { name: "Resume Worded", url: "https://resumeworded.com", blurb: "AI feedback on resume & LinkedIn; “Score My Resume”." },
  { name: "Jobscan", url: "https://www.jobscan.co", blurb: "ATS resume checker + optimization for specific postings." },
  { name: "Enhancv Resume Checker", url: "https://enhancv.com/tools/resume-checker/", blurb: "Free checks across key resume criteria." },
  { name: "Zety ATS Resume Checker", url: "https://zety.com/resume-checker", blurb: "Personalized score + actionable tips." },
  { name: "ResumeGo", url: "https://www.resumego.net/resume-checker/", blurb: "Free scanner for potential ATS pitfalls." },
  { name: "Hiration", url: "https://www.hiration.com", blurb: "AI-powered detailed resume review." },
  { name: "ResyMatch (Cultivated Culture)", url: "https://resymatch.io", blurb: "Free ATS scanner + JD matching tool." },
  { name: "SkillSyncer", url: "https://www.skillsyncer.com", blurb: "Scanner/optimizer against job descriptions." },
  { name: "LiveCareer ATS Checker", url: "https://www.livecareer.com/resume-check", blurb: "Checks formatting, customization, design." },
  { name: "Mployee / ResuScan", url: "https://mployee.me", blurb: "Online ATS checks over many criteria." }
];

const RESUME_BUILDERS = [
  { name: "Novorésumé", url: "https://novoresume.com", blurb: "Recruiter-designed templates, modern layouts." },
  { name: "ResumeBuilder.com", url: "https://www.resumebuilder.com", blurb: "Large template library, ATS-friendly." },
  { name: "Canva (Resume maker)", url: "https://www.canva.com/resumes/templates/", blurb: "Drag-and-drop designs, many templates." },
  { name: "Kickresume", url: "https://www.kickresume.com", blurb: "Builder + AI checker/score." },
  { name: "Huntr", url: "https://huntr.co", blurb: "Builder + job tracking + cover letters." },
  { name: "Resume.org", url: "https://resume.org", blurb: "Free resume templates & tools." },
  { name: "Enhancv", url: "https://enhancv.com", blurb: "Builder with AI suggestions." }
];

// Robust detector for "give me many sites / list / majority" style asks
function detectDirectoryIntent(raw) {
  const m = String(raw || "").toLowerCase();
  const asksForList =
    /\b(list|give me|show me|suggest|recommend|some|many|majority|a lot|best|top|websites?|sites?)\b/.test(m);
  const mentionsAnalysis = /\b(resume|cv)\b.*\b(analy(ze|sis|zer)|checker|ats|review|score|scanner)\b/.test(m);
  const mentionsBuilder  = /\b(resume|cv)\b.*\b(builder|build|create|maker|template|templates)\b/.test(m);
  if (!asksForList) return null;
  if (mentionsAnalysis || mentionsBuilder) {
    return { wantAnalysis: mentionsAnalysis, wantBuilders: mentionsBuilder };
  }
  return null;
}

function renderDirectoryResponse(intent, aiBlock) {
  const wrap = document.createElement("div");
  wrap.className = "directory-answer";
  wrap.style.marginTop = "8px";

  const cardCss = `
    .dir-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin:10px 0 4px}
    .dir-card{border:1px solid #e6ecf5;border-radius:12px;padding:12px;background:#fff}
    .dir-card a{font-weight:600;color:#104879;text-decoration:underline}
    .dir-sub{color:#2a3f55;font-size:13px;margin-top:4px}
  `;
  if (!document.getElementById("directoryStyles")) {
    const st = document.createElement("style");
    st.id = "directoryStyles";
    st.textContent = cardCss;
    document.head.appendChild(st);
  }

  // Header + on-site CTA
  let html = `
    <div class="ai-note" style="background:#f7fbff;border:1px solid #d8e7ff;color:#104879;padding:12px;border-radius:10px;margin-bottom:10px">
      Prefer using Jobcus? Try our on-site tools:
      <a href="/resume-analyzer">Resume Analyzer</a>,
      <a href="/resume-builder">Resume Builder</a>,
      <a href="/cover-letter">Cover Letter</a>.
    </div>
  `;

  // Section: analyzers
  if (intent.wantAnalysis) {
    html += `<h3 style="margin:6px 0 4px">Resume-analysis / ATS check tools</h3>
             <div class="dir-grid">
               ${RESUME_ANALYZERS.map(t => `
                 <div class="dir-card">
                   <a href="${t.url}" target="_blank" rel="noopener noreferrer">${t.name}</a>
                   <div class="dir-sub">${t.blurb}</div>
                 </div>`).join("")}
             </div>`;
  }
  // Section: builders
  if (intent.wantBuilders) {
    html += `<h3 style="margin:10px 0 4px">Resume builders</h3>
             <div class="dir-grid">
               ${RESUME_BUILDERS.map(t => `
                 <div class="dir-card">
                   <a href="${t.url}" target="_blank" rel="noopener noreferrer">${t.name}</a>
                   <div class="dir-sub">${t.blurb}</div>
                 </div>`).join("")}
             </div>`;
  }

  wrap.innerHTML = html + `<hr class="response-separator" />`;
  aiBlock.appendChild(wrap);

  // Save a short message to history (so your sidebar has a label)
  const label = [
    intent.wantAnalysis ? "Resume analysis tools" : null,
    intent.wantBuilders ? "Resume builders" : null
  ].filter(Boolean).join(" + ");
  window.saveMessage?.("assistant", `Here are popular ${label} (with links).`);

  scrollToAI(aiBlock);
  scrollToBottom();
}

// ──────────────────────────────────────────────────────────────
// chat-only plan-limit detector using global upgrade UI
// ──────────────────────────────────────────────────────────────
function handleChatLimitError(err) {
  const msg = String(err && err.message || "");
  const isLimit =
    /Request failed 402/.test(msg) ||
    /upgrade_required/.test(msg) ||
    /quota_exceeded/.test(msg);

  if (isLimit) {
    const copy = "You’ve reached your plan limit. Upgrade to continue.";
    if (typeof window.upgradePrompt === "function") {
      window.upgradePrompt(copy, (window.PRICING_URL || "/pricing"), 1200);
    } else if (typeof window.showUpgradeBanner === "function") {
      window.showUpgradeBanner(copy);
      setTimeout(() => { window.location.href = (window.PRICING_URL || "/pricing"); }, 1200);
    }
    err.kind = "limit";
    err.message = copy;
    return true;
  }
  return false;
}

// Expose functions used by inline HTML handlers
window.insertSuggestion = insertSuggestion;
window.copyToClipboard  = copyToClipboard;
window.autoResize       = autoResize;
window.sharePage        = sharePage;
window.handleMic        = handleMic;
window.removeWelcome    = removeWelcome;

// ──────────────────────────────────────────────────────────────
// Lightweight status bar shown above the input while AI works
// ──────────────────────────────────────────────────────────────
function showAIStatus(text = "Thinking…") {
  let bar = document.getElementById("aiStatusBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "aiStatusBar";
    bar.style.cssText = `
      position: sticky; bottom: 0; left: 0; right: 0;
      display: flex; align-items: center; gap: 8px;
      background: #f7fbff; border: 1px solid #d8e7ff;
      color: #104879; padding: 10px 12px; border-radius: 10px;
      margin: 8px 0 0; font-size: 14px; z-index: 5;
    `;
    const container = document.querySelector(".composer") || document.querySelector(".chat-footer") || document.body;
    container.parentNode.insertBefore(bar, container);
  }
  bar.innerHTML = `
    <span class="ai-spinner" aria-hidden="true"></span>
    <strong>${text}</strong>
  `;
  bar.style.display = "flex";
}
function hideAIStatus() {
  const bar = document.getElementById("aiStatusBar");
  if (bar) bar.style.display = "none";
}

/* Append-only thinking placeholder */
function renderThinkingPlaceholder(targetEl, label = "Thinking…") {
  if (!targetEl) return;
  const node = document.createElement("div");
  node.className = "ai-thinking";
  node.innerHTML = `
    <span class="ai-spinner" aria-hidden="true"></span>
    <span>${label}</span>
  `;
  targetEl.appendChild(node);
}

// ──────────────────────────────────────────────────────────────
// Model controls
// ──────────────────────────────────────────────────────────────
function initModelControls() {
  const shell = document.getElementById("chatShell");
  const modelSelect = document.getElementById("modelSelect");
  const modelBadge  = document.getElementById("modelBadge");
  const headerModel = document.getElementById("headerModel");

  const isPaid = (shell?.dataset.isPaid === "1");
  const defaultModel = shell?.dataset.defaultModel || "gpt-4o-mini";
  const freeModel    = shell?.dataset.freeModel    || "gpt-4o-mini";
  const allowedModels = (shell?.dataset.allowedModels || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  function getSelectedModel(){
    if (!isPaid) return freeModel || defaultModel;
    const saved = localStorage.getItem("chatModel");
    if (saved && allowedModels.includes(saved)) return saved;
    if (modelSelect && allowedModels.includes(modelSelect.value)) return modelSelect.value;
    return defaultModel;
  }

  function setSelectedModel(m){
    if (modelSelect && allowedModels.includes(m)) modelSelect.value = m;
    if (modelBadge)  modelBadge.textContent  = m;
    if (headerModel) headerModel.textContent = m;
    if (isPaid) localStorage.setItem("chatModel", m);
  }

  // Initialize UI
  setSelectedModel(getSelectedModel());
  if (isPaid && modelSelect) {
    modelSelect.addEventListener("change", () => setSelectedModel(modelSelect.value));
  }

  return { getSelectedModel, setSelectedModel, isPaid, allowedModels };
}

// ──────────────────────────────────────────────────────────────
/** Server call helper (POST to /api/ask and return JSON) */
async function sendMessageToAPI(payload) {
  return apiFetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }); // expected: { reply, modelUsed }
}

// ──────────────────────────────────────────────────────────────
// Detect if a message is about job search (natural language)
// ──────────────────────────────────────────────────────────────
function detectJobsIntent(raw) {
  if (!raw) return null;
  const message = String(raw).toLowerCase().trim();

  if (/\b(advice|tips?|strategy|strategies|how to|guide|best practices?)\b/.test(message)) {
    return null;
  }

  const wantsListings =
    /\b(openings?|vacancies|list(?:ing)?s?|show (me )?jobs?|find (me )?jobs?|roles? available|positions? available)\b/.test(message) ||
    /^\s*jobs?:/i.test(message);

  if (!wantsListings) return null;

  const inLoc = /\b(in|near|around|at)\s+([a-z0-9\s\-,.'\/]+)/i;
  const remote = /\b(remote|work from home|hybrid)\b/i;

  let role = message
    .replace(/^\s*jobs?:/i, "")
    .replace(/\b(openings?|vacancies|show (me )?jobs?|find (me )?jobs?)\b/g, "")
    .replace(inLoc, "")
    .replace(/\b(remote|work from home|hybrid)\b/g, "")
    .replace(/\b(job|jobs|role|roles|position|positions)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  let location = null;
  const m = message.match(inLoc);
  if (m && m[2]) location = m[2].trim();
  else if (remote.test(message)) location = "remote";

  let queries = [];
  if (location) queries = [[role, location].filter(Boolean).join(" ").trim()];
  else if (role) queries = [role];

  return queries.length ? { query: queries.join(" | "), queries, role: role || null, location } : null;
}

// ──────────────────────────────────────────────────────────────
// Scroll-to-bottom button (centered above composer)
// ──────────────────────────────────────────────────────────────
function ensureScrollButtonStyles() {
  if (document.getElementById("scrollToBottomStyles")) return;
  const st = document.createElement("style");
  st.id = "scrollToBottomStyles";
  st.textContent = `
    #scrollDown{
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      bottom: 96px;
      display: none;
      align-items: center;
      gap: 8px;
      background: #104879;
      color: #fff;
      border: 0;
      border-radius: 9999px;
      padding: 10px 14px;
      font-size: 14px;
      box-shadow: 0 6px 16px rgba(0,0,0,.18);
      cursor: pointer;
      z-index: 30;
    }
    #scrollDown:hover { filter: brightness(1.05); }
    #scrollDown svg { display:inline-block; }
  `;
  document.head.appendChild(st);
}
function ensureScrollButton() {
  ensureScrollButtonStyles();
  if (document.getElementById("scrollDown")) return;
  const btn = document.createElement("button");
  btn.id = "scrollDown";
  btn.type = "button";
  btn.setAttribute("aria-label", "Scroll to latest");
  btn.title = "Scroll to latest";
  btn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16l-6-6h12l-6 6z" fill="currentColor"/>
    </svg>
    <span>Scroll to latest</span>
  `;
  btn.addEventListener("click", scrollToBottomSmooth);
  document.body.appendChild(btn);
}
function updateScrollButtonVisibility() {
  const chatbox = document.getElementById("chatbox");
  const btn = document.getElementById("scrollDown");
  if (!chatbox || !btn) return;
  const overflow = chatbox.scrollHeight > chatbox.clientHeight + 8;
  const nearBottom = (chatbox.scrollHeight - chatbox.scrollTop - chatbox.clientHeight) < 32;
  btn.style.display = (overflow && !nearBottom) ? "inline-flex" : "none";
}
function maybeShowScrollIcon() { updateScrollButtonVisibility(); }

// ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Spinners CSS
  if (!document.getElementById("aiSpinnerStyles")) {
    const st = document.createElement("style");
    st.id = "aiSpinnerStyles";
    st.textContent = `
      .ai-spinner{width:16px;height:16px;border:2px solid rgba(16,72,121,.2);border-top-color:rgba(16,72,121,1);border-radius:50%;display:inline-block;animation:ai-spin .8s linear infinite}
      @keyframes ai-spin{to{transform:rotate(360deg)}}
      .ai-thinking{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#f6f9ff;border:1px solid #e1ecff;border-radius:10px;color:#104879;font-size:14px}
    `;
    document.head.appendChild(st);
  }

  // Create scroll-to-bottom button
  ensureScrollButton();

  // Init model UI/logic first
  const modelCtl = initModelControls();

  // 0) Server-backed conversation id (created on first send)
  let conversationId = localStorage.getItem("chat:conversationId") || null;

  // Storage keys
  const STORAGE = {
    current: "jobcus:chat:current",
    history: "jobcus:chat:history"
  };

  // DOM refs
  const chatbox = document.getElementById("chatbox");
  const form    = document.getElementById("chat-form");
  const input   = document.getElementById("userInput");

  // Keep textarea autosizing in sync
  input?.addEventListener("input", () => {
    window.autoResize?.(input);
    scrollToBottom();
  });
  window.autoResize?.(input);

  // Show/hide scroll-to-bottom based on scroll & size
  chatbox?.addEventListener("scroll", updateScrollButtonVisibility);
  window.addEventListener("resize", updateScrollButtonVisibility);
  new MutationObserver(() => updateScrollButtonVisibility())
    .observe(chatbox || document.body, { childList: true, subtree: true });

  const escapeHtml = (s='') => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const getCurrent = () => JSON.parse(localStorage.getItem(STORAGE.current) || "[]");
  const setCurrent = (arr) => localStorage.setItem(STORAGE.current, JSON.stringify(arr));
  const getHistory = () => JSON.parse(localStorage.getItem(STORAGE.history) || "[]");
  const setHistory = (arr) => localStorage.setItem(STORAGE.history, JSON.stringify(arr));

  function firstUserTitle(messages){
    const firstUser = messages.find(m => m.role === "user");
    const raw = (firstUser?.content || "Conversation").trim();
    return raw.length > 60 ? raw.slice(0,60) + "…" : raw;
  }

  function renderWelcome(){
    const shell = document.getElementById("chatShell");
    const fname = (shell?.dataset.firstName || "there");
    chatbox.innerHTML = `
      <div class="welcome" id="welcomeBanner">
        <p class="welcome-title">👋 Welcome ${escapeHtml(fname)}! How can I help you today?</p>
        <div class="suggestion-chips">
          <button type="button" onclick="insertSuggestion('How do I improve my resume?')" class="chip">Improve my resume</button>
          <button type="button" onclick="insertSuggestion('Interview tips for a UX role')" class="chip">Interview tips</button>
          <button type="button" onclick="insertSuggestion('Show me job market insights for London')" class="chip">Job insights</button>
        </div>
      </div>`;
    updateScrollButtonVisibility();
  }

  function renderChat(messages){
    chatbox.innerHTML = "";
    if (!messages.length){
      renderWelcome();
      scrollToBottom();
      return;
    }
    messages.forEach(msg => {
      const div = document.createElement("div");
      div.className = `chat-entry ${msg.role === "assistant" ? "ai-answer" : "user"}`;
      if (msg.role === "assistant") {
        const id = `ai-${Math.random().toString(36).slice(2)}`;
        div.innerHTML = `
          <div id="${id}" class="markdown"></div>
          <div class="response-footer">
            <span class="copy-wrapper">
              <img src="/static/icons/copy.svg" class="copy-icon"
                   title="Copy" onclick="copyToClipboard('${id}')">
              <span class="copy-text">Copy</span>
            </span>
          </div>
          <hr class="response-separator" />
        `;
        const target = div.querySelector(`#${id}`);
        if (window.marked && typeof window.marked.parse === "function") {
          target.innerHTML = window.marked.parse(msg.content);
        } else {
          target.textContent = msg.content;
        }
      } else {
        div.innerHTML = `
          <h2 style="font-size:1.5rem;font-weight:600;margin:0 0 .5rem;color:#104879;">
            ${escapeHtml(msg.content)}
          </h2>
        `;
      }
      chatbox.appendChild(div);
    });
    scrollToBottom();
    updateScrollButtonVisibility();
  }

  function renderHistory(){
    const list = document.getElementById("chatHistory");
    if (!list) return;
    const hist = getHistory();
    list.innerHTML = "";
    hist.forEach(h => {
      const li = document.createElement("li");
      li.className = "history-item";
      li.innerHTML = `
        <span class="history-item-title" title="${escapeHtml(h.title)}">${escapeHtml(h.title)}</span>
        <button class="delete" aria-label="Delete">✕</button>
      `;
      li.addEventListener("click", (e) => {
        if (e.target.closest(".delete")) return;
        setCurrent(h.messages || []);
        renderChat(getCurrent());
        try { closeChatMenu?.(); } catch {}
      });
      li.querySelector(".delete").addEventListener("click", (e) => {
        e.stopPropagation();
        setHistory(getHistory().filter(x => x.id !== h.id));
        renderHistory();
      });
      list.appendChild(li);
    });
  }

  window.saveMessage = function(role, content){
    const msgs = getCurrent();
    msgs.push({ role, content });
    setCurrent(msgs);
  };

  let clearInProgress = false;
  window.clearChat = function(){
    if (clearInProgress) return;
    clearInProgress = true;
    try {
      const current = getCurrent();
      if (current.length){
        const hist = getHistory();
        const sig = JSON.stringify(current);
        const lastSig = hist.length ? JSON.stringify(hist[0].messages || []) : null;
        if (sig !== lastSig){
          hist.unshift({
            id: Date.now().toString(36),
            title: firstUserTitle(current),
            created: new Date().toISOString(),
            messages: current
          });
          setHistory(hist);
        }
      }
      setCurrent([]);
      localStorage.removeItem("chat:conversationId");
      conversationId = null;
      renderChat([]);
      renderHistory();
    } finally {
      setTimeout(() => { clearInProgress = false; }, 50);
    }
  };

  // 🔁 Server-truth credits panel (USED of MAX)
  async function refreshCreditsPanel() {
    const planEl  = document.getElementById("credits-plan");
    const leftEl  = document.getElementById("credits-left");
    const resetEl = document.getElementById("credits-reset");
    if (!planEl && !leftEl && !resetEl) return;

    try {
      const c = await apiFetch("/api/credits");
      const used = typeof c.used === "number" ? c.used : 0;
      const max  = typeof c.max  === "number" ? c.max  : 0;

      planEl  && (planEl.textContent  = (c.plan || "free").replace(/^\w/, s => s.toUpperCase()));
      leftEl  && (leftEl.textContent  = (max ? `${used} of ${max}` : "Unlimited"));

      const resets = { total: "Trial", week: "Resets weekly", month: "Resets monthly", year: "Resets yearly", day: "Resets daily", hour: "Resets hourly" };
      resetEl && (resetEl.textContent = resets[c.period_kind] || "");
    } catch (_) { /* no-op */ }
  }

  // Sidebar open/close
  const chatMenuToggle = document.getElementById("chatMenuToggle");
  const chatOverlay    = document.getElementById("chatOverlay");
  const chatCloseBtn   = document.getElementById("chatSidebarClose");

  chatMenuToggle?.addEventListener("click", window.openChatMenu);
  chatOverlay?.addEventListener("click", window.closeChatMenu);
  chatCloseBtn?.addEventListener("click", window.closeChatMenu);
  document.addEventListener("keydown", (e)=>{ if (e.key === "Escape") window.closeChatMenu?.(); });

  document.getElementById("newChatBtn")?.addEventListener("click", () => { clearChat(); window.closeChatMenu?.(); });
  document.getElementById("clearChatBtn")?.addEventListener("click", () => { clearChat(); window.closeChatMenu?.(); });

  renderChat(getCurrent());
  renderHistory();
  refreshCreditsPanel();
  updateScrollButtonVisibility();
  scrollToBottom();

  // ---- send handler ----
  const sendBtn = document.getElementById("sendButton");
  sendBtn?.addEventListener("click", () => {
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  form?.addEventListener("submit", async (evt) => {
    evt.preventDefault();

    const message = (input?.value || "").trim();
    if (!message) return;

    removeWelcome?.();

    const userMsg = document.createElement("div");
    userMsg.className = "chat-entry user";
    userMsg.innerHTML = `
      <h2 style="font-size:1.5rem;font-weight:600;margin:0 0 .5rem;color:#104879;">
        ${escapeHtml(message)}
      </h2>
    `;
    chatbox.appendChild(userMsg);
    scrollToBottom();

    saveMessage("user", message);

    if (input) {
      input.value = "";
      autoResize(input);
    }

    const aiBlock = document.createElement("div");
    aiBlock.className = "chat-entry ai-answer";
    chatbox.appendChild(aiBlock);

    // Intent suggestions (inline CTAs)
    const featureIntent = detectFeatureIntent(message);
    if (featureIntent) {
      renderFeatureSuggestions(featureIntent, aiBlock);
    }

    // Directory/list intent? Render our curated answer and stop.
    const dirIntent = detectDirectoryIntent(message);
    if (dirIntent) {
      renderDirectoryResponse(dirIntent, aiBlock);
      // Also append a short “site-aware” line so it feels conversational
      const composed = composeFeatureReply(featureIntent) ||
        "**Here’s a handy list of tools with links above.** If you want, I can narrow it by free options, AI-powered only, or UK-friendly pricing.";
      appendAssistantAnswer(aiBlock, composed);
      saveMessage("assistant", "Shared curated list of resume analyzers/builders with links.");
      _attachments = []; renderAttachmentTray();
      scrollToAI(aiBlock); scrollToBottom(); updateScrollButtonVisibility();
      return; // ✅ Skip calling the model for this specific directory ask
    }

    renderThinkingPlaceholder(aiBlock, "Thinking…");
    showAIStatus("Thinking…");
    scrollToAI(aiBlock);
    scrollToBottom();

    const currentModel = modelCtl.getSelectedModel();
    let finalReply = "";

    try {
      disableComposer(true);

      // Jobs quick-intent (natural language + "jobs:" shortcut)
      const jobIntent = detectJobsIntent(message) || (
        (/^\s*jobs?:/i.test(message) ? { query: message.replace(/^\s*jobs?:/i, "").trim() || message.trim() } : null)
      );

      if (jobIntent) {
        showAIStatus("Finding jobs…");

        let jobs;
        if (Array.isArray(jobIntent.queries) && jobIntent.queries.length > 1) {
          const results = await Promise.all(jobIntent.queries.map(q =>
            apiFetch("/jobs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query: q })
            }).catch(() => ({ remotive:[], adzuna:[], jsearch:[] }))
          ));
          jobs = results.reduce((acc, r) => ({
            remotive: [...(acc.remotive||[]), ...(r.remotive||[])],
            adzuna:   [...(acc.adzuna  ||[]), ...(r.adzuna  ||[])],
            jsearch:  [...(acc.jsearch ||[]), ...(r.jsearch ||[])],
          }), {remotive:[], adzuna:[], jsearch:[]});
        } else {
          jobs = await apiFetch("/jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: jobIntent.query })
          });
        }

        aiBlock.innerHTML = "";
        displayJobs(jobs, aiBlock);
        if (![...(jobs?.remotive||[]), ...(jobs?.adzuna||[]), ...(jobs?.jsearch||[])].length) {
          aiBlock.insertAdjacentHTML('beforeend',
            `<p style="margin-top:8px;color:#a00;">No jobs found right now. Try another role or location.</p>`);
        }
        saveMessage("assistant", `Here are jobs for “${(jobIntent.queries || [jobIntent.query]).join(' | ')}”.`);

        await refreshCreditsPanel?.();
        window.syncState?.();
        hideAIStatus();
        scrollToBottom();
        return;
      }

      // Normal AI chat → ask backend (include attachments)
      const data = await apiFetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          model: currentModel,
          conversation_id: conversationId,
          attachments: _attachments.map(a => ({ filename: a.filename, text: a.text || "" }))
        })
      });

      if (data.conversation_id && data.conversation_id !== conversationId) {
        conversationId = data.conversation_id;
        localStorage.setItem("chat:conversationId", conversationId);
      }

      // If we detected a site feature intent, prefer a concise, site-aware answer we compose locally.
      if (featureIntent) {
        finalReply = composeFeatureReply(featureIntent);
      } else {
        finalReply = (data && data.reply) ? String(data.reply) : "Sorry, I didn't get a response.";
      }
    } catch (err) {
      hideAIStatus();

      if (handleChatLimitError(err)) {
        removeThinking(aiBlock);
        scrollToBottom();
        return;
      }

      if (err?.kind === "limit") {
        removeThinking(aiBlock);
        const errDiv = document.createElement("div");
        errDiv.innerHTML = `<p style="margin:8px 0;color:#a00;">${escapeHtml(err.message || "Free limit reached.")}</p><hr class="response-separator" />`;
        aiBlock.appendChild(errDiv);
        scrollToBottom();
        return;
      }

      removeThinking(aiBlock);
      const errDiv = document.createElement("div");
      errDiv.innerHTML = `<p style="margin:8px 0;color:#a00;">${escapeHtml(err.message || "Sorry, something went wrong.")}</p><hr class="response-separator" />`;
      aiBlock.appendChild(errDiv);
      scrollToBottom();
      return;
    } finally {
      disableComposer(false);
      input?.focus();
    }

    hideAIStatus();
    removeThinking(aiBlock);

    // Append the final answer (do NOT overwrite suggestions)
    const composed = finalReply && typeof finalReply === "string" ? finalReply.trim() : "";
    appendAssistantAnswer(aiBlock, composed || "Thanks! How else can I help?");

    // clear attachments after a completed turn
    _attachments = [];
    renderAttachmentTray();

    // Save to history
    saveMessage("assistant", composed || "Thanks! How else can I help?");

    (async () => { await refreshCreditsPanel?.(); })();
    window.syncState?.();

    scrollToAI(aiBlock);
    scrollToBottom();
    updateScrollButtonVisibility();
  });

  new MutationObserver(() => {
    const box = document.getElementById("chatbox");
    if (box) box.scrollTop = box.scrollHeight;
    updateScrollButtonVisibility();
  }).observe(chatbox, { childList: true, subtree: true });

  window.addEventListener("resize", () => updateScrollButtonVisibility());
});

// AUTO-CONSUME prefilled question from home page
(function(){
  try {
    const params = new URLSearchParams(location.search);
    const q = params.get('q') || localStorage.getItem('chat:prefill') || '';
    if (!q) return;
    localStorage.removeItem('chat:prefill');
    const input = document.getElementById('userInput');
    const form  = document.getElementById('chat-form');
    if (!input || !form) return;
    input.value = q;
    setTimeout(() => {
      form.dispatchEvent(new Event("submit", { bubbles:true, cancelable:true }));
      const nextURL = location.pathname + location.hash;
      history.replaceState({}, "", nextURL);
    }, 100);
  } catch {}
})();

// ──────────────────────────────────────────────────────────────
// Optional job suggestions (kept from your original)
// ──────────────────────────────────────────────────────────────
async function fetchJobs(query, aiBlock) {
  try {
    const res = await fetch("/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    displayJobs(data, aiBlock);
    if (![...(data?.remotive||[]), ...(data?.adzuna||[]), ...(data?.jsearch||[])].length) {
      aiBlock.insertAdjacentHTML('beforeend',
        `<p style="margin-top:8px;color:#a00;">No jobs found right now. Try another role or location.</p>`);
    }
  } catch (err) {
    console.error("Job fetch error:", err);
  }
}
function displayJobs(data, aiBlock) {
  const jobsContainer = document.createElement("div");
  jobsContainer.className = "job-listings";
  const allJobs = [...(data?.remotive || []), ...(data?.adzuna || []), ...(data?.jsearch || [])];
  if (!allJobs.length) return;
  const heading = document.createElement("p");
  heading.innerHTML = `<strong>Here are some job opportunities that match your interest:</strong>`;
  heading.style.marginTop = "16px";
  jobsContainer.appendChild(heading);
  allJobs.forEach(job => {
    const jobCard = document.createElement("div");
    jobCard.className = "job-card";
    jobCard.innerHTML = `
      <h3>${job.title}</h3>
      <p><strong>${job.company}</strong><br>${job.location || ""}</p>
      <a href="${job.url}" target="_blank" rel="noopener noreferrer">View Job</a>
    `;
    jobsContainer.appendChild(jobCard);
  });
  aiBlock.appendChild(jobsContainer);
  scrollToBottom();
  updateScrollButtonVisibility();
}
