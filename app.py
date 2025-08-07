# app.py

import os
import traceback
from io import BytesIO
from collections import Counter
import re, json, base64, logging
import requests  # ← for your fetch_* helpers

from flask import Flask, request, jsonify, render_template, redirect, session, flash
from flask_cors import CORS
from flask_login import LoginManager, login_user, logout_user, current_user, login_required, UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from postgrest.exceptions import APIError
from PyPDF2 import PdfReader
from supabase import create_client
from dotenv import load_dotenv
from openai import OpenAI
import docx

# --- Environment & app setup ---
load_dotenv()
app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "supersecret")
CORS(app)
logging.basicConfig(level=logging.INFO)

# --- OpenAI client ---
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

from flask_login import UserMixin

class User(UserMixin):
    def __init__(self, id, email, fullname, auth_id):
        self.id       = id        # your local BIGINT key
        self.email    = email
        self.fullname = fullname
        self.auth_id  = auth_id   # the Supabase Auth UUID

    @staticmethod
    def get_by_email(email):
        resp = supabase.table("users") \
                       .select("*") \
                       .eq("email", email) \
                       .single() \
                       .execute()
        data = resp.data or {}
        if not data:
            return None
        return User(
            id       = data["id"],
            email    = data["email"],
            fullname = data.get("fullname",""),
            auth_id  = data["auth_id"]
        )

    @staticmethod
    def get_by_auth_id(auth_id):
        resp = supabase.table("users") \
                       .select("*") \
                       .eq("auth_id", auth_id) \
                       .single() \
                       .execute()
        data = resp.data or {}
        if not data:
            return None
        return User(
            id       = data["id"],
            email    = data["email"],
            fullname = data.get("fullname",""),
            auth_id  = data["auth_id"]
        )
        
# --- Supabase client ---
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_KEY")
supabase = create_client(supabase_url, supabase_key)

# --- External API constants ---
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


# --- Helpers ---

def get_user_resume_text(user_id: str) -> str:
    """Fetch the latest stored resume text for a user from Supabase."""
    res = supabase.table("resumes")\
                  .select("text")\
                  .eq("user_id", user_id)\
                  .maybe_single()\
                  .execute()
    data = res.data
    return data.get("text") if data and "text" in data else None


# Job-search helpers for /jobs
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


# Analytics helpers
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


# --- Flask-Login setup ---
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'account'

class User(UserMixin):
    def __init__(self, user_id, email, password, fullname=None):
        self.id = user_id
        self.email = email
        self.password = password
        self.fullname = fullname

    @staticmethod
    def get_by_email(email: str):
        r = supabase.table("users")\
                     .select("*")\
                     .eq("email", email)\
                     .maybe_single()\
                     .execute()
        d = r.data
        return User(d["id"], d["email"], d["password"], d.get("fullname")) if d else None

@login_manager.user_loader
def load_user(user_id):
    """
    Flask-Login callback to reload the user object from the session user_id.
    Uses .limit(1) instead of .single() to avoid 406 errors.
    """
    try:
        # Ensure we have an integer ID for the filter
        uid = int(user_id)
    except (TypeError, ValueError):
        return None

    try:
        resp = (
            supabase
            .table("users")
            .select("*")
            .eq("id", uid)
            .limit(1)
            .execute()
        )
    except Exception:
        app.logger.exception("Error loading user from Supabase")
        return None

    rows = resp.data or []
    if not rows:
        return None

    row = rows[0]
    # Return your User model instance
    return User(
        id=row["id"],
        email=row["email"],
        fullname=row.get("fullname", ""),
        auth_id=row.get("auth_id")
    )

# -------- Routes --------

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/chat")
def chat():
    return render_template("chat.html")

@app.route("/resume-builder")
def resume_builder():
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

@app.route('/manifest.json')
def manifest():
    return app.send_static_file('manifest.json')

@app.route("/account", methods=["GET", "POST"])
def account():
    if request.method == "GET":
        mode = request.args.get("mode", "signup")
        return render_template("account.html", mode=mode)

    # ── POST ──
    try:
        data     = request.get_json(force=True) or {}
        mode     = data.get("mode")
        email    = data.get("email", "").strip().lower()
        password = data.get("password", "")
        name     = data.get("name", "").strip()

        if mode == "login":
            # 1) Delegate login to Supabase
            try:
                session = supabase.auth.sign_in({
                    "email":    email,
                    "password": password
                })
            except Exception as err:
                return jsonify(success=False, message=str(err)), 400

            # 2) Grab Supabase user ID
            ext_id = session.user.id

            # 3) Lookup your local user by auth_id
            user = User.get_by_auth_id(ext_id)
            if not user:
                return jsonify(success=False, message="No local profile found."), 404

            login_user(user)
            return jsonify(success=True, redirect="/dashboard"), 200

        elif mode == "signup":
            # 1) Create user in Supabase Auth
            try:
                resp = supabase.auth.sign_up({
                    "email":    email,
                    "password": password
                })
            except Exception as err:
                return jsonify(success=False, message=str(err)), 400

            # 2) Extract the new Supabase user
            new_user = resp.user if hasattr(resp, "user") else resp.get("data", {}).get("user")
            if not new_user:
                return jsonify(success=False, message="Sign-up failed."), 400

            ext_id = new_user.id

            # 3) Insert only auth_id, email, fullname locally
            supabase.table("users").insert({
                "auth_id":  ext_id,
                "email":    email,
                "fullname": name or email.split("@")[0]
            }).execute()

            # 4) Fetch & log in
            user = User.get_by_auth_id(ext_id)
            login_user(user)
            return jsonify(success=True, redirect="/dashboard"), 200

        else:
            return jsonify(success=False, message="Invalid mode"), 400

    except Exception:
        app.logger.exception("Error in /account POST")
        return jsonify(
            success=False,
            message="Server error. Please try again later."
        ), 500

