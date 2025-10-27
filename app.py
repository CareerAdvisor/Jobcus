import os, stripe, hashlib, hmac, time, httpx, functools, mimetypes, shutil
import traceback
from io import BytesIO
from collections import Counter
import re, json, base64, logging, requests, io, tempfile, uuid
from functools import wraps
from auth_utils import api_login_required, is_staff, is_superadmin, require_superadmin

from flask import (
    Blueprint, Flask, request, jsonify, render_template, redirect, session,
    flash, url_for, send_file, current_app, Response, make_response, g, abort
)
from flask_cors import CORS
from flask_login import (
    login_user, logout_user, current_user,
    login_required, user_logged_in, LoginManager, UserMixin
)
from markupsafe import escape, Markup
from weasyprint import HTML, CSS
from gotrue.errors import AuthApiError
from dotenv import load_dotenv
from supabase_auth.errors import AuthApiError
from typing import Tuple, List, Optional
from decimal import Decimal, ROUND_HALF_UP
from security import verify_turnstile

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
from werkzeug.utils import secure_filename

# --- Load resumes blueprint robustly ---
import importlib, importlib.util, pathlib, sys, logging
from openai import OpenAI
from flask_babel import Babel, _, get_locale
from PIL import Image, ImageOps, ImageFilter
import pytesseract

# Optional HEIF/HEIC support (won't crash deploys if package isn't installed)
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
    HEIF_ENABLED = True
except Exception:
    HEIF_ENABLED = False

try:
    from pytesseract import TesseractNotFoundError as _TesseractNotFoundError
except Exception:  # pragma: no cover - pytesseract always exports this, but be safe
    class _TesseractNotFoundError(RuntimeError):
        """Fallback error so we can detect missing Tesseract binaries."""
        pass

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

def _env_flag(name: str, default: bool) -> bool:
    """Parse common truthy/falsey strings from the environment."""
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}

DEFAULT_LOCALE   = os.getenv("JOBCUS_DEFAULT_LOCALE", "en").lower()
DEFAULT_CURRENCY = os.getenv("JOBCUS_DEFAULT_CURRENCY", "GBP").upper()

SUPPORTED_LANGUAGES: dict[str, dict[str, str]] = {
    "en": {"name": "English", "flag": "🇬🇧"},
    "af": {"name": "Afrikaans", "flag": "🇿🇦"},
    "nl": {"name": "Nederlands", "flag": "🇳🇱"},
    "fr": {"name": "Français", "flag": "🇫🇷"},
    "zh": {"name": "中文 (简体)", "flag": "🇨🇳"},
    "pt": {"name": "Português", "flag": "🇵🇹"},
    "es": {"name": "Español", "flag": "🇪🇸"},
    "ar": {"name": "العربية", "flag": "🇦🇪"},
}

LANGUAGE_DEFAULT_CURRENCY = {
    "en": "GBP",
    "af": "ZAR",
    "nl": "EUR",
    "fr": "EUR",
    "zh": "CNY",
    "pt": "EUR",
    "es": "EUR",
    "ar": "AED",
    
}

SUPPORTED_CURRENCIES: dict[str, dict[str, str]] = {
    "GBP": {"label": "British Pound", "symbol": "£", "flag": "🇬🇧"},
    "USD": {"label": "US Dollar", "symbol": "$", "flag": "🇺🇸"},
    "EUR": {"label": "Euro", "symbol": "€", "flag": "🇪🇺"},
    "CAD": {"label": "Canadian Dollar", "symbol": "CA$", "flag": "🇨🇦"},
    "AUD": {"label": "Australian Dollar", "symbol": "A$", "flag": "🇦🇺"},
    "INR": {"label": "Indian Rupee", "symbol": "₹", "flag": "🇮🇳"},
    "ZAR": {"label": "South African Rand", "symbol": "R", "flag": "🇿🇦"},
    "CNY": {"label": "Chinese Yuan", "symbol": "¥", "flag": "🇨🇳"},
    "NGN": {"label": "Nigerian Naira", "symbol": "₦", "flag": "🇳🇬"},
    "AED": {"label": "UAE Dirham", "symbol": "د.إ", "flag": "🇦🇪"},
}

DEFAULT_CURRENCY_RATES = {
    "GBP": 1,
    "USD": 1.26,
    "EUR": 1.14,
    "CAD": 1.73,
    "AUD": 1.92,
    "INR": 104.7,
    "ZAR": 22.98,
    "CNY": 9.14,
    "NGN": 1730.0,
    "AED": 4.64,
}

app.config.setdefault("BABEL_DEFAULT_LOCALE", DEFAULT_LOCALE)
app.config.setdefault("BABEL_TRANSLATION_DIRECTORIES", "translations")

babel = Babel()
app.jinja_env.globals.update(_=_)

# Public Supabase values from env
app.config["SUPABASE_URL"]       = os.getenv("SUPABASE_URL", "").rstrip("/")
app.config["SUPABASE_ANON_KEY"]  = os.getenv("SUPABASE_ANON_KEY", "")
app.config["BASE_URL"]           = os.getenv("PUBLIC_BASE_URL", "https://www.jobcus.com").rstrip("/")

