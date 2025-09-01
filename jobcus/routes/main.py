from flask import Blueprint, render_template
from flask_login import login_required, current_user
from ..services.models import allowed_models_for_plan

main_bp = Blueprint("main", __name__)

@main_bp.get("/")
def index():
    return render_template("index.html")

@main_bp.get("/chat")
@login_required
def chat():
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    is_paid = plan in ("weekly","standard","premium")
    allowed = allowed_models_for_plan(plan)
    free_allowed = allowed_models_for_plan("free")
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
