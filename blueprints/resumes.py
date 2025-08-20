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

# === ATS model: weights and deterministic checks ===
import math, datetime, collections, statistics, itertools, re

# We’ll use this to approximate pages for text resumes (PDF page count is not reliable post-OCR)
WORDS_PER_PAGE = 600

MONTHS = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)"
DATE_PAT = re.compile(
    rf"\b({MONTHS})\.?\s+\d{{4}}|\b\d{{4}}\b", re.I
)  # "Jan 2021" or "2021"

EMAIL_PAT = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
PHONE_PAT = re.compile(r"\+?\d[\d\-\s()]{7,}\d")
LOC_PAT   = re.compile(r"\b([A-Z][a-z]+(?:[ ,][A-Z][a-z]+)*)\b")  # very light

# Weak/buzzwords and action verbs
ACTION_VERBS_STRONG = {
    "achieved","analyzed","built","configured","created","delivered","designed","developed","drove",
    "implemented","improved","increased","launched","led","managed","optimized","owned","resolved",
    "reduced","shipped","streamlined","spearheaded","supported","automated","coordinated","deployed",
    "orchestrated","migrated","modernized","scaled","mentored"
}
WEAK_PHRASES = {
    "responsible for","helped","assisted","worked on","participated in","involved in"
}
BUZZWORDS = {
    "synergy","go-getter","outside the box","hard worker","team player","self-starter",
    "results-driven","rockstar","guru","ninja","dynamic","best-in-class","fast-paced"
}
PERSONAL_DATA = {"marital status","religion","nationality","date of birth","dob","photo","photograph"}

CERT_HINTS = {"aws","amazon web services","itil","pmp","cissp","cisa","az-","ms-","scrum","csm","ccna"}

BULLET_MARKERS = ("•","-","–","—","*")

def _clean_lines(text: str):
    return [ln.strip() for ln in text.splitlines() if ln.strip()]

def _tokenize(text: str):
    return re.findall(r"[A-Za-z][A-Za-z+\-/#0-9]*", text.lower())

def _split_sections(text: str):
    """Roughly split into named sections so we can measure distribution."""
    lines = _clean_lines(text)
    sections = collections.OrderedDict()
    cur = "_start"
    sections[cur] = []
    for ln in lines:
        low = ln.lower()
        if len(ln) <= 48 and re.match(r"^[A-Z][A-Za-z &/]+$", ln):
            if any(k in low for k in ("experience","work","employment","education","skills","projects","certification","summary","objective")):
                cur = low.split()[0]
                sections[cur] = []
                continue
        sections[cur].append(ln)
    return sections

def _extract_roles_with_dates(text: str):
    """Return list of roles with date hints + lines (to weight recency and detect gaps)."""
    sections = _split_sections(text)
    all_lines = list(itertools.chain.from_iterable(sections.values()))
    roles = []
    buf = []
    for ln in all_lines:
        if DATE_PAT.search(ln):
            # close previous
            if buf:
                roles.append({"lines": buf[:]})
                buf.clear()
        buf.append(ln)
    if buf:
        roles.append({"lines": buf[:]})

    # Very light date parsing (year only); newest first assumption if “present/current” exists
    now = datetime.date.today().year
    for r in roles:
        years = [int(y) for y in re.findall(r"\b(20\d{2}|19\d{2})\b", " ".join(r["lines"]))]
        r["start"] = (min(years) if years else None)
        r["end"]   = (now if re.search(r"\b(present|current)\b", " ".join(r["lines"]), re.I) else (max(years) if years else None))
    return roles

def _years_of_experience(roles):
    yrs = 0
    for r in roles:
        if r.get("start") and r.get("end"):
            yrs += max(0, r["end"] - r["start"])
    return yrs

