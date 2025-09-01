# jobcus/routes/state.py
from datetime import datetime
from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
try:
    from jobcus.services.limits import feature_enabled, period_key, quota_for, get_usage_count
except ImportError:
    from limits import feature_enabled, period_key, quota_for, get_usage_count

state_bp = Blueprint("state", __name__)

@state_bp.route("/api/state", methods=["GET","POST"])
@login_required
def api_state():
    supabase_admin = current_app.config["SUPABASE_ADMIN"]
    supabase = current_app.config["SUPABASE"]

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
            r = supabase_admin.table("user_state").select("data").eq("auth_id", auth_id).limit(1).execute()
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
    return ("", 204)
