import os, stripe, hashlib, hmac, time
import traceback
from io import BytesIO
from collections import Counter
import re, json, base64, logging, requests
from functools import wraps
from auth_utils import api_login_required, is_staff, is_superadmin, require_superadmin

from flask import (
    Blueprint, Flask, request, jsonify, render_template, redirect,
    session, flash, url_for, send_file, current_app, make_response, g
)
from flask_cors import CORS
from flask_login import (
    login_user, logout_user, current_user,
    login_required, user_logged_in, LoginManager, UserMixin
)
from markupsafe import escape
from weasyprint import HTML, CSS
from gotrue.errors import AuthApiError
from dotenv import load_dotenv
from supabase_auth.errors import AuthApiError

# Local modules
from extensions import login_manager, init_supabase, init_openai
from typing import Optional
from datetime import datetime, timedelta, timezone, date
from auth_utils import require_superadmin, is_staff, is_superadmin, api_login_required
from limits import (
    check_and_increment,
    get_usage_count,
    job_insights_level,
    feature_enabled,
    quota_for,
    period_key,
)
from itsdangerous import URLSafeSerializer, BadSignature
from supabase import create_client
from abuse_guard import allow_free_use
from urllib.parse import quote, urlencode, urlparse
import httpx

# --- Load resumes blueprint robustly ---
import importlib, importlib.util, pathlib, sys, logging
from openai import OpenAI

api_bp = Blueprint("api", __name__, url_prefix="/api")
resumes_bp = None  # will set when found

_here = pathlib.Path(__file__).resolve().parent

def _import_from_spec(module_name: str, file_path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(module_name, str(file_path))
    if not spec or not spec.loader:
        return None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[attr-defined]
    return mod

try:
    # Case A: a top-level resumes.py next to app.py
    from resumes import resumes_bp as _rbp  # type: ignore
    resumes_bp = _rbp
except ModuleNotFoundError:
    # Case B: import by file path if resumes.py is adjacent
    _resumes_py = _here / "resumes.py"
    if _resumes_py.exists():
        mod = _import_from_spec("resumes", _resumes_py)
        if mod and hasattr(mod, "resumes_bp"):
            resumes_bp = getattr(mod, "resumes_bp")

# Case C: common subfolders (e.g., blueprints/resumes.py)
if resumes_bp is None:
    for sub in ("blueprints", "backend", "server", "src", "app", "apps"):
        cand = _here / sub / "resumes.py"
        if cand.exists():
            # try as a package import first if __init__.py exists
            pkg_init = cand.parent / "__init__.py"
            if pkg_init.exists():
                # try `from blueprints.resumes import resumes_bp` style
                pkg_name = cand.parent.name
                try:
                    mod = importlib.import_module(f"{pkg_name}.resumes")
                    if hasattr(mod, "resumes_bp"):
                        resumes_bp = getattr(mod, "resumes_bp")
                        break
                except Exception:
                    pass
            # fallback: import by file path
            mod = _import_from_spec(f"{cand.parent.name}.resumes", cand)
            if mod and hasattr(mod, "resumes_bp"):
                resumes_bp = getattr(mod, "resumes_bp")
                break

# Case D: explicit package path if the folder is already on sys.path
if resumes_bp is None:
    for dotted in ("blueprints.resumes", "server.resumes", "backend.resumes", "src.resumes"):
        try:
            mod = importlib.import_module(dotted)
            if hasattr(mod, "resumes_bp"):
                resumes_bp = getattr(mod, "resumes_bp")
                break
        except Exception:
            continue

if resumes_bp is None:
    logging.warning(
        "resumes blueprint not found. If your blueprint lives at blueprints/resumes.py, "
        "ensure that file exports `resumes_bp = Blueprint(...)` and that the folder is a package."
    )

# --- Environment & app setup ---
load_dotenv()

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.secret_key = os.getenv("SECRET_KEY", "supersecret")
    
# Public Supabase values from env
app.config["SUPABASE_URL"]  = os.getenv("SUPABASE_URL", "").rstrip("/")
app.config["SUPABASE_ANON_KEY"] = os.getenv("SUPABASE_ANON_KEY", "")
app.config["BASE_URL"]      = os.getenv("PUBLIC_BASE_URL", "https://www.jobcus.com").rstrip("/")
app.config["SUPABASE_ADMIN"] = supabase_admin


# --- OAuth provider mapping (insert this block here) ---
OAUTH_ALLOWED = {
    # map pretty urls -> supabase provider names
    "google":   "google",
    "facebook": "facebook",
    "linkedin": "linkedin_oidc",  # Supabase uses linkedin_oidc
    "apple":    "apple",
}
    
@app.context_processor
def inject_supabase_public():
    return {
        "SUPABASE_URL": current_app.config.get("SUPABASE_URL"),
        "SUPABASE_ANON_KEY": current_app.config.get("SUPABASE_ANON_KEY"),
    }

# Session cookie hardening
app.config.update(
  SESSION_COOKIE_SAMESITE="Lax",
  SESSION_COOKIE_SECURE=True,
  SESSION_PERMANENT=False,  # reduce churn
)

CORS(app)
logging.basicConfig(level=logging.INFO)

# --- External clients (shared via app.config so blueprints can access) ---
app.config["SUPABASE"] = init_supabase()
app.config["OPENAI_CLIENT"] = init_openai()

# Short aliases if you want to use them in this file
supabase = app.config["SUPABASE"]
client   = app.config["OPENAI_CLIENT"]

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") if not os.getenv(k)]
if missing:
    # Fail fast with a clear message (don’t print secrets)
    raise RuntimeError(f"Missing required env vars: {', '.join(missing)}")

supabase_admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
app.config["SUPABASE_ADMIN"] = supabase_admin

# --- Flask-Login init ---
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "account"  # or your login route endpoint
login_manager.login_message = "Please sign up or log in to use this feature."

# --- Constants for Job Insights ---
REMOTIVE_API_URL = "https://remotive.com/api/remote-jobs"
ADZUNA_API_URL   = "https://api.adzuna.com/v1/api/jobs"
ADZUNA_APP_ID    = os.getenv("ADZUNA_APP_ID")
ADZUNA_APP_KEY   = os.getenv("ADZUNA_APP_KEY")
JSEARCH_API_KEY  = os.getenv("JSEARCH_API_KEY")
JSEARCH_API_HOST = os.getenv("JSEARCH_API_HOST")

JOB_TITLES = [
    "Software Engineer", "Data Analyst",
    "Project Manager", "UX Designer", "Cybersecurity Analyst"
]
KEYWORDS = ["Python", "SQL", "Project Management", "UI/UX", "Cloud Security"]

# --- Stripe Payment ---
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")  # your sk_live_...

# Map plan code -> Stripe Price ID (envs you already set)
PLAN_TO_PRICE = {
    "weekly":   os.getenv("STRIPE_PRICE_WEEKLY"),
    "standard": os.getenv("STRIPE_PRICE_STANDARD"),
    "premium":  os.getenv("STRIPE_PRICE_PREMIUM"),
}
    
# ---- Model selection helpers ----
def _dedupe(seq):
    seen, out = set(), []
    for m in seq:
        m = (m or "").strip()
        if m and m not in seen:
            seen.add(m); out.append(m)
    return out

def _available_models():
    """Return a set of model ids available to your account (best-effort)."""
    try:
        client = current_app.config["OPENAI_CLIENT"]
        return {m.id for m in client.models.list().data}
    except Exception:
        current_app.logger.info("Could not list OpenAI models; skipping availability filter.")
        return None

def allowed_models_for_plan(plan: str) -> list[str]:
    """
    What the UI should show for the given plan.
    Free: forced to FREE_MODEL.
    Paid: PAID_MODEL_DEFAULT + PAID_MODEL_ALLOW (deduped, optionally filtered by availability).
    """
    plan = (plan or "free").lower()

    free_default = (os.getenv("FREE_MODEL", "gpt-4o-mini") or "gpt-4o-mini").strip()
    paid_default = (os.getenv("PAID_MODEL_DEFAULT", "gpt-4o-mini") or "gpt-4o-mini").strip()
    paid_allow   = [s.strip() for s in (os.getenv("PAID_MODEL_ALLOW", "") or "").split(",") if s.strip()]

    if plan == "free":
        out = [free_default]
    else:
        out = _dedupe([paid_default] + paid_allow)

    # Optional safety: only keep models your account actually has
    avail = _available_models()
    if avail:
        filtered = [m for m in out if m in avail]
        if filtered:
            return filtered
        # fallback so UI still works even if none matched
        if free_default in avail:
            return [free_default]
    return out

def choose_model(requested: str | None) -> str:
    """
    Server-side guard: the final model we will actually call.
    Paid users may switch; free users are forced to FREE_MODEL.
    """
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    allowed = allowed_models_for_plan(plan)
    default = allowed[0]
    req = (requested or "").strip()
    return req if req in allowed else default

# --- helpers: safe next ---
def _is_safe_next(url: str) -> bool:
    try:
        if not url:
            return False
        u = urlparse(url)
        # allow only same-site relative paths like "/resume-builder?x=1"
        return (not u.scheme) and (not u.netloc) and url.startswith("/")
    except Exception:
        return False

def change_plan(user_id: str, new_plan: str):
    supabase = current_app.config["SUPABASE"]
    # fetch current user row
    row = supabase.table("users").select("*").eq("id", user_id).single().execute()
    user = row.data or {}
    # normalize plan string
    plan = (new_plan or "").strip().lower()

    if plan == "free":
        if user.get("free_plan_used"):
            # block re-activation of free plan
            raise ValueError("Free trial already used. Please upgrade to continue.")
        # first-time free activation: set plan + mark as used
        supabase.table("users").update({
            "plan": "free",
            "free_plan_used": True
        }).eq("id", user_id).execute()
    else:
        # allow resubscribe/upgrade/downgrade to paid plans anytime
        supabase.table("users").update({
            "plan": plan
        }).eq("id", user_id).execute()

# --- Local fallbacks to remove services/* dependency -------------------------
def get_or_bootstrap_user(supabase_admin, auth_id: str, email: str | None):
    """
    Fetch a user row by auth_id; create a minimal one on first login.
    """
    try:
        res = (
            supabase_admin
            .table("users")
            .select("*")
            .eq("auth_id", auth_id)
            .maybe_single()
            .execute()
        )
        row = (res.data if isinstance(res.data, dict) else (res.data or None))
        if row:
            return row
    except Exception:
        current_app.logger.warning("get_or_bootstrap_user: select failed", exc_info=True)

    payload = {
        "auth_id": auth_id,
        "email": email,
        "plan": "free",
        "plan_status": "active",
    }
    try:
        ins = supabase_admin.table("users").insert(payload).execute()
        if isinstance(ins.data, list) and ins.data:
            return ins.data[0]
    except Exception:
        current_app.logger.warning("get_or_bootstrap_user: insert failed", exc_info=True)
    return payload

def call_ai(model: str, prompt: str) -> str:
    """
    Minimal wrapper around OpenAI Chat Completions (SDK v1.x).
    """
    client = current_app.config["OPENAI_CLIENT"]
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
    )
    return (resp.choices[0].message.content or "").strip()

