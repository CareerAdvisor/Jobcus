from flask import current_app
import base64, re, json, logging
from io import BytesIO
from PyPDF2 import PdfReader
import docx

@resumes_bp.route("/api/resume-analysis", methods=["POST"])
def resume_analysis():
    client = current_app.config["OPENAI_CLIENT"]
    data = request.get_json(force=True)
    resume_text = ""

    if data.get("pdf"):
        pdf_bytes = base64.b64decode(data["pdf"])
        reader = PdfReader(BytesIO(pdf_bytes))
        resume_text = "\n".join(p.extract_text() or "" for p in reader.pages)
    elif data.get("docx"):
        docx_bytes = base64.b64decode(data["docx"])
        doc = docx.Document(BytesIO(docx_bytes))
        resume_text = "\n".join(p.text for p in doc.paragraphs)
    elif data.get("text"):
        resume_text = data["text"].strip()
    else:
        return jsonify(error="No resume data provided"), 400

    if not resume_text:
        return jsonify(error="Could not extract any text"), 400

    prompt = (
        "You are an ATS-certified resume analyzer. Return only JSON with keys: "
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


@resumes_bp.route("/api/optimize-resume", methods=["POST"])
def optimize_resume():
    client = current_app.config["OPENAI_CLIENT"]
    data = request.get_json(force=True)
    resume_text = ""

    if data.get("pdf"):
        try:
            pdf_bytes = base64.b64decode(data["pdf"])
            reader = PdfReader(BytesIO(pdf_bytes))
            resume_text = "\n".join(p.extract_text() or "" for p in reader.pages)
            if not resume_text.strip():
                return jsonify({"error": "PDF content empty"}), 400
        except Exception:
            logging.exception("PDF Decode Error")
            return jsonify({"error": "Unable to extract PDF text"}), 400
    elif data.get("text"):
        resume_text = data["text"].strip()
        if not resume_text:
            return jsonify({"error": "No text provided"}), 400
    else:
        return jsonify({"error": "No resume data provided"}), 400

    prompt = (
        "You are an expert ATS resume optimizer. Rewrite the following resume in plain text, "
        "using strong action verbs, consistent bullets, relevant keywords, fixing grammar and repetition.\n\n"
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
        return jsonify({"error": "Resume optimization failed"}), 500


@resumes_bp.route("/generate-resume", methods=["POST"])
def generate_resume():
    client = current_app.config["OPENAI_CLIENT"]
    data = request.json or {}
    prompt = f"""
Create a professional, modern UK resume in HTML format:
Full Name: {data.get('fullName')}
Summary: {data.get('summary')}
Education: {data.get('education')}
Experience: {data.get('experience')}
Skills: {data.get('skills')}
Certifications: {data.get('certifications')}
Portfolio: {data.get('portfolio')}
"""
    try:
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role":"user","content":prompt}],
            temperature=0.7
        )
        return jsonify(formatted_resume=resp.choices[0].message.content)
    except Exception as e:
        return jsonify(error=str(e)), 500
