from flask import Blueprint, render_template, request, make_response, send_file, jsonify, current_app
from weasyprint import HTML, CSS
from docxtpl import DocxTemplate
from io import BytesIO
from PyPDF2 import PdfReader
from openai import RateLimitError
import base64, re, json, logging, os, docx

resumes_bp = Blueprint("resumes", __name__)

# -------------------------------------------------------------------
# Print/PDF overrides (reduce WeasyPrint warnings, enforce margins)
# -------------------------------------------------------------------
PDF_CSS_OVERRIDES = """
@page { size: A4; margin: 0.75in; }    /* 0.75" on all sides */
* { box-shadow: none !important; }     /* WeasyPrint ignores box-shadow; silence visually */
@media print {
  html, body { background: white !important; }
  .resume-page, .resume { box-shadow: none !important; }
  .section { margin-top: 12px !important; }
  .section .rule { margin: 6px 0 10px 0 !important; }
  h1, h2, h3 { page-break-after: avoid; }
  .item-header { page-break-inside: avoid; }
  ul.bullets { margin-top: 6px !important; }
}
"""

# ---------- Helper: fallback context if OpenAI is unavailable ----------
def naive_context(data: dict) -> dict:
    """Fallback: coerce raw form fields into your template context."""
    # name: honor fullName if present, else try first+last
    first = (data.get("firstName") or "").strip()
    last  = (data.get("lastName") or "").strip()
    derived = " ".join([p for p in (first, last) if p]).strip()

    name      = (data.get("name") or data.get("fullName") or derived or "").strip()
    title     = (data.get("title") or "").strip()
    contact   = (data.get("contact") or "").strip()
    summary   = (data.get("summary") or "").strip()
    edu_txt   = (data.get("education") or "").strip()
    exp_txt   = (data.get("experience") or "").strip()
    skills_s  = (data.get("skills") or "")
    certs_s   = (data.get("certifications") or "")
    portfolio = (data.get("portfolio") or "").strip()

    skills = [s.strip() for s in str(skills_s).replace("\n", ",").split(",") if s.strip()]
    certifications = [c.strip() for c in str(certs_s).splitlines() if c.strip()]

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
        "experience": experience, "education": education,
        "certifications": certifications,
    }

# ---------- Helper: normalize context coming from the UI ----------
def _normalize_ctx(data: dict) -> dict:
    """
    Make sure template fields are present and in the correct types,
    no matter how the client sent them.
    """
    # ---- Name (prefer explicit, then fullName, then first+last) ----
    first = (data.get("firstName") or "").strip()
    last  = (data.get("lastName") or "").strip()
    derived = " ".join([p for p in (first, last) if p]).strip()
    name = (data.get("name") or data.get("fullName") or data.get("full_name") or derived or "").strip()

    ctx = dict(data)  # shallow copy
    ctx["name"] = name
    ctx["fullName"] = name
    ctx["full_name"] = name

    # ---- Skills: allow CSV/newlines or list ----
    skills = ctx.get("skills") or []
    if isinstance(skills, str):
        skills = [s.strip() for s in re.split(r"[,\n]", skills) if s.strip()]
    ctx["skills"] = skills

    # ---- Certifications: allow newlines or list ----
    certs = ctx.get("certifications") or []
    if isinstance(certs, str):
        certs = [c.strip() for c in certs.splitlines() if c.strip()]
    ctx["certifications"] = certs

    # Ensure arrays exist (templates expect iterables)
    ctx["experience"] = ctx.get("experience") or []
    ctx["education"]  = ctx.get("education")  or []
    ctx["links"]      = ctx.get("links")      or []

    return ctx

# --- Add near the top of resumes.py (above the route handlers) ---
import re

SECTION_KEYS = [
    "summary", "objective", "experience", "work experience", "education",
    "skills", "projects", "certifications", "achievements", "contact"
]

def _keyword_match(resume_text: str, job_desc: str):
    if not job_desc:
        return {"matched": [], "missing": []}, None
    words = {w.lower() for w in re.findall(r"[A-Za-z][A-Za-z+\-/#]{2,}", job_desc)}
    stop  = {"and","the","with","for","from","your","you","our","role","job",
             "skills","experience","years","team","work","ability","responsibilities"}
    targets = sorted(w for w in words if w not in stop)
    txt = resume_text.lower()
    matched = [w for w in targets if w in txt]
    missing = [w for w in targets if w not in txt]
    score = round(100 * len(matched) / max(1, len(targets)))
    return {"matched": matched, "missing": missing}, score

