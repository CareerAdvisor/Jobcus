# jobcus/routes/main.py
from flask import Blueprint, render_template
from flask_login import login_required

main_bp = Blueprint("main_pages", __name__)

@main_bp.get("/")
def index():
    return render_template("index.html")

@main_bp.get("/chat")
@login_required
def chat():
    # You can pass plan/model context from a helper, or render minimal:
    return render_template("chat.html")

@main_bp.get("/resume-analyzer")
def resume_analyzer_page():
    return render_template("resume-analyzer.html")

@main_bp.get("/resume-builder")
def resume_builder_page():
    return render_template("resume-builder.html")

@main_bp.get("/interview-coach")
def interview_coach_page():
    return render_template("interview-coach.html")

@main_bp.get("/skill-gap")
def skill_gap_page():
    return render_template("skill-gap.html")

@main_bp.get("/employers")
def employers_page():
    return render_template("employers.html")
