// MATTER's hook in the ground (0310's contract, docs/NATIVE-FREEDRIVE.md §9.5). OWNED BY MATTER (0330): LANDSCAPE never edits it.
//
// The terrain's and the verges' fragment shaders call `matter_ground` after the land's material is chosen (albedo, normal,
// roughness, AO, from the baked surface) and before it's lit, with:
//   s      the surface so far (edit it: ruts darken and tilt the normal, mud lowers the roughness, a scuff bares the soil)
//   p      the point, render space (world − the floating origin)
//   trace  0310's per-leaf trace texel (WorldCache.traces); MATTER doesn't enable those slices (below), so it's 0
//   land   the baked surface here (R rock, G snow, B wetness, A water depth / 16 m)
//   dr, f  the drive's uniform and the frame (the look in f.style.x)
//   mt, mx MATTER's own trace atlas (0331): the window table round the eye (fragment buffer 9) and its layers (fragment
//          texture 9), bound by MatterLayer.bindGround (WorldView binds an empty table and a 1-texel array when there's none)
// Lighting runs after, so every look (Real, Anime, 8-bit) takes whatever this does.
//
// Why MATTER keeps its own atlas rather than 0310's slices: a slice is 512² over a 128 m leaf (25 cm a texel), and a tyre's
// track is 24 cm wide with its berm in the next 8 cm: one texel, the berm gone. The atlas is 256² over 16 m (6.25 cm a texel),
// kept where the tyres have pressed (48 layers, LRU, 12 MB), not everywhere within 260 m (16 MB), and its shading reads the
// neighbours for the rut walls' slope. The writer is the same render pass either way (Trace.metal: programmable blending on a
// phone, a max blend on the simulator, which can't read a render target in place).
//
// The ground's memory, read: the fragment finds its 16 m tile's layer in the table, samples the rut, berm and pressed channels
// (R depth × depthScale m, G berm × bermScale m, B pressed, A the matter's tag / 255), and shades them into the land: the rut's
// walls lit by their slope (a normal from the height across a texel), the soil compressed darker in its floor, a wet sheen in
// mud, fresh soil on the berm, grass laid down paler and snow packed greyer. Not displaced (the terrain's near mesh is 4 m
// between vertices: 0336). Its three looks:
//   Real    soft, the slope's light and the soils' colours
//   Anime   the depth in two flat bands, an ink line round the rut's lip (where its wall is steep)
//   8-bit   nearest texels, the depth as one hard step: blocky tracks that the palette pass quantises with the land
// Idle (no trace anywhere near): one branch on a uniform.
#pragma once
#include "WorldShading.h"

struct WTrace {
    int4 head;             // xy: the window's corner (tile index relative to the drawing origin's tile); z: live slots; w: window
    float4 scale;          // x: the tile (m); y: depth scale (m); z: berm scale (m); w: texels across
    ushort4 table[256];    // window × window entries (slot + 1, 0 none), four to an element
};

// GroundMatter's colours (Matter.swift), as the rut's compressed soil shows them (linear, the land's exposure).
static inline float3 matter_soil(uint tag) {
    switch (tag) {
        case 2: return float3(0.17, 0.16, 0.14);    // gravel
        case 3: return float3(0.16, 0.12, 0.085);   // dirt
        case 4: return float3(0.06, 0.042, 0.028);  // mud
        case 5: return float3(0.30, 0.25, 0.17);    // sand
        case 6: return float3(0.11, 0.09, 0.06);    // grass: the soil under the turf
        case 7: return float3(0.34, 0.40, 0.52);    // snow: packed, its shadow blue
        default: return float3(0.12, 0.10, 0.08);
    }
}

