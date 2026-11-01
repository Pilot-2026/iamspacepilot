# iamSpacePilot

Fly free through the sky and leave a wall of light behind you. Every wall is deadly, yours too. The last pilot flying wins.

**Play:** https://iamspacepilot.netlify.app

## Status: solo and online

- Free flight (turn, pitch, roll). The light wall rolls with your glider: fly level and it stands upright, roll 90° and it lies flat, keep rolling and it twists into a spiral.
- Ten levels, each with its own look, climbing from the sky into deep space: Cloud Sea, Storm Eye (lightning, updraft), Frost Heights, Jet Stream (wind), Aurora, Orbit, Moon Shadow, Ring World, Nebula (plasma bolts) and Lattice Core (a core that pulls you in). Win a level to open the next one.
- Cheats for testing: press 1 five times, or tap the score five times, to jump to the next level. Type 2222, or tap the top right corner five times on a touch screen, to fly the next ship.
- 1 to 7 bots in three difficulties (Rookie, Pilot, Ace). They fly smooth curves and only turn hard when a wall is close. The difficulty also sets the pace for everyone in the round: on Rookie all ships fly at 60% speed, on Pilot at normal speed, on Ace at 125% (online too, from the host's choice).
- The arenas are big (twice the size they started with) and the arena shield closes in after 30 seconds.
- Every ship casts a shadow on the floor, and yours also on the nearest shield wall and the ceiling, so you can feel how far away the grid is.
- Boost: hold to speed up, refill it by flying close along walls or through rings.
- Gun: shots fly straight through walls and only hit other ships, curving a little towards a ship in front of them. Three hits bring a ship down, and the gun overheats when you hold the trigger too long. Bots shoot too, never at their own team.
- Four ships to choose from in the hangar, each with its own handling and a special ability (key C):
  - **Trident** (gunship): Trident Burst fires a fan of five shots; its shots fly 20% faster.
  - **Manta** (interceptor): Afterburner, two seconds at top speed; sharpest turns, faster slipstream.
  - **Halo** (phase runner): Phase Shift, 1.5 seconds flying through walls, obstacles and shots; rolls 40% faster.
  - **Bulwark** (heavy): Shockwave wipes out enemy shots nearby and jams their guns; takes five hits.
- Bonus rings: fly through one for boost and the bonus it shows by colour: triple shot, big wall, shield, cool gun, turbo, seeker shots or repair. Rings work online too.
- Light walls are twice as high as before. They leave the ship narrow and spread out behind it.
- Obstacles inside the arena, only a few per level and mostly glass: clear in the middle, glowing at the edges, some grown out of rock. Glass islands with waterfalls and a glass whale (Cloud Sea), glass spires (Storm Eye), ice crystals and a glass rock with a waterfall (Frost Heights), a glass turbine ring (Jet Stream), an arch of light and a waterfall geode (Aurora), a glass space station with a satellite (Orbit), rocks with glass crystals (Moon Shadow), glass gates (Ring World), glass bubbles with glowing hearts (Nebula) and glass beams (Lattice Core). Flying into one is deadly and shots fizzle on them; flying through a waterfall only makes the water splash. They move the same way on every device, so they work online too.
- Crazy outer worlds: every level has its own wonders far outside the arena: hot-air balloons and sky whales, a tornado full of cows, houses and trees around a giant eye that follows you, a snow globe, zeppelins, paper planes, jellyfish, a cube planet, a tumbling astronaut, a disco moon, a planet-sized donut, a train circling on a rail, a black hole, a tesseract and falling blocks. On top of that a sky full of colourful planets (ocean, fire, jungle, ice, earth, desert, crystal, candy, acid, gas and lava worlds, some with rings, moons and clouds), flying saucers with little green aliens and tractor beams, starships and fighter squadrons, and a floating city of the future with lit towers, glass domes and flying cars.
- Music: twelve electronic tracks made live in the browser, with intro, build-up, drop and break. They play one after another as a playlist in a random order (every visit starts with a different track) and keep going through menus, games and restarts. The mix opens up in flight and gets muffled after a crash or in the pause menu. The sound button (bottom right in the menus, at the top in flight) offers music + sounds, music only, sounds only or all off; M switches the music. Volumes in Settings.
- Sound design: no engine drone, just soft air that rises with your speed, a whoosh when you boost, different sounds for turning left, right, climbing and diving, deep punchy shots, and a splash in waterfalls.
- Start: a big yellow play button first (its tap lets the browser play music from the very first frame). Then the intro on a yellow sky: the four ships rush at you, roll, fire and draw long walls of light that fade out, the round logo flies at you in 3D, and the title builds itself from flying letters: iam in yellow with a black outline, Space outlined, Pilot in navy, the round logo at the end. The title stays until you tap or press a key. Behind every menu ships fly stunts (loops, barrel rolls, S-curves), often straight at you, firing, with long fading walls. The start screen is 30% see-through and the level worlds shine through.
- Under every menu: a red bar ("You want to fly in REAL: Contact me ...") that stays at the bottom edge, and below it the Impressum, the privacy and terms page, the websites www.Andreas-Schmoelzer.at and www.pilotFilm.at with their logos, and the portrait.
- Camera views: the eye button (or V) switches between eight views: behind the ship, far away, cockpit, rear three-quarter, front, top, below and a clean view that only keeps pause and the controls. Every round starts behind the ship. The cockpit has no frame, just a hint of glass and a dashboard with three screens: speed, boost, hull and gun on the left, the radar in the middle, score, pilots, time, special ability and bonus on the right (on phones the two data screens float on the glass in the upper corners, away from the thumbs).
- Zoom and look around: two fingers pinch to zoom and drag to turn the camera around the ship (in the cockpit: look around), a quick two-finger tap puts it back. Mouse wheel and right mouse button on a computer, right stick on a gamepad.
- Phones and tablets: a double tap or a pinch never zooms the page. On iPhones the sound also plays with the silent switch on and comes back after a call or another app.
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
| Camera view                 | V or the eye button   | Back          | Eye button                   |
| Zoom, look around           | Wheel, right mouse    | Right stick   | Two fingers: pinch, drag     |
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
src/core/     Simulation only, no graphics: flight model, walls, collisions, obstacles, bots, arena.
              Runs at a fixed 60 ticks per second and uses its own deterministic math,
              so every browser and a server compute exactly the same flight.
src/render/   three.js: sky, clouds, wonders, obstacles, light walls, ships, camera, effects.
src/ui/       Yellow menus, flight HUD with radar, touch controls, styles.
src/input/    Keyboard, gamepad and touch merged into one pilot input.
src/audio/    All sounds made live with the Web Audio API.
src/storage/  Callsign, settings, records and local highscores in this browser.
src/online/   Online match logic (independent of the network), LiveKit link, session.
src/net/      Calls to the leaderboard and game list.
server/       Leaderboard and game list logic, small Firestore and LiveKit REST clients.
netlify/functions/  The API endpoints.
tests/        Simulation, replay, leaderboard, online match, game list, shot, special and obstacle tests.
```

The deterministic core runs on the server too, which lets it check records by replaying recorded inputs.

## Roadmap

1. **Phase 1 (done):** solo flight, levels 1 and 2, bots, phone and PC controls, sound.
2. **Phase 2 (started):** online leaderboard with verified scores (done). Next: daily challenge, ghost runs, pilot code to use a callsign on several devices.
3. **Phase 3 (done):** online matches with up to 8 pilots, public or private, free-for-all or two teams.
4. **Phase 4 (done):** live voice radio (LiveKit) with push to talk and mute. Next: block and report.
5. **Phase 5:** shots (done), rank ladder up to Space Pilot.
