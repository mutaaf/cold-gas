// WATER's hook in the ground (0310 ships this default; docs/NATIVE-FREEDRIVE.md §9.5). OWNED BY WATER (#460, 0320) from here
// on: LANDSCAPE never edits it again.
//
// The terrain's fragment shader calls `water_ground` after the land's material (and MATTER's marks) and before it's lit:
//   s       the surface so far: the seabed under a sea, a lake or a river, the shore above it
//   light   extra light on it, as a factor of the key's and the sky's (caustics focused on the bed): add to it
//   p       the point, render space; `anchored` the same in world-anchored metres (seamless when the origin moves)
//   land    the baked surface here (R rock, G snow, B wetness, A water depth / 16 m: > 0 under any water body)
//   owned   1 when a layer owns the sea (the terrain then draws the bed, not a flat water surface)
//   dr, f   the drive's uniform (time in dr.params.y) and the frame (the look in f.style.x)
// Lighting runs after, so every look takes it.
#pragma once
#include "WorldShading.h"

static inline void water_ground(thread WSurf& s, thread float& light, float3 p, float2 anchored, float4 land, float owned,
                                constant WDrive& dr, constant WFrame& f) {
    (void)s; (void)light; (void)p; (void)anchored; (void)land; (void)owned; (void)dr; (void)f;
}
