# routes_resume.py
from flask import Blueprint, render_template, request, make_response, send_file
from weasyprint import HTML
from docxtpl import DocxTemplate
import io

bp = Blueprint("resumes", __name__)

@bp.post("/build-resume")
def build_resume():
    data = request.get_json(force=True)
    theme = data.get("theme", "modern")  # 'modern' or 'minimal'
    fmt   = data.get("format", "html")   # 'html' or 'pdf'

    context = {
        "name": data.get("fullName", ""),
        "title": data.get("title", ""),
        "contact": data.get("contact", ""),
        "summary": data.get("summary", ""),
        "education": data.get("education", []),
        "experience": data.get("experience", []),
        "skills": data.get("skills", []),
        "links": data.get("links", []),
    }

    html = render_template(f"resumes/{theme}.html", **context)

    if fmt == "pdf":
        pdf = HTML(string=html, base_url=request.url_root).write_pdf()
        resp = make_response(pdf)
        resp.headers["Content-Type"] = "application/pdf"
        resp.headers["Content-Disposition"] = "inline; filename=resume.pdf"
        return resp

    return html

@bp.post("/build-resume-docx")
def build_resume_docx():
    data = request.get_json(force=True)
    tpl = DocxTemplate("templates/resumes/clean.docx")
    tpl.render({
        "name": data["fullName"],
        "title": data["title"],
        "summary": data["summary"],
        "experience": data["experience"],
        "education": data["education"],
        "skills": data["skills"]
    })
    buf = io.BytesIO()
    tpl.save(buf); buf.seek(0)
    return send_file(buf, as_attachment=True, download_name="resume.docx")
