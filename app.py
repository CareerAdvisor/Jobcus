import os, stripe, hashlib, hmac, time
import traceback
from io import BytesIO
from collections import Counter
import re, json, base64, logging, requests
from functools import wraps
from auth_utils import api_login_required, is_staff, is_superadmin, require_superadmin

from flask import (
    Blueprint, Flask, request, jsonify, render_template, redirect,
    session, flash, url_for, current_app, make_response, g, current_app as app
)
from flask_cors import CORS
from flask_login import (
    login_user, logout_user, current_user,
    login_required, user_logged_in, UserMixin
)
from gotrue.errors import AuthApiError
from dotenv import load_dotenv

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
# --- Load resumes blueprint robustly ---
import importlib, importlib.util, pathlib, sys, logging

app = Flask(__name__)
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

# NOTE: make static path explicit to avoid zero-byte responses in prod
app = Flask(__name__, static_folder="static", static_url_path="/static")
app.secret_key = os.getenv("SECRET_KEY", "supersecret")

# Session cookie hardening
app.config.update(
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_SAMESITE="Lax",
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
login_manager.init_app(app)
login_manager.login_view = "account"

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
                "company_name": job.get("company_name"),
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

@app.route('/privacy-policy')
def privacy_policy():
    return render_template("privacy-policy.html")

@app.route('/terms-of-service')
def terms_of_service():
    return render_template('terms-of-service.html')

@app.route("/pricing")
def pricing():
    return render_template("pricing.html")

def _plans():
    return {
        "free": {
            "code":"free", "title":"Free", "amount":"0", "period":"/mo",
            "tagline":"Great for a quick check",
            "features":[
                "<strong>3</strong> resume analyses / month (basic score + tips)",
                "<strong>2</strong> AI cover letters / month",
                "AI Resume Builder (basic templates)",
                "Skill-Gap snapshot (1 basic analysis)",
                "Job Insights (basic charts)",
                "Interview Coach (limited practice)",
                "AI Chat trial: <strong>15 messages</strong> total",
                "Local device history",
            ],
        },
        "weekly": {
            "code":"weekly", "title":"Weekly Pass", "amount":"7<span class='cents'>.99</span>", "period":"/week",
            "tagline":"For urgent applications",
            "features":[
                "AI Chat credits: <strong>200 messages</strong> / week",
                "<strong>10</strong> resume analyses / week",
                "<strong>5</strong> AI cover letters / week",
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
                "AI Chat credits: <strong>800 messages</strong> / month",
                "<strong>50</strong> resume analyses / month (deep ATS + JD match)",
                "<strong>20</strong> AI cover letters / month",
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
                "AI Chat credits: <strong>12,000 messages</strong> / year (~1,000 / mo)",
                "<strong>Unlimited*</strong> resume analyses (fair use)",
                "<strong>Unlimited</strong> AI cover letters (fair use)",
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

    plan_data = plans[plan_code]

    # --- FREE: do it locally (no Stripe) ---
    if request.method == "POST" and plan_code == "free":
        try:
            supabase = current_app.config["SUPABASE"]
            supabase.table("users").update({
                "plan": "free",
                "plan_status": "active"
            }).eq("auth_id", current_user.id).execute()
        except Exception:
            current_app.logger.exception("Could not activate free plan")
            flash("Could not activate free plan. Please try again.", "error")
            return redirect(url_for("pricing"))

        return render_template(
            "subscribe-success.html",
            plan_human=plan_data["title"],
            plan_json="free",
        )

    # --- PAID: redirect to Stripe ---
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

        success_url = url_for("stripe_success", _external=True) + "?session_id={CHECKOUT_SESSION_ID}"
        cancel_url  = url_for("pricing", _external=True) + "?cancelled=1"

        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            allow_promotion_codes=True,
            metadata={"user_id": current_user.id, "plan_code": plan_code},
        )
        return redirect(session.url, code=303)

    # GET: confirm page
    return render_template("subscribe.html", plan_data=plan_data)

@app.get("/subscribe/success")
@login_required
def stripe_success():
    session_id = request.args.get("session_id")
    if not session_id:
        return redirect(url_for("pricing"))

    cs = stripe.checkout.Session.retrieve(session_id, expand=["subscription"])
    if cs.payment_status != "paid":
        flash("Payment not completed yet. If this persists, contact support.", "error")
        return redirect(url_for("pricing"))

    supabase = current_app.config["SUPABASE"]
    metadata = cs.metadata or {}
    customer_id = cs.customer
    subscription_id = cs.subscription.id if getattr(cs, "subscription", None) else None

    _activate_user_plan_by_metadata(supabase, metadata, customer_id, subscription_id)

    plan_code = metadata.get("plan_code", "")
    plan_name = _plans().get(plan_code, {}).get("title", "Your plan")
    return render_template("subscribe-success.html", plan_human=plan_name, plan_json=plan_code)

@app.get("/subscribe/free/success")
@login_required
def free_success():
    return render_template("subscribe-success.html",
                           plan_human=_plans()["free"]["title"],
                           plan_json="free")


# --- checkout ---
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
        metadata = obj.get("metadata", {}) or {}
        customer_id = obj.get("customer")
        subscription_id = obj.get("subscription")
        _activate_user_plan_by_metadata(supabase, metadata, customer_id, subscription_id)

    elif etype in ("customer.subscription.created", "customer.subscription.updated"):
        metadata = obj.get("metadata", {}) or {}
        customer_id = obj.get("customer")
        subscription_id = obj.get("id")
        _activate_user_plan_by_metadata(supabase, metadata, customer_id, subscription_id)

    elif etype == "customer.subscription.deleted":
        customer_id = obj.get("customer")
        _deactivate_user_plan_by_customer(supabase, customer_id)

    elif etype == "invoice.payment_failed":
        # Optional: mark as past_due or notify the user
        pass

    return ("OK", 200)

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
        return render_template("account.html", mode=mode)

    data = request.get_json(force=True)
    mode = (data.get("mode") or "").lower()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    name = (data.get("name") or "").strip()

    if not email or not password:
        return jsonify(success=False, message="Email and password are required."), 400

    if mode == "signup":
        try:
            resp = supabase.auth.sign_up({"email": email, "password": password})
            user = resp.user
            if not user:
                return jsonify(success=False, message="Signup failed."), 400

            ud = user.model_dump() if hasattr(user, "model_dump") else user
            auth_id = ud["id"]

            # Create DB user row
            try:
                supabase.table("users").insert({
                    "auth_id": auth_id, "email": email, "fullname": name
                }).execute()
            except Exception:
                pass

            # ✅ Auto-promote if email is in ADMIN_EMAILS
            admin_emails = {e.strip().lower() for e in (os.getenv("ADMIN_EMAILS") or "").split(",") if e.strip()}
            if email and email.lower() in admin_emails:
                try:
                    supabase.table("users").update({"role": "superadmin"}) \
                        .eq("auth_id", auth_id).execute()
                except Exception:
                    current_app.logger.exception("auto-promote admin failed")

            # ⬇️ remember email for the /check-email page
            if not ud.get("email_confirmed_at"):
                session["pending_email"] = email
                return jsonify(success=True, redirect=url_for("check_email")), 200

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
            return jsonify(success=False, message="Signup failed."), 400

    elif mode == "login":
        try:
            resp = supabase.auth.sign_in_with_password({"email": email, "password": password})
            user = resp.user
            if not user:
                return jsonify(success=False, message="Invalid login credentials."), 400

            ud = user.model_dump() if hasattr(user, "model_dump") else user
            auth_id = ud["id"]

            # ✅ Auto-promote if email is in ADMIN_EMAILS
            admin_emails = {e.strip().lower() for e in (os.getenv("ADMIN_EMAILS") or "").split(",") if e.strip()}
            if email and email.lower() in admin_emails:
                try:
                    supabase.table("users").update({"role": "superadmin"}) \
                        .eq("auth_id", auth_id).execute()
                except Exception:
                    current_app.logger.exception("auto-promote admin failed")

            try:
                r = supabase.table("users").select("fullname").eq("auth_id", auth_id).single().execute()
                fullname = (r.data or {}).get("fullname")
            except Exception:
                fullname = None

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
            return jsonify(success=False, message="Login failed."), 400

    return jsonify(success=False, message="Unknown mode."), 400

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
# Ask
# ----------------------------
ask_bp = Blueprint("ask", __name__)

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

# ----------------------------
# Skill Gap & Interview Coach
# ----------------------------
@app.route("/api/skill-gap", methods=["POST"])
@login_required
def skill_gap_api():
    plan = (getattr(current_user, "plan", "free") or "free").lower()

    # Enforce quota for skill_gap
    allowed, info = check_and_increment(supabase_admin, current_user.id, plan, "skill_gap")
    if not allowed:
        info.setdefault("error", "quota_exceeded")
        return jsonify(info), 402

    try:
        data = request.get_json(force=True) or {}
        goal = (data.get("goal") or "").strip()
        skills = (data.get("skills") or "").strip()

        if not goal or not skills:
            return jsonify({"error": "Missing required input"}), 400

        messages = [
            {"role": "system", "content":
                "You are a helpful AI assistant that performs skill gap analysis.\n"
                "The user will provide their career goal and current skills.\n"
                "Your job is to:\n"
                "1. Identify the missing skills.\n"
                "2. Suggest learning resources for each missing skill.\n"
                "Format the result as a list of missing skills and a short learning plan."
            },
            {"role": "user", "content":
                f"My goal is to become a {goal}. My current skills include: {skills}.\n"
                "What skills am I missing, and how can I bridge the gap?"
            }
        ]

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            temperature=0.6
        )
        reply = response.choices[0].message.content
        return jsonify({"result": reply})

    except Exception:
        logging.exception("Skill Gap Error")
        return jsonify({"error": "Server error"}), 500

# Require login + quota for interview endpoints so pricing is enforced
@app.route("/api/interview", methods=["POST"])
@login_required
def interview_coach_api():
    plan = (getattr(current_user, "plan", "free") or "free").lower()

    allowed, info = check_and_increment(supabase_admin, current_user.id, plan, "interview_coach")
    if not allowed:
        info.setdefault("error", "quota_exceeded")
        return jsonify(info), 402

    try:
        data = request.get_json(force=True)
        role = data.get("role","").strip()
        exp  = data.get("experience","").strip()
        if not role or not exp:
            return jsonify(error="Missing role or experience"), 400

        msgs = [
            {"role":"system","content":"You are an AI Interview Coach. Provide at least 3 Q&A samples."},
            {"role":"user","content":f"Role: {role}. Experience: {exp}."}
        ]
        resp = client.chat.completions.create(model="gpt-4o", messages=msgs, temperature=0.7)
        return jsonify(result=resp.choices[0].message.content)
    except Exception:
        logging.exception("Interview coach error")
        return jsonify(error="Server error"), 500

@app.route("/api/interview/question", methods=["POST"])
@login_required
def get_interview_question():
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    allowed, info = check_and_increment(supabase_admin, current_user.id, plan, "interview_coach")
    if not allowed:
        info.setdefault("error", "quota_exceeded")
        return jsonify(info), 402

    try:
        data     = request.get_json(force=True)
        prev     = data.get("previousRole","").strip()
        target   = data.get("targetRole","").strip()
        exp      = data.get("experience","").strip()
        if not prev or not target or not exp:
            return jsonify(error="Missing inputs"), 400

        msgs = [
            {"role":"system","content":"You are a virtual interview coach. Ask one job-specific question."},
            {"role":"user","content":f"Was {prev}, applying for {target}. Experience: {exp}."}
        ]
        resp = client.chat.completions.create(model="gpt-4o", messages=msgs, temperature=0.7)
        return jsonify(question=resp.choices[0].message.content)
    except Exception:
        logging.exception("Interview question error")
        return jsonify(error="Unable to generate question"), 500

@app.route("/api/interview/feedback", methods=["POST"])
@login_required
def get_interview_feedback():
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    allowed, info = check_and_increment(supabase_admin, current_user.id, plan, "interview_coach")
    if not allowed:
        info.setdefault("error", "quota_exceeded")
        return jsonify(info), 402

    try:
        data     = request.get_json(force=True)
        question = data.get("question","")
        answer   = data.get("answer","")
        msgs = [
            {"role":"system","content":"You are an interview coach. Give feedback and 2–3 fallback suggestions."},
            {"role":"user","content":f"Q: {question}\nA: {answer}"}
        ]
        resp = client.chat.completions.create(model="gpt-4o", messages=msgs, temperature=0.7)
        content = resp.choices[0].message.content.strip()
        parts = content.split("Fallback Suggestions:")
        feedback = parts[0].strip()
        tips = parts[1].split("\n") if len(parts) > 1 else []
        return jsonify(
            feedback=feedback,
            fallbacks=[t.lstrip("-• ").strip() for t in tips if t.strip()]
        )
    except Exception:
        logging.exception("Interview feedback error")
        return jsonify(error="Error generating feedback"), 500

# --- Register the resume blueprint last (after app/config exists) ---
if resumes_bp is not None:
    app.register_blueprint(resumes_bp)
else:
    # App still runs without the resumes routes
    app.logger.warning("Skipping app.register_blueprint(resumes_bp): not found")


# ---- Employer inquiry endpoints ----

@app.post("/api/employer-inquiry")
def employer_inquiry():
    try:
        supabase = current_app.config["SUPABASE"]
        data = request.get_json(force=True) or {}
        supabase.table("employer_inquiries").insert({
            "company":   data.get("company"),
            "name":      data.get("name"),
            "email":     data.get("email"),
            "phone":     data.get("phone"),
            "job_roles": data.get("job_roles"),
            "message":   data.get("message"),
        }).execute()
        return jsonify(success=True, message="Inquiry submitted"), 200
    except Exception as e:
        current_app.logger.exception("Employer inquiry error")
        return jsonify(success=False, error=str(e)), 500


@app.post("/api/employer/submit")
def submit_employer_form():
    try:
        client   = current_app.config["OPENAI_CLIENT"]
        supabase = current_app.config["SUPABASE"]

        data = request.get_json(force=True) or {}
        job_title           = data.get("jobTitle")
        company             = data.get("company")
        role_summary        = data.get("summary")
        location            = data.get("location")
        employmentType      = data.get("employmentType")
        salaryRange         = data.get("salaryRange")
        applicationDeadline = data.get("applicationDeadline")
        applicationEmail    = data.get("applicationEmail")

        if not job_title or not company:
            return jsonify(success=False, message="Job title and company are required."), 400

        prompt = f"""
You are a recruitment assistant. Generate a professional job description:

Job Title: {job_title}
Company: {company}
Location: {location}
Employment Type: {employmentType}
Salary Range: {salaryRange}
Application Deadline: {applicationDeadline}
Application Email/Link: {applicationEmail}
Summary: {role_summary}

Include: About the Company, Job Summary, Key Responsibilities,
Required Qualifications, Preferred Skills, and How to Apply.
"""

        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.6,
        )
        job_desc = resp.choices[0].message.content

        # Optional: persist in DB
        try:
            supabase.table("job_posts").insert({
                "job_title": job_title,
                "company": company,
                "summary": role_summary,
                "location": location,
                "employment_type": employmentType,
                "salary_range": salaryRange,
                "application_deadline": applicationDeadline,
                "application_email": applicationEmail,
            }).execute()
        except Exception as db_e:
            current_app.logger.warning("Job post save failed: %s", db_e)

        return jsonify(success=True, jobDescription=job_desc), 200

    except Exception:
        current_app.logger.exception("Employer submission error")
        return jsonify(success=False, message="Server error generating job post."), 500

# --- Entrypoint ---
if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
