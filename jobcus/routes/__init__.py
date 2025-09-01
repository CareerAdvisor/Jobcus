# jobcus/routes/__init__.py
from __future__ import annotations
from flask import Flask

def register_routes(app: Flask) -> None:
    """
    Import & register all HTTP blueprints here.
    Import inside the function to avoid circular imports during app creation.
    """
    # Required
    from .ask import ask_bp
    from .resumes import resumes_bp

    # Optional (register if present)
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
        from .main import main_bp  # only if you moved page routes here
    except Exception:
        main_bp = None

    # Register
    app.register_blueprint(ask_bp)
    app.register_blueprint(resumes_bp)
    if interviews_bp: app.register_blueprint(interviews_bp)
    if employer_bp:   app.register_blueprint(employer_bp)
    if state_bp:      app.register_blueprint(state_bp)
    if main_bp:       app.register_blueprint(main_bp)
