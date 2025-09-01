from datetime import datetime
from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from ..services.limits import feature_enabled, quota_for, period_key, get_usage_count

state_bp = Blueprint("state", __name__)

@state_bp.route("/api/state", methods=["GET","POST"])
@login_required
def api_state():
    supabase_admin = current_app.config["SUPABASE_ADMIN"]
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    auth_id = getattr(current_user, "id", None)
    if not auth_id:
        return jsonify({"error":"no auth id"}), 400

    if not feature_enabled(plan, "cloud_history"):
        return (jsonify({"data": {}}), 200) if request.method == "GET" else ("", 204)

    if request.method == "GET":
        try:
            r = supabase_admin.table("user_state").select("data").eq("auth_id", auth_id).limit(1).execute()
            row = r.data[0] if r.data else None
            return jsonify({"data": (row["data"] if row else {})}), 200
        except Exception:
            return jsonify({"data": {}}), 200

    payload = request.get_json(silent=True) or {}
    data = payload.get("data", {})
    try:
        supabase_admin.table("user_state").upsert(
            {"auth_id": auth_id, "data": data, "updated_at": datetime.utcnow().isoformat()},
            on_conflict="auth_id"
        ).execute()
    except Exception:
        pass
    return ("", 204)

@state_bp.get("/api/credits")
@login_required
def api_credits():
    supabase_admin = current_app.config["SUPABASE_ADMIN"]
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    q = quota_for(plan, "chat_messages")
    if q.limit is None:
        return jsonify(plan=plan, used=None, max=None, left=None)
    key  = period_key(q.period_kind)
    used = get_usage_count(supabase_admin, current_user.id, "chat_messages", q.period_kind, key)
    left = max(q.limit - used, 0)
    return jsonify(plan=plan, used=used, max=q.limit, left=left, period_kind=q.period_kind, period_key=key)

@state_bp.get("/api/limits")
@login_required
def api_limits():
    supabase_admin = current_app.config["SUPABASE_ADMIN"]
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    features = ["chat_messages","resume_builder","resume_analyzer","interview_coach","cover_letter","skill_gap"]
    data = {"plan": plan, "features": {}}
    for f in features:
        q = quota_for(plan, f)
        if q.limit is None:
            data["features"][f] = {"used": None, "max": None, "left": None, "period_kind": q.period_kind}
            continue
        key  = period_key(q.period_kind)
        used = get_usage_count(supabase_admin, current_user.id, f, q.period_kind, key)
        left = max(q.limit - used, 0)
        data["features"][f] = {"used": used, "max": q.limit, "left": left, "period_kind": q.period_kind, "period_key": key}
    return jsonify(data)
