from flask import Flask, request, render_template, jsonify, session
import openai
import os
from flask_cors import CORS

# New SDK uses `OpenAI` client
from openai import OpenAI

app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)

# Load API key from environment variable
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY")) 

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/ask", methods=["POST"])
def ask():
    user_msg = request.json.get("message")

    messages = [
        {
            "role": "system",
            "content": (
                "You are Jobcus, an AI-powered career advisor. Be helpful, smart, and friendly. "
                "Guide job seekers based on their skills, experience, and goals."
            )
        },
        {"role": "user", "content": user_msg}
    ]

    try:
        response = openai.ChatCompletion.create(
            model="gpt-4o",
            messages=messages
        )
        ai_msg = response.choices[0].message.content
        return jsonify({"reply": ai_msg})
    except Exception as e:
        print("ERROR:", str(e))
        return jsonify({"reply": f"⚠️ Server Error: {str(e)}"})

if __name__ == "__main__":
    app.run(debug=True)
