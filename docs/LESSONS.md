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
