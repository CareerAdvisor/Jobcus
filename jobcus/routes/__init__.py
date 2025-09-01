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

    # If you already have an auth blueprint, use it.
    # Otherwise, create a minimal shim so url_for('account') works.
    if auth_bp:
        app.register_blueprint(auth_bp)
    else:
        @app.get("/account", endpoint="account")
        def account_page():
            return render_template("account.html")