def _has_action_verb_start(line: str):
    s = line
    s = re.sub(r"^(\*|•|-|\u2022|\u25CF)\s+", "", s)
    m = re.match(r"^([A-Za-z\-']+)", s)
    w = m.group(1).lower() if m else ""
    return w in ACTION_VERBS_STRONG, w

def _quant_stats(text: str):
    lines = _clean_lines(text)
    bullets = [ln for ln in lines if ln[:2] in ( "- ", "* ", "• ") or (ln and ln[0] in BULLET_MARKERS)]
    if not bullets:
        bullets = [ln for ln in lines if ln.startswith("-") or ln.startswith("•") or ln.startswith("*")]
    has_num = [bool(re.search(r"(\d+(\.\d+)?%|\$?\£?\€?\d+[kKmM]?|reduced|increased|saved|cut|grew|boosted)", b, re.I)) for b in bullets]
    starts  = [_has_action_verb_start(b)[0] for b in bullets]
    avg_len = statistics.mean([len(b.split()) for b in bullets]) if bullets else 0
    return {
        "bullet_count": len(bullets),
        "pct_with_numbers": int(round(100*sum(has_num)/max(1,len(bullets)))),
        "pct_action_starts": int(round(100*sum(starts)/max(1,len(bullets)))),
        "avg_words_per_bullet": round(avg_len,1)
    }

def _parse_and_format_score(resume_text: str, file_kind: str, raw_bytes: bytes|None):
    # 1) selectable text
    selectable = len(resume_text.strip()) >= 180
    s1 = 4 if selectable else 0

    # 2) file type
    s2 = 2 if file_kind in ("docx","pdf") else 0

    # 3) parsing traps: tables/columns/headers—heuristics
    txt = resume_text
    traps = 0
    if re.search(r"\|.+\|", txt): traps += 1               # ascii tables
    if txt.count("\t") > 30: traps += 1                    # tabular layout
    if re.search(r"\s{4,}\S", txt): traps += 1             # multi-column alignment
    s3 = max(0, 3 - traps)

    # 4) standard bullets/fonts (we can only check bullets)
    s4 = 1 if re.search(r"(^|\n)\s*(?:•|\-|\*)\s+", txt) else 0

    # image-only PDF heuristic (bytes >> text)
    hard_fail = False
    if raw_bytes and file_kind == "pdf":
        bpc = len(raw_bytes) / max(1, len(txt.encode("utf-8")))
        if selectable is False or bpc > 60:
            hard_fail = True

    return (0 if hard_fail else (s1+s2+s3+s4)), hard_fail

def _sections_structure_score(text: str):
    sec = _split_sections(text)
    has_std = {
        "experience": any("experience" in k for k in sec.keys()),
        "education": any("education" in k for k in sec.keys()),
        "skills": any("skills" in k for k in sec.keys()),
        "certs": any("certification" in k for k in sec.keys()),
    }
    base = 0
    base += 2 if EMAIL_PAT.search(text) else 0
    base += 2 if PHONE_PAT.search(text) else 0
    base += 1 if LOC_PAT.search(text) else 0

    # reverse chronological & date presence (very rough)
    roles = _extract_roles_with_dates(text)
    dated   = sum(1 for r in roles if r.get("start") or r.get("end"))
    chrono  = 1 if len(roles) < 2 else int(all((roles[i].get("end") or 0) >= (roles[i+1].get("end") or 0) for i in range(len(roles)-1)))
    rc = min(5, dated) + chrono  # max 6 for this part

    return {
        "score": (8 * sum(has_std.values())/4) + min(5, rc) + base,  # cap at 15
        "std": has_std,
        "reverse_chrono": bool(chrono),
        "roles_parsed": len(roles)
    }

