# jobcus/routes/interviews.py
from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
try:
    from jobcus.services.limits import check_and_increment
except ImportError:
    from limits import check_and_increment

interviews_bp = Blueprint("interviews", __name__)

@interviews_bp.post("/api/interview/question")
@login_required
def get_interview_question():
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    allowed, info = check_and_increment(current_app.config["SUPABASE_ADMIN"], current_user.id, plan, "interview_coach")
    if not allowed:
        return jsonify(error="quota_exceeded", **info), 402

    try:
        data = request.get_json(force=True)
        prev   = (data.get("previousRole") or "").strip()
        target = (data.get("targetRole") or "").strip()
        exp    = (data.get("experience") or "").strip()
        if not prev or not target or not exp:
            return jsonify(error="bad_request", message="Missing inputs"), 400

        client = current_app.config["OPENAI_CLIENT"]
        msgs = [
            {"role":"system","content":"You are a virtual interview coach. Ask one job-specific question."},
            {"role":"user","content":f"Was {prev}, applying for {target}. Experience: {exp}."}
        ]
        resp = client.chat.completions.create(model="gpt-4o", messages=msgs, temperature=0.7)
        return jsonify(question=resp.choices[0].message.content)
    except Exception:
        current_app.logger.exception("Interview question error")
        return jsonify(error="server_error", message="Unable to generate question"), 500

@interviews_bp.post("/api/interview/feedback")
@login_required
def get_interview_feedback():
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    allowed, info = check_and_increment(current_app.config["SUPABASE_ADMIN"], current_user.id, plan, "interview_coach")
    if not allowed:
        return jsonify(error="quota_exceeded", **info), 402

    try:
        data = request.get_json(force=True)
        question = data.get("question","")
        answer   = data.get("answer","")
        msgs = [
            {"role":"system","content":"You are an interview coach. Give feedback and 2–3 fallback suggestions."},
            {"role":"user","content":f"Q: {question}\nA: {answer}"}
        ]
        client = current_app.config["OPENAI_CLIENT"]
        resp = client.chat.completions.create(model="gpt-4o", messages=msgs, temperature=0.7)
        content = (resp.choices[0].message.content or "").strip()
        parts = content.split("Fallback Suggestions:")
        feedback = parts[0].strip()
        tips = parts[1].split("\n") if len(parts) > 1 else []
        return jsonify(
            feedback=feedback,
            fallbacks=[t.lstrip("-• ").strip() for t in tips if t.strip()]
        )
    except Exception:
        current_app.logger.exception("Interview feedback error")
        return jsonify(error="server_error", message="Error generating feedback"), 500
