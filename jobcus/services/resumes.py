# jobcus/services/resumes.py
from __future__ import annotations

import base64, re, json, logging
from io import BytesIO
import math, datetime, collections, statistics, itertools

from flask import current_app
import docx
from PyPDF2 import PdfReader

# ========= Constants / Patterns =========
WORDS_PER_PAGE = 600
MONTHS = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
DATE_PAT = re.compile(rf"\b{MONTHS}\s+\d{{4}}\b|\b\d{{1,2}}/\d{{4}}\b|\b(20\d{{2}}|19\d{{2}})\b", re.I)
EMAIL_PAT = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
PHONE_PAT = re.compile(r"\+?\d[\d\-\s()]{7,}\d")
LOC_PAT   = re.compile(r"\b([A-Z][a-z]+(?:[ ,][A-Z][a-z]+)*)\b")
BULLET_MARKERS = ("•","-","–","—","*")
PERSONAL_DATA  = {"marital status","religion","nationality","date of birth","dob","photo","photograph"}

ACTION_VERBS_STRONG = {
    "achieved","analyzed","built","configured","created","delivered","designed","developed","drove",
    "implemented","improved","increased","launched","led","managed","optimized","owned","resolved",
    "reduced","shipped","streamlined","spearheaded","supported","automated","coordinated","deployed",
    "orchestrated","migrated","modernized","scaled","mentored"
}
WEAK_PHRASES = {"responsible for","helped","assisted","worked on","participated in","involved in"}
BUZZWORDS    = {"synergy","go-getter","outside the box","hard worker","team player","self-starter",
                "results-driven","rockstar","guru","ninja","dynamic","best-in-class","fast-paced"}

STOPWORDS_KW = {
    "a","an","and","the","of","for","with","from","into","onto","within","across","about","above","below",
    "under","over","at","by","to","in","on","as","is","are","was","were","be","been","being","it","its","this",
    "that","those","these","your","you","our","their","my","we","or","nor","not","but","if","then","so","than",
    "very","more","most","can","will","would","should","could","may","might","etc","currently","presently",
    "strong","solid","excellent","good","great","private","public","sector","known","having","combines",
    "background","bridge","secure"
}
NOISE_VERBS = {"led","lead","manage","managed","own","owned","coordinate","coordinated","work","worked",
               "help","helped","assist","assisted","support","supported","drive","drove"}
NOISE_NOUNS = {"experience","summary","objective","profile","responsibilities","duties","team","teams",
               "environment","company","organization","client","customers","role","position","project","projects"}

SKILL_HINTS = {
    "agile","scrum","kanban","waterfall","prince2","pmp","itil","change","risk","stakeholder","stakeholders",
    "governance","scope","budget","timeline","schedule","roadmap","dependency","dependencies","ra id","raid",
    "risk register","issue log","project charter","business case","u at","uat","test plan","qa","kpi","okrs","okr",
    "jira","confluence","microsoft project","ms project","azure devops","power bi","excel","visio","sharepoint",
    "service now","servicenow","sql","api","sd lc","sdlc"
}
TITLE_HINTS  = {"project manager","delivery manager","scrum master","program manager"}
DOMAIN_HINTS = {"healthcare","fintech","ecommerce","telecom","banking","government","cloud","security","cybersecurity"}
CERT_HINTS   = {"aws","amazon web services","itil","pmp","cissp","cisa","az-","ms-","scrum","csm","ccna"}

# ========= Low-level helpers =========
def _is_acronym(w: str) -> bool:
    return 2 <= len(w) <= 6 and w.isupper()

def _tokenize(text: str):
    return re.findall(r"[A-Za-z][A-Za-z+\-/#0-9]*", (text or "").lower())

def _clean_kw_list(lst):
    out = []
    for t in lst or []:
        t = t.strip().lower()
        parts = re.findall(r"[a-z0-9+\-/#]+", t)
        while parts and parts[0] in STOPWORDS_KW: parts.pop(0)
        while parts and parts[-1] in STOPWORDS_KW: parts.pop()
        if not parts: continue
        cleaned = " ".join(parts)
        if (len(cleaned) < 3 and not _is_acronym(cleaned.upper())): continue
        if cleaned in STOPWORDS_KW or cleaned in NOISE_NOUNS or cleaned in NOISE_VERBS: continue
        out.append(cleaned)
    return sorted(set(out))

