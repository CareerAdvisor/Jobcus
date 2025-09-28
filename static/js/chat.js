// /static/js/chat.js

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
// Small utilities (now also exposed on window for inline handlers)
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
function autoResize(textarea) {# ----------------------------
# Ask
# ----------------------------
ask_bp = Blueprint("ask", __name__)

# --- OpenAI (v1) ---
_oai_client = None
def _client():
    global _oai_client
    if _oai_client is None:
        _oai_client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    return _oai_client

CAREER_SYSTEM_PROMPT = (
    "You are Jobcus Assistant — an expert career coach. "
    "You help with: careers, job search, resumes, cover letters, interview prep, "
    "compensation and negotiation, education programs, schools, job roles and duties, "
    "career paths, upskilling, labor-market insights, and workplace advice. "
    "Be clear, practical, and encouraging; structure answers with short sections or bullets; "
    "when useful, include brief examples or templates. If a request is outside career/education, "
    "politely steer the user back to career-relevant guidance."
)

def _first_name_fallback():
    # Use the name “ThankGod” only if that’s actually the logged-in user’s first name;
    # otherwise use the best available first name.
    if getattr(current_user, "is_authenticated", False):
        # try first piece of fullname, else the local-part of email, else 'there'
        fn = (getattr(current_user, "fullname", "") or "").strip().split(" ")[0]
        if not fn:
            email = getattr(current_user, "email", "") or ""
            fn = (email.split("@")[0] if "@" in email else "").strip()
        return fn or "there"
    return "there"

def _chat_completion(model: str, user_msg: str, history=None) -> str:
    """
    Minimal OpenAI wrapper. `history` can be a list of {role, content}.
    """
    msgs = [{"role": "system", "content": CAREER_SYSTEM_PROMPT}]
    if history:
        # keep a small sliding window
        for m in history[-6:]:
            if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str):
                msgs.append({"role": m["role"], "content": m["content"]})
    msgs.append({"role": "user", "content": user_msg})

    try:
        resp = _client().chat.completions.create(
            model=model or "gpt-4o-mini",
            messages=msgs,
            temperature=0.4,
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception:
        # Log if you want: current_app.logger.exception("OpenAI error")
        return "Sorry—I'm having trouble reaching the AI right now. Please try again."

@app.post("/api/ask")
@api_login_required
def api_ask():
    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    model   = (data.get("model")   or "gpt-4o-mini").strip()
    conv_id = data.get("conversation_id")  # may be None on first message

    if not message:
        return jsonify(error="bad_request", message="message is required"), 400

    auth_id = current_user.id  # your User.id = auth_id

    # 1) Ensure conversation
    if not conv_id:
        # Optional: try to title from first user message (truncate)
        title = (message[:60] + "…") if len(message) > 60 else message
        row = supabase_admin.table("conversations").insert({
            "auth_id": auth_id,
            "title": title or "Conversation",
        }).execute()
        conv_id = row.data[0]["id"]

    # 2) Persist user message
    supabase_admin.table("conversation_messages").insert({
        "conversation_id": conv_id,
        "role": "user",
        "content": message
    }).execute()

    # 3) (Optional) fetch a short context window from DB
    # Keep it small to control token cost
    ctx = supabase_admin.table("conversation_messages")\
        .select("role,content")\
        .eq("conversation_id", conv_id)\
        .order("created_at", desc=True)\
        .limit(8).execute().data or []
    history = list(reversed(ctx))  # oldest first

    # 4) Call model
    ai_reply = _chat_completion(model=model, user_msg=message, history=history)

    # 5) Persist assistant message
    supabase_admin.table("conversation_messages").insert({
        "conversation_id": conv_id,
        "role": "assistant",
        "content": ai_reply
    }).execute()

    return jsonify(reply=ai_reply, modelUsed=model, conversation_id=conv_id), 200

@app.get("/api/conversations")
@api_login_required
def list_conversations():
    rows = supabase_admin.table("conversations")\
        .select("id,title,created_at")\
        .eq("auth_id", current_user.id)\
        .order("created_at", desc=True).execute().data or []
    return jsonify(rows)

@app.get("/api/conversations/<uuid:conv_id>/messages")
@api_login_required
def list_messages(conv_id):
    rows = supabase_admin.table("conversation_messages")\
        .select("id,role,content,created_at")\
        .eq("conversation_id", str(conv_id))\
        .order("created_at", asc=True).execute().data or []
    return jsonify(rows)

@app.route("/api/ask", methods=["POST"])
@api_login_required
def ask():
    data = request.get_json()
    message = data.get("message", "")
    user = current_user.first_name if current_user.is_authenticated else "there"

    # 👇 Replace this with your actual AI integration
    if not message.strip():
        reply = f"Hello {user}, how can I assist you today!"
    else:
        reply = run_model("gpt-4", message)  # example AI call

    return jsonify(reply=reply, modelUsed="gpt-4")


@app.get("/api/credits")
@login_required
def api_credits():
    plan = (getattr(current_user, "plan", "free") or "free").lower()

    # example: chat credits
    q = quota_for(plan, "chat_messages")  # Quota(period_kind, limit)
    if q.limit is None:
        return jsonify(plan=plan, used=None, max=None, left=None)

    key   = period_key(q.period_kind)
    used  = get_usage_count(supabase_admin, current_user.id, "chat_messages", q.period_kind, key)
    left  = max(q.limit - used, 0)
    return jsonify(plan=plan, used=used, max=q.limit, left=left,
                   period_kind=q.period_kind, period_key=key)

# NEW: expose limits for all features so UI can pre-lock actions nicely
@app.get("/api/limits")
@login_required
def api_limits():
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    features = ["chat_messages", "resume_builder", "resume_analyzer", "interview_coach", "cover_letter", "skill_gap"]
    data = {"plan": plan, "features": {}}
    for f in features:
        q = quota_for(plan, f)  # -> Quota(period_kind, limit)
        if q.limit is None:
            data["features"][f] = {"used": None, "max": None, "left": None, "period_kind": q.period_kind}
            continue
        key = period_key(q.period_kind)
        used = get_usage_count(supabase_admin, current_user.id, f, q.period_kind, key)
        left = max(q.limit - used, 0)
        data["features"][f] = {"used": used, "max": q.limit, "left": left, "period_kind": q.period_kind, "period_key": key}
    return jsonify(data)
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}
function sharePage() {
  navigator.clipboard.writeText(window.location.href);
  alert("Link copied!");
}
function handleMic()   { alert("Voice input coming soon!"); }
function handleAttach(){ alert("File upload coming soon!"); }

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
function maybeShowScrollIcon() {
  const chatboxEl = document.getElementById("chatbox");
  const scrollIcon = document.getElementById("scrollDown");
  if (!chatboxEl || !scrollIcon) return;
  scrollIcon.style.display =
    chatboxEl.scrollHeight > chatboxEl.clientHeight + 20 ? "block" : "none";
}

