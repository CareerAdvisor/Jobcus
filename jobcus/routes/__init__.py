# jobcus/routes/__init__.py
from __future__ import annotations
from flask import Flask

def register_blueprints(app: Flask) -> None:
    """
    Import & register all HTTP blueprints here.
    Import inside the function to avoid circular imports during app creation.
    """
    from .main import main_bp
    from .ask import ask_bp
    from .resumes import resumes_bp
    # from .interviews import interviews_bp
    # from .employer import employer_bp
    # from .state import state_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(ask_bp)
    app.register_blueprint(resumes_bp)
    # app.register_blueprint(interviews_bp)
    # app.register_blueprint(employer_bp)
    # app.register_blueprint(state_bp)

