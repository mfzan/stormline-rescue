# STORMLINE

[![make.fun](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/mfzan/stormline-rescue/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/mfzan/stormline-rescue/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)

**STORMLINE: fly a STOL bush plane through live storm fronts to rescue stranded climbers — 9 missions, 6 mountain strips, 3 storm cells, fuel and damage decide if you make it home.**

A STOL bush pilot flying rescue sorties into live storm fronts in the high
Andes. Every mission is a go/no-go decision against gusting crosswinds, rain
squalls and lightning: land on a short mountain strip, load the stranded
climbers (or drop the medicine), and make it home before the fuel or the
airframe gives out.

## The twist

Most flight games let you fly anywhere. STORMLINE gives you one plane, one
valley system, and one job — and the weather is the boss. Three storm cells
drift across the map with real gusts, rain and lightning; every ring gate
sits in a carved valley channel the plane can actually fly; every landing is
scored on speed, sink rate and whether you stayed on the strip. Fuel and
damage are the whole game: a sortie you cannot finish is a sortie you should
never have started.

## What is in the game

- **Real flight model** — lift ∝ speed², stall 55 kt clean / 42 kt flaps,
  VNE 150 kt, throttle, flaps, pitch and bank, ground effect on the flare.
  Takeoff, landing, stalls and crashes are all modelled, not scripted.
- **Weather that flies back** — 3 drifting storm cells with gusts, rain,
  lightning + thunder, and wind that changes with altitude and position.
- **Terrain you can read** — a 12 × 12 km heightfield valley system with 5
  named peaks, 2 lakes, 6 mountain strips, and a carved valley channel along
  every sortie route so the marked course is genuinely flyable.
- **9 missions** — rescue, supply and medevac sorties from $400 to $2,200,
  1–3 stars, wind 8–28 kt, including two multi-leg sorties (Double Lift,
  The Full Circuit) that chain strips together.
- **HUD + minimap** — altitude/speed/heading/VSI, fuel/damage/wind, a
  cockpit six-pack (attitude, speed, altitude, heading), and a live minimap
  with storm cells in red and the ring course in amber.
- **Sound** — procedural WebAudio: engine, wind, rain, thunder, ring chimes.
- **No libraries, no network** — one 2.5D canvas, deterministic, every
  module in `game/src/` with one clear job.

## How to play

Open `game/index.html` in a browser, or serve it:

```sh
node serve.ts   # http://localhost:8080
```

- **Arrows** fly (Up = climb), **W/S** throttle, **F** flaps, **C** camera
  (chase / cockpit), **P** pause, **M** mute, **Enter** confirm,
  **R** retry, **Esc** menu.
- Fly through the amber rings, land on the target strip, load the climbers
  (or drop the crate), then fly home. A smooth landing pays; a hard one
  costs airframe. Run out of fuel or damage and the sortie ends where you are.

## Entry

Built for the make.fun bounty
[best-flight-game-20261126-0057](https://make.fun/bounty/best-flight-game-20261126-0057)
("Make the best flight game", $500, 50 paid places). The entrypoint is
`main.ts` (Node 22, standard library only): it copies `game/` and
`screenshots/` into the output directory and writes `dossier.json` via the
kit's vendored library.

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts
```

## License

MIT — see [LICENSE](LICENSE).
