from __future__ import annotations

def fetch_user_row(auth_id: str) -> dict | None:
    """
    Return a dict: {auth_id, email, plan, role, first_name?, last_name?, fullname?}
    """
    # You likely have a global admin client on current_app.config["SUPABASE_ADMIN"].
    # If not, import your init_supabase() and create one here (not shown).
    from flask import current_app
    supabase_admin = current_app.config["SUPABASE_ADMIN"]

    r = (
        supabase_admin.table("users")
        .select("auth_id,email,plan,role,first_name,last_name,fullname")
        .eq("auth_id", auth_id)
        .limit(1)
        .execute()
    )
    data = getattr(r, "data", None) or []
    if isinstance(data, list) and data:
        row = dict(data[0])
        row.setdefault("plan", "free")
        row.setdefault("role", "user")
        return row
    return None


def get_or_bootstrap_user(supabase_admin, auth_id: str, email: str | None) -> dict:
    """
    Ensure a user row exists; return {auth_id,email,plan,role,...}
    """
    r = (
        supabase_admin.table("users")
        .select("auth_id,email,plan,role,first_name,last_name,fullname")
        .eq("auth_id", auth_id)
        .limit(1)
        .execute()
    )
    data = getattr(r, "data", None) or []
    if isinstance(data, list) and data:
        row = dict(data[0])
        row.setdefault("plan", "free")
        row.setdefault("role", "user")
        return row

    # Create a new user with defaults
    insert = (
        supabase_admin.table("users")
        .insert(
            {
                "auth_id": auth_id,
                "email": email,
                "plan": "free",
                "role": "user",
            }
        )
        .execute()
    )
    created = getattr(insert, "data", None) or [{}]
    row = dict(created[0])
    row.setdefault("plan", "free")
    row.setdefault("role", "user")
    return row