def _detect_sections(resume_text: str):
    txt = resume_text.lower()
    present = [s for s in SECTION_KEYS if re.search(rf"\b{s}\b", txt)]
    missing = [s for s in SECTION_KEYS if s not in present]
    score = round(100 * len(present) / len(SECTION_KEYS))
    return {"present": present, "missing": missing}, score

def _readability_score(resume_text: str):
    words = re.findall(r"\w+", resume_text)
    sents = re.split(r"[.!?]\s+", resume_text.strip())
    w = len(words)
    s = max(1, len([x for x in sents if x.strip()]))
    avg = w / s  # words per sentence
    # ideal range ~12–20 → score dips as you move away
    diff = abs(avg - 16)
    return max(0, min(100, round(100 - diff * 6)))

def _length_score(resume_text: str):
    w = len(re.findall(r"\w+", resume_text))
    if w <= 100:  return 20
    if w >= 1600: return 25
    if 450 <= w <= 900:  # ~1–2 pages of text
        return 95
    if w < 450:
        return max(30, round(95 - (450 - w) * 0.12))
    return max(30, round(95 - (w - 900) * 0.06))

def build_dashboard_payload(*, score:int, issues:list, strengths:list, suggestions:list,
                            resume_text:str, job_desc:str):
    kw, kw_score     = _keyword_match(resume_text, job_desc)
    secs, sec_score  = _detect_sections(resume_text)
    breakdown = {
        "formatting": 80,                              # placeholder (tie to a real formatter if you have one)
        "keywords": kw_score if kw_score is not None else None,
        "sections": sec_score,
        "readability": _readability_score(resume_text),
        "length": _length_score(resume_text),
        "parseable": bool(resume_text.strip()),
    }
    return {
        "score": int(score or 0),
        "lastAnalyzed": None,                          # UI can overwrite with client time
        "analysis": {"issues": issues or [], "strengths": strengths or []},
        "suggestions": suggestions or [],
        "breakdown": breakdown,
        "keywords": kw,
        "sections": secs,
    }

# ---------- 1) Template-based resume (HTML/PDF) ----------
@resumes_bp.post("/build-resume")
def build_resume():
    data  = request.get_json(force=True) or {}
    theme = (data.get("theme") or "modern").lower()
    fmt   = (data.get("format") or "html").lower()

    # Always normalize first (fixes name/skills/certifications issues)
    ctx = _normalize_ctx(data)

    # Build final template context
    tpl_ctx = {
        "name":           ctx.get("name", ""),
        "title":          ctx.get("title", ""),
        "contact":        ctx.get("contact", ""),
        "summary":        ctx.get("summary", ""),
        "skills":         ctx.get("skills", []),
        "links":          ctx.get("links", []),
        "experience":     ctx.get("experience", []),
        "education":      ctx.get("education", []),
        "certifications": ctx.get("certifications", []),
    }

    # templates are in templates/resumes/<theme>.html
    template_path = f"resumes/{'minimal' if theme == 'minimal' else 'modern'}.html"
    html = render_template(template_path, for_pdf=(fmt == "pdf"), **tpl_ctx)

    if fmt == "pdf":
        # Attach optional files plus our print overrides
        stylesheets = [CSS(string=PDF_CSS_OVERRIDES)]

        # If you keep separate pdf.css, include it too (optional)
        pdf_css_path = os.path.join(current_app.root_path, "static", "pdf.css")
        if os.path.exists(pdf_css_path):
            stylesheets.append(CSS(filename=pdf_css_path))

        pdf_bytes = HTML(
            string=html,
            base_url=current_app.root_path  # enables relative 'static/...' paths in the template
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
    data = request.get_json(force=True) or {}
    ctx  = _normalize_ctx(data)

    tpl_path = os.path.join(current_app.root_path, "templates", "resumes", "clean.docx")
    tpl = DocxTemplate(tpl_path)
    tpl.render({
        "name":           ctx.get("name", ""),
        "title":          ctx.get("title", ""),
        "summary":        ctx.get("summary", ""),
        "experience":     ctx.get("experience", []),
        "education":      ctx.get("education", []),
        "skills":         ctx.get("skills", []),
        "contact":        ctx.get("contact", ""),
        "links":          ctx.get("links", []),
        "certifications": ctx.get("certifications", []),
    })

    buf = BytesIO()
    tpl.save(buf); buf.seek(0)
    return send_file(buf, as_attachment=True, download_name="resume.docx")

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
  ],
  "certifications": ["..."]
}}

