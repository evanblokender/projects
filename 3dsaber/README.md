# SABER//3D

A polished browser Beat Saber-style rhythm game, played with a gamepad.
The thumbsticks are your sabers.

## Run it

ES modules need a local server (opening `index.html` directly won't work):

```bash
npx serve .
# or
python -m http.server 8000
```

Then open the printed URL in **Chrome or Edge** (best audio codec support for custom maps).

## How to play

- Connect an Xbox or PlayStation controller (any standard-mapping gamepad works).
- **Menus**: right thumbstick moves the cursor, **A** (Xbox) / **✕** (PlayStation) clicks, **B/○** goes back, left stick scrolls. A real mouse works too.
- **In game**: left stick = left saber, right stick = right saber. Flick the stick in the arrow's direction as the note reaches you. Avoid bombs and walls.
- **Start/Options** (or Esc) pauses.

## Features

- Main menu, song select, results screens, pause menu — all controller-navigable
- **Custom Levels**: search BeatSaver, download maps (song + cover + all difficulties) straight into the browser; they're stored offline in IndexedDB
- Supports v2, v3 and v4 beatmaps, all difficulties and characteristics
- **Chroma** note/light colors and **Noodle Extensions** coordinates
- Full lighting-event playback (lasers, rings, flashes) with bloom post-processing
- Scoring with combo multiplier (x1–x8), accuracy, ranks (SS–D), per-map high scores
- Energy bar with fail — or turn on **No Fail** in settings
- Settings: volumes, saber colors, note speed, cursor sensitivity, bloom toggle

## Files

- `js/main.js` — bootstrap + game loop
- `js/game.js` — 3D engine, environment, lighting, gameplay
- `js/menu.js` — all UI screens
- `js/beatmap.js` — v2/v3/v4 map parser (Chroma + Noodle)
- `js/beatsaver.js` — BeatSaver API, zip extraction, IndexedDB library
- `js/builtin.js` — procedural beatmap for the bundled track
- `js/input.js` — gamepad + virtual cursor
- `js/audio.js` — song clock + SFX
- `js/settings.js` — persistent settings + high scores
