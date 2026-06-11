// ============================================================================
//  studio.js — sound editor built on wavesurfer.js (waveform + Regions),
//  keeping the per-part effects (speed/volume/smooth/elevate), live application
//  and offline .wav export. Parts are saved locally per track.
// ============================================================================
import WaveSurfer from "./vendor/wavesurfer.esm.js";
import RegionsPlugin from "./vendor/wavesurfer.regions.esm.js";

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const DEFAULTS = { speed: 1, volume: 1, smooth: 0, elevate: 0 };
let global = Object.assign({}, DEFAULTS);
let segMap = {};                 // { trackKey: [{start,end,fx}] }
let fxById = {};                 // region.id -> {speed,volume,smooth,elevate}
let selectedId = null;
let lastKey = null;
let ws = null, regions = null, loading = false, builtFor = null;
const peakCache = {};

try { const s = JSON.parse(localStorage.getItem("dream-studio") || "null"); if (s) global = Object.assign(global, s); } catch (e) {}
try { const m = JSON.parse(localStorage.getItem("dream-wave-segs") || "null"); if (m) segMap = m; } catch (e) {}

const smoothCutoff = (v) => 20000 * Math.pow(1100 / 20000, v);
const trackKey = () => (window.SoundCurrent && window.SoundCurrent.src) || null;
const duration = () => (window.SoundAudio && window.SoundAudio.duration) || 0;
const fmtClock = (s) => { s = Math.max(0, s || 0); return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0"); };

function describe(p) {
  const b = [];
  if (p.speed !== 1) b.push(p.speed.toFixed(2) + "×");
  if (p.volume !== 1) b.push(Math.round(p.volume * 100) + "%");
  if (p.smooth) b.push("smooth");
  if (p.elevate) b.push("+air");
  return b.length ? b.join(" · ") : "part";
}

// ----------------------------------------------------- effects (live)
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

function regionList() { return regions ? regions.getRegions() : []; }
function paramsAt(t) {
  for (const r of regionList()) if (t >= r.start && t < r.end) return fxById[r.id] || global;
  return global;
}
function selectedFx() { return (selectedId && fxById[selectedId]) ? fxById[selectedId] : null; }
function shown() { return selectedFx() || global; }

function save() {
  localStorage.setItem("dream-studio", JSON.stringify(global));
  const k = trackKey();
  if (k) {
    const arr = regionList().map((r) => ({ start: r.start, end: r.end, fx: fxById[r.id] || Object.assign({}, DEFAULTS) }));
    if (arr.length) segMap[k] = arr; else delete segMap[k];
  }
  localStorage.setItem("dream-wave-segs", JSON.stringify(segMap));
}

// ----------------------------------------------------- sliders
const fmt = {
  speed: (v) => v.toFixed(2) + "×", volume: (v) => Math.round(v * 100) + "%",
  smooth: (v) => Math.round(v * 100) + "%", elevate: (v) => (v > 0 ? "+" : "") + (Math.round(v * 10) / 10) + " dB"
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
  const r = selectedRegion();
  $("#ed-sel-label").textContent = r ? "part · " + fmtClock(r.start) + " – " + fmtClock(r.end)
    : (regionList().length ? "select a part" : "whole song");
}
function selectedRegion() { return regionList().find((r) => r.id === selectedId) || null; }

function editKey(key, val) {
  const r = selectedRegion();
  if (r) { (fxById[r.id] = fxById[r.id] || Object.assign({}, DEFAULTS))[key] = val; setTag(r); }
  else global[key] = val;
  lastKey = null; save(); syncLabels();
}
[["#ek-speed", "speed"], ["#ek-vol", "volume"], ["#ek-smooth", "smooth"], ["#ek-elevate", "elevate"]]
  .forEach(([id, key]) => $(id).addEventListener("input", (e) => editKey(key, parseFloat(e.target.value))));

$("#ed-reset").addEventListener("click", () => {
  const r = selectedRegion();
  if (r) { fxById[r.id] = Object.assign({}, DEFAULTS); setTag(r); } else Object.assign(global, DEFAULTS);
  lastKey = null; save(); syncInputs(); status(r ? "part flattened" : "flat · unprocessed");
});

// ----------------------------------------------------- regions
const REGION_COLOR = "rgba(138,166,255,0.18)";
const REGION_SEL = "rgba(155,231,212,0.30)";
function setTag(r) { if (r.setContent) r.setContent(describe(fxById[r.id] || global)); }
function selectRegion(r) {
  selectedId = r ? r.id : null;
  regionList().forEach((g) => g.setOptions && g.setOptions({ color: g.id === selectedId ? REGION_SEL : REGION_COLOR }));
  syncInputs();
}

function wireRegions() {
  regions.enableDragSelection({ color: REGION_COLOR });
  regions.on("region-created", (r) => {
    if (loading) return;                       // programmatic adds handle their own fx
    fxById[r.id] = Object.assign({}, global);
    setTag(r); selectRegion(r); save();
  });
  regions.on("region-updated", () => save());
  regions.on("region-clicked", (r, e) => { e && e.stopPropagation && e.stopPropagation(); selectRegion(r); });
  regions.on("region-removed", (r) => { delete fxById[r.id]; if (selectedId === r.id) selectedId = null; save(); syncInputs(); });
}

// ----------------------------------------------------- waveform build
async function decodePeaks(src) {
  if (peakCache[src]) return peakCache[src];
  const resp = await fetch(src);
  const arr = await resp.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const buf = await ctx.decodeAudioData(arr);
  ctx.close();
  const N = 2400, per = Math.max(1, Math.floor(buf.length / N)), ch = buf.getChannelData(0);
  const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const pk = new Float32Array(N);
  for (let b = 0; b < N; b++) {
    let mx = 0; const s = b * per, e = Math.min(buf.length, s + per);
    for (let i = s; i < e; i++) { let v = ch[i]; if (v < 0) v = -v; if (ch1) { let v2 = ch1[i]; if (v2 < 0) v2 = -v2; if (v2 > v) v = v2; } if (v > mx) mx = v; }
    pk[b] = mx;
  }
  peakCache[src] = pk;
  return pk;
}

async function buildWave() {
  const cur = window.SoundCurrent;
  if (!cur || !cur.src) { status("play a movement to see its waveform"); return; }
  if (builtFor === cur.src && ws) return;       // already built for this track
  status("analysing…");
  let peaks, dur;
  try { peaks = await decodePeaks(cur.src); dur = duration() || (window.SoundAudio && window.SoundAudio.duration) || 0; }
  catch (e) { console.warn("waveform decode failed", e); status("waveform unavailable"); return; }

  if (ws) { try { ws.destroy(); } catch (e) {} ws = null; }
  regions = RegionsPlugin.create();
  ws = WaveSurfer.create({
    container: "#ed-ws",
    media: window.SoundAudio,                  // follow the app's playback (no double audio)
    peaks: [peaks], duration: dur || undefined,
    height: 110, waveColor: "#7f9bf0", progressColor: "#9be7d4",
    cursorColor: "#ffffff", cursorWidth: 2, normalize: true, interact: true,
    plugins: [regions]
  });
  builtFor = cur.src;
  wireRegions();

  // restore saved parts for this track
  loading = true;
  fxById = {}; selectedId = null;
  const saved = (segMap[cur.src] || []).filter((s) => s.end - s.start > 0.05);
  for (const s of saved) {
    const r = regions.addRegion({ start: s.start, end: Math.min(s.end, dur || s.end), color: REGION_COLOR, drag: true, resize: true });
    fxById[r.id] = Object.assign({}, DEFAULTS, s.fx); setTag(r);
  }
  loading = false;
  status(""); syncInputs();
}

// ----------------------------------------------------- buttons / panel
$("#ed-remove").addEventListener("click", () => {
  const r = selectedRegion();
  if (r) { r.remove(); status("part removed"); } else status("select a part first");
});
$("#ed-clear").addEventListener("click", () => { if (regions) regions.clearRegions(); fxById = {}; selectedId = null; save(); syncInputs(); status("all parts removed"); });
$("#ed-close").addEventListener("click", close);
$("#studio-toggle").addEventListener("click", () => $("#studio").classList.contains("open") ? close() : open());
$("#ed-transport").addEventListener("click", () => window.PlayerCtl && window.PlayerCtl.toggle());
$("#ed-prev").addEventListener("click", () => window.PlayerCtl && window.PlayerCtl.prev());
$("#ed-next").addEventListener("click", () => window.PlayerCtl && window.PlayerCtl.next());
$("#ed-save").addEventListener("click", exportWav);

function open() { $("#studio").classList.add("open"); document.body.classList.add("editing"); buildWave(); }
function close() { $("#studio").classList.remove("open"); document.body.classList.remove("editing"); }
function status(msg, busy) { const el = $("#ed-status"); el.textContent = msg || ""; el.classList.toggle("busy", !!busy); }
function setIcon() { $("#ed-transport").textContent = (window.PlayerCtl && !window.PlayerCtl.isPaused()) ? "❚❚" : "►"; }

if (window.SoundAudio) {
  window.SoundAudio.addEventListener("loadedmetadata", () => {
    const cur = window.SoundCurrent;
    $("#ed-track").textContent = cur ? (cur.album + " · " + cur.name) : "—";
    if ($("#studio").classList.contains("open")) buildWave();
  });
  window.SoundAudio.addEventListener("play", () => { lastKey = null; setIcon(); });
  window.SoundAudio.addEventListener("pause", setIcon);
}

// live effect application + active-part readout
let lastActive = -2;
function tick() {
  const a = window.SoundAudio;
  if (a) {
    const t = a.currentTime || 0;
    const p = paramsAt(t), s = sig(p);
    if (s !== lastKey) { applyParams(p); lastKey = s; }
    const list = regionList();
    let ai = -1; for (let i = 0; i < list.length; i++) if (t >= list[i].start && t < list[i].end) { ai = i; break; }
    if (ai !== lastActive) {
      lastActive = ai;
      const np = $("#ed-now");
      if (np) np.textContent = (ai >= 0 ? "▸ part: " : "▸ ") + describe(ai >= 0 ? (fxById[list[ai].id] || global) : global);
    }
  }
  requestAnimationFrame(tick);
}

// ----------------------------------------------------- WAV export
function buildPieces(dur) {
  const segs = regionList().map((r) => ({ start: r.start, end: r.end, fx: fxById[r.id] || global })).sort((a, b) => a.start - b.start);
  const pieces = []; let t = 0;
  for (const s of segs) {
    const st = clamp(s.start, 0, dur), en = clamp(s.end, st, dur);
    if (st > t + 0.001) pieces.push(Object.assign({ start: t, end: st }, global));
    pieces.push(Object.assign({ start: st, end: en }, s.fx));
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
    const resp = await fetch(cur.src);
    const arr = await resp.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const tmp = new Ctx();
    const buf = await tmp.decodeAudioData(arr);
    tmp.close();
    const pieces = buildPieces(buf.duration);
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
    a.href = url; a.download = safe + (regionList().length ? " (edited)" : " (studio)") + ".wav";
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
  const ws2 = (str) => { for (let i = 0; i < str.length; i++) view.setUint8(p++, str.charCodeAt(i)); };
  const u32 = (v) => { view.setUint32(p, v, true); p += 4; };
  const u16 = (v) => { view.setUint16(p, v, true); p += 2; };
  ws2("RIFF"); u32(36 + dataSize); ws2("WAVE");
  ws2("fmt "); u32(16); u16(1); u16(numCh); u32(sr); u32(sr * blockAlign); u16(blockAlign); u16(16);
  ws2("data"); u32(dataSize);
  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(ab.getChannelData(c));
  for (let i = 0; i < len; i++)
    for (let c = 0; c < numCh; c++) { let v = Math.max(-1, Math.min(1, chans[c][i])); view.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7FFF, true); p += 2; }
  return view.buffer;
}

// ----------------------------------------------------- init
window.Studio = { apply: () => { lastKey = null; } };
syncInputs(); setIcon();
requestAnimationFrame(tick);
