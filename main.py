import os
import requests
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
CORS(app)

# Initialize OpenAI client
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Constants
REMOTIVE_API_URL = "https://remotive.com/api/remote-jobs"
ADZUNA_API_URL = "https://api.adzuna.com/v1/api/jobs"
ADZUNA_APP_ID = os.getenv("ADZUNA_APP_ID")
ADZUNA_APP_KEY = os.getenv("ADZUNA_APP_KEY")
JSEARCH_API_KEY = os.getenv("JSEARCH_API_KEY")
JSEARCH_API_HOST = os.getenv("JSEARCH_API_HOST")

# Fetch jobs from Remotive

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
        return []

# Fetch jobs from Adzuna

def fetch_adzuna_jobs(query, location="", job_type=""):
    try:
        country = "gb"  # Set your target country code
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
        return []
# Fetch jobs from JSearch (RapidAPI)
def fetch_jsearch_jobs(query):
    try:
        url = f"https://{JSEARCH_API_HOST}/search"
        headers = {
            "X-RapidAPI-Key": JSEARCH_API_KEY,
            "X-RapidAPI-Host": JSEARCH_API_HOST
        }
        params = {
            "query": query,
            "page": "1",
            "num_pages": "1"
        }
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
        return []
        
# Home route
@app.route("/")
def index():
    return render_template("index.html")

# Handle AI chat
@app.route("/ask", methods=["POST"])
def ask():
    user_msg = request.json.get("message")
    messages = [
        {
            "role": "system",
            "content": (
                "You are Jobcus, an AI-powered career advisor and assistant. Your job is to guide users with smart, friendly, and clear career advice. "
                "You are allowed to reference external job listings, because the Jobcus platform automatically fetches them from APIs like Adzuna and Remotive. "
                "If a user asks about job openings or where to apply, respond with helpful guidance based on their background, and then clearly inform them that job links will appear below your message. "
                "Do not say you cannot provide links — Jobcus will display them after your reply. Be confident, supportive, and practical."
            )
        },
        {
            "role": "user",
            "content": user_msg
        }
    ]

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages
        )
        ai_msg = response.choices[0].message.content

        # ✅ Optional: add job relevance detection logic
        job_keywords = ["job", "apply", "hiring", "vacancy", "openings", "position", "career", "role"]
        lower_msg = user_msg.lower()
        suggest_jobs = any(keyword in lower_msg for keyword in job_keywords)

        return jsonify({
            "reply": ai_msg,
            "suggestJobs": suggest_jobs
        })

    except Exception as e:
        return jsonify({
            "reply": f"⚠️ Server Error: {str(e)}",
            "suggestJobs": False
        })


# Jobs API
@app.route("/jobs", methods=["POST"])
def get_jobs():
    data = request.json
    query = data.get("query", "")
    location = data.get("location", "")
    job_type = data.get("jobType", "").lower()

    remotive_jobs = []
    adzuna_jobs = []

    if job_type == "remote" or job_type == "":
        remotive_jobs = fetch_remotive_jobs(query)

    if job_type in ["onsite", "hybrid", ""]:
        adzuna_jobs = fetch_adzuna_jobs(query, location, job_type)

    return jsonify({"remotive": remotive_jobs, "adzuna": adzuna_jobs})

    if __name__ == "__main__":
        port = int(os.environ.get("PORT", 5000))
        app.run(host="0.0.0.0", port=port)