def _build_jd_terms(jd: str):
    """Very light extractor: skills/tools/certs/titles/domains + synonym/acro maps."""
    toks = _tokenize(jd)
    raw = set(toks)
    # acronyms → full and back
    acronyms = {
        "aws": "amazon web services",
        "ad": "active directory",
        "sql": "structured query language",
        "k8s": "kubernetes",
        "mdm": "mobile device management",
        "sso": "single sign on"
    }
    synonyms = {
        "sysadmin": ["systems administrator"],
        "helpdesk": ["service desk","it support"],
        "it support": ["technical support", "service desk"],
        "pm": ["project manager"]
    }
    expanded = set(raw)
    for a, full in acronyms.items():
        if a in raw: expanded.add(full)
        if full in raw: expanded.add(a)
    for k, vs in synonyms.items():
        if k in raw:
            expanded.update(vs)
        if any(v in raw for v in vs):
            expanded.add(k)

    # very rough category guesses
    certs  = [w for w in expanded if any(c in w for c in CERT_HINTS)]
    titles = [w for w in expanded if any(t in w for t in ("engineer","analyst","manager","administrator","specialist","developer"))]
    skills = list(expanded - set(certs) - set(titles))
    return {"skills": skills, "titles": titles, "certs": certs, "all": list(expanded), "acronyms": acronyms}

def _keyword_match_to_jd(resume_text: str, jd_terms: dict, roles: list):
    if not jd_terms["all"]:
        return {"score": 0, "matched": [], "missing": [], "distribution_ok": True}

    txt = resume_text.lower()
    hits = collections.Counter()
    for term in jd_terms["all"]:
        if len(term) < 3: 
            continue
        # fuzzy-ish: accept exact token or spaced variant
        if term in txt or re.search(rf"\b{re.escape(term)}\b", txt):
            hits[term] += 1

    # cap repeats at 3
    capped = {k: min(3, v) for k, v in hits.items()}

    # recency weighting: lines from “last two roles” = 1.0 else 0.6 / 0.3
    weights = {}
    if roles:
        recent = roles[:2]
        recent_txt = " ".join(" ".join(r["lines"]).lower() for r in recent)
        older_txt  = " ".join(" ".join(r["lines"]).lower() for r in roles[2:])
        for t in capped.keys():
            w = 0
            if t in recent_txt: w += 1.0
            if t in older_txt:  w += 0.6
            if w == 0 and t in txt: w = 0.3
            weights[t] = w
    else:
        weights = {t:1.0 for t in capped.keys()}

    weighted = sum(capped[t]*weights.get(t,1.0) for t in capped.keys())
    # normalize against target: assume 20 meaningful terms for scale
    denom = max(10, len(jd_terms["all"]))
    raw_score = min(1.0, weighted / (denom * 0.6))  # tighter bar
    score = int(round(100 * raw_score))

    # distribution (not only in "skills" section)
    sections = _split_sections(resume_text)
    skills_blob = " ".join(sections.get("skills", []))
    in_skills = sum(1 for t in capped.keys() if t in skills_blob.lower())
    distribution_ok = in_skills < max(2, int(0.6 * len(capped)))

    missing = [t for t in jd_terms["all"] if t not in capped]
    return {"score": score, "matched": list(capped.keys()), "missing": missing, "distribution_ok": distribution_ok}

def _experience_relevance(jd_text: str, roles: list, resume_text: str):
    # years vs requirement
    m = re.search(r"(\d+)\+?\s+years", jd_text, re.I)
    req = int(m.group(1)) if m else None
    yoe = _years_of_experience(roles)
    years_ok = (yoe >= req) if req else (yoe >= 2)
    s_years = 6 if years_ok else max(0, int(6 * (yoe / max(1, req or 6))))

    # seniority fit via titles progression
    titles = [ln.lower() for r in roles for ln in r["lines"][:2]]
    has_lead = any(re.search(r"\b(lead|manager|senior|principal)\b", t) for t in titles)
    s_senior = 4 if has_lead or yoe >= 5 else 2 if yoe >= 3 else 1

    # recency coverage: JD verbs overlap in recent roles
    verbs = {"implement","migrate","optimize","build","design","automate","support","troubleshoot","manage"}
    recent_txt = " ".join(" ".join(r["lines"]).lower() for r in roles[:2])
    overlap = len([v for v in verbs if v in recent_txt])
    s_recent = 3 if overlap >= 4 else 2 if overlap >= 2 else 1

    # task-verb overlap (global)
    jd_verbs = {w for w in _tokenize(jd_text) if w in verbs}
    res_verbs= {w for w in _tokenize(resume_text) if w in verbs}
    s_task   = 2 if len(jd_verbs & res_verbs) >= 2 else 1 if (jd_verbs & res_verbs) else 0

    return {"score": s_years + s_senior + s_recent + s_task, "yoe": yoe, "req": req}

