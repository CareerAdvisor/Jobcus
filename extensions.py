# extensions.py
import os
from flask_login import LoginManager
from supabase import create_client
from openai import OpenAI

# 1) A single LoginManager instance you can init on the app
login_manager = LoginManager()

# 2) Small factory to build a Supabase client from env vars
def init_supabase():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_KEY")
    return create_client(url, key)

# 3) Small factory to build an OpenAI client from env vars
def init_openai():
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing OPENAI_API_KEY")
    return OpenAI(api_key=api_key)