def _build_jd_terms(jd: str):
    if not jd:
        return {"skills": [], "titles": [], "certs": [], "all": [], "acronyms": {}}
    words = re.findall(r"[A-Za-z][A-Za-z+\-/#0-9]*", jd or "")
    toks  = [w.lower() for w in words]
    bigrams  = [" ".join([toks[i], toks[i+1]]) for i in range(len(toks)-1)]
    trigrams = [" ".join([toks[i], toks[i+1], toks[i+2]]) for i in range(len(toks)-2)]
    singles = [t for t in toks if (_is_acronym(words[toks.index(t)]) or len(t) >= 3)
               and t not in STOPWORDS_KW and t not in NOISE_VERBS and t not in NOISE_NOUNS]

    def looks_useful(p: str) -> bool:
        if any(h in p for h in (SKILL_HINTS | TITLE_HINTS | DOMAIN_HINTS)): return True
        if any(c in p for c in CERT_HINTS): return True
        if any(t in p for t in TITLE_HINTS): return True
        return False

    phrases = [p for p in (bigrams + trigrams) if looks_useful(p)]
    acronyms = {
        "aws":"amazon web services","ad":"active directory","sql":"structured query language",
        "k8s":"kubernetes","mdm":"mobile device management","sso":"single sign on",
        "u at":"user acceptance testing","sd lc":"software development life cycle"
    }
    expanded = set(singles) | set(phrases)
    for a, full in acronyms.items():
        if a in expanded: expanded.add(full)
        if full in expanded: expanded.add(a)

    certs  = sorted({w for w in expanded if any(c in w for c in CERT_HINTS)})
    titles = sorted({w for w in expanded if any(t in w for t in TITLE_HINTS)})
    skills = sorted({w for w in expanded if w not in set(certs)|set(titles) and
                     (any(h in w for h in (SKILL_HINTS | DOMAIN_HINTS)) or _is_acronym(w.replace(" ", "").upper()))})
    all_terms = sorted(set(skills) | set(titles) | set(certs), key=lambda x: (-len(x), x))
    return {"skills": skills, "titles": titles, "certs": certs, "all": all_terms, "acronyms": acronyms}

def _split_sections(text: str):
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    sections = collections.OrderedDict()
    cur = "_start"; sections[cur] = []

    def canonical(h: str) -> str:
        h = re.sub(r"[^a-z]+", " ", (h or "").lower()).strip()
        if any(w in h for w in ("experience","work history","employment history","relevant experience","professional experience")): return "experience"
        if "education" in h:  return "education"
        if "skill" in h:      return "skills"
        if "project" in h:    return "projects"
        if "cert" in h or "license" in h: return "certifications"
        if "summary" in h or "profile" in h: return "summary"
        if "objective" in h:  return "objective"
        return h

    for ln in lines:
        if len(ln) <= 48 and re.match(r"^[A-Z][A-Za-z0-9 &/]+$", ln):
            key = canonical(ln)
            if key != "_start":
                cur = key
                sections[cur] = []
                continue
        sections[cur].append(ln)
    return sections

def _extract_roles_with_dates(text: str):
    sections = _split_sections(text)
    all_lines = list(itertools.chain.from_iterable(sections.values()))
    roles, buf = [], []
    for ln in all_lines:
        if DATE_PAT.search(ln):
            if buf:
                roles.append({"lines": buf[:]})
                buf.clear()
        buf.append(ln)
    if buf:
        roles.append({"lines": buf[:]})

    now = datetime.date.today().year
    for r in roles:
        years = [int(y) for y in re.findall(r"\b(20\d{2}|19\d{2})\b", " ".join(r["lines"]))]
        r["start"] = (min(years) if years else None)
        r["end"]   = (now if re.search(r"\b(present|current)\b", " ".join(r["lines"]), re.I) else (max(years) if years else None))
    return roles

def _years_of_experience(roles):  # type: ignore
    yrs = 0
    for r in roles:
        if r.get("start") and r.get("end"):
            yrs += max(0, r["end"] - r["start"])
    return yrs

def _has_action_verb_start(line: str):
    s = re.sub(r"^(\*|•|-|\u2022|\u25CF)\s+", "", (line or ""))
    m = re.match(r"^([A-Za-z\-']+)", s)
    w = m.group(1).lower() if m else ""
    return w in ACTION_VERBS_STRONG, w

