import os, stripe, hashlib, hmac, time
import traceback
from io import BytesIO
from collections import Counter
import re, json, base64, logging, requests

from flask import (
    Flask, request, jsonify, render_template, redirect,
    session, flash, url_for, current_app, make_response
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
from blueprints.resumes import resumes_bp  # <-- your blueprint with all resume endpoints
import logging
from typing import Optional  # if you're on Python <3.10
from datetime import datetime, timedelta, timezone
from auth_utils import require_superadmin, is_staff, is_superadmin
from limits import check_and_increment, current_plan_limits
from itsdangerous import URLSafeSerializer, BadSignature

# --- Environment & app setup ---
load_dotenv()

app = Flask(__name__)
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

# --- User model (replace your existing one) ---
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
            "ip_hash": ip_hash(client_ip()),
            "user_agent": request.headers.get("User-Agent", "")[:512],
        }).execute()
    except Exception:
        current_app


SID_COOKIE = "sid"
SID_TTL_SECONDS = 30 * 24 * 3600  # 30 days
SECRET_IP_SALT = os.getenv("IP_HASH_SALT", "change-me")
_session_signer = URLSafeSerializer(os.getenv("SECRET_KEY", "dev"), salt="user-session")

def ip_hash_from_request(req):
    ip = (req.headers.get("X-Forwarded-For") or req.remote_addr or "").split(",")[0].strip()
    if not ip:
        return None
    return hmac.new(SECRET_IP_SALT.encode(), ip.encode(), hashlib.sha256).hexdigest()

def device_hash_from_request(req):
    ua = (req.headers.get("User-Agent") or "")[:500]
    acc = (req.headers.get("Accept") or "")[:180]
    lang = (req.headers.get("Accept-Language") or "")[:120]
    raw = f"{ua}|{acc}|{lang}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def _sign_session_id(session_id: str) -> str:
    return _session_signer.dumps({"sid": session_id, "ts": int(time.time())})

def _unsign_session_token(token: str) -> str | None:
    try:
        data = _session_signer.loads(token)
        return data.get("sid")
    except BadSignature:
        return None

def start_user_session(user):
    """Create a DB session row and return (session_id, response_set_cookie_fn)."""
    dev = device_hash_from_request(request)
    iph = ip_hash_from_request(request)
    ua  = (request.headers.get("User-Agent") or "")[:500]

    # Enforce single active session for FREE users
    plan = (getattr(user, "plan", "free") or "free").lower()
    if plan == "free":
        # mark all other sessions inactive
        supabase.table("user_sessions").update({"is_active": False})\
            .eq("auth_id", user.id).eq("is_active", True).execute()

    row = {
        "auth_id": user.id,
        "device_hash": dev,
        "ip_hash": iph,
        "user_agent": ua,
        "is_active": True
    }
    ins = supabase.table("user_sessions").insert(row).execute()
    session_id = ins.data[0]["id"] if ins.data else None
    token = _sign_session_id(session_id)

    def _set_cookie(resp):
        resp.set_cookie(
            SID_COOKIE, token, max_age=SID_TTL_SECONDS,
            httponly=True, samesite="Lax", secure=True, path="/"
        )
        return resp

    return session_id, _set_cookie

def end_current_session():
    token = request.cookies.get(SID_COOKIE)
    sid = _unsign_session_token(token) if token else None
    if sid:
        try:
            supabase.table("user_sessions").update({"is_active": False})\
                .eq("id", sid).execute()
        except Exception:
            current_app.logger.exception("failed to end session")
    # drop cookie
    resp = make_response(redirect(url_for("home")))
    resp.set_cookie(SID_COOKIE, "", expires=0, path="/")
    logout_user()
    return resp

@app.before_request
def enforce_single_active_session():
    if not current_user.is_authenticated:
        return
    token = request.cookies.get(SID_COOKIE)
    sid = _unsign_session_token(token) if token else None
    if not sid:
        # No bound session cookie → sign out (prevents reusing Flask-Login from another device)
        return end_current_session()

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


@user_logged_in.connect_via(app)
def on_user_logged_in(sender, user):
    # This fires right after login_user(user)
    record_login_event(user)

# Jobs fetch
def fetch_remotive_jobs(query: str):
    try:
        r = requests.get(REMOTIVE_API_URL, params={"search": query})
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
    except:
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
        r = requests.get(f"{ADZUNA_API_URL}/{country}/search/1", params=params)
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
    except:
        return []

def fetch_jsearch_jobs(query: str):
    url = "https://jsearch.p.rapidapi.com/search"
    headers = {
        "X-RapidAPI-Key": JSEARCH_API_KEY,
        "X-RapidAPI-Host": JSEARCH_API_HOST
    }
    params = {"query": query, "num_pages": 1}
    try:
        r = requests.get(url, headers=headers, params=params)
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
    except:
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
            r = requests.get(f"{ADZUNA_API_URL}/{country}/search/1", params=params)
            results = r.json().get("results", [])
            if results:
                job = results[0]
                low = float(job.get("salary_min", 0))
                high = float(job.get("salary_max", 0))
                data.append(((low + high) / 2) or 0)
            else:
                data.append(0)
        except:
            data.append(0)
    return data

def fetch_job_counts():
    counts = []
    for title in JOB_TITLES:
        try:
            r = requests.get(REMOTIVE_API_URL, params={"search": title})
            counts.append(len(r.json().get("jobs", [])))
        except:
            counts.append(0)
    return counts

