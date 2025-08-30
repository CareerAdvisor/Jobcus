from datetime import datetime, date
from flask import current_app
from flask_login import current_user
from auth_utils import require_superadmin, is_staff, is_superadmin

# Plan limits you defined
PLAN_LIMITS = {
    "free": {
        "period_kind": "month",
        "resume_analyses": 3,
        "cover_letters": 2,
        "chat_messages": 15,
    },
    "weekly": {
        "period_kind": "week",
        "resume_analyses": 10,
        "cover_letters": 5,
        "chat_messages": 200,
    },
    "standard": {
        "period_kind": "month",
        "resume_analyses": 50,
        "cover_letters": 20,
        "chat_messages": 800,
    },
    "premium": {
        "period_kind": "month",
        "resume_analyses": None,   # None => unlimited
        "cover_letters": None,
        "chat_messages": None,
    },
}

def _period_key(period_kind: str) -> str:
    """Return the current billing period key, e.g. 2025-08 or 2025-W35."""
    now = datetime.utcnow()
    if period_kind == "week":
        year, week, _ = now.isocalendar()
        return f"{year}-W{week:02d}"
    return now.strftime("%Y-%m")

def current_plan_limits() -> dict:
    """Pick limits by the logged-in user’s plan."""
    plan = (getattr(current_user, "plan", None) or "free").lower()
    return PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])

def check_and_increment(user_id: str, feature_key: str, plan_limits: dict):
    """
    Returns (allowed: bool, info: dict). Increments the counter if allowed.
    feature_key ∈ {'resume_analyses','cover_letters','chat_messages'}.
    Admin/superadmin bypasses limits.
    """
    # Admin bypass
    if getattr(current_user, "role", "user") in ("admin", "superadmin"):
        return True, {"bypass": True, "reason": "staff"}

    limit = plan_limits.get(feature_key, None)          # None => unlimited
    period_kind = plan_limits.get("period_kind", "month")
    period_key = _period_key(period_kind)

    if limit is None:
        return True, {"unlimited": True, "period_kind": period_kind, "period_key": period_key}

    supabase = current_app.config["SUPABASE"]

    # read or create a row for this user + period
    resp = (
        supabase.table("usage_counters").select("*")
        .eq("user_id", user_id)
        .eq("period_kind", period_kind)
        .eq("period_key", period_key)
        .maybe_single()
        .execute()
    )
    row = getattr(resp, "data", None)

    if not row:
        row = {
            "user_id": user_id,
            "period_kind": period_kind,
            "period_key": period_key,
            "resume_analyses": 0,
            "cover_letters": 0,
            "chat_messages": 0,
        }
        supabase.table("usage_counters").insert(row).execute()

    current_count = int(row.get(feature_key, 0) or 0)
    if current_count >= limit:
        return False, {
            "reason": "limit_reached",
            "feature": feature_key,
            "limit": limit,
            "used": current_count,
            "period_kind": period_kind,
            "period_key": period_key,
        }

    supabase.table("usage_counters").update({feature_key: current_count + 1}) \
        .eq("user_id", user_id) \
        .eq("period_kind", period_kind) \
        .eq("period_key", period_key) \
        .execute()

    return True, {
        "feature": feature_key,
        "used": current_count + 1,
        "limit": limit,
        "period_kind": period_kind,
        "period_key": period_key,
    }

FREE_MONTHLY_MSGS = 20  # example; adjust per plan

def month_key(dt=None):
    d = dt or date.today()
    return d.strftime("%Y-%m")

def get_usage_count(user_id: str, period_key: str) -> int:
    r = supabase.table("usage_counters") \
        .select("count") \
        .eq("user_id", user_id) \
        .eq("period_kind", "month") \
        .eq("period_key", period_key) \
        .limit(1).execute()
    return (r.data[0]["count"] if r.data else 0)

def plan_limit(user) -> int | None:
    # None/0 means unlimited; adjust to your plans
    if user.plan in ("pro", "team") and user.plan_status == "active":
        return None  # unlimited
    return FREE_MONTHLY_MSGS

@app.post("/ask")
def ask():
    user = current_user  # or however you load user
    limit = plan_limit(user)
    period = month_key()
    used = get_usage_count(user.id, period)

    if limit is not None and used >= limit:
        return jsonify({
            "error": "quota_exceeded",
            "message": "You’ve reached your monthly chat limit. Upgrade to continue."
        }), 402  # or 429/403

    # ... proceed to call OpenAI ...

    # after success, increment usage
    supabase.table("usage_counters").upsert({
        "user_id": user.id,
        "period_kind": "month",
        "period_key": period,
        "count": used + 1
    }, on_conflict="user_id,period_kind,period_key").execute()

    return jsonify(response)

