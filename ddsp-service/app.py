"""
FastAPI service for DDSP timbre-transfer inference.

POST /transfer  : multipart upload (field "file") -> returns rendered WAV
                  ?pitch_shift_octaves=&loudness_shift_db=
GET  /healthz   : liveness + mode (ddsp | passthrough)

Inference flow (same as the timbre-transfer Colab, minus the UI):
  1. decode + resample input audio to 16 kHz mono
  2. extract features: f0 (CREPE), loudness
  3. optionally shift pitch / normalize loudness to the model's register
  4. run the DDSP Autoencoder, return synthesized audio as WAV

Runs LOCALLY-FIRST: if the heavy ML stack or a trained model isn't present, the
service starts anyway in "passthrough" mode (ffmpeg pitch/gain) so the whole app
flow works end-to-end while you train and drop a checkpoint into models/violin/.
The API is identical in both modes — the client doesn't change.
"""

import io
import os
import time
import shutil
import logging
import tempfile
import subprocess

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ddsp-api")

SAMPLE_RATE = 16000          # DDSP default
MAX_INPUT_SECONDS = 30       # guardrail: keep requests bounded
MODEL_DIR = os.environ.get("MODEL_DIR", os.path.join(os.path.dirname(__file__), "models", "violin"))

app = FastAPI(title="DDSP Timbre Transfer API", version="0.2.0")
# allow the static site to call us (tighten allow_origins to your domain in prod)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

_model = None
_mode = "passthrough"        # flips to "ddsp" once a model is loaded


# ---------------------------------------------------------------------------
# Model loading (once, at startup) — optional
# ---------------------------------------------------------------------------
def _load_model(model_dir: str):
    """Parse the gin operative config and restore the latest checkpoint."""
    import gin
    import tensorflow as tf
    import ddsp
    import ddsp.training

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
    global _model, _mode
    try:
        _model = _load_model(MODEL_DIR)
        import numpy as np
        _run_inference(np.zeros(SAMPLE_RATE, dtype=np.float32))  # warm-up
        _mode = "ddsp"
        log.info("DDSP model loaded + warmed up — mode=ddsp")
    except Exception as e:
        _model = None
        _mode = "passthrough"
        log.warning("DDSP unavailable (%s) — running in passthrough mode", e)


# ---------------------------------------------------------------------------
# DDSP inference (real path)
# ---------------------------------------------------------------------------
def _decode_audio(raw: bytes):
    """Decode arbitrary uploaded audio to 16 kHz mono float32."""
    import numpy as np
    import soundfile as sf
    import librosa
    try:
        audio, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
        audio = audio.mean(axis=1)
    except Exception:
        audio, sr = librosa.load(io.BytesIO(raw), sr=None, mono=True)
    if sr != SAMPLE_RATE:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=SAMPLE_RATE)
    max_len = MAX_INPUT_SECONDS * SAMPLE_RATE
    if len(audio) > max_len:
        audio = audio[:max_len]
    return np.asarray(audio, dtype="float32")


def _run_inference(audio, pitch_shift_octaves=0.0, loudness_shift_db=0.0):
    import numpy as np
    import ddsp
    import ddsp.training  # noqa: F401
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
    return np.asarray(_model.get_audio_from_outputs(outputs))[0]


def _wav_bytes(audio):
    import soundfile as sf
    buf = io.BytesIO()
    sf.write(buf, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Passthrough path (no ML deps) — ffmpeg pitch + gain, so localhost works now
# ---------------------------------------------------------------------------
def _atempo_chain(tempo):
    steps = []
    while tempo < 0.5:
        steps.append("atempo=0.5"); tempo /= 0.5
    while tempo > 2.0:
        steps.append("atempo=2.0"); tempo /= 2.0
    steps.append("atempo=%.6f" % tempo)
    return steps


def _passthrough_wav(raw: bytes, pitch_shift_octaves=0.0, loudness_shift_db=0.0):
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg not found (needed for passthrough mode)")
    tmp = tempfile.mkdtemp(prefix="ddsp_")
    try:
        inp = os.path.join(tmp, "in")
        with open(inp, "wb") as f:
            f.write(raw)
        out = os.path.join(tmp, "out.wav")
        af = ["aresample=%d" % SAMPLE_RATE]
        semis = pitch_shift_octaves * 12.0
        if abs(semis) > 1e-3:
            factor = 2.0 ** (semis / 12.0)
            af.append("asetrate=%d" % int(SAMPLE_RATE * factor))
            af.append("aresample=%d" % SAMPLE_RATE)
            af.extend(_atempo_chain(1.0 / factor))
        if abs(loudness_shift_db) > 1e-3:
            af.append("volume=%.3fdB" % loudness_shift_db)
        subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", inp,
             "-ac", "1", "-ar", str(SAMPLE_RATE), "-af", ",".join(af), out],
            check=True,
        )
        with open(out, "rb") as f:
            return f.read()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/healthz")
def healthz():
    return {"status": "ok", "mode": _mode, "model_dir": MODEL_DIR, "model_loaded": _model is not None}


@app.post("/transfer")
async def transfer(
    file: UploadFile = File(...),
    pitch_shift_octaves: float = 0.0,
    loudness_shift_db: float = 0.0,
):
    """Upload audio, get back the DDSP-rendered (or passthrough) version."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload")

    t0 = time.time()
    try:
        if _model is not None:
            audio_in = _decode_audio(raw)
            if len(audio_in) < SAMPLE_RATE // 2:
                raise HTTPException(status_code=400, detail="Audio too short (< 0.5 s)")
            audio_out = _run_inference(audio_in, pitch_shift_octaves, loudness_shift_db)
            wav = _wav_bytes(audio_out)
        else:
            wav = _passthrough_wav(raw, pitch_shift_octaves, loudness_shift_db)
    except HTTPException:
        raise
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=415, detail=f"Cannot decode audio: {e}")
    except Exception as e:
        log.exception("transfer failed")
        raise HTTPException(status_code=500, detail=str(e))

    log.info("[%s] rendered in %.1f s", _mode, time.time() - t0)
    return Response(
        content=wav, media_type="audio/wav",
        headers={"Content-Disposition": 'attachment; filename="ddsp_output.wav"'},
    )
