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

@app.route("/ask", methods=["POST"])
def ask():
    user_msg = request.json.get("message")
    messages = [
        {
            "role": "system",
            "content": (
                "You are Jobcus, an AI-powered career advisor and assistant. Your role is to guide users with smart, supportive, and clear advice on career growth, job searching, CVs/resumes, interviews, workplace challenges, skill development, and education.\n\n"
                "Focus primarily on career-related topics. If a user asks something clearly outside this scope (like politics, entertainment gossip, or jokes), politely steer them back to career guidance.\n\n"
                "You're encouraged to be informative and helpful, especially when comparing roles, technologies, certifications, skills, or educational paths — even if the topic includes broader concepts like cybersecurity, internet security, or software tools — as long as it's relevant to career or professional development.\n\n"
                "When comparing concepts, feel free to use tables (Markdown or HTML) to present structured information clearly.\n\n"
                "If a user asks about job openings or where to apply, provide advice tailored to their background, and let them know that job links will appear automatically below your response.\n\n"
                "Avoid saying you're unable to help unless the topic is completely unrelated to jobs, careers, or learning. Be confident, professional, and warm at all times."
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
