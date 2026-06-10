// ============================================================================
//  app.js — navigation, audio player, Web Audio analyser, theme dock.
// ============================================================================
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ---- audio + analysis graph ----
  const audio = new Audio();
  audio.preload = "metadata";
  audio.crossOrigin = "anonymous";
  window.SoundAudio = audio;                 // exposed for the sound studio
  let actx = null, analyser = null, srcNode = null, audioReady = false;

  function ensureAudioGraph() {
    if (audioReady) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = actx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.82;
      srcNode = actx.createMediaElementSource(audio);

      // --- sound-studio effects chain: gain -> smooth -> elevate -> comp ---
      const gain = actx.createGain();
      const smooth = actx.createBiquadFilter();   // low-pass: softens / warms
      smooth.type = "lowpass"; smooth.frequency.value = 20000; smooth.Q.value = 0.7;
      const elevate = actx.createBiquadFilter();  // high-shelf: air / brightness
      elevate.type = "highshelf"; elevate.frequency.value = 3500; elevate.gain.value = 0;
      const comp = actx.createDynamicsCompressor(); // tames peaks when boosting
      comp.threshold.value = -10; comp.knee.value = 24; comp.ratio.value = 3;
      comp.attack.value = 0.005; comp.release.value = 0.2;

      srcNode.connect(gain); gain.connect(smooth); smooth.connect(elevate);
      elevate.connect(comp); comp.connect(analyser); analyser.connect(actx.destination);

      window.SoundFX = { ctx: actx, audio, gain, smooth, elevate, comp };
      Dream.setAnalyser(analyser);
      audioReady = true;
      if (window.Studio && window.Studio.apply) window.Studio.apply();
    } catch (e) {
      console.warn("Web Audio unavailable; visuals run un-reactive.", e);
    }
  }

  // ---- state ----
  let curAlbum = null, curIndex = -1, loopOne = false;
  let shuffleAll = false;
  const playHistory = [];   // [{album, idx}] for shuffle "previous"
  // per-song mode: shift the fantasy world + atmosphere with every new track
  let perSong = localStorage.getItem("dream-persong") !== "0";  // default ON
  let lastWorldKey = null;

  // ---- navigation ----
  function show(id) {
    $$(".screen").forEach(s => s.classList.toggle("active", s.id === id));
    updateBigPlay();
  }
  $$("[data-nav]").forEach(b => b.addEventListener("click", () => show(b.dataset.nav)));

  // ---- portal -> gallery ----
  $("#enter").addEventListener("click", () => {
    ensureAudioGraph();
    if (actx && actx.state === "suspended") actx.resume();
    if (perSong) advanceWorld();    // open onto a first world & atmosphere
    else Dream.setAuto(true);       // otherwise start in adaptive mode
    syncThemeUI();
    show("gallery");
  });

  // ---- build gallery cards ----
  const worlds = $("#worlds");
  ALBUMS.forEach((al, i) => {
    const card = document.createElement("button");
    card.className = "world-card";
    card.style.setProperty("--card-accent", al.accent);
    card.innerHTML = `
      <span class="world-index">${ROMAN[i + 1]}</span>
      <div class="world-name">${al.title}</div>
      <div class="world-for">${al.subtitle}</div>
      <p class="world-epigraph">${al.epigraph}</p>
      <div class="world-count">${al.tracks.length} movements · drift in ⟶</div>`;
    card.addEventListener("click", () => openAlbum(al));
    worlds.appendChild(card);
  });

  // ---- album view ----
  function openAlbum(al) {
    curAlbum = al;
    document.documentElement.style.setProperty("--accent", al.accent);
    $("#album-title").textContent = al.title + " · " + al.subtitle;
    $("#album-epigraph").textContent = al.epigraph;
    const list = $("#tracklist");
    list.innerHTML = "";
    al.tracks.forEach((tr, idx) => {
      const li = document.createElement("li");
      li.className = "track";
      li.dataset.idx = idx;
      li.innerHTML = `
        <div class="track-num">${ROMAN[tr.n] || tr.n}</div>
        <div class="track-main">
          <div class="track-name">${tr.name}
            <span class="eq"><i></i><i></i><i></i><i></i></span>
          </div>
          <div class="track-sub">Movement ${tr.n} · ${al.subtitle}</div>
        </div>
        <div class="track-dur">${fmtTime(tr.dur)}</div>`;
      li.addEventListener("click", () => play(al, idx));
      list.appendChild(li);
    });
    markPlaying();
    show("album");
  }

  // ---- playback ----
  function srcFor(al, idx) {
    const tr = al.tracks[idx];
    return encodeURI(al.folder + "/" + tr.file);
  }

  function play(al, idx) {
    ensureAudioGraph();
    if (actx && actx.state === "suspended") actx.resume();
    const sameTrack = (al === curAlbum && idx === curIndex);
    curAlbum = al; curIndex = idx;
    if (!sameTrack) {
      if (perSong) advanceWorld();      // new song -> new world & atmosphere
      audio.src = srcFor(al, idx);
      audio.load();
    }
    audio.play().catch(err => console.warn("play blocked", err));
    updateNowPlaying();
    markPlaying();
    $("#player").classList.remove("hidden");
  }

  function togglePlay() {
    if (!curAlbum) { // nothing chosen yet — start first album, first track
      openAlbum(ALBUMS[0]); play(ALBUMS[0], 0); return;
    }
    if (audio.paused) { if (actx && actx.state === "suspended") actx.resume(); audio.play(); }
    else audio.pause();
  }

  function step(dir) {
    if (shuffleAll && dir > 0) { playRandom(); return; }
    if (shuffleAll && dir < 0 && playHistory.length) {
      const prev = playHistory.pop();
      play(prev.album, prev.idx);
      return;
    }
    if (!curAlbum) return;
    let i = curIndex + dir;
    if (i < 0) i = curAlbum.tracks.length - 1;
    if (i >= curAlbum.tracks.length) i = 0;
    play(curAlbum, i);
  }

  // pick a random track across BOTH albums (never the current one) — endless play
  function playRandom() {
    const pool = [];
    ALBUMS.forEach(al => al.tracks.forEach((_, i) => pool.push({ album: al, idx: i })));
    if (pool.length < 2) return;
    let pick;
    do { pick = pool[Math.floor(Math.random() * pool.length)]; }
    while (pick.album === curAlbum && pick.idx === curIndex);
    if (curAlbum) playHistory.push({ album: curAlbum, idx: curIndex });
    if (playHistory.length > 100) playHistory.shift();
    play(pick.album, pick.idx);
  }

  audio.addEventListener("ended", () => {
    if (loopOne) { audio.currentTime = 0; audio.play(); }
    else if (shuffleAll) playRandom();
    else step(1);
  });
  audio.addEventListener("play", () => setPlayIcon(true));
  audio.addEventListener("pause", () => setPlayIcon(false));
  audio.addEventListener("loadedmetadata", () => {
    $("#dur").textContent = fmtTime(audio.duration);
  });
  audio.addEventListener("timeupdate", () => {
    const d = audio.duration || (curAlbum ? curAlbum.tracks[curIndex].dur : 0);
    const p = d ? audio.currentTime / d : 0;
    $("#fill").style.width = (p * 100) + "%";
    $("#knob").style.left = (p * 100) + "%";
    $("#cur").textContent = fmtTime(audio.currentTime);
  });

  function setPlayIcon(playing) {
    $("#playpause").textContent = playing ? "❚❚" : "►";
  }
  function updateNowPlaying() {
    const tr = curAlbum.tracks[curIndex];
    $("#np-num").textContent = ROMAN[tr.n] || tr.n;
    $("#np-name").textContent = tr.name;
    $("#np-album").textContent = curAlbum.title + " · " + curAlbum.subtitle;
    // expose the current track to the sound studio (for local export)
    window.SoundCurrent = { src: srcFor(curAlbum, curIndex), name: tr.name, album: curAlbum.title };
  }
  function markPlaying() {
    $$(".track").forEach(li => {
      const on = curAlbum && +li.dataset.idx === curIndex &&
                 $("#album-title").textContent.startsWith(curAlbum.title);
      li.classList.toggle("playing", on && !audio.paused);
    });
  }
  audio.addEventListener("play", markPlaying);
  audio.addEventListener("pause", markPlaying);

  // ---- transport wiring ----
  $("#playpause").addEventListener("click", togglePlay);
  $("#prev").addEventListener("click", () => step(-1));
  $("#next").addEventListener("click", () => step(1));
  $("#loopbtn").addEventListener("click", () => {
    loopOne = !loopOne;
    if (loopOne && shuffleAll) { shuffleAll = false; $("#shufflebtn").classList.remove("on"); }
    $("#loopbtn").classList.toggle("on", loopOne);
  });
  $("#shufflebtn").addEventListener("click", () => {
    shuffleAll = !shuffleAll;
    if (shuffleAll && loopOne) { loopOne = false; $("#loopbtn").classList.remove("on"); }
    $("#shufflebtn").classList.toggle("on", shuffleAll);
    if (shuffleAll) {
      toast("shuffle · the music will play on, endlessly");
      if (!curAlbum || audio.paused) playRandom();   // start the stream now
    }
  });
  $("#vol").addEventListener("input", (e) => { audio.volume = +e.target.value; });
  audio.volume = 0.85;

  // ---- large transparent "begin" button ----
  const bigplay = $("#bigplay");
  function updateBigPlay() {
    const portalActive = $("#portal").classList.contains("active");
    bigplay.classList.toggle("show", !portalActive && audio.paused);
  }
  bigplay.querySelector(".bigplay-btn").addEventListener("click", () => {
    ensureAudioGraph();
    if (actx && actx.state === "suspended") actx.resume();
    if (!curAlbum) play(ALBUMS[0], 0);   // nothing chosen yet -> begin Album I
    else togglePlay();                    // otherwise resume what was loaded
  });
  audio.addEventListener("play", updateBigPlay);
  audio.addEventListener("pause", updateBigPlay);

  // ---- seek bar ----
  const bar = $("#bar");
  let scrubbing = false;
  function seekAt(clientX) {
    const r = bar.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const d = audio.duration || (curAlbum ? curAlbum.tracks[curIndex].dur : 0);
    if (d) audio.currentTime = p * d;
  }
  bar.addEventListener("pointerdown", (e) => { scrubbing = true; seekAt(e.clientX); bar.setPointerCapture(e.pointerId); });
  bar.addEventListener("pointermove", (e) => { if (scrubbing) seekAt(e.clientX); });
  bar.addEventListener("pointerup", () => { scrubbing = false; });

  // ---- keyboard ----
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    else if (e.code === "ArrowRight" && e.shiftKey) step(1);
    else if (e.code === "ArrowLeft" && e.shiftKey) step(-1);
    else if (e.code === "ArrowRight") audio.currentTime += 5;
    else if (e.code === "ArrowLeft") audio.currentTime -= 5;
  });

  // ============================ THEME DOCK ============================
  const dock = $("#dock");
  $("#dock-toggle").addEventListener("click", () => dock.classList.toggle("open"));

  const themeList = $("#theme-list");
  THEME_ORDER.forEach(key => {
    const th = THEMES[key];
    const chip = document.createElement("button");
    chip.className = "theme-chip"; chip.dataset.theme = key;
    chip.innerHTML = `
      <span class="chip-swatch" style="background:linear-gradient(135deg,
        rgb(${th.aurora[0].join(",")}), rgb(${th.bg[1].join(",")}), rgb(${th.aurora[2].join(",")}))"></span>
      <span class="chip-text">
        <span class="chip-name">${th.label}</span>
        <span class="chip-note">${th.note}</span>
      </span>`;
    chip.addEventListener("click", () => chooseTheme(key));
    themeList.appendChild(chip);
  });

  function applyAccent(key) {
    const a = THEMES[key].aurora[0];
    document.documentElement.style.setProperty("--accent", `rgb(${a.join(",")})`);
  }

  function chooseTheme(key) {
    disablePerSong();
    Dream.setAuto(false);
    Dream.setTheme(key);
    applyAccent(key);
    localStorage.setItem("dream-theme", key);
    syncThemeUI();
  }

  $("#theme-auto").addEventListener("click", () => {
    disablePerSong();
    Dream.setAuto(true);
    localStorage.setItem("dream-theme", "auto");
    syncThemeUI();
    toast("Auto · the dream now follows the music");
  });
  $("#theme-random").addEventListener("click", () => {
    const key = THEME_ORDER[Math.floor(Math.random() * THEME_ORDER.length)];
    chooseTheme(key);
    toast("Drifting toward " + THEMES[key].label + "…");
  });
  $("#motion-toggle").addEventListener("change", (e) => Dream.setMotion(e.target.checked));

  // ---- fantasy backgrounds ----
  // each fantasy world carries a matching atmosphere (theme key)
  const BACKGROUNDS = [
    { key: "fantasy01", label: "I",    src: "music/backgrounds/fantasy01.jpg",  theme: "sakura"   },
    { key: "fantasy02", label: "II",   src: "music/backgrounds/Fantasy02.webp", theme: "dream"    },
    { key: "fantasy03", label: "III",  src: "music/backgrounds/fantasy03.jpg",  theme: "nocturne" },
    { key: "fantasy04", label: "IV",   src: "music/backgrounds/fantasy04.webp", theme: "glass"    },
    { key: "fantasy05", label: "V",    src: "music/backgrounds/fantasy05.jpg",  theme: "dream"    },
    { key: "fantasy06", label: "VI",   src: "music/backgrounds/fantasy06.avif", theme: "gold"     },
    { key: "fantasy07", label: "VII",  src: "music/backgrounds/fantasy07.avif", theme: "nocturne" },
    { key: "fantasy08", label: "VIII", src: "music/backgrounds/fantasy08.jpg",  theme: "dream"    },
    { key: "fantasy09", label: "IX",   src: "music/backgrounds/fantasy09.jpg",  theme: "glass"    },
    { key: "fantasy10", label: "X",    src: "music/backgrounds/fantasy10.jpg",  theme: "sakura"   },
    { key: "fantasy11", label: "XI",   src: "music/backgrounds/fantasy11.jpg",  theme: "gold"     },
    { key: "fantasy12", label: "XII",  src: "music/backgrounds/fantasy12.jpg",  theme: "nocturne" },
    { key: "vid-nebula", label: "Nebula",        src: "music/backgrounds/create_a_video_where_the_camer.mp4",     theme: "nocturne", type: "video" },
    { key: "vid-isles",  label: "Floating Isles", src: "music/backgrounds/create_a_video_where_the_camer (1).mp4", theme: "gold",     type: "video" },
    { key: "vid-blossom", label: "Blossom Lake",  src: "music/backgrounds/create_a_video_where_the_camer (2).mp4", theme: "sakura",   type: "video" }
  ];
  Dream.loadBackgrounds(BACKGROUNDS);

  const bgListEl = $("#bg-list");
  function addBgThumb(mode, glyph, title, bgImage) {
    const b = document.createElement("button");
    b.className = "bg-thumb" + (bgImage ? "" : " bg-special");
    b.dataset.bg = mode; b.title = title;
    if (bgImage) b.style.backgroundImage = `url("${encodeURI(bgImage)}")`;
    else b.innerHTML = `<span class="bg-glyph">${glyph}</span>`;
    b.addEventListener("click", () => chooseBackground(mode));
    bgListEl.appendChild(b);
  }
  addBgThumb("off", "○", "No image · pure dreamscape", null);
  addBgThumb("cycle", "⟳", "Shuffle through all worlds", null);
  BACKGROUNDS.forEach(bg => addBgThumb(
    bg.key,
    bg.type === "video" ? "▶" : "",
    bg.type === "video" ? bg.label + " · moving video" : "World " + bg.label,
    bg.type === "video" ? null : bg.src
  ));

  let bgChoice = "off";
  function chooseBackground(mode) {
    disablePerSong();               // a manual pick pins the world
    bgChoice = mode;
    Dream.setBackground(mode);
    localStorage.setItem("dream-bg", mode);
    syncBgUI();
    if (mode === "cycle") toast("worlds will drift, one into the next…");
  }
  function syncBgUI() {
    $$(".bg-thumb").forEach(b => b.classList.toggle("active", b.dataset.bg === bgChoice));
  }

  // ---- per-song: shift world + atmosphere together ----
  const persongEl = $("#persong-toggle");
  persongEl.checked = perSong;
  function advanceWorld() {
    let pick;
    do { pick = BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)]; }
    while (BACKGROUNDS.length > 1 && pick.key === lastWorldKey);
    lastWorldKey = pick.key;
    Dream.setAuto(false);
    Dream.setBackground(pick.key);   bgChoice = pick.key;
    Dream.setTheme(pick.theme);      applyAccent(pick.theme);
    syncBgUI(); syncThemeUI();
    toast("world " + pick.label + " · " + THEMES[pick.theme].label.toLowerCase());
  }
  function disablePerSong() {
    perSong = false;
    persongEl.checked = false;
    localStorage.setItem("dream-persong", "0");
  }
  persongEl.addEventListener("change", (e) => {
    perSong = e.target.checked;
    localStorage.setItem("dream-persong", perSong ? "1" : "0");
    if (perSong) advanceWorld();     // apply right away
  });

  const savedBg = localStorage.getItem("dream-bg") || "off";
  if (!perSong) { bgChoice = savedBg; Dream.setBackground(savedBg); }
  syncBgUI();

  // ---- mixable effects ----
  const fxList = $("#fx-list");
  Dream.fxMeta().forEach(m => {
    const pill = document.createElement("button");
    pill.className = "fx-pill"; pill.dataset.fx = m.key;
    pill.title = m.note;
    pill.textContent = m.label;
    pill.addEventListener("click", () => {
      const on = !Dream.getFx(m.key);
      Dream.setFx(m.key, on);
      pill.classList.toggle("on", on);
      saveFx();
    });
    fxList.appendChild(pill);
  });
  function syncFxUI() {
    const state = Dream.getFx();
    $$(".fx-pill").forEach(p => p.classList.toggle("on", !!state[p.dataset.fx]));
  }
  function saveFx() { localStorage.setItem("dream-fx", JSON.stringify(Dream.getFx())); }
  $("#fx-surprise").addEventListener("click", () => {
    Dream.randomizeFx(); syncFxUI(); saveFx();
    toast("a new mix drifts in…");
  });
  $("#fx-clear").addEventListener("click", () => {
    Dream.fxMeta().forEach(m => Dream.setFx(m.key, false));
    syncFxUI(); saveFx();
  });

  // restore saved effect mix
  try {
    const savedFx = JSON.parse(localStorage.getItem("dream-fx") || "null");
    if (savedFx) Object.keys(savedFx).forEach(k => Dream.setFx(k, savedFx[k]));
  } catch (e) { /* ignore */ }
  syncFxUI();

  function syncThemeUI() {
    const isAuto = Dream.isAuto();
    $("#theme-auto").classList.toggle("active", isAuto);
    $$(".theme-chip").forEach(c => {
      c.classList.toggle("active", !isAuto && c.dataset.theme === currentThemeKey());
    });
  }
  let _manualKey = "nocturne";
  function currentThemeKey() { return _manualKey; }
  const _setTheme = Dream.setTheme;
  Dream.setTheme = function (k) { _manualKey = k; return _setTheme(k); };

  // adaptive mode tells us when it shifts the atmosphere
  Dream.onAdapt((key) => {
    if (!Dream.isAuto()) return;
    applyAccent(key);
    toast("the music turns " + THEMES[key].label.toLowerCase() + "…");
    $$(".theme-chip").forEach(c => c.classList.toggle("active", false));
  });

  let toastTimer = null;
  function toast(msg) {
    const el = $("#hint-auto");
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // restore saved preference
  const saved = localStorage.getItem("dream-theme");
  if (saved && saved !== "auto" && THEMES[saved]) { Dream.setTheme(saved); applyAccent(saved); }

  // ============================ cinematic idle ============================
  // After a few seconds of stillness the text & controls fade to transparency,
  // leaving only the dreamscape; the slightest mouse move brings them back.
  let idleTimer = null;
  const IDLE_MS = 3600;
  function wake() {
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add("idle"), IDLE_MS);
  }
  ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"].forEach(ev =>
    window.addEventListener(ev, wake, { passive: true }));
  wake();

  // expose transport for the sound editor
  window.PlayerCtl = {
    toggle: togglePlay,
    next: () => step(1),
    prev: () => step(-1),
    isPaused: () => audio.paused
  };

  // ============================ boot ============================
  Dream.init($("#dream"));
  syncThemeUI();
})();