# --- User model ---
class User(UserMixin):
    def __init__(
        self,
        auth_id: str,
        email: str,
        fullname: str | None = None,
        role: str = "user",
        plan: str = "free",
        plan_status: str | None = None,
    ):
        self.id = auth_id
        self.email = email
        self.fullname = fullname
        self.role = (role or "user").lower()
        self.plan = (plan or "free").lower()
        self.plan_status = plan_status

    @property
    def is_admin(self) -> bool:
        return self.role in ("admin", "superadmin")

    @property
    def is_superadmin(self) -> bool:
        return self.role == "superadmin"


@login_manager.user_loader
def load_user(user_id: "Optional[str]"):
    if not user_id or user_id == "None":
        return None

    supabase = current_app.config.get("SUPABASE")
    if supabase is None:
        logging.warning("load_user: supabase client is not initialized")
        return None

    try:
        resp = (
            supabase.table("users")
            .select("auth_id,email,fullname,role,plan,plan_status")
            .eq("auth_id", user_id)
            .limit(1)
            .execute()
        )
        data = getattr(resp, "data", None) if resp is not None else None
        if not data:
            return None
        row = data[0] if isinstance(data, list) else data
        if not row:
            return None

        return User(
            auth_id=row.get("auth_id"),
            email=row.get("email"),
            fullname=row.get("fullname"),
            role=row.get("role") or "user",
            plan=row.get("plan") or "free",
            plan_status=row.get("plan_status"),
        )
    except Exception:
        logging.exception("load_user: failed to restore user")
        return None

