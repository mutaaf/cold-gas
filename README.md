# COLD GAS

**Ten thrusters. One roll. Stick the landing.**

Play: https://mutaafaziz.com/coldgas/

A keynote-minimal 3D stunt game inspired by the October 2026 roadster thruster-jump reveal. You
drive a roadster up a kicker and fire ten cold-gas nozzles to clear a row of parked EVs. Then
you roll it 360° in the air, retro-burn, and land on the mark. A three-judge panel scores the
jump: the numbers come from a deterministic scorer, and the commentary comes from Claude.

- **Physics.** A deterministic 6-DOF rigid body at 240 Hz with raycast suspension, tyre grip,
  ten nozzles, blowdown, and a flight computer (Assist or Pro).
- **Fair play.** The Worker re-simulates every submitted input log before it accepts a score.
- **Platforms.** Keyboard, gamepad and touch all work. No accounts, no trackers, no
  third-party hosts.

An independent fan game, not affiliated with any automaker. Built and maintained by AI agents
behind CI gates; see [AGENTS.md](AGENTS.md).

```
npm run up      # install + dev server
npm run check   # what CI runs
```
