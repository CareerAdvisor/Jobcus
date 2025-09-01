# jobcus/security/turnstile.py
from __future__ import annotations

import os
import logging
import requests
from flask import Request

logger = logging.getLogger(__name__)

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
TURNSTILE_SECRET = os.environ.get("TURNSTILE_SECRET")  # None in dev = skip check


def _client_ip(req: Request) -> str | None:
    """
    Prefer Cloudflare header, then first X-Forwarded-For hop, then remote_addr.
    Works both behind CF and on plain proxies.
    """
    xff = (req.headers.get("X-Forwarded-For") or "").split(",")[0].strip() or None
    return req.headers.get("CF-Connecting-IP") or xff or req.remote_addr


def verify_turnstile(req: Request) -> tuple[bool, dict]:
    """
    Validate a Cloudflare Turnstile token from:
      - form field: 'cf-turnstile-response'
      - JSON key:   'cf_turnstile_response'
      - header:     'X-Turnstile-Token'

    Returns (ok, details_dict).

    If TURNSTILE_SECRET is not configured (e.g., dev), returns (True, {"skipped": "..."}).
    """
    if not TURNSTILE_SECRET:
        logger.warning("TURNSTILE_SECRET not configured. Skipping Turnstile check (dev mode).")
        return True, {"skipped": "TURNSTILE_SECRET not configured (dev mode)"}

    token = (
        (getattr(req, "form", None) or {}).get("cf-turnstile-response")
        or ((req.get_json(silent=True) or {}).get("cf_turnstile_response"))
        or req.headers.get("X-Turnstile-Token")
    )

    if not token:
        logger.info("Turnstile token missing in request")
        return False, {"error": "captcha_missing", "message": "Captcha token missing."}

    payload = {
        "secret": TURNSTILE_SECRET,
        "response": token,
        "remoteip": _client_ip(req),
    }

    try:
        logger.info("Verifying Turnstile token for IP %s", payload["remoteip"])
        r = requests.post(TURNSTILE_VERIFY_URL, data=payload, timeout=6)
        j = r.json()
        if j.get("success"):
            logger.info("Turnstile verification successful")
            return True, j
        logger.warning("Turnstile verification failed: %s", j)
        # Normalize failure shape a bit
        return False, {
            "error": "captcha_failed",
            "message": "Captcha verification failed.",
            "details": j,
        }
    except Exception as e:
        logger.exception("Error while verifying Turnstile")
        return False, {"error": "captcha_error", "message": str(e)}
