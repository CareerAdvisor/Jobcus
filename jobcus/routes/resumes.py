# jobcus/routes/resumes.py
from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
try:
    from jobcus.services.limits import check_and_increment
    from jobcus.security.abuse_guard import allow_free_use
    from jobcus.services.resumes import run_analyzer  # the heavy lifting
except ImportError:
    from limits import check_and_increment
    from abuse_guard import allow_free_use
    from services.resumes import run_analyzer

resumes_bp = Blueprint("resumes", __name__)

@resumes_bp.post("/api/resume-analysis")
@login_required
def resume_analysis():
    try:
        supabase_admin = current_app.config["SUPABASE_ADMIN"]
        plan = (getattr(current_user, "plan", "free") or "free").lower()

        # Abuse guard (429)
        ok, guard = allow_free_use(request, user_id=current_user.id, plan=plan)
        if not ok:
            return jsonify(
                error="too_many_free_accounts",
                message=guard.get("message") or "You have reached the limit for the free version, upgrade to enjoy more features"
            ), 429

        # Quota (402) — use ONE key consistently across code + DB
        feature = "resume_analyzer"
        allowed, info = check_and_increment(supabase_admin, current_user.id, plan, feature)
        if not allowed:
            return jsonify(error="quota_exceeded", **info), 402

        data = request.get_json(silent=True) or {}
        result = run_analyzer(data)  # returns your final payload {score, analysis, ...}
        return jsonify(result), 200

    except Exception:
        current_app.logger.exception("Unhandled error in /api/resume-analysis")
        return jsonify(error="server_error", message="Analysis failed. Please try again."), 500
