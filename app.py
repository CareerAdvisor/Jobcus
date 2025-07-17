import os
import requests
import traceback
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from openai import OpenAI
from dotenv import load_dotenv
from collections import Counter

load_dotenv()

app = Flask(__name__)
CORS(app)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

REMOTIVE_API_URL = "https://remotive.com/api/remote-jobs"
ADZUNA_API_URL = "https://api.adzuna.com/v1/api/jobs"
ADZUNA_APP_ID = os.getenv("ADZUNA_APP_ID")
ADZUNA_APP_KEY = os.getenv("ADZUNA_APP_KEY")
JSEARCH_API_KEY = os.getenv("JSEARCH_API_KEY")
JSEARCH_API_HOST = os.getenv("JSEARCH_API_HOST")

# --- Job Role List ---
JOB_TITLES = [
    "Software Engineer", "Data Analyst", "Project Manager", "UX Designer", "Cybersecurity Analyst"
]

# Fetch Adzuna salary info for multiple titles
def fetch_salary_data():
    salary_data = []
    country = "gb"
    for title in JOB_TITLES:
        params = {
            "app_id": ADZUNA_APP_ID,
            "app_key": ADZUNA_APP_KEY,
            "what": title,
            "results_per_page": 1
        }
        try:
            response = requests.get(f"{ADZUNA_API_URL}/{country}/search/1", params=params)
            result = response.json().get("results", [])
            if result:
                avg = result[0].get("salary_is_predicted") == "1" and float(result[0].get("salary_min")) + float(result[0].get("salary_max")) / 2 or result[0].get("salary_average")
                salary_data.append(avg or 0)
            else:
                salary_data.append(0)
        except:
            salary_data.append(0)
    return salary_data

# Count jobs for each title using Remotive
def fetch_job_counts():
    counts = []
    for title in JOB_TITLES:
        try:
            res = requests.get(REMOTIVE_API_URL, params={"search": title})
            jobs = res.json().get("jobs", [])
            counts.append(len(jobs))
        except:
            counts.append(0)
    return counts

# Extract common skills from job descriptions
KEYWORDS = ["Python", "SQL", "Project Management", "UI/UX", "Cloud Security"]

def fetch_skill_trends():
    keyword_freq = Counter()
    try:
        res = requests.get(REMOTIVE_API_URL, params={"limit": 50})
        jobs = res.json().get("jobs", [])
        for job in jobs:
            text = (job.get("description") or "").lower()
            for key in KEYWORDS:
                if key.lower() in text:
                    keyword_freq[key] += 1
    except:
        pass
    return keyword_freq

# Top locations from Adzuna

def fetch_location_counts():
    location_counter = Counter()
    country = "gb"
    try:
        params = {
            "app_id": ADZUNA_APP_ID,
            "app_key": ADZUNA_APP_KEY,
            "results_per_page": 30
        }
        res = requests.get(f"{ADZUNA_API_URL}/{country}/search/1", params=params)
        results = res.json().get("results", [])
        for job in results:
            loc = job.get("location", {}).get("display_name")
            if loc:
                location_counter[loc] += 1
    except:
        pass
    return location_counter.most_common(5)

# ----------- ROUTES -----------

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/chat")
def chat():
    return render_template("chat.html")

@app.route("/resume-builder")
def resume_builder():
    return render_template("resume-builder.html")

@app.route("/career-paths")
def career_paths():
    return render_template("career-paths.html")

@app.route("/job-insights")
def job_insights():
    return render_template("job-insights.html")

@app.route("/skill-gap")
def skill_gap():
    return render_template("skill-gap.html")

@app.route("/interview-coach")
def interview_coach():
    return render_template("interview-coach.html")

@app.route("/resources")
def resources():
    return render_template("resources.html")

@app.route("/employers")
def employers():
    return render_template("employers.html")

@app.route("/ask", methods=["POST"])
def ask():
    user_msg = request.json.get("message")

    messages = [
        {"role": "system", "content": "You are Jobcus, a helpful and intelligent AI career assistant..."},
        {"role": "user", "content": user_msg}
    ]

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages
        )
        ai_msg = response.choices[0].message.content
        suggest_jobs = any(phrase in user_msg.lower() for phrase in ["find jobs", "apply for", "job search"])
        return jsonify({"reply": ai_msg, "suggestJobs": suggest_jobs})
    except Exception as e:
        return jsonify({"reply": f"⚠️ Server Error: {str(e)}", "suggestJobs": False})

