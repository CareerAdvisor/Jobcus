# jobcus/routes/resumes.py
from __future__ import annotations

import os, re, json, base64, logging
from io import BytesIO

from flask import (
    Blueprint, request, jsonify, current_app,
    render_template, make_response, send_file
)
from flask_login import login_required, current_user

# --- resilient imports (package vs flat) ---
try:
    from jobcus.services.limits import check_and_increment, feature_enabled
    from jobcus.security.abuse_guard import allow_free_use
    from jobcus.services.resumes import run_analyzer
except ImportError:
    from limits import check_and_increment, feature_enabled
    from abuse_guard import allow_free_use
    from services.resumes import run_analyzer

# libs used by builder/optimizer endpoints
from weasyprint import HTML, CSS
from PyPDF2 import PdfReader
from docxtpl import DocxTemplate
import docx

resumes_bp = Blueprint("resumes", __name__)

# --- helper: support both signatures of allow_free_use across code versions ---
def _allow_free(req, user_id, plan):
    try:
        # new signature
        return allow_free_use(req, user_id=user_id, plan=plan)
    except TypeError:
        try:
            # legacy signature
            return allow_free_use(user_id, plan)
        except TypeError:
            return True, {}

# ---------- small helpers only used by routes ----------
PDF_CSS_OVERRIDES = """
@page { size: A4; margin: 0.75in; }
* { box-shadow: none !important; }
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

def _normalize_ctx(data: dict) -> dict:
    first = (data.get("firstName") or "").strip()
    last  = (data.get("lastName") or "").strip()
    derived = " ".join([p for p in (first, last) if p]).strip()
    name = (data.get("name") or data.get("fullName") or data.get("full_name") or derived or "").strip()

    ctx = dict(data)
    ctx["name"] = name
    ctx["fullName"] = name
    ctx["full_name"] = name

    skills = ctx.get("skills") or []
    if isinstance(skills, str):
        skills = [s.strip() for s in re.split(r"[,\n]", skills) if s.strip()]
    ctx["skills"] = skills

    certs = ctx.get("certifications") or []
    if isinstance(certs, str):
        certs = [c.strip() for c in certs.splitlines() if c.strip()]
    ctx["certifications"] = certs

    ctx["experience"] = ctx.get("experience") or []
    ctx["education"]  = ctx.get("education")  or []
    ctx["links"]      = ctx.get("links")      or []
    return ctx

def naive_context(data: dict) -> dict:
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

    education = [{"degree": edu_txt, "school": "", "location": "", "graduated": ""}] if edu_txt else []
    bullets = [re.sub(r'^[\-\•]\s*', '', ln).strip() for ln in exp_txt.splitlines() if ln.strip()]
    experience = [{
        "role": title or "Experience", "company": "", "location": "",
        "start": "", "end": "", "bullets": bullets
    }] if bullets else []

    links = [{"url": portfolio, "label": "Portfolio"}] if portfolio else []
    return {"name": name, "title": title, "contact": contact, "summary": summary,
            "skills": skills, "links": links, "experience": experience,
            "education": education, "certifications": certifications}

# ========== ROUTES ==========

# 1) AI resume analysis (single authoritative route)
@resumes_bp.post("/api/resume-analysis")
@login_required
def api_resume_analysis():
    try:
        supabase_admin = current_app.config["SUPABASE_ADMIN"]
        plan = (getattr(current_user, "plan", "free") or "free").lower()

        ok, guard = _allow_free(request, user_id=current_user.id, plan=plan)
        if not ok:
            return jsonify(
                error="too_many_free_accounts",
                message=(guard or {}).get("message")
                        or "You have reached the limit for the free version, upgrade to enjoy more features"
            ), 429

        feature = "resume_analyzer"
        allowed, info = check_and_increment(supabase_admin, current_user.id, plan, feature)
        if not allowed:
            info = info or {}
            info.setdefault("error", "quota_exceeded")
            return jsonify(info), 402

        data = request.get_json(silent=True) or {}
        # Accept text or (pdf/docx) payloads; require at least one
        has_text = bool((data.get("text") or "").strip())
        has_pdf  = bool(data.get("pdf"))
        has_docx = bool(data.get("docx"))
        if not (has_text or has_pdf or has_docx):
            return jsonify(error="bad_request", message="Provide resume text, pdf, or docx."), 400

        result = run_analyzer(data)  # should handle text/pdf/docx internally
        return jsonify(result), 200

    except Exception:
        current_app.logger.exception("Unhandled error in /api/resume-analysis")
        return jsonify(error="server_error", message="Analysis failed. Please try again."), 500

# 2) Template resume → HTML/PDF
@resumes_bp.post("/build-resume")
@login_required
def build_resume():
    data  = request.get_json(force=True) or {}
    theme = (data.get("theme") or "modern").lower()
    fmt   = (data.get("format") or "html").lower()

    ctx = _normalize_ctx(data)
    tpl_ctx = {
        "name": ctx.get("name",""),
        "title": ctx.get("title",""),
        "contact": ctx.get("contact",""),
        "summary": ctx.get("summary",""),
        "skills": ctx.get("skills",[]),
        "links": ctx.get("links",[]),
        "experience": ctx.get("experience",[]),
        "education": ctx.get("education",[]),
        "certifications": ctx.get("certifications",[]),
    }

    template_path = f"resumes/{'minimal' if theme == 'minimal' else 'modern'}.html"
    html = render_template(template_path, for_pdf=(fmt == "pdf"), **tpl_ctx)

    if fmt == "pdf":
        plan = (getattr(current_user, "plan", "free") or "free").lower()
        role = (getattr(current_user, "role", "") or "").lower()
        is_admin = role in ("admin","superadmin")
        if not is_admin and not feature_enabled(plan, "downloads"):
            return jsonify(error="upgrade_required",
                           message="File downloads are available on Standard and Premium."), 403

        stylesheets = [CSS(string=PDF_CSS_OVERRIDES)]
        pdf_css_path = os.path.join(current_app.root_path, "static", "pdf.css")
        if os.path.exists(pdf_css_path):
            stylesheets.append(CSS(filename=pdf_css_path))

        pdf_bytes = HTML(string=html, base_url=current_app.root_path).write_pdf(stylesheets=stylesheets)
        resp = make_response(pdf_bytes)
        resp.headers["Content-Type"] = "application/pdf"
        resp.headers["Content-Disposition"] = "inline; filename=resume.pdf"
        return resp

    resp = make_response(html)
    resp.headers["Content-Type"] = "text/html; charset=utf-8"
    return resp

# 3) Template resume → DOCX
@resumes_bp.post("/build-resume-docx")
@login_required
def build_resume_docx():
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    role = (getattr(current_user, "role", "") or "").lower()
    is_admin = role in ("admin","superadmin")
    if not is_admin and not feature_enabled(plan, "downloads"):
        return jsonify(error="upgrade_required",
                       message="File downloads are available on Standard and Premium."), 403

    data = request.get_json(force=True) or {}
    ctx  = _normalize_ctx(data)

    tpl_path = os.path.join(current_app.root_path, "templates", "resumes", "clean.docx")
    tpl = DocxTemplate(tpl_path)
    tpl.render({
        "name": ctx.get("name",""), "title": ctx.get("title",""), "summary": ctx.get("summary",""),
        "experience": ctx.get("experience",[]), "education": ctx.get("education",[]),
        "skills": ctx.get("skills",[]), "contact": ctx.get("contact",""), "links": ctx.get("links",[]),
        "certifications": ctx.get("certifications",[])
    })

    buf = BytesIO(); tpl.save(buf); buf.seek(0)
    return send_file(buf, as_attachment=True, download_name="resume.docx")

# 4) AI optimize resume text
@resumes_bp.post("/api/optimize-resume")
@login_required
def optimize_resume():
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    role = (getattr(current_user, "role", "") or "").lower()
    is_admin = role in ("admin","superadmin")
    if not is_admin and not feature_enabled(plan, "optimize_ai"):
        return jsonify(error="upgrade_required",
                       message="Optimize with AI is available on Standard and Premium."), 403

    client = current_app.config["OPENAI_CLIENT"]
    data = request.get_json(force=True)
    resume_text = ""

    if data.get("pdf"):
        try:
            pdf_bytes = base64.b64decode(data["pdf"])
            reader = PdfReader(BytesIO(pdf_bytes))
            resume_text = "\n".join((p.extract_text() or "") for p in reader.pages)
            if not resume_text.strip():
                return jsonify(error="PDF content appears to have no selectable text (likely scanned). Upload a text-based PDF or DOCX."), 400
        except Exception:
            logging.exception("PDF Decode Error")
            return jsonify(error="Unable to extract PDF text (corrupt or scanned). Upload a text-based PDF or DOCX."), 400
    elif data.get("docx"):
        try:
            docx_bytes = base64.b64decode(data["docx"])
            d = docx.Document(BytesIO(docx_bytes))
            resume_text = "\n".join(p.text for p in d.paragraphs)
            if not resume_text.strip():
                return jsonify(error="DOCX appears empty. Please check the file content."), 400
        except Exception:
            logging.exception("DOCX Decode Error")
            return jsonify(error="Unable to read DOCX. Re-save as .docx and try again."), 400
    elif data.get("text"):
        resume_text = (data.get("text") or "").strip()
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
        optimized = (resp.choices[0].message.content or "").strip()
        optimized = re.sub(r"```(?:[\s\S]*?)```", "", optimized).strip()
        return jsonify({"optimized": optimized})
    except Exception:
        logging.exception("Resume optimization error")
        return jsonify(error="Resume optimization failed"), 500

# 5) AI generate structured resume JSON
@resumes_bp.post("/generate-resume")
@login_required
def generate_resume():
    # --- NEW: guard + quota for resume_builder ---
    try:
        supabase_admin = current_app.config["SUPABASE_ADMIN"]
        plan = (getattr(current_user, "plan", "free") or "free").lower()

        ok, guard = _allow_free(request, user_id=current_user.id, plan=plan)
        if not ok:
            return jsonify(
                error="too_many_free_accounts",
                message=(guard or {}).get("message") or "You have reached the limit for the free version, upgrade to enjoy more features"
            ), 429

        allowed, info = check_and_increment(supabase_admin, current_user.id, plan, "resume_builder")
        if not allowed:
            info = info or {}
            info.setdefault("error", "quota_exceeded")
            return jsonify(info), 402
    except Exception:
        current_app.logger.exception("metering error on /generate-resume")
        return jsonify(error="server_error", message="Something went wrong. Please try again."), 500
    # ------------------------------------------------

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
        return [s.strip() for s in str(val).replace("\r","").split("\n") if s.strip()]

    try:
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role":"user","content":prompt}],
            temperature=0.2
        )
        content = (resp.choices[0].message.content or "").strip()
        content = re.sub(r"```(?:json)?", "", content).strip()
        ctx = json.loads(content)

        first = (data.get("firstName") or "").strip()
        last  = (data.get("lastName") or "").strip()
        derived = " ".join([p for p in (first, last) if p]).strip()
        ctx.setdefault("name",  (data.get("fullName") or derived or ""))
        ctx.setdefault("title", (data.get("title") or ""))
        ctx.setdefault("contact", (data.get("contact") or ""))

        if isinstance(ctx.get("skills"), str):
            ctx["skills"] = [s.strip() for s in ctx["skills"].replace(",", "\n").splitlines() if s.strip()]
        ctx["certifications"] = _coerce_list(ctx.get("certifications")) or _coerce_list(data.get("certifications"))
        return jsonify(context=ctx, aiUsed=True)

    except Exception as e:
        current_app.logger.warning("generate-resume fallback: %s", e)
        return jsonify(context=naive_context(data), aiUsed=False, error_code="error")

# 6) AI suggest bullets/summary/cover-letter body
@resumes_bp.post("/ai/suggest")
@login_required
def ai_suggest():
    data  = request.get_json(force=True) or {}
    field = (data.get("field") or "general").strip().lower()

    # --- NEW: guard + quota (feature depends on field) ---
    try:
        supabase_admin = current_app.config["SUPABASE_ADMIN"]
        plan = (getattr(current_user, "plan", "free") or "free").lower()

        ok, guard = _allow_free(request, user_id=current_user.id, plan=plan)
        if not ok:
            return jsonify(
                error="too_many_free_accounts",
                message=(guard or {}).get("message") or "You have reached the limit for the free version, upgrade to enjoy more features"
            ), 429

        feature = "cover_letter" if field in ("coverletter","coverletter_from_analyzer","cover_letter") else "resume_builder"
        allowed, info = check_and_increment(supabase_admin, current_user.id, plan, feature)
        if not allowed:
            info = info or {}
            info.setdefault("error", "quota_exceeded")
            return jsonify(info), 402
    except Exception:
        current_app.logger.exception("metering error on /ai/suggest")
        return jsonify(error="server_error", message="Something went wrong. Please try again."), 500
    # -----------------------------------------------------

    ctx   = data.get("context") or {}
    client = current_app.config.get("OPENAI_CLIENT")

    def normalize(text="", items=None):
        items = items if isinstance(items, list) else None
        if not items and text:
            items = [ln.strip("•- ").strip() for ln in text.splitlines() if ln.strip()]
        if not text and items:
            text = "\n".join(items)
        return {"text": text or "", "list": items or [], "suggestions": items or []}

    if field in ("coverletter","coverletter_from_analyzer","cover_letter"):
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
                    messages=[{"role":"user","content":prompt}],
                    temperature=0.6, max_tokens=600
                )
                out = (resp.choices[0].message.content or "").strip()
                out = re.sub(r"```(?:\w+)?", "", out).strip()
                return jsonify({"text": out, "list": [], "suggestions": []})
            except Exception as e:
                current_app.logger.warning("cover letter AI error; fallback: %s", e)
        text = (
            f"As an experienced {title.lower()} with a strong record of supporting teams and customers, "
            f"I’m excited to apply for the {role} role at {company}. ..."
        )
        return jsonify({"text": text, "list": [], "suggestions": []})

    def compact_context(c):
        parts = []
        nm, ti = c.get("name"), c.get("title")
        sm, ct = c.get("summary"), c.get("contact")
        if nm or ti: parts.append(f"Name/Title: {nm or ''} {ti or ''}".strip())
        if ct: parts.append(f"Contact: {ct}")
        exps = c.get("experience") or []
        if exps:
            e0 = exps[0]
            parts.append(f"Recent role: {e0.get('role','')} at {e0.get('company','')} ({e0.get('location','')}) {e0.get('start','')}-{e0.get('end','')}")
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
            if 0 <= idx < len(exps): exp = exps[idx]
        exp_ctx = ""
        if exp:
            exp_ctx = (
                f"Role: {exp.get('role','')}\nCompany: {exp.get('company','')}\nLocation: {exp.get('location','')}\n"
                f"Dates: {exp.get('start','')} – {exp.get('end','')}\nExisting bullets: {(exp.get('bullets') or [])}"
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

    if client:
        try:
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role":"system","content":"You are an expert resume writer. Be concise and ATS-friendly."},
                          {"role":"user","content":prompt}],
                temperature=0.5, max_tokens=220
            )
            out = (resp.choices[0].message.content or "").strip()
            return jsonify(normalize(out))
        except Exception as e:
            current_app.logger.warning("ai_suggest error; fallback: %s", e)

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

# 7) Cover-letter builder → HTML/PDF
@resumes_bp.post("/build-cover-letter")
@login_required
def build_cover_letter():
    plan = (getattr(current_user, "plan", "free") or "free").lower()
    role = (getattr(current_user, "role", "") or "").lower()
    is_admin = role in ("admin","superadmin")

    supabase_admin = current_app.config["SUPABASE_ADMIN"]
    allowed, info = check_and_increment(supabase_admin, current_user.id, plan, "cover_letter")
    if not allowed:
        info = info or {}
        info.setdefault("error", "quota_exceeded")
        return jsonify(info), 402

    try:
        data = request.get_json(force=True) or {}
    except Exception:
        current_app.logger.exception("build-cover-letter: bad JSON")
        return jsonify(error="Invalid JSON body"), 400

    fmt = (data.get("format") or "html").lower()
    try:
        html = render_template(
            "cover-letter.html",
            name=data.get("name",""), title=data.get("title",""), contact=data.get("contact",""),
            sender=(data.get("sender") or {}), recipient=(data.get("recipient") or {}),
            draft=(data.get("coverLetter") or {}).get("draft","").strip(),
            letter_only=(fmt == "pdf" or bool(data.get("letter_only"))),
            for_pdf=(fmt == "pdf"),
        )
    except Exception:
        current_app.logger.exception("cover-letter template render failed")
        return jsonify(error="Template error"), 500

    if fmt == "pdf":
        try:
            pdf_bytes = HTML(string=html, base_url=current_app.root_path).write_pdf(
                stylesheets=[CSS(string="@page{size:A4;margin:0.75in}")]
            )
            return send_file(BytesIO(pdf_bytes), mimetype="application/pdf",
                             as_attachment=True, download_name="cover-letter.pdf")
        except Exception:
            current_app.logger.exception("cover-letter PDF failed")
            return jsonify(error="PDF generation failed"), 500

    resp = make_response(html)
    resp.headers["Content-Type"] = "text/html; charset=utf-8"
    return resp
