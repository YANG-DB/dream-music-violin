// ============================================================================
//  studio.js — a small in-browser sound studio.
//  Live controls: speed · volume/gain · smooth (warmth) · elevate (air).
//  Settings persist locally, and the current movement can be rendered through
//  the effect chain and saved as a .wav.
// ============================================================================
(function () {
  const $ = (s) => document.querySelector(s);

  const DEFAULTS = { speed: 1, volume: 1, smooth: 0, elevate: 0 };
  let state = Object.assign({}, DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem("dream-studio") || "null");
    if (saved) state = Object.assign(state, saved);
  } catch (e) { /* ignore */ }

  // smooth 0..1  ->  low-pass cutoff 20kHz (open) .. 1.1kHz (warm)
  const smoothCutoff = (v) => 20000 * Math.pow(1100 / 20000, v);

  function apply() {
    const a = window.SoundAudio;
    if (a) a.playbackRate = state.speed;
    const fx = window.SoundFX;
    if (fx) {
      fx.gain.gain.value = state.volume;
      fx.smooth.frequency.value = smoothCutoff(state.smooth);
      fx.elevate.gain.value = state.elevate;
    }
  }
  function save() { localStorage.setItem("dream-studio", JSON.stringify(state)); }

  function fmtSpeed(v) { return v.toFixed(2) + "×"; }
  function fmtPct(v) { return Math.round(v * 100) + "%"; }
  function fmtDb(v) { return (v > 0 ? "+" : "") + v.toFixed(1).replace(/\.0$/, "") + " dB"; }

  function syncLabels() {
    $("#sx-speed-val").textContent = fmtSpeed(state.speed);
    $("#sx-vol-val").textContent = fmtPct(state.volume);
    $("#sx-smooth-val").textContent = Math.round(state.smooth * 100) + "%";
    $("#sx-elevate-val").textContent = fmtDb(state.elevate);
  }
  function syncInputs() {
    $("#sx-speed").value = state.speed;
    $("#sx-vol").value = state.volume;
    $("#sx-smooth").value = state.smooth;
    $("#sx-elevate").value = state.elevate;
  }

  function bind(id, key, parse) {
    $(id).addEventListener("input", (e) => {
      state[key] = parse(e.target.value);
      apply(); save(); syncLabels();
    });
  }
  bind("#sx-speed", "speed", parseFloat);
  bind("#sx-vol", "volume", parseFloat);
  bind("#sx-smooth", "smooth", parseFloat);
  bind("#sx-elevate", "elevate", parseFloat);

  $("#sx-reset").addEventListener("click", () => {
    state = Object.assign({}, DEFAULTS);
    apply(); save(); syncInputs(); syncLabels();
    status("flat · unprocessed");
  });

  // panel open/close
  const studio = $("#studio");
  $("#studio-toggle").addEventListener("click", () => studio.classList.toggle("open"));

  function status(msg, busy) {
    const el = $("#sx-status");
    el.textContent = msg || "";
    el.classList.toggle("busy", !!busy);
  }

  // re-apply when a new movement loads (some browsers reset playbackRate on src change)
  if (window.SoundAudio) {
    ["play", "loadeddata", "ratechange"].forEach(ev =>
      window.SoundAudio.addEventListener(ev, () => {
        if (window.SoundAudio.playbackRate !== state.speed) window.SoundAudio.playbackRate = state.speed;
      }));
  }

  // ---------------------------------------------------- WAV export
  $("#sx-save").addEventListener("click", exportWav);

  async function exportWav() {
    const cur = window.SoundCurrent;
    if (!cur || !cur.src) { status("play a movement first"); return; }
    status("rendering…", true);
    try {
      const resp = await fetch(cur.src);
      const arr = await resp.arrayBuffer();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const tmp = new Ctx();
      const buf = await tmp.decodeAudioData(arr);
      tmp.close();

      const speed = state.speed;
      const len = Math.max(1, Math.ceil(buf.length / speed));
      const off = new OfflineAudioContext(buf.numberOfChannels, len, buf.sampleRate);

      const s = off.createBufferSource(); s.buffer = buf; s.playbackRate.value = speed;
      const g = off.createGain(); g.gain.value = state.volume;
      const lp = off.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = smoothCutoff(state.smooth); lp.Q.value = 0.7;
      const hs = off.createBiquadFilter(); hs.type = "highshelf"; hs.frequency.value = 3500; hs.gain.value = state.elevate;
      const comp = off.createDynamicsCompressor();
      comp.threshold.value = -10; comp.knee.value = 24; comp.ratio.value = 3;
      comp.attack.value = 0.005; comp.release.value = 0.2;

      s.connect(g); g.connect(lp); lp.connect(hs); hs.connect(comp); comp.connect(off.destination);
      s.start(0);

      const rendered = await off.startRendering();
      const blob = new Blob([encodeWAV(rendered)], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const safe = ((cur.album || "") + " - " + (cur.name || "movement"))
        .replace(/[^a-z0-9 _-]/gi, "").trim() || "movement";
      const a = document.createElement("a");
      a.href = url; a.download = safe + " (studio).wav";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      status("saved · " + safe + ".wav");
    } catch (e) {
      console.warn("WAV export failed", e);
      status("export failed (see console)");
    }
  }

  function encodeWAV(ab) {
    const numCh = ab.numberOfChannels, sr = ab.sampleRate, len = ab.length;
    const blockAlign = numCh * 2, dataSize = len * blockAlign;
    const view = new DataView(new ArrayBuffer(44 + dataSize));
    let p = 0;
    const ws = (str) => { for (let i = 0; i < str.length; i++) view.setUint8(p++, str.charCodeAt(i)); };
    const u32 = (v) => { view.setUint32(p, v, true); p += 4; };
    const u16 = (v) => { view.setUint16(p, v, true); p += 2; };
    ws("RIFF"); u32(36 + dataSize); ws("WAVE");
    ws("fmt "); u32(16); u16(1); u16(numCh); u32(sr); u32(sr * blockAlign); u16(blockAlign); u16(16);
    ws("data"); u32(dataSize);
    const chans = [];
    for (let c = 0; c < numCh; c++) chans.push(ab.getChannelData(c));
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        let v = Math.max(-1, Math.min(1, chans[c][i]));
        view.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7FFF, true); p += 2;
      }
    }
    return view.buffer;
  }

  // ---------------------------------------------------- init
  window.Studio = { apply };
  syncInputs(); syncLabels(); apply();
})();
