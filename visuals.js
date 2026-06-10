// ============================================================================
//  Dream — the audio-reactive dreamscape engine.
//  Layers: gradient sky · aurora ribbons · starfield · drifting clouds ·
//  butterflies · birds · hallucination blooms.  All react to the music and
//  crossfade smoothly between themes (incl. an adaptive "Auto" mode).
// ============================================================================
const Dream = (function () {
  let canvas, ctx, W = 0, H = 0, DPR = 1;
  let analyser = null, freq = null, prevFreq = null;
  let running = false, motion = true, auto = false;
  let onAdapt = null;

  // Smoothed audio signals (0..1)
  let energy = 0, flux = 0, bass = 0, treble = 0, beat = 0;

  // Current + target color state (for smooth theme crossfades)
  let cur = null, target = null, themeKey = "nocturne";

  // Fantasy-image backgrounds (composited inside the canvas, under the aurora)
  let bgList = [];          // [{key,label,src,img,ok}]
  let bgMode = "off";       // "off" | "cycle" | <key>
  let bgCur = null, bgPrev = null, bgFade = 1;   // crossfade state
  let bgStart = 0, bgLastSwap = 0;               // Ken-Burns + cycle timing
  let bgActive = false;                          // is an image visible this frame
  const BG_CYCLE_SECS = 16;

  // Pointer parallax
  const ptr = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };

  let t = 0;            // global time
  let lastAdapt = 0;    // throttle adaptive switching

  // Entities
  let stars = [], clouds = [], butterflies = [], birds = [], blooms = [];
  let falling = [], meteors = [], fireflies = [], bokeh = [];

  // Mixable effect layers (toggled from the dock). Defaults below.
  const fx = {
    fall: true,      // theme-aware petals / snow / embers / stardust
    meteors: true,   // shooting stars
    fireflies: false,// floating lantern orbs
    web: false,      // constellation lines near cursor
    reflect: false,  // water-like mirror reflection at the base
    rays: false,     // sweeping volumetric god-rays
    bokeh: true,     // soft out-of-focus depth orbs
    kaleido: false   // radial kaleidoscope symmetry on blooms & fireflies
  };
  const FX_META = [
    { key: "fall",      label: "Falling drift",  note: "petals · snow · embers" },
    { key: "meteors",   label: "Shooting stars", note: "streaks on note attacks" },
    { key: "fireflies", label: "Fireflies",      note: "floating lanterns" },
    { key: "bokeh",     label: "Bokeh orbs",     note: "soft depth-of-field" },
    { key: "web",       label: "Constellations", note: "lines near your cursor" },
    { key: "rays",      label: "God rays",       note: "sweeping light shafts" },
    { key: "reflect",   label: "Water mirror",   note: "reflection at the base" },
    { key: "kaleido",   label: "Kaleidoscope",   note: "radial symmetry" }
  ];

  // --- soft glow sprite (pre-rendered for cheap bloom) ---
  let glow;
  function makeGlow() {
    glow = document.createElement("canvas");
    glow.width = glow.height = 128;
    const g = glow.getContext("2d");
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.25, "rgba(255,255,255,0.5)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  }

  // ----------------------------------------------- backgrounds
  function loadBackgrounds(list) {
    bgList = list.map(b => {
      const isVideo = b.type === "video" || /\.(mp4|webm|mov)$/i.test(b.src);
      const url = encodeURI(b.src);            // handle spaces / parens in filenames
      const rec = { key: b.key, label: b.label, src: url, ok: false, isVideo };
      if (isVideo) {
        const v = document.createElement("video");
        v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto"; v.crossOrigin = "anonymous";
        v.setAttribute("muted", ""); v.setAttribute("playsinline", "");
        // keep it in the DOM but invisible so frames keep decoding for the canvas
        v.style.cssText = "position:fixed;left:-20px;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1;";
        v.addEventListener("loadeddata", () => { rec.ok = true; });
        v.addEventListener("error", () => { rec.ok = false; });
        v.src = url;
        document.body.appendChild(v);
        rec.media = v;
      } else {
        const img = new Image();
        img.onload = () => { rec.ok = true; };
        img.onerror = () => { rec.ok = false; };
        img.src = url;
        rec.media = img;
      }
      return rec;
    });
  }
  function bgByKey(k) { return bgList.find(b => b.key === k) || null; }

  // play the active background video(s), pause the rest (saves CPU/battery)
  function updateBgVideos() {
    bgList.forEach(b => {
      if (!b.isVideo) return;
      if (b === bgCur || b === bgPrev) { const p = b.media.play(); if (p) p.catch(() => {}); }
      else if (!b.media.paused) b.media.pause();
    });
  }

  function setBackground(mode) {
    bgMode = mode;
    bgLastSwap = t;
    let next = null;
    if (mode === "off") next = null;
    else if (mode === "cycle") next = bgList.find(b => b.ok) || bgList[0] || null;
    else next = bgByKey(mode);
    if (next === bgCur) return;
    bgPrev = bgCur; bgCur = next; bgFade = bgPrev ? 0 : 1; bgStart = t;
    updateBgVideos();
  }
  function advanceCycle() {
    if (bgMode !== "cycle" || bgList.length === 0) return;
    const ok = bgList.filter(b => b.ok);
    if (ok.length === 0) return;
    const idx = ok.indexOf(bgCur);
    const next = ok[(idx + 1) % ok.length];
    if (next === bgCur) return;
    bgPrev = bgCur; bgCur = next; bgFade = 0; bgStart = t; bgLastSwap = t;
    updateBgVideos();
  }

  // cover-fit draw with a slow Ken-Burns zoom/pan + subtle bass pulse
  function drawCover(rec, alpha, age) {
    if (!rec || !rec.ok) return;
    const m = rec.media;
    const iw = rec.isVideo ? m.videoWidth : m.naturalWidth;
    const ih = rec.isVideo ? m.videoHeight : m.naturalHeight;
    if (!iw || !ih) return;
    const base = Math.max(W / iw, H / ih);
    // gentler Ken-Burns for video (its own camera already moves), stronger for stills
    const zMid = rec.isVideo ? 1.05 : 1.16, zAmp = rec.isVideo ? 0.03 : 0.10;
    const pAmpX = rec.isVideo ? 0.05 : 0.18, pAmpY = rec.isVideo ? 0.04 : 0.15;
    const zoom = zMid + Math.sin(age * 0.045 - 1.5) * zAmp;   // slow breathing zoom
    const pulse = 1 + beat * 0.035;                           // bass-reactive push
    const scale = base * zoom * pulse;
    const dw = iw * scale, dh = ih * scale;
    const panX = Math.sin(age * 0.038) * (dw - W) * pAmpX + (ptr.x - 0.5) * 40;
    const panY = Math.cos(age * 0.031) * (dh - H) * pAmpY + (ptr.y - 0.5) * 30;
    const dx = (W - dw) / 2 + panX, dy = (H - dh) / 2 + panY;
    ctx.globalAlpha = alpha;
    try { ctx.drawImage(m, dx, dy, dw, dh); } catch (e) { /* video not ready */ }
    ctx.globalAlpha = 1;
  }

  function drawBackground(dt) {
    if (!bgCur && !bgPrev) return false;     // nothing to draw -> opaque sky
    if (bgFade < 1) bgFade = Math.min(1, bgFade + dt / 1.6);
    if (bgPrev && bgFade < 1) drawCover(bgPrev, 1, t - (bgStart - 4));
    if (bgCur) drawCover(bgCur, bgFade, t - bgStart);
    else if (bgPrev) drawCover(bgPrev, 1 - bgFade, t - bgStart);
    // auto-advance in cycle mode
    if (bgMode === "cycle" && t - bgLastSwap > BG_CYCLE_SECS) advanceCycle();
    return true;
  }

  function cloneTheme(th) {
    return {
      bg: th.bg.map(c => c.slice()),
      aurora: th.aurora.map(c => c.slice()),
      star: th.star.slice(), cloud: th.cloud.slice(),
      bird: th.bird.slice(), wings: th.wings.map(c => c.slice()),
      bloom: th.bloom.slice(), warmth: th.warmth
    };
  }

  // -------------------------------------------------- entities
  function rnd(a, b) { return a + Math.random() * (b - a); }

  function seed() {
    stars = [];
    const n = Math.min(260, Math.floor(W * H / 7000));
    for (let i = 0; i < n; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * H * 0.85,
        r: rnd(0.4, 1.8), tw: rnd(0, 6.28), sp: rnd(0.4, 1.6), depth: rnd(0.2, 1) });
    }
    clouds = [];
    for (let i = 0; i < 7; i++) {
      clouds.push({ x: rnd(-0.2, 1.2) * W, y: rnd(0.05, 0.7) * H,
        s: rnd(160, 420), v: rnd(3, 11) * (Math.random() < 0.5 ? -1 : 1),
        a: rnd(0.05, 0.16), depth: rnd(0.3, 1) });
    }
    butterflies = [];
    for (let i = 0; i < 7; i++) butterflies.push(makeButterfly());
    birds = [];
    for (let i = 0; i < 5; i++) birds.push(makeBird());
    falling = [];
    const fn = Math.min(140, Math.floor(W * H / 14000));
    for (let i = 0; i < fn; i++) falling.push(makeFalling(true));
    fireflies = [];
    for (let i = 0; i < 26; i++) fireflies.push(makeFirefly());
    bokeh = [];
    for (let i = 0; i < 9; i++) bokeh.push(makeBokeh());
    meteors = [];
  }

  function fallStyle() {
    // choose drift look from the live theme: warm->embers, cold glass->snow,
    // sakura->petals, otherwise stardust.
    if (themeKey === "sakura" || themeKey === "dream") return "petal";
    if (themeKey === "glass") return "snow";
    if (themeKey === "gold") return "ember";
    return "dust";
  }
  function makeFalling(spread) {
    return {
      x: Math.random() * W,
      y: spread ? Math.random() * H : -20,
      r: rnd(2, 7), vy: rnd(14, 46), sway: rnd(14, 46), swp: rnd(0, 6.28),
      sws: rnd(0.4, 1.3), rot: rnd(0, 6.28), rsp: rnd(-1.4, 1.4), depth: rnd(0.3, 1)
    };
  }
  function makeFirefly() {
    return {
      x: Math.random() * W, y: rnd(0.2, 1) * H, r: rnd(1.6, 4),
      px: rnd(0, 6.28), py: rnd(0, 6.28), ax: rnd(20, 70), ay: rnd(18, 60),
      vx: rnd(0.2, 0.6), vy: rnd(0.2, 0.6), rise: rnd(4, 16),
      blink: rnd(0, 6.28), bsp: rnd(1.4, 3.2), depth: rnd(0.3, 1)
    };
  }
  function makeBokeh() {
    return {
      x: Math.random() * W, y: Math.random() * H, r: rnd(40, 150),
      vx: rnd(-6, 6), vy: rnd(-5, 5), a: rnd(0.04, 0.12),
      hue: Math.floor(rnd(0, 3)), pulse: rnd(0, 6.28)
    };
  }
  function makeMeteor(fromOnset) {
    const dir = Math.random() < 0.5 ? 1 : -1;  // diagonal down-left or down-right
    return {
      x: dir > 0 ? rnd(-W * 0.2, W * 0.7) : rnd(W * 0.3, W * 1.2),
      y: rnd(-60, H * 0.25),
      vx: dir * rnd(320, 680), vy: rnd(520, 1020),
      len: rnd(120, 260), life: 1, big: fromOnset ? rnd(1, 1.8) : 1
    };
  }

  function makeButterfly() {
    return {
      x: rnd(0, W), y: rnd(0.1, 0.9) * H,
      ax: rnd(40, 130), ay: rnd(30, 100),       // wander amplitude
      px: rnd(0, 6.28), py: rnd(0, 6.28),
      vx: rnd(0.2, 0.7), vy: rnd(0.15, 0.5),
      size: rnd(8, 18), flap: rnd(0, 6.28), flapsp: rnd(7, 12),
      hue: Math.floor(rnd(0, 3)), depth: rnd(0.4, 1), drift: rnd(-0.3, 0.3)
    };
  }
  function makeBird(fromEdge) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    return {
      x: fromEdge ? (dir > 0 ? -40 : W + 40) : rnd(0, W),
      y: rnd(0.08, 0.55) * H, dir,
      v: rnd(40, 90), size: rnd(7, 16), flap: rnd(0, 6.28),
      flapsp: rnd(5, 9), bob: rnd(8, 26), bobp: rnd(0, 6.28), depth: rnd(0.4, 1)
    };
  }

  // -------------------------------------------------- audio analysis
  function readAudio(dt) {
    let e = 0, f = 0, b = 0, tr = 0;
    if (analyser) {
      analyser.getByteFrequencyData(freq);
      const N = freq.length;
      let sum = 0, bsum = 0, tsum = 0, fl = 0;
      const bEnd = Math.floor(N * 0.08), tStart = Math.floor(N * 0.5);
      for (let i = 0; i < N; i++) {
        const v = freq[i];
        sum += v;
        if (i < bEnd) bsum += v;
        if (i >= tStart) tsum += v;
        const d = v - prevFreq[i]; if (d > 0) fl += d;
        prevFreq[i] = v;
      }
      e = sum / N / 255;
      b = bsum / bEnd / 255;
      tr = tsum / (N - tStart) / 255;
      f = Math.min(1, fl / N / 40);
    }
    // smoothing
    energy += (e - energy) * Math.min(1, dt * 3);
    bass   += (b - bass)   * Math.min(1, dt * 6);
    treble += (tr - treble) * Math.min(1, dt * 6);
    flux   += (f - flux)   * Math.min(1, dt * 4);
    // beat: fast attack, slow decay on bass
    if (b > beat) beat = b; else beat += (b - beat) * Math.min(1, dt * 4);

    // onset -> spawn a hallucination bloom + sometimes a bird flock
    if (f > 0.42 && t - (readAudio._last || 0) > 0.18) {
      spawnBloom();
      readAudio._last = t;
      if (motion && Math.random() < 0.25 && birds.length < 16)
        for (let k = 0; k < rnd(2, 5); k++) birds.push(makeBird(true));
      if (fx.meteors && Math.random() < 0.4 && meteors.length < 4)
        meteors.push(makeMeteor(true));
    }
  }

  function spawnBloom() {
    if (!motion) return;
    blooms.push({
      x: rnd(0.2, 0.8) * W, y: rnd(0.2, 0.7) * H,
      r: rnd(20, 60), max: rnd(220, 460), life: 1,
      petals: Math.floor(rnd(5, 9)), rot: rnd(0, 6.28), spin: rnd(-0.6, 0.6)
    });
    if (blooms.length > 14) blooms.shift();
  }

  // -------------------------------------------------- theme transition
  function setTheme(key) {
    if (!THEMES[key]) return;
    themeKey = key;
    target = cloneTheme(THEMES[key]);
    if (!cur) cur = cloneTheme(THEMES[key]);
  }
  function approach(a, b, s) {
    for (let i = 0; i < a.length; i++) a[i] += (b[i] - a[i]) * s;
  }
  function blendTheme(dt) {
    if (!cur || !target) return;
    const s = Math.min(1, dt * 0.8);
    for (let i = 0; i < 3; i++) { approach(cur.bg[i], target.bg[i], s); approach(cur.aurora[i], target.aurora[i], s); approach(cur.wings[i], target.wings[i], s); }
    approach(cur.star, target.star, s); approach(cur.cloud, target.cloud, s);
    approach(cur.bird, target.bird, s); approach(cur.bloom, target.bloom, s);
    cur.warmth += (target.warmth - cur.warmth) * s;
  }

  // -------------------------------------------------- draw
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    const wob = Math.sin(t * 0.1) * 0.04;
    g.addColorStop(0, rgb(cur.bg[0]));
    g.addColorStop(0.5 + wob, rgb(cur.bg[1]));
    g.addColorStop(1, rgb(cur.bg[2]));
    // When a fantasy image is showing, the sky becomes a translucent colour
    // grade over it (keeps the palette + text legibility); otherwise opaque.
    ctx.globalAlpha = bgActive ? 0.46 : 1;
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    // subtle low glow that breathes with bass
    const r = ctx.createRadialGradient(W * 0.5, H * 1.05, 0, W * 0.5, H * 1.05, H * (0.8 + beat * 0.5));
    r.addColorStop(0, rgb(cur.aurora[2], 0.12 + beat * 0.18));
    r.addColorStop(1, rgb(cur.aurora[2], 0));
    ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  }

  function drawAurora() {
    ctx.globalCompositeOperation = "screen";
    const bands = 3;
    for (let b = 0; b < bands; b++) {
      const col = cur.aurora[b % cur.aurora.length];
      const baseY = H * (0.32 + b * 0.12) + (ptr.y - 0.5) * 30 * (1 - b * 0.2);
      const amp = (38 + energy * 150) * (1 - b * 0.18);
      const seg = 26;
      ctx.beginPath();
      for (let i = 0; i <= seg; i++) {
        const x = (i / seg) * W;
        const ph = t * (0.3 + b * 0.12) + i * 0.5 + b;
        const y = baseY + Math.sin(ph) * amp + Math.sin(ph * 0.5 + b) * amp * 0.4;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      const grd = ctx.createLinearGradient(0, baseY - 120, 0, baseY + 120);
      grd.addColorStop(0, rgb(col, 0));
      grd.addColorStop(0.5, rgb(col, 0.10 + energy * 0.22));
      grd.addColorStop(1, rgb(col, 0));
      ctx.strokeStyle = grd;
      ctx.lineWidth = 60 + energy * 120;
      ctx.lineCap = "round";
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawStars() {
    ctx.globalCompositeOperation = "screen";
    for (const s of stars) {
      const px = s.x + (ptr.x - 0.5) * 40 * s.depth;
      const py = s.y + (ptr.y - 0.5) * 24 * s.depth;
      const tw = 0.45 + 0.55 * Math.sin(t * s.sp + s.tw);
      const a = tw * (0.5 + treble * 0.8) * s.depth;
      const sz = s.r * (1.4 + treble * 2.2);
      ctx.globalAlpha = Math.min(1, a);
      const c = cur.star;
      ctx.drawImage(glow, px - sz * 3, py - sz * 3, sz * 6, sz * 6);
      void c;
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function drawClouds() {
    for (const c of clouds) {
      c.x += (c.v + (ptr.x - 0.5) * -6) * c.depth * 0.016 * 60 / 60;
      if (c.x - c.s > W + 100) c.x = -c.s - 100;
      if (c.x + c.s < -100) c.x = W + c.s + 100;
      const py = c.y + (ptr.y - 0.5) * 20 * c.depth;
      const grd = ctx.createRadialGradient(c.x, py, 0, c.x, py, c.s);
      const a = c.a * (0.8 + energy * 0.6);
      grd.addColorStop(0, rgb(cur.cloud, a));
      grd.addColorStop(0.6, rgb(cur.cloud, a * 0.4));
      grd.addColorStop(1, rgb(cur.cloud, 0));
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.ellipse(c.x, py, c.s, c.s * 0.5, 0, 0, 6.2832); ctx.fill();
    }
  }

  function drawButterfly(bf, dt) {
    // wander
    bf.px += dt * bf.vx; bf.py += dt * bf.vy;
    let x = bf.x + Math.cos(bf.px) * bf.ax + (ptr.x - 0.5) * 50 * bf.depth;
    let y = bf.y + Math.sin(bf.py) * bf.ay + (ptr.y - 0.5) * 30 * bf.depth;
    bf.x += bf.drift * dt * 14;
    if (bf.x > W + 60) bf.x = -60; if (bf.x < -60) bf.x = W + 60;
    bf.flap += dt * bf.flapsp * (0.7 + energy * 1.4);
    const open = (Math.sin(bf.flap) * 0.5 + 0.5); // 0..1 wing fold
    const sz = bf.size * (1 + beat * 0.5) * bf.depth;
    const ang = Math.atan2(Math.cos(bf.py) * bf.vy, -Math.sin(bf.px) * bf.vx) * 0.4;
    const col = cur.wings[bf.hue % cur.wings.length];

    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.globalCompositeOperation = "screen";
    // glow halo
    ctx.globalAlpha = 0.5 * bf.depth;
    ctx.drawImage(glow, -sz * 2.2, -sz * 2.2, sz * 4.4, sz * 4.4);
    ctx.globalAlpha = 0.9 * bf.depth;
    const wingW = sz * (0.45 + open * 0.85);
    ctx.fillStyle = rgb(col, 0.85);
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(dir * sz * 0.55, -sz * 0.15, wingW, sz * 0.9, dir * 0.5, 0, 6.2832);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(dir * sz * 0.5, sz * 0.5, wingW * 0.7, sz * 0.6, dir * -0.4, 0, 6.2832);
      ctx.fill();
    }
    // body
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.8 * bf.depth;
    ctx.fillStyle = rgb(cur.star, 0.9);
    ctx.beginPath(); ctx.ellipse(0, sz * 0.1, sz * 0.12, sz * 0.7, 0, 0, 6.2832); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawBird(bd, dt) {
    bd.x += bd.dir * bd.v * dt * (0.8 + energy * 0.8);
    bd.flap += dt * bd.flapsp * (0.8 + energy);
    const y = bd.y + Math.sin(t * 0.6 + bd.bobp) * bd.bob + (ptr.y - 0.5) * 26 * bd.depth;
    const wing = Math.sin(bd.flap);
    const s = bd.size * bd.depth;
    ctx.save();
    ctx.translate(bd.x, y); ctx.scale(bd.dir, 1);
    ctx.strokeStyle = rgb(cur.bird, 0.8 * bd.depth);
    ctx.lineWidth = Math.max(1.2, s * 0.16); ctx.lineCap = "round";
    const up = wing * s * 0.9;
    ctx.beginPath();
    ctx.moveTo(-s, -up * 0.5); ctx.quadraticCurveTo(-s * 0.3, -up, 0, 0);
    ctx.quadraticCurveTo(s * 0.3, -up, s, -up * 0.5);
    ctx.stroke();
    ctx.restore();
    if (bd.dir > 0 && bd.x > W + 60) recycle(bd);
    if (bd.dir < 0 && bd.x < -60) recycle(bd);
  }
  function recycle(bd) {
    const i = birds.indexOf(bd);
    if (birds.length > 6) { birds.splice(i, 1); return; }
    Object.assign(bd, makeBird(true));
  }

  function drawBlooms(dt) {
    ctx.globalCompositeOperation = "screen";
    for (let i = blooms.length - 1; i >= 0; i--) {
      const bl = blooms[i];
      bl.r += (bl.max - bl.r) * Math.min(1, dt * 1.6);
      bl.life -= dt * 0.7;
      bl.rot += bl.spin * dt;
      if (bl.life <= 0) { blooms.splice(i, 1); continue; }
      const a = bl.life * 0.5;
      ctx.save(); ctx.translate(bl.x, bl.y); ctx.rotate(bl.rot);
      for (let p = 0; p < bl.petals; p++) {
        ctx.rotate((6.2832 / bl.petals));
        const grd = ctx.createRadialGradient(0, 0, 0, 0, bl.r, bl.r);
        grd.addColorStop(0, rgb(cur.bloom, a * 0.5));
        grd.addColorStop(0.7, rgb(cur.bloom, a * 0.12));
        grd.addColorStop(1, rgb(cur.bloom, 0));
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.ellipse(0, bl.r * 0.5, bl.r * 0.28, bl.r * 0.6, 0, 0, 6.2832);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // ---- bokeh: soft out-of-focus orbs drifting, breathing with bass ----
  function drawBokeh(dt) {
    ctx.globalCompositeOperation = "screen";
    for (const o of bokeh) {
      o.x += o.vx * dt; o.y += o.vy * dt; o.pulse += dt * 0.6;
      if (o.x < -o.r) o.x = W + o.r; if (o.x > W + o.r) o.x = -o.r;
      if (o.y < -o.r) o.y = H + o.r; if (o.y > H + o.r) o.y = -o.r;
      const col = cur.aurora[o.hue % cur.aurora.length];
      const r = o.r * (1 + beat * 0.25 + Math.sin(o.pulse) * 0.08);
      const a = o.a * (0.6 + energy * 0.7);
      const grd = ctx.createRadialGradient(o.x, o.y, r * 0.55, o.x, o.y, r);
      grd.addColorStop(0, rgb(col, 0));
      grd.addColorStop(0.82, rgb(col, a));
      grd.addColorStop(1, rgb(col, 0));
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, 6.2832); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // ---- god rays: soft sweeping light shafts from above ----
  function drawRays() {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const cx = W * (0.5 + (ptr.x - 0.5) * 0.3);
    const count = 7;
    for (let i = 0; i < count; i++) {
      const sway = Math.sin(t * 0.18 + i) * 0.5;
      const ang = -1.57 + (i - count / 2) * 0.16 + sway * 0.12;
      const col = cur.aurora[i % cur.aurora.length];
      const a = (0.04 + energy * 0.07) * (0.6 + 0.4 * Math.sin(t * 0.5 + i));
      ctx.save();
      ctx.translate(cx, -H * 0.1); ctx.rotate(ang + 1.57);
      const grd = ctx.createLinearGradient(0, 0, 0, H * 1.4);
      grd.addColorStop(0, rgb(col, a));
      grd.addColorStop(1, rgb(col, 0));
      ctx.fillStyle = grd;
      const w = 40 + i * 14;
      ctx.beginPath(); ctx.moveTo(-w * 0.3, 0); ctx.lineTo(w * 0.3, 0);
      ctx.lineTo(w, H * 1.4); ctx.lineTo(-w, H * 1.4); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ---- falling drift: petals / snow / embers / stardust (theme-aware) ----
  function drawFalling(dt) {
    const style = fallStyle();
    ctx.globalCompositeOperation = style === "snow" || style === "dust" ? "screen" : "source-over";
    for (const p of falling) {
      p.swp += dt * p.sws;
      p.y += p.vy * dt * p.depth * (0.7 + energy * 0.9);
      p.x += Math.sin(p.swp) * p.sway * dt;
      p.rot += p.rsp * dt;
      if (p.y > H + 20) Object.assign(p, makeFalling(false));
      const px = p.x + (ptr.x - 0.5) * 30 * p.depth;
      const sz = p.r * (0.7 + p.depth);
      if (style === "petal") {
        const col = cur.wings[(p.r | 0) % cur.wings.length];
        ctx.save(); ctx.translate(px, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = 0.85 * p.depth;
        ctx.fillStyle = rgb(col, 0.9);
        ctx.beginPath(); ctx.ellipse(0, 0, sz * 1.4, sz * 0.7, 0, 0, 6.2832); ctx.fill();
        ctx.restore();
      } else if (style === "ember") {
        ctx.globalAlpha = (0.5 + 0.5 * Math.sin(p.swp * 2)) * p.depth;
        ctx.drawImage(glow, px - sz * 3, p.y - sz * 3, sz * 6, sz * 6);
      } else { // snow / dust
        ctx.globalAlpha = (style === "snow" ? 0.85 : 0.5) * p.depth;
        ctx.drawImage(glow, px - sz * 2.5, p.y - sz * 2.5, sz * 5, sz * 5);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // ---- shooting stars ----
  function drawMeteors(dt) {
    if (Math.sin(t * 7.3) > 0.999 && meteors.length < 3) meteors.push(makeMeteor(false));
    ctx.globalCompositeOperation = "screen";
    ctx.lineCap = "round";
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.x += m.vx * dt; m.y += m.vy * dt; m.life -= dt * 0.5;
      if (m.life <= 0 || m.y > H + 60 || m.x < -120 || m.x > W + 120) { meteors.splice(i, 1); continue; }
      const sp = Math.hypot(m.vx, m.vy) || 1;
      const tx = m.x - (m.vx / sp) * m.len, ty = m.y - (m.vy / sp) * m.len;
      const grd = ctx.createLinearGradient(m.x, m.y, tx, ty);
      grd.addColorStop(0, rgb(cur.star, 0.9 * m.life));
      grd.addColorStop(1, rgb(cur.star, 0));
      ctx.strokeStyle = grd; ctx.lineWidth = 2 * m.big;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.globalAlpha = m.life;
      ctx.drawImage(glow, m.x - 10 * m.big, m.y - 10 * m.big, 20 * m.big, 20 * m.big);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // ---- fireflies / floating lanterns (kaleido-aware) ----
  function drawFireflies(dt) {
    ctx.globalCompositeOperation = "screen";
    const sym = fx.kaleido ? 6 : 1;
    for (const f of fireflies) {
      f.px += dt * f.vx; f.py += dt * f.vy;
      f.y -= f.rise * dt * (0.5 + energy);
      if (f.y < -20) { f.y = H + 20; f.x = Math.random() * W; }
      f.blink += dt * f.bsp;
      const bx = f.x + Math.cos(f.px) * f.ax + (ptr.x - 0.5) * 40 * f.depth;
      const by = f.y + Math.sin(f.py) * f.ay;
      const a = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(f.blink))) * f.depth;
      const sz = f.r * (1 + treble * 1.5);
      ctx.globalAlpha = a;
      if (sym === 1) {
        ctx.drawImage(glow, bx - sz * 4, by - sz * 4, sz * 8, sz * 8);
      } else {
        ctx.save(); ctx.translate(W / 2, H / 2);
        const rx = bx - W / 2, ry = by - H / 2;
        for (let s = 0; s < sym; s++) {
          ctx.rotate(6.2832 / sym);
          ctx.drawImage(glow, rx - sz * 4, ry - sz * 4, sz * 8, sz * 8);
        }
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // ---- constellation web: link nearby stars, brighter near the cursor ----
  function drawWeb() {
    const mx = ptr.x * W, my = ptr.y * H, R = 150, R2 = R * R;
    const near = stars.filter(s => {
      const dx = s.x - mx, dy = s.y - my; return dx * dx + dy * dy < 320 * 320;
    });
    ctx.globalCompositeOperation = "screen";
    ctx.lineWidth = 1;
    for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        const a = near[i], b = near[j];
        const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          const al = (1 - Math.sqrt(d2) / R) * 0.22 * (0.5 + energy);
          ctx.strokeStyle = rgb(cur.star, al);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // ---- water mirror: reflect aurora + sky into the lower region ----
  let reflectCanvas, rctx;
  function drawReflection() {
    const top = H * 0.66, rh = H - top;
    if (rh <= 4) return;
    ctx.save();
    // wavy horizontal slices of a vertically-flipped aurora band
    const slices = 22, sh = rh / slices;
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < slices; i++) {
      const yy = top + i * sh;
      const off = Math.sin(t * 1.2 + i * 0.5) * (4 + i * 0.6);
      const fade = (1 - i / slices) * 0.5;
      const band = i % 3;
      const col = cur.aurora[band];
      ctx.fillStyle = rgb(col, 0.05 * fade * (0.6 + energy));
      ctx.fillRect(off, yy, W, sh + 1);
    }
    // a base water gradient
    const grd = ctx.createLinearGradient(0, top, 0, H);
    grd.addColorStop(0, rgb(cur.bg[2], 0));
    grd.addColorStop(1, rgb(cur.bg[2], 0.4));
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = grd; ctx.fillRect(0, top, W, rh);
    ctx.restore();
    void reflectCanvas; void rctx;
  }

  // -------------------------------------------------- main loop
  let lastT = 0;
  function frame(now) {
    if (!running) return;
    const ms = now / 1000;
    let dt = ms - lastT; lastT = ms;
    if (dt > 0.05) dt = 0.05;       // clamp after tab switches
    t += dt;

    ptr.x += (ptr.tx - ptr.x) * Math.min(1, dt * 3);
    ptr.y += (ptr.ty - ptr.y) * Math.min(1, dt * 3);

    readAudio(dt);
    blendTheme(dt);

    // adaptive theme switching
    if (auto && t - lastAdapt > 2.4) {
      lastAdapt = t;
      const k = pickAdaptiveTheme(energy, flux);
      if (k !== themeKey) { setTheme(k); if (onAdapt) onAdapt(k); }
    }

    bgActive = drawBackground(dt);
    drawSky();
    if (fx.rays) drawRays();
    if (fx.bokeh) drawBokeh(dt);
    drawAurora();
    if (fx.reflect) drawReflection();
    drawStars();
    if (fx.web) drawWeb();
    drawClouds();
    drawBlooms(dt);
    if (fx.fireflies && motion) drawFireflies(dt);
    if (fx.fall && motion) drawFalling(dt);
    if (motion) {
      for (const bf of butterflies) drawButterfly(bf, dt);
      for (const bd of birds.slice()) drawBird(bd, dt);
    }
    if (fx.meteors) drawMeteors(dt);

    requestAnimationFrame(frame);
  }

  // -------------------------------------------------- public
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    seed();
  }

  return {
    init(cv) {
      canvas = cv; ctx = canvas.getContext("2d");
      makeGlow();
      setTheme("nocturne");
      const fit = () => resize();
      // size to viewport
      const style = () => { canvas.style.width = "100%"; canvas.style.height = "100%"; };
      style(); resize();
      window.addEventListener("resize", () => { resize(); }, { passive: true });
      window.addEventListener("pointermove", (e) => {
        ptr.tx = e.clientX / window.innerWidth;
        ptr.ty = e.clientY / window.innerHeight;
      }, { passive: true });
      void fit;
      running = true; lastT = performance.now() / 1000;
      requestAnimationFrame(frame);
    },
    setAnalyser(a) {
      analyser = a;
      freq = new Uint8Array(a.frequencyBinCount);
      prevFreq = new Uint8Array(a.frequencyBinCount);
    },
    setTheme,
    setAuto(v) { auto = v; lastAdapt = -99; },
    setMotion(v) { motion = v; },
    onAdapt(fn) { onAdapt = fn; },
    isAuto() { return auto; },
    signals() { return { energy, flux, bass, treble }; },
    // ---- fantasy backgrounds ----
    loadBackgrounds,
    setBackground,
    bgItems() { return bgList.map(b => ({ key: b.key, label: b.label })); },
    bgMode() { return bgMode; },
    // ---- mixable effects ----
    fxMeta() { return FX_META; },
    setFx(key, on) { if (key in fx) fx[key] = !!on; },
    getFx(key) { return key ? fx[key] : Object.assign({}, fx); },
    randomizeFx() {
      // a pleasing surprise mix: always some drift, plus 2–4 extras
      const keys = FX_META.map(m => m.key);
      keys.forEach(k => { fx[k] = false; });
      fx.fall = true;
      const pool = keys.filter(k => k !== "fall");
      for (let i = pool.length - 1; i > 0; i--) {     // Fisher–Yates shuffle
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
      }
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n && i < pool.length; i++) fx[pool[i]] = true;
      // reflection + kaleido together can be busy; drop one sometimes
      if (fx.reflect && fx.kaleido && Math.random() < 0.5) fx.kaleido = false;
      return Object.assign({}, fx);
    }
  };
})();
