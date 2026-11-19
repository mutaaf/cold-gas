// MATTER's hook in the ground (0310 ships this default; docs/NATIVE-FREEDRIVE.md §9.5). OWNED BY MATTER from here on:
// LANDSCAPE never edits it again.
//
// The terrain's and the verges' fragment shaders call `matter_ground` after the land's material is chosen (albedo, normal,
// roughness, AO, from the baked surface) and before it's lit, with:
//   s      the surface so far (edit it: ruts darken and tilt the normal, mud lowers the roughness, a scuff bares the soil)
//   p      the point, render space (world − the floating origin)
//   trace  the trace texel here (WorldCache.traces: R rut depth 0 … 1 = 0 … 0.25 m, G disturbed, B mud / wet, A rubber),
//          0 where there's no trace slot
//   land   the baked surface here (R rock, G snow, B wetness, A water depth / 16 m)
//   dr     the drive's uniform (time, wind, the car on the ground)
// Lighting runs after, so every look (Real, Anime, 8-bit) takes whatever this does.
#pragma once
#include "WorldShading.h"

static inline void matter_ground(thread WSurf& s, float3 p, float4 trace, float4 land, constant WDrive& dr) {
    (void)s; (void)p; (void)trace; (void)land; (void)dr;
}
