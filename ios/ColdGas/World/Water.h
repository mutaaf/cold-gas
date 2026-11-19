// The water's shared helpers (0320): hashed noise and the caustics' web, for Water.metal's surface and WorldWater.h's mark on
// the ground (the seabed and the swash, called by World.metal's terrain through 0310's `water_ground` hook). No textures, a few
// dozen ALU ops; static functions under water_ names only (each .metal gets its own copy).
#pragma once
#include <metal_stdlib>
using namespace metal;

static inline float water_hash(float2 p) { p = fract(p * float2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
static inline float water_noise(float2 p) {
    float2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(water_hash(i), water_hash(i + float2(1, 0)), u.x), mix(water_hash(i + float2(0, 1)), water_hash(i + float2(1, 1)), u.x), u.y);
}
/// Caustics: three drifting sine lattices, rotated, folded into thin bright lines where they meet (a cheap stand-in for the
/// focused light under a rippled surface). 0…1.
static inline float water_caustics(float2 p, float t) {
    float c = 0.0;
    const float2x2 R = float2x2(0.8, -0.6, 0.6, 0.8);
    float2 q = p * 0.55;
    for (int i = 0; i < 3; i++) {
        q = R * q + float2(0.31 * t, -0.23 * t);
        c += abs(sin(q.x + sin(q.y * 1.3 + t * 0.7)) * cos(q.y - cos(q.x * 1.1 - t * 0.5)));
    }
    c /= 3.0;
    return pow(saturate(1.0 - c * 1.6), 6.0);
}
