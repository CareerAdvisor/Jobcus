# blueprints/resumes.py
from flask import Blueprint, render_template, request, make_response, send_file, jsonify, current_app
from weasyprint import HTML
from docxtpl import DocxTemplate
from io import BytesIO
from PyPDF2 import PdfReader
import base64, re, json, logging, os, docx

resumes_bp = Blueprint("resumes", __name__)

# ---------- 1) Template-based resume (HTML/PDF) ----------
@resumes_bp.post("/build-resume")
def build_resume():
    data  = request.get_json(force=True)
    theme = data.get("theme", "modern")      # 'modern' or 'minimal'
    fmt   = data.get("format", "html")       # 'html' or 'pdf'

    context = {
        "name":       data.get("fullName", ""),
        "title":      data.get("title", ""),
        "contact":    data.get("contact", ""),
        "summary":    data.get("summary", ""),
        "education":  data.get("education", []),
        "experience": data.get("experience", []),
        "skills":     data.get("skills", []),
        "links":      data.get("links", []),
    }

    html = render_template(f"resumes/{theme}.html", **context)

    if fmt == "pdf":
        pdf_bytes = HTML(string=html, base_url=request.host_url).write_pdf()
        resp = make_response(pdf_bytes)
        resp.headers["Content-Type"] = "application/pdf"
        resp.headers["Content-Disposition"] = "inline; filename=resume.pdf"
        return resp

    resp = make_response(html)
    resp.headers["Content-Type"] = "text/html; charset=utf-8"
    return resp

# ---------- 2) Template-based resume (DOCX) ----------
@resumes_bp.post("/build-resume-docx")
def build_resume_docx():
    data = request.get_json(force=True)
    tpl_path = os.path.join(current_app.root_path, "templates", "resumes", "clean.docx")

    tpl = DocxTemplate(tpl_path)
    tpl.render({
        "name":       data.get("fullName", ""),
        "title":      data.get("title", ""),
        "summary":    data.get("summary", ""),
        "experience": data.get("experience", []),
        "education":  data.get("education", []),
        "skills":     data.get("skills", []),
        "contact":    data.get("contact", ""),
        "links":      data.get("links", []),
    })

    buf = BytesIO()
    tpl.save(buf); buf.seek(0)
    return send_file(buf, as_attachment=True, download_name="resume.docx")

# ---------- 3) AI resume analysis ----------
@resumes_bp.route("/api/resume-analysis", methods=["POST"])
def resume_analysis():
    client = current_app.config["OPENAI_CLIENT"]
    data = request.get_json(force=True)
    resume_text = ""

    if data.get("pdf"):
        pdf_bytes = base64.b64decode(data["pdf"])
        reader = PdfReader(BytesIO(pdf_bytes))
        resume_text = "\n".join((p.extract_text() or "") for p in reader.pages)
    elif data.get("docx"):
        docx_bytes = base64.b64decode(data["docx"])
        d = docx.Document(BytesIO(docx_bytes))
        resume_text = "\n".join(p.text for p in d.paragraphs)
    elif data.get("text"):
        resume_text = data["text"].strip()
    else:
        return jsonify(error="No resume data provided"), 400

    if not resume_text.strip():
        return jsonify(error="Could not extract any text"), 400

    prompt = (
        "You are an ATS-certified resume analyzer. Return only a JSON object with:\n"
        "score (0–100), issues[], strengths[], suggestions[].\n\n"
        f"Resume content:\n\n{resume_text}"
    )
    try:
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0
        )
        content = resp.choices[0].message.content
        content = re.sub(r"```(?:json)?", "", content).strip()
        start, end = content.find("{"), content.rfind("}")
        parsed = json.loads(content[start:end+1])

        return jsonify({
            "score": int(parsed.get("score", 0)),
            "analysis": {
                "issues": parsed.get("issues", []),
                "strengths": parsed.get("strengths", [])
            },
            "suggestions": parsed.get("suggestions", [])
        })
    except json.JSONDecodeError:
        logging.exception("Invalid JSON from analyzer")
        return jsonify(error="Invalid JSON from Analyzer"), 500
    except Exception:
        logging.exception("Resume analysis error")
        return jsonify(error="Resume analysis failed"), 500

# ---------- 4) AI resume optimization ----------
@resumes_bp.route("/api/optimize-resume", methods=["POST"])
def optimize_resume():
    client = current_app.config["OPENAI_CLIENT"]
    data = request.get_json(force=True)
    resume_text = ""

    if data.get("pdf"):
        try:
            pdf_bytes = base64.b64decode(data["pdf"])
            reader = PdfReader(BytesIO(pdf_bytes))
            resume_text = "\n".join((p.extract_text() or "") for p in reader.pages)
            if not resume_text.strip():
                return jsonify(error="PDF content empty"), 400
        except Exception:
            logging.exception("PDF Decode Error")
            return jsonify(error="Unable to extract PDF text"), 400
    elif data.get("text"):
        resume_text = data["text"].strip()
        if not resume_text:
            return jsonify(error="No text provided"), 400
    else:
        return jsonify(error="No resume data provided"), 400

    prompt = (
        "You are an expert ATS resume optimizer. Rewrite the following resume in plain text, "
        "using strong action verbs, consistent bullets, relevant keywords, and fixing grammar/repetition.\n\n"
        f"Original resume:\n\n{resume_text}"
    )
    try:
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role":"user","content":prompt}],
            temperature=0.3
        )
        optimized = resp.choices[0].message.content.strip()
        optimized = re.sub(r"```(?:[\s\S]*?)```", "", optimized).strip()
        return jsonify({"optimized": optimized})
    except Exception:
        logging.exception("Resume optimization error")
        return jsonify(error="Resume optimization failed"), 500

# ---------- 5) AI generate resume (HTML snippet) ----------
@resumes_bp.post("/generate-resume")
def generate_resume():
    from flask import jsonify, request, current_app
    import re, json

    client = current_app.config["OPENAI_CLIENT"]
    data = request.json or {}

# Ask the model to return ONLY JSON in your template schema
prompt = f"""
Return ONLY valid JSON (no backticks) with this exact schema:

{{
  "name": "...",
  "title": "...",
  "contact": "...",
  "summary": "...",
  "skills": ["..."],
  "links": [{{"url":"...", "label":""}}],
  "experience": [
    {{"role":"...", "company":"...", "location":"", "start":"", "end":"", "bullets":["..."]}}
  ],
  "education": [
    {{"degree":"...", "school":"...", "location":"", "graduated":""}}
  ]
}}

User input:
fullName: {data.get('fullName',"")}
title: {data.get('title',"")}
contact: {data.get('contact',"")}
summary: {data.get('summary',"")}
education (free text): {data.get('education',"")}
experience (free text): {data.get('experience',"")}
skills (free text): {data.get('skills',"")}
certifications (free text): {data.get('certifications',"")}
portfolio: {data.get('portfolio',"")}
"""
    try:
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role":"user","content":prompt}],
            temperature=0.2
        )
        content = resp.choices[0].message.content.strip()
        content = re.sub(r"```(?:json)?", "", content).strip()
        ctx = json.loads(content)

        # tiny fallback so template never breaks
        if not ctx.get("name"):  ctx["name"]  = data.get("fullName","")
        if not ctx.get("title"): ctx["title"] = data.get("title","")
        if not ctx.get("contact"): ctx["contact"] = data.get("contact","")

        return jsonify(context=ctx)  # <-- front-end will hand this to /build-resume
    except Exception as e:
        return jsonify(error=f"Generation failed: {e}"), 500

