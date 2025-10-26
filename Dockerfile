# Use a slim Python base
FROM python:3.11-slim

# System packages needed by your app:
# - OCR: tesseract-ocr (+ English data), poppler-utils
# - HEIF/HEIC support
# - WeasyPrint deps (cairo/pango/pixbuf/fonts)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    poppler-utils \
    libheif1 \
    libcairo2 \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libgdk-pixbuf2.0-0 \
    fonts-liberation \
    fonts-noto-core \
    libjpeg-turbo-progs \
    libffi8 \
 && rm -rf /var/lib/apt/lists/*

# Workdir
WORKDIR /app

# Python deps first (cache-friendly)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY . .

# Render provides $PORT; default to 10000 locally
ENV PORT=10000

# Start the app
CMD ["sh","-c","gunicorn -w 2 -b 0.0.0.0:${PORT:-10000} app:app"]
