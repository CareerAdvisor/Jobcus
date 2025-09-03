# jobcus/routes/__init__.py
from __future__ import annotations
from flask import Flask, render_template, redirect, url_for

def register_routes(app: Flask) -> None:
    from .main import main_bp
    from .ask import ask_bp
    from .resumes import resumes_bp
    from .auth import auth_bp

    # Optional blueprints
    for bp_import in ["interviews", "employer", "state", "insights", "billing", "admin", "auth_session"]:
        try:
            mod = __import__(f"jobcus.routes.{bp_import}", fromlist=[f"{bp_import}_bp"])
            app.register_blueprint(getattr(mod, f"{bp_import}_bp"))
        except Exception:
            pass

    app.register_blueprint(main_bp)
    app.register_blueprint(ask_bp)
    app.register_blueprint(resumes_bp)
    app.register_blueprint(auth_bp)

    def alias_endpoint(source_ep: str, rule: str, alias_ep: str):
        if source_ep in app.view_functions and alias_ep not in app.view_functions:
            app.add_url_rule(rule, endpoint=alias_ep, view_func=app.view_functions[source_ep])

    # MAIN aliases
    main_routes = [
        ("main.index", "/", "index"),
        ("main.chat", "/chat", "chat"),
        ("main.pricing", "/pricing", "pricing"),
        ("main.dashboard", "/dashboard", "dashboard"),
        ("main.page_resume_analyzer", "/resume-analyzer", "page_resume_analyzer"),
        ("main.page_resume_builder", "/resume-builder", "page_resume_builder"),
        ("main.interview_coach", "/interview-coach", "interview_coach"),
        ("main.cover_letter", "/cover-letter", "cover_letter"),
        ("main.skill_gap", "/skill-gap", "skill_gap"),
        ("main.job_insights", "/job-insights", "job_insights"),
        ("main.employers", "/employers", "employers"),
        ("main.faq", "/faq", "faq"),
        ("main.privacy_policy", "/privacy-policy", "privacy_policy"),
        ("main.terms_of_service", "/terms-of-service", "terms_of_service"),
        ("main.admin_settings", "/admin/settings", "admin_settings"),
    ]
    for src, path, ep in main_routes:
        alias_endpoint(src, path, ep)

    # AUTH aliases + fallback
    if "account" not in app.view_functions:
        alias_endpoint("auth.account", "/account", "account")

    if "login" not in app.view_functions:
        alias_endpoint("auth.account", "/login", "login")

    if "signup" not in app.view_functions:
        alias_endpoint("auth.account", "/signup", "signup")

    if "logout" not in app.view_functions:
        try:
            from flask_login import logout_user
        except Exception:
            logout_user = None

        @app.get("/logout", endpoint="logout")
        def _logout():
            try:
                if logout_user:
                    logout_user()
            except Exception:
                pass
            return redirect(url_for("account"))