@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html")

@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect("/")


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


# Job Insights APIs
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


# Skill Gap API
@app.route("/api/skill-gap", methods=["POST"])
def skill_gap_api():
    try:
        data = request.get_json()
        goal = data.get("goal", "").strip()
        skills = data.get("skills", "").strip()

        if not goal or not skills:
            return jsonify({"error": "Missing required input"}), 400

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a helpful AI assistant that performs skill gap analysis.\n"
                    "The user will provide their career goal and current skills.\n"
                    "Your job is to:\n"
                    "1. Identify the missing skills.\n"
                    "2. Suggest learning resources for each missing skill.\n"
                    "Format the result as a list of missing skills and a short learning plan."
                )
            },
            {
                "role": "user",
                "content": (
                    f"My goal is to become a {goal}. My current skills include: {skills}.\n"
                    "What skills am I missing, and how can I bridge the gap?"
                )
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
        print("Skill Gap Error:", e)
        traceback.print_exc()
        return jsonify({"error": "Server error"}), 500

# Interview Coach APIs
@app.route("/api/interview", methods=["POST"])
def interview_coach_api():
    try:
        data = request.get_json()
        role = data.get("role","").strip()
        exp  = data.get("experience","").strip()
        if not role or not exp:
            return jsonify(error="Missing role or experience"), 400

        msgs = [
            {"role":"system","content":(
                "You are an AI Interview Coach. Provide at least 3 Q&A samples."
            )},
            {"role":"user","content":f"Role: {role}. Experience: {exp}."}
        ]
        resp = client.chat.completions.create(model="gpt-4o", messages=msgs, temperature=0.7)
        return jsonify(result=resp.choices[0].message.content)
    except Exception as e:
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
            {"role":"system","content":(
                "You are a virtual interview coach. Ask one job-specific question."
            )},
            {"role":"user","content":f"Was {prev}, applying for {target}. Experience: {exp}."}
        ]
        resp = client.chat.completions.create(model="gpt-4o", messages=msgs, temperature=0.7)
        return jsonify(question=resp.choices[0].message.content)
    except Exception as e:
        logging.exception("Interview question error")
        return jsonify(error="Unable to generate question"), 500

@app.route("/api/interview/feedback", methods=["POST"])
def get_interview_feedback():
    try:
        data     = request.get_json()
        question = data.get("question","")
        answer   = data.get("answer","")
        msgs = [
            {"role":"system","content":(
                "You are an interview coach. Give feedback and 2–3 fallback suggestions."
            )},
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
    except Exception as e:
        logging.exception("Interview feedback error")
        return jsonify(error="Error generating feedback"), 500


# Resume Analysis API
@app.route("/api/resume-analysis", methods=["POST"])
def resume_analysis():
    data = request.get_json(force=True)
    resume_text = ""

    # PDF path
    if data.get("pdf"):
        pdf_bytes = base64.b64decode(data["pdf"])
        reader = PdfReader(BytesIO(pdf_bytes))
        resume_text = "\n".join(p.extract_text() or "" for p in reader.pages)

    # DOCX path
    elif data.get("docx"):
        docx_bytes = base64.b64decode(data["docx"])
        doc = docx.Document(BytesIO(docx_bytes))
        resume_text = "\n".join(p.text for p in doc.paragraphs)

    # Plain-text path
    elif data.get("text"):
        resume_text = data["text"].strip()

    else:
        return jsonify(error="No resume data provided"), 400

    if not resume_text:
        return jsonify(error="Could not extract any text"), 400

    # --- 2) Build your ATS prompt ---
    prompt = (
        "You are an ATS-certified resume analyzer.  Return **only** a JSON object:\n"
        "  • score: integer 0–100\n"
        "  • issues: array of strings\n"
        "  • strengths: array of strings\n"
        "  • suggestions: array of strings\n\n"
        f"Resume content:\n\n{resume_text}"
    )

    try:
        # --- 3) Call OpenAI ---
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0
        )
        content = resp.choices[0].message.content

        # --- 4) Strip code fences and isolate the JSON blob ---
        # remove any ```json or ``` wrappers
        content = re.sub(r"```(?:json)?", "", content).strip()

        # extract from first { to last }
        start = content.find("{")
        end   = content.rfind("}")
        if start != -1 and end != -1:
            content = content[start:end+1]

        # --- 5) Parse it!
        parsed = json.loads(content)

        # --- 6) Return the normalized shape ---
        return jsonify({
            "score":      int(parsed.get("score", 0)),
            "analysis": {
                "issues":     parsed.get("issues", []),
                "strengths":  parsed.get("strengths", [])
            },
            "suggestions": parsed.get("suggestions", [])
        })

    except json.JSONDecodeError:
        logging.exception("Failed to decode JSON from LLM output:\n%s", content)
        return jsonify(error="Invalid JSON from Analyzer"), 500

    except Exception:
        logging.exception("Resume analysis error")
        return jsonify(error="Resume analysis failed"), 500