def get_user_resume_text(user_id: str) -> Optional[str]:
    """Fetch the latest stored resume text for a user from Supabase."""
    try:
        supabase = current_app.config.get("SUPABASE")
        if supabase is None:
            current_app.logger.warning("get_user_resume_text: supabase client is not initialized")
            return None

        resp = (
            supabase.table("resumes")
            .select("text,created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

        data = getattr(resp, "data", None) if resp is not None else None
        if not data:
            return None

        row = data[0] if isinstance(data, list) else data
        return row.get("text") if row else None
    except Exception:
        current_app.logger.exception("get_user_resume_text error")
        return None

@login_manager.unauthorized_handler
def _unauthorized():
    # JSON for API routes
    if (request.path or "").startswith("/api/"):
        return jsonify(error="auth_required",
                       message="Please log in to use this feature."), 401
    # normal redirect for web pages
    return redirect(url_for("account", next=request.url))

def log_login_event():
    try:
        supabase.table("login_events").insert({
            "auth_id": getattr(current_user, "id", None) or getattr(current_user, "auth_id", None),
            "ip_hash": ip_hash_from_request(request),
            "user_agent": request.headers.get("User-Agent", "")[:512],
        }).execute()
    except Exception:
        current_app.logger.exception("log_login_event failed")

# --- Config/secrets ---
SID_COOKIE = "sid"
SID_TTL_SECONDS = 30 * 24 * 3600         # 30 days
SECRET_IP_SALT = os.getenv("IP_HASH_SALT", "change-me")   # set a strong value in Render
_session_signer = URLSafeSerializer(os.getenv("SECRET_KEY", "dev"), salt="user-session")

# --- Fingerprints ---
def ip_hash_from_request(req):
    ip = (req.headers.get("X-Forwarded-For") or req.remote_addr or "").split(",")[0].strip()
    if not ip: return None
    return hmac.new(SECRET_IP_SALT.encode(), ip.encode(), hashlib.sha256).hexdigest()

def device_hash_from_request(req):
    ua   = (req.headers.get("User-Agent") or "")[:500]
    acc  = (req.headers.get("Accept") or "")[:180]
    lang = (req.headers.get("Accept-Language") or "")[:120]
    raw  = f"{ua}|{acc}|{lang}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

# --- Login event (keeps your IP abuse signal) ---
def record_login_event(user):
    try:
        supabase.table("login_events").insert({
            "auth_id": getattr(user, "id", None),
            "user_agent": (request.headers.get("User-Agent") or "")[:500],
            "ip_hash": ip_hash_from_request(request)
        }).execute()
    except Exception:
        current_app.logger.exception("failed to record login event")

# --- Per-account session control (1 active session for Free) ---
def _sign_session_id(session_id: str) -> str:
    return _session_signer.dumps({"sid": session_id, "ts": int(time.time())})

def _unsign_session_token(token: str) -> str | None:
    try:
        data = _session_signer.loads(token)
        return data.get("sid")
    except BadSignature:
        return None

def start_user_session(user):
    dev = device_hash_from_request(request)
    iph = ip_hash_from_request(request)
    ua  = (request.headers.get("User-Agent") or "")[:500]

    # Enforce single active session for FREE users
    plan = (getattr(user, "plan", "free") or "free").lower()
    if plan == "free":
        supabase.table("user_sessions").update({"is_active": False})\
            .eq("auth_id", user.id).eq("is_active", True).execute()

    row = {"auth_id": user.id, "device_hash": dev, "ip_hash": iph, "user_agent": ua, "is_active": True}
    ins = supabase.table("user_sessions").insert(row).execute()
    session_id = ins.data[0]["id"] if ins.data else None
    token = _sign_session_id(session_id)

    # Expose session id on g for this request (abuse_guard can read if needed)
    g.session_id = session_id

    def _set_cookie(resp):
        resp.set_cookie(SID_COOKIE, token, max_age=SID_TTL_SECONDS,
                        httponly=True, samesite="Lax", secure=True, path="/")
        # NEW: set a durable, non-HTTPOnly device cookie used by abuse_guard
        resp.set_cookie("jobcus_device", dev, max_age=SID_TTL_SECONDS,
                        httponly=False, samesite="Lax", secure=True, path="/")
        return resp
    return session_id, _set_cookie

def end_current_session(redirect_endpoint="account"):
    token = request.cookies.get(SID_COOKIE)
    sid = _unsign_session_token(token) if token else None
    if sid:
        try:
            supabase.table("user_sessions").update({"is_active": False}).eq("id", sid).execute()
        except Exception:
            current_app.logger.exception("failed to end session")
    resp = make_response(redirect(url_for(redirect_endpoint)))
    resp.set_cookie(SID_COOKIE, "", expires=0, path="/")
    resp.set_cookie("jobcus_device", "", expires=0, path="/")
    logout_user()
    return resp

@app.before_request
def _auth_wall():
    p = request.path or ""
    # allow static & health
    if p.startswith("/static/") or p == "/healthz":
        return
    # if user not authenticated on API: return JSON (don’t redirect HTML)
    if p.startswith("/api/") and not current_user.is_authenticated:
        return jsonify(error="auth_required",
                       message="Please log in to use this feature."), 401
        
@app.before_request
def enforce_single_active_session():
    if not current_user.is_authenticated:
        return

    if request.endpoint in {None, "account", "logout", "static"}:
        return

    token = request.cookies.get(SID_COOKIE)
    sid = _unsign_session_token(token) if token else None

    if not sid:
        return end_current_session("account")  # no bound session cookie → sign out
    try:
        q = supabase.table("user_sessions").select("*").eq("id", sid).limit(1).execute()
        row = q.data[0] if q.data else None
        if not row or (row["auth_id"] != str(current_user.id)) or (not row["is_active"]):
            return end_current_session()
        # touch last_seen
        supabase.table("user_sessions").update({"last_seen": datetime.utcnow().isoformat()})\
            .eq("id", sid).execute()
    except Exception:
        current_app.logger.exception("session check failed")
        return end_current_session()

# --- Error Handler ---#
def _wants_json():
    return "application/json" in (request.headers.get("Accept") or "")

@app.errorhandler(401)
def _eh_401(e):
    if _wants_json():
        return jsonify(error="auth_required",
                       message="Please sign up or log in to use this feature."), 401
    return e

@app.errorhandler(403)
def _eh_403(e):
    if _wants_json():
        return jsonify(error="forbidden",
                       message="Please sign up or log in to use this feature."), 403
    return e

# --- IP abuse heuristic (legacy; UNUSED now) ---
def too_many_free_accounts_from_ip(ip_hash, window_days=7, threshold=3):
    if not ip_hash: return False
    try:
        q = supabase.rpc("count_distinct_auth_for_ip_window",
                         {"p_ip_hash": ip_hash, "p_days": window_days}).execute()
        n = (q.data or [{}])[0].get("count", 0)
        return int(n) >= int(threshold)
    except Exception:
        current_app.logger.exception("RPC count_distinct_auth_for_ip_window failed")
        return False

# NEW: Narrowed/free-plan guard based on device/user (not router IP)
@app.before_request
def free_plan_device_guard():
    if not current_user.is_authenticated:
        return
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    if plan != "free":
        return
    # endpoints to guard gently (same names you had)
    protected = {"ask", "resume_analysis", "api_resume_analysis"}
    if request.endpoint in protected:
        ok, payload = allow_free_use(current_user.id, plan)
        if not ok:
            # Keep error code for frontend (matches your new chat UI handler)
            msg = payload.get("message") or "Free usage limit reached for this device."
            return jsonify({"error": "too_many_free_accounts", "message": msg}), 429

# Jobs fetch (add short timeouts to avoid worker hangs)
DEFAULT_HTTP_TIMEOUT = (5, 15)  # connect, read

def fetch_remotive_jobs(query: str):
    try:
        r = requests.get(REMOTIVE_API_URL, params={"search": query}, timeout=DEFAULT_HTTP_TIMEOUT)
        jobs = r.json().get("jobs", [])
        return [
            {
                "id": job.get("id"),
                "title": job.get("title"),
                "company": job.get("company_name"),          # ← was company_name
                "location": job.get("candidate_required_location"),
                "url": job.get("url")
            }
            for job in jobs
        ]
    except Exception:
        return []

def fetch_adzuna_jobs(query: str, location: str, job_type: str):
    country = "gb"
    params = {
        "app_id": ADZUNA_APP_ID,
        "app_key": ADZUNA_APP_KEY,
        "what": query,
        "where": location,
        "results_per_page": 10
    }
    try:
        r = requests.get(f"{ADZUNA_API_URL}/{country}/search/1", params=params, timeout=DEFAULT_HTTP_TIMEOUT)
        results = r.json().get("results", [])
        return [
            {
                "id": job.get("id"),
                "title": job.get("title"),
                "company": job.get("company", {}).get("display_name"),
                "location": job.get("location", {}).get("display_name"),
                "url": job.get("redirect_url")
            }
            for job in results
        ]
    except Exception:
        return []

def fetch_jsearch_jobs(query: str):
    url = "https://jsearch.p.rapidapi.com/search"
    headers = {
        "X-RapidAPI-Key": JSEARCH_API_KEY,
        "X-RapidAPI-Host": JSEARCH_API_HOST
    }
    params = {"query": query, "num_pages": 1}
    try:
        r = requests.get(url, headers=headers, params=params, timeout=DEFAULT_HTTP_TIMEOUT)
        data = r.json().get("data", [])
        return [
            {
                "id": job.get("job_id"),
                "title": job.get("job_title"),
                "company": job.get("employer_name"),
                "location": job.get("job_city"),
                "url": job.get("job_apply_link")
            }
            for job in data
        ]
    except Exception:
        return []

def fetch_salary_data():
    data = []
    country = "gb"
    for title in JOB_TITLES:
        params = {
            "app_id": ADZUNA_APP_ID,
            "app_key": ADZUNA_APP_KEY,
            "what": title,
            "results_per_page": 1
        }
        try:
            r = requests.get(f"{ADZUNA_API_URL}/{country}/search/1", params=params, timeout=DEFAULT_HTTP_TIMEOUT)
            results = r.json().get("results", [])
            if results:
                job = results[0]
                low = float(job.get("salary_min", 0) or 0)
                high = float(job.get("salary_max", 0) or 0)
                data.append(((low + high) / 2) if (low or high) else 0)
            else:
                data.append(0)
        except Exception:
            data.append(0)
    return data

def fetch_job_counts():
    counts = []
    for title in JOB_TITLES:
        try:
            r = requests.get(REMOTIVE_API_URL, params={"search": title}, timeout=DEFAULT_HTTP_TIMEOUT)
            counts.append(len(r.json().get("jobs", [])))
        except Exception:
            counts.append(0)
    return counts

def fetch_skill_trends():
    freq = Counter()
    try:
        r = requests.get(REMOTIVE_API_URL, params={"limit": 50}, timeout=DEFAULT_HTTP_TIMEOUT)
        for job in r.json().get("jobs", []):
            text = (job.get("description") or "").lower()
            for key in KEYWORDS:
                if key.lower() in text:
                    freq[key] += 1
    except Exception:
        pass
    return freq

def fetch_location_counts():
    freq = Counter()
    country = "gb"
    try:
        r = requests.get(f"{ADZUNA_API_URL}/{country}/search/1", params={
            "app_id": ADZUNA_APP_ID,
            "app_key": ADZUNA_APP_KEY,
            "results_per_page": 30
        }, timeout=DEFAULT_HTTP_TIMEOUT)
        for job in r.json().get("results", []):
            loc = job.get("location", {}).get("display_name")
            if loc:
                freq[loc] += 1
    except Exception:
        pass
    return freq.most_common(5)

#--- Stripe ---
def _get_or_create_stripe_customer(user):
    """Return a Stripe customer id for this user, creating if needed and storing in DB."""
    supabase = current_app.config["SUPABASE"]

    try:
        r = supabase.table("users").select("stripe_customer_id").eq("auth_id", user.id).single().execute()
        scid = (r.data or {}).get("stripe_customer_id")
    except Exception:
        scid = None

    if scid:
        return scid

    cust = stripe.Customer.create(
        email=user.email,
        name=(user.fullname or None),
        metadata={"auth_id": user.id}
    )
    try:
        supabase.table("users").update({"stripe_customer_id": cust["id"]}).eq("auth_id", user.id).execute()
    except Exception:
        pass

    return cust["id"]

# -------- Basic pages --------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/chat")
@login_required
def chat():
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    is_paid = plan in ("weekly", "standard", "premium")

    return render_template(
        "chat.html",
        is_paid=is_paid,
        plan=plan,
        model_options=allowed_models_for_plan(plan),
        free_model=allowed_models_for_plan("free")[0],
        model_default=allowed_models_for_plan(plan)[0],
    )

# keep this single definition only
@app.route("/api/state", methods=["GET","POST"])
@login_required
def api_state():
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    auth_id = getattr(current_user, "id", None) or getattr(current_user, "auth_id", None)
    if not auth_id:
        return jsonify({"error":"no auth id"}), 400

    # Plans without cloud sync: pretend-success, never 500
    if not feature_enabled(plan, "cloud_history"):
        if request.method == "GET":
            return jsonify({"data": {}}), 200
        return ("", 204)

    if request.method == "GET":
        try:
            r = supabase_admin.table("user_state") \
                .select("data").eq("auth_id", auth_id).limit(1).execute()
            row = r.data[0] if r.data else None
            return jsonify({"data": (row["data"] if row else {})}), 200
        except Exception as e:
            current_app.logger.warning("state fetch failed: %s", e)
            return jsonify({"data": {}}), 200

    # POST
    payload = request.get_json(silent=True) or {}
    data = payload.get("data", {})
    try:
        supabase_admin.table("user_state").upsert(
            {"auth_id": auth_id, "data": data, "updated_at": datetime.utcnow().isoformat()},
            on_conflict="auth_id"
        ).execute()
    except Exception as e:
        current_app.logger.warning("state upsert failed (non-fatal): %s", e)
        # do not break the UI
    return ("", 204)

@app.get("/favicon.ico")
def favicon():
    return redirect(url_for("static", filename="icons/favicon.ico"), code=302)

@app.get("/resume-analyzer")
def page_resume_analyzer():
    return render_template("resume-analyzer.html")

@app.get("/resume-builder")
def page_resume_builder():
    return render_template("resume-builder.html")

@app.route("/interview-coach")
def interview_coach():
    return render_template("interview-coach.html")

@app.route("/skill-gap")
def skill_gap():
    return render_template("skill-gap.html")

@app.route("/job-insights")
def job_insights():
    return render_template("job-insights.html")

@app.route("/employers")
def employers():
    return render_template("employers.html")

@app.route("/faq")
def faq():
    return render_template("faq.html")

@app.route("/privacy-policy")
def privacy_policy():
    return render_template("privacy-policy.html")

@app.route("/terms-of-service")
def terms_of_service():
    return render_template("terms-of-service.html")

@app.route("/cookies")
def cookies():
    return render_template("cookies.html")

@app.route("/pricing")
def pricing():
    free_used = bool(getattr(current_user, "free_plan_used", False)) if getattr(current_user, "is_authenticated", False) else False
    return render_template("pricing.html", free_used=free_used)

def _plans():
    return {
        "free": {
            "code":"free", "title":"Free", "amount":"0", "period":"/mo",
            "tagline":"Great for a quick check",
            "features":[
                "<strong>2</strong> resume analyses / month (basic score + tips)",
                "<strong>1</strong> AI cover letter / month",
                "AI Resume Builder (basic templates; <strong>1</strong> download / month)",
                "Skill-Gap snapshot (1 basic analysis / month)",
                "Job Insights (basic charts)",
                "Interview Coach (limited practice; <strong>1</strong> / month)",
                "AI Chat trial: <strong>10 messages</strong> total",
                "Local device history",
            ],
        },
        "weekly": {
            "code":"weekly", "title":"Weekly Pass", "amount":"7<span class='cents'>.99</span>", "period":"/week",
            "tagline":"For urgent applications",
            "features":[
                "AI Chat credits: <strong>100 messages</strong> / week",
                "<strong>10</strong> resume analyses / week",
                "<strong>5</strong> AI cover letters / week",
                "Resume Builder: <strong>5 downloads</strong> / week",
                "“Rebuild with AI” for resumes",
                "Skill-Gap (standard)",
                "Job Insights (full access)",
                "Interview Coach sessions",
                "Email support",
            ],
        },
        "standard": {
            "code":"standard", "title":"Standard", "amount":"23<span class='cents'>.99</span>", "period":"/mo",
            "tagline":"Serious applications, smarter tools",
            "features":[
                "AI Chat credits: <strong>600 messages</strong> / month",
                "<strong>50</strong> resume analyses / month (deep ATS + JD match)",
                "<strong>20</strong> AI cover letters / month",
                "Resume Builder: <strong>20 downloads</strong> / month",
                "AI Optimize + Rebuild with AI",
                "Interview Coach sessions",
                "Skill-Gap (pro)",
                "Job Insights (full access)",
                "Download optimized PDF / DOCX / TXT",
                "Save history across devices",
                "Email support",
            ],
        },
        "premium": {
            "code":"premium", "title":"Premium", "amount":"229", "period":"/yr",
            "tagline":"Best value for ongoing career growth",
            "features":[
                "AI Chat credits: <strong>10,800 messages</strong> / year (~1,000 / mo)",
                "<strong>Unlimited*</strong> resume analyses (fair use)",
                "<strong>Unlimited</strong> AI cover letters (fair use)",
                "Resume Builder: <strong>unlimited</strong> downloads (fair use)",
                "All Standard features + multi-resume versions & template pack",
                "Priority support & early access to new AI tools",
            ],
        },
    }

@app.route("/subscribe", methods=["GET", "POST"])
@login_required
def subscribe():
    plans = _plans()
    plan_code = (request.args.get("plan") or request.form.get("plan") or "").lower()
    if plan_code not in plans:
        return redirect(url_for("pricing"))

    # pick up ?next=... from query/form and validate it
    raw_next = request.args.get("next") or request.form.get("next") or ""
    next_url = raw_next if _is_safe_next(raw_next) else None

    plan_data = plans[plan_code]

    # --- FREE: do it locally (no Stripe) ---
    if request.method == "POST" and plan_code == "free":
        try:
            admin = current_app.config["SUPABASE_ADMIN"]
            auth_id = current_user.id

            # Enforce one-time Free
            used = False
            try:
                r = admin.table("users").select("free_plan_used").eq("auth_id", auth_id).single().execute()
                used = bool((r.data or {}).get("free_plan_used"))
            except Exception:
                pass

            if used:
                flash("You’ve already used the Free plan.", "error")
                return redirect(url_for("pricing"))

            # Activate Free and mark as used
            admin.table("users").update({
                "plan": "free",
                "plan_status": "active",
                "free_plan_used": True,
            }).eq("auth_id", auth_id).execute()

        except Exception:
            current_app.logger.exception("Could not activate free plan")
            flash("Could not activate free plan. Please try again.", "error")
            return redirect(url_for("pricing"))

        # if we have a safe next, jump back to what the user was doing
        if next_url:
            return redirect(next_url)

        return render_template(
            "subscribe-success.html",
            plan_human=plan_data["title"],
            plan_json="free",
        )

    # --- PAID: redirect to Stripe Checkout ---
    if request.method == "POST":
        PLAN_TO_PRICE = {
            "weekly":   os.getenv("STRIPE_PRICE_WEEKLY"),
            "standard": os.getenv("STRIPE_PRICE_STANDARD"),
            "premium":  os.getenv("STRIPE_PRICE_PREMIUM"),
        }
        price_id = PLAN_TO_PRICE.get(plan_code)
        if not price_id:
            flash("Billing not configured for this plan.", "error")
            return redirect(url_for("pricing"))
    
        # ensure the user has a Stripe customer
        try:
            customer_id = _get_or_create_stripe_customer(current_user)
        except Exception:
            current_app.logger.exception("Could not get/create Stripe customer")
            flash("We couldn't start checkout. Please contact support.", "error")
            return redirect(url_for("pricing"))
    
        base_success = url_for("stripe_success", _external=True)
        qs = {"session_id": "{CHECKOUT_SESSION_ID}"}
        if next_url:
            qs["next"] = next_url
        success_url = f"{base_success}?{urlencode(qs)}"
    
        cancel_url = url_for("pricing", _external=True) + "?cancelled=1"

        current_app.logger.info("Checkout success_url: %s", success_url)
    
        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=customer_id,
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            allow_promotion_codes=True,
            client_reference_id=str(current_user.id),
            metadata={"user_id": str(current_user.id), "plan_code": plan_code},
        )
        return redirect(session.url, code=303)

    # GET: confirm page
    # make sure your subscribe.html has a hidden <input name="next" value="{{ request.args.get('next', '') }}">
    return render_template("subscribe.html", plan_data=plan_data)
    

@app.get("/subscribe/success")
@login_required
def stripe_success():
    session_id = request.args.get("session_id")

    # Fallback: if session_id is missing or it's the literal placeholder (encoded or not)
    placeholder_vals = {"{CHECKOUT_SESSION_ID}", "%7BCHECKOUT_SESSION_ID%7D"}
    if (not session_id) or (session_id in placeholder_vals):
        # Try to recover by looking up the user's latest paid Checkout Session
        supabase = current_app.config["SUPABASE"]
        try:
            r = (
                supabase.table("users")
                .select("stripe_customer_id")
                .eq("auth_id", current_user.id)
                .single()
                .execute()
            )
            scid = (r.data or {}).get("stripe_customer_id")
        except Exception:
            scid = None

        if scid:
            try:
                # Get the most recent session for this customer
                sessions = stripe.checkout.Session.list(customer=scid, limit=1)
                if sessions.data:
                    cs = sessions.data[0]
                    # If paid, proceed as usual
                    if cs.payment_status == "paid":
                        metadata = cs.metadata or {}
                        customer_id = cs.customer
                        subscription_id = (
                            cs.subscription.id
                            if getattr(cs, "subscription", None)
                            else None
                        )
                        _activate_user_plan_by_metadata(
                            supabase, metadata, customer_id, subscription_id
                        )

                        # Handle ?next=... redirect if safe
                        raw_next = request.args.get("next")
                        if _is_safe_next(raw_next):
                            return redirect(raw_next)

                        plan_code = metadata.get("plan_code", "")
                        plan_name = _plans().get(plan_code, {}).get("title", "Your plan")
                        return render_template(
                            "subscribe-success.html",
                            plan_human=plan_name,
                            plan_json=plan_code,
                        )
            except Exception:
                current_app.logger.exception("Could not recover Checkout session")

        # As a last resort, just show a generic success page; webhooks will have activated the plan.
        flash("Payment completed. If features aren’t unlocked yet, they’ll be within a minute.", "info")
        return redirect(url_for("pricing"))

    # Normal path with a valid real session id
    cs = stripe.checkout.Session.retrieve(session_id, expand=["subscription"])
    if cs.payment_status != "paid":
        flash("Payment not completed yet. If this persists, contact support.", "error")
        return redirect(url_for("pricing"))

    supabase = current_app.config["SUPABASE"]
    metadata = cs.metadata or {}
    customer_id = cs.customer
    subscription_id = cs.subscription.id if getattr(cs, "subscription", None) else None

    _activate_user_plan_by_metadata(supabase, metadata, customer_id, subscription_id)

    # redirect back if we got a safe next
    raw_next = request.args.get("next")
    if _is_safe_next(raw_next):
        return redirect(raw_next)

    plan_code = metadata.get("plan_code", "")
    plan_name = _plans().get(plan_code, {}).get("title", "Your plan")
    return render_template("subscribe-success.html", plan_human=plan_name, plan_json=plan_code)

@app.get("/subscribe/free/success")
@login_required
def free_success():
    return render_template("subscribe-success.html",
                           plan_human=_plans()["free"]["title"],
                           plan_json="free")

# --- checkout helpers ---
def _activate_user_plan_by_metadata(supabase, metadata, customer_id=None, subscription_id=None):
    """Use metadata we set during Checkout to know who & what to update."""
    if not metadata:
        return
    user_id   = metadata.get("user_id")
    plan_code = metadata.get("plan_code")
    if not user_id or not plan_code:
        return
    try:
        supabase.table("users").update({
            "plan": plan_code,
            "plan_status": "active",
            "stripe_customer_id": customer_id,
            "stripe_subscription_id": subscription_id
        }).eq("auth_id", user_id).execute()
    except Exception:
        current_app.logger.exception("Failed to update user plan from webhook")


def _deactivate_user_plan_by_customer(supabase, customer_id):
    try:
        supabase.table("users").update({
            "plan": "free",
            "plan_status": "canceled"
        }).eq("stripe_customer_id", customer_id).execute()
    except Exception:
        current_app.logger.exception("Failed to downgrade after cancel")


# Map Stripe Price IDs -> your internal plan codes
PRICE_TO_PLAN = {
    os.getenv("STRIPE_PRICE_WEEKLY"):   "weekly",
    os.getenv("STRIPE_PRICE_STANDARD"): "standard",
    os.getenv("STRIPE_PRICE_PREMIUM"):  "premium",
}


def _find_user_id_by_customer(supabase, customer_id: str):
    if not customer_id:
        return None
    try:
        r = (
            supabase.table("users")
            .select("auth_id")
            .eq("stripe_customer_id", customer_id)
            .single()
            .execute()
        )
        return (r.data or {}).get("auth_id")
    except Exception:
        current_app.logger.exception("find user by customer failed")
        return None


def _update_user_plan_from_subscription(supabase, sub):
    """
    Keep the users table in sync with the Stripe subscription object.
    Handles plan mapping, status, and next renewal / expiry timestamps.
    """
    customer_id = sub.get("customer")
    user_id = _find_user_id_by_customer(supabase, customer_id)
    if not user_id:
        current_app.logger.warning("No user for customer %s", customer_id)
        return

    # price -> plan (use first item)
    items = sub.get("items", {}).get("data", [])
    price_id = items[0]["price"]["id"] if items else None
    plan_code = PRICE_TO_PLAN.get(price_id, "free")

    status = sub.get("status")  # active, trialing, past_due, canceled, unpaid, ...
    period_end = sub.get("current_period_end")  # epoch seconds
    ends_at = (
        None
        if not period_end
        else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(period_end))
    )

    db_update = {
        "stripe_subscription_id": sub.get("id"),
        "plan_status": status,
        "stripe_customer_id": customer_id,
    }

    if status in ("active", "trialing", "past_due"):
        # keep access (you can gate features separately if past_due)
        db_update.update({
            "plan": plan_code,
            "plan_renews_at": ends_at if status in ("active", "trialing") else None,
            "plan_expires_at": None if status in ("active", "trialing") else ends_at,
        })
    elif status in ("canceled", "unpaid", "incomplete_expired"):
        # allow access until end of period, then fall back to free
        db_update.update({
            "plan": plan_code if (period_end and period_end > time.time()) else "free",
            "plan_renews_at": None,
            "plan_expires_at": ends_at,
        })

    try:
        supabase.table("users").update(db_update).eq("auth_id", user_id).execute()
    except Exception:
        current_app.logger.exception("Failed updating user from subscription")