// NEW: always snap the chat view to the latest message
function scrollToBottom() {
  const box = document.getElementById("chatbox");
  if (!box) return;
  box.scrollTop = box.scrollHeight;
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

// Expose functions used by inline HTML handlers
window.insertSuggestion = insertSuggestion;
window.copyToClipboard  = copyToClipboard;
window.autoResize       = autoResize;
window.sharePage        = sharePage;
window.handleMic        = handleMic;
window.handleAttach     = handleAttach;
window.removeWelcome    = removeWelcome;

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
// Server call helper (POST to /api/ask and return JSON)
// ──────────────────────────────────────────────────────────────
async function sendMessageToAPI(payload) {
  // apiFetch comes from base.js and already handles credentials + CSRF + 401s
  return apiFetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }); // expected: { reply, modelUsed }
}

// ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Init model UI/logic first
  const modelCtl = initModelControls();

  // 0) Server-backed conversation id (created on first send)
  let conversationId = localStorage.getItem("chat:conversationId") || null;

  // Storage keys
  const STORAGE = {
    current: "jobcus:chat:current",   // [{role:'user'|'assistant', content:'...'}]
    history: "jobcus:chat:history"    // [{id,title,created,messages:[...] }]
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
  // Initial size if prefilled
  window.autoResize?.(input);

  const escapeHtml = (s='') => s
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

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
    const shell   = document.getElementById("chatShell");
    const fname   = (shell?.dataset.firstName || "there");
    chatbox.innerHTML = `
      <div class="welcome" id="welcomeBanner">
        <p class="welcome-title">Welcome back, ${escapeHtml(fname)}. How can I help you today?</p>
        <div class="suggestion-chips">
          <button type="button" onclick="insertSuggestion('How do I improve my resume?')" class="chip">Improve my resume</button>
          <button type="button" onclick="insertSuggestion('Interview tips for a UX role')" class="chip">Interview tips</button>
          <button type="button" onclick="insertSuggestion('Show me job market insights for London')" class="chip">Job insights</button>
        </div>
      </div>`;
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

  function refreshCreditsPanel() {
    const planEl  = document.getElementById("credits-plan");
    const leftEl  = document.getElementById("credits-left");
    const resetEl = document.getElementById("credits-reset");
    if (!planEl && !leftEl && !resetEl) return;

    const serverPlan = planEl?.dataset.plan;
    const PLAN = (serverPlan || localStorage.getItem("userPlan") || "free");
    if (serverPlan) localStorage.setItem("userPlan", serverPlan);

    const QUOTAS = {
      free:     { label: "Free",     reset: "Trial",           max: 5 },
      weekly:   { label: "Weekly",   reset: "Resets weekly",   max: 100 },
      standard: { label: "Standard", reset: "Resets monthly",  max: 600 },
      premium:  { label: "Premium",  reset: "Resets yearly",   max: 10800 }
    };
    const q    = QUOTAS[PLAN] || QUOTAS.free;
    const used = Number(localStorage.getItem("chatUsed") || 0);
    const left = Math.max(q.max - used, 0);

    planEl  && (planEl.textContent  = q.label);
    leftEl  && (leftEl.textContent  = `${left} of ${q.max}`);
    resetEl && (resetEl.textContent = q.reset);
  }

  // Sidebar open/close (use functions exposed by base.js)
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
  maybeShowScrollIcon?.();
  scrollToBottom();

  // ---- send handler (self-contained and async) ----
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
    scrollToAI(aiBlock);
    scrollToBottom();

    const currentModel = modelCtl.getSelectedModel();
    let finalReply = "";

    try {
      disableComposer(true);

      // Jobs quick-intent
      if (/^\s*jobs?:/i.test(message)) {
        const query = message.replace(/^\s*jobs?:/i, "").trim() || message.trim();
        const jobs = await apiFetch("/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query })
        });
        displayJobs(jobs, aiBlock);
        saveMessage("assistant", `Found ${Array.isArray(jobs) ? jobs.length : 0} jobs for “${query}”.`);
        refreshCreditsPanel?.();
        window.syncState?.();
        scrollToBottom();
        return;
      }

      // Normal AI chat
      const data = await apiFetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, model: currentModel, conversation_id: conversationId })
    });
    
    // Save conv id after first reply
    if (data.conversation_id && data.conversation_id !== conversationId) {
      conversationId = data.conversation_id;
      localStorage.setItem("chat:conversationId", conversationId);
    }

      finalReply = (data && data.reply) ? String(data.reply) : "Sorry, I didn't get a response.";
    } catch (err) {
      if (err?.kind === "limit") {
        aiBlock.innerHTML = `<p style="margin:8px 0;color:#a00;">${escapeHtml(err.message || "Free limit reached.")}</p><hr class="response-separator" />`;
        scrollToBottom();
        return;
      }
      aiBlock.innerHTML = `<p style="margin:8px 0;color:#a00;">${escapeHtml(err.message || "Sorry, something went wrong.")}</p><hr class="response-separator" />`;
      scrollToBottom();
      return;
    } finally {
      disableComposer(false);
      input?.focus();
    }

    const copyId = `ai-${Date.now()}`;
    aiBlock.innerHTML = `
      <div id="${copyId}" class="markdown"></div>
      <div class="response-footer">
        <span class="copy-wrapper">
          <img src="/static/icons/copy.svg" class="copy-icon" title="Copy" onclick="copyToClipboard('${copyId}')">
          <span class="copy-text">Copy</span>
        </span>
      </div>
      <hr class="response-separator" />
    `;
    const targetDiv = document.getElementById(copyId);
    scrollToBottom();

    let i = 0, buffer = "";
    (function typeWriter() {
      if (i < finalReply.length) {
        buffer += finalReply[i++];
        targetDiv.textContent = buffer;
        scrollToAI(aiBlock);
        scrollToBottom();
        setTimeout(typeWriter, 5);
      } else {
        if (window.marked?.parse) {
          targetDiv.innerHTML = window.marked.parse(buffer);
        } else {
          targetDiv.textContent = buffer;
        }
        saveMessage("assistant", finalReply);

        const usedNow = Number(localStorage.getItem("chatUsed") || 0) + 1;
        localStorage.setItem("chatUsed", usedNow);
        refreshCreditsPanel?.();
        window.syncState?.();

        scrollToAI(aiBlock);
        scrollToBottom();
        maybeShowScrollIcon();
      }
    })();
  });

  const sendBtn = document.getElementById("sendButton");
  sendBtn?.addEventListener("click", () => {
    // Trigger the form submit programmatically
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  // If DOM changes inside chatbox (e.g., images/markdown), keep view at bottom
  new MutationObserver(() => {
    const box = document.getElementById("chatbox");
    if (box) box.scrollTop = box.scrollHeight;
  }).observe(chatbox, { childList: true, subtree: true });

  // Keep bottom on resize
  window.addEventListener("resize", scrollToBottom);
});

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
}
