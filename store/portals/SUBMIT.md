# Submitting COLD GAS to CrazyGames, GameDistribution, itch.io and Newgrounds

Everything except the accounts and the submit button is ready. Plan on about 10 minutes per portal.

The portal builds are separate from the live game at mutaafaziz.com/coldgas, which they never change:

- They use relative paths.
- CrazyGames and GameDistribution load the portal's own SDK. itch.io and Newgrounds load no SDK and show no ads. None loads Marquee or Box Office.
- They make no calls to mutaafaziz.com. The itch.io and Newgrounds builds make no calls to any server at all.
- They have no iPhone beta links, no share button and no install prompt. CrazyGames and GameDistribution have no outbound links. itch.io and Newgrounds have exactly one, "More games at mutaafaziz.com" (see [The link back](#the-link-back)).

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

## itch.io and Newgrounds

Both builds are the same game as the CrazyGames build (local board, local judges' lines, no AI panel, Free Drive and the Sandbox), with three differences:

- **No ads and no SDK.** Nothing is loaded from any other server. Saves stay in the browser's localStorage. `portal-playtest.mjs` fails if the game asks any other server for anything.
- **One link back.** The title's fine print ends with "More games at mutaafaziz.com". It opens a new tab only when the player clicks it, and the game keeps running in its frame. The link carries `utm_source=itch.io` or `utm_source=newgrounds` with `utm_campaign=coldgas`, so Box Office on mutaafaziz.com can count the visits each portal sends.
- **Stricter gate.** The build fails if the link is missing, appears twice, or if mutaafaziz.com appears anywhere else.

### The link back

Rules read on 2026-11-18:

- **itch.io.** The HTML5 upload docs (https://itch.io/docs/creators/html5) set no rule on links or ads. The Quality Guidelines (https://itch.io/docs/creators/quality-guidelines) say: "We prefer to see projects that have no advertisements", and ask creators not to make players go through third-party links to get the game. Our build has no ads, the game is fully playable on itch.io, and the one link is optional.
- **Newgrounds.** Game Guidelines (https://www.newgrounds.com/wiki/help-information/terms-of-use/game-guidelines): "Your submission must not auto-redirect to a new site or open pop-ups", "Your game must not be shovelware made to serve ads or promote your site", and "It would be best if your game does not rely on any calls to third party servers. If you are using a third party API or anything that could be used to track a user, you must give notice". Our link never opens on its own. The game makes no calls to any server and tracks nothing. Newgrounds blocks automated readers, so this was read through the Wayback Machine's 2026-11-08 copy of the page.
- **Newgrounds and AI.** The same page says: "please do not share any games that were generated via an AI prompt", and "If you do utilize AI in any aspect of your game, please disclose what and how it was used in the author commentary." COLD GAS was built with AI coding help, so `store/portals/newgrounds/author-comments.txt` says how. Read it and correct anything that isn't right before you paste it. Newgrounds moderators decide these case by case.

### Build and check

```
npm run build:itch          # → dist-portals/cold-gas-itch.zip
npm run build:newgrounds    # → dist-portals/cold-gas-newgrounds.zip
node scripts/portal-playtest.mjs itch            # two runs, the board, then the link opens a new tab
node scripts/portal-playtest.mjs newgrounds
node scripts/portal-playtest.mjs itch --phone    # 390×844 touch
node scripts/portal-art.mjs --listings           # the cover, the Newgrounds icons and the screenshots (build itch first)
```

Last build: 80 files, 8.5 MB unzipped, about 4.1 MB zipped. Both sites take a zip with `index.html` at its root. itch.io allows up to 1,000 files and 500 MB. Newgrounds publishes no limit; if the form refuses the size, its wiki says to ask for a raise.

### itch.io: owner steps

1. **Sign up** at https://itch.io/register. Then open https://itch.io/game/new (Dashboard, Create new project).
2. **Title:** `COLD GAS`. **Project URL:** `cold-gas` is a good choice.
3. **Short description or tagline:** paste `store/portals/itch/tagline.txt`.
4. **Classification:** Games. **Kind of project:** HTML.
5. **Release status:** Released. **Pricing:** No payments (or "Donate" if you want a tip jar).
6. **Uploads:** upload `dist-portals/cold-gas-itch.zip` and tick **This file will be played in the browser**.
7. **Embed options:**
   - Embed in page, viewport **960 × 540**.
   - Tick **Mobile friendly**, orientation **Landscape**.
   - Leave **Click to Play** on (the default). The click lets the sound start.
   - Tick **Fullscreen button**.
   - Leave **SharedArrayBuffer support** off. The game doesn't need it.
8. **Description:** paste `store/portals/itch/description.txt`, then a "Controls" heading and `store/portals/itch/controls.txt`. You may add a last line, "More games at https://mutaafaziz.com".
9. **Genre:** Simulation. If you'd rather list it with driving games, use Racing.
10. **Tags (up to 10):** 3d, physics, driving, stunts, cars, singleplayer, score-attack, arcade, minimalist, gamepad
11. **AI generation disclosure:** if the form asks, say yes: code written with AI assistance. No AI-generated images, sound or text in the game.
12. **Cover image:** `store/portals/itch/cover-630x500.png`.
13. **Screenshots:** the four `store/portals/itch/screenshot-*.png`, in order. They are real frames of the reference jump with the game's interface on.
14. **Visibility:** Draft, then **View page** and play one run in the embed. Check the fine-print link opens a new tab. Then set it to **Public** and save.

### Newgrounds: owner steps

1. **Sign up** at https://www.newgrounds.com/passport (free).
2. **Start a project:** the upload arrow in the header, then Game.
3. **Upload** `dist-portals/cold-gas-newgrounds.zip`. If you see a 403 in the preview, the zip has its `index.html` in a folder: rebuild, don't re-zip by hand.
4. **File settings** (they appear after the upload): width **960**, height **540**. Tick **Touchscreen friendly**. Leave scrollbars off. If there is a fullscreen option, allow it.
5. **Title:** `COLD GAS`.
6. **Icon:** `store/portals/newgrounds/icon-1440x810.png`. Newgrounds publishes no icon size, but its game pages show icons at 16:9 (720 × 405 and 480 × 270). `icon-720x405.png` is there if the form wants it smaller. Its small icons crop the middle; the title sits in the middle.
7. **Description / short description:** paste the first paragraph of `store/portals/newgrounds/description.txt`.
8. **Author comments:** paste `store/portals/newgrounds/author-comments.txt`, after you've checked it. The "How AI was used" paragraph is what the Game Guidelines ask for.
9. **Instructions** (if the form has the field): the Controls part of `store/portals/newgrounds/description.txt`.
10. **Genre:** Racing, or Skill if Racing isn't offered.
11. **Tags (up to 4):** stunts, cars, physics, 3d
12. **Rating:** E (Everyone). There is no violence, language or adult content; the car can be damaged in a crash.
13. **API Tools / Medals / Scoreboards:** skip. The build doesn't use the Newgrounds API.
14. **Preview,** play one run, then **Publish.** New games go through a few days of judging by players, and Newgrounds allows two submissions a day.

### What else to decide

- **Newgrounds and AI.** Newgrounds can remove a game for AI use "at our discretion". The disclosure is honest and the art is not AI-made, but if you'd rather not take the chance, publish only on itch.io.
- **Newgrounds medals and scoreboards.** The Newgrounds API would add medals and an online board there. It's a client library and a server call (which their guidelines say to announce). It isn't in this build.
