---
id: 0146
title: npm run vectors writes the sim's golden traces the native port must match bit for bit
status: ready
priority: P1
size: M
lens: platform
created: 2026-11-04
pr:
by: operator
---

## Why
The native iPhone app (docs/NATIVE.md, the operator's parallel track) ports `src/sim` line for line to Swift. A
port is only as good as the proof it matches: kin's TS→C# port stays bit-exact because the TypeScript writes golden
fixtures its C# tests replay, and moon-club's `VectorTests` pin every Swift port of a web rule the same way. This is
the web half of that proof, and it runs in Node, so a cloud agent can build it.

## What
`scripts/vectors.mjs` (`npm run vectors`) flies a fixed set of input logs through `src/sim` in Node and writes
`ios/Packages/ColdGasCore/Tests/Vectors/`:
- `dmath.json`: 5,000 inputs per function (11 sets) (dsin, dcos, datan, datan2, dacos, dhypot, dexp, dlog) from a seeded
  integer walk (no Math.random): edge cases (±0, ±π/4 boundaries, NaN, ±Infinity, subnormals, 1e5) plus the range a
  stunt produces; outputs as hex bit patterns.
- `runs/<name>.json`: for each log (the reference flight per course and tier, the 32 naive players' Show logs,
  three crashes, a Pro spin fuzz, an Advanced valve log): `SIM_VERSION`, the course, the log, a per-tick fingerprint
  every 24 ticks (position, quaternion, linear and angular velocity, gas, phase, each wheel's contact) as hex bits,
  the final telemetry `t`, and `scoreRun`'s card.
- `manifest.json`: file list, `SIM_VERSION`, and a hash of each file.

The output is deterministic (same bytes on every run and machine). `npm run check` and `check:fast` run
`node scripts/vectors.mjs --check`, which regenerates in memory and fails if the checked-in files differ, so a sim
change that forgets the vectors goes red. Touches `scripts/`, `package.json`, `ios/Packages/ColdGasCore/Tests/Vectors/`
(new, generated) and AGENTS.md §5 (the command).

## Acceptance criteria
- [ ] `npm run vectors` writes the files above; running it twice produces identical bytes (`git diff --exit-code`).
- [ ] `node scripts/vectors.mjs --check` exits 0 on a clean tree and 1 (naming the file) after any edit to a vector
      or a one-ulp change to a spec number.
- [ ] Every run vector's final card equals `scoreRun` on the same log (asserted in a unit test).
- [ ] Total size of the vectors under 8 MB (gzip not required); generation under 60 s on CI.
- [ ] No change to `src/sim` behaviour: `node scripts/ref-hash.mjs` and `npm run determinism` unchanged.

## Test plan
`tests/unit/vectors.test.js`: generate the dmath set and two run vectors in memory, compare with the checked-in
files, and check the card equals `scoreRun`. `npm run check:fast` green.

## Out of scope
The Swift side (0147). Free Drive, Sandbox and rocket logs (v2).
