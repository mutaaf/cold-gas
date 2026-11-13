# Submitting COLD GAS to CrazyGames and GameDistribution

Everything except the accounts and the submit button is ready. Plan on about 10 minutes per portal.

The portal builds are separate from the live game at mutaafaziz.com/coldgas, which they never change:

- They use relative paths.
- Each loads the portal's own SDK and no Marquee or Box Office.
- They make no calls to mutaafaziz.com.
- They have no outbound links, no iPhone beta links, no share button and no install prompt.

## What the portal builds can and can't do

| Feature | On a portal |
| --- | --- |
| The game, all three events, practice, ghost, medals, daily jump, Free Drive, Sandbox | Same as the web |
| Scores | Same scorer (`scoreRun`), computed on the device |
| The judges' words | The game's own local lines. The AI panel needs the Worker, which answers only mutaafaziz.com (no CORS). The receipt says "The AI panel is not in this version · local lines". |
| Board | This device's best jumps ("Saved on this device · #N today"). It is not the online board. |
| Sandbox side quests | The local quest generator (no AI call) |
| Share, challenge links, "Send it back" | Hidden: a link would point at the portal's file host |
| Bring-your-own AI key, the Judges chip | Hidden |
| Saves | CrazyGames: through its data module, so signed-in players keep progress across devices. GameDistribution: localStorage. |
| Ads | Only through the portal's SDK. A midgame ad shows when you leave a results sheet (Retry or Home). Never after a session's first run, and never more than once every 3 minutes (the SDKs enforce their own limits too). Never during a run. Rewarded ads are off. |
| Ad blocker | The game plays the same with the SDK blocked. There are no ads and nothing waits for them. |

## Build (run once per portal, from the repo root)

```
npm run build:crazygames          # → dist-portals/cold-gas-crazygames.zip
npm run build:gamedistribution    # → dist-portals/cold-gas-gamedistribution.zip (paste the game id first, below)
```

Each command builds the game, removes the files a portal mustn't ship and checks the result. It fails if it finds mutaafaziz.com, Marquee, Box Office, a root-absolute path or a service worker. Then it zips the game with `index.html` at the zip's root. Last build: 76 files, 8.4 MB unzipped, about 4.1 MB zipped.

To check a build before you upload it:

```
node scripts/portal-playtest.mjs crazygames            # plays two runs in a sandboxed iframe on another origin
node scripts/portal-playtest.mjs crazygames --blocked  # the same with the SDK blocked (an ad blocker)
node scripts/portal-playtest.mjs crazygames --phone    # 390×844 touch
```

## CrazyGames

1. **Sign up** at https://developer.crazygames.com/ as a developer.
2. **Create the game** at https://developer.crazygames.com/games (Submit a game). Choose **HTML5**.
3. **Upload** `dist-portals/cold-gas-crazygames.zip`.
4. **Preview it in the QA tool** in the Developer Portal. Its SDK shows stand-in ads there. Check three things:
   - "Gameplay start" appears when you press Jump.
   - "Gameplay stop" appears on the results.
   - A midgame request appears when you leave the second run's results with Home or Retry.
5. **Fill in the fields:**
   - **Name:** `COLD GAS`
   - **Description:** paste `store/portals/crazygames/description.txt`
   - **Controls:** paste `store/portals/crazygames/controls.txt`
   - **Category:** Driving. If Driving isn't listed, use Car.
   - **Tags:** 3D, Car, Stunt, Physics, Driving, Skill, Jumping. Pick whichever of these the form offers.
   - **Platforms:** Desktop and Mobile. The game supports keyboard, mouse, gamepad and touch, and lays itself out for phones.
   - **Orientation:** Both. If the form wants one, choose Landscape: desktop is landscape, and a phone can be held either way.
   - **Progress save:** ON (data module). The game saves through it.
   - **Account integration / user module:** No.
   - **Multiplayer:** No.
   - **Sitelock:** None.
   - **Privacy notice:** Not needed. The portal build collects no personal data, sends nothing to our server, and keeps initials on the device.
