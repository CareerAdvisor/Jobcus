from __future__ import annotations
from flask import Flask, render_template, redirect, url_for

def register_routes(app: Flask) -> None:
    from .main import main_bp
    from .ask import ask_bp
    from .resumes import resumes_bp
    from .auth import auth_bp

    optional_blueprints = [
        ("interviews", "interviews_bp"),
        ("employer", "employer_bp"),
        ("state", "state_bp"),
        ("insights", "insights_bp"),
        ("billing", "billing_bp"),
        ("admin", "admin_bp"),
        ("auth_session", "auth_session_bp")
    ]

    for module_name, bp_var in optional_blueprints:
        try:
            mod = __import__(f"jobcus.routes.{module_name}", fromlist=[bp_var])
            bp = getattr(mod, bp_var, None)
            if bp:
                app.register_blueprint(bp)
        except Exception:
            continue

    # Register core blueprints
    app.register_blueprint(main_bp)
    app.register_blueprint(ask_bp)
    app.register_blueprint(resumes_bp)
    app.register_blueprint(auth_bp)

    # ---- Helper to create top-level aliases for blueprint endpoints ----
    def alias_endpoint(source_ep: str, rule: str, alias_ep: str):
        if source_ep in app.view_functions and alias_ep not in app.view_functions:
            app.add_url_rule(rule, endpoint=alias_ep, view_func=app.view_functions[source_ep])

    # ----- Aliases for MAIN endpoints ----
    pages = [
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
        ("main.admin_settings", "/admin/settings", "admin_settings")
    ]
    for source, rule, alias in pages:
        alias_endpoint(source, rule, alias)

    # ----- Auth routes ----
    if "account" not in app.view_functions:
        if "auth.account" in app.view_functions:
            alias_endpoint("auth.account", "/account", "account")
        else:
            @app.get("/account", endpoint="account")
            def _account_page():
                return render_template("account.html")

    if "login" not in app.view_functions:
        if "auth.login" in app.view_functions:
            alias_endpoint("auth.login", "/login", "login")
        else:
            @app.get("/login", endpoint="login")
            def _login_redirect():
                return render_template("account.html")

    if "signup" not in app.view_functions:
        if "auth.signup" in app.view_functions:
            alias_endpoint("auth.signup", "/signup", "signup")
        else:
            @app.get("/signup", endpoint="signup")
            def _signup_redirect():
                return render_template("account.html")

    if "logout" not in app.view_functions:
        if "auth.logout" in app.view_functions:
            alias_endpoint("auth.logout", "/logout", "logout")
        else:
            try:
                from flask_login import logout_user
            except Exception:
                logout_user = None

            @app.get("/logout", endpoint="logout")
            def _logout_shim():
                try:
                    if logout_user:
                        logout_user()
                except Exception:
                    pass
                return redirect(url_for("account"))
