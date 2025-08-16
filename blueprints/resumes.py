from flask import Blueprint, render_template, request, make_response, send_file, jsonify, current_app
from weasyprint import HTML, CSS
from docxtpl import DocxTemplate
from io import BytesIO
from PyPDF2 import PdfReader
from openai import RateLimitError
import base64, re, json, logging, os, docx

resumes_bp = Blueprint("resumes", __name__)

# ---------- Helper: fallback context if OpenAI is unavailable ----------
def naive_context(data: dict) -> dict:
    """Fallback: coerce raw form fields into your template context."""
    name      = (data.get("fullName") or "").strip()
    title     = (data.get("title") or "").strip()
    contact   = (data.get("contact") or "").strip()
    summary   = (data.get("summary") or "").strip()
    edu_txt   = (data.get("education") or "").strip()
    exp_txt   = (data.get("experience") or "").strip()
    skills_s  = (data.get("skills") or "")
    portfolio = (data.get("portfolio") or "").strip()

    skills = [s.strip() for s in skills_s.replace("\n", ",").split(",") if s.strip()]

    education = []
    if edu_txt:
        education = [{
            "degree": edu_txt, "school": "", "location": "", "graduated": ""
        }]

    experience = []
    if exp_txt:
        bullets = [re.sub(r'^[\-\•]\s*', '', ln).strip()
                   for ln in exp_txt.splitlines() if ln.strip()]
        experience = [{
            "role": title or "Experience",
            "company": "", "location": "",
            "start": "", "end": "",
            "bullets": bullets
        }]

    links = [{"url": portfolio, "label": "Portfolio"}] if portfolio else []

    return {
        "name": name, "title": title, "contact": contact, "summary": summary,
        "skills": skills, "links": links,
        "experience": experience, "education": education
    }

# ---------- 1) Template-based resume (HTML/PDF) ----------
@resumes_bp.post("/build-resume")
def build_resume():
    data  = request.get_json(force=True)
    theme = data.get("theme", "modern")
    fmt   = data.get("format", "html")

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

    html = render_template(f"resumes/{theme}.html", for_pdf=(fmt == "pdf"), **context)

    if fmt == "pdf":
        # Build a list of local CSS files to include
        css_files = [
            os.path.join(current_app.root_path, "static", "resumes", f"{theme}.css")
        ]
        pdf_css_path = os.path.join(current_app.root_path, "static", "pdf.css")
        if os.path.exists(pdf_css_path):
            css_files.append(pdf_css_path)

        stylesheets = [CSS(filename=p) for p in css_files if os.path.exists(p)]

        pdf_bytes = HTML(
            string=html,
            base_url=current_app.root_path  # enables relative 'static/...' paths
        ).write_pdf(stylesheets=stylesheets)

        resp = make_response(pdf_bytes)
        resp.headers["Content-Type"] = "application/pdf"
        resp.headers["Content-Disposition"] = "inline; filename=resume.pdf"
        return resp

    # HTML preview
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

# ---------- 4) AI resume optimisation ----------
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
        resume_text = data.get("text", "").strip()
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