def _education_and_certs(resume_text: str, jd_terms: dict):
    score = 0
    if re.search(r"\b(bsc|msc|b\.?sc|m\.?sc|bachelor|master|degree)\b", resume_text, re.I):
        score += 3
    certs_found = [c for c in jd_terms["certs"] if c in resume_text.lower()]
    if certs_found: score += 3
    return {"score": score, "certs_found": certs_found}

def _eligibility_location(resume_text: str):
    score = 0
    if LOC_PAT.search(resume_text): score += 1
    if re.search(r"\b(eligible to work|work authorization|right to work|visa|relocat)\b", resume_text, re.I):
        score += 2
    return {"score": score}

def _readability_brevity(resume_text: str, level: str):
    words = len(_tokenize(resume_text))
    est_pages = max(1, int(round(words/WORDS_PER_PAGE)))
    # length target
    if level in ("exec","senior"):
        length_ok = est_pages <= 3
    else:
        length_ok = est_pages <= 2
    s_len = 3 if length_ok else 1

    # bullet density
    qs = _quant_stats(resume_text)
    within = 8 <= qs["avg_words_per_bullet"] <= 20 if qs["bullet_count"] else False
    s_bul = 3 if within else 1

    # consistency: simple date-format & punctuation presence
    dates = re.findall(r"(?:\b\d{2}/\d{4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{4})", resume_text, re.I)
    has_consistency = len(dates) >= 2
    s_con = 2 if has_consistency else 1
    return {"score": s_len + s_bul + s_con, "length_pages": est_pages, "bullets": qs}