static inline void matter_ground(thread WSurf& s, float3 p, float4 trace, float4 land, constant WDrive& dr, constant WFrame& f,
                                 constant WTrace& tr, texture2d_array<float> tex) {
    (void)trace; (void)land; (void)dr;
    if (tr.head.z == 0) return;
    float dist = distance(p, f.eye.xyz);
    if (dist > 170.0) return;
    float T = tr.scale.x;
    float2 tf = p.xz / T;
    int2 rel = int2(floor(tf)) - tr.head.xy;
    int W = tr.head.w;
    if (any(rel < 0) || any(rel >= W)) return;
    int idx = rel.y * W + rel.x;
    uint sl = tr.table[idx >> 2][idx & 3];
    if (sl == 0) return;
    uint layer = sl - 1;
    float style = f.style.x;
    bool pixel = style > 1.5, anime = style > 0.5 && !pixel;
    constexpr sampler lin(coord::normalized, filter::linear, address::clamp_to_edge);
    constexpr sampler near(coord::normalized, filter::nearest, address::clamp_to_edge);
    float2 uv = fract(tf);
    float4 c = pixel ? tex.sample(near, uv, layer) : tex.sample(lin, uv, layer);
    if (c.a <= 0.0) return;
    float e = 1.0 / tr.scale.w, step = T * e;   // a texel, in uv and in metres
    float4 cx = pixel ? tex.sample(near, uv + float2(e, 0), layer) : tex.sample(lin, uv + float2(e, 0), layer);
    float4 cz = pixel ? tex.sample(near, uv + float2(0, e), layer) : tex.sample(lin, uv + float2(0, e), layer);
    float depth = c.r, berm = c.g, press = c.b;
    if (pixel) { depth = depth > 0.12 ? 0.6 : 0.0; berm = berm > 0.3 ? 0.6 : 0.0; press = press > 0.3 ? 1.0 : 0.0; }
    float h = berm * tr.scale.z - depth * tr.scale.y;
    float hx = cx.g * tr.scale.z - cx.r * tr.scale.y, hz = cz.g * tr.scale.z - cz.r * tr.scale.y;
    float2 slope = float2(hx - h, hz - h) / step;
    float fade = 1.0 - smoothstep(110.0, 170.0, dist);
    // The tag from the nearest texel (a blend of two tags is a third ground's colour), the blend's at the trace's very edge.
    uint tag = uint(tex.sample(near, uv, layer).a * 255.0 + 0.5);
    if (tag == 0) tag = uint(c.a * 255.0 + 0.5);
    float3 soil = matter_soil(tag);
    // The rut's floor: soil pressed darker (and wetter); its berm: fresh, a little lighter than the floor.
    float floorK = anime ? (depth > 0.05 ? (depth > 0.35 ? 0.85 : 0.55) : 0.0) : saturate(depth * 5.0);
    float3 a = mix(s.albedo, soil * 0.8, floorK * fade);
    a = mix(a, soil * 1.25, saturate(berm * 1.5) * 0.6 * fade);
    // Laid-down grass reflects paler and straw-ward; packed snow goes grey-blue.
    if (tag == 6) a = mix(a, a * float3(1.30, 1.25, 0.85), press * 0.7 * fade);
    if (tag == 7) a = mix(a, a * float3(0.82, 0.86, 0.95), press * 0.6 * fade);
    // The walls lit by their slope. Anime: an ink line where the wall is steep (the lip), not a gradient.
    if (anime) {
        float lip = smoothstep(0.35, 0.55, length(slope)) * fade;
        a = mix(a, float3(0.012, 0.010, 0.016), lip * 0.85);
    } else {
        float k = pixel ? 0.6 : 1.0;
        s.n = normalize(s.n + float3(-slope.x, 0.0, -slope.y) * k * fade);
    }
    // Mud's floor holds water: a sheen the light catches (the sky in it at a grazing look).
    if (tag == 4) {
        float sheen = saturate(depth * 4.0) * 0.35 * fade;
        s.rough = mix(s.rough, 0.2, sheen * 2.0);
        s.spec = max(s.spec, sheen);
    }
    // The rut's floor sits in the shade of its own walls.
    s.ao *= 1.0 - 0.25 * floorK * fade;
    s.albedo = a;
}