6. **Upload the covers** from `store/portals/crazygames/`:
   - `cover-landscape-1920x1080.png` (16:9)
   - `cover-portrait-800x1200.png` (2:3)
   - `cover-square-800x800.png` (1:1)

   They are real frames of the reference jump with only the title on them, as the cover rules ask.
7. **Upload the videos** from `store/portals/crazygames/`. CrazyGames requires both:
   - `video-landscape-1920x1080.mp4`
   - `video-portrait-1080x1620.mp4`

   Each runs 17.6 s at real speed, has no audio, and opens on the cover. Each is real footage of the reference jump with the HUD visible.
8. **Submit.** The game goes to Basic Launch first, where CrazyGames turns ads off and the game runs without them. The SDK is already integrated, as Full Launch requires: gameplay and loading events, midgame ads, the data module, system info for the device, and the mute setting.

## GameDistribution

1. **Sign up** at https://gamedistribution.com/ as a developer. The dashboard is at https://developer.gamedistribution.com/.
2. **Create the game** in the dashboard (Upload / Add game). Copy its **Game ID** (the hash).
3. **Add the id to the build.** Open `src/portal/config.js` and replace `'PASTE-GAMEDISTRIBUTION-GAME-ID'` on the line `export const GD_GAME_ID = ...` with the id in quotes. Then run `npm run build:gamedistribution`. The build warns if the id is still the placeholder. Without the id the game runs but shows no ads, because the SDK isn't loaded. To try an id without editing the file, use `CG_GD_GAME_ID=<id> npm run build:gamedistribution`. Commit the id afterwards so later builds keep it.
4. **Upload** `dist-portals/cold-gas-gamedistribution.zip`.
5. **Fill in the fields:**
   - **Title:** `COLD GAS`
   - **Description:** paste `store/portals/gamedistribution/description.txt`
   - **Instructions:** paste `store/portals/gamedistribution/instructions.txt`
   - **Category:** Racing, or whichever driving category the form offers.
   - **Tags:** 3d, car, stunt, physics, driving, skill
   - **Mobile:** yes, both orientations. If the form wants one, choose Landscape.
   - **Language:** English
   - **Rewarded ads:** leave it OFF. The game doesn't use them.
6. **Upload the images** from `store/portals/gamedistribution/`: `image-1280x720.png`, `image-1280x550.png`, `image-512x512.png`, `image-512x384.png` and `image-512x340.png`.

   GameDistribution doesn't publish these sizes. They come from its asset template. If the form asks for another size, run `node scripts/portal-art.mjs --covers`. It writes from the same frames, and you can add a size in that script's GameDistribution list.
7. **Activate the SDK** (GameDistribution's wiki, SDK Implementation, "Activate the SDK"):
   - In the upload view, open the game in its iframe. A debug bar shows above it.
   - Request an ad from the debug bar and watch it to the end. If the bar isn't there, open the browser console in the game's frame and run `gdsdk.openConsole()`.
   - The flag can take up to two weeks.
8. **Request publishing** from the dashboard.

## Decisions for you

- **Online board and AI judges on the portals.** These would need CORS on the frozen Worker for the portals' origins, and the Worker's free-plan limits would then cover portal traffic. Today the portals get local lines and a board for this device only. To change that, the Worker needs CORS for those origins, and the portal build needs the absolute API address in place of `src/portal/offline.js`.
- **A pre-roll on GameDistribution.** GameDistribution's wiki calls a pre-roll on the Play button "best practice". The game doesn't show one, because the house rule is no ad before the first run. Adding one would be a small change in `src/portal/ads.js`.
- **Rewarded ads.** These are off (`REWARDED_REROLL` in `src/portal/config.js`). On the web, the reward is new words from the AI panel. The local lines are the same for the same run, so the reward would change nothing.
