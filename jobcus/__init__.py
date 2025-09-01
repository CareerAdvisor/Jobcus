# jobcus/__init__.py
from __future__ import annotations
import os, logging
from datetime import datetime
from flask import Flask, current_app
from flask_cors import CORS
from flask_login import LoginManager, UserMixin
from supabase import create_client

# local extensions/helpers (adapt imports to your files)
from .extensions import init_supabase, init_openai, login_manager  # your existing file
from .routes import register_routes

def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    app.secret_key = os.getenv("SECRET_KEY", "supersecret")
    app.config.update(SESSION_COOKIE_SECURE=True, SESSION_COOKIE_SAMESITE="Lax")

    # secure cookies
    app.config.update(
        SESSION_COOKIE_SECURE=True,
        SESSION_COOKIE_SAMESITE="Lax",
    )

    # CORS & logging
    CORS(app)
    logging.basicConfig(level=logging.INFO)

    # Extensions / clients
    app.config["SUPABASE"] = init_supabase()
    app.config["OPENAI_CLIENT"] = init_openai()
    app.config["SUPABASE_ADMIN"] = app.config["SUPABASE"]  # or your service-role client if you use one

    # Admin (service-role) client
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_service_key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    app.config["SUPABASE_ADMIN"] = create_client(supabase_url, supabase_service_key)

    # Stripe key is read by your routes when needed
    app.config["STRIPE_SECRET_KEY"] = os.getenv("STRIPE_SECRET_KEY")

    # ---------- Flask-Login ----------
    login_manager.init_app(app)
    login_manager.login_view = "account"

    class User(UserMixin):
        def __init__(self, auth_id, email, fullname=None, role="user", plan="free", plan_status=None):
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
        """Restore a user from Supabase."""
        supabase = current_app.config.get("SUPABASE")
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
            data = getattr(resp, "data", None)
            if not data: return None
            row = data[0]
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

    # ---------- Blueprints ----------
    register_routes(app)

    # Optional: simple health endpoint
    @app.get("/healthz")
    def health():
        return {"ok": True, "ts": datetime.utcnow().isoformat()}

    return app

