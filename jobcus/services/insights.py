import os, requests
from collections import Counter

REMOTIVE_API_URL = "https://remotive.com/api/remote-jobs"
ADZUNA_API_URL   = "https://api.adzuna.com/v1/api/jobs"
ADZUNA_APP_ID    = os.getenv("ADZUNA_APP_ID")
ADZUNA_APP_KEY   = os.getenv("ADZUNA_APP_KEY")
JSEARCH_API_KEY  = os.getenv("JSEARCH_API_KEY")
JSEARCH_API_HOST = os.getenv("JSEARCH_API_HOST")

DEFAULT_HTTP_TIMEOUT = (5, 15)  # connect, read

JOB_TITLES = ["Software Engineer","Data Analyst","Project Manager","UX Designer","Cybersecurity Analyst"]
KEYWORDS   = ["Python","SQL","Project Management","UI/UX","Cloud Security"]

def fetch_remotive_jobs(query: str):
    try:
        r = requests.get(REMOTIVE_API_URL, params={"search": query}, timeout=DEFAULT_HTTP_TIMEOUT)
        jobs = r.json().get("jobs", [])
        return [{
            "id": j.get("id"),
            "title": j.get("title"),
            "company_name": j.get("company_name"),
            "location": j.get("candidate_required_location"),
            "url": j.get("url")
        } for j in jobs]
    except Exception:
        return []

def fetch_adzuna_jobs(query: str, location: str, job_type: str):
    country = "gb"
    params = {"app_id": ADZUNA_APP_ID, "app_key": ADZUNA_APP_KEY, "what": query, "where": location, "results_per_page": 10}
    try:
        r = requests.get(f"{ADZUNA_API_URL}/{country}/search/1", params=params, timeout=DEFAULT_HTTP_TIMEOUT)
        results = r.json().get("results", [])
        return [{
            "id": j.get("id"),
            "title": j.get("title"),
            "company": (j.get("company") or {}).get("display_name"),
            "location": (j.get("location") or {}).get("display_name"),
            "url": j.get("redirect_url")
        } for j in results]
    except Exception:
        return []

def fetch_jsearch_jobs(query: str):
    url = "https://jsearch.p.rapidapi.com/search"
    headers = {"X-RapidAPI-Key": JSEARCH_API_KEY or "", "X-RapidAPI-Host": JSEARCH_API_HOST or ""}
    params = {"query": query, "num_pages": 1}
    try:
        r = requests.get(url, headers=headers, params=params, timeout=DEFAULT_HTTP_TIMEOUT)
        data = r.json().get("data", [])
        return [{
            "id": j.get("job_id"),
            "title": j.get("job_title"),
            "company": j.get("employer_name"),
            "location": j.get("job_city"),
            "url": j.get("job_apply_link")
        } for j in data]
    except Exception:
        return []

def fetch_salary_data():
    data, country = [], "gb"
    for title in JOB_TITLES:
        params = {"app_id": ADZUNA_APP_ID, "app_key": ADZUNA_APP_KEY, "what": title, "results_per_page": 1}
        try:
            r = requests.get(f"{ADZUNA_API_URL}/{country}/search/1", params=params, timeout=DEFAULT_HTTP_TIMEOUT)
            results = r.json().get("results", [])
            if results:
                j = results[0]
                low, high = float(j.get("salary_min") or 0), float(j.get("salary_max") or 0)
                data.append(((low + high) / 2) if (low or high) else 0)
            else:
                data.append(0)
        except Exception:
            data.append(0)
    return data

def fetch_job_counts():
    counts = []
    for title in JOB_TITLES:
        try:
            r = requests.get(REMOTIVE_API_URL, params={"search": title}, timeout=DEFAULT_HTTP_TIMEOUT)
            counts.append(len(r.json().get("jobs", [])))
        except Exception:
            counts.append(0)
    return counts

def fetch_skill_trends():
    freq = Counter()
    try:
        r = requests.get(REMOTIVE_API_URL, params={"limit": 50}, timeout=DEFAULT_HTTP_TIMEOUT)
        for job in r.json().get("jobs", []):
            text = (job.get("description") or "").lower()
            for key in KEYWORDS:
                if key.lower() in text:
                    freq[key] += 1
    except Exception:
        pass
    return freq

def fetch_location_counts():
    freq, country = Counter(), "gb"
    try:
        r = requests.get(f"{ADZUNA_API_URL}/{country}/search/1",
                         params={"app_id": ADZUNA_APP_ID, "app_key": ADZUNA_APP_KEY, "results_per_page": 30},
                         timeout=DEFAULT_HTTP_TIMEOUT)
        for j in r.json().get("results", []):
            loc = (j.get("location") or {}).get("display_name")
            if loc: freq[loc] += 1
    except Exception:
        pass
    return freq.most_common(5)

__all__ = [
    "JOB_TITLES","fetch_remotive_jobs","fetch_adzuna_jobs","fetch_jsearch_jobs",
    "fetch_salary_data","fetch_job_counts","fetch_skill_trends","fetch_location_counts"
]
