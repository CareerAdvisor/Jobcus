import os
import requests
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from openai import OpenAI
from dotenv import load_dotenv

app = Flask(__name__)
CORS(app)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

REMOTIVE_API_URL = "https://remotive.io/api/remote-jobs"
ADZUNA_API_URL = "https://api.adzuna.com/v1/api/jobs"
ADZUNA_APP_ID = os.getenv("ADZUNA_APP_ID")  # Secure way to manage keys
ADZUNA_APP_KEY = os.getenv("ADZUNA_APP_KEY")

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

def fetch_adzuna_jobs(query, location):
    try:
        country = "gb"  # Modify if you want to detect country dynamically
        response = requests.get(f"{ADZUNA_API_URL}/{country}/search/1", params={
            "app_id": ADZUNA_APP_ID,
            "app_key": ADZUNA_APP_KEY,
            "what": query,
            "where": location,
            "results_per_page": 5,
            "content-type": "application/json"
        })
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

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/ask", methods=["POST"])
def ask():
    user_msg = request.json.get("message")
    messages = [
        {"role": "system", "content": (
            "You are Jobcus, an AI-powered career advisor. Be helpful, smart, and friendly. "
            "Guide job seekers based on their skills, experience, and goals."
        )},
        {"role": "user", "content": user_msg}
    ]

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages
        )
        ai_msg = response.choices[0].message.content
        return jsonify({"reply": ai_msg})
    except Exception as e:
        return jsonify({"reply": f"⚠️ Server Error: {str(e)}"})

@app.route("/jobs", methods=["POST"])
def get_jobs():
    data = request.json
    query = data.get("query", "")
    location = data.get("location", "")
    job_type = data.get("jobType", "").lower()

    remotive_jobs = get_remotive_jobs(query) if job_type == "remote" or job_type == "" else []
    adzuna_jobs = get_adzuna_jobs(query, location, job_type) if job_type in ["onsite", "hybrid", ""] else []

    remotive_jobs = fetch_remotive_jobs(query)
    adzuna_jobs = fetch_adzuna_jobs(query, location)

    return jsonify({"remotive": remotive_jobs, "adzuna": adzuna_jobs})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