@app.post("/stripe/webhook")
def stripe_webhook():
    supabase = current_app.config["SUPABASE"]
    endpoint_secret = os.getenv("STRIPE_WEBHOOK_SECRET")
    payload = request.get_data(as_text=True)
    sig_header = request.headers.get("Stripe-Signature")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, endpoint_secret)
    except ValueError:
        return ("Bad payload", 400)
    except stripe.error.SignatureVerificationError:
        return ("Bad signature", 400)

    etype = event["type"]
    obj   = event["data"]["object"]

    if etype == "checkout.session.completed":
        # initial activation via Checkout
        metadata = obj.get("metadata", {}) or {}
        customer_id = obj.get("customer")
        subscription_id = obj.get("subscription")
        _activate_user_plan_by_metadata(supabase, metadata, customer_id, subscription_id)

    elif etype in ("customer.subscription.created", "customer.subscription.updated"):
        # continuous sync based on the subscription object
        _update_user_plan_from_subscription(supabase, obj)

    elif etype == "customer.subscription.deleted":
        customer_id = obj.get("customer")
        _deactivate_user_plan_by_customer(supabase, customer_id)

    elif etype == "invoice.payment_failed":
        # Optional: update plan_status to past_due or notify user
        pass

    return ("OK", 200)

@app.get("/api/me")
@login_required
def api_me():
    return jsonify({
        "email": current_user.email,
        "plan": getattr(current_user, "plan", "free"),
        "role": getattr(current_user, "role", "user"),
    })

