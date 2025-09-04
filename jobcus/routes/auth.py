# jobcus/routes/auth.py
from __future__ import annotations
from flask import Blueprint, request, render_template, jsonify, redirect, url_for, current_app, session
from werkzeug.security import check_password_hash, generate_password_hash
from flask_login import login_user, logout_user
from jobcus.services import models

auth_bp = Blueprint("auth", __name__, url_prefix="/account")
User = models.User  # Adjusted from jobcus/services/models.py

@auth_bp.route("", methods=["GET"])
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

    if not email or not password or (mode == "signup" and not name):
        return jsonify(success=False, message="All fields are required"), 400

    db = current_app.config["SUPABASE_ADMIN"]  # Use Supabase table as pseudo-database

    if mode == "signup":
        # Check if user already exists
        existing = db.table("users").select("*").eq("email", email).execute()
        if existing.data:
            return jsonify(success=False, code="user_exists", message="User already exists.")

        hashed_pw = generate_password_hash(password)
        resp = db.table("users").insert({
            "email": email,
            "fullname": name,
            "password_hash": hashed_pw,
            "auth_id": email,  # use email as ID (custom auth)
            "role": "user",
            "plan": "free"
        }).execute()

        user = User(auth_id=email, email=email, fullname=name)
        login_user(user)
        return jsonify(success=True, redirect=url_for("main.dashboard"))

    elif mode == "login":
        existing = db.table("users").select("*").eq("email", email).limit(1).execute()
        user_data = existing.data[0] if existing.data else None
        if not user_data:
            return jsonify(success=False, message="No account with this email."), 404

        stored_hash = user_data.get("password_hash")
        if not stored_hash or not check_password_hash(stored_hash, password):
            return jsonify(success=False, message="Incorrect password."), 403

        user = User(
            auth_id=user_data["auth_id"],
            email=user_data["email"],
            fullname=user_data["fullname"],
            role=user_data.get("role", "user"),
            plan=user_data.get("plan", "free")
        )
        login_user(user)
        return jsonify(success=True, redirect=url_for("main.dashboard"))

    else:
        return jsonify(success=False, message="Invalid mode."), 400

@auth_bp.route("/logout", methods=["GET"])
def logout():
    logout_user()
    session.clear()
    return redirect(url_for("auth.account"))
