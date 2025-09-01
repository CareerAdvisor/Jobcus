# jobcus/config.py
from __future__ import annotations
import os

class Config:
    # Flask
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-key")

    # Supabase
    SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
    SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

    # OpenAI
    OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

    # Superadmins (emails or auth_ids), comma-separated
    JOBCUS_SUPERADMINS = {
        s.strip() for s in os.environ.get("JOBCUS_SUPERADMINS", "").split(",") if s.strip()
    }

    # Feature limits (front/back can use same numbers; backend is source of truth)
    CHAT_FREE_LIMIT = int(os.environ.get("CHAT_FREE_LIMIT", "15"))
    ANALYZER_FREE_LIMIT = int(os.environ.get("ANALYZER_FREE_LIMIT", "5"))

    # CORS origins if you need them (comma-separated)
    CORS_ORIGINS = [s.strip() for s in os.environ.get("CORS_ORIGINS", "").split(",") if s.strip()]

class DevConfig(Config):
    DEBUG = True

class ProdConfig(Config):
    DEBUG = False

class TestConfig(Config):
    TESTING = True
    DEBUG = True

def get_config(env: str | None = None):
    """Resolve config by env string or environment variables."""
    env = (env or os.environ.get("JOBCUS_ENV") or os.environ.get("FLASK_ENV") or "production").lower()
    if env in ("dev", "development"):
        return DevConfig
    if env in ("test", "testing"):
        return TestConfig
    return ProdConfig
