// The ground's memory, read (0331, docs/NATIVE-MATTER.md §2): the terrain's fragment finds its tile's slot in the trace
// table, samples the rut, berm and pressed channels, and shades them into the land: the rut's walls lit by their slope (a
// normal from the height across a texel), the soil compressed darker in its floor, a wet sheen in mud, fresh soil on the
// berm, grass laid down paler and snow packed greyer. Not displaced: the terrain's near mesh is 4 m between vertices (the
// LANDSCAPE track's finer near field takes the height when it lands). Its three looks:
//   Real    soft, the slope's light and the soils' colours
//   Anime   the depth in two flat bands, an ink line round the rut's lip (where its wall is steep)
//   8-bit   nearest texels, the depth as one hard step: blocky tracks that the palette pass quantises with the land
// Included by World.metal after WFrame. Idle (no trace anywhere near): one branch on a uniform.
#pragma once
#include <metal_stdlib>
using namespace metal;

struct WTrace {
    int4 head;             // xy: the window's corner (tile index relative to the drawing origin's tile); z: live slots; w: window
    float4 scale;          // x: the tile (m); y: depth scale (m); z: berm scale (m); w: texels across
    ushort4 table[256];    // window × window entries (slot + 1, 0 none), four to an element
};

// GroundMatter's colours (Matter.swift), as the rut's compressed soil shows them (linear, the land's exposure).
static float3 trace_soil(uint tag) {
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

/// The trace at render-space p, worked into the land's albedo, normal and sheen. `dist`: from the eye.
static void world_trace(thread float3& albedo, thread float3& n, thread float& sheen, float3 p, float dist, float style,
                        constant WTrace& tr, texture2d_array<float> tex) {
    if (tr.head.z == 0 || dist > 170.0) return;
    float T = tr.scale.x;
    float2 tf = p.xz / T;
    int2 rel = int2(floor(tf)) - tr.head.xy;
    int W = tr.head.w;
    if (any(rel < 0) || any(rel >= W)) return;
    int idx = rel.y * W + rel.x;
    uint s = tr.table[idx >> 2][idx & 3];
    if (s == 0) return;
    uint layer = s - 1;
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
    float3 soil = trace_soil(tag);
    // The rut's floor: soil pressed darker (and wetter); its berm: fresh, a little lighter than the floor.
    float floorK = anime ? (depth > 0.05 ? (depth > 0.35 ? 0.85 : 0.55) : 0.0) : saturate(depth * 5.0);
    float3 a = mix(albedo, soil * 0.8, floorK * fade);
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
        n = normalize(n + float3(-slope.x, 0.0, -slope.y) * k * fade);
    }
    // Mud's floor holds water: a sheen the light catches.
    if (tag == 4) sheen = max(sheen, saturate(depth * 4.0) * 0.35 * fade);
    albedo = a;
}
