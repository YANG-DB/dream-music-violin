// ============================================================================
//  studio.js — an in-browser sound studio with per-segment automation.
//  Controls: speed · volume/gain · smooth (warmth) · elevate (air).
//  A song can be split into segments, each with its own settings, applied live
//  as playback crosses them and baked into a .wav export. All saved locally.
// ============================================================================
(function () {
  const $ = (s) => document.querySelector(s);

  const DEFAULTS = { speed: 1, volume: 1, smooth: 0, elevate: 0 };
  let global = Object.assign({}, DEFAULTS);   // whole-song values (shared)
  let segMap = {};                            // { trackKey: [segments] }
  let segs = [];                              // current track's segments (tiling)
  let sel = -1;                              // editing target: -1 = whole song
  let lastKey = null;                        // last applied active-param signature

  try { const s = JSON.parse(localStorage.getItem("dream-studio") || "null"); if (s) global = Object.assign(global, s); } catch (e) {}
  try { const m = JSON.parse(localStorage.getItem("dream-segments") || "null"); if (m) segMap = m; } catch (e) {}

  const smoothCutoff = (v) => 20000 * Math.pow(1100 / 20000, v);
  const trackKey = () => (window.SoundCurrent && window.SoundCurrent.src) || null;
  const duration = () => (window.SoundAudio && window.SoundAudio.duration) || 0;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function fmtClock(s) { s = Math.max(0, s || 0); return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0"); }
  function fmtSpeed(v) { return v.toFixed(2) + "×"; }
  function fmtDb(v) { return (v > 0 ? "+" : "") + (Math.round(v * 10) / 10) + " dB"; }

  // the parameter set the sliders currently edit
  function editing() { return (sel >= 0 && segs[sel]) ? segs[sel] : global; }
  // the parameter set that applies at media-time t
  function paramsAt(t) {
    if (!segs.length) return global;
    for (const s of segs) if (t >= s.start && t < s.end) return s;
    return segs[segs.length - 1];
  }

  // --------------------------------------------------- apply to the live graph
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
    localStorage.setItem("dream-segments", JSON.stringify(segMap));
  }

  // --------------------------------------------------- sliders
  function syncInputs() {
    const e = editing();
    $("#sx-speed").value = e.speed; $("#sx-vol").value = e.volume;
    $("#sx-smooth").value = e.smooth; $("#sx-elevate").value = e.elevate;
    syncLabels();
  }
  function syncLabels() {
    const e = editing();
    $("#sx-speed-val").textContent = fmtSpeed(e.speed);
    $("#sx-vol-val").textContent = Math.round(e.volume * 100) + "%";
    $("#sx-smooth-val").textContent = Math.round(e.smooth * 100) + "%";
    $("#sx-elevate-val").textContent = fmtDb(e.elevate);
    $("#sx-seg-label").textContent = (sel >= 0 && segs[sel])
      ? fmtClock(segs[sel].start) + " – " + fmtClock(segs[sel].end)
      : (segs.length ? "select a segment" : "whole song");
  }
  function bind(id, key) {
    $(id).addEventListener("input", (e) => {
      editing()[key] = parseFloat(e.target.value);
      lastKey = null;            // force the live loop to re-apply
      save(); syncLabels();
    });
  }
  bind("#sx-speed", "speed"); bind("#sx-vol", "volume");
  bind("#sx-smooth", "smooth"); bind("#sx-elevate", "elevate");

  $("#sx-reset").addEventListener("click", () => {
    Object.assign(editing(), DEFAULTS);
    lastKey = null; save(); syncInputs(); status(sel >= 0 ? "segment flattened" : "flat · unprocessed");
  });

  // --------------------------------------------------- segments
  function selectSeg(i) { sel = i; syncInputs(); renderTimeline(); }

  function splitAtPlayhead() {
    const dur = duration(); if (dur <= 0.5) { status("play the movement first"); return; }
    const t = clamp(window.SoundAudio.currentTime, 0.05, dur - 0.05);
    if (!segs.length) {
      segs = [
        Object.assign({ start: 0, end: t }, global),
        Object.assign({ start: t, end: dur }, global)
      ];
    } else {
      const i = segs.findIndex((s) => t > s.start + 0.05 && t < s.end - 0.05);
      if (i < 0) { status("too close to a boundary"); return; }
      const cur = segs[i];
      const right = Object.assign({}, cur, { start: t, end: cur.end });
      cur.end = t;
      segs.splice(i + 1, 0, right);
    }
    save();
    selectSeg(segs.findIndex((s) => t >= s.start && t < s.end));
    status(segs.length + " segments");
  }
  function deleteSeg() {
    if (sel < 0 || !segs.length) { status("select a segment first"); return; }
    const i = sel;
    if (segs.length <= 2) {                 // back to whole-song, keep the kept seg's values
      const keep = segs[i === 0 ? 1 : 0];
      Object.assign(global, { speed: keep.speed, volume: keep.volume, smooth: keep.smooth, elevate: keep.elevate });
      segs = [];
    } else if (i === 0) {
      segs[1].start = 0; segs.splice(0, 1);
    } else {
      segs[i - 1].end = segs[i].end; segs.splice(i, 1);
    }
    sel = -1; lastKey = null; save(); syncInputs(); renderTimeline(); status("segment removed");
  }
  $("#sx-split").addEventListener("click", splitAtPlayhead);
  $("#sx-del").addEventListener("click", deleteSeg);
  $("#sx-clear").addEventListener("click", () => {
    segs = []; sel = -1; lastKey = null; save(); syncInputs(); renderTimeline(); status("whole song");
  });

  // --------------------------------------------------- timeline render
  const timeline = $("#sx-timeline");
  function renderTimeline() {
    const dur = duration() || 1;
    timeline.querySelectorAll(".sx-seg-block").forEach((n) => n.remove());
    timeline.classList.toggle("whole", segs.length === 0);
    const blocks = segs.length ? segs : [{ start: 0, end: dur }];
    blocks.forEach((s, i) => {
      const b = document.createElement("div");
      b.className = "sx-seg-block" + (segs.length && sel === i ? " sel" : "");
      b.style.flexGrow = Math.max(0.02, (s.end - s.start));
      if (segs.length) {
        const sp = Math.round(s.speed * 100) / 100;
        b.textContent = sp !== 1 ? sp + "×" : "";
        b.addEventListener("click", (ev) => { ev.stopPropagation(); selectSeg(i); });
      }
      timeline.insertBefore(b, $("#sx-playhead"));
    });
  }
  // clicking the empty (whole-song) timeline selects the global set
  timeline.addEventListener("click", () => { if (!segs.length) { sel = -1; syncInputs(); } });

  // --------------------------------------------------- per-track load
  function loadTrack() {
    const k = trackKey(), dur = duration();
    segs = (k && segMap[k]) ? segMap[k].map((s) => Object.assign({}, s)) : [];
    if (segs.length && dur) { segs[segs.length - 1].end = Math.max(segs[segs.length - 1].start + 0.1, dur); }
    sel = -1; lastKey = null; syncInputs(); renderTimeline();
  }

  // --------------------------------------------------- live loop
  function tick() {
    const a = window.SoundAudio;
    if (a) {
      const t = a.currentTime || 0;
      const p = paramsAt(t);
      const s = sig(p);
      if (s !== lastKey) { applyParams(p); lastKey = s; }
      const dur = duration();
      if (dur) {
        const w = timeline.clientWidth;
        $("#sx-playhead").style.left = clamp(t / dur, 0, 1) * w + "px";
        // live highlight of the active segment
        const ai = segs.length ? segs.findIndex((g) => t >= g.start && t < g.end) : -1;
        const blocks = timeline.querySelectorAll(".sx-seg-block");
        blocks.forEach((b, i) => b.classList.toggle("active", i === ai));
      }
    }
    requestAnimationFrame(tick);
  }

  // --------------------------------------------------- status + panel
  function status(msg, busy) { const el = $("#sx-status"); el.textContent = msg || ""; el.classList.toggle("busy", !!busy); }
  $("#studio-toggle").addEventListener("click", () => $("#studio").classList.toggle("open"));

  if (window.SoundAudio) {
    window.SoundAudio.addEventListener("loadedmetadata", loadTrack);
    window.SoundAudio.addEventListener("play", () => { lastKey = null; });
  }

  // --------------------------------------------------- WAV export (with segments)
  $("#sx-save").addEventListener("click", exportWav);

  function renderSlice(ctxClass, buf, seg) {
    const sr = buf.sampleRate;
    const s0 = Math.floor(seg.start * sr), s1 = Math.min(buf.length, Math.floor(seg.end * sr));
    const n = Math.max(1, s1 - s0);
    const slice = (ctxClass._tmp).createBuffer(buf.numberOfChannels, n, sr);
    for (let c = 0; c < buf.numberOfChannels; c++) slice.getChannelData(c).set(buf.getChannelData(c).subarray(s0, s1));
    const outLen = Math.max(1, Math.ceil(n / seg.speed));
    const off = new OfflineAudioContext(buf.numberOfChannels, outLen, sr);
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
      const resp = await fetch(cur.src);
      const arr = await resp.arrayBuffer();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const tmp = new Ctx();
      const buf = await tmp.decodeAudioData(arr);
      const dur = buf.duration;
      const parts = segs.length
        ? segs.map((s) => ({ start: s.start, end: Math.min(s.end, dur), speed: s.speed, volume: s.volume, smooth: s.smooth, elevate: s.elevate }))
        : [Object.assign({ start: 0, end: dur }, global)];

      const helper = { _tmp: tmp };
      const rendered = [];
      for (const seg of parts) rendered.push(await renderSlice(helper, buf, seg));
      tmp.close();

      // concatenate the rendered segments
      const numCh = buf.numberOfChannels, sr = buf.sampleRate;
      const total = rendered.reduce((a, r) => a + r.length, 0);
      const out = new OfflineAudioContext(numCh, total, sr); // only to hold a buffer
      const final = out.createBuffer(numCh, total, sr);
      let off = 0;
      for (const r of rendered) {
        for (let c = 0; c < numCh; c++) final.getChannelData(c).set(r.getChannelData(c), off);
        off += r.length;
      }

      const blob = new Blob([encodeWAV(final)], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const safe = ((cur.album || "") + " - " + (cur.name || "movement")).replace(/[^a-z0-9 _-]/gi, "").trim() || "movement";
      const a = document.createElement("a");
      a.href = url; a.download = safe + (segs.length ? " (segmented)" : " (studio)") + ".wav";
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
      for (let c = 0; c < numCh; c++) {
        let v = Math.max(-1, Math.min(1, chans[c][i]));
        view.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7FFF, true); p += 2;
      }
    return view.buffer;
  }

  // --------------------------------------------------- init
  window.Studio = { apply: () => { lastKey = null; } };
  syncInputs(); renderTimeline();
  requestAnimationFrame(tick);
})();
