# Dream Portal — Violin Dreamscapes 🌌🎻

A dreamlike, audio-reactive home for a collection of violin recordings (with piano
and with a chamber ensemble). Enter a portal, drift between two "worlds", and let an
ever-changing aurora — clouds, butterflies, birds, shooting stars and a wandering
hummingbird — move with the music.

**Live:** https://dream-music-violin.web.app

---

## ✨ Features

- **Immersive structure** — a portal → gallery (two albums) → album view, with a
  persistent glassy player.
- **Audio-reactive dreamscape** (HTML5 Canvas + Web Audio `AnalyserNode`): aurora
  ribbons, twinkling starfield, drifting clouds, butterflies, birds that flock on
  note attacks, and kaleidoscopic "hallucination" blooms on transients.
- **Five hand-tuned atmospheres** — Nocturne, Liquid Gold, Glass, Surreal Dream,
  Sakura — plus an **Auto / adaptive** mode that crossfades the palette to the
  music's energy and onset density.
- **Fantasy-world backgrounds** — six images composited inside the canvas with a
  perpetual Ken-Burns drift; off / pick-one / shuffle-cycle.
- **Shift world & mood each song** (default) — every track crossfades to a new
  background and its matched atmosphere.
- **Mixable effects** — falling petals/snow/embers/stardust, shooting stars,
  fireflies, bokeh orbs, constellation web, god rays, water mirror, kaleidoscope.
- **Wandering hummingbird** — a looping video that flies a natural path, faces its
  direction of travel (fading through a graceful flip), drifts away and returns, and
  darts faster when the violin swells.
- **Player** — play/pause, prev/next, seek, volume, loop-one, **endless shuffle**
  across both albums, keyboard shortcuts, and a large transparent "begin" button.
- **Cinematic idle** — the UI fades to transparency when the mouse rests and returns
  on the slightest movement.

## 🎹 Controls

| Action | Control |
| --- | --- |
| Play / pause | `Space` or the player / big button |
| Seek ±5s | `←` / `→` |
| Previous / next movement | `Shift` + `←` / `→` |
| Atmosphere, backgrounds, effects | the **✦** dock, top-right |

## 🗂️ Project structure

```
index.html        # markup: portal, gallery, album, player, theme dock, hummingbird
styles.css        # all styling (nocturne base, glassmorphism, idle fade)
tracks.js         # album + track manifest (titles, durations)
themes.js         # palettes + adaptive-mode logic
visuals.js        # the canvas dreamscape engine (aurora, creatures, effects, fx)
app.js            # navigation, audio player, Web Audio graph, theme/bg/fx wiring
hummingbird.js    # the wandering-bird flight controller
music/            # recordings + fantasy background images
favicon.svg       # fantasy favicon (+ png fallbacks)
firebase.json     # Firebase Hosting config
```

## 🚀 Run locally

It must be served over **HTTP** (not opened as a `file://`), because the visuals
"listen" to the audio via the Web Audio API, which requires a same-origin source.

```bash
python3 -m http.server 8777
# then open http://localhost:8777/
```

## ☁️ Deploy (Firebase Hosting)

```bash
firebase deploy --only hosting
```

## 🔒 Security

This is a fully static, client-side site:

- No backend, no database, no user input — and therefore no XSS sink (all DOM is
  built from hard-coded data).
- No secrets, API keys, or credentials are committed. `.firebaserc` holds only the
  public Firebase **project ID**; the site embeds no Firebase SDK config.
- The only third-party resource is Google Fonts (stylesheet).

## 📄 Credits & rights

- **Music:** original violin recordings by the site owner.
- **Background images / hummingbird clip:** dreamlike visuals used to set the mood;
  please confirm you hold the rights to any media before reusing this repository.

## 🛠️ Built with

Vanilla HTML, CSS and JavaScript — no frameworks, no build step. Canvas 2D + the
Web Audio API, hosted on Firebase Hosting.
