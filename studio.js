// ============================================================================
//  studio.js — a WavePad-style waveform sound editor.
//  See the whole movement as a waveform, drag to select any part, and shape it
//  independently (speed · volume · smooth · elevate). Edits apply live as the
//  song plays and are baked into a .wav export. Everything saved locally.
// ============================================================================
(function () {
  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const DEFAULTS = { speed: 1, volume: 1, smooth: 0, elevate: 0 };
  let global = Object.assign({}, DEFAULTS);   // whole-song defaults (shared)
  let segMap = {};                            // { trackKey: [segments] }
  let segs = [];                              // current track's parts (non-overlapping)
  let selection = null;                       // { start, end } transient selection
  let selIndex = -1;                          // selected segment index (-1 none)
  let lastKey = null;                         // last applied active-param signature
  let lastActive = -2;                        // segment index currently under the playhead
  let handleDrag = null;                      // { i, edge } while dragging a boundary
  const MIN_SEG = 0.2;                        // shortest part (seconds)

  try { const s = JSON.parse(localStorage.getItem("dream-studio") || "null"); if (s) global = Object.assign(global, s); } catch (e) {}
  try { const m = JSON.parse(localStorage.getItem("dream-wave-segs") || "null"); if (m) segMap = m; } catch (e) {}

  const smoothCutoff = (v) => 20000 * Math.pow(1100 / 20000, v);
  const trackKey = () => (window.SoundCurrent && window.SoundCurrent.src) || null;
  const duration = () => (window.SoundAudio && window.SoundAudio.duration) || 0;
  const fmtClock = (s) => { s = Math.max(0, s || 0); return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0"); };

  // refs
  const wrap = $("#ed-wave-wrap");
  const canvas = $("#ed-wave");
  const cx = canvas.getContext("2d");
  const segLayer = $("#ed-segs");
  const selEl = $("#ed-sel");
  const playEl = $("#ed-play");

  // ---------------------------------------------------- param resolution
  function paramsAt(t) {
    for (const s of segs) if (t >= s.start && t < s.end) return s;
    return global;
  }
  function activeSeg() { return (selIndex >= 0 && segs[selIndex]) ? segs[selIndex] : null; }
  function shown() { return activeSeg() || global; }

  // ---------------------------------------------------- live graph
  function applyParams(p) {
    const a = window.SoundAudio;
    if (a && Math.abs(a.playbackRate - p.speed) > 1e-3) a.playbackRate = p.speed;
    const fx = window.SoundFX;
    if (fx) {
      const tt = fx.ctx.currentTime;
      fx.gain.gain.setTargetAtTime(p.volume, tt, 0.03);
      fx.smooth.frequency.setTargetAtTime(smoothCutoff(p.smooth), tt, 0.03);
      fx.elevate.gain.setTargetAtTime(p.elevate, tt, 0.03);
    }
  }
  const sig = (p) => p.speed + "|" + p.volume + "|" + p.smooth + "|" + p.elevate;

  function save() {
    localStorage.setItem("dream-studio", JSON.stringify(global));
    const k = trackKey();
    if (k) { if (segs.length) segMap[k] = segs; else delete segMap[k]; }
    localStorage.setItem("dream-wave-segs", JSON.stringify(segMap));
  }

  // ---------------------------------------------------- sliders
  const fmt = {
    speed: (v) => v.toFixed(2) + "×",
    volume: (v) => Math.round(v * 100) + "%",
    smooth: (v) => Math.round(v * 100) + "%",
    elevate: (v) => (v > 0 ? "+" : "") + (Math.round(v * 10) / 10) + " dB"
  };
  function syncInputs() {
    const p = shown();
    $("#ek-speed").value = p.speed; $("#ek-vol").value = p.volume;
    $("#ek-smooth").value = p.smooth; $("#ek-elevate").value = p.elevate;
    syncLabels();
  }
  function syncLabels() {
    const p = shown();
    $("#ek-speed-v").textContent = fmt.speed(p.speed);
    $("#ek-vol-v").textContent = fmt.volume(p.volume);
    $("#ek-smooth-v").textContent = fmt.smooth(p.smooth);
    $("#ek-elevate-v").textContent = fmt.elevate(p.elevate);
    const sl = $("#ed-sel-label");
    if (selIndex >= 0 && segs[selIndex]) sl.textContent = "part · " + fmtClock(segs[selIndex].start) + " – " + fmtClock(segs[selIndex].end);
    else if (selection) sl.textContent = "selection · " + fmtClock(selection.start) + " – " + fmtClock(selection.end);
    else sl.textContent = "whole song";
  }

  function editKey(key, val) {
    if (selection) {
      let seg = activeSeg();
      const matches = seg && Math.abs(seg.start - selection.start) < 0.02 && Math.abs(seg.end - selection.end) < 0.02;
      if (!matches) {
        // carve the selection out of any overlapping parts and make a new one
        segs = segs.filter((g) => g.end <= selection.start + 0.02 || g.start >= selection.end - 0.02);
        seg = Object.assign({ start: selection.start, end: selection.end }, global, activeSeg() || {});
        seg.start = selection.start; seg.end = selection.end;
        segs.push(seg); segs.sort((a, b) => a.start - b.start);
        selIndex = segs.indexOf(seg);
      }
      seg[key] = val;
    } else {
      global[key] = val;
    }
    lastKey = null; save(); renderSegs(); syncLabels();
  }
  [["#ek-speed", "speed"], ["#ek-vol", "volume"], ["#ek-smooth", "smooth"], ["#ek-elevate", "elevate"]]
    .forEach(([id, key]) => $(id).addEventListener("input", (e) => editKey(key, parseFloat(e.target.value))));

  // ---------------------------------------------------- waveform
  const peakCache = {};
  let peaks = null;
  let decodeCtx = null;
  function getCtx() { return (window.SoundFX && window.SoundFX.ctx) || (decodeCtx || (decodeCtx = new (window.AudioContext || window.webkitAudioContext)())); }

  async function decode(src) {
    const resp = await fetch(src);
    const arr = await resp.arrayBuffer();
    return await getCtx().decodeAudioData(arr);
  }
  function computePeaks(buf, n) {
    const len = buf.length, per = Math.max(1, Math.floor(len / n));
    const ch0 = buf.getChannelData(0), ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    const out = new Float32Array(n);
    for (let b = 0; b < n; b++) {
      let mx = 0; const s = b * per, e = Math.min(len, s + per);
      for (let i = s; i < e; i++) {
        let v = ch0[i]; if (v < 0) v = -v;
        if (ch1) { let v2 = ch1[i]; if (v2 < 0) v2 = -v2; if (v2 > v) v = v2; }
        if (v > mx) mx = v;
      }
      out[b] = mx;
    }
    return out;
  }
  async function loadWaveform() {
    const cur = window.SoundCurrent;
    peaks = null; drawWave();
    if (!cur || !cur.src) { status("play a movement to see its waveform"); return; }
    if (peakCache[cur.src]) { peaks = peakCache[cur.src]; drawWave(); status(""); return; }
    status("analysing…");
    try {
      const buf = await decode(cur.src);
      peaks = computePeaks(buf, 2000);
      peakCache[cur.src] = peaks;
      drawWave(); status("");
    } catch (e) { console.warn("waveform decode failed", e); status("waveform unavailable"); }
  }
  function drawWave() {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, W, H);
    if (!peaks) return;
    const mid = H / 2, n = peaks.length;
    const grd = cx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, "rgba(150,170,255,0.85)");
    grd.addColorStop(0.5, "rgba(120,205,210,0.6)");
    grd.addColorStop(1, "rgba(150,170,255,0.85)");
    cx.strokeStyle = grd; cx.lineWidth = 1;
    cx.beginPath();
    for (let x = 0; x < W; x++) {
      const a = peaks[Math.floor(x / W * n)] || 0;
      const amp = Math.max(0.5, a * mid * 0.92);
      cx.moveTo(x + 0.5, mid - amp); cx.lineTo(x + 0.5, mid + amp);
    }
    cx.stroke();
  }

  // ---------------------------------------------------- overlays
  function pct(t) { const d = duration() || 1; return clamp(t / d, 0, 1) * 100; }
  function describe(p) {
    const b = [];
    if (p.speed !== 1) b.push(p.speed.toFixed(2) + "×");
    if (p.volume !== 1) b.push(Math.round(p.volume * 100) + "%");
    if (p.smooth) b.push("smooth");
    if (p.elevate) b.push("+air");
    return b.length ? b.join(" · ") : "default";
  }
  function renderSegs() {
    segLayer.querySelectorAll(".ed-seg").forEach((n) => n.remove());
    const tNow = (window.SoundAudio && window.SoundAudio.currentTime) || 0;
    segs.forEach((s, i) => {
      const el = document.createElement("div");
      const isActive = tNow >= s.start && tNow < s.end;
      el.className = "ed-seg" + (i === selIndex ? " sel" : "") + (isActive ? " active" : "");
      el.style.left = pct(s.start) + "%";
      el.style.width = (pct(s.end) - pct(s.start)) + "%";
      el.innerHTML =
        '<span class="ed-handle left" data-edge="left"></span>' +
        '<span class="ed-seg-tag">' + describe(s) + "</span>" +
        '<span class="ed-seg-time start">' + fmtClock(s.start) + "</span>" +
        '<span class="ed-seg-time end">' + fmtClock(s.end) + "</span>" +
        '<span class="ed-handle right" data-edge="right"></span>';
      // select the part by clicking its body
      el.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        selection = { start: s.start, end: s.end }; selIndex = i;
        showSelection(); renderSegs(); syncInputs();
      });
      // grab an edge to mark its start / end
      el.querySelectorAll(".ed-handle").forEach((h) =>
        h.addEventListener("pointerdown", (ev) => {
          ev.stopPropagation();
          handleDrag = { i, edge: h.dataset.edge };
          selIndex = i; selection = { start: s.start, end: s.end };
          showSelection(); syncInputs();
        }));
      segLayer.appendChild(el);
    });
    $("#ed-hint").style.opacity = (segs.length || selection) ? 0 : 1;
    lastActive = -2;   // let the tick loop refresh the active highlight + readout
  }

  // drag a boundary handle to set a part's start / end
  window.addEventListener("pointermove", (e) => {
    if (!handleDrag) return;
    const dur = duration() || 0; const seg = segs[handleDrag.i]; if (!seg) return;
    const t = xToTime(e.clientX), idx = handleDrag.i;
    if (handleDrag.edge === "left") {
      const lo = idx > 0 ? segs[idx - 1].end : 0;
      seg.start = clamp(t, lo, seg.end - MIN_SEG);
    } else {
      const hi = idx < segs.length - 1 ? segs[idx + 1].start : dur;
      seg.end = clamp(t, seg.start + MIN_SEG, hi);
    }
    selection = { start: seg.start, end: seg.end };
    showSelection(); renderSegs(); syncLabels();
    status("mark " + handleDrag.edge + " · " + fmtClock(handleDrag.edge === "left" ? seg.start : seg.end));
  });
  window.addEventListener("pointerup", () => {
    if (handleDrag) { handleDrag = null; lastKey = null; save(); setTimeout(() => status(""), 900); }
  });
  function showSelection() {
    if (!selection) { selEl.style.display = "none"; return; }
    selEl.style.display = "block";
    selEl.style.left = pct(selection.start) + "%";
    selEl.style.width = (pct(selection.end) - pct(selection.start)) + "%";
  }

  // ---------------------------------------------------- pointer (select / seek)
  let dragging = false, downX = 0, downT = 0;
  function xToTime(clientX) {
    const r = wrap.getBoundingClientRect();
    return clamp((clientX - r.left) / r.width, 0, 1) * (duration() || 0);
  }
  wrap.addEventListener("pointerdown", (e) => {
    if (!duration()) return;
    dragging = true; downX = e.clientX; downT = xToTime(e.clientX);
    selection = { start: downT, end: downT }; selIndex = -1;
    wrap.setPointerCapture(e.pointerId);
    showSelection();
  });
  wrap.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const t = xToTime(e.clientX);
    selection = { start: Math.min(downT, t), end: Math.max(downT, t) };
    showSelection(); syncLabels();
  });
  wrap.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    const moved = Math.abs(e.clientX - downX);
    if (moved < 5) {                       // a click -> seek, clear selection
      if (window.SoundAudio) window.SoundAudio.currentTime = downT;
      selection = null; selIndex = -1; showSelection();
    } else {
      // snap onto an existing identical part if it matches
      const i = segs.findIndex((s) => Math.abs(s.start - selection.start) < 0.05 && Math.abs(s.end - selection.end) < 0.05);
      selIndex = i;
    }
    renderSegs(); syncInputs();
  });

  // ---------------------------------------------------- buttons
  $("#ed-remove").addEventListener("click", () => {
    if (selIndex >= 0) { segs.splice(selIndex, 1); selIndex = -1; }
    else if (selection) { segs = segs.filter((g) => g.end <= selection.start + 0.02 || g.start >= selection.end - 0.02); }
    else { status("select a part first"); return; }
    lastKey = null; save(); renderSegs(); syncInputs(); status("part cleared");
  });
  $("#ed-clear").addEventListener("click", () => {
    segs = []; selection = null; selIndex = -1;
    lastKey = null; save(); showSelection(); renderSegs(); syncInputs(); status("all edits removed");
  });
  $("#ed-close").addEventListener("click", close);
  $("#studio-toggle").addEventListener("click", () => $("#studio").classList.contains("open") ? close() : open());
  $("#ed-transport").addEventListener("click", () => window.PlayerCtl && window.PlayerCtl.toggle());
  $("#ed-prev").addEventListener("click", () => window.PlayerCtl && window.PlayerCtl.prev());
  $("#ed-next").addEventListener("click", () => window.PlayerCtl && window.PlayerCtl.next());
  $("#ed-save").addEventListener("click", exportWav);

  function open() {
    $("#studio").classList.add("open");
    document.body.classList.add("editing");
    requestAnimationFrame(() => { drawWave(); renderSegs(); showSelection(); });
    if (!peaks) loadWaveform();
  }
  function close() {
    $("#studio").classList.remove("open");
    document.body.classList.remove("editing");
  }

  function status(msg, busy) { const el = $("#ed-status"); el.textContent = msg || ""; el.classList.toggle("busy", !!busy); }

  // ---------------------------------------------------- per-track load
  function loadTrack() {
    const k = trackKey(), dur = duration();
    segs = (k && segMap[k]) ? segMap[k].map((s) => Object.assign({}, s)) : [];
    if (dur) segs.forEach((s) => { s.end = Math.min(s.end, dur); });
    segs = segs.filter((s) => s.end - s.start > 0.05);
    selection = null; selIndex = -1; lastKey = null;
    const cur = window.SoundCurrent;
    $("#ed-track").textContent = cur ? (cur.album + " · " + cur.name) : "—";
    syncInputs(); showSelection(); renderSegs();
    if ($("#studio").classList.contains("open")) loadWaveform();
  }

  // ---------------------------------------------------- transport icon + tick
  function setIcon() { $("#ed-transport").textContent = (window.PlayerCtl && !window.PlayerCtl.isPaused()) ? "❚❚" : "►"; }
  if (window.SoundAudio) {
    window.SoundAudio.addEventListener("loadedmetadata", loadTrack);
    window.SoundAudio.addEventListener("play", () => { lastKey = null; setIcon(); });
    window.SoundAudio.addEventListener("pause", setIcon);
  }
  window.addEventListener("resize", () => { if ($("#studio").classList.contains("open")) { drawWave(); renderSegs(); showSelection(); } }, { passive: true });

  function tick() {
    const a = window.SoundAudio;
    if (a) {
      const t = a.currentTime || 0;
      const p = paramsAt(t), s = sig(p);
      if (s !== lastKey) { applyParams(p); lastKey = s; }
      // which part is the playhead inside? -> highlight it + show its controls
      const ai = segs.findIndex((g) => t >= g.start && t < g.end);
      if (ai !== lastActive) {
        lastActive = ai;
        segLayer.querySelectorAll(".ed-seg").forEach((el, i) => el.classList.toggle("active", i === ai));
        const np = $("#ed-now");
        if (np) np.textContent = (ai >= 0 ? "▸ part " + (ai + 1) + ": " : "▸ ") + describe(ai >= 0 ? segs[ai] : global);
      }
      if ($("#studio").classList.contains("open") && duration()) playEl.style.left = pct(t) + "%";
    }
    requestAnimationFrame(tick);
  }

  // ---------------------------------------------------- WAV export
  function buildPieces(dur) {
    const sorted = segs.slice().sort((a, b) => a.start - b.start);
    const pieces = []; let t = 0;
    for (const s of sorted) {
      const st = clamp(s.start, 0, dur), en = clamp(s.end, st, dur);
      if (st > t + 0.001) pieces.push(Object.assign({ start: t, end: st }, global));
      pieces.push({ start: st, end: en, speed: s.speed, volume: s.volume, smooth: s.smooth, elevate: s.elevate });
      t = en;
    }
    if (t < dur - 0.001) pieces.push(Object.assign({ start: t, end: dur }, global));
    if (!pieces.length) pieces.push(Object.assign({ start: 0, end: dur }, global));
    return pieces;
  }
  function renderPiece(buf, seg) {
    const sr = buf.sampleRate;
    const s0 = Math.floor(seg.start * sr), s1 = Math.min(buf.length, Math.floor(seg.end * sr));
    const n = Math.max(1, s1 - s0);
    const off = new OfflineAudioContext(buf.numberOfChannels, Math.max(1, Math.ceil(n / seg.speed)), sr);
    const slice = off.createBuffer(buf.numberOfChannels, n, sr);
    for (let c = 0; c < buf.numberOfChannels; c++) slice.getChannelData(c).set(buf.getChannelData(c).subarray(s0, s1));
    const src = off.createBufferSource(); src.buffer = slice; src.playbackRate.value = seg.speed;
    const g = off.createGain(); g.gain.value = seg.volume;
    const lp = off.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = smoothCutoff(seg.smooth); lp.Q.value = 0.7;
    const hs = off.createBiquadFilter(); hs.type = "highshelf"; hs.frequency.value = 3500; hs.gain.value = seg.elevate;
    const comp = off.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 24; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
    src.connect(g); g.connect(lp); lp.connect(hs); hs.connect(comp); comp.connect(off.destination);
    src.start(0);
    return off.startRendering();
  }
  async function exportWav() {
    const cur = window.SoundCurrent;
    if (!cur || !cur.src) { status("play a movement first"); return; }
    status("rendering…", true);
    try {
      const buf = await decode(cur.src);
      const dur = buf.duration;
      const pieces = buildPieces(dur);
      const rendered = [];
      for (const p of pieces) rendered.push(await renderPiece(buf, p));
      const numCh = buf.numberOfChannels, sr = buf.sampleRate;
      const total = rendered.reduce((a, r) => a + r.length, 0);
      const holder = new OfflineAudioContext(numCh, Math.max(1, total), sr);
      const final = holder.createBuffer(numCh, total, sr);
      let off = 0;
      for (const r of rendered) { for (let c = 0; c < numCh; c++) final.getChannelData(c).set(r.getChannelData(c), off); off += r.length; }
      const blob = new Blob([encodeWAV(final)], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const safe = ((cur.album || "") + " - " + (cur.name || "movement")).replace(/[^a-z0-9 _-]/gi, "").trim() || "movement";
      const a = document.createElement("a");
      a.href = url; a.download = safe + (segs.length ? " (edited)" : " (studio)") + ".wav";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      status("saved · " + safe + ".wav");
    } catch (e) { console.warn("WAV export failed", e); status("export failed (see console)"); }
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
    for (let i = 0; i < len; i++)
      for (let c = 0; c < numCh; c++) { let v = Math.max(-1, Math.min(1, chans[c][i])); view.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7FFF, true); p += 2; }
    return view.buffer;
  }

  // ---------------------------------------------------- init
  window.Studio = { apply: () => { lastKey = null; } };
  syncInputs(); setIcon();
  requestAnimationFrame(tick);
})();
