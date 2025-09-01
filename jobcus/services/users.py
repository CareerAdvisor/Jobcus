from typing import Optional, Dict, Any

def get_or_bootstrap_user(supabase_admin, auth_id: Optional[str], email: Optional[str]) -> Dict[str, Any]:
    """
    Ensure a users row exists for this auth_id. Returns a dict with at least 'plan' and 'role'.
    """
    try:
        if not auth_id:
            return {"plan": "free", "role": "guest"}
        r = supabase_admin.table("users").select("auth_id,plan,plan_status,role").eq("auth_id", auth_id).limit(1).execute()
        row = (getattr(r, "data", None) or [None])[0]
        if not row:
            row = {
                "auth_id": auth_id,
                "email": email,
                "plan": "free",
                "plan_status": "active",
                "role": "user",
            }
            supabase_admin.table("users").insert(row).execute()
        row["plan"] = (row.get("plan") or "free").lower()
        row["role"] = (row.get("role") or "user").lower()
        return row
    except Exception:
        # Fail-safe: never explode chat due to user bootstrap
        return {"plan": "free", "role": "user"}
