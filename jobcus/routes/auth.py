from flask import Blueprint, render_template, request, jsonify, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import login_user, logout_user
from jobcus.services.models import User

auth_bp = Blueprint("auth", __name__, url_prefix="/account")

@auth_bp.route("", methods=["GET"], endpoint="account")
def account():
    mode = request.args.get("mode", "login")
    return render_template("account.html", mode=mode)

@auth_bp.route("", methods=["POST"])
def account_post():
    data = request.get_json()
    mode = data.get("mode")
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    name = data.get("name", "").strip()

    if not email or not password:
        return jsonify(success=False, message="Email and password required."), 400

    from flask import current_app as app
    supabase = app.config.get("SUPABASE_ADMIN")
    if not supabase:
        return jsonify(success=False, message="Supabase not available."), 500

    try:
        if mode == "signup":
            # Check if user exists
            existing = supabase.table("users").select("email").eq("email", email).execute()
            if existing.data:
                return jsonify(success=False, code="user_exists", message="Account already exists. Please sign in.")

            hashed_pw = generate_password_hash(password)
            user = {
                "email": email,
                "fullname": name,
                "password": hashed_pw,
                "auth_id": f"user_{email}",  # simple auth_id fallback
                "role": "user",
                "plan": "free",
            }
            supabase.table("users").insert(user).execute()
            login_user(User(user["auth_id"], email=email, fullname=name))
            return jsonify(success=True, redirect=url_for("main.dashboard"))

        elif mode == "login":
            row = supabase.table("users").select("*").eq("email", email).limit(1).execute()
            user_data = row.data[0] if row.data else None
            if not user_data or not check_password_hash(user_data.get("password", ""), password):
                return jsonify(success=False, message="Invalid credentials."), 401

            user_obj = User(
                auth_id=user_data["auth_id"],
                email=user_data["email"],
                fullname=user_data["fullname"],
                role=user_data.get("role", "user"),
                plan=user_data.get("plan", "free"),
                plan_status=user_data.get("plan_status"),
            )
            login_user(user_obj)
            return jsonify(success=True, redirect=url_for("main.dashboard"))

        else:
            return jsonify(success=False, message="Invalid request mode."), 400

    except Exception as e:
        import logging
        logging.exception("Auth error")
        return jsonify(success=False, message="Server error. Try again."), 500

@auth_bp.route("/logout")
def logout():
    logout_user()
    return redirect(url_for("account"))
