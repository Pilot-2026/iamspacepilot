# iamSpacePilot

Fly free through the sky and leave a wall of light behind you. Every wall is deadly, yours too. The last pilot flying wins.

**Play:** https://iamspacepilot.netlify.app

## Status: solo and online

- Free flight (turn, pitch, roll). The light wall rolls with your glider: fly level and it stands upright, roll 90° and it lies flat, keep rolling and it twists into a spiral.
- Ten levels, each with its own look, climbing from the sky into deep space: Cloud Sea, Storm Eye (lightning, updraft), Frost Heights, Jet Stream (wind), Aurora, Orbit, Moon Shadow, Ring World, Nebula (plasma bolts) and Lattice Core (a core that pulls you in). Win a level to open the next one.
- Cheat for testing: press 1 five times, or tap the score five times, to jump to the next level.
- 1 to 7 bots in three difficulties (Rookie, Pilot, Ace).
- The arena shield closes in after 30 seconds.
- Boost: hold to speed up, refill it by flying close along walls or through rings.
- Gun: shots fly straight through walls and only hit other ships, curving a little towards a ship in front of them. Three hits bring a ship down, and the gun overheats when you hold the trigger too long. Bots shoot too, never at their own team.
- Four ships to choose from in the hangar, each with its own handling and a special ability (key C):
  - **Trident** (gunship): Trident Burst fires a fan of five shots; its shots fly 20% faster.
  - **Manta** (interceptor): Afterburner, two seconds at top speed; sharpest turns, faster slipstream.
  - **Halo** (phase runner): Phase Shift, 1.5 seconds flying through walls and shots; rolls 40% faster.
  - **Bulwark** (heavy): Shockwave wipes out enemy shots nearby and jams their guns; takes five hits.
- Bonus rings: fly through one for boost and the bonus it shows by colour: triple shot, big wall, shield, cool gun, turbo, seeker shots or repair. Rings work online too.
- Light walls are twice as high as before. They leave the ship narrow and spread out behind it.
- Music: twelve electronic tracks made live in the browser (one per level, plus menu and intro), with intro, build-up, drop and break; the mix opens up in flight and gets muffled after a crash or in the pause menu. Press M or the music button to switch it on or off at any time; volume in Settings.
- Steering sounds: turning left and right hiss from that side in different pitches, climbing rises, diving rushes low, rolling whirrs, and every move starts with a short thruster puff.
- Keyboard, gamepad and touch (floating stick, boost and roll buttons).
- The arena shield, floor and ceiling are drawn as a glowing grid that turns red and thick when you get close, with a distance warning and a warning tone.
- Highscores: a score for every round, the top 10 on this device and an online leaderboard for all pilots.
- Yellow menus, callsign, synthesized sound, installable as an app.
- Online: up to 8 pilots per game, bots fill empty seats. Public or private games, free-for-all or two teams. **who is online?** on the start screen lists every public game; join one with a tap, with a 5-letter code or with an invite link. Live voice radio in every game (push to talk or open mic, mute any pilot).

## Score

Per round: 10 points per second in the air, 100 per pilot you outlast, 250 per pilot that hits your wall, 200 per pilot you shoot down, 25 per hit, 50 per bonus ring, 500 for a win. The sum is multiplied by 1 (Rookie), 1.5 (Pilot) or 2 (Ace).

## Online leaderboard

Two Netlify Functions, backed by Firebase Firestore:

- `POST /api/score` replays the recorded flight with the same simulation code the game runs. Only if the replay ends with the same score is it stored. The first post with a callsign claims it for that browser (a secret pilot key); other browsers cannot post under that callsign.
- `GET /api/leaderboard?level=cloud-sea` returns the 50 best pilots of a level.

They need three environment variables in Netlify: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` (from a Firebase service account key). Without them the game still works and keeps highscores on the device. Firestore collections: `pilots`, `lb_<level>`, `replays`. All access goes through the functions, so the Firestore security rules can stay locked.

## Online games and voice radio

Every online game is a LiveKit room named `g-<CODE>`. Game data travels as reliable data packets in that room, the voice radio as audio tracks in the same room.

- `GET /api/games` lists the public games running right now and how many pilots are online.
- `POST /api/game` hosts a game (creates the room), joins one by code (hands out a room token) or lets the host update the list entry.

Each device flies its own glider and sends its position and new wall pieces about 20 times a second. The pilot who joined first is the host: it flies the bots, starts rounds, decides when a round is over and starts the next one 8 seconds later. If the host leaves, the next pilot takes over. Pilots who join during a round fly from the next one.

The functions need three environment variables in Netlify, from a LiveKit Cloud project (Settings → Keys): `LIVEKIT_URL` (wss://…livekit.cloud), `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`. `/api/health` shows whether they are set and whether LiveKit answers.

## Controls

| Action                      | Keyboard              | Gamepad       | Touch                        |
| --------------------------- | --------------------- | ------------- | ---------------------------- |
| Turn                        | ← / → or A / D        | Left stick    | Left thumb stick             |
| Nose down, up (flight mode) | ↑ / ↓ or W / S        | Left stick    | Left thumb stick             |
| Roll                        | Q / E                 | LB / RB       | Roll buttons                 |
| Fire                        | Space or left click   | LT or X       | Fire button                  |
| Boost                       | ⌘ Command or Shift    | RT or A       | Boost button                 |
| Special ability             | C                     | B             | Special button               |
| Talk (online)               | Hold R                | Y or d-pad up | Mic button (tap on, tap off) |
| Music on / off              | M                     |               | Music button                 |
| Pause                       | Esc or P              | Start         | II button                    |

Flight mode is on by default: arrow up lowers the nose, like in a plane. It can be switched off in Settings.

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
src/online/   Online match logic (independent of the network), LiveKit link, session.
src/net/      Calls to the leaderboard and game list.
server/       Leaderboard and game list logic, small Firestore and LiveKit REST clients.
netlify/functions/  The API endpoints.
tests/        Simulation, replay, leaderboard, online match and game list tests.
```

The deterministic core runs on the server too, which lets it check records by replaying recorded inputs.

## Roadmap

1. **Phase 1 (done):** solo flight, levels 1 and 2, bots, phone and PC controls, sound.
2. **Phase 2 (started):** online leaderboard with verified scores (done). Next: daily challenge, ghost runs, pilot code to use a callsign on several devices.
3. **Phase 3 (done):** online matches with up to 8 pilots, public or private, free-for-all or two teams.
4. **Phase 4 (done):** live voice radio (LiveKit) with push to talk and mute. Next: block and report.
5. **Phase 5:** shots (done), rank ladder up to Space Pilot.
