// Theme system for the dreamscape.
// Each theme defines colors as [r,g,b] arrays so the visual engine can blend
// between them smoothly (used by the "Auto / Adaptive" mode).

const THEMES = {
  nocturne: {
    label: "Nocturne",
    note: "midnight blue · aurora · starlight",
    bg: [[8, 10, 28], [18, 16, 54], [10, 26, 46]],   // top, mid, bottom gradient
    aurora: [[120, 150, 255], [150, 110, 235], [110, 220, 200]],
    star:   [200, 215, 255],
    cloud:  [70, 80, 140],
    bird:   [180, 195, 255],
    wings:  [[150, 175, 255], [185, 150, 245], [130, 220, 210]],
    bloom:  [150, 170, 255],
    text:   "#dfe6ff",
    warmth: 0.15
  },
  gold: {
    label: "Liquid Gold",
    note: "amber · ink · drifting dust",
    bg: [[18, 10, 6], [46, 26, 8], [28, 16, 10]],
    aurora: [[255, 196, 92], [240, 150, 70], [255, 230, 170]],
    star:   [255, 226, 170],
    cloud:  [120, 80, 40],
    bird:   [255, 210, 150],
    wings:  [[255, 200, 110], [240, 160, 90], [255, 235, 180]],
    bloom:  [255, 190, 120],
    text:   "#ffeccf",
    warmth: 0.85
  },
  glass: {
    label: "Glass",
    note: "prism · caustics · silver light",
    bg: [[20, 24, 30], [40, 48, 60], [28, 34, 44]],
    aurora: [[180, 230, 255], [220, 200, 255], [255, 220, 240]],
    star:   [240, 250, 255],
    cloud:  [120, 140, 165],
    bird:   [225, 240, 255],
    wings:  [[190, 235, 255], [225, 205, 255], [255, 225, 245]],
    bloom:  [220, 240, 255],
    text:   "#eef4ff",
    warmth: 0.35
  },
  dream: {
    label: "Surreal Dream",
    note: "dusk rose · lavender · fog",
    bg: [[30, 16, 36], [58, 30, 58], [40, 30, 60]],
    aurora: [[255, 170, 200], [200, 160, 255], [255, 210, 190]],
    star:   [255, 225, 235],
    cloud:  [130, 100, 150],
    bird:   [255, 200, 220],
    wings:  [[255, 175, 205], [205, 165, 255], [255, 215, 195]],
    bloom:  [255, 185, 215],
    text:   "#ffe8f1",
    warmth: 0.7
  },
  sakura: {
    label: "Sakura",
    note: "blossom · anime sky · soft pink",
    bg: [[26, 16, 30], [60, 34, 56], [40, 28, 52]],
    aurora: [[255, 190, 215], [255, 160, 190], [200, 180, 255]],
    star:   [255, 235, 245],
    cloud:  [170, 130, 170],
    bird:   [255, 215, 230],
    wings:  [[255, 195, 220], [255, 165, 195], [210, 185, 255]],
    bloom:  [255, 200, 225],
    text:   "#ffeef5",
    warmth: 0.6
  }
};

// Order shown in the UI; "auto" is handled specially (adaptive blending).
const THEME_ORDER = ["nocturne", "gold", "glass", "dream", "sakura"];

// Mood -> theme mapping used by Auto mode. We estimate a "mood" from the
// music's energy (loudness) and flux (onset density ~ tempo/agitation),
// then crossfade toward the theme that fits.
//   calm + soft   -> nocturne / glass
//   warm + flowing-> gold / dream
//   bright + fast -> sakura
function pickAdaptiveTheme(energy, flux) {
  // energy, flux are 0..1 smoothed.
  if (energy < 0.28) return flux < 0.4 ? "nocturne" : "glass";
  if (energy < 0.55) return flux < 0.45 ? "dream" : "sakura";
  return flux < 0.5 ? "gold" : "sakura";
}

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpRGB(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function rgb(c, a) {
  return "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + (a == null ? 1 : a) + ")";
}
