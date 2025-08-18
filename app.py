import os
import traceback
from io import BytesIO
from collections import Counter
import re, json, base64, logging, requests

from flask import (
    Flask, request, jsonify, render_template, redirect,
    session, flash, url_for, current_app
)
from flask_cors import CORS
from flask_login import (
    login_user, logout_user, current_user,
    login_required, UserMixin
)
from gotrue.errors import AuthApiError
from dotenv import load_dotenv

# Local modules
from extensions import login_manager, init_supabase, init_openai
from blueprints.resumes import resumes_bp  # <-- your blueprint with all resume endpoints
import logging
from typing import Optional  # if you're on Python <3.10

# --- Environment & app setup ---
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "supersecret")

# Session cookie hardening
app.config.update(
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_SAMESITE="Lax",
)

CORS(app)
logging.basicConfig(level=logging.INFO)

# --- External clients (shared via app.config so blueprints can access) ---
app.config["SUPABASE"] = init_supabase()
app.config["OPENAI_CLIENT"] = init_openai()

# Short aliases if you want to use them in this file
supabase = app.config["SUPABASE"]
client   = app.config["OPENAI_CLIENT"]

# --- Flask-Login init ---
login_manager.init_app(app)
login_manager.login_view = "account"

# --- Constants for Job Insights ---
REMOTIVE_API_URL = "https://remotive.com/api/remote-jobs"
ADZUNA_API_URL   = "https://api.adzuna.com/v1/api/jobs"
ADZUNA_APP_ID    = os.getenv("ADZUNA_APP_ID")
ADZUNA_APP_KEY   = os.getenv("ADZUNA_APP_KEY")
JSEARCH_API_KEY  = os.getenv("JSEARCH_API_KEY")
JSEARCH_API_HOST = os.getenv("JSEARCH_API_HOST")

JOB_TITLES = [
    "Software Engineer", "Data Analyst",
    "Project Manager", "UX Designer", "Cybersecurity Analyst"
]
KEYWORDS = ["Python", "SQL", "Project Management", "UI/UX", "Cloud Security"]

# --- User model ---
class User(UserMixin):
    def __init__(self, auth_id: str, email: str, fullname: str | None = None):
        self.id = auth_id
        self.email = email
        self.fullname = fullname

@login_manager.user_loader
def load_user(user_id: "Optional[str]"):
    if not user_id or user_id == "None":
        return None

    supabase = current_app.config.get("SUPABASE")
    if supabase is None:
        logging.warning("load_user: supabase client is not initialized")
        return None

    try:
        resp = (
            supabase.table("users")
            .select("auth_id,email,fullname")
            .eq("auth_id", user_id)
            .limit(1)
            .execute()
        )

        data = getattr(resp, "data", None) if resp is not None else None
        if not data:
            return None

        row = data[0] if isinstance(data, list) else data
        if not row:
            return None

        return User(
            auth_id=row.get("auth_id"),
            email=row.get("email"),
            fullname=row.get("fullname"),
        )
    except Exception:
        logging.exception("load_user: failed to restore user")
        return None