def _quant_stats(text: str):
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    bullets = [ln for ln in lines if ln[:2] in ("- ", "* ", "• ") or (ln and ln[0] in BULLET_MARKERS)]
    if not bullets:
        ex = _split_sections(text).get("experience", [])
        pseudo = []
        for ln in ex:
            starts, _ = _has_action_verb_start(ln)
            if starts and 6 <= len(ln.split()) <= 30:
                pseudo.append(ln)
        bullets = pseudo
    has_num = [bool(re.search(r"(\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b|\b\d+%|\b\d+\s?(?:k|m)\b|reduced|increased|saved|cut|grew|boosted)", b, re.I)) for b in bullets]
    starts  = [_has_action_verb_start(b)[0] for b in bullets]
    avg_len = statistics.mean([len(b.split()) for b in bullets]) if bullets else 0
    return {
        "bullet_count": len(bullets),
        "pct_with_numbers": int(round(100*sum(has_num)/max(1,len(bullets)))),
        "pct_action_starts": int(round(100*sum(starts)/max(1,len(bullets)))),
        "avg_words_per_bullet": round(avg_len,1)
    }

def _parse_and_format_score(resume_text: str, file_kind: str|None, raw_bytes: bytes|None):
    selectable = len((resume_text or "").strip()) >= 180
    s1 = 4 if selectable else 0
    s2 = 2 if file_kind in ("docx","pdf") else 0
    traps = 0
    if re.search(r"\|.+\|", resume_text): traps += 1
    if resume_text.count("\t") > 30: traps += 1
    if re.search(r"\s{4,}\S", resume_text): traps += 1
    s3 = max(0, 3 - traps)
    s4 = 1 if re.search(r"(^|\n)\s*(?:•|\-|\*)\s+", resume_text) else 0

    hard_fail = False
    if raw_bytes and file_kind == "pdf":
        bpc = len(raw_bytes) / max(1, len(resume_text.encode("utf-8")))
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

    roles = _extract_roles_with_dates(text)
    dated   = sum(1 for r in roles if r.get("start") or r.get("end"))
    chrono  = 1 if len(roles) < 2 else int(all((roles[i].get("end") or 0) >= (roles[i+1].get("end") or 0) for i in range(len(roles)-1)))
    rc = min(5, dated) + chrono
    return {"score": (8 * sum(has_std.values())/4) + min(5, rc) + base,
            "std": has_std, "reverse_chrono": bool(chrono), "roles_parsed": len(roles)}

def _keyword_match_to_jd(resume_text: str, jd_terms: dict, roles: list):
    txt = (resume_text or "").lower()
    sections = _split_sections(resume_text)
    skills_blob = " ".join(sections.get("skills", [])).lower()

    def cover(terms):
        if not terms: return 0.0, [], terms
        hits = []
        for t in terms:
            if (len(t) < 3 and not _is_acronym(t.upper())): continue
            if t in STOPWORDS_KW or t in NOISE_VERBS or t in NOISE_NOUNS: continue
            if t in txt or re.search(rf"\b{re.escape(t)}\b", txt): hits.append(t)
        matched = sorted(set(hits)); missing = sorted(set(terms) - set(matched))
        cov = len(matched)/max(1, len(set(terms)))
        return cov, matched, missing

    cov_sk, m_sk, miss_sk = cover(jd_terms.get("skills", []))
    cov_ti, m_ti, miss_ti = cover(jd_terms.get("titles", []))
    cov_ce, m_ce, miss_ce = cover(jd_terms.get("certs", []))

    recent_txt = " ".join(" ".join(r["lines"]).lower() for r in (roles or [])[:2])

    def recency_boost(cov, matched):
        if not matched: return cov
        in_recent = sum(1 for t in matched if t in recent_txt)
        return min(1.0, cov + (0.1 if in_recent else 0.0))

    cov_sk = recency_boost(cov_sk, m_sk)
    cov_ti = recency_boost(cov_ti, m_ti)
    cov_ce = recency_boost(cov_ce, m_ce)

    pts_sk = int(round(15 * min(1.0, cov_sk)))
    pts_ti = int(round( 8 * min(1.0, cov_ti)))
    pts_ce = int(round( 6 * min(1.0, cov_ce)))

    acro_ok = 0
    for a, full in jd_terms.get("acronyms", {}).items():
        if re.search(rf"\b{re.escape(a)}\b", txt) and re.search(rf"\b{re.escape(full)}\b", txt):
            acro_ok = 3; break

    in_skills = sum(1 for t in set(m_sk + m_ti + m_ce) if t in skills_blob)
    distribution_ok = in_skills < max(2, int(0.6 * len(set(m_sk + m_ti + m_ce))))
    pts_dist = 3 if distribution_ok else 0

    total_pts = pts_sk + pts_ti + pts_ce + acro_ok + pts_dist
    score_pct = int(round(100 * total_pts / 35))

    matched_all = sorted(set(m_sk + m_ti + m_ce))
    missing_all = sorted(set((jd_terms.get("skills", []) or []) +
                             (jd_terms.get("titles", []) or []) +
                             (jd_terms.get("certs", [])  or [])) - set(matched_all))
    return {"score": score_pct, "matched": matched_all, "missing": missing_all,
            "distribution_ok": distribution_ok,
            "components": {"skills": pts_sk, "titles": pts_ti, "certs": pts_ce,
                           "acro": acro_ok, "distribution": pts_dist, "total_points": total_pts}
           }

