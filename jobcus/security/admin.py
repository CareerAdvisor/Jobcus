# jobcus/security/admin.py
from __future__ import annotations
from functools import wraps
from flask import abort, redirect, url_for, flash, request
from flask_login import login_required, current_user

def require_superadmin(*, with_mfa: bool = True):
    """
    Use on admin routes: @require_superadmin(with_mfa=True)
    - Blocks non-superadmins (403)
    - If with_mfa, redirects superadmin to /account to complete 2FA
      unless current_user.mfa_verified is True.
    """
    def _decorator(fn):
        @wraps(fn)
        @login_required
        def _wrapped(*args, **kwargs):
            role = (getattr(current_user, "role", "") or "").lower()
            if role != "superadmin":
                abort(403)

            if with_mfa and not getattr(current_user, "mfa_verified", False):
                flash("Two-factor authentication is required for admin access.")
                return redirect(url_for("account", next=request.path, mfa=1))
            return fn(*args, **kwargs)
        return _wrapped
    return _decorator
