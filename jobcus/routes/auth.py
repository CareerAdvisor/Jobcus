from flask import Blueprint, request, jsonify, render_template, redirect, session, url_for, flash, current_app
from flask_login import login_user, logout_user, login_required
from supabase import Client
from gotrue.errors import AuthApiError

auth_bp = Blueprint("auth", __name__)

@auth_bp.before_app_first_request
def setup_supabase():
    global supabase
    supabase = current_app.config.get("SUPABASE_ADMIN")

@auth_bp.route("/account", methods=["GET", "POST"])
def account():
    mode = request.args.get("mode", "login")
    return render_template("account.html", mode=mode)

@auth_bp.get("/forgot-password")
def forgot_password():
    return render_template("forgot-password.html")

@auth_bp.post("/forgot-password")
def forgot_password_post():
    email = (request.form.get("email") or "").strip().lower()
    if not email:
        flash("Please enter your email.")
        return redirect(url_for("auth.forgot_password"))

    sb = current_app.config.get("SUPABASE_ADMIN")
    try:
        sb.auth.admin.generate_link(
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
    return redirect(url_for("login"))