def _load_currency_rates() -> dict[str, float]:
    raw = os.getenv("JOBCUS_CURRENCY_RATES", "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            out = {}
            for code, rate in parsed.items():
                code_u = str(code).upper()
                try:
                    out[code_u] = float(rate)
                except (TypeError, ValueError):
                    continue
            if out:
                if "GBP" not in out:
                    out["GBP"] = 1.0
                return out
        except Exception:
            logging.warning("Invalid JOBCUS_CURRENCY_RATES env; falling back to defaults.")
    return DEFAULT_CURRENCY_RATES.copy()


def _load_plan_price_ids() -> dict[str, dict[str, str | None]]:
    return {
        "weekly": {
            "GBP": os.getenv("STRIPE_PRICE_WEEKLY"),
            "USD": os.getenv("STRIPE_PRICE_WEEKLY_USD"),
            "EUR": os.getenv("STRIPE_PRICE_WEEKLY_EUR"),
            "ZAR": os.getenv("STRIPE_PRICE_WEEKLY_ZAR"),
            "CNY": os.getenv("STRIPE_PRICE_WEEKLY_CNY"),
            "NGN": os.getenv("STRIPE_PRICE_WEEKLY_NGN"),
            "AED": os.getenv("STRIPE_PRICE_WEEKLY_AED"),
        },
        "standard": {
            "GBP": os.getenv("STRIPE_PRICE_STANDARD"),
            "USD": os.getenv("STRIPE_PRICE_STANDARD_USD"),
            "EUR": os.getenv("STRIPE_PRICE_STANDARD_EUR"),
            "ZAR": os.getenv("STRIPE_PRICE_STANDARD_ZAR"),
            "CNY": os.getenv("STRIPE_PRICE_STANDARD_CNY"),
            "NGN": os.getenv("STRIPE_PRICE_STANDARD_NGN"),
            "AED": os.getenv("STRIPE_PRICE_STANDARD_AED"),
        },
        "premium": {
            "GBP": os.getenv("STRIPE_PRICE_PREMIUM"),
            "USD": os.getenv("STRIPE_PRICE_PREMIUM_USD"),
            "EUR": os.getenv("STRIPE_PRICE_PREMIUM_EUR"),
            "ZAR": os.getenv("STRIPE_PRICE_PREMIUM_ZAR"),
            "CNY": os.getenv("STRIPE_PRICE_PREMIUM_CNY"),
            "NGN": os.getenv("STRIPE_PRICE_PREMIUM_NGN"),
            "AED": os.getenv("STRIPE_PRICE_PREMIUM_AED"),
        },
        "employer_jd": {
            "GBP": os.getenv("STRIPE_PRICE_EMPLOYER_JD"),
            "USD": os.getenv("STRIPE_PRICE_EMPLOYER_JD_USD"),
            "EUR": os.getenv("STRIPE_PRICE_EMPLOYER_JD_EUR"),
            "ZAR": os.getenv("STRIPE_PRICE_PREMIUM_ZAR"),
            "CNY": os.getenv("STRIPE_PRICE_PREMIUM_CNY"),
            "NGN": os.getenv("STRIPE_PRICE_PREMIUM_NGN"),
            "AED": os.getenv("STRIPE_PRICE_EMPLOYER_JD_AED"),
        },
    }


PLAN_BASE_PRICES: dict[str, Decimal] = {
    "free": Decimal("0"),
    "weekly": Decimal("7.99"),
    "standard": Decimal("23.99"),
    "premium": Decimal("229"),
    "employer_jd": Decimal("25"),
}

PLAN_PERIODS: dict[str, str] = {
    "free": "/mo",
    "weekly": "/week",
    "standard": "/mo",
    "premium": "/yr",
    "employer_jd": "/mo",
}

app.config["CURRENCY_RATES"] = _load_currency_rates()
app.config["PLAN_PRICE_IDS"] = _load_plan_price_ids()


def _coerce_language(code: str | None) -> str:
    if not code:
        return DEFAULT_LOCALE
    lang = str(code).lower()
    return lang if lang in SUPPORTED_LANGUAGES else DEFAULT_LOCALE


def _coerce_currency(code: str | None) -> str:
    if not code:
        return DEFAULT_CURRENCY
    cur = str(code).upper()
    return cur if cur in SUPPORTED_CURRENCIES else DEFAULT_CURRENCY


def _format_amount_html(amount: Decimal) -> str:
    quant = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    as_str = f"{quant:.2f}"
    whole, frac = as_str.split(".")
    whole_fmt = format(int(whole), ",")
    if frac == "00":
        return whole_fmt
    return f"{whole_fmt}<span class='cents'>.{frac}</span>"


def convert_currency(amount: Decimal | float | str, target_currency: str | None = None) -> Decimal:
    currency = _coerce_currency(target_currency)
    rates = app.config.get("CURRENCY_RATES") or DEFAULT_CURRENCY_RATES
    base_rate = Decimal(str(rates.get("GBP", 1)))
    target_rate = Decimal(str(rates.get(currency, rates.get(DEFAULT_CURRENCY, 1))))
    value = Decimal(str(amount))
    return (value * target_rate / base_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def plan_price_display(plan_code: str, currency: str | None = None) -> dict[str, object]:
    code = (plan_code or "").lower()
    base_amount = PLAN_BASE_PRICES.get(code)
    if base_amount is None:
        return {
            "symbol": SUPPORTED_CURRENCIES[DEFAULT_CURRENCY]["symbol"],
            "amount_html": Markup("0"),
            "amount_value": 0.0,
            "period": PLAN_PERIODS.get(code, "/mo"),
            "currency": DEFAULT_CURRENCY,
        }

    currency_code = _coerce_currency(currency)
    converted = convert_currency(base_amount, currency_code)
    currency_meta = SUPPORTED_CURRENCIES.get(currency_code, SUPPORTED_CURRENCIES[DEFAULT_CURRENCY])

    return {
        "symbol": currency_meta["symbol"],
        "amount_html": Markup(_format_amount_html(converted)),
        "amount_value": float(converted),
        "period": PLAN_PERIODS.get(code, "/mo"),
        "currency": currency_code,
    }


def build_plan_price_matrix(currency: str | None = None) -> dict[str, dict[str, object]]:
    cur = _coerce_currency(currency)
    return {code: plan_price_display(code, cur) for code in PLAN_BASE_PRICES.keys()}


def _current_currency() -> str:
    stored = session.get("currency") if hasattr(session, "get") else None
    if stored and stored in SUPPORTED_CURRENCIES:
        return stored
    locale = get_locale()
    lang = str(locale) if locale else DEFAULT_LOCALE
    fallback = LANGUAGE_DEFAULT_CURRENCY.get(lang, DEFAULT_CURRENCY)
    return _coerce_currency(fallback)


def select_locale() -> str:
    stored = session.get("language") if hasattr(session, "get") else None
    if stored and stored in SUPPORTED_LANGUAGES:
        return stored

    cookie_lang = request.cookies.get("jobcus_lang") if request else None
    if cookie_lang and cookie_lang in SUPPORTED_LANGUAGES:
        session["language"] = cookie_lang
        return cookie_lang

    best = request.accept_languages.best_match(list(SUPPORTED_LANGUAGES.keys())) if request else None
    lang = best or DEFAULT_LOCALE
    session["language"] = _coerce_language(lang)
    return session["language"]


babel.init_app(app, locale_selector=select_locale)

# --- your existing locale selector ---
def select_locale():
    # 1) explicit session choice
    lang = session.get("lang")
    if lang and lang in SUPPORTED_LANGUAGES:
        return lang

    # 2) ?lang=xx fallback
    arg = request.args.get("lang")
    if arg and arg in SUPPORTED_LANGUAGES:
        session["lang"] = arg
        return arg

    # 3) browser header
    return request.accept_languages.best_match(list(SUPPORTED_LANGUAGES.keys())) or DEFAULT_LOCALE


@app.before_request
def ensure_locale_preferences():
    lang = _coerce_language(session.get("language"))
    if session.get("language") != lang:
        session["language"] = lang

    manual_currency = bool(session.get("currency_manual", False))
    stored_currency = session.get("currency") if not manual_currency else session.get("currency")
    if not stored_currency:
        default_currency = LANGUAGE_DEFAULT_CURRENCY.get(lang, DEFAULT_CURRENCY)
        session["currency"] = _coerce_currency(default_currency)
    elif stored_currency not in SUPPORTED_CURRENCIES:
        session["currency"] = _coerce_currency(stored_currency)

    if "currency_manual" not in session:
        session["currency_manual"] = False


@app.context_processor
def inject_locale_meta():
    lang = session.get("language", DEFAULT_LOCALE)
    lang = _coerce_language(lang)
    currency = _current_currency()
    return {
        "available_languages": SUPPORTED_LANGUAGES,
        "current_language": lang,
        "available_currencies": SUPPORTED_CURRENCIES,
        "current_currency": currency,
        "plan_prices": build_plan_price_matrix(currency),
        "current_currency_meta": SUPPORTED_CURRENCIES.get(currency, SUPPORTED_CURRENCIES[DEFAULT_CURRENCY]),
    }


app.jinja_env.globals.update(plan_price_display=plan_price_display)

# Validate required admin creds
_supabase_url   = app.config["SUPABASE_URL"]
_service_role   = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

if not _supabase_url or not _service_role:
    # Fail fast with a clear message (don’t print secrets)
    missing = []
    if not _supabase_url: missing.append("SUPABASE_URL")
    if not _service_role: missing.append("SUPABASE_SERVICE_ROLE_KEY")
    raise RuntimeError(f"Missing required env vars: {', '.join(missing)}")

# Create the admin client, THEN stash it on app.config
supabase_admin = create_client(_supabase_url, _service_role)
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

@app.context_processor
def inject_turnstile_sitekey():
    return {
        "TURNSTILE_SITE_KEY": os.getenv("TURNSTILE_SITE_KEY", "")
    }

# Session cookie hardening
_session_secure_default = not app.debug and not app.testing
app.config.update(
  SESSION_COOKIE_SAMESITE="Lax",
  SESSION_COOKIE_SECURE=_env_flag("SESSION_COOKIE_SECURE", _session_secure_default),
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

# ================== Job Insights (page + APIs) ==================

# ---- Optional auth requirement for API endpoints ----
# If you have @api_login_required already, set DECORATOR = api_login_required
try:
    from your_auth_module import api_login_required as _NEED_LOGIN  # adjust if you have one
    DECORATOR = _NEED_LOGIN
except Exception:
    DECORATOR = lambda f: f  # no-auth by default

# ---- Constants you already have (extendable) ----
JOB_TITLES = [
    "Software Engineer", "Data Analyst",
    "Project Manager", "UX Designer", "Cybersecurity Analyst",
    # keep list short for snapshot charts; users can filter with inputs
]
KEYWORDS = ["Python", "SQL", "Project Management", "UI/UX", "Cloud Security"]

# ---- Helpers ----
def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()

# Baseline salaries per role (GBP, UK-focused defaults). Add to/tune this table.
BASE_SALARY_BY_ROLE = {
    "software engineer":     85000,
    "data analyst":          52000,
    "project manager":       68000,
    "ux designer":           60000,
    "cybersecurity analyst": 82000,
    # specific civil-service roles, etc.
    "prison officer":        31000,
}

# Guardrails (min, max) per role to keep results realistic
ROLE_SALARY_BOUNDS = {
    "prison officer": (26000, 42000),
    # add more role-specific bands as you refine
}

# Location multipliers (coarse). Extend/adjust to your target markets.
LOCATION_MULTIPLIER = {
    "london": 1.15, "new york": 1.25, "san francisco": 1.30,
    "manchester": 1.06, "birmingham": 1.05, "remote": 1.00
}

# Seniority levels for single-role charts
LEVELS: List[Tuple[str, float]] = [("Entry", 0.82), ("Mid", 1.00), ("Senior", 1.27)]

def _deterministic_bump(seed: str, span: float = 0.06) -> float:
    """
    Tiny deterministic +/- bump (default ±6%) so different combos vary
    even with the same base table.
    """
    h = abs(hash(seed)) % 1000
    return 1.0 + ((h / 1000.0) * 2 * span - span)

def enforce_role_bounds(role: Optional[str], value: int) -> int:
    r = _norm(role)
    lb, ub = ROLE_SALARY_BOUNDS.get(r, (None, None))
    if lb is not None:
        value = max(value, lb)
    if ub is not None:
        value = min(value, ub)
    return value

# -------- lightweight cache decorator (in-memory) --------
_cache = {}
def cache_for(seconds: int):
    def deco(fn):
        @functools.wraps(fn)
            # pyright: reportGeneralTypeIssues=false
        def wrapped(*a, **kw):
            key = (fn.__name__, tuple(sorted(kw.items())))
            now = time.time()
            if key in _cache:
                val, exp = _cache[key]
                if now < exp:
                    return val
            val = fn(*a, **kw)
            _cache[key] = (val, now + seconds)
            return val
        return wrapped
    return deco

# -------- Optional: external salary estimate (Adzuna UK example) --------
@cache_for(3600)
def fetch_salary_external(role: str, location: str) -> Optional[int]:
    """
    Fetch a robust estimate from an external feed (Adzuna example).
    Set env vars: ADZUNA_APP_ID, ADZUNA_APP_KEY. Returns int GBP or None.
    """
    role = (role or "").strip()
    location = (location or "").strip()
    if not role or not location:
        return None

    app_key = os.environ.get("ADZUNA_APP_KEY")
    app_id  = os.environ.get("ADZUNA_APP_ID")
    if not app_key or not app_id:
        return None

    base_url = "https://api.adzuna.com/v1/api/jobs/gb/search/1"
    params = {
        "app_id": app_id,
        "app_key": app_key,
        "what": role,
        "where": location,
        "results_per_page": 25,
        "content-type": "application/json",
    }
    try:
        with httpx.Client(timeout=8) as client:
            r = client.get(base_url, params=params)
            r.raise_for_status()
            data = r.json() or {}

        items = data.get("results") or []
        vals: List[float] = []
        for it in items:
            mn = it.get("salary_min")
            mx = it.get("salary_max")
            # Keep only sane positive numbers
            if isinstance(mn, (int, float)) and isinstance(mx, (int, float)) and mn > 0 and mx > 0 and mx >= mn:
                vals.append((mn + mx) / 2.0)
            elif isinstance(mx, (int, float)) and mx > 0:
                vals.append(float(mx))
            elif isinstance(mn, (int, float)) and mn > 0:
                vals.append(float(mn))

        if len(vals) < 5:
            return None  # not enough clean data → fallback

        vals.sort()
        k = max(1, int(len(vals) * 0.15))  # 15% trimmed mean
        core = vals[k:-k] if len(vals) > 2 * k else vals
        est = int(sum(core) / len(core))
        return enforce_role_bounds(role, est)
    except Exception:
        return None

# -------- Salary logic (fallback & general) --------
def compute_salary(role: Optional[str], location: Optional[str]):
    role_n = _norm(role)
    loc_n  = _norm(location)

    base = BASE_SALARY_BY_ROLE.get(role_n, 60000)
    loc_mult = LOCATION_MULTIPLIER.get(loc_n, 1.00)

    # If both role & location provided, try external first
    if role_n and loc_n:
        ext = fetch_salary_external(role or "", location or "")
        if ext:
            return [f"{role} – {location}"], [ext]
        est = round(base * loc_mult * _deterministic_bump(f"{role_n}:{loc_n}"))
        return [f"{role} – {location}"], [enforce_role_bounds(role, est)]

    # Only role → show by seniority
    if role_n:
        labels, salaries = [], []
        for (lvl, m) in LEVELS:
            est = round(base * m * _deterministic_bump(f"{role_n}:{lvl}"))
            labels.append(f"{role} – {lvl}")
            salaries.append(enforce_role_bounds(role, est))
        return labels, salaries

    # Snapshot (no filters): show the short list
    labels   = JOB_TITLES
    salaries = []
    for t in JOB_TITLES:
        est = round(BASE_SALARY_BY_ROLE.get(_norm(t), 60000) * _deterministic_bump(t))
        salaries.append(enforce_role_bounds(t, est))
    return labels, salaries

# -------- Job counts --------
def compute_job_counts(role: Optional[str], location: Optional[str]):
    role_n = _norm(role)

    base_counts = {
        "software engineer": 3200,
        "data analyst": 1800,
        "project manager": 1400,
        "ux designer": 900,
        "cybersecurity analyst": 1100,
    }

    if role_n:
        total = base_counts.get(role_n, 800)
        entry = int(total * 0.35 * _deterministic_bump(f"{role_n}:entry", 0.08))
        mid   = int(total * 0.45 * _deterministic_bump(f"{role_n}:mid", 0.08))
        senior= int(total * 0.20 * _deterministic_bump(f"{role_n}:senior", 0.08))
        return [f"{role} – Entry", f"{role} – Mid", f"{role} – Senior"], [entry, mid, senior]

    labels = JOB_TITLES
    counts = [int(({"software engineer": 3200, "data analyst": 1800, "project manager": 1400,
                    "ux designer": 900, "cybersecurity analyst": 1100}
                   ).get(_norm(t), 800) * _deterministic_bump(f"count:{t}", 0.08)) for t in JOB_TITLES]
    return labels, counts

# -------- Skills --------
def compute_skills(role: Optional[str], location: Optional[str]):
    role_n = _norm(role)
    weights = {k: 50 for k in KEYWORDS}
    if "software" in role_n or "engineer" in role_n or "developer" in role_n:
        weights["Python"] = 85
        weights["SQL"] = max(weights["SQL"], 70)
        weights["Cloud Security"] = max(weights["Cloud Security"], 65)
    elif "analyst" in role_n:
        weights["SQL"] = 85
        weights["Python"] = max(weights["Python"], 70)
        weights["Project Management"] = max(weights["Project Management"], 55)
    elif "project manager" in role_n:
        weights["Project Management"] = 90
        weights["UI/UX"] = max(weights["UI/UX"], 55)
        weights["SQL"] = max(weights["SQL"], 50)
    elif "ux" in role_n or "designer" in role_n:
        weights["UI/UX"] = 90
        weights["Project Management"] = max(weights["Project Management"], 60)
    elif "cyber" in role_n or "security" in role_n:
        weights["Cloud Security"] = 90
        weights["Python"] = max(weights["Python"], 60)

    labels = KEYWORDS
    freq   = [int(weights[k] * _deterministic_bump(f"skill:{k}:{role_n}", 0.05)) for k in KEYWORDS]
    return labels, freq

# -------- Locations --------
def compute_locations(role: Optional[str], location: Optional[str]):
    base = [
        ("London", 1800), ("Manchester", 520), ("Birmingham", 480),
        ("New York", 2100), ("San Francisco", 1500), ("Remote", 900),
    ]
    labels = [name for name, _ in base]
    counts = [int(c * _deterministic_bump(f"loc:{name}:{_norm(role)}", 0.10)) for name, c in base]
    return labels, counts

# ---------------- Routes ----------------
@DECORATOR
def _salary_view():
    role = request.args.get("role", "")
    location = request.args.get("location", "")
    labels, salaries = compute_salary(role, location)
    return jsonify({"labels": labels, "salaries": salaries}), 200

@DECORATOR
def _job_count_view():
    role = request.args.get("role", "")
    location = request.args.get("location", "")
    labels, counts = compute_job_counts(role, location)
    return jsonify({"labels": labels, "counts": counts}), 200

@DECORATOR
def _skills_view():
    role = request.args.get("role", "")
    location = request.args.get("location", "")
    labels, frequency = compute_skills(role, location)
    return jsonify({"labels": labels, "frequency": frequency}), 200

@DECORATOR
def _locations_view():
    role = request.args.get("role", "")
    location = request.args.get("location", "")
    labels, counts = compute_locations(role, location)
    return jsonify({"labels": labels, "counts": counts}), 200

# Attach endpoints (avoid decorator stacking issues)
app.add_url_rule("/api/salary",     view_func=_salary_view,     methods=["GET"])
app.add_url_rule("/api/job-count",  view_func=_job_count_view,  methods=["GET"])
app.add_url_rule("/api/skills",     view_func=_skills_view,     methods=["GET"])
app.add_url_rule("/api/locations",  view_func=_locations_view,  methods=["GET"])
# ================== /Job Insights ==================

    
# --- Stripe Payment ---
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")  # your sk_live_...

# Map plan code -> Stripe Price ID (envs you already set)
PLAN_TO_PRICE = {
    "weekly":   os.getenv("STRIPE_PRICE_WEEKLY"),
    "standard": os.getenv("STRIPE_PRICE_STANDARD"),
    "premium":  os.getenv("STRIPE_PRICE_PREMIUM"),
    "employer_jd":  os.getenv("STRIPE_PRICE_EMPLOYER_JD"),
}

# --- Stripe Payment ---
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")  # your sk_live_...

# Map plan code -> Stripe Price ID (envs you already set)
PLAN_TO_PRICE = {
    "weekly":      os.getenv("STRIPE_PRICE_WEEKLY"),
    "standard":    os.getenv("STRIPE_PRICE_STANDARD"),
    "premium":     os.getenv("STRIPE_PRICE_PREMIUM"),
    "employer_jd": os.getenv("STRIPE_PRICE_EMPLOYER_JD"),
}

# ✅ 1. Insert all your NEW Stripe + Email helper functions right HERE:

# --- Transactional Email Sender (send_tx_email) ---

RESEND_API_KEY = os.getenv("RESEND_API_KEY")
DEFAULT_FROM = os.getenv("TX_FROM_EMAIL", "Jobcus <no-reply@jobcus.com>")
ADMIN_EMAILS = {e.strip().lower() for e in (os.getenv("ADMIN_EMAILS") or "").split(",") if e.strip()}

def send_tx_email(to: str, subject: str, html: str, cc_admin: bool=False):
    """
    Very small helper using Resend. Replace with your provider if needed.
    """
    if not RESEND_API_KEY:
        current_app.logger.warning("RESEND_API_KEY not set; skipping email to %s (%s)", to, subject)
        return
    payload = {
        "from": DEFAULT_FROM,
        "to": [to],
        "subject": subject,
        "html": html
    }
    if cc_admin and ADMIN_EMAILS:
        payload["bcc"] = list(ADMIN_EMAILS)
    try:
        r = requests.post(
            "https://api.resend.com/emails",
            json=payload,
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"}
        )
        if r.status_code >= 300:
            current_app.logger.error("send_tx_email failed: %s %s", r.status_code, r.text)
    except Exception:
        current_app.logger.exception("send_tx_email error")

# --- Create Stripe Billing Portal URL ---
def create_billing_portal_url(customer_id, return_url):
    """
    Creates a Stripe Billing Portal session link for the given customer.
    This link lets the user manage or cancel their subscription directly.
    """
    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=return_url
    )
    return session.url

# --- Subscription Details Helper ---
def _sub_human_details(session_or_sub):
    """
    Normalize details for success email.
    Accepts either a Checkout Session (expand=subscription) or a Subscription object.
    Returns dict: plan_code, interval, amount, currency, renews_at_iso
    """
    try:
        # If we got a Session, use its subscription object
        if session_or_sub and getattr(session_or_sub, "object", None) == "checkout.session":
            sub = session_or_sub.subscription
            if not sub or isinstance(sub, str):
                sub = stripe.Subscription.retrieve(sub) if sub else None
        else:
            sub = session_or_sub

        price = None
        if sub and sub.items and sub.items.data:
            price = sub.items.data[0].price

        interval = getattr(price.recurring, "interval", None) if price and price.recurring else None
        amount   = (price.unit_amount or 0)/100 if price and price.unit_amount else None
        currency = (price.currency or "gbp").upper() if price else "GBP"
        renews_at_iso = time.strftime("%Y-%m-%d", time.gmtime(sub.current_period_end)) if sub and sub.current_period_end else None

        # Try to surface your internal plan code
        plan_code = None
        if hasattr(session_or_sub, "metadata") and session_or_sub.metadata:
            plan_code = session_or_sub.metadata.get("plan_code")
        if not plan_code and sub and sub.items and sub.items.data:
            # fallback: map from price id
            plan_code = PRICE_TO_PLAN.get(price.id)

        return {
            "plan_code": plan_code or "standard",
            "interval": interval or "month",
            "amount": amount,
            "currency": currency,
            "renews_at_iso": renews_at_iso,
        }
    except Exception:
        current_app.logger.exception("_sub_human_details failed")
        return {"plan_code":"standard","interval":"month","amount":None,"currency":"GBP","renews_at_iso":None}

# --- Send Success Email (calls your Jinja template) ---
def send_success_email(
    to_email,
    plan_name,
    amount,
    interval,
    currency="GBP",
    next_renewal_date=None,
    order_number=None,
    order_date=None,
    payment_brand=None,
    payment_last4=None,
    manage_url=None,
    user_name=None
):
    """
    Renders and sends a success email when a user subscribes to a plan.
    """

    # Render the HTML template using Jobcus branding
    html = render_template(
        "subscription_success.html",
        user_name=user_name,
        plan_name=plan_name,
        amount=f"{amount:.2f}" if amount is not None else None,
        interval_label={"week": "week", "month": "month", "year": "year"}.get(interval, interval),
        currency_symbol="£" if currency.upper() == "GBP" else f"{currency.upper()} ",
        next_renewal_date=next_renewal_date,
        order_number=order_number,
        order_date=order_date,
        payment_brand=payment_brand,
        payment_last4=payment_last4,
        manage_url=manage_url or url_for("dashboard", _external=True),
        tax_amount=None,
        total_amount=None
    )

    # Send using your transactional email helper
    subject = f"Your Jobcus {plan_name} plan is active"
    send_tx_email(to_email, subject, html)


# --- Send Failed Email (for invoice.payment_failed) ---
def send_failed_email(
    to_email,
    amount_due,
    currency="GBP",
    reason=None,
    update_url=None,
    user_name=None
):
    """
    Renders and sends a failed payment email to the user.
    Also notifies the admin if ADMIN_EMAILS is configured.
    """

    # Render the Jobcus HTML email
    html = render_template(
        "subscription_failed.html",
        user_name=user_name,
        amount_due=f"{amount_due:.2f}" if amount_due is not None else None,
        currency_symbol="£" if currency.upper() == "GBP" else f"{currency.upper()} ",
        fail_reason=reason or "Your recent payment could not be processed.",
        update_url=update_url or url_for("dashboard", _external=True)
    )

    # Send to the user
    subject = "Action needed: Jobcus payment failed"
    send_tx_email(to_email, subject, html)

    # Notify admin (optional)
    if ADMIN_EMAILS:
        admin_to = next(iter(ADMIN_EMAILS))
        admin_html = f"""
        <p><strong>Payment failed for:</strong> {to_email or 'Unknown user'}</p>
        <p><strong>Amount:</strong> £{amount_due:.2f} {currency}</p>
        <p><strong>Reason:</strong> {reason or 'Not provided'}</p>
        """
        send_tx_email(admin_to, "ALERT: Jobcus subscription payment failed", admin_html)

# --- OCR helpers ---
def _ocr_via_openai(path: str) -> str:
    """Fallback OCR using the configured OpenAI client."""
    client = current_app.config.get("OPENAI_CLIENT")
    if client is None:
        return ""

    def _extract_text_from_choice(choice) -> str:
        if not choice:
            return ""

        msg = getattr(choice, "message", None) or {}
        content = getattr(msg, "content", "")

        # Python OpenAI SDK may return either a plain string or a list of
        # {"type": "text", "text": "..."} fragments. Normalise to str.
        if isinstance(content, str):
            return content.strip()

        parts: list[str] = []
        if isinstance(content, (list, tuple)):
            for part in content:
                if isinstance(part, str):
                    parts.append(part)
                    continue

                part_type = None
                text_value = None

                if isinstance(part, dict):
                    part_type = part.get("type")
                    text_value = part.get("text")
                else:
                    part_type = getattr(part, "type", None)
                    text_value = getattr(part, "text", None)

                if part_type == "text" and text_value:
                    parts.append(str(text_value))

        return "\n".join(p for p in parts if p).strip()

    try:
        with Image.open(path) as raw:
            fmt = (raw.format or "PNG").upper()
        with open(path, "rb") as fh:
            data = fh.read()
        if not data:
            return ""

        mime = Image.MIME.get(fmt) or "image/png"
        b64 = base64.b64encode(data).decode("utf-8")

        model = os.getenv("OCR_MODEL", os.getenv("OPENAI_OCR_MODEL", "gpt-4o-mini"))
        resp = client.chat.completions.create(
            model=model,
            temperature=0,
            messages=[
                {
                    "role": "system",
                    "content": "You transcribe text from images. Return plain text only.",
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Extract every piece of readable text from this image. Preserve natural line breaks and omit commentary.",
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{b64}"},
                        },
                    ],
                },
            ],
        )
        choice = resp.choices[0] if resp and resp.choices else None
        return _extract_text_from_choice(choice)
    except Exception:
        current_app.logger.warning("OpenAI OCR fallback failed", exc_info=True)
        return ""