# ---------- 5) AI generate resume (JSON for template) ----------
@resumes_bp.post("/generate-resume")
def generate_resume():
    client = current_app.config["OPENAI_CLIENT"]
    data = request.get_json(force=True) or {}

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
""".strip()

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
        ctx.setdefault("name",  (data.get("fullName") or ""))
        ctx.setdefault("title", (data.get("title") or ""))
        ctx.setdefault("contact", (data.get("contact") or ""))

        return jsonify(context=ctx, aiUsed=True)

    except RateLimitError:
        current_app.logger.error("OpenAI quota/429 in /generate-resume")
        return jsonify(context=naive_context(data), aiUsed=False, error_code="quota_or_error")

    except Exception:
        logging.exception("Generation failed")
        return jsonify(context=naive_context(data), aiUsed=False, error_code="error")

@resumes_bp.route("/ai/suggest", methods=["POST"])
def ai_suggest():
    data  = request.get_json(force=True) or {}
    field = (data.get("field") or "general").strip().lower()
    ctx   = data.get("context") or {}
    client = current_app.config.get("OPENAI_CLIENT")

    def normalize(text="", items=None):
        items = items if isinstance(items, list) else None
        if not items and text:
            items = [ln.strip("•- ").strip() for ln in text.splitlines() if ln.strip()]
        if not text and items:
            text = "\n".join(items)
        # include 'suggestions' for front-ends that expect it
        return {"text": text or "", "list": items or [], "suggestions": items or []}

    # ---- Cover letter (letter-style, paragraphs, supports tone) ----
    if field in ("coverletter", "coverletter_from_analyzer", "cover_letter"):
        name  = ctx.get("name") or ""
        title = ctx.get("title") or "professional"
        cl    = ctx.get("coverLetter") or ctx
        company  = (cl or {}).get("company") or "your company"
        role     = (cl or {}).get("role") or "the role"
        manager  = (cl or {}).get("manager") or "Hiring Manager"
        tone     = (cl or {}).get("tone") or "professional"

        openers = {
            "professional": (
                f"I’m a {title} interested in the {role} role at {company}. "
                "I bring a record of delivering measurable results and collaborating across teams."
            ),
            "friendly": (
                f"I’m excited to apply for the {role} role at {company}. "
                "I love tackling real problems with practical solutions and working closely with teammates."
            ),
            "concise": (
                f"I’m applying for the {role} role at {company}. I deliver results and improve processes."
            ),
        }
        opener = openers.get(tone, openers["professional"])

        body = (
            "In my recent roles, I delivered measurable outcomes by improving processes, collaborating cross-functionally, "
            "and driving initiatives from concept to execution. I’d welcome the opportunity to bring that same impact to your team."
        )

        text = (
            f"Dear {manager},\n\n"
            f"{opener}\n\n"
            f"{body}\n\n"
            "Thank you for your time and consideration. I look forward to the possibility of discussing how I can contribute.\n\n"
            f"Sincerely,\n{name}".strip()
        )

        return jsonify({"text": text, "list": [], "suggestions": []})

    # ---- Compact context for resume prompts ----
    def compact_context(c):
        parts = []
        nm  = c.get("name");   ti = c.get("title")
        sm  = c.get("summary"); ct = c.get("contact")
        if nm or ti: parts.append(f"Name/Title: {nm or ''} {ti or ''}".strip())
        if ct: parts.append(f"Contact: {ct}")
        exps = c.get("experience") or []
        if exps:
            e0 = exps[0]
            parts.append(
                f"Recent role: {e0.get('role','')} at {e0.get('company','')} "
                f"({e0.get('location','')}) {e0.get('start','')}–{e0.get('end','')}"
            )
        if sm: parts.append(f"Existing summary: {sm}")
        return "\n".join(parts)[:2000]

    base_ctx = compact_context(ctx)

    if field == "summary":
        prompt = (
            "Write a single, crisp professional summary (2–3 sentences) for a resume. "
            "Emphasize years of experience, role scope, and 1–2 measurable achievements. "
            "No bullet points. Be concise and ATS-friendly.\n\n"
            f"Context:\n{base_ctx}"
        )
    elif field == "highlights":
        idx = data.get("index")
        exp = None
        if isinstance(idx, int):
            exps = ctx.get("experience") or []
            if 0 <= idx < len(exps):
                exp = exps[idx]
        exp_ctx = ""
        if exp:
            exp_ctx = (
                f"Role: {exp.get('role','')}\n"
                f"Company: {exp.get('company','')}\n"
                f"Location: {exp.get('location','')}\n"
                f"Dates: {exp.get('start','')} – {exp.get('end','')}\n"
                f"Existing bullets: {(exp.get('bullets') or [])}"
            )
        prompt = (
            "Write exactly 3–5 strong resume bullet points for this role. "
            "Return plain lines (no numbering). Start with an action verb; keep each under ~22 words; quantify impact.\n\n"
            f"Global context:\n{base_ctx}\n\nJob context:\n{exp_ctx}"
        )
    else:
        prompt = (
            "Write 3 concise, outcomes-focused resume bullet points. "
            "Return plain lines (no numbering). Use action verbs and metrics.\n\n"
            f"Context:\n{base_ctx}"
        )

    # If no client, return safe fallbacks with 200
    if not client:
        if field == "summary":
            return jsonify(normalize(
                "Results-driven professional with experience delivering measurable impact across X, Y, and Z. "
                "Recognized for A, B, and C; partners cross-functionally to ship results."
            ))
        return jsonify(normalize(items=[
            "Increased X by Y% by doing Z",
            "Reduced A by B% through C initiative",
            "Led D cross-functional effort resulting in E"
        ]))

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are an expert resume writer. Be concise and ATS-friendly."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.5,
            max_tokens=220,
        )
        out = (resp.choices[0].message.content or "").strip()
        return jsonify(normalize(out))
    except Exception as e:
        # IMPORTANT: still return 200 with fallback so the UI updates
        current_app.logger.warning("ai_suggest error; returning fallback: %s", e)
        if field == "summary":
            return jsonify(normalize(
                "Results-driven professional with experience delivering measurable impact across X, Y, and Z. "
                "Recognized for A, B, and C; partners cross-functionally to ship results."
            ))
        return jsonify(normalize(items=[
            "Increased X by Y% by doing Z",
            "Reduced A by B% through C initiative",
            "Led D cross-functional effort resulting in E"
        ]))

    # Resume summary / highlights fallbacks
    if field == "summary":
        return jsonify({"text": "Results-driven professional with X years of experience delivering Y. Known for Z."})
    if field == "highlights":
        return jsonify({"list": ["Led A to achieve B", "Improved C by D%", "Built E that saved F hours"]})

    return jsonify({"text": "No suggestion available."})

@resumes_bp.route("/build-cover-letter", methods=["POST"])
def build_cover_letter():
    data = request.get_json(force=True) or {}
    fmt  = data.get("format", "html")

    sender    = data.get("sender") or {}
    recipient = data.get("recipient") or {}
    cl        = data.get("coverLetter") or {}
    cover_body = (cl.get("draft") or "").strip()

    html = render_template(
        "cover-letter-print.html",
        sender=sender,
        recipient=recipient,
        cover_body=cover_body
    )

    if fmt == "pdf":
        pdf_bytes = HTML(string=html, base_url=current_app.root_path).write_pdf()
        return send_file(BytesIO(pdf_bytes), mimetype="application/pdf",
                         as_attachment=True, download_name="cover-letter.pdf")

    resp = make_response(html)
    resp.headers["Content-Type"] = "text/html; charset=utf-8"
    return resp
