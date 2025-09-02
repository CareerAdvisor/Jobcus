# jobcus/routes/ask.py
from flask import Blueprint, request, jsonify, current_app
from flask_login import current_user
try:
    from jobcus.services.limits import check_and_increment
    from jobcus.security.abuse_guard import allow_free_use
    from jobcus.services.users import get_or_bootstrap_user
    from jobcus.services.ai import call_ai
except ImportError:
    from limits import check_and_increment  # fallback
    from abuse_guard import allow_free_use
    from services.users import get_or_bootstrap_user
    from services.ai import call_ai

ask_bp = Blueprint("ask", __name__)

# ---- add this helper (matches the one in resumes.py) ----
def _allow_free(req, user_id, plan):
    try:
        return allow_free_use(req, user_id=user_id, plan=plan)  # new signature
    except TypeError:
        try:
            return allow_free_use(user_id, plan)  # legacy signature
        except TypeError:
            return True, {}
# ---------------------------------------------------------

@ask_bp.post("/ask")
def ask():
    try:
        supabase_admin = current_app.config["SUPABASE_ADMIN"]

        payload = request.get_json(silent=True) or {}
        message = (payload.get("message") or "").strip()
        model   = (payload.get("model") or "gpt-4o-mini").strip()

        if not message:
            return jsonify(error="bad_request", message="Message is required."), 400

        # Identify user (guest allowed)
        auth_id = current_user.id if getattr(current_user, "is_authenticated", False) else None
        email   = current_user.email if getattr(current_user, "is_authenticated", False) else None

        user_row = get_or_bootstrap_user(supabase_admin, auth_id, email) if auth_id else {"plan": "free"}
        plan = (user_row.get("plan") or "free").lower()

        # ---- use the shim here instead of calling allow_free_use directly ----
        ok, guard = _allow_free(request, user_id=auth_id, plan=plan)
        if not ok:
            return jsonify(
                error="too_many_free_accounts",
                message=(guard or {}).get("message") or "You have reached the limit for the free version, upgrade to enjoy more features"
            ), 429
        # ---------------------------------------------------------------------

        subject = auth_id or request.remote_addr
        allowed, info = check_and_increment(supabase_admin, subject, plan, "chat_messages")
        if not allowed:
            return jsonify(error="quota_exceeded", **(info or {})), 402

        try:
            reply = call_ai(model=model, prompt=message)
        except Exception:
            current_app.logger.exception("AI provider failed")
            return jsonify(error="ai_error", message="AI provider error. Please try again."), 502

        return jsonify(reply=reply, modelUsed=model)

    except Exception:
        current_app.logger.exception("Unhandled error in /ask")
        return jsonify(error="server_error", message="Something went wrong on our side. Please try again."), 500
