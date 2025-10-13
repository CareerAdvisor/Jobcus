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
        # your existing keys
        "chat_messages":   Quota("total", 10),
        "resume_analyzer": Quota("month", 2),
        "cover_letter":    Quota("month", 1),
        "skill_gap":       Quota("month", 1),
        "interview_coach": Quota("month", 1),
        "resume_builder":  Quota("month", 1),

        # ⬇️ NEW: hourly/daily call caps for chat
        "chat_messages_hour": Quota("hour", 6),
        "chat_messages_day":  Quota("day", 40),

        # ⬇️ NEW: word budgets (use token budgets if you prefer)
        "chat_words_hour":    Quota("hour", 1500),
        "chat_words_day":     Quota("day", 8000),

        # ⬇️ (Optional) add hourly/daily for analyzer if you’ll enforce them
        "resume_analyzer_hour": Quota("hour", 2),
        "resume_analyzer_day":  Quota("day", 4),
    },

    "weekly": {
        "chat_messages":   Quota("week", 100),
        "resume_analyzer": Quota("week", 10),
        "cover_letter":    Quota("week", 5),
        "skill_gap":       Quota("week", None),
        "interview_coach": Quota("week", None),
        "resume_builder":  Quota("week", 5),

        # (Optional) add hour/day for chat if you want them on weekly plan too
        "chat_messages_hour": Quota("hour", 12),
        "chat_messages_day":  Quota("day", 80),
        "chat_words_hour":    Quota("hour", 3000),
        "chat_words_day":     Quota("day", 15000),
    },

    "standard": {
        "chat_messages":   Quota("month", 600),
        "resume_analyzer": Quota("month", 50),
        "cover_letter":    Quota("month", 20),
        "skill_gap":       Quota("month", None),
        "interview_coach": Quota("month", None),
        "resume_builder":  Quota("month", 20),

        "chat_messages_hour": Quota("hour", 30),
        "chat_messages_day":  Quota("day", 200),
        "chat_words_hour":    Quota("hour", 6000),
        "chat_words_day":     Quota("day", 30000),

        "resume_analyzer_hour": Quota("hour", 6),
        "resume_analyzer_day":  Quota("day", 20),
    },

    "premium": {
        "chat_messages":   Quota("year", 10800),
        "resume_analyzer": Quota("month", None),
        "cover_letter":    Quota("month", None),
        "skill_gap":       Quota("month", None),
        "interview_coach": Quota("month", None),
        "resume_builder":  Quota("month", None),

        "chat_messages_hour": Quota("hour", 60),
        "chat_messages_day":  Quota("day", 500),
        "chat_words_hour":    Quota("hour", 12000),
        "chat_words_day":     Quota("day", 60000),

        "resume_analyzer_hour": Quota("hour", None),
        "resume_analyzer_day":  Quota("day", None),
    },

    "employer_jd": {
        "chat_messages":       Quota("month", 50),   # small monthly quota
        "chat_messages_hour":  Quota("hour", 10),    # optional soft caps
        "chat_messages_day":   Quota("day", 30),
    
        # If you ever measure words/tokens, keep them conservative here
        "chat_words_hour":     Quota("hour", 3000),
        "chat_words_day":      Quota("day", 12000),
    
        # Employer plan is for JD features; other job-seeker tools usually not included
        "resume_analyzer":     Quota("month", 0),    # or remove if you don't count 0
        "cover_letter":        Quota("month", 0),
        "skill_gap":           Quota("month", 0),
        "interview_coach":     Quota("month", 0),
        "resume_builder":      Quota("month", 0),
    },
}

# Feature gates (booleans / levels)
FEATURE_FLAGS = {
    "free": {
        "has_chat":       True,
        "cloud_history":  False,
        "rebuild_with_ai": False,
        "optimize_ai":     False,
        "downloads":       False,
        "job_insights":    "basic",
    },
    "weekly": {
        "has_chat":       True,
        "cloud_history":  True,   # was False before; now aligned with paid chat tiers
        "rebuild_with_ai": True,
        "optimize_ai":     False,
        "downloads":       False,
        "job_insights":    "full",
    },
    "standard": {
        "has_chat":       True,
        "cloud_history":  True,
        "rebuild_with_ai": True,
        "optimize_ai":     True,
        "downloads":       True,
        "job_insights":    "full",
    },
    "premium": {
        "has_chat":       True,
        "cloud_history":  True,
        "rebuild_with_ai": True,
        "optimize_ai":     True,
        "downloads":       True,
        "job_insights":    "full",
    },
    "employer_jd": {
        "has_chat":       True,    # limited chat enabled
        "cloud_history":  False,   # keep history off
        "rebuild_with_ai": False,
        "optimize_ai":     False,
        "downloads":       True,
        "job_insights":    "basic",
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

def has_chat(plan: str) -> bool:
    return bool(FEATURE_FLAGS.get((plan or "free").lower(), {}).get("cloud_history", False) or True)
    # ↑ or add an explicit FEATURE_FLAGS[plan]["has_chat"] if you prefer

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


def check_and_add(
    supabase_admin, user_id: str, plan: str, feature: str,
    amount: int, period_kind_override: str | None = None, limit_override: int | None = None
) -> tuple[bool, dict]:
    """
    Like check_and_increment, but adds an arbitrary 'amount' to the counter.
    Optional: override the quota's period kind or limit for ad-hoc features.
    """
    f = _normalize_feature(feature)
    q = quota_for(plan, f)
    kind = (period_kind_override or q.period_kind)
    limit = q.limit if limit_override is None else limit_override
    key = period_key(kind)

    if limit is None:
        # Unlimited for this feature
        return True, {"limit": None, "period_kind": kind, "period_key": key, "feature": f}

    used = get_usage_count(supabase_admin, user_id, f, kind, key)
    if used + amount > limit:
        return False, {
            "error": "quota_exceeded",
            "feature": f,
            "limit": limit,
            "period_kind": kind,
            "period_key": key,
            "used": used,
            "attempted_add": amount,
            "message": "You’ve reached your plan limit for this feature.",
        }

    increment_usage(supabase_admin, user_id, f, kind, key, used + amount)
    return True, {
        "used": used + amount,
        "limit": limit,
        "period_kind": kind,
        "period_key": key,
        "feature": f,
        "added": amount,
    }

def feature_enabled(plan: str, flag: str, default=False):
    """
    Return a feature flag value for a plan.
    For booleans, returns bool. For string-valued flags (like 'job_insights'),
    returns the string. If the flag is missing, returns `default`.
    """
    plan_flags = FEATURE_FLAGS.get(_plan_code(plan), FEATURE_FLAGS["free"])
    return plan_flags.get(flag, default)

def job_insights_level(plan: str) -> str:
    """
    Convenience accessor for the job insights level.
    """
    return str(
        FEATURE_FLAGS.get(_plan_code(plan), FEATURE_FLAGS["free"]).get(
            "job_insights", "basic"
        )
    )
