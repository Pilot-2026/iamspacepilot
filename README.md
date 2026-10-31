# iamSpacePilot

Fly free through the sky and leave a wall of light behind you. Every wall is deadly, yours too. The last pilot flying wins.

**Play:** https://iamspacepilot.netlify.app

## Status: solo build with highscores

- Free flight (turn, pitch, roll). The light wall rolls with your glider: fly level and it stands upright, roll 90° and it lies flat, keep rolling and it twists into a spiral.
- Ten levels, each with its own look, climbing from the sky into deep space: Cloud Sea, Storm Eye (lightning, updraft), Frost Heights, Jet Stream (wind), Aurora, Orbit, Moon Shadow, Ring World, Nebula (plasma bolts) and Lattice Core (a core that pulls you in). Win a level to open the next one.
- Cheat for testing: press 1 five times, or tap the score five times, to jump to the next level.
- 1 to 7 bots in three difficulties (Rookie, Pilot, Ace).
- The arena shield closes in after 30 seconds.
- Boost: hold to speed up, refill it by flying close along walls or through rings.
- Keyboard, gamepad and touch (floating stick, boost and roll buttons).
- The arena shield, floor and ceiling are drawn as a glowing grid that turns red and thick when you get close, with a distance warning and a warning tone.
- Highscores: a score for every round, the top 10 on this device and an online leaderboard for all pilots.
- Yellow menus, callsign, synthesized sound, installable as an app.

## Score

Per round: 10 points per second in the air, 100 per pilot you outlast, 250 per pilot that hits your wall, 50 per ring, 500 for a win. The sum is multiplied by 1 (Rookie), 1.5 (Pilot) or 2 (Ace).

## Online leaderboard

Two Netlify Functions, backed by Firebase Firestore:

- `POST /api/score` replays the recorded flight with the same simulation code the game runs. Only if the replay ends with the same score is it stored. The first post with a callsign claims it for that browser (a secret pilot key); other browsers cannot post under that callsign.
- `GET /api/leaderboard?level=cloud-sea` returns the 50 best pilots of a level.

They need three environment variables in Netlify: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` (from a Firebase service account key). Without them the game still works and keeps highscores on the device. Firestore collections: `pilots`, `lb_<level>`, `replays`. All access goes through the functions, so the Firestore security rules can stay locked.

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
src/storage/  Callsign, settings, records and local highscores in this browser.
src/net/      Calls to the online leaderboard.
server/       Leaderboard logic and a small Firestore REST client for the functions.
netlify/functions/  The two API endpoints.
tests/        Simulation, replay and leaderboard tests.
```

The deterministic core is the groundwork for online play: the same code will run on the server, which lets it check records by replaying recorded inputs.

## Roadmap

1. **Phase 1 (done):** solo flight, levels 1 and 2, bots, phone and PC controls, sound.
2. **Phase 2 (started):** online leaderboard with verified scores (done). Next: daily challenge, ghost runs, pilot code to use a callsign on several devices.
3. **Phase 3:** online matches with up to 8 pilots, public or private, free-for-all or two teams of four.
4. **Phase 4:** live voice radio (LiveKit) with mute, block and report.
5. **Phase 5:** rank ladder up to Space Pilot.
