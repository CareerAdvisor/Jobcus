# jobcus/__init__.py
from __future__ import annotations
import os, logging
from datetime import datetime
from flask import Flask, current_app, jsonify, redirect, request, url_for
from flask_cors import CORS
from flask_login import LoginManager
from supabase import create_client

# Local extensions/helpers
from .extensions import init_openai, login_manager  # we will init Supabase here directly
from .routes import register_routes  # your blueprint registrar

def _get_env(name: str, *fallbacks: str) -> str | None:
    """Read the first defined env var among name + fallbacks."""
    for key in (name, *fallbacks):
        val = os.getenv(key)
        if val:
            return val
    return None

def create_app(env: str | None = None) -> Flask:
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    app.secret_key = os.getenv("SECRET_KEY", "supersecret")

    # Secure cookies
    app.config.update(SESSION_COOKIE_SECURE=True, SESSION_COOKIE_SAMESITE="Lax")

    # CORS & logging
    CORS(app)
    logging.basicConfig(level=logging.INFO)

    # ---------- Supabase clients ----------
    # Public (anon) client — used by backend occasionally, and your front-end JS
    supabase_url = _get_env("SUPABASE_URL")
    supabase_anon_key = _get_env("SUPABASE_ANON_KEY", "SUPABASE_KEY")  # support either var
    if not supabase_url or not supabase_anon_key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_ANON_KEY/SUPABASE_KEY")

    app.config["SUPABASE"] = create_client(supabase_url, supabase_anon_key)

    # Service-role (admin) client — REQUIRED for limits, sessions, user bootstrap
    supabase_service_key = _get_env("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY")
    if not supabase_service_key:
        raise RuntimeError("Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)")

    app.config["SUPABASE_ADMIN"] = create_client(supabase_url, supabase_service_key)

    # Expose these so templates/JS can initialize Supabase client in the browser
    app.config["SUPABASE_URL"] = supabase_url
    app.config["SUPABASE_ANON_KEY"] = supabase_anon_key

    # OpenAI
    app.config["OPENAI_CLIENT"] = init_openai()

    # Stripe secret (routes read it when needed)
    app.config["STRIPE_SECRET_KEY"] = os.getenv("STRIPE_SECRET_KEY")

    # ---------- Flask-Login ----------
    login_manager.init_app(app)
    login_manager.login_view = "account"

    # Return JSON 401 on API-ish endpoints instead of HTML redirects
    @login_manager.unauthorized_handler
    def _unauthorized_json_or_redirect():
        apiish = request.path.startswith(("/api/", "/ask", "/jobs", "/resume-", "/build-"))
        if apiish:
            return jsonify(error="login_required"), 401
        return redirect(url_for("account", next=request.url))

    # Minimal user loader using the admin client (matches your services/users.py)
    from .services.users import fetch_user_row
    from flask_login import UserMixin

    class User(UserMixin):
        def __init__(self, auth_id, email=None, plan="free", role="user", **_):
            self.id = auth_id
            self.email = email
            self.plan = (plan or "free").lower()
            self.role = (role or "user").lower()

        @property
        def is_admin(self) -> bool:
            return self.role in ("admin", "superadmin")

        @property
        def is_superadmin(self) -> bool:
            return self.role == "superadmin"

    @login_manager.user_loader
    def load_user(auth_id: str):
        try:
            row = fetch_user_row(auth_id)  # must return at least {auth_id,email,plan,role}
            return User(**row) if row else None
        except Exception:
            logging.exception("load_user failed")
            return None

    # ---------- Context for templates (front-end Supabase) ----------
    @app.context_processor
    def inject_public_supabase():
        return {
            "SUPABASE_URL": app.config.get("SUPABASE_URL", ""),
            "SUPABASE_ANON_KEY": app.config.get("SUPABASE_ANON_KEY", ""),
        }

    # ---------- Blueprints / routes ----------
    register_routes(app)

    # Optional: simple health endpoint
    @app.get("/healthz")
    def health():
        return {"ok": True, "ts": datetime.utcnow().isoformat()}

    return app
