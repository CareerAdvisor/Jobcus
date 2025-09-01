# jobcus/__init__.py
from __future__ import annotations
from flask import Flask
from .config import get_config
from .extensions import init_extensions

def create_app(env: str | None = None) -> Flask:
    """
    Application factory.
    - Loads config (Dev/Prod/Test via env or FLASK_ENV/JOBCUS_ENV).
    - Initializes extensions (login, CORS, supabase, openai, etc.).
    - Registers all blueprints.
    """
    app = Flask(
        __name__,
        static_folder="static",
        template_folder="templates",
    )

    # 1) Config
    app.config.from_object(get_config(env))

    # 2) Extensions (puts SUPABASE_ADMIN, OPENAI_CLIENT, login_manager, etc. on app)
    init_extensions(app)

    # 3) Blueprints (import inside to avoid circular imports)
    from .routes import register_blueprints
    register_blueprints(app)

    # 4) Simple global template vars (handy for base.html/scripts)
    @app.context_processor
    def inject_globals():
        return {
            "APP_NAME": "Jobcus",
        }

    # 5) Basic error handlers (return JSON for APIs but keep HTML for pages)
    @app.errorhandler(404)
    def not_found(e):
        return ("Not Found", 404)

    @app.errorhandler(500)
    def internal_error(e):
        # You can add logging here if desired
        return ("Server Error", 500)

    return app
