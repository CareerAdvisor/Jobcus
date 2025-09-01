# jobcus/routes/__init__.py
from __future__ import annotations
from flask import Flask, render_template

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

    # ---- Helpers to create top-level aliases for blueprint endpoints ----
    def alias_endpoint(source_ep: str, rule: str, alias_ep: str):
        """
        Add a new URL rule that points to an existing view function registered
        under a blueprint (e.g., 'main.pricing' -> '/pricing', endpoint='pricing').
        Safe: only adds if the source exists and alias doesn't.
        """
        if source_ep in app.view_functions and alias_ep not in app.view_functions:
            app.add_url_rule(rule, endpoint=alias_ep, view_func=app.view_functions[source_ep])

    # Create aliases for endpoints your templates call without blueprint prefix.
    # base.html uses url_for('pricing'), so map main.pricing -> pricing
    alias_endpoint("main.pricing", "/pricing", "pricing")
    # If your templates link to /chat with url_for('chat'), alias it too:
    alias_endpoint("main.chat", "/chat", "chat")
    # If you have a plain 'index' reference anywhere:
    alias_endpoint("main.index", "/", "index")

    # Account route:
    # Prefer aliasing an existing auth view if present, otherwise provide a tiny shim.
    if "account" not in app.view_functions:
        if "auth.account" in app.view_functions:
            alias_endpoint("auth.account", "/account", "account")
        else:
            @app.get("/account", endpoint="account")
            def account_page():
                # Minimal fallback so url_for('account') and login_view='account' both work
                return render_template("account.html")
