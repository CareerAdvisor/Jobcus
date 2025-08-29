from functools import wraps
from flask import abort
from flask_login import current_user

def is_staff() -> bool:
    # treat admins & superadmins as staff
    return bool(getattr(current_user, "is_admin", False))

def is_superadmin() -> bool:
    return bool(getattr(current_user, "is_superadmin", False))

def require_superadmin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user.is_authenticated or not is_superadmin():
            return abort(403)
        return fn(*args, **kwargs)
    return wrapper