def _experience_relevance(jd_text: str, roles: list, resume_text: str):
    m = re.search(r"(\d+)\+?\s+years", jd_text or "", re.I)
    req = int(m.group(1)) if m else None
    yoe = _years_of_experience(roles)
    years_ok = (yoe >= req) if req else (yoe >= 2)
    s_years = 6 if years_ok else max(0, int(6 * (yoe / max(1, req or 6))))

    titles = [ln.lower() for r in roles for ln in r["lines"][:2]]
    has_lead = any(re.search(r"\b(lead|manager|senior|principal)\b", t) for t in titles)
    s_senior = 4 if has_lead or yoe >= 5 else 2 if yoe >= 3 else 1

    verbs = {"implement","migrate","optimize","build","design","automate","support","troubleshoot","manage"}
    recent_txt = " ".join(" ".join(r["lines"]).lower() for r in roles[:2])
    overlap = len([v for v in verbs if v in recent_txt])
    s_recent = 3 if overlap >= 4 else 2 if overlap >= 2 else 1

    jd_verbs = {w for w in _tokenize(jd_text) if w in verbs}
    res_verbs= {w for w in _tokenize(resume_text) if w in verbs}
    s_task   = 2 if len(jd_verbs & res_verbs) >= 2 else 1 if (jd_verbs & res_verbs) else 0
    return {"score": s_years + s_senior + s_recent + s_task, "yoe": yoe, "req": req}

def _education_and_certs(resume_text: str, jd_terms: dict):
    score = 0
    if re.search(r"\b(bsc|msc|b\.?sc|m\.?sc|bachelor|master|degree)\b", resume_text or "", re.I):
        score += 3
    certs_found = [c for c in jd_terms.get("certs", []) if c in (resume_text or "").lower()]
    if certs_found: score += 3
    return {"score": score, "certs_found": certs_found}

def _eligibility_location(resume_text: str):
    score = 0
    if LOC_PAT.search(resume_text or ""): score += 1
    if re.search(r"\b(eligible to work|work authorization|right to work|visa|relocat)\b", resume_text or "", re.I):
        score += 2
    return {"score": score}

def _readability_brevity(resume_text: str, level: str):
    words = len(_tokenize(resume_text))
    est_pages = max(1, int(round(words/WORDS_PER_PAGE)))
    length_ok = est_pages <= (3 if level in ("exec","senior") else 2)
    s_len = 3 if length_ok else 1
    qs = _quant_stats(resume_text)
    within = 8 <= qs["avg_words_per_bullet"] <= 20 if qs["bullet_count"] else False
    s_bul = 3 if within else 1
    dates = re.findall(r"(?:\b\d{2}/\d{4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{4})", resume_text or "", re.I)
    s_con = 2 if len(dates) >= 2 else 1
    return {"score": s_len + s_bul + s_con, "length_pages": est_pages,
            "bullets": qs, "length_component": s_len, "bullet_component": s_bul, "consistency_component": s_con}

