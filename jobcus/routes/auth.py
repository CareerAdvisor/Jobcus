from flask import Blueprint, request, jsonify, render_template, redirect, session, url_for, flash, current_app
from flask_login import login_user, logout_user, login_required
from supabase import Client
from gotrue.errors import AuthApiError

auth_bp = Blueprint("auth", __name__)

@auth_bp.route("/account", methods=["GET", "POST"])
def account():
    if request.method == "GET":
        mode = request.args.get("mode", "signup")
        return render_template("account.html", mode=mode)

    # Handle POST request
    data = request.get_json(force=True)
    mode = data.get("mode")
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    name = data.get("name", "").strip()

    if not email or not password:
        return jsonify(success=False, message="Email and password are required."), 400

    supabase = current_app.config.get("SUPABASE_ADMIN")
    if not supabase:
        return jsonify(success=False, message="Supabase is not configured."), 500

    try:
        if mode == "signup":
            resp = supabase.auth.sign_up({"email": email, "password": password})
            user = resp.user
            if not user:
                return jsonify(success=False, message="Signup failed."), 400

            supabase.table("users").insert({
                "auth_id": user["id"],
                "email": email,
                "fullname": name
            }).execute()

            if not user.get("email_confirmed_at"):
                session["pending_email"] = email
                return jsonify(success=True, redirect=url_for("auth.check_email")), 200

            login_user(User(auth_id=user["id"], email=email, fullname=name))
            return jsonify(success=True, redirect=url_for("main.dashboard")), 200

        elif mode == "login":
            resp = supabase.auth.sign_in_with_password({"email": email, "password": password})
            user = resp.user
            if not user:
                return jsonify(success=False, message="Invalid credentials."), 401

            ud = user if isinstance(user, dict) else user.model_dump()
            auth_id = ud["id"]

            row = supabase.table("users").select("fullname").eq("auth_id", auth_id).single().execute()
            fullname = row.data.get("fullname") if row.data else None

            login_user(User(auth_id=auth_id, email=email, fullname=fullname))
            return jsonify(success=True, redirect=url_for("main.dashboard")), 200

        else:
            return jsonify(success=False, message="Invalid mode."), 400

    except Exception as e:
        current_app.logger.exception("Auth error")
        return jsonify(success=False, message="An error occurred. Please try again."), 500


@auth_bp.get("/forgot-password")
def forgot_password():
    return render_template("forgot-password.html")

@auth_bp.post("/forgot-password")
def forgot_password_post():
    email = (request.form.get("email") or "").strip().lower()
    if not email:
        flash("Please enter your email.")
        return redirect(url_for("auth.forgot_password"))

    try:
        supabase = current_app.config["SUPABASE_ADMIN"]
        supabase.auth.admin.generate_link(
            type="recovery",
            email=email,
            redirect_to=url_for("auth.reset_password_page", _external=True)
        )
        flash("Check your email for a reset link.")
    except Exception:
        current_app.logger.exception("password reset error")
        flash("We couldn’t start a reset. Try again in a moment.")

    return redirect(url_for("auth.forgot_password"))

@auth_bp.get("/reset-password")
def reset_password_page():
    return render_template("reset-password.html")

@auth_bp.post("/reset-password")
def reset_password_submit():
    # If finishing the reset on the server, verify token and set password here.
    return redirect(url_for("login"))
