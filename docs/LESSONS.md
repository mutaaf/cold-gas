# Lessons

Mistakes already paid for. Read before working.

- **Loft winding.** `loft()` in src/render/cars.js must wind (a, b, c) so normals face out; inverted winding back-face-culls every body and lights the inside of the far wall (looked like black slabs).
- **No MSAA HalfFloat render target.** A multisampled HalfFloat composer target rendered pure black on some GPU paths; we use SMAA after the OutputPass instead.
- **Grounded attitude jets.** The flight computer must not fire on the wheels, or it damps suspension bounce with air and sheds mist on the start line.
- **Level-controller signs.** World-up in body frame: roll correction is `-u.x`, pitch correction is `+u.z`. Both were once flipped and the car tipped itself over on landing.
- **Free air without thrusters.** A tall kicker let a fast car clear the lineup with no thrust at all; the ramp is 1.2 m and no-trick jumps are capped.
- **aurora-field `fromText` threshold is 0–1.** Passing 128 matched no pixels and threw, which stalled the theatre. Every visual step is now wrapped in `safe()`, and a hard deadline guarantees the words land.
- **Fast models outrun the show.** The edge model can finish before the theatre reaches COMPUTE, so tokens are queued and played through COMPUTE at their recorded pace. The counters keep the real timings.
- **Gemma 4 on Workers AI thinks by default.** Without `chat_template_kwargs: { enable_thinking: false }` it spends 800 tokens reasoning and returns no answer within 400.
- **Local e2e in the cloud sandbox (2026-10-20).** `@playwright/test` 1.64 looks for `chromium_headless_shell-1248`, but the sandbox ships `/opt/pw-browsers/chromium-1194`. Don't `playwright install`; run e2e through a throwaway, uncommitted config that spreads `playwright.config.js` and sets `use.launchOptions.executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`. The full suite then runs locally in about a minute.
- **Engines disagree on transcendental functions.** The same input log scored 77.3 in Node, 76.0 in workerd and 71.3 in production, because Math.sin/atan2/hypot aren't required to be bit-identical and the physics amplified the difference. The fix is `src/sim/dmath.js` (fdlibm kernels using only +, −, ×, ÷ and √). Node, Chromium, WebKit and workerd are now bit-identical.
