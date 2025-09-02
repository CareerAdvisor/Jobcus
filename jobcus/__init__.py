# jobcus/__init__.py
from __future__ import annotations
import os, logging
from datetime import datetime
from flask import Flask, jsonify, redirect, request, url_for
from flask_cors import CORS
from flask_login import LoginManager, UserMixin, current_user
from supabase import create_client

# local extensions/helpers (adapt imports if needed)
from .extensions import init_openai, login_manager  # uses your shared instance
from .routes import register_routes

def _env(name: str, *fallbacks: str) -> str | None:
    for k in (name, *fallbacks):
        v = os.getenv(k)
        if v:
            return v
    return None

def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    app.secret_key = os.getenv("SECRET_KEY", "supersecret")

    # Secure cookies (once)
    app.config.update(SESSION_COOKIE_SECURE=True, SESSION_COOKIE_SAMESITE="Lax")

    # CORS & logging
    CORS(app)
    logging.basicConfig(level=logging.INFO)

    # ---------- Supabase ----------
    sb_url  = _env("SUPABASE_URL")
    sb_anon = _env("SUPABASE_ANON_KEY", "SUPABASE_KEY")  # support either var
    sb_srv  = _env("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY")

    if not sb_url or not sb_anon:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_ANON_KEY/SUPABASE_KEY")
    if not sb_srv:
        raise RuntimeError("Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)")

    # Public client (mirrors front-end)
    app.config["SUPABASE"] = create_client(sb_url, sb_anon)
    # Admin (service role) client for limits/auth/session/user ops
    app.config["SUPABASE_ADMIN"] = create_client(sb_url, sb_srv)

    # Expose to templates for front-end Supabase (signup/login)
    app.config["SUPABASE_URL"] = sb_url
    app.config["SUPABASE_ANON_KEY"] = sb_anon

    # ---------- Other integrations ----------
    app.config["OPENAI_CLIENT"] = init_openai()
    app.config["STRIPE_SECRET_KEY"] = os.getenv("STRIPE_SECRET_KEY")

    # ---------- Flask-Login ----------
    login_manager.init_app(app)
    login_manager.login_view = "account"

    # JSON 401 for API-style paths; HTML redirect elsewhere
    @login_manager.unauthorized_handler
    def _unauth():
        apiish = request.path.startswith(("/api/", "/ask", "/build-", "/resume-"))
        if apiish:
            return jsonify(error="login_required", message="Please sign in to continue."), 401
        return redirect(url_for("account", next=request.url))

    # Optional: minimal user loader; keep if you don’t already define one elsewhere
    class User(UserMixin):
        def __init__(self, auth_id, email=None, fullname=None, role="user", plan="free", plan_status=None):
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
    def load_user(user_id: str):
        supabase = app.config.get("SUPABASE_ADMIN") or app.config.get("SUPABASE")
        if not user_id or not supabase:
            return None
        try:
            resp = (
                supabase.table("users")
                .select("auth_id,email,fullname,role,plan,plan_status")
                .eq("auth_id", user_id)
                .limit(1)
                .execute()
            )
            rows = getattr(resp, "data", None) or []
            if not rows:
                return None
            row = rows[0]
            return User(
                auth_id=row.get("auth_id"),
                email=row.get("email"),
                fullname=row.get("fullname"),
                role=row.get("role") or "user",
                plan=row.get("plan") or "free",
                plan_status=row.get("plan_status"),
            )
        except Exception:
            logging.exception("load_user failed")
            return None

    # Inject public Supabase config into all templates (for front-end JS)
    @app.context_processor
    def inject_supabase_public():
        return {
            "SUPABASE_URL": app.config.get("SUPABASE_URL", ""),
            "SUPABASE_ANON_KEY": app.config.get("SUPABASE_ANON_KEY", ""),
        }

    # ---------- Blueprints ----------
    register_routes(app)

    # Health check
    @app.get("/healthz")
    def health():
        return {"ok": True, "ts": datetime.utcnow().isoformat()}

    return app