@app.route("/api/plan", methods=["POST"])
@api_login_required
def update_plan():
    data = request.get_json(silent=True) or {}
    new_plan = (data.get("plan") or "").strip().lower()
    if not new_plan:
        return jsonify(error="bad_request", message="plan is required"), 400

    try:
        change_plan(current_user.id, new_plan)
        return jsonify(ok=True, plan=new_plan), 200
    except ValueError as e:
        return jsonify(error="plan_denied", message=str(e)), 403
    except Exception as e:
        current_app.logger.exception("update_plan failed")
        return jsonify(error="server_error", message="Something went wrong"), 500

# ----------------------------
# Email confirmation
# ----------------------------
@app.get("/check-email")
def check_email():
    email = session.get("pending_email")  # set this during signup
    return render_template("check-email.html", email=email)

@app.route("/resend-confirmation", methods=["GET"])
def resend_confirmation():
    """
    Resend email confirmation for a user.
    Looks for ?email=... first; falls back to session['pending_email'].
    Redirects back to /check-email with a flash message.
    """
    email = (request.args.get("email") or session.get("pending_email") or "").strip().lower()
    if not email:
        flash("We couldn’t find an email address to resend to.", "error")
        return redirect(url_for("check_email"))

    try:
        # Supabase Python SDK v2: resend a signup confirmation
        # If your SDK signature differs, adjust the call accordingly.
        supabase.auth.resend({"type": "signup", "email": email})
        flash("Confirmation email resent. Please check your inbox.", "success")
    except Exception:
        current_app.logger.exception("Resend confirmation failed")
        flash("Sorry, we couldn’t resend the email right now. Please try again later.", "error")

    return redirect(url_for("check_email"))

@app.route("/confirm")
def confirm_page():
    return render_template("confirm.html")

# ----------------------------
# Account routes (signup/login)
# ----------------------------

@app.route("/account", methods=["GET", "POST"])
def account():
    if request.method == "GET":
        mode = request.args.get("mode", "signup")
        free_used = False
        try:
            if current_user.is_authenticated:
                free_used = bool(getattr(current_user, "free_plan_used", False))
        except Exception:
            free_used = False
        return render_template("account.html", mode=mode, free_used=free_used)

    # ---- Robust input parsing (JSON OR form) ----
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = {}
    # Fallback to form fields if JSON was empty or missing
    if not data:
        data = request.form.to_dict() if request.form else {}

    # Tolerant field extraction
    mode = (data.get("mode") or request.args.get("mode") or "login").lower()
    email = (data.get("email") or request.form.get("email") or "").strip().lower()
    password = (data.get("password") or request.form.get("password") or "")
    name = (data.get("name") or request.form.get("name") or "").strip()

    # Basic validation
    if mode not in ("login", "signup"):
        mode = "login"  # be forgiving; default to login

    if not email or not password:
        return jsonify(success=False, message="Email and password are required."), 400

    if mode == "signup":
        # ---- keep your existing signup logic EXACTLY as you had it ----
        # (create user via supabase.auth.sign_up, insert DB row, auto-promote admin, etc.)
        # return the same JSON responses you already return
        try:
            resp = supabase.auth.sign_up({"email": email, "password": password})
            user = resp.user
            if not user:
                return jsonify(success=False, message="Signup failed."), 400

            ud = user.model_dump() if hasattr(user, "model_dump") else user
            auth_id = ud["id"]

            # Create DB user row (best-effort)
            try:
                supabase.table("users").insert({
                    "auth_id": auth_id, "email": email, "fullname": name
                }).execute()
            except Exception:
                pass

            # Auto-promote if in ADMIN_EMAILS (unchanged)
            admin_emails = {e.strip().lower() for e in (os.getenv("ADMIN_EMAILS") or "").split(",") if e.strip()}
            if email and email.lower() in admin_emails:
                try:
                    supabase.table("users").update({"role": "superadmin"}) \
                        .eq("auth_id", auth_id).execute()
                except Exception:
                    current_app.logger.exception("auto-promote admin failed")

            # If not confirmed yet, send to check email (unchanged)
            if not ud.get("email_confirmed_at"):
                session["pending_email"] = email
                return jsonify(success=True, redirect=url_for("check_email")), 200

            # Success path (unchanged)
            login_user(User(auth_id=auth_id, email=email, fullname=name))
            record_login_event(current_user)
            _, set_cookie = start_user_session(current_user)
            resp = jsonify(success=True, redirect=url_for("dashboard"))
            return set_cookie(resp), 200

        except AuthApiError as e:
            msg = str(e).lower()
            if "already registered" in msg:
                return jsonify(
                    success=False,
                    code="user_exists",
                    message="Account already exists. Please log in."
                ), 409
            current_app.logger.warning(f"Signup error for {email}: {e}")
            return jsonify(success=False, message="Signup failed."), 400
        except Exception:
            current_app.logger.exception("Unexpected signup error")
            return jsonify(success=False, message="Signup failed."), 400

    # mode == "login"
    try:
        resp = supabase.auth.sign_in_with_password({"email": email, "password": password})
        user = resp.user
        if not user:
            return jsonify(success=False, message="Invalid email or password."), 401

        ud = user.model_dump() if hasattr(user, "model_dump") else user
        auth_id = ud["id"]

        # Auto-promote admin (unchanged)
        admin_emails = {e.strip().lower() for e in (os.getenv("ADMIN_EMAILS") or "").split(",") if e.strip()}
        if email and email.lower() in admin_emails:
            try:
                supabase.table("users").update({"role": "superadmin"}) \
                    .eq("auth_id", auth_id).execute()
            except Exception:
                current_app.logger.exception("auto-promote admin failed")

        # Optional fullname fetch (unchanged)
        try:
            r = supabase.table("users").select("fullname").eq("auth_id", auth_id).single().execute()
            fullname = (r.data or {}).get("fullname")
        except Exception:
            fullname = None

        # Success path (unchanged)
        login_user(User(auth_id=auth_id, email=email, fullname=fullname))
        record_login_event(current_user)
        _, set_cookie = start_user_session(current_user)
        resp = jsonify(success=True, redirect=url_for("dashboard"))
        return set_cookie(resp), 200

    except AuthApiError as e:
        msg = str(e).lower()
        if "email not confirmed" in msg or "not confirmed" in msg:
            session["pending_email"] = email
            return jsonify(
                success=False,
                code="email_not_confirmed",
                message="Please confirm your email to continue.",
                redirect=url_for("check_email")
            ), 403
        if "invalid login credentials" in msg:
            return jsonify(success=False, message="Invalid email or password."), 401
        current_app.logger.warning(f"Login error for {email}: {e}")
        return jsonify(success=False, message="Login failed."), 400
    except Exception:
        current_app.logger.exception("Unexpected login error")
        return jsonify(success=False, message="Login failed."), 400


@app.route("/forgot-password", methods=["GET", "POST"])
def forgot_password():
    if request.method == "POST":
        email = (request.form.get("email") or "").strip().lower()
        if not email:
            flash("Please enter your email address.", "error")
            return render_template("forgot-password.html")

        supabase = current_app.config.get("SUPABASE")
        if not supabase:
            current_app.logger.error("Supabase client not initialized")
            flash("Server configuration error.", "error")
            return render_template("forgot-password.html")

        try:
            redirect_to = url_for("reset_password", _external=True)
            supabase.auth.reset_password_for_email(email, {"redirect_to": redirect_to})
        except Exception:
            current_app.logger.exception("Password reset request failed")
            flash("If that email exists, a reset link has been sent.", "success")
            return redirect(url_for("account", mode="login"))

        flash("If that email exists, a reset link has been sent.", "success")
        return redirect(url_for("account", mode="login"))

    return render_template("forgot-password.html")

