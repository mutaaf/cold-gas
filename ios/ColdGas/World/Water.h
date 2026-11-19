// The sea's mark on the land (0320): what World.metal's terrain asks of the water, in one call. Included by World.metal and
// Water.metal; no textures (the terrain's pipeline binds nothing new), a few dozen ALU ops on a pixel near the sea, none on
// one that isn't.
//   seabed    under the water: the sand and silt the sea lies on, with caustics (the swell's light focused on the bottom,
//             a moving web, strongest in the shallows and fading with depth); the water itself is Water.metal's surface,
//             drawn over it with its own colour and transmittance.
//   shore     the swash zone: sand the waves wash over darkened and glossy (wet sand is ≈ half as bright and shines), drying
//             up the beach; the line moves with a slow swash so the beach breathes.
#pragma once
#include <metal_stdlib>
using namespace metal;

constant float WATER_LEVEL = -2.0;      // ColdGasWorld SEA

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

struct WaterGround { float3 albedo; float gloss; float3 light; };
/// The ground at world `p` (anchored: render-space + anchor, so patterns survive the origin's moves; `y` the true height)
/// as the sea leaves it: the seabed's colour and caustic light, the wet shore. `under` is the vertex's flag (the tile marked
/// it under the sea), `dist` the eye's distance, `style` the look (0 Real, 1 Anime, 2 8-bit).
static inline WaterGround water_ground(float3 albedo, float2 anchored, float y, bool under, float dist, float t, float style) {
    WaterGround g; g.albedo = albedo; g.gloss = 0.0; g.light = float3(0.0);
    float depth = WATER_LEVEL - y;
    if (under || depth > -1.5) {
        // The swash: up and down the beach over ≈ 9 s, a little further up where the noise says the beach is flatter.
        float swash = 0.35 + 0.3 * sin(t * 0.7 + water_noise(anchored / 40.0) * 6.0);
        float wet = 1.0 - smoothstep(-0.15, swash + 0.6, -depth);
        if (under) {
            // Sea floor: sand in the shallows, silt and weed darker with depth.
            float3 sand = float3(0.30, 0.26, 0.19), silt = float3(0.09, 0.10, 0.08);
            float k = smoothstep(0.5, 9.0, depth);
            float3 bed = mix(sand, silt, k) * (0.85 + 0.3 * water_noise(anchored / 3.0));
            g.albedo = bed;
            // Caustics: bright in the shallows, gone by ≈ 8 m and with distance (they'd shimmer).
            float ck = (1.0 - smoothstep(0.5, 8.0, depth)) * (1.0 - smoothstep(40.0, 160.0, dist));
            if (ck > 0.0) {
                float c = water_caustics(anchored, t);
                if (style > 1.5) c = step(0.55, c);              // 8-bit: hard pixels of light
                else if (style > 0.5) c = smoothstep(0.35, 0.45, c);   // Anime: flat shapes
                g.light = float3(0.55, 0.75, 0.8) * c * ck * 0.6;
            }
        } else if (wet > 0.0) {
            // Wet sand: half as bright, glossy (a film of water reflects the sky).
            g.albedo *= mix(1.0, style > 0.5 ? 0.6 : 0.5, wet);
            g.gloss = 0.55 * wet;
        }
    }
    return g;
}