def _img_to_text_file(path: str) -> str:
    """
    Open image from disk, do light preprocessing, run Tesseract.
    Works for PNG/JPG/WEBP/HEIC (if pillow-heif is registered).
    Falls back to OpenAI vision OCR if Tesseract is unavailable.
    """
    try:
        img = Image.open(path)
        img = ImageOps.exif_transpose(img)   # respect camera rotation
        img = img.convert("L")               # grayscale
        img = ImageOps.autocontrast(img)
        img = img.filter(ImageFilter.MedianFilter(size=3))  # light denoise
        text = (pytesseract.image_to_string(img) or "").strip()
        if text:
            return text
    except _TesseractNotFoundError:
        current_app.logger.info("Tesseract binary not found; using OpenAI OCR fallback")
    except Exception:
        current_app.logger.warning("Tesseract OCR failed", exc_info=True)

    return _ocr_via_openai(path)
    
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
    Plan-specific model defaults + allow-lists (UI + server guard can reuse this).
    Free  -> forced to FREE_MODEL (single choice).
    Weekly/Standard/Premium/Employer_JD -> <PLAN>_MODEL_DEFAULT + <PLAN>_MODEL_ALLOW (deduped).
    We optionally filter the final list by models available to the API key.
    Env vars you can set:
      FREE_MODEL
      WEEKLY_MODEL_DEFAULT,   WEEKLY_MODEL_ALLOW
      STANDARD_MODEL_DEFAULT, STANDARD_MODEL_ALLOW
      PREMIUM_MODEL_DEFAULT,  PREMIUM_MODEL_ALLOW
      EMPLOYER_JD_MODEL_DEFAULT, EMPLOYER_JD_MODEL_ALLOW
      (Legacy fallbacks: PAID_MODEL_DEFAULT / PAID_MODEL_ALLOW)
    """
    plan = (plan or "free").lower()

    # ---- Defaults (safe fallbacks if envs are missing) ----
    FREE_DEFAULT      = (os.getenv("FREE_MODEL", "gpt-4o-mini") or "gpt-4o").strip()
    WEEKLY_DEFAULT    = (os.getenv("WEEKLY_MODEL_DEFAULT",
                           os.getenv("PAID_MODEL_DEFAULT", "gpt-4o-mini")) or "gpt-4o").strip()
    STANDARD_DEFAULT  = (os.getenv("STANDARD_MODEL_DEFAULT", "gpt-4o-mini") or "gpt-4o").strip()
    PREMIUM_DEFAULT   = (os.getenv("PREMIUM_MODEL_DEFAULT", "gpt-4o") or "gpt-5").strip()

    # NEW: Employer JD default (choose your desired default)
    EMPLOYER_JD_DEFAULT = (os.getenv("EMPLOYER_MODEL_DEFAULT",
                              os.getenv("EMPLOYER_JD_MODEL_DEFAULT",
                              os.getenv("STANDARD_MODEL_DEFAULT", "gpt-4o-mini"))) or "gpt-4o").strip()

    # ---- Allow-lists (comma-separated) ----
    WEEKLY_ALLOW    = [s.strip() for s in (os.getenv("WEEKLY_MODEL_ALLOW",
                           os.getenv("PAID_MODEL_ALLOW", "")) or "").split(",") if s.strip()]
    STANDARD_ALLOW  = [s.strip() for s in (os.getenv("STANDARD_MODEL_ALLOW",
                           os.getenv("PAID_MODEL_ALLOW", "")) or "").split(",") if s.strip()]
    PREMIUM_ALLOW   = [s.strip() for s in (os.getenv("PREMIUM_MODEL_ALLOW",
                           "gpt-4o-mini, gpt-4o, gpt-5-mini, gpt-5") or "").split(",") if s.strip()]

    # NEW: Employer JD allow-list
    EMPLOYER_JD_ALLOW = [s.strip() for s in (
        os.getenv("EMPLOYER_MODEL_ALLOW",
                  os.getenv("EMPLOYER_JD_MODEL_ALLOW",
                            os.getenv("STANDARD_MODEL_ALLOW", ""))) or ""
    ).split(",") if s.strip()]

    if plan == "free":
        out = [FREE_DEFAULT]  # single option
    elif plan == "weekly":
        out = _dedupe([WEEKLY_DEFAULT] + WEEKLY_ALLOW)
    elif plan == "standard":
        out = _dedupe([STANDARD_DEFAULT] + STANDARD_ALLOW)
    elif plan == "premium":
        out = _dedupe([PREMIUM_DEFAULT] + PREMIUM_ALLOW)
    elif plan == "employer_jd":
        # Pick one policy:
        # 1) Mirror Standard:
        # out = _dedupe([STANDARD_DEFAULT] + STANDARD_ALLOW)
        # 2) Dedicated employer settings (recommended):
        out = _dedupe([EMPLOYER_JD_DEFAULT] + EMPLOYER_JD_ALLOW)
        # 3) No chat access: comment the line above and use out = [FREE_DEFAULT]
    else:
        # unknown plan -> treat as free
        out = [FREE_DEFAULT]

    # ---- Optional: keep only models actually available to your key ----
    avail = _available_models()
    if avail:
        filtered = [m for m in out if m in avail]
        if filtered:
            return filtered
        if FREE_DEFAULT in avail:
            return [FREE_DEFAULT]
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

def _determine_locale_redirect() -> str:
    target = request.args.get("next") if request else None
    if not _is_safe_next(target):
        referer = request.referrer or ""
        ref_path = urlparse(referer).path if referer else ""
        target = ref_path if _is_safe_next(ref_path) else None

    if not target:
        target = url_for("pricing") if request else "/pricing"

    return target


def _locale_secure_cookie() -> bool:
    return bool(current_app.config.get("SESSION_COOKIE_SECURE", True))


@app.get("/locale/language/<lang_code>", endpoint="set_language")
def change_language(lang_code: str):
    lang = _coerce_language(lang_code)
    session["language"] = lang

    if not session.get("currency_manual"):
        default_currency = LANGUAGE_DEFAULT_CURRENCY.get(lang)
        if default_currency:
            session["currency"] = _coerce_currency(default_currency)

    redirect_target = _determine_locale_redirect()

    resp = redirect(redirect_target)
    resp.set_cookie(
        "jobcus_lang",
        lang,
        max_age=60 * 60 * 24 * 365,
        samesite="Lax",
        secure=_locale_secure_cookie(),
    )
    return resp


@app.get("/locale/currency/<currency_code>", endpoint="set_currency")
def change_currency(currency_code: str):
    currency = _coerce_currency(currency_code)
    session["currency"] = currency
    session["currency_manual"] = True

    redirect_target = _determine_locale_redirect()

    resp = redirect(redirect_target)
    resp.set_cookie(
        "jobcus_currency",
        currency,
        max_age=60 * 60 * 24 * 365,
        samesite="Lax",
        secure=_locale_secure_cookie(),
    )
    return resp

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

ALLOWED_EXTS = {
    "pdf", "txt", "rtf", "doc", "docx",
    "png", "jpg", "jpeg", "webp",
    *({"heic", "heif"} if HEIF_ENABLED else set())
}

MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # keep this as-is

def _allowed(filename: str) -> bool:
    return "." in filename and filename.rsplit(".",1)[1].lower() in ALLOWED_EXTS

# ------ extract_text -------
def _extract_text(path: str, ext: str) -> str:
    ext = (ext or "").lower()
    try:
        if ext == "pdf":
            # 1) Try normal (text) PDF extraction first
            text = ""
            try:
                from pypdf import PdfReader
                with open(path, "rb") as f:
                    reader = PdfReader(f)
                    out = []
                    for page in reader.pages:
                        out.append(page.extract_text() or "")
                    text = "\n".join(out).strip()
            except Exception:
                pass

            # 2) If empty (image-only PDF), OCR each page (needs poppler)
            if not text.strip():
                try:
                    from pdf2image import convert_from_path
                    pages = convert_from_path(path, dpi=300)  # needs poppler-utils
                    bits = []
                    for pg in pages:
                        g = pg.convert("L")
                        g = ImageOps.autocontrast(g)
                        g = g.filter(ImageFilter.MedianFilter(size=3))
                        bits.append(pytesseract.image_to_string(g) or "")
                    text = "\n".join(bits).strip()
                except Exception:
                    # Optional: pdfplumber as a second attempt
                    try:
                        import pdfplumber
                        with pdfplumber.open(path) as pdf:
                            text = "\n".join([(p.extract_text() or "") for p in pdf.pages]).strip()
                    except Exception:
                        pass
            return text

        elif ext in ("doc", "docx"):
            import docx2txt
            return (docx2txt.process(path) or "").strip()

        elif ext == "rtf":
            raw = open(path, "rb").read().decode(errors="ignore")
            return re.sub(r"{\\.*?}|\\[a-z]+\d* ?|[{}]", " ", raw).strip()

        elif ext in ("png", "jpg", "jpeg", "webp", "heic", "heif"):
            return _img_to_text_file(path)

        else:  # treat as plain text (e.g., .txt)
            return open(path, "rb").read().decode(errors="ignore").strip()

    except Exception:
        return ""

# --- Employer JD helpers ------------------------------------------------------

def _tone_instructions(name: str) -> str:
    name = (name or "").lower()
    presets = {
        "friendly":  "Warm, approachable, clear. 7th–9th grade readability. Avoid jargon.",
        "formal":    "Concise, professional, third-person. Use neutral corporate tone.",
        "technical": "Precise and explicit. Use domain terminology where appropriate.",
        "inclusive": "Use inclusive, bias-free language. Avoid gendered or exclusionary phrasing.",
        "energetic": "Upbeat and motivating. Keep sentences active and concise."
    }
    return presets.get(name, presets["friendly"])

def _static_skill_seed(title: str) -> list[str]:
    """Very small local seed to work even without model access."""
    t = (title or "").lower()
    if "data" in t and "analyst" in t:
        return ["SQL", "Excel", "Python", "Tableau/ Power BI", "A/B testing", "Stakeholder communication", "Statistics"]
    if "product" in t and "manager" in t:
        return ["Roadmapping", "User research", "Backlog management", "A/B testing", "Analytics", "PRD writing", "Stakeholder management"]
    if ("software" in t or "engineer" in t or "developer" in t):
        return ["Git", "Code review", "Testing/QA", "REST APIs", "CI/CD", "Agile/Scrum", "Cloud (AWS/GCP/Azure)"]
    if "designer" in t:
        return ["Figma", "Prototyping", "User research", "Design systems", "Accessibility", "Heuristic evaluation", "Handoff to dev"]
    return ["Communication", "Time management", "Collaboration", "Problem-solving"]

def is_superadmin(user=None):
    from flask_login import current_user
    user = user or current_user
    return getattr(user, "role", "").lower() == "superadmin"


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

@app.route("/robots.txt")
def robots_txt():
    body = """User-agent: *
