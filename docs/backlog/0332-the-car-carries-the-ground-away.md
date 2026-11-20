---
id: 0332
title: The car carries the ground away: mud, dust and snow on the car, washed by water; roost by material
status: shipped
priority: P1
size: M
lens: authenticity
created: 2026-11-19
pr: 461
by: operator
---

## Why
A car driven through a field came out spotless, and what the wheels threw was the same grey puff on every ground.

## What
- `CarDirt` (pure): each wheel, the sills, nose, tail and body caked from each wheel's metres on its ground (more spinning),
  the colour of what was laid, packed snow; rinsed by wetness (mud slowly, dust fast, snow melts), dust shed at speed.
- Render/CarMatter.h: the coat drawn on the car's own materials from Frame.matter, a mask in the car's frame broken by
  body-fixed noise; matte (no clear coat), wet mud darker, wet paint darker and glossier. Real/Anime/8-bit treatments.
- Roost by kind: clods of mud (6 s), stones, cut grass, snow powder, on top of the dust and spray; the crash's particles and
  torn parts land on the world's ground instead of y = 0.
- `FreeDrive.wetSource`: WATER's car wetness (a ford soaks the car meanwhile).

## Acceptance criteria
- [x] 100 m of mud cakes the wheels and sills; a dirt road only dusts it; spinning throws more (MatterTests)
- [x] A ford takes most of the mud off in 10 s; the dry air almost none; snow melts in water (MatterTests)
- [x] Nothing that isn't a number changes the coat (MatterTests)
- [x] The coat drawn in the three looks (PR shots)

## Test plan
`make test` (MatterTests); the simulator's mud donut (`-fd-wet 0.85`) in each look.
