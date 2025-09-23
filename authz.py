from functools import wraps
from flask import jsonify
from flask_login import current_user

# gate order; tweak if you add more tiers
PLAN_RANK = {"free": 0, "weekly": 1, "standard": 1, "premium": 2}

def require_plan(min_plan: str):
    """
    Decorator: ensure current_user.plan >= min_plan.
    On failure returns {error:"upgrade_required", message:"..."} with HTTP 402.
    """
    def wrapper(fn):
        @wraps(fn)
        def inner(*args, **kwargs):
            user_plan = (getattr(current_user, "plan", "free") or "free").lower()
            if PLAN_RANK.get(user_plan, 0) >= PLAN_RANK.get(min_plan, 999):
                return fn(*args, **kwargs)
            return jsonify(
                error="upgrade_required",
                message="Upgrade to continue."
            ), 402
        return inner
    return wrapper
