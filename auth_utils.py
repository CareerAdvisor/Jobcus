# auth_utils.py
from functools import wraps
from flask import request, jsonify, redirect, abort
from flask_login import current_user

# ---------- existing staff helpers ----------
def is_staff() -> bool:
    # treat admins & superadmins as staff
    return bool(getattr(current_user, "is_admin", False) or getattr(current_user, "is_superadmin", False))

def is_superadmin() -> bool:
    return bool(getattr(current_user, "is_superadmin", False))

def require_superadmin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user.is_authenticated or not is_superadmin():
            return abort(403)
        return fn(*args, **kwargs)
    return wrapper

# ---------- new API auth helpers ----------
def _wants_json():
    """
    Treat requests as XHR/API when:
      - path starts with /api,
      - Accept header prefers JSON,
      - body is JSON,
      - or X-Requested-With indicates AJAX.
    """
    accept = (request.headers.get("Accept") or "").lower()
    return (
        request.path.startswith("/api/")
        or "application/json" in accept
        or request.is_json
        or request.headers.get("X-Requested-With") == "XMLHttpRequest"
    )

def api_login_required(view):
    """
    If authenticated: run the view.
    If not and it's API/XHR: return 401 JSON (so client won’t parse HTML).
    If not and it's a normal nav: 302 to /account with ?next=…
    """
    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_user.is_authenticated:
            return view(*args, **kwargs)
        if _wants_json():
            return jsonify(error="unauthorized", message="Login required"), 401
        next_url = request.args.get("next") or request.path
        return redirect(f"/account?next={next_url}")
    return wrapped
