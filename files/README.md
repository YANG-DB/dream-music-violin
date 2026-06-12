# DDSP Timbre-Transfer API

Minimal FastAPI wrapper around DDSP inference. Upload audio, get back the
same melody rendered through your trained DDSP model (e.g. your violin).

```
ddsp-api/
├── app.py            # FastAPI service
├── requirements.txt
├── Dockerfile
└── models/violin/    # <- put your trained checkpoint here (not included)
    ├── operative_config-*.gin
    ├── ckpt-XXXX.index
    └── ckpt-XXXX.data-00000-of-00001
```

## 1. Get a checkpoint

Train in the DDSP Colab (`train_autoencoder.ipynb`) on ~15+ minutes of your
violin recordings, then download the checkpoint directory it exports
(`operative_config.gin` + latest `ckpt-*` files) into `models/violin/`.
To smoke-test the API before training, the pretrained solo-violin checkpoint
from the DDSP repo works too.

## 2. Run locally

```bash
pip install -r requirements.txt
MODEL_DIR=./models/violin uvicorn app:app --reload --port 8080
```

Test:

```bash
curl -F "file=@my_melody.wav" \
  "http://localhost:8080/transfer?pitch_shift_octaves=0&loudness_shift_db=0" \
  -o out.wav
```

## 3. Deploy to Cloud Run

CPU is fine — DDSP inference doesn't need a GPU. CREPE f0 extraction is the
slow part (~few seconds per 10 s of audio on 2 vCPU).

```bash
gcloud run deploy ddsp-api \
  --source . \
  --region us-west1 \
  --memory 4Gi --cpu 2 \
  --timeout 300 \
  --allow-unauthenticated   # or keep auth + put behind your site's backend
```

Notes:
- First request after cold start re-loads TF + model (~20-40 s). Set
  `--min-instances 1` if that matters, or accept it on a hobby budget.
- Keep `--workers 1`; TF doesn't share well across uvicorn workers. Scale
  horizontally with Cloud Run instances instead (`--concurrency 1-2`).

## 4. Or: Hugging Face Spaces

Create a **Docker** Space and push this same repo (add the checkpoint via
git-lfs). The Space URL becomes your API endpoint. Spaces free tier sleeps
on idle — same cold-start tradeoff as Cloud Run min-instances=0.

## 5. Calling it from your website

```js
const form = new FormData();
form.append("file", recordedBlob, "input.wav");
const res = await fetch("https://YOUR-SERVICE-URL/transfer", {
  method: "POST",
  body: form,
});
const wav = await res.blob();
new Audio(URL.createObjectURL(wav)).play();
```

For browser recording, `MediaRecorder` produces webm/ogg — ffmpeg in the
container lets librosa decode it, so you can upload it as-is.

## Hardening TODOs (before real traffic)

- CORS middleware restricted to your domain
- Rate limiting / max upload size (e.g. nginx or FastAPI middleware)
- Async job queue (e.g. Cloud Tasks) if you raise MAX_INPUT_SECONDS
- Auth token if the endpoint shouldn't be public
