from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, date
from typing import Optional
from auth_utils import require_superadmin, is_staff, is_superadmin

# ---------- Plan config ----------

@dataclass(frozen=True)
class Quota:
    period_kind: str  # 'total' | 'week' | 'month' | 'year'
    limit: Optional[int]  # None = unlimited

PLAN_QUOTAS = {
    "free": {
        "chat_messages":   Quota("total", 15),
        "resume_analyses": Quota("month", 3),
        "cover_letters":   Quota("month", 2),
        "skill_gap":       Quota("month", 1),
    },
    "weekly": {
        "chat_messages":   Quota("week", 200),
        "resume_analyses": Quota("week", 10),
        "cover_letters":   Quota("week", 5),
        "skill_gap":       Quota("week", None),
    },
    "standard": {
        "chat_messages":   Quota("month", 800),
        "resume_analyses": Quota("month", 50),
        "cover_letters":   Quota("month", 20),
        "skill_gap":       Quota("month", None),
    },
    "premium": {
        "chat_messages":   Quota("year", 12000),
        "resume_analyses": Quota("month", None),
        "cover_letters":   Quota("month", None),
        "skill_gap":       Quota("month", None),
    },
}

# Feature gates (booleans / levels)
FEATURE_FLAGS = {
    "free":    {"rebuild_with_ai": False, "optimize_ai": False, "downloads": False, "cloud_history": False, "job_insights": "basic"},
    "weekly":  {"rebuild_with_ai": True,  "optimize_ai": False, "downloads": False, "cloud_history": False, "job_insights": "full"},
    "standard":{"rebuild_with_ai": True,  "optimize_ai": True,  "downloads": True,  "cloud_history": True,  "job_insights": "full"},
    "premium": {"rebuild_with_ai": True,  "optimize_ai": True,  "downloads": True,  "cloud_history": True,  "job_insights": "full"},
}

def _plan_code(plan: str | None) -> str:
    return (plan or "free").lower()

# ---------- Period helpers ----------

def period_key(kind: str, d: date | None = None) -> str:
    d = d or date.today()
    if kind == "total":
        return "all"
    if kind == "week":
        iso = d.isocalendar()
        return f"{iso.year}-W{iso.week:02d}"
    if kind == "month":
        return d.strftime("%Y-%m")
    if kind == "year":
        return d.strftime("%Y")
    return "all"

# ---------- Counters ----------

def get_usage_count(supabase_admin, user_id: str, feature: str, kind: str, key: str) -> int:
    r = (supabase_admin.table("usage_counters")
         .select("count")
         .eq("user_id", user_id)
         .eq("feature", feature)
         .eq("period_kind", kind)
         .eq("period_key", key)
         .limit(1)
         .execute())
    return (r.data[0]["count"] if r.data else 0)

def increment_usage(supabase_admin, user_id: str, feature: str, kind: str, key: str, new_count: int) -> None:
    (supabase_admin.table("usage_counters")
     .upsert({
        "user_id": user_id,
        "feature": feature,
        "period_kind": kind,
        "period_key": key,
        "count": new_count,
     }, on_conflict="user_id,feature,period_kind,period_key")
     .execute())

# ---------- Public API ----------

def quota_for(plan: str, feature: str) -> Quota:
    p = _plan_code(plan)
    return PLAN_QUOTAS.get(p, PLAN_QUOTAS["free"]).get(feature, Quota("month", None))

def check_and_increment(supabase_admin, user_id: str, plan: str, feature: str) -> tuple[bool, dict]:
    """
    Returns (allowed: bool, payload: dict). If allowed=True, it already increments.
    """
    q = quota_for(plan, feature)
    kind = q.period_kind
    key  = period_key(kind)

    if q.limit is None:
        return True, {"limit": None}

    used = get_usage_count(supabase_admin, user_id, feature, kind, key)
    if used >= q.limit:
        return False, {
            "error": "quota_exceeded",
            "feature": feature,
            "limit": q.limit,
            "period_kind": kind,
            "period_key": key,
            "message": "You’ve reached your plan limit for this feature."
        }

    increment_usage(supabase_admin, user_id, feature, kind, key, used + 1)
    return True, {"used": used + 1, "limit": q.limit, "period_kind": kind, "period_key": key}

def feature_enabled(plan: str, flag: str):
    return FEATURE_FLAGS.get(_plan_code(plan), FEATURE_FLAGS["free"]).get(flag)

def job_insights_level(plan: str) -> str:
    return str(FEATURE_FLAGS.get(_plan_code(plan), FEATURE_FLAGS["free"]).get("job_insights", "basic"))

