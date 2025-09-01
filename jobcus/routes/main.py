# jobcus/routes/main.py
from __future__ import annotations

from flask import Blueprint, render_template
from flask_login import login_required, current_user

# If this import might not exist in some environments, keep it but be defensive below.
from ..services.models import allowed_models_for_plan

main_bp = Blueprint("main", __name__)

@main_bp.get("/")
def index():
    return render_template("index.html")


@main_bp.get("/chat")
@login_required
def chat():
    # Defensive defaults so an empty/failed model lookup doesn't 500.
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    is_paid = plan in ("weekly", "standard", "premium")
    try:
        allowed = allowed_models_for_plan(plan) or ["gpt-4o-mini"]
        free_allowed = allowed_models_for_plan("free") or ["gpt-4o-mini"]
    except Exception:
        allowed = ["gpt-4o-mini"]
        free_allowed = ["gpt-4o-mini"]

    return render_template(
        "chat.html",
        is_paid=is_paid,
        plan=plan,
        model_options=allowed,
        free_model=free_allowed[0],
        model_default=allowed[0],
    )


@main_bp.get("/resume-analyzer")
def page_resume_analyzer():
    return render_template("resume-analyzer.html")


@main_bp.get("/resume-builder")
def page_resume_builder():
    return render_template("resume-builder.html")


@main_bp.get("/interview-coach")
def interview_coach():
    return render_template("interview-coach.html")


@main_bp.get("/skill-gap")
def skill_gap():
    return render_template("skill-gap.html")


@main_bp.get("/job-insights")
def job_insights():
    return render_template("job-insights.html")


@main_bp.get("/employers")
def employers():
    return render_template("employers.html")


@main_bp.get("/faq")
def faq():
    return render_template("faq.html")


@main_bp.get("/privacy-policy")
def privacy_policy():
    return render_template("privacy-policy.html")


@main_bp.get("/terms-of-service")
def terms_of_service():
    return render_template("terms-of-service.html")


@main_bp.get("/pricing")
def pricing():
    return render_template("pricing.html")


@main_bp.get("/dashboard")
@login_required
def dashboard():
    return render_template("dashboard.html")


@main_bp.get("/admin/settings")
@login_required
def admin_settings():
    # add your @require_superadmin decorator if needed
    return render_template("admin/settings.html")


# ---------- Create top-level aliases for unqualified url_for(...) calls ----------
# This runs once when the blueprint is registered on the app.
@main_bp.record_once
def _install_top_level_aliases(setup_state):
    """
    Many templates call url_for('pricing') / url_for('dashboard') (no blueprint prefix).
    Because this blueprint's endpoints are 'main.pricing', 'main.dashboard', etc.,
    we create one-to-one alias endpoints on the app so those unqualified calls work.
    """
    app = setup_state.app

    def alias(ep_name: str, rule: str, alias_endpoint: str):
        src = f"{main_bp.name}.{ep_name}"
        if src in app.view_functions and alias_endpoint not in app.view_functions:
            app.add_url_rule(rule, endpoint=alias_endpoint, view_func=app.view_functions[src])

    # Core pages commonly linked without blueprint prefix
    alias("index", "/", "index")
    alias("chat", "/chat", "chat")
    alias("pricing", "/pricing", "pricing")
    alias("dashboard", "/dashboard", "dashboard")

    # Secondary pages (only needed if templates link to them unqualified)
    alias("page_resume_analyzer", "/resume-analyzer", "page_resume_analyzer")
    alias("page_resume_builder", "/resume-builder", "page_resume_builder")
    alias("interview_coach", "/interview-coach", "interview_coach")
    alias("skill_gap", "/skill-gap", "skill_gap")
    alias("job_insights", "/job-insights", "job_insights")
    alias("employers", "/employers", "employers")
    alias("faq", "/faq", "faq")
    alias("privacy_policy", "/privacy-policy", "privacy_policy")
    alias("terms_of_service", "/terms-of-service", "terms_of_service")
    alias("admin_settings", "/admin/settings", "admin_settings")
