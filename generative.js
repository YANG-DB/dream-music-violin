// ============================================================================
//  generative.js — front-end for the DDSP timbre-transfer service.
//  Record / upload / use the current movement → POST /transfer → play the violin.
// ============================================================================
(function () {
  const $ = (s) => document.querySelector(s);
  const gen = $("#gen");
  if (!gen) return;

  let sourceBlob = null, sourceName = "";
  let mediaRec = null, recChunks = [], recStream = null;
  let busy = false;

  const urlEl = $("#gen-url");
  urlEl.value = localStorage.getItem("gen-service") || urlEl.value;
  urlEl.addEventListener("change", () => { localStorage.setItem("gen-service", urlEl.value.trim()); checkHealth(); });
  const serviceUrl = () => (urlEl.value.trim() || "http://localhost:8080/transfer");
  const healthUrl = () => serviceUrl().replace(/\/transfer\/?$/, "/healthz");

  // ---- open / close ----
  function open() { gen.classList.add("open"); checkHealth(); }
  function close() { gen.classList.remove("open"); stopRec(true); }
  $("#gen-toggle").addEventListener("click", () => gen.classList.contains("open") ? close() : open());
  $("#gen-close").addEventListener("click", close);
  $("#gen-modal").addEventListener("click", (e) => { if (e.target.id === "gen-modal") close(); });

  // ---- health badge ----
  async function checkHealth() {
    const badge = $("#gen-mode");
    badge.textContent = "checking…"; badge.className = "gen-mode";
    try {
      const r = await fetch(healthUrl(), { method: "GET" });
      const j = await r.json();
      if (j.mode === "ddsp") { badge.textContent = "DDSP model"; badge.className = "gen-mode ddsp"; }
      else { badge.textContent = "passthrough"; badge.className = "gen-mode"; }
    } catch (e) {
      badge.textContent = "service offline"; badge.className = "gen-mode off";
    }
  }

  // ---- source: set & preview ----
  function setSource(blob, name) {
    sourceBlob = blob; sourceName = name || "clip";
    $("#gen-source").textContent = "source · " + sourceName + " (" + Math.round(blob.size / 1024) + " KB)";
    const a = $("#gen-src-audio");
    a.src = URL.createObjectURL(blob); a.classList.add("show");
    $("#gen-go").disabled = false;
    status("");
  }

  // ---- record ----
  async function startRec() {
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) { status("microphone blocked — allow access or upload a file", true); return; }
    recChunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    mediaRec = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
    mediaRec.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    mediaRec.onstop = () => {
      const blob = new Blob(recChunks, { type: recChunks[0] ? recChunks[0].type : "audio/webm" });
      if (blob.size) setSource(blob, "recording");
      if (recStream) { recStream.getTracks().forEach((t) => t.stop()); recStream = null; }
    };
    mediaRec.start();
    $("#gen-rec").classList.add("rec-on"); $("#gen-rec").textContent = "■ stop";
    status("recording… play or sing your line");
  }
  function stopRec(silent) {
    if (mediaRec && mediaRec.state !== "inactive") mediaRec.stop();
    mediaRec = null;
    $("#gen-rec").classList.remove("rec-on"); $("#gen-rec").textContent = "● record";
    if (!silent) status("");
  }
  $("#gen-rec").addEventListener("click", () => (mediaRec ? stopRec() : startRec()));

  // ---- upload ----
  $("#gen-up").addEventListener("click", () => $("#gen-file").click());
  $("#gen-file").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) setSource(f, f.name); });

  // ---- use current movement ----
  $("#gen-cur").addEventListener("click", async () => {
    const cur = window.SoundCurrent;
    if (!cur || !cur.src) { status("play a movement first", true); return; }
    status("fetching the current movement…");
    try {
      const r = await fetch(cur.src);
      const b = await r.blob();
      setSource(b, cur.name || "movement");
    } catch (e) { status("could not read the current movement", true); }
  });

  // ---- knobs ----
  const pitchEl = $("#gk-pitch"), loudEl = $("#gk-loud");
  const syncKnobs = () => {
    $("#gk-pitch-v").textContent = (pitchEl.value > 0 ? "+" : "") + pitchEl.value + " st";
    $("#gk-loud-v").textContent = (loudEl.value > 0 ? "+" : "") + loudEl.value + " dB";
  };
  pitchEl.addEventListener("input", syncKnobs); loudEl.addEventListener("input", syncKnobs); syncKnobs();

  // ---- transform ----
  function status(msg, err) { const el = $("#gen-status"); el.textContent = msg || ""; el.classList.toggle("err", !!err); }

  $("#gen-go").addEventListener("click", async () => {
    if (!sourceBlob || busy) return;
    busy = true;
    const go = $("#gen-go"); go.classList.add("busy"); go.disabled = true;
    status("transferring to violin…");
    try {
      const fd = new FormData();
      const ext = (sourceBlob.type.split("/")[1] || "webm").split(";")[0];
      fd.append("file", sourceBlob, "source." + ext);            // service expects field "file"
      const octaves = (parseInt(pitchEl.value, 10) || 0) / 12;    // UI is semitones; API is octaves
      const u = serviceUrl() +
        "?pitch_shift_octaves=" + encodeURIComponent(octaves) +
        "&loudness_shift_db=" + encodeURIComponent(loudEl.value);
      const res = await fetch(u, { method: "POST", body: fd });
      if (!res.ok) { let m = "service error " + res.status; try { m = (await res.json()).detail || m; } catch (e) {} throw new Error(m); }
      const wav = await res.blob();
      const url = URL.createObjectURL(wav);
      const out = $("#gen-out-audio"); out.src = url; out.classList.add("show");
      $("#gen-dl").href = url;
      $("#gen-result").classList.remove("hidden");
      $("#gen-toplayer").onclick = () => {
        if (window.SoundAudio) { window.SoundAudio.src = url; window.SoundAudio.play().catch(() => {}); }
      };
      status("done · your violin");
      out.play().catch(() => {});
    } catch (e) {
      console.warn("transfer failed", e);
      status(String(e.message || e), true);
    } finally {
      busy = false; go.classList.remove("busy"); go.disabled = !sourceBlob;
    }
  });
})();