@app.route("/jobs", methods=["POST"])
def get_jobs():
    try:
        data = request.json
        query = data.get("query", "")
        location = data.get("location", "")
        job_type = data.get("jobType", "").lower()

        remotive_jobs = []
        adzuna_jobs = []
        jsearch_jobs = []

        if job_type in ["remote", ""]:
            remotive_jobs = fetch_remotive_jobs(query)
        if job_type in ["onsite", "hybrid", ""]:
            adzuna_jobs = fetch_adzuna_jobs(query, location, job_type)
        if not remotive_jobs and not adzuna_jobs:
            jsearch_jobs = fetch_jsearch_jobs(query)

        return jsonify({"remotive": remotive_jobs, "adzuna": adzuna_jobs, "jsearch": jsearch_jobs})
    except Exception as e:
        return jsonify({"remotive": [], "adzuna": [], "jsearch": []})

# === JOB INSIGHTS API ENDPOINTS ===

@app.route("/api/salary")
def get_salary_data():
    salaries = fetch_salary_data()
    return jsonify({"labels": JOB_TITLES, "salaries": salaries})

@app.route("/api/job-count")
def get_job_count_data():
    counts = fetch_job_counts()
    return jsonify({"labels": JOB_TITLES, "counts": counts})

@app.route("/api/skills")
def get_skills_data():
    freq = fetch_skill_trends()
    return jsonify({
        "labels": list(freq.keys()),
        "frequency": list(freq.values())
    })

@app.route("/api/locations")
def get_location_data():
    locs = fetch_location_counts()
    return jsonify({
        "labels": [l[0] for l in locs],
        "counts": [l[1] for l in locs]
    })

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

@app.route("/api/interview", methods=["POST"])
def interview_coach_api():
    try:
        data = request.get_json()
        role = data.get("role", "").strip()
        experience = data.get("experience", "").strip()

        if not role or not experience:
            return jsonify({"error": "Missing role or experience"}), 400

        messages = [
            {
                "role": "system",
                "content": (
                    "You are an AI Interview Coach. Based on the user's target role and experience level, "
                    "you'll simulate likely interview questions and suggested responses.\n"
                    "Keep the tone supportive, informative, and prepare users with at least 3 Q&A samples."
                )
            },
            {
                "role": "user",
                "content": (
                    f"I am preparing for a job interview as a {role}. My experience level is {experience}.\n"
                    "Please help me practice by suggesting sample questions and how I might answer them."
                )
            }
        ]

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            temperature=0.7
        )

        reply = response.choices[0].message.content
        return jsonify({"result": reply})
    except Exception as e:
        print("Interview Coach Error:", e)
        traceback.print_exc()
        return jsonify({"error": "Server error"}), 500

@app.route("/api/interview/question", methods=["POST"])
def get_interview_question():
    try:
        data = request.get_json()
        previous_role = data.get("previousRole", "")
        target_role = data.get("targetRole", "")
        experience = data.get("experience", "")

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a professional interview coach. Generate a single, relevant interview question "
                    "based on the user's past experience, desired role, and experience level."
                )
            },
            {
                "role": "user",
                "content": (
                    f"My previous role was {previous_role}, I want to become a {target_role}, and my experience level is {experience}. "
                    "Give me an interview question to help me practice."
                )
            }
        ]

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages
        )

        question = response.choices[0].message.content.strip()
        return jsonify({"question": question})

    except Exception as e:
        print("Interview Question Error:", e)
        return jsonify({"error": "Error generating interview question"}), 500

@app.route("/api/interview/feedback", methods=["POST"])
def get_interview_feedback():
    try:
        data = request.get_json()
        question = data.get("question", "")
        answer = data.get("answer", "")

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a professional interview coach. Your job is to:\n"
                    "1. Give constructive feedback on the user's response.\n"
                    "2. Point out what was done well and what can be improved.\n"
                    "3. Offer 2-3 fallback suggestions in bullet points.\n"
                    "Format the response clearly."
                )
            },
            {
                "role": "user",
                "content": (
                    f"Interview Question: {question}\n"
                    f"My Answer: {answer}\n"
                    "Please give me feedback and fallback suggestions."
                )
            }
        ]

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages
        )

        reply = response.choices[0].message.content.strip()

        # Separate main feedback and tips if possible
        parts = reply.split("Fallback Suggestions:")
        feedback = parts[0].strip()
        tips = parts[1].strip().split("\n") if len(parts) > 1 else []

        return jsonify({
            "feedback": feedback,
            "fallbacks": [tip.lstrip("-• ").strip() for tip in tips if tip.strip()]
        })

    except Exception as e:
        print("Interview Feedback Error:", e)
        return jsonify({"error": "Error generating feedback"}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
