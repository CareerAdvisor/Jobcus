import os
import requests
import traceback
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from openai import OpenAI
from dotenv import load_dotenv

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

# Fetch Remotive jobs
def fetch_remotive_jobs(query):
    try:
        response = requests.get(REMOTIVE_API_URL, params={"search": query})
        jobs = response.json().get("jobs", [])
        return [{
            "title": job["title"],
            "company": job["company_name"],
            "location": job["candidate_required_location"],
            "url": job["url"]
        } for job in jobs[:5]]
    except Exception as e:
        print("Remotive error:", e)
        traceback.print_exc()
        return []

# Fetch Adzuna jobs
def fetch_adzuna_jobs(query, location="", job_type=""):
    try:
        country = "gb"
        params = {
            "app_id": ADZUNA_APP_ID,
            "app_key": ADZUNA_APP_KEY,
            "what": query,
            "where": location,
            "results_per_page": 5,
            "content-type": "application/json"
        }
        response = requests.get(f"{ADZUNA_API_URL}/{country}/search/1", params=params)
        results = response.json().get("results", [])
        return [{
            "title": job["title"],
            "company": job["company"].get("display_name"),
            "location": job["location"].get("display_name"),
            "url": job["redirect_url"]
        } for job in results]
    except Exception as e:
        print("Adzuna error:", e)
        traceback.print_exc()
        return []

# Fetch JSearch jobs
def fetch_jsearch_jobs(query):
    try:
        url = f"https://{JSEARCH_API_HOST}/search"
        headers = {
            "X-RapidAPI-Key": JSEARCH_API_KEY,
            "X-RapidAPI-Host": JSEARCH_API_HOST
        }
        params = {"query": query, "page": "1", "num_pages": "1"}
        response = requests.get(url, headers=headers, params=params)
        jobs = response.json().get("data", [])
        return [{
            "title": job.get("job_title"),
            "company": job.get("employer_name"),
            "location": job.get("job_city") or job.get("job_country", ""),
            "url": job.get("job_apply_link")
        } for job in jobs[:5]]
    except Exception as e:
        print("JSearch error:", e)
        traceback.print_exc()
        return []

# ---------- ROUTES -------------

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/chat")
def chat():
    return render_template("chat.html")

@app.route("/resume-builder")
def resume-builder():
    return render_template("resume-builder.html")

@app.route("/career-paths")
def career-paths():
    return render_template("career-paths.html")

@app.route("/job-insights")
def job-insights():
    return render_template("job-insights.html")

@app.route("/skill-gap")
def skill-gap():
    return render_template("skill-gap.html")

@app.route("/interview-coach")
def interview-coach():
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
        {
            "role": "system",
            "content": (         
                "You are Jobcus, a helpful and intelligent AI career assistant. Your job is to assist users with all career-related topics — including comparisons between job roles, certifications, tools, fields, and learning paths.\n\n"
                "Use tables (Markdown or HTML) whenever appropriate to make comparisons clearer. Do not ask the user to specify further unless their request is vague. If you understand the topic, go ahead and respond directly with helpful content.\n\n"
                "Stay focused on career, education, workplace, or skill development topics. Politely decline only when the request is completely unrelated to careers.\n\n"
                "If a user asks about job openings or where to apply, provide advice tailored to their background, and let them know that job links will appear automatically below your response.\n\n"
                "Be confident, structured, and professional. No need to over-explain your limitations."
                )
        },
        {"role": "user", "content": user_msg}
    ]

    
    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages
        )
        ai_msg = response.choices[0].message.content
        suggest_jobs = any(word in user_msg.lower() for word in [
            "job", "apply", "hiring", "vacancy", "openings", "position", "career", "role"
        ])
        return jsonify({"reply": ai_msg, "suggestJobs": suggest_jobs})
    except Exception as e:
        print("OpenAI API error:", e)
        traceback.print_exc()
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

        if job_type == "remote" or job_type == "":
            remotive_jobs = fetch_remotive_jobs(query)

        if job_type in ["onsite", "hybrid", ""]:
            adzuna_jobs = fetch_adzuna_jobs(query, location, job_type)

        if not remotive_jobs and not adzuna_jobs:
            jsearch_jobs = fetch_jsearch_jobs(query)

        return jsonify({
            "remotive": remotive_jobs,
            "adzuna": adzuna_jobs,
            "jsearch": jsearch_jobs
        })
    except Exception as e:
        print("/jobs route error:", e)
        traceback.print_exc()
        return jsonify({"remotive": [], "adzuna": [], "jsearch": []})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
