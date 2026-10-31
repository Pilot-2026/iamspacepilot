# iamSpacePilot

Fly free through the sky and leave a wall of light behind you. Every wall is deadly, yours too. The last pilot flying wins.

**Play:** https://iamspacepilot.netlify.app

## Status: phase 1, solo test build

- Free flight (turn, pitch, roll). The light wall rolls with your glider: fly level and it stands upright, roll 90° and it lies flat, keep rolling and it twists into a spiral.
- Two levels: **Cloud Sea** (3 km, sunset, boost rings) and **Storm Eye** (12 km, turning storm wall, updraft, lightning that leaves deadly bolts).
- 1 to 7 bots in three difficulties (Rookie, Pilot, Ace).
- The arena shield closes in after 30 seconds.
- Boost: hold to speed up, refill it by flying close along walls or through rings.
- Keyboard, gamepad and touch (floating stick, boost and roll buttons).
- Yellow menus, local callsign and records, synthesized sound, installable as an app.

## Controls

| Action        | Keyboard            | Gamepad    | Touch            |
| ------------- | ------------------- | ---------- | ---------------- |
| Turn          | A / D or ← / →      | Left stick | Left thumb stick |
| Nose up, down | W / S or ↑ / ↓      | Left stick | Left thumb stick |
| Roll          | Q / E               | LB / RB    | Roll buttons     |
| Boost         | Space               | RT or A    | Boost button     |
| Pause         | Esc or P            | Start      | II button        |

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # simulation tests
npm run build      # type check and production build into dist/
```

## Deploy

Netlify builds the site from `main` on every push (`netlify.toml`). Every pull request gets its own preview address.

## How the code is organised

```
src/core/     Simulation only, no graphics: flight model, walls, collisions, bots, arena.
              Runs at a fixed 60 ticks per second and uses its own deterministic math,
              so every browser and a server compute exactly the same flight.
src/render/   three.js: sky, clouds, light walls, gliders, camera, effects.
src/ui/       Yellow menus, flight HUD with radar, touch controls, styles.
src/input/    Keyboard, gamepad and touch merged into one pilot input.
src/audio/    All sounds made live with the Web Audio API.
src/storage/  Callsign, settings and records in this browser.
tests/        Simulation tests (determinism, collisions, bots, rounds).
```

The deterministic core is the groundwork for online play: the same code will run on the server, which lets it check records by replaying recorded inputs.

## Roadmap

1. **Phase 1 (this build):** solo flight, levels 1 and 2, bots, phone and PC controls, sound.
2. **Phase 2:** callsigns and records online (Firebase via Netlify Functions), public leaderboard, daily challenge, ghost runs.
3. **Phase 3:** online matches with up to 8 pilots, public or private, free-for-all or two teams of four.
4. **Phase 4:** live voice radio (LiveKit) with mute, block and report.
5. **Phase 5:** levels 3 to 5 (Aurora, Orbit, Lattice Core) and the rank ladder up to Space Pilot.
