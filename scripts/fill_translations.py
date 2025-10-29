#!/usr/bin/env python3
"""Helper to backfill missing translations using OpenAI."""

import argparse
import os
import sys
from pathlib import Path

import polib
from openai import OpenAI

DEFAULT_MODEL = os.getenv("OPENAI_TRANSLATION_MODEL", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
SYSTEM_PROMPT = "You are a professional translator. Return only the translation preserving markdown, HTML, and placeholders."


def read_repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def iter_locales(translations_dir: Path):
    for locale_dir in sorted(translations_dir.iterdir()):
        lc_messages = locale_dir / "LC_MESSAGES" / "messages.po"
        if lc_messages.exists():
            yield locale_dir.name, lc_messages


def collect_entries(po_path: Path):
    po = polib.pofile(str(po_path))
    untranslated = [entry for entry in po if not entry.msgstr.strip() and not entry.obsolete]
    return po, untranslated


def translate_text(client: OpenAI, text: str, locale: str, model: str) -> str:
    response = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Translate to {locale} and keep markup intact. Text: {text}"},
        ],
    )
    return getattr(response, "output_text", "").strip()


def backfill_locale(locale: str, po_path: Path, client: OpenAI, model: str, dry_run: bool) -> int:
    po, untranslated = collect_entries(po_path)
    if not untranslated:
        print(f"[{locale}] No missing translations")
        return 0

    print(f"[{locale}] Translating {len(untranslated)} strings using {model}")
    updated = 0
    for entry in untranslated:
        translation = translate_text(client, entry.msgid, locale, model)
        if translation:
            if not dry_run:
                entry.msgstr = translation
            updated += 1
        else:
            print(f"[{locale}] WARNING: empty response for '{entry.msgid[:40]}…'")
    if not dry_run and updated:
        po.save()
    return updated


def main() -> int:
    parser = argparse.ArgumentParser(description="Auto-translate missing msgstr entries using OpenAI")
    parser.add_argument("--locale", help="Locale code to process (default: all)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="OpenAI model to use (default from env)")
    parser.add_argument("--dry-run", action="store_true", help="Fetch translations without writing results")
    args = parser.parse_args()

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("OPENAI_API_KEY not set", file=sys.stderr)
        return 1

    translations_dir = read_repo_root() / "translations"
    if not translations_dir.exists():
        print("Translations directory not found", file=sys.stderr)
        return 1

    client = OpenAI(api_key=api_key)
    locales = dict(iter_locales(translations_dir))
    if args.locale:
        if args.locale not in locales:
            print(f"Locale {args.locale} not found", file=sys.stderr)
            return 1
        target = {args.locale: locales[args.locale]}
    else:
        target = locales

    total = 0
    for locale, po_path in target.items():
        total += backfill_locale(locale, po_path, client, args.model, args.dry_run)

    if total:
        if not args.dry_run:
            print("Recompile catalogs with ./scripts/compile_translations.sh when finished.")
        else:
            print("Dry run complete; no files modified.")
    else:
        print("No updates required.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
