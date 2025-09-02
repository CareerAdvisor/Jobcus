# jobcus/services/limits.py
from __future__ import annotations
from dataclasses import dataclass
from datetime import date
from typing import Optional
from flask_login import current_user
from postgrest.exceptions import APIError  # for resilient SELECT/UPSERT handling

# ---------- Plan config ----------

@dataclass(frozen=True)
class Quota:
    period_kind: str  # 'total' | 'week' | 'month' | 'year'
    limit: Optional[int]  # None = unlimited

# Backward-compatible feature aliases: old -> new
_FEATURE_ALIASES = {
    "resume_analyses":   "resume_analyzer",
    "cover_letters":     "cover_letter",
    "ai_resume_builder": "resume_builder",
    "resume":            "resume_builder",
    "interviews":        "interview_coach",
    "interview":         "interview_coach",
    "employer":          "employer_tools",
    "employers":         "employer_tools",
    "job_post":          "employer_tools",
}

# If older schemas used a different column for usage totals, try these:
_LEGACY_USED_COLUMNS = ("count", "usage", "value")

def _normalize_feature(feature: str) -> str:
    if not feature:
        return feature
    f = feature.strip().lower()
    return _FEATURE_ALIASES.get(f, f)

def _plan_code(plan: str | None) -> str:
    return (plan or "free").lower()

PLAN_QUOTAS = {
    "free": {
        "chat_messages":    Quota("total", 15),
        "resume_analyzer":  Quota("month", 3),
        "resume_builder":   Quota("month", 1),
        "cover_letter":     Quota("month", 2),
        "skill_gap":        Quota("month", 1),
        "interview_coach":  Quota("month", 1),
        "employer_tools":   Quota("month", 1),
    },
    "weekly": {
        "chat_messages":    Quota("week", 200),
        "resume_analyzer":  Quota("week", 10),
        "resume_builder":   Quota("week", None),
        "cover_letter":     Quota("week", 5),
        "skill_gap":        Quota("week", None),
        "interview_coach":  Quota("week", None),
        "employer_tools":   Quota("week", 5),
    },
    "standard": {
        "chat_messages":    Quota("month", 800),
        "resume_analyzer":  Quota("month", 50),
        "resume_builder":   Quota("month", None),
        "cover_letter":     Quota("month", 20),
        "skill_gap":        Quota("month", None),
        "interview_coach":  Quota("month", None),
        "employer_tools":   Quota("month", 20),
    },
    "premium": {
        "chat_messages":    Quota("year", 12000),
        "resume_analyzer":  Quota("month", None),
        "resume_builder":   Quota("month", None),
        "cover_letter":     Quota("month", None),
        "skill_gap":        Quota("month", None),
        "interview_coach":  Quota("month", None),
        "employer_tools":   Quota("month", None),
    },
}

# Feature flags (non-metered toggles you already use in templates/UX)
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

# ---------- Period helpers ----------
def period_key(kind: str, d: date | None = None) -> str:
    d = d or date.today()
    k = kind.lower()
    if k == "total":
        return "all"
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

# ---------- Counters (resilient to schema drift) ----------
def _as_int(val) -> int:
  try:
      return int(val)
  except Exception:
      return 0

def get_usage_count(supabase_admin, user_id, feature, kind, key):
    """
    Read the counter from usage_counters with robust filtering.
    Tries 'used' first, then falls back to legacy columns if needed.
    """
    base = (
        supabase_admin.table("usage_counters")
        .select("used")
        .filter("user_id", "eq", user_id)
        .filter("feature", "eq", feature)
        .filter("period_kind", "eq", kind)
        .filter("period_key", "eq", key)
        .limit(1)
    )
    try:
        res = base.execute()
        if res.data:
            return int(res.data[0].get("used", 0))
    except APIError as e:
        # If select fails due to unknown column we'll try legacy below
        if getattr(e, "code", None) != "42703":
            raise

    # Try legacy columns
    for legacy in _LEGACY_USED_COLUMNS:
        try:
            res = (
                supabase_admin.table("usage_counters")
                .select(legacy)
                .filter("user_id", "eq", user_id)
                .filter("feature", "eq", feature)
                .filter("period_kind", "eq", kind)
                .filter("period_key", "eq", key)
                .limit(1)
                .execute()
            )
            if res.data:
                return int(res.data[0].get(legacy, 0) or 0)
        except APIError:
            continue

    return 0


def bump_usage(supabase_admin, user_id: str, feature: str, kind: str, key: str) -> None:
    """
    Read current counter via get_usage_count() and upsert +1.
    If 'used' column is absent, fall back to legacy names.
    """
    new_value = get_usage_count(supabase_admin, user_id, feature, kind, key) + 1
    payload = {
        "user_id": user_id,
        "feature": feature,
        "period_kind": kind,
        "period_key": key,
        "used": new_value,  # default path
    }
    try:
        supabase_admin.table("usage_counters").upsert(
            payload,
            on_conflict="user_id,feature,period_kind,period_key"
        ).execute()
        return
    except APIError as e:
        if getattr(e, "code", None) == "42703":
            # Try legacy column names
            for legacy in _LEGACY_USED_COLUMNS:
                try:
                    legacy_payload = dict(payload)
                    legacy_payload[legacy] = legacy_payload.pop("used")
                    supabase_admin.table("usage_counters").upsert(
                        legacy_payload,
                        on_conflict="user_id,feature,period_kind,period_key"
                    ).execute()
                    return
                except APIError:
                    continue
        # Re-raise on anything else or if all legacy attempts failed
        raise

# Back-compat: keep increment_usage around (now delegates to bump_usage)
def increment_usage(
    supabase_admin, user_id: str, feature: str, kind: str, key: str, new_count: int
) -> None:
    # Ignore supplied new_count; we always compute via get_usage_count to avoid races.
    bump_usage(supabase_admin, user_id, feature, kind, key)

# ---------- Public API ----------
def quota_for(plan: str, feature: str) -> Quota:
    p = _plan_code(plan)
    f = _normalize_feature(feature)
    return PLAN_QUOTAS.get(p, PLAN_QUOTAS["free"]).get(f, Quota("month", None))

def check_and_increment(supabase_admin, user_id: str, plan: str, feature: str):
    # Bypass for admin/superadmin
    role = (getattr(current_user, "role", "") or "").lower()
    if role in ("admin", "superadmin"):
        return True, {"bypass": "admin"}

    f = _normalize_feature(feature)
    q = quota_for(plan, f)
    kind = q.period_kind
    key = period_key(kind)

    # Unlimited
    if q.limit is None:
        return True, {"limit": None, "feature": f, "period_kind": kind, "period_key": key}

    used = get_usage_count(supabase_admin, user_id, f, kind, key)
    if used >= q.limit:
        return False, {
            "error": "quota_exceeded",
            "feature": f,
            "limit": q.limit,
            "period_kind": kind,
            "period_key": key,
            "message": "You have reached the limit for the free version, upgrade to enjoy more features",
        }

    # Resilient increment (handles legacy columns)
    bump_usage(supabase_admin, user_id, f, kind, key)

    return True, {
        "used": used + 1,
        "limit": q.limit,
        "period_kind": kind,
        "period_key": key,
        "feature": f,
    }

def feature_enabled(plan: str, flag: str):
    plan_flags = FEATURE_FLAGS.get(_plan_code(plan), FEATURE_FLAGS["free"])
    return plan_flags.get(flag, False)

def job_insights_level(plan: str) -> str:
    return str(FEATURE_FLAGS.get(_plan_code(plan), FEATURE_FLAGS["free"]).get("job_insights", "basic"))