def _content_depth_penalty(resume_text: str, level: str):
    words = len(_tokenize(resume_text))
    qs = _quant_stats(resume_text)
    bullets = qs["bullet_count"]
    min_words  = 300 if level in ("entry",) else 350
    min_bullets= 6    if level in ("entry",) else 8
    pts, reasons = 0, []
    if words < min_words:
        gap = min_words - words
        pts += 4 if gap < 100 else 6 if gap < 180 else 8
        reasons.append("Too little content — add more impact bullets and detail.")
    if bullets < min_bullets:
        pts += 3 if bullets >= (min_bullets - 2) else 6
        reasons.append("Too few bullet points — aim for concise 8–20 word bullets.")
    return min(12, pts), reasons

def _penalties(resume_text: str, roles: list, hard_fail: bool):
    pts, reasons = 0, []
    if hard_fail: return 100, ["Image-only/unparseable PDF"]
    if sum(1 for r in roles if r.get("start") or r.get("end")) == 0:
        pts += 5; reasons.append("Missing dates on roles")
    toks = _tokenize(resume_text)
    if toks:
        counts = collections.Counter(toks)
        for a in {"managed","led","delivered","supported","coordinated"}: counts.pop(a, None)
        if counts:
            top, n = counts.most_common(1)[0]
            if n/len(toks) > 0.08 or n >= 40:
                pts += 4; reasons.append("Possible keyword stuffing")
    if re.search(r"\bmy journey\b", resume_text or "", re.I):
        pts += 3; reasons.append("Non-standard headings")
    years = sorted({r["start"] for r in roles if r.get("start")} | {r["end"] for r in roles if r.get("end")})
    for a,b in zip(years, years[1:]):
        if b - a >= 2:
            pts += 3; reasons.append("Potential gaps"); break
    if any(re.search(rf"\b{re.escape(p)}\b", resume_text or "", re.I) for p in PERSONAL_DATA):
        pts += 2; reasons.append("Personal data (DOB/photo/etc.)")
    return pts, reasons

