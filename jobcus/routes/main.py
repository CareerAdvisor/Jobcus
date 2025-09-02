# jobcus/routes/main.py
from __future__ import annotations

import os
from typing import Dict

from flask import Blueprint, render_template, request, jsonify, redirect, url_for, current_app
from flask_login import login_required, current_user

# If this import might not exist in some environments, keep it but be defensive below.
from ..services.models import allowed_models_for_plan

main_bp = Blueprint("main", __name__)

# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────

def _plan_catalog() -> Dict[str, dict]:
    # Central place to describe plans used by /pricing and /subscribe
    return {
        "free": {
            "code": "free",
            "title": "Free",
            "amount": "0",
            "period": "/mo",
            "tagline": "Great for a quick check",
            "features": [
                "<strong>3</strong> resume analyses / month (basic score + tips)",
                "<strong>2</strong> AI cover letters / month",
                "AI Resume Builder (basic templates)",
                "Skill-Gap snapshot (1 basic analysis)",
                "Job Insights (basic charts)",
                "Interview Coach (limited practice)",
                "AI Chat trial: <strong>15 messages</strong> total",
                "Local device history",
            ],
        },
        "weekly": {
            "code": "weekly",
            "title": "Weekly Pass",
            "amount": "7<span class='cents'>.99</span>",
            "period": "/week",
            "tagline": "For urgent applications",
            "features": [
                "AI Chat credits: <strong>200 messages</strong> / week",
                "<strong>10</strong> resume analyses / week",
                "<strong>5</strong> AI cover letters / week",
                "“Rebuild with AI” for resumes",
                "Skill-Gap (standard)",
                "Job Insights (full access)",
                "Interview Coach sessions",
                "Email support",
            ],
        },
        "standard": {
            "code": "standard",
            "title": "Standard",
            "amount": "23<span class='cents'>.99</span>",
            "period": "/mo",
            "tagline": "Serious applications, smarter tools",
            "features": [
                "AI Chat credits: <strong>800 messages</strong> / month",
                "<strong>50</strong> resume analyses / month (deep ATS + JD match)",
                "<strong>20</strong> AI cover letters / month",
                "AI Optimize + Rebuild with AI",
                "Interview Coach sessions",
                "Skill-Gap (pro)",
                "Job Insights (full access)",
                "Download optimized PDF / DOCX / TXT",
                "Save history across devices",
                "Email support",
            ],
        },
        "premium": {
            "code": "premium",
            "title": "Premium",
            "amount": "229",
            "period": "/yr",
            "tagline": "Best value for ongoing career growth",
            "features": [
                "AI Chat credits: <strong>12,000 messages</strong> / year (~1,000 / mo)",
                "<strong>Unlimited*</strong> resume analyses (fair use)",
                "<strong>Unlimited</strong> AI cover letters (fair use)",
                "All Standard features + multi-resume versions & template pack",
                "Priority support & early access to new AI tools",
            ],
        },
    }

def _human_plan(code: str) -> str:
    return {
        "free": "Free",
        "weekly": "Weekly Pass",
        "standard": "Standard",
        "premium": "Premium",
    }.get(code, code.capitalize())

# ──────────────────────────────────────────────────────────────
# Pages
# ──────────────────────────────────────────────────────────────

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

@main_bp.get("/cover-letter")
def cover_letter():
    return render_template("cover-letter.html")

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

# ──────────────────────────────────────────────────────────────
# Account/Email pages that templates already exist for
# ──────────────────────────────────────────────────────────────

@main_bp.get("/check-email")
def check_email():
    return render_template("check-email.html")

@main_bp.get("/confirm")
def confirm():
    return render_template("confirm.html")

@main_bp.get("/cookie")
def cookie():
    return render_template("cookie.html")

@main_bp.get("/forgot-password")
def forgot_password():
    return render_template("forgot-password.html")

@main_bp.get("/reset-password")
def reset_password():
    token = request.args.get("token", "")
    return render_template("reset-password.html", token=token)

# ──────────────────────────────────────────────────────────────
# Subscribe / Checkout (Stripe optional)
# ──────────────────────────────────────────────────────────────