@app.route("/reset-password", methods=["GET"])
def reset_password():
    return render_template(
        "reset-password.html",
        SUPABASE_URL=current_app.config["SUPABASE_URL"],
        SUPABASE_ANON_KEY=current_app.config["SUPABASE_ANON_KEY"],
    )

# ----------------------------
# Logout / Dashboard
# ----------------------------
@app.route("/logout")
def logout():
    return end_current_session(redirect_endpoint="account")

@app.get("/admin")
@require_superadmin
def admin_home():
    return "Hello, superadmin!"

@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("dashboard.html")

@app.route("/verify_token", methods=["POST"])
def verify_token():
    data = request.get_json(force=True)
    access_token = data.get("access_token")
    if not access_token:
        return jsonify(ok=False, error="Missing access_token"), 400

    try:
        user_resp = supabase.auth.get_user(access_token)
        user_obj = user_resp.user if hasattr(user_resp, "user") else user_resp
        user_data = user_obj.model_dump() if hasattr(user_obj, "model_dump") else user_obj
        auth_id = user_data["id"]
        email = user_data.get("email")

        try:
            row = supabase.table("users").select("auth_id").eq("auth_id", auth_id).maybe_single().execute()
            if not row.data:
                supabase.table("users").insert({"auth_id": auth_id, "email": email}).execute()
        except Exception as e:
            print("users upsert warn:", e)

        login_user(User(auth_id=auth_id, email=email))
        return jsonify(ok=True)
    except Exception as e:
        print("verify_token error:", e)
        return jsonify(ok=False, error="Token verification failed"), 400

# ----------------------------
# OAUTH
# ----------------------------

@app.get("/oauth/<provider>")
def oauth_start(provider):
    p = OAUTH_ALLOWED.get(provider.lower())
    if not p:
        return "Unsupported provider", 404

    supabase_url = current_app.config.get("SUPABASE_URL")
    base_url     = current_app.config.get("BASE_URL")

    if not supabase_url or not base_url:
        current_app.logger.error("Missing SUPABASE_URL or BASE_URL in app.config")
        return "Server misconfigured", 500

    params = {
        "provider": p,
        "redirect_to": f"{base_url}/auth/callback",  # <- must be allowed in Supabase
    }
    url = f"{supabase_url}/auth/v1/authorize?{urlencode(params)}"
    return redirect(url, code=302)

@app.get("/auth/callback")
def oauth_callback():
    """
    Supabase redirects here with tokens in the URL fragment (#access_token=...).
    The fragment is not visible to the server, so return a tiny page that grabs
    tokens with JS and posts them to /auth/complete.
    """
    # A minimal HTML/JS bridge page:
    html = f"""
<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Signing you in…</title></head>
  <body style="font-family:system-ui;margin:40px">
    <p>Signing you in…</p>
    <script>
      (function() {{
        const h = new URLSearchParams(location.hash.slice(1));
        const access_token  = h.get("access_token");
        const refresh_token = h.get("refresh_token");
        const provider_token = h.get("provider_token"); // sometimes present

        if(!access_token){{
          location.replace("/account?mode=login&error=oauth_no_token");
          return;
        }}

        fetch("/auth/complete", {{
          method: "POST",
          headers: {{ "Content-Type": "application/json" }},
          credentials: "same-origin",
          body: JSON.stringify({{ access_token, refresh_token, provider_token }})
        }}).then(r => r.json()).then(j => {{
          if (j && j.success) {{
            location.replace(j.redirect || "/dashboard");
          }} else {{
            location.replace("/account?mode=login&error=" + encodeURIComponent(j.message || "oauth_failed"));
          }}
        }}).catch(() => {{
          location.replace("/account?mode=login&error=oauth_failed");
        }});
      }})();
    </script>
  </body>
</html>
"""
    return html

@app.post("/auth/complete")
def oauth_complete():
    """
    Finish OAuth: verify the Supabase access token, upsert user row, create Jobcus session.
    """
    try:
        data = request.get_json(silent=True) or {}
        access_token = (data.get("access_token") or "").strip()
        if not access_token:
            return jsonify(success=False, message="Missing access token"), 400

        # Ask Supabase Auth who this token belongs to
        # (Equivalent to supabase.auth.get_user(access_token) in JS)
        with httpx.Client(timeout=10) as client:
            r = client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={"Authorization": f"Bearer {access_token}", "apikey": SUPABASE_ANON},
            )
        if r.status_code != 200:
            current_app.logger.warning("OAuth token verify failed: %s %s", r.status_code, r.text)
            return jsonify(success=False, message="Token verification failed"), 401

        ud = r.json() or {}
        auth_id = ud.get("id")
        email   = (ud.get("email") or "").lower()
        fullname = (ud.get("user_metadata") or {}).get("full_name") or ud.get("user_metadata", {}).get("name")

        if not auth_id or not email:
            return jsonify(success=False, message="Incomplete user info"), 400

        # Ensure a row exists in your 'users' table (best-effort)
        try:
            current_app.config["SUPABASE_ADMIN"].table("users").upsert(
                {"auth_id": auth_id, "email": email, "fullname": fullname},
                on_conflict="auth_id"
            ).execute()
        except Exception:
            current_app.logger.exception("users upsert failed (oauth)")

        # Create your Flask login + session, same as password flow
        login_user(User(auth_id=auth_id, email=email, fullname=fullname))
        record_login_event(current_user)
        _, set_cookie = start_user_session(current_user)

        resp = jsonify(success=True, redirect=url_for("dashboard"))
        return set_cookie(resp), 200

    except Exception:
        current_app.logger.exception("oauth_complete failed")
        return jsonify(success=False, message="OAuth failed"), 500

# ----------------------------
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

