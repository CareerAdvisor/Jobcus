# abuse_guard.py
import os, uuid
from flask import request, g

ENABLE_IP_ABUSE_GUARD = os.getenv("ENABLE_IP_ABUSE_GUARD", "false").lower() == "true"

def _device_id():
    # Prefer a sticky cookie you already set; otherwise fall back to per-session UUID.
    return (
        request.cookies.get("jobcus_device")
        or request.headers.get("X-Jobcus-Device")
        or g.get("session_id")
        or str(uuid.uuid4())
    )

def allow_free_use(user_id: str, plan: str) -> tuple[bool, dict]:
    """
    Returns (allowed, payload). If disabled or user not on free plan, always True.
    This replaces router-IP based blocks with a device/user-scoped guard.
    """
    if (plan or "free").lower() != "free" or not ENABLE_IP_ABUSE_GUARD:
        return True, {}

    # Example hook: scope to (user_id, device_id). Implement counter in Redis/DB if needed.
    device = _device_id()
    _key = f"free_guard:{user_id}:{device}"

    # For now, always allow (no throttle). Add your own small rolling limit here if you want.
    return True, {}
