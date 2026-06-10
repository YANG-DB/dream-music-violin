// ============================================================================
//  hummingbird.js — a hummingbird that wanders the screen along a natural
//  flight path, faces the way it flies, and drifts away then returns now & then.
//  The video's audio is stripped; black background vanishes via screen-blend.
// ============================================================================
(function () {
  const el = document.getElementById("hummingbird");
  if (!el) return;

  // if it happens to be a <video>, keep it looping & silent (SVG needs none of this)
  if (el.tagName === "VIDEO") {
    el.muted = true; el.loop = true; el.playsInline = true;
    const play = () => { const p = el.play(); if (p) p.catch(() => {}); };
    play();
    ["pointerdown", "keydown", "click", "touchstart"].forEach(ev =>
      window.addEventListener(ev, play, { once: false, passive: true }));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) play(); });
  }

  const rand = (a, b) => a + Math.random() * (b - a);
  let W = window.innerWidth, H = window.innerHeight;
  let ow = 320, oh = 180;
  function measure() { ow = el.offsetWidth || 320; oh = el.offsetHeight || ow * (200 / 260); }
  window.addEventListener("resize", () => { W = innerWidth; H = innerHeight; measure(); }, { passive: true });

  // ---- appearance / rarity ----
  const MAX_OP = 0.32;           // peak opacity — kept faint / barely there
  const VISIT = [5, 10];         // how long a visit lasts (s)
  const ABSENCE = [30, 80];      // how long it stays gone between visits (s)

  // ---- flight state ----
  let x = -400, y = 0;            // bird centre (px)
  let tx = 0, ty = 0;             // current waypoint
  let depth = 1, tdepth = 1;      // size / distance
  let facing = 1;                 // -1 mirrors (source bird faces LEFT)
  let flipping = false, flipOp = 1, lastFlip = 0;   // direction-change fade
  let op = 0, opTarget = 0;       // opacity now / target (starts hidden)
  let away = true, hiddenUntil = 0;
  let last = 0, waypointAt = 0, nextEvent = 0, inited = false;

  function pickWaypoint(now) {
    tx = rand(0.12, 0.88) * W;
    ty = rand(0.14, 0.68) * H;
    tdepth = rand(0.72, 1.28);
    waypointAt = now + rand(2.2, 4.6);
  }
  function scheduleVisitEnd(now) { nextEvent = now + rand(VISIT[0], VISIT[1]); }   // end this visit soon

  function enterFromEdge() {
    const side = Math.floor(rand(0, 4));
    if (side === 0) { x = -ow * 0.5; y = rand(0.2, 0.6) * H; }
    else if (side === 1) { x = W + ow * 0.5; y = rand(0.2, 0.6) * H; }
    else if (side === 2) { x = rand(0.2, 0.8) * W; y = -oh * 0.5; }
    else { x = rand(0.2, 0.8) * W; y = H + oh * 0.5; }
  }

  function frame(ms) {
    const now = ms / 1000;
    if (!inited) {
      measure(); enterFromEdge(); pickWaypoint(now);
      hiddenUntil = now + rand(8, 20);    // hold off the first appearance a while
      last = now; inited = true;
    }
    let dt = now - last; last = now;
    if (dt > 0.05) dt = 0.05;     // clamp after tab-switches

    // optional coupling to the music — dart more when the violin swells
    let energy = 0;
    try { if (window.Dream && Dream.signals) energy = Dream.signals().energy || 0; } catch (e) { /* ignore */ }
    const speedK = 1 + energy * 1.4;

    // a brief visit, then a long absence before it drifts back in
    if (!away && now > nextEvent) { away = true; opTarget = 0; }
    if (away && op < 0.02) {
      if (hiddenUntil === 0) hiddenUntil = now + rand(ABSENCE[0], ABSENCE[1]);  // begin the long absence
      if (now > hiddenUntil) {                 // time to visit again, somewhere new
        enterFromEdge(); pickWaypoint(now);
        away = false; opTarget = MAX_OP; hiddenUntil = 0; scheduleVisitEnd(now);
      }
    }

    // choose a fresh waypoint when reached or after a while
    const dx = tx - x, dy = ty - y;
    if (Math.hypot(dx, dy) < 38 || now > waypointAt) pickWaypoint(now);

    // smooth glide toward the waypoint (exponential ease -> curved, lifelike path)
    const halfLife = 0.95 / speedK;
    const ease = 1 - Math.pow(0.5, dt / halfLife);
    const nx = x + (tx - x) * ease;
    const ny = y + (ty - y) * ease;
    const velX = (nx - x) / Math.max(dt, 0.001);
    x = nx; y = ny;

    // gentle hover wobble so it never looks static
    const wob = Math.sin(now * 6.2) * 2.4 + Math.sin(now * 2.1) * 4.5;

    // face the direction of travel (source faces left -> mirror when going right).
    // Flip by fading out, snapping the mirror while invisible, then fading back in,
    // so the bird never squashes horizontally through zero width.
    const desired = velX > 60 ? -1 : velX < -60 ? 1 : facing;
    if (!flipping && desired !== facing && now - lastFlip > 0.5) flipping = true;
    if (flipping) {
      flipOp += (0 - flipOp) * Math.min(1, dt * 12);          // fade out fast
      if (flipOp < 0.08) { facing = desired; flipping = false; lastFlip = now; }
    } else {
      flipOp += (1 - flipOp) * Math.min(1, dt * 6);           // ease back in
    }

    depth += (tdepth - depth) * Math.min(1, dt * 1.1);
    op += (opTarget - op) * Math.min(1, dt * 1.4);

    el.style.opacity = (op * flipOp).toFixed(3);
    el.style.transform =
      "translate3d(" + (x - ow / 2).toFixed(1) + "px," + (y - oh / 2 + wob).toFixed(1) + "px,0)" +
      " scale(" + (facing * depth).toFixed(3) + "," + depth.toFixed(3) + ")";

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