# SINGLE SOURCE OF TRUTH for chat
@app.post("/api/ask")
@api_login_required
def api_ask():
    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    model   = (data.get("model")   or "gpt-4o-mini").strip()
    conv_id = data.get("conversation_id")

    if not message:
        return jsonify(error="bad_request", message="message is required"), 400

    auth_id = getattr(current_user, "id", None) or getattr(current_user, "auth_id", None)
    plan    = (getattr(current_user, "plan", "free") or "free").lower()

    # 1) free plan guard (per-device/day)
    try:
        ok, payload = allow_free_use(str(auth_id), plan)
        if not ok:
            return jsonify({
                "error": payload.get("error") or "too_many_free_accounts",
                "message": payload.get("message") or "Free daily limit reached for this device."
            }), 429
    except Exception:
        pass  # fail-open

    # 2) credits/quota — this is what fixes the “0 of 10” staying at 0
    admin = current_app.config.get("SUPABASE_ADMIN")
    if not admin:
        return jsonify(error="server_config", message="Supabase admin client is not configured."), 500

    ok, info = check_and_increment(admin, str(auth_id), plan, "chat_messages")
    if not ok:
        info.setdefault("error", "quota_exceeded")
        info.setdefault("message", "You’ve reached your plan limit for this feature.")
        return jsonify(info), 402

    # Optional soft caps (ignore failures)
    try:
        check_and_increment(admin, str(auth_id), plan, "chat_messages_hour")
        check_and_increment(admin, str(auth_id), plan, "chat_messages_day")
    except Exception:
        pass

    # 3) ensure conversation row (optional but nice to have)
    if not conv_id:
        title = (message[:60] + "…") if len(message) > 60 else message
        row = admin.table("conversations").insert(
            {"auth_id": auth_id, "title": title or "Conversation"}
        ).execute()
        conv_id = row.data[0]["id"]

    # 4) persist user message
    admin.table("conversation_messages").insert({
        "conversation_id": conv_id, "role": "user", "content": message
    }).execute()

    # 5) grab short history window
    ctx = admin.table("conversation_messages") \
        .select("role,content") \
        .eq("conversation_id", conv_id) \
        .order("created_at", desc=True).limit(8).execute().data or []
    history = list(reversed(ctx))

    # 6) call model
    ai_reply = _chat_completion(model=model, user_msg=message, history=history)

    # 7) persist assistant message
    admin.table("conversation_messages").insert({
        "conversation_id": conv_id, "role": "assistant", "content": ai_reply
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

@app.route("/jobs", methods=["POST"])
def get_jobs():
    try:
        data     = request.json
        query    = data.get("query","")
        location = data.get("location","")
        jtype    = data.get("jobType","").lower()

        rem = fetch_remotive_jobs(query) if jtype in ["remote",""] else []
        adz = fetch_adzuna_jobs(query, location, jtype) if jtype in ["onsite","hybrid",""] else []
        js  = [] if rem or adz else fetch_jsearch_jobs(query)

        return jsonify(remotive=rem, adzuna=adz, jsearch=js)
    except Exception:
        return jsonify(remotive=[], adzuna=[], jsearch=[])

@app.route("/api/salary")
@api_login_required
def get_salary_data():
    return jsonify(labels=JOB_TITLES, salaries=fetch_salary_data())

@app.route("/api/job-count")
@login_required
def get_job_count_data():
    level = job_insights_level(getattr(current_user, "plan", "free"))
    labels = JOB_TITLES
    counts = fetch_job_counts()
    if level == "basic":
        labels = labels[:3]
        counts = counts[:3]
    return jsonify(labels=labels, counts=counts)

@app.route("/api/skills")
def get_skills_data():
    freq = fetch_skill_trends()
    return jsonify(labels=list(freq.keys()), frequency=list(freq.values()))

@app.route("/api/locations")
def get_location_data():
    locs = fetch_location_counts()
    return jsonify(labels=[l[0] for l in locs], counts=[l[1] for l in locs])

@app.route("/admin/settings")
@require_superadmin
def admin_settings():
    return render_template("admin/settings.html")

# ----------------------------
# Cover Letter
# ----------------------------

@app.route('/cover-letter')
def cover_letter():
    # Always provide defaults so the template can't blow up
    return render_template(
        "cover-letter.html",
        letter_only=False,   # make explicit
        sender={}, recipient={}, draft=""
    )

ai_bp = Blueprint("ai", __name__)

@ai_bp.route("/ai/cover-letter", methods=["POST"])
@login_required  # or your @api_login_required
def ai_cover_letter():
    data = request.get_json(silent=True) or {}
    tone = (data.get("tone") or "professional").strip()

    sender = data.get("sender") or {}
    recipient = data.get("recipient") or {}

    prompt = f"""
Write a {tone} cover letter body (4–6 paragraphs max).
Sender:
- Name: {sender.get('first_name','')} {sender.get('last_name','')}
- Email: {sender.get('email','')}
- Phone: {sender.get('phone','')}
- Location: {sender.get('address1','')} {sender.get('city','')} {sender.get('postcode','')}

Recipient:
- Name/Team: {recipient.get('name','Hiring Manager')}
- Company: {recipient.get('company','')}
- Location: {recipient.get('address1','')} {recipient.get('city','')} {recipient.get('postcode','')}
- Role: {recipient.get('role','')}

Return only the letter body text (no greeting/closing signatures).
    """.strip()

    try:
        # Replace with your helper that calls OpenAI (or equivalent)
        draft = _chat_completion(
            model="gpt-4o-mini",
            user_msg=prompt,
            history=[]
        )
    except Exception as e:
        current_app.logger.exception("cover-letter AI failed")
        return jsonify(error="ai_error", message=str(e)), 500

    return jsonify(draft=draft), 200

app.register_blueprint(ai_bp)

# app.py (or wherever set_security_headers lives)
from flask import request

@app.after_request
def set_security_headers(resp):
    csp = (
        "default-src 'self'; "
        "img-src 'self' data: https:; "
        # keep https: so fonts.googleapis.com CSS still loads + allow Stripe's style usage
        "style-src 'self' 'unsafe-inline' https: https://js.stripe.com; "
        # allow Stripe + your CDNs
        "script-src 'self' 'unsafe-inline' "
            "https://js.stripe.com "
            "https://www.googletagmanager.com "
            "https://cdn.jsdelivr.net "
            "https://cdnjs.cloudflare.com "
            "https://unpkg.com; "
        # allow API calls broadly to https (covers Stripe endpoints too)
        "connect-src 'self' https:; "
        # fonts can come from your host or CDNs/data URIs
        "font-src 'self' https: data:; "
        # iframes/popups used by Stripe Checkout/Elements/Portal
        "frame-src 'self' https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com; "
        "frame-ancestors 'self'; "
        "base-uri 'self'; "
        "upgrade-insecure-requests"
    )
    resp.headers["Content-Security-Policy"] = csp
    return resp


@app.route("/api/skill-gap", methods=["POST"])
@login_required
def skill_gap_api():
    # Parse input early
    try:
        data = request.get_json(force=True) or {}
    except Exception:
        current_app.logger.exception("skill-gap: invalid JSON")
        return jsonify(error="bad_request", message="Invalid JSON body"), 400

    goal   = (data.get("goal") or "").strip()
    skills = (data.get("skills") or "").strip()
    if not goal or not skills:
        return jsonify(error="bad_request", message="Please provide both career goal and current skills."), 400

    # Quota (safe)
    try:
        supabase_admin = current_app.config.get("SUPABASE_ADMIN")
        plan = (getattr(current_user, "plan", "free") or "free").lower()
        if supabase_admin:
            ok, info = check_and_increment(supabase_admin, current_user.id, plan, "skill_gap")
            if not ok:
                PRICING_URL = "https://www.jobcus.com/pricing"
                info.setdefault("error", "quota_exceeded")
                info.setdefault("message", "You’ve reached your plan limit for this feature.")
                info.setdefault("message_html", f'You’ve reached your plan limit for this feature. <a href="{PRICING_URL}">Upgrade now →</a>')
                info.setdefault("pricing_url", PRICING_URL)
                return jsonify(info), 402

    except Exception:
        current_app.logger.warning("skill-gap: quota check failed", exc_info=True)
        # continue without failing the request

    # Build prompt (Markdown output) & call OpenAI (soft-fail if missing)
    prompt = f"""
You are a concise career advisor.
Target role/goal: {goal}
Current skills: {skills}

Return the result in **Markdown format** with:
- A clear header "Skill Gap Analysis"
- Bold section titles for each group (Core Skills, Tools & Platforms, Certifications, Projects/Experience)
- Bullet points under each section
- Short, practical learning steps

Example format:

## Skill Gap Analysis

**Core Skills**
- Bullet 1
- Bullet 2

**Tools & Platforms**
- Bullet 1
- Bullet 2

**Certifications**
- Bullet 1
- Bullet 2

**Projects / Experience**
- Bullet 1
- Bullet 2
""".strip()

    client = current_app.config.get("OPENAI_CLIENT")
    if not client:
        # Fallback text so the page still works
        fallback = (
            "## Skill Gap Analysis\n\n"
            "**Core Skills**\n"
            "- Identify 5 core skills from recent job posts; plan 6 weeks of practice.\n"
            "- Take an intermediate course; build weekly mini-projects.\n\n"
            "**Tools & Platforms**\n"
            "- Pick 1–2 tools used in most listings; complete their quickstarts.\n"
            "- Rebuild a small portfolio project end-to-end with those tools.\n\n"
            "**Certifications**\n"
            "- Choose one entry/intermediate cert; schedule it 6–8 weeks out.\n\n"
            "**Projects / Experience**\n"
            "- Build 2–3 scoped projects mirroring job tasks; publish with clear READMEs.\n"
            "- Write a one-page case study (problem → approach → result) for each."
        )
        return jsonify(result=fallback, aiUsed=False), 200

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
            max_tokens=600,
        )
        reply = (resp.choices[0].message.content or "").strip()
        return jsonify(result=reply, aiUsed=True), 200
    except Exception as e:
        current_app.logger.exception("skill-gap: OpenAI call failed")
        # Return JSON (not an HTML error page)
        return jsonify(error="ai_error", message=str(e)), 502


# Require login + quota for interview endpoints so pricing is enforced
def _quota_check(feature_key: str):
    """Small helper to keep quota code tidy and safe."""
    try:
      supabase_admin = current_app.config.get("SUPABASE_ADMIN")
      plan = (getattr(current_user, "plan", "free") or "free").lower()
      if supabase_admin:
          from limits import check_and_increment
          ok, info = check_and_increment(supabase_admin, current_user.id, plan, feature_key)
          if not ok:
              PRICING_URL = "https://www.jobcus.com/pricing"
              info.setdefault("error", "quota_exceeded")
              info.setdefault("message", "You’ve reached your plan limit for this feature.")
              info.setdefault("message_html", f'You’ve reached your plan limit for this feature. <a href="{PRICING_URL}">Upgrade now →</a>')
              info.setdefault("pricing_url", PRICING_URL)
              return False, info
      return True, None
    except Exception:
      current_app.logger.warning("quota check failed for %s", feature_key, exc_info=True)
      # If quota infra is down, don't hard-fail: let the request continue
      return True, None

def _need_client():
    client = current_app.config.get("OPENAI_CLIENT")
    if not client:
        return None, (jsonify(error="ai_unavailable",
                              message="AI is temporarily unavailable. Please try again later."), 503)
    return client, None


@app.route("/api/interview", methods=["POST"])
@login_required
def interview_coach_api():
    # Quota
    allowed, info = _quota_check("interview_coach")
    if not allowed:
        PRICING_URL = "https://www.jobcus.com/pricing"
        info.setdefault("error", "quota_exceeded")
        info.setdefault("message", "You’ve reached your plan limit for this feature.")
        info.setdefault("message_html", f'You’ve reached your plan limit for this feature. <a href="{PRICING_URL}">Upgrade now →</a>')
        info.setdefault("pricing_url", PRICING_URL)
        return jsonify(info), 402

    # Parse input safely
    try:
        data = request.get_json(force=True) or {}
    except Exception:
        current_app.logger.exception("interview: invalid JSON")
        return jsonify(error="bad_request", message="Invalid JSON body"), 400

    role = (data.get("role") or "").strip()
    exp  = (data.get("experience") or "").strip()
    if not role or not exp:
        return jsonify(error="bad_request", message="Missing role or experience"), 400

    client, err = _need_client()
    if err:
        return err

    # Markdown-shaped prompt for “coach pack” (Q&A samples)
    prompt = f"""
You are a concise interview coach.

Role: {role}
Candidate seniority: {exp}

Return the result in **Markdown** with:
- Header: "## Interview Coach"
- **Bold** subsection titles
- Bullet points (short, practical)
- At least **3 Q&A samples** (question + compact model answer)

Sections:
1) **Likely Questions** — 6–10 bullets
2) **Sample Q&A** — at least 3 bullets; each: “**Q:** …  **A:** …”
3) **Tips** — 5–7 bullets

Keep each line short. Avoid tables. Plain Markdown only.
""".strip()

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.5,
            max_tokens=900,
        )
        out = (resp.choices[0].message.content or "").strip()
        return jsonify(result=out), 200
    except Exception:
        logging.exception("Interview coach error")
        return jsonify(error="server_error", message="Unable to generate interview guide."), 500


