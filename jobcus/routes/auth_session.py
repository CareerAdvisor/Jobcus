from __future__ import annotations
from flask import Blueprint, request, jsonify, current_app
from flask_login import login_user, logout_user, UserMixin
from jobcus.services.users import get_or_bootstrap_user

auth_session_bp = Blueprint("auth_session", __name__)

class LocalUser(UserMixin):
    def __init__(self, row: dict):
        self.id = row.get("auth_id")
        self.email = row.get("email")
        self.plan = (row.get("plan") or "free").lower()
        self.role = (row.get("role") or "user").lower()

@auth_session_bp.post("/api/session/login")
def api_session_login():
    supabase = current_app.config["SUPABASE_ADMIN"]
    data = request.get_json(silent=True) or {}
    token = (data.get("access_token") or "").strip()
    if not token:
        return jsonify(error="bad_request", message="Missing access_token"), 400

    try:
        # Validate token & get user from Supabase
        res = supabase.auth.get_user(token)
        user = getattr(res, "user", None) or {}
        auth_id = getattr(user, "id", None) or user.get("id")
        email = getattr(user, "email", None) or user.get("email")
        if not auth_id:
            return jsonify(error="unauthorized", message="Invalid token"), 401

        row = get_or_bootstrap_user(supabase, auth_id, email)
        login_user(LocalUser(row))
        return jsonify(ok=True, plan=row.get("plan","free"), auth_id=auth_id)
    except Exception:
        current_app.logger.exception("session login failed")
        return jsonify(error="server_error", message="Could not create session"), 500

@auth_session_bp.post("/api/session/logout")
def api_session_logout():
    try:
        logout_user()
    except Exception:
        pass
    return jsonify(ok=True)