User input:
fullName: {data.get('fullName',"")}
firstName: {data.get('firstName',"")}
lastName: {data.get('lastName',"")}
title: {data.get('title',"")}
contact: {data.get('contact',"")}
summary: {data.get('summary',"")}
education (free text): {data.get('education',"")}
experience (free text): {data.get('experience',"")}
skills (free text): {data.get('skills',"")}
certifications (free text): {data.get('certifications',"")}
portfolio: {data.get('portfolio',"")}
""".strip()

    def _coerce_list(val):
        if isinstance(val, list): return val
        if not val: return []
        return [s.strip() for s in str(val).replace("\r", "").split("\n") if s.strip()]

    try:
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role":"user","content":prompt}],
            temperature=0.2
        )
        content = resp.choices[0].message.content.strip()
        content = re.sub(r"```(?:json)?", "", content).strip()
        ctx = json.loads(content)

        # Guarantee essential fields
        first = (data.get("firstName") or "").strip()
        last  = (data.get("lastName") or "").strip()
        derived = " ".join([p for p in (first, last) if p]).strip()
        ctx.setdefault("name",  (data.get("fullName") or derived or ""))
        ctx.setdefault("title", (data.get("title") or ""))
        ctx.setdefault("contact", (data.get("contact") or ""))

        # Normalize lists
        if isinstance(ctx.get("skills"), str):
            ctx["skills"] = [s.strip() for s in ctx["skills"].replace(",", "\n").splitlines() if s.strip()]
        ctx["certifications"] = _coerce_list(ctx.get("certifications")) or _coerce_list(data.get("certifications"))

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
        return {"text": text or "", "list": items or [], "suggestions": items or []}

    # ---- Cover letter (letter-style body, richer content) ----
    if field in ("coverletter", "coverletter_from_analyzer", "cover_letter"):
        name   = (ctx.get("name") or "").strip()
        title  = (ctx.get("title") or "professional").strip()
        cl     = ctx.get("coverLetter") or ctx or {}
        company = (cl.get("company") or "your company").strip()
        role    = (cl.get("role") or "the role").strip()
        manager = (cl.get("manager") or "Hiring Manager").strip()
        tone    = (cl.get("tone") or "professional").strip()

        jd   = (ctx.get("jd") or "").strip()
        rsum = (ctx.get("resumeText") or "").strip()

        prompt = (
            "Write a UK-English cover letter BODY (no greeting and no closing) for a job application.\n"
            f"Role: {role}\nCompany: {company}\nCandidate: {name or 'the candidate'} ({title})\n"
            f"Tone: {tone} but warm and confident. Length: ~220–320 words in 3–5 short paragraphs.\n"
            "Prioritise clear impact, quantified results, collaboration, tooling, and domain fit.\n"
            "Use concise sentences, avoid clichés and buzzwords, and do not include lists or bullets.\n"
            "Return PLAIN TEXT only — DO NOT add 'Dear ...' or 'Yours sincerely'.\n\n"
            f"Resume excerpt (optional):\n{rsum[:2000]}\n\n"
            f"Job description (optional):\n{jd[:2000]}"
        )

        if client:
            try:
                resp = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.6,
                    max_tokens=600,
                )
                out = (resp.choices[0].message.content or "").strip()
                out = re.sub(r"```(?:\w+)?", "", out).strip()
                return jsonify({"text": out, "list": [], "suggestions": []})
            except Exception as e:
                current_app.logger.warning("cover letter AI error; using fallback: %s", e)

        text = (
            f"As an experienced {title.lower()} with a strong record of supporting teams and customers, "
            f"I’m excited to apply for the {role} role at {company}. I combine hands-on technical ability with "
            f"a pragmatic, service-oriented approach that focuses on reliability, responsiveness, and measurable outcomes.\n\n"
            "In previous roles I resolved complex issues across hardware, software, and networks while maintaining high CSAT. "
            "I introduced lightweight runbooks to speed up triage, reduced repeat incidents through root-cause fixes, "
            "and partnered with cross-functional teams to tighten feedback loops. Notable wins include cutting average resolution time "
            "by over 25% and driving onboarding improvements that reduced first-week tickets by double digits.\n\n"
            "Beyond troubleshooting, I care deeply about clear communication. I translate technical details into plain language, "
            "set expectations transparently, and prioritise thoughtfully when demand spikes. I’m comfortable owning a queue, "
            "coordinating escalations, and documenting knowledge so solutions scale.\n\n"
            "I’m confident I can bring the same reliability and customer focus to your team and help deliver fast, friendly, "
            "and secure support at scale."
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

    # Unreachable
    # return jsonify({"text": "No suggestion available."})

# ---------- Cover Letter builder ----------
@resumes_bp.route("/build-cover-letter", methods=["POST"])
def build_cover_letter():
    try:
        data = request.get_json(force=True) or {}
    except Exception:
        current_app.logger.exception("build-cover-letter: bad JSON")
        return jsonify(error="Invalid JSON body"), 400

    fmt = (data.get("format") or "html").lower()
    try:
        name     = data.get("name", "")
        title    = data.get("title", "")
        contact  = data.get("contact", "")
        sender   = data.get("sender") or {}
        recipient= data.get("recipient") or {}
        cl       = data.get("coverLetter") or {}
        draft    = (cl.get("draft") or "").strip()

        html = render_template(
            "cover-letter.html",
            name=name, title=title, contact=contact,
            sender=sender, recipient=recipient, draft=draft,
            letter_only=(fmt == "pdf" or bool(data.get("letter_only"))),
            for_pdf=(fmt == "pdf"),
        )
    except Exception:
        current_app.logger.exception("build-cover-letter: template render failed")
        return jsonify(error="Template error (see logs for details)"), 500

    if fmt == "pdf":
        try:
            pdf_bytes = HTML(string=html, base_url=current_app.root_path).write_pdf(
                stylesheets=[CSS(string="@page{size:A4;margin:0.75in}")]
            )
            return send_file(BytesIO(pdf_bytes),
                             mimetype="application/pdf",
                             as_attachment=True,
                             download_name="cover-letter.pdf")
        except Exception:
            current_app.logger.exception("build-cover-letter: PDF generation failed")
            return jsonify(error="PDF generation failed (see logs)"), 500

    resp = make_response(html)
    resp.headers["Content-Type"] = "text/html; charset=utf-8"
    return resp

# ---------- 3) AI resume analysis ----------
@resumes_bp.route("/api/resume-analysis", methods=["POST"])
def resume_analysis():
    """
    Hybrid ATS analysis: deterministic checks + LLM judgment.
    Returns a rich JSON payload while keeping existing fields for the dashboard.
    """
    client = current_app.config["OPENAI_CLIENT"]
    data = request.get_json(force=True)
    resume_text = ""

    # ------- Input decoding -------
    try:
        if data.get("pdf"):
            pdf_bytes = base64.b64decode(data["pdf"])
            reader = PdfReader(BytesIO(pdf_bytes))
            resume_text = "\n".join((p.extract_text() or "") for p in reader.pages)
        elif data.get("docx"):
            docx_bytes = base64.b64decode(data["docx"])
            d = docx.Document(BytesIO(docx_bytes))
            resume_text = "\n".join(p.text for p in d.paragraphs)
        elif data.get("text"):
            resume_text = (data["text"] or "").strip()
        else:
            return jsonify(error="No resume data provided"), 400
    except Exception:
        current_app.logger.exception("resume-analysis: file decode error")
        return jsonify(error="Could not read the resume file"), 400

    if not resume_text.strip():
        return jsonify(error="Could not extract any text"), 400

    job_desc = (data.get("jobDescription") or "").strip()
    job_role = (data.get("jobRole") or "").strip()
    level    = (data.get("careerLevel") or "mid").lower()  # optional hint from UI

    # ------- Deterministic checks (scored 0–100) -------
    length_depth   = _length_depth(resume_text, level=level)
    bullet_stats   = _bullet_stats(resume_text)
    impact_stats   = _impact_stats(resume_text)
    repetition     = _repetition(resume_text)
    tense_health   = _tense_health(resume_text)
    growth         = _growth_signals(resume_text)
    unnecessary    = _unnecessary_sections(resume_text)

    # Bullet-length score: share of bullets within the 8–26 word “sweet spot”
    if bullet_stats["count"] > 0:
        good_ratio = bullet_stats["ok"] / bullet_stats["count"]
        bullet_len_score = int(round(good_ratio * 100))
    else:
        bullet_len_score = 40  # encourage using bullets

    # Quantify impact score: % bullets with numbers/metrics
    impact_score = impact_stats["percent_with_numbers"]

    # Basic sections presence (to support UI even if LLM fails)
    sections_present = []
    for key, label in [
        (r"\bsummary|profile|professional summary\b", "Summary"),
        (r"\bexperience|employment|work history\b",   "Experience"),
        (r"\beducation|degree|university|college\b",  "Education"),
        (r"\bskills\b",                                "Skills"),
        (r"\bcertifications?|licenses?\b",            "Certifications")
    ]:
        if re.search(key, resume_text, re.I):
            sections_present.append(label)
    sections_missing = [s for s in ["Summary","Experience","Education","Skills","Certifications"]
                        if s not in sections_present]
    # provisional section score
    sections_score = int(round(100 * len(sections_present) / 5))

    # Readability proxy (very rough): shorter average sentence & bullets → higher score
    sentences = [s.strip() for s in re.split(r"[.!?]\s+", resume_text) if s.strip()]
    avg_sentence_words = (sum(_word_count(s) for s in sentences) / max(1, len(sentences)))
    readability_score = max(20, min(100, int(round(120 - avg_sentence_words))))  # 18–22 words ≈ ~98–100

    # Parseable (we extracted text) → 100
    parseable_score = 100

    # ------- LLM pass for nuanced JSON (keywords, strengths/issues, grammar tips, relevance) -------
    role_or_desc = f"Job description:\n{job_desc}" if job_desc else (
        f"Target role: {job_role}. If no JD, infer typical responsibilities and keywords for this role."
        if job_role else "No job description provided."
    )

    llm_fields = {
        "score": 0, "analysis": {"issues": [], "strengths": []},
        "suggestions": [],
        "keywords": {"matched": [], "missing": []},
        "writing": {"readability": "", "repetition": [], "grammar": []},
        "relevance": {"role": job_role, "score": 0, "explanation": "", "aligned_keywords": [], "missing_keywords": []},
        "formatting_score": None  # we’ll map into breakdown
    }

    try:
        prompt = f"""
