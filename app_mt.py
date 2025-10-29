# app_mt.py
import os
from functools import lru_cache
from openai import OpenAI

OPENAI_MODEL = os.getenv("OPENAI_TRANSLATION_MODEL", "gpt-4o-mini")
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SYSTEM_PROMPT = (
    "You are a professional translator. Translate the following HTML into the "
    "target language. STRICT RULES: preserve all HTML structure, tags, attributes, "
    "ids, classes, URLs, placeholders, numbers, and code blocks. Translate only "
    "visible user-facing text. Do not translate attribute values that are not visible "
    "(e.g., id, class, name, value for inputs). Return only the translated HTML."
)

def translate_html(html: str, target_lang: str) -> str:
    # Keep payload reasonable: if pages are huge, consider chunking or minifying first.
    resp = client.responses.create(
        model=OPENAI_MODEL,
        input=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Target language: {target_lang}\n\n{html}"},
        ],
    )
    out = getattr(resp, "output_text", "") or ""
    return out.strip() or html
