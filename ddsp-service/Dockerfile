FROM python:3.10-slim

# libsndfile for soundfile, ffmpeg for mp3/m4a decoding via librosa
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Bake the trained checkpoint into the image (simplest for Cloud Run).
# Alternative: mount a GCS bucket and set MODEL_DIR accordingly.
COPY models/violin /models/violin
ENV MODEL_DIR=/models/violin

# Cloud Run injects $PORT; default to 8080 locally.
ENV PORT=8080
CMD exec uvicorn app:app --host 0.0.0.0 --port ${PORT} --workers 1
