# 0240 · before and after

Recorded on the iPhone simulator (iOS 27, Debug build) from the master bus: `before-*` is main at ca82030 (the 1.1 sound,
tapped at its one source node), `after-*` is this change (tapped after the limiter). Same launch flags both times; the
Mac's speakers were muted while recording. AAC 96 kb/s. The `*-spectra.png` files stack before (top) over after
(bottom), log frequency.

| file | flags | what to listen for |
|---|---|---|
| `*-drive.m4a` (20 s) | `-freedrive -fd-pilot 30` | the motors' orders sweeping up with speed and the gear mesh beating against the slot order; the launch's wheelspin squeal on the set's concrete; slab joints; tyre roar and wind taking over at cruise; crickets, a breeze and the set's crowd behind you (the drive starts on the set, so no trees yet) |
| `*-stunt.m4a` (14 s) | `-play -autopilot -course show` | the countdown, the run-up on concrete, the jets' burst, hiss and valve tails, the airtime whoosh, a pass-by whoosh when it clears the parked row close, the touchdown and the set's crowd answering |
| `*-crash.m4a` (14 s) | `-play -course show -script crash-show-carry5` | the hits: the car's own crunch plus the struck car's shell ringing from where it was struck, debris after, the grind |
| `after-demo.m4a` (16 s) | `-sound bench` (offline, the scripted demo) | what the autopilot never does: gravel, grass, regen braking with ABS, a slide, then a cone, a fence bay, a guard rail and a car, each by its material |

Loudness (EBU R128, integrated): drive −23.5 → −21.1 LUFS, stunt −24.5 → −21.1, crash −24.1 → −19.7; true peaks stay
under −5 dBFS in play (the limiter holds −0.2 dBFS on the bench's pile-up).

CPU: the render callbacks measured in place with `mach_absolute_time` (`-sound-cpu`): 6.0–6.5 % of one core while
driving, flying and crashing on a simulator whose Mac was running a load average of several hundred (preemption counts
as busy time, so this is an upper bound). The whole graph rendered offline (`-sound bench`: bed, eight emitters,
environment node, reverb, EQ, limiter): 4.2 % of one core, callbacks 2.1 %. `make test`'s AudioTests render everything
at once (drivetrain, gravel, squeal, ABS, jets, grind, ambience, crowd, 40 one-shots) at 2.9 % of one Mac core.
