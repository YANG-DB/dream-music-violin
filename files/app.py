"""
Minimal FastAPI service for DDSP timbre-transfer inference.

POST /transfer  : multipart upload of a WAV/MP3 -> returns rendered WAV
GET  /healthz   : liveness probe (Cloud Run / k8s)

Assumes a trained DDSP checkpoint directory (operative_config-*.gin +
ckpt files) is available at MODEL_DIR — e.g. the artifacts exported by
the DDSP training Colab ("train_autoencoder" notebook) or a pretrained
model such as the solo violin checkpoint.

Inference flow (same as the timbre-transfer Colab, minus the UI):
  1. decode + resample input audio to 16 kHz mono
  2. extract features: f0 (CREPE), loudness
  3. optionally shift pitch / normalize loudness to the model's register
  4. run the DDSP Autoencoder, return synthesized audio as WAV
"""

import io
import os
import time
import logging

import gin
import numpy as np
import tensorflow as tf
import soundfile as sf
import librosa

import ddsp
import ddsp.training
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import Response

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ddsp-api")

SAMPLE_RATE = 16000          # DDSP default
MAX_INPUT_SECONDS = 30       # guardrail: keep requests bounded
MODEL_DIR = os.environ.get("MODEL_DIR", "/models/violin")

app = FastAPI(title="DDSP Timbre Transfer API", version="0.1.0")

# ---------------------------------------------------------------------------
# Model loading (once, at startup)
# ---------------------------------------------------------------------------

_model = None


def _load_model(model_dir: str):
    """Parse the gin operative config and restore the latest checkpoint."""
    gin_file = None
    for f in tf.io.gfile.listdir(model_dir):
        if f.startswith("operative_config") and f.endswith(".gin"):
            gin_file = os.path.join(model_dir, f)
            break
    if gin_file is None:
        raise FileNotFoundError(f"No operative_config-*.gin in {model_dir}")

    with gin.unlock_config():
        gin.parse_config_file(gin_file, skip_unknown=True)

    ckpt = tf.train.latest_checkpoint(model_dir)
    if ckpt is None:
        raise FileNotFoundError(f"No checkpoint found in {model_dir}")

    model = ddsp.training.models.Autoencoder()
    model.restore(ckpt)
    log.info("Restored DDSP model from %s", ckpt)
    return model


@app.on_event("startup")
def startup():
    global _model
    _model = _load_model(MODEL_DIR)
    # Warm up: trace the graph once so the first user request isn't slow.
    _run_inference(np.zeros(SAMPLE_RATE, dtype=np.float32))
    log.info("Model warm-up complete")


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------

def _decode_audio(raw: bytes) -> np.ndarray:
    """Decode arbitrary uploaded audio to 16 kHz mono float32."""
    try:
        audio, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
        audio = audio.mean(axis=1)  # downmix to mono
    except Exception:
        # soundfile can't read mp3/m4a on some builds; fall back to librosa
        audio, sr = librosa.load(io.BytesIO(raw), sr=None, mono=True)

    if sr != SAMPLE_RATE:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=SAMPLE_RATE)

    max_len = MAX_INPUT_SECONDS * SAMPLE_RATE
    if len(audio) > max_len:
        audio = audio[:max_len]
    return audio.astype(np.float32)


def _run_inference(audio: np.ndarray,
                   pitch_shift_octaves: float = 0.0,
                   loudness_shift_db: float = 0.0) -> np.ndarray:
    """Extract features and synthesize audio with the loaded model."""
    # Feature extraction: f0 via CREPE + loudness. This is the slow part
    # (a few seconds of CPU per 10 s of audio).
    features = ddsp.training.metrics.compute_audio_features(audio)
    features["loudness_db"] = features["loudness_db"].astype(np.float32)

    if pitch_shift_octaves:
        features["f0_hz"] = features["f0_hz"] * (2.0 ** pitch_shift_octaves)
    if loudness_shift_db:
        features["loudness_db"] = features["loudness_db"] + loudness_shift_db

    batch = {
        "audio": audio[np.newaxis, :],
        "f0_hz": features["f0_hz"][np.newaxis, :],
        "f0_confidence": features["f0_confidence"][np.newaxis, :],
        "loudness_db": features["loudness_db"][np.newaxis, :],
    }

    outputs = _model(batch, training=False)
    audio_out = _model.get_audio_from_outputs(outputs)
    return np.asarray(audio_out)[0]


def _wav_bytes(audio: np.ndarray) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/healthz")
def healthz():
    return {"status": "ok", "model_dir": MODEL_DIR}


@app.post("/transfer")
async def transfer(
    file: UploadFile = File(...),
    pitch_shift_octaves: float = 0.0,
    loudness_shift_db: float = 0.0,
):
    """Upload audio, get back the DDSP-rendered version."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload")

    t0 = time.time()
    try:
        audio_in = _decode_audio(raw)
    except Exception as e:
        raise HTTPException(status_code=415, detail=f"Cannot decode audio: {e}")

    if len(audio_in) < SAMPLE_RATE // 2:
        raise HTTPException(status_code=400, detail="Audio too short (< 0.5 s)")

    audio_out = _run_inference(audio_in, pitch_shift_octaves, loudness_shift_db)
    log.info("Rendered %.1f s of audio in %.1f s",
             len(audio_in) / SAMPLE_RATE, time.time() - t0)

    return Response(
        content=_wav_bytes(audio_out),
        media_type="audio/wav",
        headers={"Content-Disposition": 'attachment; filename="ddsp_output.wav"'},
    )