Allow: /
Disallow: /account
Disallow: /logout
Disallow: /dashboard
Disallow: /forgot-password
Disallow: /api/
# Note: Do NOT block static assets (CSS, JS, images), so we omit /static/

Sitemap: https://www.jobcus.com/sitemap.xml

# OpenAI crawler — explicitly allowed
User-agent: GPTBot
Allow: /
"""
    return Response(body, mimetype="text/plain")

@app.route("/sitemap.xml")
def sitemap_xml():
    pages = [
        (url_for("index", _external=True),           "weekly"),
        (url_for("pricing", _external=True),         "weekly"),
        (url_for("dashboard", _external=True),       "daily"),
        ("https://www.jobcus.com/chat",              "daily"),
        ("https://www.jobcus.com/resume-analyzer",   "daily"),
        ("https://www.jobcus.com/resume-builder",    "daily"),
        ("https://www.jobcus.com/cover-letter",      "daily"),
        ("https://www.jobcus.com/interview-coach",   "weekly"),
        ("https://www.jobcus.com/skill-gap",         "weekly"),
        ("https://www.jobcus.com/job-insights",      "weekly"),
        ("https://www.jobcus.com/employers",         "weekly"),
        ("https://www.jobcus.com/privacy-policy",    "yearly"),
        ("https://www.jobcus.com/terms-of-service",  "yearly"),
    ]
    today = datetime.utcnow().strftime("%Y-%m-%d")
    xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    ]
    for loc, freq in pages:
        xml += [ "<url>", f"<loc>{loc}</loc>", f"<lastmod>{today}</lastmod>", f"<changefreq>{freq}</changefreq>", "</url>" ]
    xml.append("</urlset>")
    return Response("\n".join(xml), mimetype="application/xml")


@app.route("/chat")
@login_required
def chat():
    plan = (getattr(current_user, "plan", "free") or "free").lower()

    # Gate: only show Chat if the plan allows it
    if not feature_enabled(plan, "has_chat"):
        flash("AI Chat isn’t included in your current plan. Please upgrade to use Chat.", "error")
        return redirect(url_for("pricing") + "#employer-pricing")

    allowed = allowed_models_for_plan(plan)
    is_paid_chat = plan in ("weekly", "standard", "premium")  # employer_jd has limited chat

    # ✅ define cloud_history before using it
    ch_flag = feature_enabled(plan, "cloud_history")

    return render_template(
        "chat.html",
        is_paid=is_paid_chat,
        plan=plan,
        model_options=allowed,
        free_model=allowed_models_for_plan("free")[0],
        model_default=allowed[0],
        cloud_history=1 if ch_flag else 0,   # pass as 1/0 for JS
        show_upgrade=(plan in ("free", "employer_jd")),
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

@app.route("/job-insights", methods=["GET"], endpoint="job_insights_page")
def job_insights_page():
    return render_template("job-insights.html")

@app.route("/employers")
def employers():
    return render_template("employers.html")

@app.get("/faq")
def faq_legacy_redirect():
    # Send users and crawlers to the FAQ section on the homepage
    return redirect(url_for("index") + "#faq", code=301)

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
    plans = _plans()
    return render_template("pricing.html", free_used=free_used, plans=plans)

def _plans():
    currency = _current_currency()
    prices = build_plan_price_matrix(currency)
    return {
        "free": {
            "code": "free",
            "title": _("Free"),
            "amount": prices["free"]["amount_html"],
            "period": PLAN_PERIODS["free"],
            "tagline": _("Great for a quick check"),
            "display_price": prices["free"],
            "features": [
                _("AI Chat trial: <strong>15 Responses</strong> total"),
                _("<strong>2</strong> resume analyses / month (basic score + tips)"),
                _("<strong>1</strong> AI cover letter / month"),
                _("AI Resume Builder (basic templates; <strong>1</strong> download / month)"),
                _("Skill-Gap snapshot (1 basic analysis / month)"),
                _("Job Insights (basic charts)"),
                _("Interview Coach (limited practice; <strong>1</strong> / month)"),
                _("Local device history"),
            ],
        },
        "weekly": {
            "code": "weekly",
            "title": _("Weekly Pass"),
            "amount": prices["weekly"]["amount_html"],
            "period": PLAN_PERIODS["weekly"],
            "tagline": _("For urgent applications"),
            "display_price": prices["weekly"],
            "features": [
                _("AI Chat credits: <strong>100 responses</strong> / week"),
                _("<strong>10</strong> resume analyses / week"),
                _("<strong>5</strong> AI cover letters / week"),
                _("Resume Builder: <strong>5 downloads</strong> / week"),
                _("“Rebuild with AI” for resumes"),
                _("Skill-Gap (standard)"),
                _("Job Insights (full access)"),
                _("Interview Coach sessions"),
                _("Email support"),
            ],
        },
        "standard": {
            "code": "standard",
            "title": _("Standard"),
            "amount": prices["standard"]["amount_html"],
            "period": PLAN_PERIODS["standard"],
            "tagline": _("Serious applications, smarter tools"),
            "display_price": prices["standard"],
            "features": [
                _("AI Chat credits: <strong>unlimited</strong> / month"),
                _("<strong>50</strong> resume analyses / month (deep ATS + JD match)"),
                _("<strong>20</strong> AI cover letters / month"),
                _("Resume Builder: <strong>20 downloads</strong> / month"),
                _("AI Optimize + Rebuild with AI"),
                _("Interview Coach sessions"),
                _("Skill-Gap (pro)"),
                _("Job Insights (full access)"),
                _("Download optimized PDF / DOCX / TXT"),
                _("Save history across devices"),
                _("Email support"),
            ],
        },
        "premium": {
            "code": "premium",
            "title": _("Premium"),
            "amount": prices["premium"]["amount_html"],
            "period": PLAN_PERIODS["premium"],
            "tagline": _("Best value for ongoing career growth"),
            "display_price": prices["premium"],
            "features": [
                _("AI Chat credits: <strong>unlimited</strong> / year (~1,000 / mo)"),
                _("<strong>Unlimited*</strong> resume analyses (fair use)"),
                _("<strong>Unlimited</strong> AI cover letters (fair use)"),
                _("Resume Builder: <strong>unlimited</strong> downloads (fair use)"),
                _("All Standard features + multi-resume versions & template pack"),
                _("Priority support & early access to new AI tools"),
            ],
        },
        # NEW — Employer (B2B) starter plan
        "employer_jd": {
            "code": "employer_jd",
            "title": _("JD Generator"),
            "amount": prices["employer_jd"]["amount_html"],
            "period": PLAN_PERIODS["employer_jd"],
            "tagline": _("AI Job Description Generator"),
            "display_price": prices["employer_jd"],
            "features": [
                _("Unlimited* JD generations (fair use)"),
                _("Brand tone presets"),
                _("Export to DOCX/PDF"),
                _("JD–skills taxonomy suggestions"),
                _("Email support"),
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
    if "display_price" not in plan_data:
        plan_data["display_price"] = plan_price_display(plan_code, _current_currency())

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
        currency = _current_currency()
        price_map = current_app.config.get("PLAN_PRICE_IDS", {})
        plan_prices = price_map.get(plan_code, {})
        price_id = (
            plan_prices.get(currency)
            or plan_prices.get(DEFAULT_CURRENCY)
            or plan_prices.get("GBP")
        )
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
    placeholder_vals = {"{CHECKOUT_SESSION_ID}", "%7BCHECKOUT_SESSION_ID%7D"}

    def _send_success_from(session_obj, metadata):
        # Build details for the success email
        sub = session_obj.subscription if getattr(session_obj, "subscription", None) else None
        if isinstance(sub, str) and sub:
            sub = stripe.Subscription.retrieve(sub, expand=["items.data.price"])
        elif sub and getattr(sub, "object", None) == "subscription" and not getattr(sub.items.data[0], "price", None):
            sub = stripe.Subscription.retrieve(sub.id, expand=["items.data.price"])

        details = _sub_human_details(sub) if sub else {"interval":"month","amount":None,"currency":"GBP","renews_at_iso":None}
        plan_code = (metadata or {}).get("plan_code", "") or details.get("plan_code", "")
        plan_name = _plans().get(plan_code, {}).get("title", "Your plan")

        # Try payment details (brand/last4) via invoice -> payment_intent -> charge
        payment_brand, payment_last4 = None, None
        try:
            inv_id = getattr(session_obj, "invoice", None)
            if inv_id:
                inv = stripe.Invoice.retrieve(inv_id, expand=["payment_intent.latest_charge.payment_method_details"])
                pid = inv.payment_intent
                ch  = pid.latest_charge if pid and getattr(pid, "latest_charge", None) else None
                pm  = ch.payment_method_details.card if ch and ch.payment_method_details and getattr(ch.payment_method_details, "card", None) else None
                if pm:
                    payment_brand = pm.get("brand") or None
                    payment_last4 = pm.get("last4") or None
        except Exception:
            current_app.logger.info("Could not enrich success email with card details")

        # Billing portal manage link
        try:
            manage_url = create_billing_portal_url(session_obj.customer, url_for("dashboard", _external=True))
        except Exception:
            manage_url = url_for("dashboard", _external=True)

        # Lookup user email/name
        user_email = current_user.email
        user_name  = getattr(current_user, "fullname", None) or getattr(current_user, "first_name", None)

        # Send the email
        try:
            send_success_email(
                to_email=user_email,
                plan_name=plan_name,
                amount=details["amount"],
                interval=details["interval"],
                currency=details["currency"],
                next_renewal_date=details["renews_at_iso"],
                order_number=sub.id if sub else None,
                order_date=time.strftime("%Y-%m-%d %H:%M", time.gmtime()) if sub else None,
                payment_brand=payment_brand,
                payment_last4=payment_last4,
                manage_url=manage_url,
                user_name=user_name
            )
        except Exception:
            current_app.logger.exception("Failed to send success email")

    # ===== Recovery path if session_id is missing/placeholder =====
    if (not session_id) or (session_id in placeholder_vals):
        supabase = current_app.config["SUPABASE"]
        try:
            r = (supabase.table("users")
                 .select("stripe_customer_id")
                 .eq("auth_id", current_user.id)
                 .single()
                 .execute())
            scid = (r.data or {}).get("stripe_customer_id")
        except Exception:
            scid = None

        if scid:
            try:
                sessions = stripe.checkout.Session.list(customer=scid, limit=1)
                if sessions.data:
                    cs = sessions.data[0]
                    if cs.payment_status == "paid":
                        metadata = cs.metadata or {}
                        customer_id = cs.customer
                        subscription_id = (cs.subscription.id if getattr(cs, "subscription", None) else None)
                        _activate_user_plan_by_metadata(supabase, metadata, customer_id, subscription_id)

                        # success email
                        try: _send_success_from(cs, metadata)
                        except Exception: current_app.logger.exception("send_success (recovered session) failed")

                        raw_next = request.args.get("next")
                        if _is_safe_next(raw_next):
                            return redirect(raw_next)

                        plan_code = metadata.get("plan_code", "")
                        plan_name = _plans().get(plan_code, {}).get("title", "Your plan")
                        return render_template("subscribe-success.html", plan_human=plan_name, plan_json=plan_code)
            except Exception:
                current_app.logger.exception("Could not recover Checkout session")

        flash("Payment completed. If features aren’t unlocked yet, they’ll be within a minute.", "info")
        return redirect(url_for("pricing"))

    # ===== Normal path with a real session id =====
    cs = stripe.checkout.Session.retrieve(session_id, expand=["subscription"])
    if cs.payment_status != "paid":
        flash("Payment not completed yet. If this persists, contact support.", "error")
        return redirect(url_for("pricing"))

    supabase = current_app.config["SUPABASE"]
    metadata = cs.metadata or {}
    customer_id = cs.customer
    subscription_id = cs.subscription.id if getattr(cs, "subscription", None) else None

    _activate_user_plan_by_metadata(supabase, metadata, customer_id, subscription_id)

    # success email
    try: _send_success_from(cs, metadata)
    except Exception: current_app.logger.exception("send_success failed")

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
    os.getenv("STRIPE_PRICE_WEEKLY"):       "weekly",
    os.getenv("STRIPE_PRICE_STANDARD"):     "standard",
    os.getenv("STRIPE_PRICE_PREMIUM"):      "premium",

    # NEW — Employer JD Generator (£25/mo)
    os.getenv("STRIPE_PRICE_EMPLOYER_JD"):  "employer_jd",
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

    # ----- Verify Stripe signature -----
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, endpoint_secret)
    except ValueError:
        return ("Bad payload", 400)
    except stripe.error.SignatureVerificationError:
        return ("Bad signature", 400)

    etype = event["type"]
    obj   = event["data"]["object"]

    # ----- OPTIONAL: Idempotency (avoid double-processing the same event) -----
    # If you want this, create a tiny table 'stripe_events' with columns: id (text, PK), type (text), created_at (timestamp default now()).
    # Then uncomment the block below.
    """
    try:
        eid = event.get("id")
        if eid:
            # If this event id already exists, we've processed it before.
            seen = supabase.table("stripe_events").select("id").eq("id", eid).execute()
            if seen.data:
                return ("OK", 200)
            # Mark as seen
            supabase.table("stripe_events").insert({"id": eid, "type": etype}).execute()
    except Exception:
        current_app.logger.info("Idempotency check failed; continuing without it.")
    """

    # ----- Handle events -----
    if etype == "checkout.session.completed":
        # Initial activation via Checkout
        metadata = obj.get("metadata", {}) or {}
        customer_id = obj.get("customer")
        subscription_id = obj.get("subscription")
        _activate_user_plan_by_metadata(supabase, metadata, customer_id, subscription_id)

    elif etype in ("customer.subscription.created", "customer.subscription.updated"):
        # Continuous sync based on the subscription object
        _update_user_plan_from_subscription(supabase, obj)

    elif etype == "customer.subscription.deleted":
        customer_id = obj.get("customer")
        _deactivate_user_plan_by_customer(supabase, customer_id)

    elif etype == "invoice.payment_failed":
        # Notify user to update payment; optionally flag account as past_due; notify admin
        try:
            invoice = obj
            customer_id = invoice.get("customer")
            amount_due  = (invoice.get("amount_due") or 0) / 100
            currency    = (invoice.get("currency") or "gbp").upper()

            # Best-effort reason
            lpe = invoice.get("last_payment_error") or {}
            reason = (lpe.get("message") or lpe.get("decline_code") or "Payment failed")

            # Billing portal link for updating payment
            try:
                update_url = create_billing_portal_url(customer_id, url_for("dashboard", _external=True))
            except Exception:
                update_url = url_for("dashboard", _external=True)

            # Find the user by Stripe customer id
            auth_id   = _find_user_id_by_customer(supabase, customer_id)  # you already use this helper elsewhere
            email     = None
            user_name = None
            if auth_id:
                r = (
                    supabase.table("users")
                    .select("email, fullname")
                    .eq("auth_id", auth_id)
                    .single()
                    .execute()
                )
                row = r.data or {}
                email = row.get("email")
                user_name = row.get("fullname")

                # (Optional) mark plan_status as past_due for UX
                try:
                    supabase.table("users").update({"plan_status": "past_due"}).eq("auth_id", auth_id).execute()
                except Exception:
                    pass

            # Fallback to invoice email if not in DB
            email = email or invoice.get("customer_email")

            if email:
                send_failed_email(email, amount_due, currency, reason, update_url, user_name)

        except Exception:
            current_app.logger.exception("invoice.payment_failed handler failed")

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

# app.py
from security import verify_turnstile

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

    # 🔒 Cloudflare Turnstile verification
    ok, details = verify_turnstile(request)
    if not ok:
        current_app.logger.warning(f"Turnstile verification failed: {details}")
        return jsonify(success=False, message="Security verification failed. Please try again."), 403

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
        mode = "login"

    if not email or not password:
        return jsonify(success=False, message="Email and password are required."), 400

    # ---------- SIGNUP ----------
    if mode == "signup":
        try:
            resp = supabase.auth.sign_up({"email": email, "password": password})
            user = resp.user
            if not user:
                return jsonify(success=False, message="Signup failed."), 400

            ud = user.model_dump() if hasattr(user, "model_dump") else user
            auth_id = ud["id"]

            # Create DB row
            try:
                supabase.table("users").insert({
                    "auth_id": auth_id, "email": email, "fullname": name
                }).execute()
            except Exception:
                pass

            # Auto-promote superadmin if email matches ADMIN_EMAILS
            admin_emails = {e.strip().lower() for e in (os.getenv("ADMIN_EMAILS") or "").split(",") if e.strip()}
            if email and email.lower() in admin_emails:
                try:
                    supabase.table("users").update({"role": "superadmin"}).eq("auth_id", auth_id).execute()
                except Exception:
                    current_app.logger.exception("auto-promote admin failed")

            # Require confirmation
            if not ud.get("email_confirmed_at"):
                session["pending_email"] = email
                return jsonify(success=True, redirect=url_for("check_email")), 200

            # Success path
            login_user(User(auth_id=auth_id, email=email, fullname=name))
            record_login_event(current_user)
            _, set_cookie = start_user_session(current_user)
            resp = jsonify(success=True, redirect=url_for("chat"))
            return set_cookie(resp), 200

        except AuthApiError as e:
            msg = str(e).lower()
            if "already registered" in msg:
                return jsonify(success=False, code="user_exists", message="Account already exists. Please log in."), 409
            current_app.logger.warning(f"Signup error for {email}: {e}")
            return jsonify(success=False, message="Signup failed."), 400
        except Exception:
            current_app.logger.exception("Unexpected signup error")
            return jsonify(success=False, message="Signup failed."), 400

    # ---------- LOGIN ----------
    # mode == "login"
    try:
        resp = supabase.auth.sign_in_with_password({"email": email, "password": password})
        user = resp.user
        if not user:
            return jsonify(success=False, message="Invalid email or password."), 401

        ud = user.model_dump() if hasattr(user, "model_dump") else user
        auth_id = ud["id"]

        # Auto-promote admin
        admin_emails = {e.strip().lower() for e in (os.getenv("ADMIN_EMAILS") or "").split(",") if e.strip()}
        if email and email.lower() in admin_emails:
            try:
                supabase.table("users").update({"role": "superadmin"}).eq("auth_id", auth_id).execute()
            except Exception:
                current_app.logger.exception("auto-promote admin failed")

        # Optional fullname fetch
        try:
            r = supabase.table("users").select("fullname").eq("auth_id", auth_id).single().execute()
            fullname = (r.data or {}).get("fullname")
        except Exception:
            fullname = None

        # Success path
        login_user(User(auth_id=auth_id, email=email, fullname=fullname))
        record_login_event(current_user)
        _, set_cookie = start_user_session(current_user)
        resp = jsonify(success=True, redirect=url_for("chat"))
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
            location.replace(j.redirect || "/chat");
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

        resp = jsonify(success=True, redirect=url_for("chat"))
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

STYLE_GUIDE = (
    "Write like a real human—be professional but natural, like you’re explaining something to a smart friend. "
    "Avoid buzzwords, corporate jargon, and em dashes. Never sound like a press release; "
    "be clear, direct, conversational, and real."
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
    msgs = [
        {"role": "system", "content": CAREER_SYSTEM_PROMPT},
        {"role": "system", "content": STYLE_GUIDE},  # ← add this line
    ]
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
    message   = (data.get("message") or "").strip()
    requested = (data.get("model")   or "").strip()
    model     = choose_model(requested)
    conv_id   = data.get("conversation_id")

    if not message:
        return jsonify(error="bad_request", message="message is required"), 400

    # --- Attachment context (from client) ---
    attachments = data.get("attachments") or []
    att_blocks = []
    for att in attachments:
        fname = (att.get("filename") or "attachment.txt")[:80]
        text  = (att.get("text") or "")
        if not text:
            continue
        snippet = text[:8000]  # keep token/word budget sane
        att_blocks.append(f"--- {fname} ---\n{snippet}")
    att_context = "\n\n".join(att_blocks)
    if att_context:
        message = f"{message}\n\n[Attachment context]\n{att_context}"
    # --- end attachment block ---

    auth_id = getattr(current_user, "id", None) or getattr(current_user, "auth_id", None)
    plan    = (getattr(current_user, "plan", "free") or "free").lower()

    # ⛔ Hard gate for API: if this plan doesn't include Chat, stop here
    if not feature_enabled(plan, "has_chat", True):
        return jsonify(error="upgrade_required", message="Chat not included in your plan."), 402

    # 1) free/abuse guard (device-based)
    try:
        ok, payload = allow_free_use(str(auth_id), plan)
        if not ok:
            return jsonify({
                "error": payload.get("error") or "too_many_free_accounts",
                "message": payload.get("message") or "Free daily limit reached for this device."
            }), 429
    except Exception:
        pass  # fail-open

    # 2) credits/quota — increments the plan’s chat counter atomically
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

    # payload
    conv_id = data.get("conversation_id")
    
    # Validate conversation ownership/existence
    if conv_id:
        try:
            owns = (
                admin.table("conversations")
                .select("id")
                .eq("id", str(conv_id))
                .eq("auth_id", auth_id)
                .limit(1)
                .execute()
                .data
            )
            if not owns:
                conv_id = None
        except Exception:
            conv_id = None
    
    # 3) Create conversation if needed
    if not conv_id:
        title = (message[:60] + "…") if len(message) > 60 else (message or "Conversation")
        row = admin.table("conversations").insert(
            {"auth_id": auth_id, "title": title}
        ).execute()
        conv_id = row.data[0]["id"]
    
    # 4) Now safe to insert the user message
    admin.table("conversation_messages").insert({
        "conversation_id": conv_id, "role": "user", "content": message
    }).execute()

    # 5) short history window
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

# --- Conversations list ---
@app.get("/api/conversations")
@api_login_required
def list_conversations():
    admin = current_app.config.get("SUPABASE_ADMIN")
    if not admin:
        return jsonify(error="server_config", message="Supabase admin client is not configured."), 500

    try:
        auth_id = getattr(current_user, "id", None) or getattr(current_user, "auth_id", None)
        rows = (
            admin.table("conversations")
            .select("id,title,created_at")
            .eq("auth_id", auth_id)
            .order("created_at", desc=True)
            .limit(50)
            .execute()
            .data or []
        )
        return jsonify(rows)
    except Exception as e:
        current_app.logger.exception("list_conversations failed")
        return jsonify(error="server_error", message=str(e)), 500


# --- Messages for a conversation (UUID path converter preserved) ---
@app.get("/api/conversations/<uuid:conv_id>/messages")
@api_login_required
def list_messages(conv_id):
    admin = current_app.config.get("SUPABASE_ADMIN")
    if not admin:
        return jsonify(error="server_config", message="Supabase admin client is not configured."), 500

    auth_id = getattr(current_user, "id", None) or getattr(current_user, "auth_id", None)

    try:
        # Verify the conversation belongs to the current user
        owns = (
            admin.table("conversations")
            .select("id")
            .eq("id", str(conv_id))
            .eq("auth_id", auth_id)
            .limit(1)
            .execute()
            .data
        )
        if not owns:
            return jsonify(error="not_found", message="Conversation not found."), 404

        rows = (
            admin.table("conversation_messages")
            .select("role,content,created_at")
            .eq("conversation_id", str(conv_id))
            .order("created_at")      # <-- fixed
            .limit(200)
            .execute()
            .data or []
        )
        return jsonify(rows)
    except Exception as e:
        current_app.logger.exception("list_messages failed")
        return jsonify(error="server_error", message=str(e)), 500


# --- Rename conversation ---
@app.patch("/api/conversations/<uuid:cid>")
@api_login_required
def rename_conversation(cid):
    admin = current_app.config.get("SUPABASE_ADMIN")
    if not admin:
        return jsonify(error="server_config", message="Supabase admin client is not configured."), 500

    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify(error="bad_request", message="Missing title"), 400

    auth_id = getattr(current_user, "id", None) or getattr(current_user, "auth_id", None)

    # ensure ownership & update
    owns = admin.table("conversations").select("id").eq("id", str(cid)).eq("auth_id", auth_id).limit(1).execute().data
    if not owns:
        return jsonify(error="not_found", message="Conversation not found."), 404

    r = admin.table("conversations").update({"title": title}).eq("id", str(cid)).eq("auth_id", auth_id).execute()
    return jsonify(ok=True)

# --- Delete conversation (and its messages) ---
@app.delete("/api/conversations/<uuid:cid>")
@api_login_required
def delete_conversation(cid):
    admin = current_app.config.get("SUPABASE_ADMIN")
    if not admin:
        return jsonify(error="server_config", message="Supabase admin client is not configured."), 500

    auth_id = getattr(current_user, "id", None) or getattr(current_user, "auth_id", None)

    # 1) Verify ownership on the parent
    owns = (
        admin.table("conversations")
        .select("id").eq("id", str(cid)).eq("auth_id", auth_id)
        .limit(1).execute().data
    )
    if not owns:
        return jsonify(error="not_found", message="Conversation not found."), 404

    # 2) Delete children by conversation_id ONLY (no auth_id in this table)
    admin.table("conversation_messages").delete().eq("conversation_id", str(cid)).execute()

    # 3) Now delete the parent — THIS is where the line goes
    admin.table("conversations").delete().eq("id", str(cid)).eq("auth_id", auth_id).execute()

    return "", 204


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

@app.get("/api/salary")
def salary_api_external():
    role = (request.args.get("role") or "").strip()
    location = (request.args.get("location") or "").strip()

    # Try external real data first
    real = fetch_salary_external(role, location)
    if real:
        return jsonify({"labels":[f"{role} – {location}"], "salaries":[real]})

    # Fallback so charts don’t break
    labels, salaries = compute_salary(role, location)
    return jsonify({"labels": labels, "salaries": salaries})

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

@app.after_request
def set_security_headers(resp):
    csp = (
        "default-src 'self'; "
        "img-src 'self' data: https:; "
        # keep https: so fonts.googleapis.com CSS still loads + allow Stripe's style usage
        "style-src 'self' 'unsafe-inline' https: https://js.stripe.com https://fonts.googleapis.com; "
        # allow Stripe, Google Tag Manager, CDNs, Cloudflare Turnstile, etc.
        "script-src 'self' 'unsafe-inline' "
            "https://js.stripe.com "
            "https://www.googletagmanager.com "
            "https://cdn.jsdelivr.net "
            "https://cdnjs.cloudflare.com "
            "https://unpkg.com "
            "https://me.kis.v2.scr.kaspersky-labs.com "
            "wss://me.kis.v2.scr.kaspersky-labs.com "
            "https://challenges.cloudflare.com; "
        # allow API calls broadly to https (covers Supabase & Stripe endpoints too)
        "connect-src 'self' https: https://*.supabase.co https://*.supabase.in; "
        # fonts can come from your host or CDNs/data URIs
        "font-src 'self' https: data: https://fonts.gstatic.com; "
        # iframes/popups used by Stripe Checkout/Elements/Portal and Turnstile
        "frame-src 'self' https://js.stripe.com https://checkout.stripe.com "
            "https://hooks.stripe.com https://challenges.cloudflare.com; "
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

@app.post("/api/employer/skills-suggest")
def employer_skills_suggest():
    data = request.get_json(silent=True) or {}
    title   = (data.get("jobTitle") or "").strip()
    summary = (data.get("summary") or "").strip()

    # Try LLM first; fallback to small seed so UI still works
    skills = []
    try:
        client = current_app.config.get("OPENAI_CLIENT")
        if client and title:
            system = (
                "You suggest skills for job descriptions. "
                "Return a concise, de-duplicated list (max 25) of canonical skill names; "
                "mix core skills, domain tools, and soft skills when relevant. "
                "Response must be JSON with a top-level 'skills' string array."
            )
            usermsg = f"JOB TITLE: {title}\nSUMMARY: {summary or '(none)'}"
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role":"system","content": system},
                    {"role":"user","content": usermsg}
                ],
                response_format={"type":"json_object"},
                temperature=0.2,
            )
            import json
            payload = json.loads(resp.choices[0].message.content)
            skills = [s for s in payload.get("skills", []) if isinstance(s, str)]
    except Exception as e:
        current_app.logger.warning("skills_suggest LLM fallback: %s", e)

    if not skills:
        skills = _static_skill_seed(title)

    # unique + trimmed
    seen = set()
    norm = []
    for s in skills:
        k = s.strip()
        if k and k.lower() not in seen:
            seen.add(k.lower())
            norm.append(k)

    return jsonify({"skills": norm})

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

    # NEW: tone + skills
    tone_preset    = (data.get("tonePreset") or "friendly").strip().lower()
    include_skills = bool(data.get("includeSkills"))
    selected_skills = data.get("selectedSkills") or []
    tone_rules = _tone_instructions(tone_preset)

    # dedupe/clean skills
    if include_skills and isinstance(selected_skills, list):
        seen = set(); cleaned = []
        for s in selected_skills:
            k = (s or "").strip()
            if k and k.lower() not in seen:
                seen.add(k.lower()); cleaned.append(k)
        selected_skills = cleaned
    else:
        selected_skills = []

    if not job_title or not company:
        return jsonify(error="jobTitle and company are required"), 400

    client = current_app.config.get("OPENAI_CLIENT")

    skills_block = ""
    if include_skills and selected_skills:
        skills_block = (
            "Include a 'Required Skills' section using these canonical skills "
            "(merge, deduplicate, and phrase naturally):\n"
            + ", ".join(selected_skills) + "\n"
        )

    system = (
        "You generate clear, inclusive job descriptions with sections in plain text:\n"
        "1) Role Summary, 2) Responsibilities, 3) Required Skills, 4) Nice-to-have, 5) Benefits, 6) How to Apply.\n"
        "Follow the requested brand tone. Avoid bias and overly gendered terms. "
        "Use concise bullet points and blank lines between sections."
    )

    user_prompt = f"""