def fetch_skill_trends():
    freq = Counter()
    try:
        r = requests.get(REMOTIVE_API_URL, params={"limit": 50})
        for job in r.json().get("jobs", []):
            text = (job.get("description") or "").lower()
            for key in KEYWORDS:
                if key.lower() in text:
                    freq[key] += 1
    except:
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
        })
        for job in r.json().get("results", []):
            loc = job.get("location", {}).get("display_name")
            if loc:
                freq[loc] += 1
    except:
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

@app.route("/api/state", methods=["GET", "POST"])
@login_required
def api_state():
    # robustly get the auth id
    auth_id = getattr(current_user, "id", None) or getattr(current_user, "auth_id", None)
    if not auth_id:
        return jsonify({"error": "no auth id"}), 400

    if request.method == "GET":
        try:
            resp = supabase.table("user_state").select("data").eq("auth_id", auth_id).limit(1).execute()
            row = resp.data[0] if getattr(resp, "data", None) else None
            return jsonify({"data": (row["data"] if row else {})})
        except Exception:
            current_app.logger.exception("state fetch failed")
            return jsonify({"data": {}}), 200

    # POST
    payload = request.get_json(silent=True) or {}
    data = payload.get("data", {})
    try:
        upsert = {
            "auth_id": auth_id,
            "data": data,
            "updated_at": datetime.now(timezone.utc).isoformat()  # okay to omit if column not present
        }
        # requires a unique constraint on user_state.auth_id
        supabase.table("user_state").upsert(upsert, on_conflict="auth_id").execute()
        return jsonify({"ok": True})
    except Exception:
        current_app.logger.exception("state upsert failed")
        return jsonify({"ok": False}), 500

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


@app.route('/cover-letter')
def cover_letter():
    # Always provide defaults so the template can't blow up
    return render_template(
        "cover-letter.html",
        letter_only=False,   # make explicit
        sender={}, recipient={}, draft=""
    )
        
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

            # ⬇️ NEW: remember email for the /check-email page
            if not ud.get("email_confirmed_at"):
                session["pending_email"] = email
                return jsonify(success=True, redirect=url_for("check_email")), 200

            login_user(User(auth_id=auth_id, email=email, fullname=name))
            return jsonify(success=True, redirect=url_for("dashboard")), 200

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
            return jsonify(success=True, redirect=url_for("dashboard")), 200

        except AuthApiError as e:
            msg = str(e).lower()
            if "email not confirmed" in msg or "not confirmed" in msg:
                # Optionally remember email here too
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
@login_required
def logout():
    try:
        try:
            supabase.auth.sign_out()
        except Exception:
            pass
        logout_user()
    finally:
        return redirect(url_for("account"))

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
# Chat & Jobs & Insights
# ----------------------------
@app.route("/ask", methods=["POST"])
@login_required
def ask():
    allowed, info = check_and_increment(current_user.id, "chat_messages", current_plan_limits())
    if not allowed:
        return jsonify({"reply": "⚠️ You've reached your chat limit. Please upgrade on the Pricing page."}), 403

    body = request.get_json(force=True) or {}
    user_msg = body.get("message", "")
    # Paid users can request a model via body["model"]; free users are forced by choose_model()
    model = choose_model(body.get("model"))

    msgs = [
        {"role": "system", "content": "You are Jobcus, a helpful AI career assistant."},
        {"role": "user", "content": user_msg}
    ]
    try:
        resp = current_app.config["OPENAI_CLIENT"].chat.completions.create(
            model=model,
            messages=msgs,
            temperature=0.6,
        )
        ai_msg = resp.choices[0].message.content
        return jsonify(reply=ai_msg, modelUsed=model)
    except Exception as e:
        current_app.logger.exception("OpenAI error")
        return jsonify(reply="⚠️ Server error talking to the AI. Please try again.", modelUsed=model), 500

@app.get("/api/credits")
@login_required
def api_credits():
    plan = getattr(current_user, "plan", "free")
    lims = current_plan_limits()  # your existing function
    used = get_usage(current_user.id, "chat_messages")  # your counter in DB
    left = max(lims.max_messages - used, 0)
    return jsonify(plan=plan, used=used, max=lims.max_messages, left=left)

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
    except:
        return jsonify(remotive=[], adzuna=[], jsearch=[])

@app.route("/api/salary")
def get_salary_data():
    return jsonify(labels=JOB_TITLES, salaries=fetch_salary_data())

@app.route("/api/job-count")
def get_job_count_data():
    return jsonify(labels=JOB_TITLES, counts=fetch_job_counts())

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
# Skill Gap & Interview Coach
# ----------------------------
@app.route("/api/skill-gap", methods=["POST"])
def skill_gap_api():
    try:
        data = request.get_json()
        goal = data.get("goal", "").strip()
        skills = data.get("skills", "").strip()

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

    except Exception as e:
        logging.exception("Skill Gap Error")
        return jsonify({"error": "Server error"}), 500

@app.route("/api/interview", methods=["POST"])
def interview_coach_api():
    try:
        data = request.get_json()
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
def get_interview_question():
    try:
        data     = request.get_json()
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
def get_interview_feedback():
    try:
        data     = request.get_json()
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
app.register_blueprint(resumes_bp)

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