def _penalties(resume_text: str, roles: list, hard_fail: bool):
    pts = 0
    reasons = []

    if hard_fail:
        return 100, ["Image-only/unparseable PDF"]

    # missing dates or employer (no years present across roles)
    if sum(1 for r in roles if r.get("start") or r.get("end")) == 0:
        pts += 5; reasons.append("Missing dates on roles")

    # stuffing: top term density
    toks = _tokenize(resume_text)
    if toks:
        counts = collections.Counter(toks)
        top, n = counts.most_common(1)[0]
        if n/len(toks) > 0.05 or n >= 25:
            pts += 4; reasons.append("Possible keyword stuffing")

    # non-standard headings pretending to be core
    if re.search(r"\bmy journey\b", resume_text, re.I):
        pts += 3; reasons.append("Non-standard headings")

    # gaps > 6 months (very rough: consecutive year gaps)
    years = sorted({r["start"] for r in roles if r.get("start")} | {r["end"] for r in roles if r.get("end")})
    for a, b in zip(years, years[1:]):
        if b - a >= 2:  # ~24 months
            pts += 3; reasons.append("Potential gaps")
            break

    # personal data
    if any(re.search(rf"\b{re.escape(p)}\b", resume_text, re.I) for p in PERSONAL_DATA):
        pts += 2; reasons.append("Personal data (DOB/photo/etc.)")

    return pts, reasons

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
    ATS scoring model (100 pts) + penalties, aligned to industry best practice.
    Preserves your existing response shape for the dashboard.
    """
    client = current_app.config.get("OPENAI_CLIENT")
    data = request.get_json(force=True) or {}

    # ---- Decode input ----
    resume_text, file_kind, raw_bytes = "", None, None
    try:
        if data.get("pdf"):
            raw_bytes = base64.b64decode(data["pdf"])
            reader = PdfReader(BytesIO(raw_bytes))
            resume_text = "\n".join((p.extract_text() or "") for p in reader.pages)
            file_kind = "pdf"
        elif data.get("docx"):
            raw_bytes = base64.b64decode(data["docx"])
            d = docx.Document(BytesIO(raw_bytes))
            resume_text = "\n".join(p.text for p in d.paragraphs)
            file_kind = "docx"
        elif data.get("text"):
            resume_text = (data["text"] or "").strip()
            file_kind = "text"
        else:
            return jsonify(error="No resume data provided"), 400
    except Exception:
        current_app.logger.exception("resume-analysis: decode failed")
        return jsonify(error="Could not read the resume file"), 400

    if not resume_text.strip():
        return jsonify(error="Could not extract any text"), 400

    job_desc = (data.get("jobDescription") or "").strip()
    job_role = (data.get("jobRole") or "").strip()
    level    = (data.get("careerLevel") or "mid").lower()

    # ---- 1) Deterministic ATS categories ----
    pf_score, hard_fail = _parse_and_format_score(resume_text, file_kind, raw_bytes)        # /10
    sec_struct   = _sections_structure_score(resume_text)                                   # /15
    roles        = _extract_roles_with_dates(resume_text)
    jd_terms     = _build_jd_terms(job_desc) if job_desc else {"all": [], "skills": [], "titles": [], "certs": [], "acronyms": {}}
    kw_match     = _keyword_match_to_jd(resume_text, jd_terms, roles)                       # /35 (normalized 0–100)
    exp_rel      = _experience_relevance(job_desc, roles, resume_text)                      # /15
    quant        = _quant_stats(resume_text)                                                # for achievements
    ach_score    = (5 if quant["pct_with_numbers"] >= 50 else int(5 * quant["pct_with_numbers"]/50)) \
                   + (3 if quant["pct_action_starts"] >= 70 else int(3 * quant["pct_action_starts"]/70))  # /8
    edu_certs    = _education_and_certs(resume_text, jd_terms)                              # /6
    elig_loc     = _eligibility_location(resume_text)                                       # /3
    read_brief   = _readability_brevity(resume_text, level)                                 # /8
    pen_pts, pen_reasons = _penalties(resume_text, roles, hard_fail)                        # up to -20

    # ---- 2) Assemble score (100) ----
    # Normalize keyword score (already 0–100) into 35-pt bucket, etc.
    score = 0
    score += pf_score                                # 10
    score += min(15, sec_struct["score"])            # 15
    score += int(round(35 * (kw_match["score"]/100)))# 35
    score += min(15, exp_rel["score"])               # 15
    score += min(8,  ach_score)                      # 8
    score += min(6,  edu_certs["score"])             # 6
    score += min(3,  elig_loc["score"])              # 3
    score += min(8,  read_brief["score"])            # 8

    score = max(0, min(100, score - min(20, pen_pts)))

    # ---- 3) Optional LLM pass for qualitative output (grammar/suggestions/keywords) ----
    llm = {"analysis":{"issues":[],"strengths":[]}, "suggestions":[], "writing":{"readability":"","repetition":[],"grammar":[]},
           "keywords":{"matched": kw_match.get("matched",[]), "missing": kw_match.get("missing",[])},
           "relevance":{"role": job_role, "score": 0, "explanation":"","aligned_keywords":[],"missing_keywords":[]}}
    if client:
        try:
            role_or_desc = f"Job description:\n{job_desc}" if job_desc else (f"Target role: {job_role}" if job_role else "No job description provided.")
            prompt = f"""