@app.route("/api/interview/question", methods=["POST"])
@login_required
def get_interview_question():
    # Quota
    allowed, info = _quota_check("interview_coach")
    if not allowed:
        PRICING_URL = "https://www.jobcus.com/pricing"
        info.setdefault("error", "quota_exceeded")
        info.setdefault("message", "You’ve reached your plan limit for this feature.")
        info.setdefault("message_html", f'You’ve reached your plan limit for this feature. <a href="{PRICING_URL}">Upgrade now →</a>')
        info.setdefault("pricing_url", PRICING_URL)
        return jsonify(info), 402

    # Parse input
    try:
        data   = request.get_json(force=True) or {}
    except Exception:
        current_app.logger.exception("interview/question: invalid JSON")
        return jsonify(error="bad_request", message="Invalid JSON body"), 400

    prev   = (data.get("previousRole") or "").strip()
    target = (data.get("targetRole") or "").strip()
    exp    = (data.get("experience") or "").strip()
    if not prev or not target or not exp:
        return jsonify(error="bad_request", message="Missing inputs"), 400

    client, err = _need_client()
    if err:
        return err

    prompt = f"""
You are a virtual interview coach.
Ask exactly **one** job-specific interview question (no preface, no follow-up, one sentence).

Candidate previous role: {prev}
Target role: {target}
Seniority: {exp}
""".strip()

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.6,
            max_tokens=120,
        )
        question = (resp.choices[0].message.content or "").strip()
        # Strip markdown fences if any creep in
        question = question.replace("```", "").strip()
        return jsonify(question=question), 200
    except Exception:
        logging.exception("Interview question error")
        return jsonify(error="server_error", message="Unable to generate question."), 500


@app.route("/api/interview/feedback", methods=["POST"])
@login_required
def get_interview_feedback():
    # Quota
    allowed, info = _quota_check("interview_coach")
    if not allowed:
        PRICING_URL = "https://www.jobcus.com/pricing"
        info.setdefault("error", "quota_exceeded")
        info.setdefault("message", "You’ve reached your plan limit for this feature.")
        info.setdefault("message_html", f'You’ve reached your plan limit for this feature. <a href="{PRICING_URL}">Upgrade now →</a>')
        info.setdefault("pricing_url", PRICING_URL)
        return jsonify(info), 402

    # Parse input
    try:
        data = request.get_json(force=True) or {}
    except Exception:
        current_app.logger.exception("interview/feedback: invalid JSON")
        return jsonify(error="bad_request", message="Invalid JSON body"), 400

    question = (data.get("question") or "").strip()
    answer   = (data.get("answer") or "").strip()
    prev     = (data.get("previousRole") or "").strip()
    target   = (data.get("targetRole") or "").strip()
    exp      = (data.get("experience") or "").strip()

    if not question or not answer:
        return jsonify(error="bad_request", message="Missing question or answer"), 400

    client, err = _need_client()
    if err:
        return err

    # Ask for Markdown so the front-end can render nicely (bullets, bold)
    prompt = f"""
You are an interview coach. Provide structured feedback in **Markdown**.

Context:
- Previous role: {prev or "N/A"}
- Target role: {target or "N/A"}
- Seniority: {exp or "N/A"}

**Question**
{question}

**Candidate Answer**
{answer}

Return:
- **Feedback** (bulleted, concise; mention strengths + specific improvements)
- **Fallback Suggestions** (2–4 short bullets the candidate can say if stuck)
Plain Markdown only; no tables.
""".strip()

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.5,
            max_tokens=600,
        )
        content = (resp.choices[0].message.content or "").strip()

        # Return the whole Markdown; front-end will render with marked.js
        # Also try to extract quick fallback bullets as a convenience:
        fallbacks = []
        try:
            # naive split on header line if present
            parts = content.split("\n")
            i = next((k for k, ln in enumerate(parts) if "fallback" in ln.lower()), None)
            if i is not None:
                for ln in parts[i+1:]:
                    if ln.lstrip().startswith(("-", "•", "*")):
                        fallbacks.append(ln.lstrip("-•* ").strip())
        except Exception:
            pass

        return jsonify(feedback=content, fallbacks=fallbacks), 200
    except Exception:
        logging.exception("Interview feedback error")
        return jsonify(error="server_error", message="Error generating feedback."), 500
        

# --- Register the resume blueprint last (after app/config exists) ---
if resumes_bp is not None:
    app.register_blueprint(resumes_bp)
else:
    # App still runs without the resumes routes
    app.logger.warning("Skipping app.register_blueprint(resumes_bp): not found")


# ---------- Employer: Inquiry + AI Job Post (updated) ----------
@app.post("/api/employer-inquiry")
def employer_inquiry():
    try:
        data = request.get_json(force=True, silent=True) or {}
    except Exception:
        return jsonify(error="Invalid JSON body"), 400

    name  = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip()
    phone = (data.get("phone") or "").strip()
    if not (name and email and phone):
        return jsonify(error="name, email and phone are required"), 400

    row = {
        "company":   (data.get("company") or "").strip(),
        "name":      name,
        "email":     email,
        "phone":     phone,
        "job_roles": (data.get("job_roles") or "").strip(),
        "message":   (data.get("message") or "").strip(),
    }

    try:
        supabase = current_app.config.get("SUPABASE_ADMIN") or current_app.config.get("SUPABASE")
        if not supabase:
            current_app.logger.warning("SUPABASE_ADMIN not configured; skipping insert")
            return jsonify(ok=True, skipped_db=True)
        res = supabase.table("employer_inquiries").insert(row).execute()
        if getattr(res, "error", None):
            current_app.logger.error("Supabase insert error: %s", res.error)
            return jsonify(error="Could not save inquiry"), 500
        return jsonify(ok=True)
    except Exception:
        current_app.logger.exception("employer_inquiry failed")
        return jsonify(error="Server error"), 500


@app.post("/api/employer/job-post")
def employer_job_post():
    try:
        data = request.get_json(force=True, silent=True) or {}
    except Exception:
        return jsonify(error="Invalid JSON body"), 400

    job_title = (data.get("jobTitle") or "").strip()
    company   = (data.get("company") or "").strip()
    location  = (data.get("location") or "").strip()
    emp_type  = (data.get("employmentType") or "").strip()
    salary    = (data.get("salaryRange") or "").strip()
    apply_to  = (data.get("applicationEmail") or "").strip()
    deadline  = (data.get("applicationDeadline") or "").strip()
    summary   = (data.get("summary") or "").strip()

    if not job_title or not company:
        return jsonify(error="jobTitle and company are required"), 400

    client = current_app.config.get("OPENAI_CLIENT")
    prompt = f"""
Write a clear, professional job description in UK English.

Job Title: {job_title}
Company: {company}
Location: {location or "—"}
Employment Type: {emp_type or "—"}
Salary Range: {salary or "—"}
How to Apply: {apply_to or "—"}
Application Deadline: {deadline or "—"}

Opening Summary:
{summary or "—"}

Structure:
- Brief company/role intro (2–3 sentences)
- Responsibilities (5–8 concise bullets)
- Requirements (5–8 concise bullets)
- Nice-to-haves (optional, 3–5 bullets)
- Benefits (optional, 3–6 bullets)
- How to apply (1–2 lines)
Keep bullets short (8–18 words). Avoid clichés and buzzwords.
Return PLAIN TEXT (no markdown, no headings like 'Responsibilities:'); use blank lines between sections.
""".strip()

    if not client:
        text = (
            f"{company} is hiring a {job_title} in {location or 'our UK team'}.\n\n"
            "Responsibilities:\n"
            "- Deliver key projects with cross-functional teams.\n"
            "- Communicate clearly with stakeholders and manage timelines.\n"
            "- Improve processes and document best practices.\n\n"
            "Requirements:\n"
            "- Relevant experience in similar roles.\n"
            "- Strong communication and problem-solving skills.\n"
            "- Ability to work independently and in teams.\n\n"
            f"How to apply: {apply_to or 'Send your CV to careers@company.com'}"
        )
        return jsonify(description=text)

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role":"user","content":prompt}],
            temperature=0.5,
            max_tokens=900
        )
        text = (resp.choices[0].message.content or "").strip()
        text = re.sub(r"```(?:\w+)?", "", text).strip()
        return jsonify(description=text)
    except Exception:
        current_app.logger.exception("job-post generation failed")
        return jsonify(error="Generation failed"), 500

@app.post("/api/employer/job-post/download")
@login_required
def employer_job_post_download():
    """
    JSON body: { "format": "txt"|"pdf", "text": "<job description>" }
    Enforces plan 'downloads' gate, returns file as attachment.
    """
    PRICING_URL = "https://www.jobcus.com/pricing"

    data = request.get_json(force=True, silent=True) or {}
    fmt  = (data.get("format") or "txt").lower()
    text = (data.get("text") or "").strip()

    if not text:
        return jsonify(error="No text provided"), 400

    # Gate like other downloads
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    if not feature_enabled(plan, "downloads"):
        return jsonify(
            error="upgrade_required",
            message="File downloads are available on Standard and Premium.",
            message_html=f'File downloads are available on Standard and Premium. <a href="{PRICING_URL}">Upgrade now →</a>',
            pricing_url=PRICING_URL
        ), 403

    if fmt == "txt":
        buf = BytesIO(text.encode("utf-8"))
        return send_file(
            buf,
            as_attachment=True,
            download_name="job-description.txt",
            mimetype="text/plain"
        )

    if fmt == "pdf":
        safe_html = f"""
        <html><head><meta charset="utf-8"></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height:1.5; font-size:12pt;">
          <pre style="white-space:pre-wrap; word-wrap:break-word; margin:0;">{escape(text)}</pre>
        </body></html>
        """.strip()
        pdf_bytes = HTML(string=safe_html, base_url=current_app.root_path).write_pdf(
            stylesheets=[CSS(string="@page{size:A4;margin:0.75in}")]
        )
        return send_file(
            BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=True,
            download_name="job-description.pdf"
        )

    return jsonify(error="Unsupported format"), 400

# --- Entrypoint ---
if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