# ========= PUBLIC: run_analyzer =========
def run_analyzer(data: dict) -> dict:
    """
    Pure function: takes request JSON payload and returns the final ATS analysis dict.
    No Flask request/response objects here.
    """
    try:
        client = current_app.config.get("OPENAI_CLIENT")
    except Exception:
        client = None

    # Decode input
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
            resume_text = (data.get("text") or "").strip()
            file_kind = "text"
        else:
            return {"error": "No resume data provided"}
    except Exception:
        current_app.logger.exception("resume-analysis: decode failed")
        return {"error": "Could not read the resume file"}

    if not resume_text.strip():
        return {"error": "Could not extract any text"}

    job_desc = (data.get("jobDescription") or "").strip()
    job_role = (data.get("jobRole") or "").strip()
    level    = (data.get("careerLevel") or "mid").lower()

    # Deterministic categories
    pf_score, hard_fail = _parse_and_format_score(resume_text, file_kind, raw_bytes)
    sec_struct   = _sections_structure_score(resume_text)
    roles        = _extract_roles_with_dates(resume_text)

    jd_source = job_desc or job_role
    if not jd_source:
        secs = _split_sections(resume_text)
        summary_blob = " ".join(secs.get("summary", []))
        skills_blob  = " ".join(secs.get("skills", []))
        jd_source = f"{summary_blob}\n{skills_blob}".strip()

    jd_terms = _build_jd_terms(jd_source) if jd_source else {"all": [], "skills": [], "titles": [], "certs": [], "acronyms": {}}
    kw_match  = _keyword_match_to_jd(resume_text, jd_terms, roles)
    kw_points = kw_match["score"]

    matched = _clean_kw_list(kw_match.get("matched", []))
    missing = _clean_kw_list(kw_match.get("missing", []))

    exp_rel   = _experience_relevance(job_desc, roles, resume_text)
    quant     = _quant_stats(resume_text)
    ach_score = (5 if quant["pct_with_numbers"] >= 50 else int(5 * quant["pct_with_numbers"]/50)) \
                + (3 if quant["pct_action_starts"] >= 70 else int(3 * quant["pct_action_starts"]/70))
    edu_certs = _education_and_certs(resume_text, jd_terms)
    elig_loc  = _eligibility_location(resume_text)
    read_br   = _readability_brevity(resume_text, level)

    depth_pts, depth_reasons = _content_depth_penalty(resume_text, level)
    pen_pts, pen_reasons = _penalties(resume_text, roles, hard_fail)
    pen_pts += depth_pts
    pen_reasons += depth_reasons
    if not sec_struct["std"]["experience"]:
        pen_pts += 5; pen_reasons.append("Missing Work Experience section")
    if not sec_struct["std"]["education"]:
        pen_pts += 3; pen_reasons.append("Missing Education section")

    score = 0
    score += pf_score
    score += min(15, sec_struct["score"])
    score += kw_points
    score += min(15, exp_rel["score"])
    score += min(8,  ach_score)
    score += min(6,  edu_certs["score"])
    score += min(3,  elig_loc["score"])
    score += min(8,  read_br["score"])
    score = max(0, min(100, score - min(20, pen_pts)))

    cap = 100
    if job_desc:
        if kw_points < 14 or not kw_match["distribution_ok"]:
            cap = min(cap, 69)
    if sec_struct["score"] < 9:
        cap = min(cap, 69)
    if quant["bullet_count"] < 6:
        cap = min(cap, 74)
    score = min(score, cap)

    llm = {"analysis":{"issues":[],"strengths":[]},
           "suggestions":[],
           "writing":{"readability":"","repetition":[],"grammar":[]},
           "relevance":{"role": job_role, "score": 0, "explanation":"", "aligned_keywords":[], "missing_keywords":[]}}
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
Context:
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
            content = re.sub(r"```(?:json)?", "", content)
            s,e = content.find("{"), content.rfind("}")
            if s>=0 and e>s:
                js = json.loads(content[s:e+1])
                for k,v in js.items(): llm[k] = v
        except Exception:
            current_app.logger.warning("LLM step skipped; continuing with deterministic output", exc_info=True)

    breakdown = {
        "formatting": int(round((pf_score/10)*100)),
        "keywords":   kw_match["score"],
        "sections":   int(round((sec_struct["score"]/15)*100)),
        "readability": int(round((read_br["score"]/8)*100)),
        "length":     int(round((read_br.get("length_component", 0)/3)*100))
                      if isinstance(read_br.get("length_component"), int)
                      else int(round((min(3, read_br["score"])/3)*100)),
        "parseable":  (not hard_fail),
    }
    visible = [int(breakdown["formatting"]), int(breakdown["sections"]), int(breakdown.get("keywords", 0)),
               int(breakdown["readability"]), int(breakdown["length"]), 100 if breakdown["parseable"] else 0]
    avg_visible = int(round(sum(visible) / len(visible)))
    all_hundred = all(v >= 100 for v in visible)
    headline = score if all_hundred else min(score, avg_visible)

    diagnostics = {
        "achievements": quant,
        "eligibility_location": elig_loc,
        "education_certs": edu_certs,
        "experience_relevance": exp_rel,
        "keyword_distribution_ok": kw_match["distribution_ok"],
        "keyword_components": kw_match["components"],
        "penalties": {"points": min(20, pen_pts), "reasons": pen_reasons},
        "roles_parsed": roles[:4],
        "length_pages_est": read_br["length_pages"]
    }

    out = {
        "score": int(headline),
        "analysis": {
            "issues": llm.get("analysis", {}).get("issues", []),
            "strengths": llm.get("analysis", {}).get("strengths", [])
        },
        "suggestions": llm.get("suggestions", []),
        "breakdown": breakdown,
        "keywords": {"matched": matched, "missing": missing},
        "sections": {
            "present": [k for k, v in sec_struct["std"].items() if v],
            "missing": [k for k, v in sec_struct["std"].items() if not v]
        },
        "writing": {
            "readability": llm.get("writing", {}).get("readability", ""),
            "repetition": llm.get("writing", {}).get("repetition", []),
            "grammar": llm.get("writing", {}).get("grammar", [])
        },
        "relevance": llm.get("relevance", {}),
        "diagnostics": diagnostics
    }
    fixes = []
    if not sec_struct["std"]["experience"]:
        fixes.append("Add a Work Experience section (titles like “Experience” or “Relevant Experience” are fine).")
    elif not sec_struct["reverse_chrono"]:
        fixes.append("Ensure roles are in reverse-chronological order (most recent first) with Month YYYY dates.")
    if breakdown.get("length", 100) < 70:
        fixes.append("Expand to 1–2 pages with impact bullets (8–20 words each).")
    out["analysis"]["issues"] = (out["analysis"]["issues"] or []) + fixes
    return out
