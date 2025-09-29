from __future__ import annotations
from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

# ---------- Plan config ----------

@dataclass(frozen=True)
class Quota:
    period_kind: str  # 'total' | 'week' | 'month' | 'year'
    limit: Optional[int]  # None = unlimited


# Backward-compatible feature aliases: old -> new
_FEATURE_ALIASES = {
    "resume_analyses": "resume_analyzer",
    "cover_letters": "cover_letter",
    # Add any future migrations here.
}

def _normalize_feature(feature: str) -> str:
    """Map legacy feature keys to the canonical ones used by the app."""
    if not feature:
        return feature
    f = feature.strip().lower()
    return _FEATURE_ALIASES.get(f, f)


# limits.py  (PLAN_QUOTAS)  ← add these lines
PLAN_QUOTAS = {
    "free": {
        "chat_messages":   Quota("total", 10),
        "resume_analyzer": Quota("month", 2),
        "cover_letter":    Quota("month", 1),
        "skill_gap":       Quota("month", 1),
        "interview_coach": Quota("month", 1),   # NEW
        "resume_builder":  Quota("month", 1),   # NEW (if you want it metered)
    },
    "weekly": {
        "chat_messages":   Quota("week", 100),
        "resume_analyzer": Quota("week", 10),
        "cover_letter":    Quota("week", 5),
        "skill_gap":       Quota("week", None),
        "interview_coach": Quota("week", None),   # NEW (or set a number)
        "resume_builder":  Quota("week", 5),   # NEW (or set a number)
    },
    "standard": {
        "chat_messages":   Quota("month", 600),
        "resume_analyzer": Quota("month", 50),
        "cover_letter":    Quota("month", 20),
        "skill_gap":       Quota("month", None),
        "interview_coach": Quota("month", None),  # NEW
        "resume_builder":  Quota("month", 20),  # NEW
    },
    "premium": {
        "chat_messages":   Quota("year", 10800),
        "resume_analyzer": Quota("month", None),
        "cover_letter":    Quota("month", None),
        "skill_gap":       Quota("month", None),
        "interview_coach": Quota("month", None),  # NEW
        "resume_builder":  Quota("month", None),  # NEW
    },
}

# Feature gates (booleans / levels)
FEATURE_FLAGS = {
    "free": {
        "rebuild_with_ai": False,
        "optimize_ai":     False,
        "downloads":       False,
        "cloud_history":   False,
        "job_insights":    "basic",
    },
    "weekly": {
        "rebuild_with_ai": True,
        "optimize_ai":     False,
        "downloads":       False,
        "cloud_history":   False,
        "job_insights":    "full",
    },
    "standard": {
        "rebuild_with_ai": True,
        "optimize_ai":     True,
        "downloads":       True,
        "cloud_history":   True,
        "job_insights":    "full",
    },
    "premium": {
        "rebuild_with_ai": True,
        "optimize_ai":     True,
        "downloads":       True,
        "cloud_history":   True,
        "job_insights":    "full",
    },
}


def _plan_code(plan: str | None) -> str:
    return (plan or "free").lower()


# ---------- Period helpers ----------

def period_key(kind: str, d: date | None = None) -> str:
    """
    Return a stable key for counters depending on the period kind.
    Kind: 'total' | 'hour' | 'day' | 'week' | 'month' | 'year'
    """
    k = (kind or "total").lower()
    if k == "total":
        return "all"
    now = datetime.utcnow()
    if k == "hour":
        return now.strftime("%Y-%m-%dT%H")   # e.g., 2025-09-29T14 (UTC)
    if k == "day":
        return now.strftime("%Y-%m-%d")
    d = d or date.today()
    if k == "week":
        iso = d.isocalendar()
        year = getattr(iso, "year", iso[0])
        week = getattr(iso, "week", iso[1])
        return f"{year}-W{week:02d}"
    if k == "month":
        return d.strftime("%Y-%m")
    if k == "year":
        return d.strftime("%Y")
    return "all"


# ---------- Counters ----------

def get_usage_count(supabase_admin, user_id: str, feature: str, kind: str, key: str) -> int:
    """
    Read the current usage count for (user_id, feature, kind, key).
    Defensive against SDK returning list or dict.
    """
    r = (
        supabase_admin.table("usage_counters")
        .select("count")
        .eq("user_id", user_id)
        .eq("feature", feature)
        .eq("period_kind", kind)
        .eq("period_key", key)
        .limit(1)
        .execute()
    )
    data = getattr(r, "data", None)
    if isinstance(data, list) and data:
        return int(data[0].get("count") or 0)
    if isinstance(data, dict):
        return int(data.get("count") or 0)
    return 0


def increment_usage(
    supabase_admin, user_id: str, feature: str, kind: str, key: str, new_count: int
) -> None:
    (
        supabase_admin.table("usage_counters")
        .upsert(
            {
                "user_id": user_id,
                "feature": feature,
                "period_kind": kind,
                "period_key": key,
                "count": new_count,
            },
            on_conflict="user_id,feature,period_kind,period_key",
        )
        .execute()
    )


# ---------- Public API ----------

def quota_for(plan: str, feature: str) -> Quota:
    """
    Return the Quota for a given plan & feature. Defaults to a month/None quota if unknown.
    Accepts legacy keys via _FEATURE_ALIASES for backward compatibility.
    """
    p = _plan_code(plan)
    f = _normalize_feature(feature)
    return PLAN_QUOTAS.get(p, PLAN_QUOTAS["free"]).get(f, Quota("month", None))


def check_and_increment(
    supabase_admin, user_id: str, plan: str, feature: str
) -> tuple[bool, dict]:
    """
    Returns (allowed: bool, payload: dict).
    If allowed=True, this function has already incremented the counter atomically for the current period.
    """
    f = _normalize_feature(feature)
    q = quota_for(plan, f)
    kind = q.period_kind
    key = period_key(kind)

    # Unlimited
    if q.limit is None:
        return True, {"limit": None}

    used = get_usage_count(supabase_admin, user_id, f, kind, key)
    if used >= q.limit:
        return False, {
            "error": "quota_exceeded",
            "feature": f,
            "limit": q.limit,
            "period_kind": kind,
            "period_key": key,
            "message": "You’ve reached your plan limit for this feature.",
        }

    increment_usage(supabase_admin, user_id, f, kind, key, used + 1)
    return True, {
        "used": used + 1,
        "limit": q.limit,
        "period_kind": kind,
        "period_key": key,
        "feature": f,
    }


def feature_enabled(plan: str, flag: str):
    """
    Return a feature flag value for a plan.
    For boolean flags, returns bool. For string-valued flags (like 'job_insights'),
    returns the string (e.g., 'basic' or 'full'). Defaults to False if missing.
    """
    plan_flags = FEATURE_FLAGS.get(_plan_code(plan), FEATURE_FLAGS["free"])
    return plan_flags.get(flag, False)


def job_insights_level(plan: str) -> str:
    """
    Convenience accessor for the job insights level.
    """
    return str(
        FEATURE_FLAGS.get(_plan_code(plan), FEATURE_FLAGS["free"]).get(
            "job_insights", "basic"
        )
    )
