# security.py
import os, requests
from flask import Request

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
TURNSTILE_SECRET = os.environ.get("TURNSTILE_SECRET")  # None in dev = skip check


def _client_ip(req: Request) -> str | None:
    # Prefer Cloudflare header, then common proxy headers, then remote_addr
    return (
        req.headers.get("CF-Connecting-IP")
        or req.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or req.remote_addr
    )


def verify_turnstile(req: Request) -> tuple[bool, dict]:
    """
    Returns (ok, details). If TURNSTILE_SECRET is missing, returns (True, {"skipped": ...})
    Token is accepted from form, JSON, or a custom header.
    """
    if not TURNSTILE_SECRET:
        return True, {"skipped": "TURNSTILE_SECRET not configured (dev mode)"}

    token = (
        (req.form or {}).get("cf-turnstile-response")
        or ((req.get_json(silent=True) or {}).get("cf_turnstile_response"))
        or req.headers.get("X-Turnstile-Token")
    )

    if not token:
        return False, {"error": "missing token"}

    data = {
        "secret": TURNSTILE_SECRET,
        "response": token,
        "remoteip": _client_ip(req),
    }

    try:
        r = requests.post(TURNSTILE_VERIFY_URL, data=data, timeout=6)
        j = r.json()
        return bool(j.get("success")), j
    except Exception as e:
        return False, {"error": str(e)}
