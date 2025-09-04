import os
from flask import current_app
from flask_login import current_user, UserMixin

class User(UserMixin):
    def __init__(self, auth_id, email=None, fullname=None, role="user", plan="free", plan_status=None):
        self.id = auth_id
        self.auth_id = auth_id
        self.email = email
        self.fullname = fullname
        self.role = (role or "user").lower()
        self.plan = (plan or "free").lower()
        self.plan_status = plan_status

    def get_id(self):
        return self.auth_id

    @property
    def is_admin(self):
        return self.role == "admin"

    @property
    def is_superadmin(self):
        return self.role == "superadmin"

def _dedupe(seq):
    seen, out = set(), []
    for m in seq:
        m = (m or "").strip()
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out

def _available_models():
    try:
        client = current_app.config["OPENAI_CLIENT"]
        return {m.id for m in client.models.list().data}
    except Exception:
        return None

def allowed_models_for_plan(plan: str) -> list[str]:
    plan = (plan or "free").lower()
    free_default = (os.getenv("FREE_MODEL", "gpt-4o-mini") or "gpt-4o-mini").strip()
    paid_default = (os.getenv("PAID_MODEL_DEFAULT", "gpt-4o-mini") or "gpt-4o-mini").strip()
    paid_allow = [s.strip() for s in (os.getenv("PAID_MODEL_ALLOW", "") or "").split(",") if s.strip()]

    out = [free_default] if plan == "free" else _dedupe([paid_default] + paid_allow)

    avail = _available_models()
    if avail:
        filtered = [m for m in out if m in avail] or ([free_default] if free_default in avail else out)
        return filtered
    return out

def choose_model(requested: str | None) -> str:
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    allowed = allowed_models_for_plan(plan)
    req = (requested or "").strip()
    return req if req in allowed else allowed[0]
