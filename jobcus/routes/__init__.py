# jobcus/routes/__init__.py
from __future__ import annotations
from flask import Flask, render_template, redirect, url_for

def register_routes(app: Flask) -> None:
    from .main import main_bp
    from .ask import ask_bp
    from .resumes import resumes_bp

    # Optional / when you add them:
    try:
        from .interviews import interviews_bp
    except Exception:
        interviews_bp = None
    try:
        from .employer import employer_bp
    except Exception:
        employer_bp = None
    try:
        from .state import state_bp
    except Exception:
        state_bp = None
    try:
        from .insights import insights_bp
    except Exception:
        insights_bp = None
    try:
        from .auth import auth_bp
    except Exception:
        auth_bp = None
    try:
        from .billing import billing_bp
    except Exception:
        billing_bp = None

    # Register core blueprints
    app.register_blueprint(main_bp)
    app.register_blueprint(ask_bp)
    app.register_blueprint(resumes_bp)

    # Register optional blueprints if present
    if interviews_bp:
        app.register_blueprint(interviews_bp)
    if employer_bp:
        app.register_blueprint(employer_bp)
    if state_bp:
        app.register_blueprint(state_bp)
    if insights_bp:
        app.register_blueprint(insights_bp)
    if billing_bp:
        app.register_blueprint(billing_bp)
    if auth_bp:
        app.register_blueprint(auth_bp)

    # ---- Helper to create top-level aliases for blueprint endpoints ----
    def alias_endpoint(source_ep: str, rule: str, alias_ep: str):
        """
        Add a new URL rule that points to an existing view function registered
        under a blueprint (e.g., 'main.pricing' -> '/pricing', endpoint='pricing').
        Only adds if the source exists and alias doesn't.
        """
        if source_ep in app.view_functions and alias_ep not in app.view_functions:
            app.add_url_rule(rule, endpoint=alias_ep, view_func=app.view_functions[source_ep])

    # ----- Aliases for MAIN endpoints (your templates call them unqualified) -----
    alias_endpoint("main.index", "/", "index")
    alias_endpoint("main.chat", "/chat", "chat")
    alias_endpoint("main.pricing", "/pricing", "pricing")
    alias_endpoint("main.dashboard", "/dashboard", "dashboard")
    alias_endpoint("main.page_resume_analyzer", "/resume-analyzer", "page_resume_analyzer")
    alias_endpoint("main.page_resume_builder", "/resume-builder", "page_resume_builder")
    alias_endpoint("main.interview_coach", "/interview-coach", "interview_coach")
    alias_endpoint("main.cover_letter", "/cover-letter", "cover_letter")
    alias_endpoint("main.skill_gap", "/skill-gap", "skill_gap")
    alias_endpoint("main.job_insights", "/job-insights", "job_insights")
    alias_endpoint("main.employers", "/employers", "employers")
    alias_endpoint("main.faq", "/faq", "faq")
    alias_endpoint("main.privacy_policy", "/privacy-policy", "privacy_policy")
    alias_endpoint("main.terms_of_service", "/terms-of-service", "terms_of_service")
    alias_endpoint("main.admin_settings", "/admin/settings", "admin_settings")

    # ----- Auth routes: prefer aliasing real views; otherwise provide shims -----
    # account
    if "account" not in app.view_functions:
        if "auth.account" in app.view_functions:
            alias_endpoint("auth.account", "/account", "account")
        else:
            @app.get("/account", endpoint="account")
            def _account_page():
                # Minimal fallback page
                return render_template("account.html")

    # login
    if "login" not in app.view_functions:
        if "auth.login" in app.view_functions:
            alias_endpoint("auth.login", "/login", "login")
        else:
            @app.get("/login", endpoint="login")
            def _login_redirect():
                # Use the same page as account if you don't split them
                return render_template("account.html")

    # signup
    if "signup" not in app.view_functions:
        if "auth.signup" in app.view_functions:
            alias_endpoint("auth.signup", "/signup", "signup")
        else:
            @app.get("/signup", endpoint="signup")
            def _signup_redirect():
                return render_template("account.html")

    # logout
    if "logout" not in app.view_functions:
        if "auth.logout" in app.view_functions:
            alias_endpoint("auth.logout", "/logout", "logout")
        else:
            # Safe shim: log the user out if Flask-Login is present; then redirect.
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
                    # Don't let logout failures crash the page
                    pass
                return redirect(url_for("account"))
