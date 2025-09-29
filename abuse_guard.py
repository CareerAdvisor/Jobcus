# abuse_guard.py
import os, uuid, datetime
from flask import request, g, current_app

ENABLE_IP_ABUSE_GUARD = os.getenv("ENABLE_IP_ABUSE_GUARD", "true").lower() == "true"
FREE_DEVICE_DAILY_LIMIT = int(os.getenv("FREE_DEVICE_DAILY_LIMIT", "20"))  # tweak as needed

def _device_id():
    # Prefer sticky cookie set by your JS; fallback to server session id
    return (
        request.cookies.get("jobcus_device")
        or g.get("session_id")
        or str(uuid.uuid4())
    )

def allow_free_use(user_id: str, plan: str) -> tuple[bool, dict]:
    """
    Returns (allowed, payload). Enforces a per-(user, device) DAILY budget on free plan.
    """
    if (plan or "free").lower() != "free" or not ENABLE_IP_ABUSE_GUARD:
        return True, {}

    supabase = current_app.config.get("SUPABASE_ADMIN")
    if not supabase:
        return True, {"skipped": "no admin client"}

    device = _device_id()
    today  = datetime.date.today().isoformat()
    key    = f"{user_id}:{device}:{today}"

    # upsert counter
    try:
        # read
        r = (
            supabase.table("device_counters")
            .select("count")
            .eq("day_key", key)
            .limit(1)
            .execute()
        )
        used = 0
        data = getattr(r, "data", None)
        if isinstance(data, list) and data:
            used = int(data[0].get("count") or 0)

        if used >= FREE_DEVICE_DAILY_LIMIT:
            return False, {
                "error": "too_many_free_accounts",
                "message": "Free daily limit reached for this device. Please try again tomorrow or upgrade."
            }

        # increment
        supabase.table("device_counters").upsert(
            {"day_key": key, "count": used + 1},
            on_conflict="day_key"
        ).execute()

        return True, {"used": used + 1, "limit": FREE_DEVICE_DAILY_LIMIT}
    except Exception:
        # fail-open (don’t block legit users if DB hiccups)
        return True, {"skipped": "counter error"}
