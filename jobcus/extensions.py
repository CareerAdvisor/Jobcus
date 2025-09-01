import os
from flask_login import LoginManager, UserMixin
from supabase import create_client
from openai import OpenAI

# Import a tiny fetcher that returns a dict with role/plan/etc.
# (you'll add this in jobcus/services/users.py below)
from jobcus.services.users import fetch_user_row

# 1) A single LoginManager instance you can init on the app
login_manager = LoginManager()
login_manager.login_view = "account"  # so @login_required redirects here

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

# 4) Minimal user object Flask-Login can store in the session
class User(UserMixin):
    def __init__(self, auth_id, email=None, plan="free", role="user", **_):
        self.id = auth_id
        self.email = email
        self.plan = (plan or "free").lower()
        self.role = (role or "user").lower()

# 5) Bring a full user (with role/plan) back on each request
@login_manager.user_loader
def load_user(auth_id: str):
    row = fetch_user_row(auth_id)  # must return at least {auth_id, email, plan, role}
    return User(**row) if row else None
