#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TRANSLATIONS_DIR="${ROOT_DIR}/translations"

if [[ ! -d "${TRANSLATIONS_DIR}" ]]; then
  echo "compile_translations.sh: skipping because ${TRANSLATIONS_DIR} does not exist" >&2
  exit 0
fi

if ! command -v pybabel >/dev/null 2>&1; then
  echo "compile_translations.sh: pybabel not found on PATH; skipping compile" >&2
  exit 0
fi

echo "Compiling locale catalogs in ${TRANSLATIONS_DIR}"
pybabel compile -d "${TRANSLATIONS_DIR}"
