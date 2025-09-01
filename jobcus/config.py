# jobcus/config.py
import os

class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-key")
    SUPABASE_URL = os.environ.get("SUPABASE_URL")
    SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
    OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

    # superadmin emails or auth_ids (comma-separated)
    JOBCUS_SUPERADMINS = {
        s.strip() for s in (os.environ.get("JOBCUS_SUPERADMINS", "")).split(",") if s.strip()
    }

    # Feature toggles / quotas can live here too
    CHAT_FREE_LIMIT = int(os.environ.get("CHAT_FREE_LIMIT", "15"))
    ANALYZER_FREE_LIMIT = int(os.environ.get("ANALYZER_FREE_LIMIT", "5"))

class DevConfig(Config):
    DEBUG = True

class ProdConfig(Config):
    DEBUG = False