# … your existing app and other imports …
@app.route("/api/optimize-resume", methods=["POST"])
def optimize_resume():
    data = request.get_json(force=True)
    resume_text = ""

    # 1) Extract text
    if data.get("pdf"):
        try:
            pdf_bytes   = base64.b64decode(data["pdf"])
            reader      = PdfReader(BytesIO(pdf_bytes))
            resume_text = "\n".join(p.extract_text() or "" for p in reader.pages)
            if not resume_text.strip():
                return jsonify({"error": "PDF content empty"}), 400
        except Exception:
            logging.exception("PDF Decode Error")
            return jsonify({"error": "Unable to extract PDF text"}), 400

    elif data.get("text"):
        resume_text = data["text"].strip()
        if not resume_text:
            return jsonify({"error": "No text provided"}), 400

    else:
        return jsonify({"error": "No resume data provided"}), 400

    # 2) Build the optimization prompt
    prompt = (
        "You are an expert ATS resume optimizer.  Rewrite the following resume to be\n"
        "fully ATS-compatible: use strong action verbs, consistent bullets, relevant\n"
        "keywords, fix grammar, remove repetition.  Return the optimized resume in plain text.\n\n"
        f"Original resume:\n\n{resume_text}"
    )

    try:
        # 3) Call OpenAI
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3
        )
        optimized = resp.choices[0].message.content.strip()
        # 4) Strip any ``` fences
        optimized = re.sub(r"```(?:[\s\S]*?)```", "", optimized).strip()
        return jsonify({"optimized": optimized})
    except Exception:
        logging.exception("Resume optimization error")
        return jsonify({"error": "Resume optimization failed"}), 500

# Generate Resume via AI
@app.route("/generate-resume", methods=["POST"])
def generate_resume():
    data = request.json or {}
    prompt = f"""
Create a professional, modern UK resume in HTML format:
Full Name: {data.get('fullName')}
Summary: {data.get('summary')}
Education: {data.get('education')}
Experience: {data.get('experience')}
Skills: {data.get('skills')}
Certifications: {data.get('certifications')}
Portfolio: {data.get('portfolio')}
"""
    try:
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role":"user","content":prompt}],
            temperature=0.7
        )
        return jsonify(formatted_resume=resp.choices[0].message.content)
    except Exception as e:
        return jsonify(error=str(e)), 500


# Employer inquiry endpoints
@app.route("/api/employer-inquiry", methods=["POST"])
def employer_inquiry():
    try:
        data = request.json
        supabase.table("employer_inquiries").insert({
            "company":    data.get("company"),
            "name":       data.get("name"),
            "email":      data.get("email"),
            "phone":      data.get("phone"),
            "job_roles":  data.get("job_roles"),
            "message":    data.get("message")
        }).execute()
        return jsonify(success=True, message="Inquiry submitted"), 200
    except Exception as e:
        logging.exception("Employer inquiry error")
        return jsonify(success=False, error=str(e)), 500

@app.route("/api/employer/submit", methods=["POST"])
def submit_employer_form():
    try:
        data = request.get_json()
        job_title          = data.get("jobTitle")
        company            = data.get("company")
        role_summary       = data.get("summary")
        location           = data.get("location")
        employmentType     = data.get("employmentType")
        salaryRange        = data.get("salaryRange")
        applicationDeadline= data.get("applicationDeadline")
        applicationEmail   = data.get("applicationEmail")

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
            messages=[{"role":"user","content":prompt}],
            temperature=0.6
        )
        job_desc = resp.choices[0].message.content

        # Optionally save
        try:
            supabase.table("job_posts").insert({
                "job_title": job_title,
                "company": company,
                "summary": role_summary,
                "location": location,
                "employment_type": employmentType,
                "salary_range": salaryRange,
                "application_deadline": applicationDeadline,
                "application_email": applicationEmail
            }).execute()
        except Exception as db_e:
            logging.warning("Job post save failed: %s", db_e)

        return jsonify(success=True, jobDescription=job_desc), 200

    except Exception as e:
        logging.exception("Employer submission error")
        return jsonify(success=False, message="Server error generating job post."), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
