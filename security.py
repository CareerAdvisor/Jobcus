# security.py
import os, requests, logging
from flask import Request

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
        logger.warning("TURNSTILE_SECRET not configured. Skipping Turnstile check (dev mode).")
        return True, {"skipped": "TURNSTILE_SECRET not configured (dev mode)"}

    token = (
        (req.form or {}).get("cf-turnstile-response")
        or ((req.get_json(silent=True) or {}).get("cf_turnstile_response"))
        or req.headers.get("X-Turnstile-Token")
    )

    if not token:
        logger.error("Turnstile token missing in request")
        return False, {"error": "missing token"}

    data = {
        "secret": TURNSTILE_SECRET,
        "response": token,
        "remoteip": _client_ip(req),
    }

    try:
        logger.info("Verifying Turnstile token for IP %s", data["remoteip"])
        r = requests.post(TURNSTILE_VERIFY_URL, data=data, timeout=6)
        j = r.json()
        if j.get("success"):
            logger.info("Turnstile verification successful")
        else:
            logger.warning("Turnstile verification failed: %s", j)
        return bool(j.get("success")), j
    except Exception as e:
        logger.exception("Error while verifying Turnstile")
        return False, {"error": str(e)}