COMPANY: {company}
JOB TITLE: {job_title}
LOCATION: {location or "—"}
EMPLOYMENT TYPE: {emp_type or "—"}
SALARY RANGE: {salary or "—"}
HOW TO APPLY: {apply_to or "—"}
APPLICATION DEADLINE: {deadline or "—"}

OPENING SUMMARY / NOTES:
{summary or "—"}

BRAND TONE PRESET: {tone_preset.upper()}
TONE INSTRUCTIONS: {tone_rules}

{skills_block}
Return PLAIN TEXT only (no Markdown). Length 500–900 words.
""".strip()

    if not client:
        # existing lightweight fallback (kept)
        text = (
            f"{company} is hiring a {job_title} in {location or 'our UK team'}.\n\n"
            "Responsibilities:\n"
            "- Deliver key projects with cross-functional teams.\n"
            "- Communicate clearly with stakeholders and manage timelines.\n"
            "- Improve processes and document best practices.\n\n"
            "Requirements:\n"
            + ("- " + "\n- ".join(selected_skills) + "\n\n" if selected_skills else
               "- Relevant experience in similar roles.\n- Strong communication and problem-solving skills.\n- Ability to work independently and in teams.\n\n")
            + f"How to apply: {apply_to or 'Send your CV to careers@company.com'}"
        )
        return jsonify(description=text)

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role":"system","content": system},
                {"role":"user","content": user_prompt}
            ],
            temperature=0.5,
            max_tokens=900
        )
        text = (resp.choices[0].message.content or "").strip()
        # if you already import re at top; keep your cleanup
        import re
        text = re.sub(r"```(?:\w+)?", "", text).strip()
        return jsonify(description=text)
    except Exception:
        current_app.logger.exception("job-post generation failed")
        return jsonify(error="Generation failed"), 500


@app.post("/api/employer/job-post/download")
@login_required
def employer_job_post_download():
    """
    JSON body: { "format": "txt"|"pdf"|"docx", "text": "<job description>" }
    Enforces plan 'downloads' gate, returns file as attachment.
    """
    PRICING_URL = url_for("pricing", _external=True)

    data = request.get_json(force=True, silent=True) or {}
    fmt  = (data.get("format") or "txt").lower()
    text = (data.get("text") or "").strip()

    if not text:
        return jsonify(error="No text provided"), 400

    plan = (getattr(current_user, "plan", "free") or "free").lower()

    # Superadmin bypass; otherwise enforce downloads flag
    if not is_superadmin():
        if not feature_enabled(plan, "downloads", default=False):
            PRICING_URL = url_for("pricing", _external=True)
            return jsonify(
                error="upgrade_required",
                message="File downloads are available on the JD Generator and Premium plans.",
                message_html=f'File downloads are available on the JD Generator and Premium plans. <a href="{PRICING_URL}">Upgrade now →</a>',
                pricing_url=PRICING_URL,
            ), 403

    if fmt == "txt":
        return send_file(BytesIO(text.encode("utf-8")),
                         as_attachment=True,
                         download_name="job-description.txt",
                         mimetype="text/plain")

    if fmt == "pdf":
        safe_html = f"""
        <html><head><meta charset="utf-8"></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height:1.5; font-size:12pt;">
          <pre style="white-space:pre-wrap; word-wrap:break-word; margin:0;">{escape(text)}</pre>
        </body></html>
        """.strip()
        pdf_bytes = HTML(string=safe_html, base_url=current_app.root_path).write_pdf(
            stylesheets=[CSS(string="@page{{size:A4;margin:0.75in}}")]
        )
        return send_file(BytesIO(pdf_bytes),
                         mimetype="application/pdf",
                         as_attachment=True,
                         download_name="job-description.pdf")

    if fmt == "docx":
        # Lightweight DOCX writer
        from docx import Document
        from docx.shared import Pt
        doc = Document()
        style = doc.styles["Normal"]
        style.font.name = "Calibri"
        style.font.size = Pt(11)
        for line in text.splitlines():
            doc.add_paragraph(line if line.strip() else "")
        buf = BytesIO()
        doc.save(buf); buf.seek(0)
        return send_file(buf,
                         mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                         as_attachment=True,
                         download_name="job-description.docx")

    # allow client fallback for unrecognized formats
    return jsonify(error="Unsupported format"), 400

@app.post("/api/upload")
@login_required
def api_upload():
    if "file" not in request.files:
        return jsonify(error="no_file", message="No file provided"), 400

    f = request.files["file"]
    if not f or not f.filename:
        return jsonify(error="no_filename", message="No filename"), 400

    if not _allowed(f.filename):
        return jsonify(error="bad_type", message="Unsupported file type"), 400

    # size check (stream into temp to measure)
    tmp = tempfile.NamedTemporaryFile(delete=False)
    try:
        total = 0
        chunk = f.read(1024 * 1024)
        while chunk:
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                tmp.close()
                os.unlink(tmp.name)
                return jsonify(error="too_large", message="Max size is 5 MB"), 413
            tmp.write(chunk)
            chunk = f.read(1024 * 1024)
        tmp.flush()

        filename = secure_filename(f.filename)
        ext = filename.rsplit(".",1)[1].lower()
        text = _extract_text(tmp.name, ext)
        # trim to a reasonable budget to keep prompts small
        text = (text or "")[:200_000]  # ~200k chars max

        return jsonify({
            "filename": filename,
            "size": total,
            "text": text
        })
    finally:
        try:
            tmp.close()
            os.unlink(tmp.name)
        except Exception:
            pass

@app.get("/diag/ocr")
def diag_ocr():
    try:
        tess_path = shutil.which("tesseract")
        tess_ver = str(pytesseract.get_tesseract_version())
    except Exception as e:
        tess_path, tess_ver = None, f"ERR: {e}"

    poppler = {
        "pdftoppm": shutil.which("pdftoppm"),
        "pdftocairo": shutil.which("pdftocairo"),
    }
    return jsonify({
        "tesseract_path": tess_path,
        "tesseract_version": tess_ver,
        "poppler_tools": poppler,
        "heif_enabled": bool(HEIF_ENABLED),
    })

@app.get("/_i18n/debug")
def i18n_debug():
    return {
        "session_language": session.get("language"),
        "cookie_lang": request.cookies.get("jobcus_lang"),
        "selected_locale": str(get_locale()),
    }


# --- Entrypoint ---
if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
