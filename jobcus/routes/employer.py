# jobcus/routes/employer.py
from flask import Blueprint, request, jsonify, current_app

employer_bp = Blueprint("employer", __name__)

@employer_bp.post("/api/employer-inquiry")
def employer_inquiry():
    try:
        supabase = current_app.config["SUPABASE"]
        data = request.get_json(force=True) or {}
        supabase.table("employer_inquiries").insert({
            "company":   data.get("company"),
            "name":      data.get("name"),
            "email":     data.get("email"),
            "phone":     data.get("phone"),
            "job_roles": data.get("job_roles"),
            "message":   data.get("message"),
        }).execute()
        return jsonify(success=True, message="Inquiry submitted"), 200
    except Exception as e:
        current_app.logger.exception("Employer inquiry error")
        return jsonify(success=False, error=str(e)), 500

@employer_bp.post("/api/employer/submit")
def submit_employer_form():
    try:
        client   = current_app.config["OPENAI_CLIENT"]
        supabase = current_app.config["SUPABASE"]

        data = request.get_json(force=True) or {}
        job_title           = data.get("jobTitle")
        company             = data.get("company")
        role_summary        = data.get("summary")
        location            = data.get("location")
        employmentType      = data.get("employmentType")
        salaryRange         = data.get("salaryRange")
        applicationDeadline = data.get("applicationDeadline")
        applicationEmail    = data.get("applicationEmail")

        if not job_title or not company:
            return jsonify(success=False, message="Job title and company are required."), 400

        prompt = f"""
You are a recruitment assistant. Generate a professional job description:

Job Title: {job_title}
Company: {company}
Location: {location}
Employment Type: {employmentType}
Salary Range: {salaryRange}
Application Deadline: {applicationDeadline}
Application Email/Link: {applicationEmail}
Summary: {role_summary}

Include: About the Company, Job Summary, Key Responsibilities,
Required Qualifications, Preferred Skills, and How to Apply.
"""

        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.6,
        )
        job_desc = resp.choices[0].message.content

        try:
            supabase.table("job_posts").insert({
                "job_title": job_title,
                "company": company,
                "summary": role_summary,
                "location": location,
                "employment_type": employmentType,
                "salary_range": salaryRange,
                "application_deadline": applicationDeadline,
                "application_email": applicationEmail,
            }).execute()
        except Exception as db_e:
            current_app.logger.warning("Job post save failed: %s", db_e)

        return jsonify(success=True, jobDescription=job_desc), 200

    except Exception:
        current_app.logger.exception("Employer submission error")
        return jsonify(success=False, message="Server error generating job post."), 500