def get_user_resume_text(user_id: str) -> Optional[str]:
    """Fetch the latest stored resume text for a user from Supabase."""
    try:
        supabase = current_app.config.get("SUPABASE")
        if supabase is None:
            current_app.logger.warning("get_user_resume_text: supabase client is not initialized")
            return None

        resp = (
            supabase.table("resumes")
            .select("text,created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

        data = getattr(resp, "data", None) if resp is not None else None
        if not data:
            return None

        row = data[0] if isinstance(data, list) else data
        return row.get("text") if row else None
    except Exception:
        current_app.logger.exception("get_user_resume_text error")
        return None
        
def fetch_remotive_jobs(query: str):
    try:
        r = requests.get(REMOTIVE_API_URL, params={"search": query})
        jobs = r.json().get("jobs", [])
        return [
            {
                "id": job.get("id"),
                "title": job.get("title"),
                "company_name": job.get("company_name"),
                "location": job.get("candidate_required_location"),
                "url": job.get("url")
            }
            for job in jobs
        ]
    except:
        return []

def fetch_adzuna_jobs(query: str, location: str, job_type: str):
    country = "gb"
    params = {
        "app_id": ADZUNA_APP_ID,
        "app_key": ADZUNA_APP_KEY,
        "what": query,
        "where": location,
        "results_per_page": 10
    }
    try:
        r = requests.get(f"{ADZUNA_API_URL}/{country}/search/1", params=params)
        results = r.json().get("results", [])
        return [
            {
                "id": job.get("id"),
                "title": job.get("title"),
                "company": job.get("company", {}).get("display_name"),
                "location": job.get("location", {}).get("display_name"),
                "url": job.get("redirect_url")
            }
            for job in results
        ]
    except:
        return []

def fetch_jsearch_jobs(query: str):
    url = "https://jsearch.p.rapidapi.com/search"
    headers = {
        "X-RapidAPI-Key": JSEARCH_API_KEY,
        "X-RapidAPI-Host": JSEARCH_API_HOST
    }
    params = {"query": query, "num_pages": 1}
    try:
        r = requests.get(url, headers=headers, params=params)
        data = r.json().get("data", [])
        return [
            {
                "id": job.get("job_id"),
                "title": job.get("job_title"),
                "company": job.get("employer_name"),
                "location": job.get("job_city"),
                "url": job.get("job_apply_link")
            }
            for job in data
        ]
    except:
        return []

def fetch_salary_data():
    data = []
    country = "gb"
    for title in JOB_TITLES:
        params = {
            "app_id": ADZUNA_APP_ID,
            "app_key": ADZUNA_APP_KEY,
            "what": title,
            "results_per_page": 1
        }
        try:
            r = requests.get(f"{ADZUNA_API_URL}/{country}/search/1", params=params)
            results = r.json().get("results", [])
            if results:
                job = results[0]
                low = float(job.get("salary_min", 0))
                high = float(job.get("salary_max", 0))
                data.append(((low + high) / 2) or 0)
            else:
                data.append(0)
        except:
            data.append(0)
    return data

def fetch_job_counts():
    counts = []
    for title in JOB_TITLES:
        try:
            r = requests.get(REMOTIVE_API_URL, params={"search": title})
            counts.append(len(r.json().get("jobs", [])))
        except:
            counts.append(0)
    return counts

def fetch_skill_trends():
    freq = Counter()
    try:
        r = requests.get(REMOTIVE_API_URL, params={"limit": 50})
        for job in r.json().get("jobs", []):
            text = (job.get("description") or "").lower()
            for key in KEYWORDS:
                if key.lower() in text:
                    freq[key] += 1
    except:
        pass
    return freq

def fetch_location_counts():
    freq = Counter()
    country = "gb"
    try:
        r = requests.get(f"{ADZUNA_API_URL}/{country}/search/1", params={
            "app_id": ADZUNA_APP_ID,
            "app_key": ADZUNA_APP_KEY,
            "results_per_page": 30
        })
        for job in r.json().get("results", []):
            loc = job.get("location", {}).get("display_name")
            if loc:
                freq[loc] += 1
    except:
        pass
    return freq.most_common(5)

# -------- Basic pages --------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/chat")
def chat():
    return render_template("chat.html")

@app.get("/resume-analyzer")
def page_resume_analyzer():
    return render_template("resume-analyzer.html")

@app.get("/resume-builder")
def page_resume_builder():
    return render_template("resume-builder.html")

@app.route("/interview-coach")
def interview_coach():
    return render_template("interview-coach.html")

@app.route("/skill-gap")
def skill_gap():
    return render_template("skill-gap.html")

@app.route("/job-insights")
def job_insights():
    return render_template("job-insights.html")

@app.route("/employers")
def employers():
    return render_template("employers.html")

@app.route("/price")
def price():
    return render_template("price.html")

@app.route("/faq")
def faq():
    return render_template("faq.html")

@app.route('/privacy-policy')
def privacy_policy():
    return render_template("privacy-policy.html")

@app.route('/terms-of-service')
def terms_of_service():
    return render_template('terms-of-service.html')

@app.route('/cover-letter')
def cover_letter():
    # Always provide defaults so the template can't blow up
    return render_template(
        "cover-letter.html",
        letter_only=False,   # make explicit
        sender={}, recipient={}, draft=""
    )
        
# ----------------------------
# Email confirmation
# ----------------------------
@app.get("/check-email")
def check_email():
    email = session.get("pending_email")  # set this during signup
    return render_template("check-email.html", email=email)

from flask import request, session, redirect, url_for, flash, current_app

@app.route("/resend-confirmation", methods=["GET"])
def resend_confirmation():
    """
    Resend email confirmation for a user.
    Looks for ?email=... first; falls back to session['pending_email'].
    Redirects back to /check-email with a flash message.
    """
    email = (request.args.get("email") or session.get("pending_email") or "").strip().lower()
    if not email:
        flash("We couldn’t find an email address to resend to.", "error")
        return redirect(url_for("check_email"))

    try:
        # Supabase Python SDK v2: resend a signup confirmation
        # If your SDK signature differs, adjust the call accordingly.
        supabase.auth.resend({"type": "signup", "email": email})

        flash("Confirmation email resent. Please check your inbox.", "success")
    except Exception:
        current_app.logger.exception("Resend confirmation failed")
        flash("Sorry, we couldn’t resend the email right now. Please try again later.", "error")

    return redirect(url_for("check_email"))

@app.route("/confirm")
def confirm_page():
    return render_template("confirm.html")

# ----------------------------
# Account routes (signup/login)
# ----------------------------
@app.route("/account", methods=["GET", "POST"])
def account():
    if request.method == "GET":
        mode = request.args.get("mode", "signup")
        return render_template("account.html", mode=mode)

    data = request.get_json(force=True)
    mode = (data.get("mode") or "").lower()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    name = (data.get("name") or "").strip()

    if not email or not password:
        return jsonify(success=False, message="Email and password are required."), 400

    if mode == "signup":
        try:
            resp = supabase.auth.sign_up({"email": email, "password": password})
            user = resp.user
            if not user:
                return jsonify(success=False, message="Signup failed."), 400

            ud = user.model_dump() if hasattr(user, "model_dump") else user
            auth_id = ud["id"]

            try:
                supabase.table("users").insert({
                    "auth_id": auth_id, "email": email, "fullname": name
                }).execute()
            except Exception:
                pass

            # ⬇️ NEW: remember email for the /check-email page
            if not ud.get("email_confirmed_at"):
                session["pending_email"] = email
                return jsonify(success=True, redirect=url_for("check_email")), 200

            login_user(User(auth_id=auth_id, email=email, fullname=name))
            return jsonify(success=True, redirect=url_for("dashboard")), 200

        except AuthApiError as e:
            msg = str(e).lower()
            if "already registered" in msg:
                return jsonify(
                    success=False,
                    code="user_exists",
                    message="Account already exists. Please log in."
                ), 409
            return jsonify(success=False, message="Signup failed."), 400

    elif mode == "login":
        try:
            resp = supabase.auth.sign_in_with_password({"email": email, "password": password})
            user = resp.user
            if not user:
                return jsonify(success=False, message="Invalid login credentials."), 400

            ud = user.model_dump() if hasattr(user, "model_dump") else user
            auth_id = ud["id"]

            try:
                r = supabase.table("users").select("fullname").eq("auth_id", auth_id).single().execute()
                fullname = (r.data or {}).get("fullname")
            except Exception:
                fullname = None

            login_user(User(auth_id=auth_id, email=email, fullname=fullname))
            return jsonify(success=True, redirect=url_for("dashboard")), 200

        except AuthApiError as e:
            msg = str(e).lower()
            if "email not confirmed" in msg or "not confirmed" in msg:
                # Optionally remember email here too
                session["pending_email"] = email
                return jsonify(
                    success=False,
                    code="email_not_confirmed",
                    message="Please confirm your email to continue.",
                    redirect=url_for("check_email")
                ), 403
            if "invalid login credentials" in msg:
                return jsonify(success=False, message="Invalid email or password."), 401
            return jsonify(success=False, message="Login failed."), 400

    return jsonify(success=False, message="Unknown mode."), 400

# ----------------------------
# Logout / Dashboard
# ----------------------------
@app.route("/logout")
@login_required
def logout():
    try:
        try:
            supabase.auth.sign_out()
        except Exception:
            pass
        logout_user()
    finally:
        return redirect(url_for("account"))

@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("dashboard.html")

@app.route("/verify_token", methods=["POST"])
def verify_token():
    data = request.get_json(force=True)
    access_token = data.get("access_token")
    if not access_token:
        return jsonify(ok=False, error="Missing access_token"), 400

    try:
        user_resp = supabase.auth.get_user(access_token)
        user_obj = user_resp.user if hasattr(user_resp, "user") else user_resp
        user_data = user_obj.model_dump() if hasattr(user_obj, "model_dump") else user_obj
        auth_id = user_data["id"]
        email = user_data.get("email")

        try:
            row = supabase.table("users").select("auth_id").eq("auth_id", auth_id).maybe_single().execute()
            if not row.data:
                supabase.table("users").insert({"auth_id": auth_id, "email": email}).execute()
        except Exception as e:
            print("users upsert warn:", e)

        login_user(User(auth_id=auth_id, email=email))
        return jsonify(ok=True)
    except Exception as e:
        print("verify_token error:", e)
        return jsonify(ok=False, error="Token verification failed"), 400

# ----------------------------
# Chat & Jobs & Insights
# ----------------------------
@app.route("/ask", methods=["POST"])
def ask():
    user_msg = request.json.get("message", "")
    msgs = [
        {"role": "system", "content": "You are Jobcus, a helpful and intelligent AI career assistant."},
        {"role": "user",   "content": user_msg}
    ]
    try:
        resp = client.chat.completions.create(model="gpt-4o", messages=msgs)
        ai_msg = resp.choices[0].message.content
        suggest = any(phrase in user_msg.lower() for phrase in ["find jobs","apply for","job search"])
        return jsonify(reply=ai_msg, suggestJobs=suggest)
    except Exception as e:
        return jsonify(reply=f"⚠️ Server Error: {str(e)}", suggestJobs=False)

@app.route("/jobs", methods=["POST"])
def get_jobs():
    try:
        data     = request.json
        query    = data.get("query","")
        location = data.get("location","")
        jtype    = data.get("jobType","").lower()

        rem = fetch_remotive_jobs(query) if jtype in ["remote",""] else []
        adz = fetch_adzuna_jobs(query, location, jtype) if jtype in ["onsite","hybrid",""] else []
        js  = [] if rem or adz else fetch_jsearch_jobs(query)

        return jsonify(remotive=rem, adzuna=adz, jsearch=js)
    except:
        return jsonify(remotive=[], adzuna=[], jsearch=[])

@app.route("/api/salary")
def get_salary_data():
    return jsonify(labels=JOB_TITLES, salaries=fetch_salary_data())

@app.route("/api/job-count")
def get_job_count_data():
    return jsonify(labels=JOB_TITLES, counts=fetch_job_counts())

@app.route("/api/skills")
def get_skills_data():
    freq = fetch_skill_trends()
    return jsonify(labels=list(freq.keys()), frequency=list(freq.values()))

@app.route("/api/locations")
def get_location_data():
    locs = fetch_location_counts()
    return jsonify(labels=[l[0] for l in locs], counts=[l[1] for l in locs])

# ----------------------------
# Skill Gap & Interview Coach
# ----------------------------
@app.route("/api/skill-gap", methods=["POST"])
def skill_gap_api():
    try:
        data = request.get_json()
        goal = data.get("goal", "").strip()
        skills = data.get("skills", "").strip()

        if not goal or not skills:
            return jsonify({"error": "Missing required input"}), 400

        messages = [
            {"role": "system", "content":
                "You are a helpful AI assistant that performs skill gap analysis.\n"
                "The user will provide their career goal and current skills.\n"
                "Your job is to:\n"
                "1. Identify the missing skills.\n"
                "2. Suggest learning resources for each missing skill.\n"
                "Format the result as a list of missing skills and a short learning plan."
            },
            {"role": "user", "content":
                f"My goal is to become a {goal}. My current skills include: {skills}.\n"
                "What skills am I missing, and how can I bridge the gap?"
            }
        ]

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            temperature=0.6
        )
        reply = response.choices[0].message.content
        return jsonify({"result": reply})

    except Exception as e:
        logging.exception("Skill Gap Error")
        return jsonify({"error": "Server error"}), 500

@app.route("/api/interview", methods=["POST"])
def interview_coach_api():
    try:
        data = request.get_json()
        role = data.get("role","").strip()
        exp  = data.get("experience","").strip()
        if not role or not exp:
            return jsonify(error="Missing role or experience"), 400

        msgs = [
            {"role":"system","content":"You are an AI Interview Coach. Provide at least 3 Q&A samples."},
            {"role":"user","content":f"Role: {role}. Experience: {exp}."}
        ]
        resp = client.chat.completions.create(model="gpt-4o", messages=msgs, temperature=0.7)
        return jsonify(result=resp.choices[0].message.content)
    except Exception:
        logging.exception("Interview coach error")
        return jsonify(error="Server error"), 500

@app.route("/api/interview/question", methods=["POST"])
def get_interview_question():
    try:
        data     = request.get_json()
        prev     = data.get("previousRole","").strip()
        target   = data.get("targetRole","").strip()
        exp      = data.get("experience","").strip()
        if not prev or not target or not exp:
            return jsonify(error="Missing inputs"), 400

        msgs = [
            {"role":"system","content":"You are a virtual interview coach. Ask one job-specific question."},
            {"role":"user","content":f"Was {prev}, applying for {target}. Experience: {exp}."}
        ]
        resp = client.chat.completions.create(model="gpt-4o", messages=msgs, temperature=0.7)
        return jsonify(question=resp.choices[0].message.content)
    except Exception:
        logging.exception("Interview question error")
        return jsonify(error="Unable to generate question"), 500

@app.route("/api/interview/feedback", methods=["POST"])
def get_interview_feedback():
    try:
        data     = request.get_json()
        question = data.get("question","")
        answer   = data.get("answer","")
        msgs = [
            {"role":"system","content":"You are an interview coach. Give feedback and 2–3 fallback suggestions."},
            {"role":"user","content":f"Q: {question}\nA: {answer}"}
        ]
        resp = client.chat.completions.create(model="gpt-4o", messages=msgs, temperature=0.7)
        content = resp.choices[0].message.content.strip()
        parts = content.split("Fallback Suggestions:")
        feedback = parts[0].strip()
        tips = parts[1].split("\n") if len(parts) > 1 else []
        return jsonify(
            feedback=feedback,
            fallbacks=[t.lstrip("-• ").strip() for t in tips if t.strip()]
        )
    except Exception:
        logging.exception("Interview feedback error")
        return jsonify(error="Error generating feedback"), 500

# --- Register the resume blueprint last (after app/config exists) ---
app.register_blueprint(resumes_bp)

# ---- Employer inquiry endpoints ----

@app.post("/api/employer-inquiry")
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


@app.post("/api/employer/submit")
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

        # Optional: persist in DB
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

# --- Entrypoint ---
if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
