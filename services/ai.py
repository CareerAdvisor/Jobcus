from flask import current_app as app

def call_ai(model: str, prompt: str) -> str:
    client = app.config["OPENAI_CLIENT"]
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role":"system","content":"You are Jobcus, a helpful AI career assistant."},
            {"role":"user","content":prompt}
        ],
        temperature=0.6,
    )
    return resp.choices[0].message.content
