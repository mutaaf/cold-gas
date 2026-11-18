# COLD GAS: short-form clips

Made by `npm run clips` (scripts/clips.mjs, cut list and captions in store/clips/clips.json). Files land in
`dist-clips/` (gitignored): one MP4 per clip, `contact-sheet.png` (each clip's first frame) and `qa/` (0 s, 1 s,
middle and end of each clip with the app safe areas drawn on). `npm run clips -- --skip-capture` re-cuts from the
recorded takes after a caption or timing change; `--only=<id>` cuts one.

Every clip is the game's own **reference run** (the autopilot flying the same input log each time), so never post it
as "my run" or quote its score. The captions say what the car does, nothing more.

One master per clip serves TikTok, YouTube Shorts and Instagram Reels: 1080x1920, H.264 High, 30 fps, a silent AAC
track and no watermark. Upload the same file to each app. Never re-upload a file that another app has watermarked. Add a
sound in the app (a trending instrumental) because the clips are silent.

## Post first

1. **cg-show-roll**: the strongest hook (the car leaves the lip and rolls over the row within the first second),
   and the whole Show loop in 16 s.
2. **cg-show-landing**: the A/B partner. Same run, but the payoff shown first is the landing, with a question hook.
3. **cg-show-inverted**: the third hook (hanging upside down at the top of the wall).

After those three hooks, post the course variants: **cg-lineup** (barrel roll, with a slow replay at the end),
**cg-three-courses** (a fast montage) and **cg-wall**, which is the weakest. Its opening frame looks like cg-show-inverted's.

Post two or three days apart and compare 3-second hold and average watch time across the three hooks before making more
of the winner's kind.

## Suggested caption

> Ten cold gas thrusters, one roll, one landing. Free in your browser: mutaafaziz.com/coldgas

Per clip, swap the first sentence:

| Clip | First line |
| --- | --- |
| cg-show-roll | One roll over a row of parked cars. |
| cg-show-landing | Can you stick this landing? |
| cg-show-inverted | Up the wall, upside down, then let go. |
| cg-wall | The Wall: drive up it, hang on the curl, land on the pad. |
| cg-lineup | Barrel roll over the lineup. |
| cg-three-courses | Three courses. One car. |

## Hashtags (pick 3-5)

`#indiegame` `#browsergame` `#stuntgame` `#gamedev` `#webgl`