@main_bp.get("/subscribe")
@login_required
def subscribe_get():
    plan = (request.args.get("plan") or "standard").lower()
    cat = _plan_catalog()
    plan_data = cat.get(plan, cat["standard"])
    return render_template("subscribe.html", plan_data=plan_data)

@main_bp.post("/subscribe")
@login_required
def subscribe_post():
    """
    POST from the confirm form. For paid plans, either:
      - Create a Stripe Checkout session and redirect.
      - Or (if Stripe not configured) simulate success and upgrade locally.
    For free plan, immediately update the plan.
    """
    plan_code = (request.form.get("plan") or "standard").lower()
    if plan_code not in _plan_catalog():
        plan_code = "standard"

    # Free plan → immediately "downgrade"
    if plan_code == "free":
        try:
            supabase = current_app.config["SUPABASE_ADMIN"]
            supabase.table("profiles").update({"plan": "free"}).eq("auth_id", current_user.id).execute()
        except Exception:
            current_app.logger.info("Could not persist free plan; continuing anyway.")
        return redirect(url_for("main.subscribe_success", plan=plan_code))

    # Paid plans → Stripe if available
    stripe_key = os.getenv("STRIPE_SECRET_KEY") or current_app.config.get("STRIPE_SECRET_KEY")
    stripe_price_map = current_app.config.get("STRIPE_PRICE_IDS", {})  # {"weekly":"price_...", "standard":"price_...", "premium":"price_..."}
    price_id = stripe_price_map.get(plan_code)

    if stripe_key and price_id:
        try:
            import stripe
            stripe.api_key = stripe_key
            session = stripe.checkout.Session.create(
                mode="subscription",
                line_items=[{"price": price_id, "quantity": 1}],
                success_url=url_for("main.subscribe_success", plan=plan_code, _external=True) + "?session_id={CHECKOUT_SESSION_ID}",
                cancel_url=url_for("main.pricing", _external=True),
                allow_promotion_codes=True,
                client_reference_id=str(current_user.id),
                customer_email=getattr(current_user, "email", None),
            )
            return redirect(session.url, code=303)
        except Exception as e:
            current_app.logger.exception("Stripe checkout failed: %s", e)
            # Fallback: go to success and let support fix Stripe later
            return redirect(url_for("main.subscribe_success", plan=plan_code))

    # No Stripe configured → simulate success for now
    try:
        supabase = current_app.config["SUPABASE_ADMIN"]
        supabase.table("profiles").update({"plan": plan_code}).eq("auth_id", current_user.id).execute()
    except Exception:
        current_app.logger.info("Could not persist plan (no Stripe); continuing anyway.")
    return redirect(url_for("main.subscribe_success", plan=plan_code))

@main_bp.get("/subscribe-success")
@login_required
def subscribe_success():
    plan = (request.args.get("plan") or (getattr(current_user, "plan", "standard") or "standard")).lower()
    return render_template(
        "subscribe-success.html",
        plan_human=_human_plan(plan),
        plan_json=plan,
    )

# Optional: Stripe webhook (safe no-op if not configured)
@main_bp.post("/stripe/webhook")
def stripe_webhook():
    stripe_key = os.getenv("STRIPE_SECRET_KEY") or current_app.config.get("STRIPE_SECRET_KEY")
    endpoint_secret = os.getenv("STRIPE_ENDPOINT_SECRET") or current_app.config.get("STRIPE_ENDPOINT_SECRET")
    if not (stripe_key and endpoint_secret):
        return "", 200
    try:
        import stripe
        stripe.api_key = stripe_key
        payload = request.data
        sig = request.headers.get("Stripe-Signature", "")
        event = stripe.Webhook.construct_event(payload, sig, endpoint_secret)
        # TODO: handle event types (checkout.session.completed) to mark plan active
    except Exception:
        current_app.logger.exception("Stripe webhook error")
        return "", 400
    return "", 200

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

    # New pages
    alias("subscribe_get", "/subscribe", "subscribe")
    alias("subscribe_success", "/subscribe-success", "subscribe_success")
    alias("check_email", "/check-email", "check_email")
    alias("confirm", "/confirm", "confirm")
    alias("cookie", "/cookie", "cookie")
    alias("forgot_password", "/forgot-password", "forgot_password")
    alias("reset_password", "/reset-password", "reset_password")
