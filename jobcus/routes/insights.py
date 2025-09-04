from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from ..services.insights import (
    JOB_TITLES, fetch_remotive_jobs, fetch_adzuna_jobs, fetch_jsearch_jobs,
    fetch_salary_data, fetch_job_counts, fetch_skill_trends, fetch_location_counts
)
from ..services.limits import job_insights_level  # you already have this

insights_bp = Blueprint("insights", __name__)

@insights_bp.post("/jobs")
def get_jobs():
    try:
        data     = request.get_json(silent=True) or {}
        query    = data.get("query","")
        location = data.get("location","")
        jtype    = (data.get("jobType") or "").lower()

        rem = fetch_remotive_jobs(query) if jtype in ("remote","") else []
        adz = fetch_adzuna_jobs(query, location, jtype) if jtype in ("onsite","hybrid","") else []
        js  = [] if (rem or adz) else fetch_jsearch_jobs(query)

        return jsonify(remotive=rem, adzuna=adz, jsearch=js)
    except Exception:
        return jsonify(remotive=[], adzuna=[], jsearch=[])

@insights_bp.get("/api/salary")
def get_salary():
    return jsonify(labels=JOB_TITLES, salaries=fetch_salary_data())

@insights_bp.get("/api/job-count")
@login_required
def get_job_count():
    level = job_insights_level(getattr(current_user, "plan", "free"))
    labels = JOB_TITLES
    counts = fetch_job_counts()
    if level == "basic":
        labels, counts = labels[:3], counts[:3]
    return jsonify(labels=labels, counts=counts)

@insights_bp.get("/api/skills")
def get_skills():
    freq = fetch_skill_trends()
    return jsonify(labels=list(freq.keys()), frequency=list(freq.values()))

@insights_bp.get("/api/locations")
def get_locations():
    locs = fetch_location_counts()
    return jsonify(labels=[l for l,_ in locs], counts=[c for _,c in locs])
