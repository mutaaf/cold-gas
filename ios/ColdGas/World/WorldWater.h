// WATER's hook in the ground (0310's contract, docs/NATIVE-FREEDRIVE.md §9.5). OWNED BY WATER (0320): LANDSCAPE never edits it.
//
// The terrain's fragment shader calls `water_ground` after the land's material (and MATTER's marks) and before it's lit:
//   s       the surface so far: the seabed under a sea, a lake or a river, the shore above it
//   light   extra light on it, as a factor of the key's and the sky's (caustics focused on the bed): add to it
//   p       the point, render space; `anchored` the same in world-anchored metres (seamless when the origin moves)
//   land    the baked surface here (R rock, G snow, B wetness, A water depth / 16 m: > 0 under any water body)
//   owned   1 when a layer owns the sea (the terrain then draws the bed, not a flat water surface)
//   dr, f   the drive's uniform (time in dr.params.y) and the frame (the look in f.style.x)
// Lighting runs after, so every look takes it.
//
// What the water leaves on the land (moved here from 0320's own terrain edit):
//   seabed  under any water body: caustics, the swell's light focused on the bottom (a moving web, strongest in the shallows,
//           gone by ≈ 8 m and with distance so it never shimmers), hard pixels in 8-bit and flat shapes in Anime.
//   swash   the shore's wet band (the bake's wetness at its edge): the line the water washes up to moves over ≈ 9 s, so the
//           beach breathes; under it the sand is darker and glossy (wet sand is ≈ half as bright and shines).
#pragma once
#include "WorldShading.h"
#include "Water.h"

static inline void water_ground(thread WSurf& s, thread float& light, float3 p, float2 anchored, float4 land, float owned,
                                constant WDrive& dr, constant WFrame& f) {
    if (owned < 0.5) return;   // the terrain draws a flat sea itself; nothing of ours under it
    float t = dr.params.y, style = f.style.x;
    float depth = land.a * 16.0;
    float dist = distance(p, f.eye.xyz);
    if (depth > 0.0) {
        // Caustics: bright in the shallows, gone by ≈ 8 m and with distance (they'd shimmer).
        float ck = (1.0 - smoothstep(0.5, 8.0, depth)) * (1.0 - smoothstep(40.0, 160.0, dist));
        if (ck <= 0.0) return;
        float c = water_caustics(anchored, t);
        if (style > 1.5) c = step(0.55, c);                    // 8-bit: hard pixels of light
        else if (style > 0.5) c = smoothstep(0.35, 0.45, c);   // Anime: flat shapes
        light += c * ck * 0.6;
        return;
    }
    // The swash on the shore: the bake's wetness is 1 at the water's edge and fades up the beach; the wash runs up and back
    // over the top of that band, a little further where the noise says the beach is flatter.
    float wet = land.b;
    if (wet < 0.4 || dist > 220.0) return;
    float swash = 0.55 + 0.3 * sin(t * 0.7 + water_noise(anchored / 40.0) * 6.0);
    float k = smoothstep(swash, swash + 0.2, wet) * (1.0 - smoothstep(120.0, 220.0, dist));
    s.albedo *= mix(1.0, style > 0.5 ? 0.7 : 0.6, k);
    s.rough = mix(s.rough, 0.15, k);
}
