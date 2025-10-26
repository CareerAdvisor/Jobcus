# Use a small but full-featured Python base image
FROM python:3.11-slim

# System packages (tesseract + poppler + HEIF)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    poppler-utils \
    libheif1 \
 && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy and install dependencies first (better for caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of your app
COPY . .

# Expose the port Render will use (10000 by default)
EXPOSE 10000

# Start the Flask app via Gunicorn
CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:10000", "app:app"]