You are an ATS-certified resume analyst. Return ONLY valid JSON (no backticks) with:
{{
  "analysis": {{"issues": ["..."], "strengths": ["..."]}},
  "suggestions": ["..."],
  "writing": {{
    "readability": "Grade level (e.g., Grade 8–10 / B2)",
    "repetition": [{{"term":"managed","count":5,"alternatives":["led","owned","coordinated"]}}],
    "grammar": ["Short, actionable fixes."]
  }},
  "relevance": {{
    "role": "{job_role}",
    "score": 0-100,
    "explanation": "1–2 sentences",
    "aligned_keywords": ["..."],
    "missing_keywords": ["..."]
  }}
}}
Context:\n{role_or_desc}\n\nResume:\n{resume_text[:8000]}
""".strip()
            resp = client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role":"user","content":prompt}],
                temperature=0.0
            )
            content = (resp.choices[0].message.content or "").strip()
            content = re.sub(r"```(?:json)?", "", content)
            s,e = content.find("{"), content.rfind("}")
            if s>=0 and e>s:
                js = json.loads(content[s:e+1])
                for k,v in js.items(): llm[k] = v
        except Exception:
            current_app.logger.warning("LLM step skipped; continuing with deterministic output", exc_info=True)

    # ---- 4) Map to your existing breakdown keys so UI stays the same ----
    breakdown = {
        "formatting": int(round((pf_score/10)*100)),
        "keywords":   kw_match["score"],
        "sections":   int(round((sec_struct["score"]/15)*100)),
        "readability": int(round((read_brief["score"]/8)*100)),   # proxy
        "length":     int(round((min(3, read_brief["score"])/3)*100)),  # length component only
        "parseable":  (not hard_fail)
    }

    # Extra diagnostics (you can surface these later in the UI)
    diagnostics = {
        "achievements": quant,
        "eligibility_location": elig_loc,
        "education_certs": edu_certs,
        "experience_relevance": exp_rel,
        "keyword_distribution_ok": kw_match["distribution_ok"],
        "penalties": {"points": pen_pts, "reasons": pen_reasons},
        "roles_parsed": roles[:4],
        "length_pages_est": read_brief["length_pages"]
    }

    # ---- 5) Final payload (keeps your keys) ----
    out = {
        "score": int(score),
        "analysis": {
            "issues": llm.get("analysis",{}).get("issues", []),
            "strengths": llm.get("analysis",{}).get("strengths", [])
        },
        "suggestions": llm.get("suggestions", []),
        "breakdown": breakdown,
        "keywords": {"matched": kw_match["matched"], "missing": kw_match["missing"]},
        "sections": {
            "present": [k for k,v in sec_struct["std"].items() if v],
            "missing": [k for k,v in sec_struct["std"].items() if not v]
        },
        "writing": {
            "readability": llm.get("writing",{}).get("readability",""),
            "repetition": llm.get("writing",{}).get("repetition", []),
            "grammar": llm.get("writing",{}).get("grammar", [])
        },
        "relevance": llm.get("relevance", {}),
        "diagnostics": diagnostics
    }

    # Add automatic, concrete fixes based on this model
    fixes = []
    if breakdown["length"] < 70:
        fixes.append("Expand to 1–2 pages with impact bullets (8–20 words each).")
    if kw_match["score"] < 60:
        fixes.append("Target missing JD keywords inside experience bullets, not only in Skills.")
    if quant["pct_with_numbers"] < 50:
        fixes.append("Add hard numbers (%, $, time saved, counts) to at least half of recent bullets.")
    if not sec_struct["std"]["experience"] or not sec_struct["reverse_chrono"]:
        fixes.append("Use a reverse-chronological Work Experience section with title, employer, location, and MM/YYYY dates.")
    if pen_pts:
        fixes.append("Remove red flags: " + "; ".join(pen_reasons))
    out["analysis"]["issues"] = (out["analysis"]["issues"] or []) + fixes

    return jsonify(out), 200