You are an ATS-certified resume analyst. Return ONLY valid JSON (no backticks) with this schema:

{{
  "score": 0-100,
  "formatting_score": 0-100,
  "analysis": {{"issues": ["..."], "strengths": ["..."]}},
  "suggestions": ["..."],
  "keywords": {{"matched": ["..."], "missing": ["..."]}},
  "writing": {{
    "readability": "Grade level or CEFR (e.g., Grade 8–10 / B2)",
    "repetition": [{{"term":"managed","count":5,"alternatives":["led","owned","coordinated"]}}],
    "grammar": ["Concise, actionable grammar/style suggestions"]
  }},
  "relevance": {{
    "role": "{job_role}",
    "score": 0-100,
    "explanation": "How well it aligns and why",
    "aligned_keywords": ["..."],
    "missing_keywords": ["..."]
  }}
}}

Use this context for keywords/relevance if present:
{role_or_desc}

Resume:
{resume_text[:8000]}
""".strip()

        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role":"user","content":prompt}],
            temperature=0.0
        )
        content = (resp.choices[0].message.content or "").strip()
        content = re.sub(r"```(?:json)?", "", content).strip()
        start, end = content.find("{"), content.rfind("}")
        if start >= 0 and end > start:
            llm = json.loads(content[start:end+1])
            # merge safely
            for k in llm_fields.keys():
                if k in llm:
                    llm_fields[k] = llm[k]

    except Exception:
        current_app.logger.warning("LLM analyzer step failed; continuing with heuristics", exc_info=True)

    # ------- Compose breakdown and final score -------
    breakdown = {
        "formatting": llm_fields.get("formatting_score") if isinstance(llm_fields.get("formatting_score"), int) else 75,
        "keywords":   int(round(100 * len(llm_fields["keywords"].get("matched", [])) /
                                max(1, len(llm_fields["keywords"].get("matched", []) + llm_fields["keywords"].get("missing", [])))) )
                        if (llm_fields["keywords"].get("matched") is not None) else 60,
        "sections":   sections_score,
        "readability": readability_score,
        "length":     length_depth["score"],     # <- our stricter length/depth score
        "parseable":  True if parseable_score == 100 else False
    }

    # Additional sub-scores that influence the final score
    sub_scores = {
        "impact": impact_score,                  # bullets with numbers
        "bullet_length": bullet_len_score,       # bullets 8–26 words
        "tenses": tense_health["score"],         # crude tense health
        "growth": growth["score"],               # growth signals present
        "unnecessary": unnecessary["score"],     # penalize for "References", "Objective", etc.
    }

    # Weighting: emphasize depth/impact/keywords so short resumes are penalized
    w = {
        "formatting": 0.12,
        "sections":   0.12,
        "readability":0.08,
        "length":     0.18,
        "keywords":   0.18 if job_desc or job_role else 0.12,
        "impact":     0.12,
        "bullet_length": 0.06,
        "tenses":     0.05,
        "growth":     0.05,
        "parseable":  0.02,
        "unnecessary":0.02,
    }

    # Score assembly
    overall = (
        breakdown["formatting"] * w["formatting"] +
        breakdown["sections"]   * w["sections"]   +
        breakdown["readability"]* w["readability"]+
        breakdown["length"]     * w["length"]     +
        breakdown["keywords"]   * w["keywords"]   +
        sub_scores["impact"]    * w["impact"]     +
        sub_scores["bullet_length"] * w["bullet_length"] +
        sub_scores["tenses"]    * w["tenses"]     +
        sub_scores["growth"]    * w["growth"]     +
        (100 if breakdown["parseable"] else 0) * w["parseable"] +
        sub_scores["unnecessary"] * w["unnecessary"]
    )
    overall_score = int(round(overall))

    # ------- Build response -------
    out = {
        "score": overall_score,
        "analysis": {
            "issues": llm_fields["analysis"].get("issues", []),
            "strengths": llm_fields["analysis"].get("strengths", [])
        },
        "suggestions": llm_fields.get("suggestions", []),
        "breakdown": breakdown,
        "keywords": llm_fields.get("keywords", {"matched":[], "missing":[]}),
        "sections": {"present": sections_present, "missing": sections_missing},
        "writing": {
            "readability": llm_fields.get("writing", {}).get("readability", ""),
            "repetition": llm_fields.get("writing", {}).get("repetition", []) or repetition,
            "grammar":    llm_fields.get("writing", {}).get("grammar", [])
        },
        "relevance": llm_fields.get("relevance", {}),
        # Extra detail you can show in future panels/tabs
        "diagnostics": {
            "length_depth": length_depth,
            "bullet_stats": bullet_stats,
            "impact": impact_stats,
            "tenses": tense_health,
            "growth_signals": growth,
            "unnecessary_sections": unnecessary,
            "sub_scores": sub_scores,
        }
    }

    # Add actionable, ATS-style issues if heuristics detect gaps
    gaps = []
    if length_depth["score"] < 80:
        gaps.append(length_depth["advice"])
    if impact_score < 40:
        gaps.append("Add more hard numbers (%, $, counts, time saved) to quantify impact in your bullets.")
    if bullet_len_score < 75:
        gaps.append("Tighten your bullets to ~8–26 words; avoid one-liners and very long sentences.")
    if tense_health["mismatch_count"] >= 2:
        gaps.append("Use past tense for previous roles; present tense only for current responsibilities.")
    if unnecessary["flagged"]:
        gaps.append(f"Remove unnecessary section(s): {', '.join(unnecessary['flagged'])}.")
    if gaps:
        out["analysis"]["issues"] = (out["analysis"]["issues"] or []) + gaps

    # Strengths from heuristics
    wins = []
    if bullet_stats["count"] >= 6:
        wins.append("Uses bullet points to present achievements clearly.")
    if growth["found"]:
        wins.append("Shows growth indicators: " + ", ".join(growth["found"][:4]) + ".")
    if impact_score >= 60:
        wins.append("Multiple bullets quantify impact with numbers/metrics.")
    if wins:
        out["analysis"]["strengths"] = (out["analysis"]["strengths"] or []) + wins

    return jsonify(out), 200
