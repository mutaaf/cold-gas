// The world's light, shared (0310, docs/NATIVE-FREEDRIVE.md §9.5): World.metal and any layer that draws in Free Drive's world
// (WATER's surface, MATTER's spray) include this, so everything in the frame is lit by one sun, one sky and one air, in all
// three looks. Static functions under world_ names only (each .metal gets its own copy).
//
// Cheap per pixel by design (#365's lesson on the open Duo: the main pass was ≈ 17 ms at half resolution with per-pixel noise):
//   - detail comes from textures (DetailTexture, and the tiles' baked surfaces), never value noise or fbm per pixel;
//   - the sky's ambient and the air are worked out per vertex and interpolated;
//   - the sky is reflected per pixel only where it shows (water, tar, a wet shore).
// The drawn looks (0290) go through the same lights, summed as irradiance, into the cel ramp (`world_cel`), and the air in
// four flat layers; 8-bit's palette, ink and pixels are the film pass's.
#pragma once
#include <metal_stdlib>
using namespace metal;
#include "../Render/Sky.h"

// The stage's frame and look (Renderer.FrameU / LookU), field for field.
struct WFrame {
    float4x4 viewProj, lightViewProj;
    float4 eye, keyDir, keyColor, fogColor, fogRange;
    float4x4 invViewProj;
    float4 proj, misc;
    float4 style, fx;    // the look (0280, 0290): x 0 Real, 1 Anime, 2 8-bit
    float4x4 worldShadowVP;   // 0310: the world's cached shadow (9.6), render space
    float4 worldShadow;       // x: 1 when it's drawn; y: its texel (1 / size)
};
struct WLook {
    float4 hemiSky, hemiGround, hazeCol, sunCol, sunDir, fogExp;
    float4 skyZenith, skyMid, skyHorizon, skySun, bloom;
    float4 atmo;   // the physical sky (0231): x on, y haze, z the eye's height (km), w night (0 … 1)
    float4 sunE;   // the sun's illuminance at the top of the air (rgb), time (s)
};
// What the world adds a frame: the headlamps, the props' range and the wind, the floating origin, the car on the ground.
struct WDrive {
    float4 lampPos;      // xyz; w intensity (0 off)
    float4 lampDir;      // xyz; w cos of the cone's edge
    float4 params;       // x: props' far distance (m), y: time, z: debug LOD colours, w: wind (0 … 1)
    float4 anchor;       // xy: the floating origin mod 4,096 m (world-anchored detail); z: the finest props' radius; w: quality (0 … 2)
    float4 carPos;       // xyz the car's centre on the ground (render space); w: 1 when it's on its wheels
    float4 carFwd;       // xy the car's heading on the ground (unit, x and z); z half its length, w half its width
};
// The land on the GPU this frame (WorldCache, §9.3).
struct WorldGPU {
    float4 leafOrigin;   // xy: leafIndex's corner (render space x, z); z: a leaf's size (m); w: the grid's cells a side
    float4 sea;          // x: the sea's level (render space y)
    float4 flags;        // x: a layer owns the sea; y: traces on; z: a trace slice's texels a side
    float4 spare;
};

constexpr sampler world_ds(coord::normalized, filter::linear, mip_filter::linear, address::repeat, max_anisotropy(2));
constexpr sampler world_cs(coord::normalized, filter::linear, address::clamp_to_edge);

// A hashed lattice (for vertex shaders and per-cell choices only; never a per-pixel noise).
static inline float world_hash(float2 p) { p = fract(p * float2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
static inline float world_noise(float2 p) {
    float2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(world_hash(i), world_hash(i + float2(1, 0)), u.x), mix(world_hash(i + float2(0, 1)), world_hash(i + float2(1, 1)), u.x), u.y);
}

// The key light's shadow: 2 × 2 taps, faded out toward the map's edge so where it ends isn't a line across the land.
static inline float world_shadowMap(float4 lc, depth2d<float> sm, float texel) {
    float3 p = lc.xyz / max(lc.w, 1e-6);
    float2 uv = float2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    if (any(uv < 0.0) || any(uv > 1.0) || p.z > 1.0) return 1.0;
    constexpr sampler cmp(coord::normalized, filter::linear, compare_func::less_equal, address::clamp_to_edge);
    float s = 0;
    for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) s += sm.sample_compare(cmp, uv + (float2(x, y) - 0.5) * texel, p.z - 0.0015);
    float2 e = abs(uv - 0.5) * 2.0;
    return mix(s * 0.25, 1.0, smoothstep(0.8, 1.0, max(e.x, e.y)));
}
// Both shadows: the car's own box (the renderer's, every frame) and the world's cached one (trees, rocks, the roadside).
static inline float world_shadow(float4 lc, float3 p, depth2d<float> sm, depth2d<float> wsm, constant WFrame& f) {
    float s = world_shadowMap(lc, sm, f.fogRange.w);
    if (f.worldShadow.x > 0.5) s = min(s, world_shadowMap(f.worldShadowVP * float4(p, 1), wsm, f.worldShadow.y));
    return s;
}
static inline float world_ggx(float nh, float a) { float a2 = max(a * a, 1e-4), d = nh * nh * (a2 - 1.0) + 1.0; return a2 / max(M_PI_F * d * d, 1e-6); }

// The car's occlusion of the ground round it (#365): its footprint as a soft rectangle, nothing once it's off the ground.
static inline float world_carAO(float3 p, constant WDrive& dr) {
    if (dr.carPos.w <= 0) return 1.0;
    float3 rel = p - dr.carPos.xyz;
    if (dot(rel, rel) > 36.0) return 1.0;
    float2 fw = dr.carFwd.xy, s = float2(fw.y, -fw.x);
    float2 q = float2(dot(rel.xz, s), dot(rel.xz, fw));
    float2 dd = abs(q) - float2(dr.carFwd.w, dr.carFwd.z) * 0.92;
    float outside = length(max(dd, 0.0)), inside = min(max(dd.x, dd.y), 0.0);
    float k = 1.0 - smoothstep(-0.9, 0.75, outside + inside);
    k *= 1.0 - smoothstep(0.3, 1.4, abs(rel.y));
    return 1.0 - 0.72 * k;
}

// Per vertex: the sky's light on a surface facing n, and the air between the eye and p (c · T + In). The physical sky's
// when it's on, else the painted dusk's hemisphere and haze.
struct WSky { float3 amb; float3 T; float3 In; };
static inline WSky world_vsky(float3 p, float3 n, constant WFrame& f, constant WLook& k, texture2d<float> V) {
    WSky o;
    float3 toP = p - f.eye.xyz;
    float dist = max(length(toP), 1e-3);
    float3 d = toP / dist;
    if (k.atmo.x > 0.5) {
        o.amb = sky_ambient(V, n, k.skySun.xyz, k.sunE.rgb, k.atmo.z);
        sky_aerialTI(V, d, dist, f.eye.y, k.skySun.xyz, k.atmo.z, k.atmo.y, o.T, o.In);
    } else {
        o.amb = mix(k.hemiGround.rgb, k.hemiSky.rgb, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
        float a = k.hazeCol.w;
        o.T = 1; o.In = 0;
        if (a > 0) {
            float b = k.sunCol.w, dens = a * exp(-b * f.eye.y), dy = d.y * b;
            float tau = abs(dy) > 1e-4 ? dens * (1.0 - exp(-clamp(dy * dist, -12.0, 12.0))) / dy : dens * dist;
            float fog = 1.0 - exp(-clamp(tau, 0.0, 12.0));
            float sun = pow(max(dot(d, k.sunDir.xyz), 0.0), 6.0);
            o.T = 1.0 - fog; o.In = (k.hazeCol.rgb + k.sunCol.rgb * sun) * fog;
        }
    }
    return o;
}
// The air over a lit colour. Real: c · T + In. The drawn looks: the same air in four flat layers (0290's hazedDrawn), its
// colour the light the air scatters in, so a cel landscape stacks into bands of distance.
static inline float3 world_air(float3 c, float3 T, float3 In, constant WFrame& f) {
    c = max(c, 0.0);
    if (f.style.x < 0.5) return c * T + In;
    float fog = clamp(1.0 - dot(T, float3(0.2126, 0.7152, 0.0722)), 0.0, 1.0) * 4.0;
    float w = f.style.x > 1.5 ? 1e-3 : clamp(fwidth(fog), 0.01, 0.5);
    float fl = floor(fog), q = (fl + smoothstep(1.0 - w, 1.0, fog - fl)) / 4.0;
    float3 airC = In / max(1.0 - T, float3(1e-3));
    return mix(c, airC, q);
}

// Anime and 8-bit (0290): Shaders.metal's celRamp under this file's names. T is the light on the surface as a factor of its
// albedo, before exposure; a band of the albedo comes back, tinted violet in the shade, the light's hue where it's lit.
static inline float3 world_cel(float3 base, float3 T, float exposure, bool pixel) {
    const float3 Y = float3(0.2126, 0.7152, 0.0722), SH = float3(0.70, 0.76, 1.45);
    float I = max(dot(T, Y) * exposure, 1e-6);
    float3 hue = T / max(dot(T, Y), 1e-6);
    hue = mix(float3(1.0), min(hue, float3(2.2)), 0.75);
    hue /= max(dot(hue, Y), 1e-3);
    float li = log2(I), w = pixel ? 1e-3 : clamp(fwidth(li) * 0.75, 0.02, 0.5);
    float b0 = smoothstep(-6.2 - w, -6.2 + w, li), b1 = smoothstep(-3.9 - w, -3.9 + w, li), b2 = smoothstep(-2.1 - w, -2.1 + w, li);
    float3 kk = mix(mix(mix(SH * 0.08, SH * 0.15, b0), mix(SH, hue, 0.55) * 0.36, b1), hue * 0.74, b2);
    return base * kk / max(exposure, 1e-4);
}

// A surface to light: its albedo and normal, then what it does with the light.
struct WSurf {
    float3 albedo; float3 n;
    float rough;   // 1 matte … 0.05 a mirror (GGX)
    float spec;    // a mirror's share of the sky (water ≈ 0.85; 0 none)
    float ao;      // ambient occlusion on the sky's light
    float wrap;    // light wrapped round a soft body (foliage)
    float trans;   // light through it from behind (leaves, blades)
};
static inline WSurf world_surf(float3 albedo, float3 n) { WSurf s; s.albedo = albedo; s.n = n; s.rough = 1.0; s.spec = 0.0; s.ao = 1.0; s.wrap = 0.0; s.trans = 0.0; return s; }

// The key light (both shadows), the sky's light (`amb`, interpolated per vertex), a dielectric's highlight, the sky in a
// mirror, the headlamps. The drawn looks: the same lights summed as irradiance, through the cel ramp; a mirror as a hard
// Fresnel step of the painted sky.
static inline float3 world_light(WSurf s, float3 p, float4 lightClip, float3 amb, constant WFrame& f, constant WLook& k,
                                 constant WDrive& dr, depth2d<float> shadow, texture2d<float> skyView, depth2d<float> wshadow) {
    float3 n = s.n, albedo = s.albedo;
    float3 l = normalize(f.keyDir.xyz + 1e-6);
    float ndl = dot(n, l);
    float nl = clamp((ndl + s.wrap) / (1.0 + s.wrap), 0.0, 1.0);
    float sh = (nl > 0 || s.trans > 0) && f.keyDir.w > 0.001 ? world_shadow(lightClip, p, shadow, wshadow, f) : 1.0;
    float3 E = f.keyColor.rgb * f.keyDir.w;
    float3 v = normalize(f.eye.xyz - p + 1e-6);
    // The headlamps: a soft cone with a hot spot, inverse-square, out to ≈ 140 m.
    float3 lamp = 0;
    if (dr.lampPos.w > 0) {
        float3 d = dr.lampPos.xyz - p;
        float dist = max(length(d), 0.5);
        float3 ld = d / dist;
        float cd = dot(-ld, dr.lampDir.xyz);
        float cone = smoothstep(dr.lampDir.w - 0.05, dr.lampDir.w + 0.06, cd); cone *= cone;
        float hot = smoothstep(dr.lampDir.w + 0.04, 0.995, cd);
        float att = (cone + 1.5 * hot) * dr.lampPos.w / (dist * dist + 25.0) * clamp(1.0 - pow(dist / 140.0, 4.0), 0.0, 1.0);
        lamp = clamp(dot(n, ld), 0.0, 1.0) * att * float3(1.0, 0.95, 0.86);
    }
    bool atmo = k.atmo.x > 0.5;
    if (f.style.x > 0.5) {   // the drawn looks (0290)
        float3 T = E * nl * smoothstep(0.4, 0.6, sh) / M_PI_F + amb * s.ao + lamp;
        if (s.trans > 0) T += E * s.trans * 0.4 * smoothstep(0.4, 0.6, sh) / M_PI_F;
        float3 c = world_cel(albedo, T, f.fogRange.z, f.style.x > 1.5);
        if (s.spec > 0) {   // water: the sky's colour, flat, by a hard Fresnel step
            float fr = step(0.72, 1.0 - clamp(dot(n, v), 0.0, 1.0));
            float3 sky = atmo ? sky_view(skyView, float3(0, 0.3, 0) + reflect(-v, n) * 0.7, k.skySun.xyz, k.atmo.z, 2.0) : mix(k.skyHorizon.rgb, k.skyMid.rgb, 0.5);
            c = mix(c, sky, fr * s.spec * 0.8);
        }
        return c;
    }
    float3 c = albedo * (E * sh * nl / M_PI_F + amb * s.ao + lamp);
    if (s.trans > 0) {   // leaves, needles and grass: a low sun through them, seen against it
        float back = clamp(dot(-v, l), 0.0, 1.0); back *= back; back *= back;
        c += albedo * E * sh * s.trans * (0.25 + 1.6 * back) * clamp(-ndl * 0.5 + 0.5, 0.0, 1.0) / M_PI_F;
    }
    float nv = clamp(dot(n, v), 1e-3, 1.0);
    if (s.rough < 0.99 && nl > 0) {   // GGX, Schlick, Smith
        float3 h = normalize(l + v);
        float nh = clamp(dot(n, h), 0.0, 1.0), vh = clamp(dot(v, h), 0.0, 1.0);
        float a = s.rough * s.rough, F = 0.04 + 0.96 * pow(1.0 - vh, 5.0);
        float kk = (s.rough + 1.0) * (s.rough + 1.0) / 8.0, G = (nl / (nl * (1.0 - kk) + kk)) * (nv / (nv * (1.0 - kk) + kk));
        c += E * sh * world_ggx(nh, a) * F * G / max(4.0 * nl * nv, 1e-3) * nl * (1.0 - 0.6 * s.rough);
    }
    if (s.spec > 0) {   // water: the sky by Fresnel
        float fr = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
        float3 r = reflect(-v, n);
        float3 sky = atmo ? sky_reflect(skyView, r, s.rough, k.skySun.xyz, k.sunE.rgb, k.atmo.z) : mix(k.skyHorizon.rgb, k.skyZenith.rgb, smoothstep(0.0, 0.5, r.y));
        c = mix(c, sky, fr * s.spec);
    } else if (atmo && s.rough < 0.6) {   // tar, a wet shore: a sheen of the sky at a grazing look
        float fr = pow(1.0 - nv, 5.0) * (1.0 - s.rough) * 0.6;
        if (fr > 0.01) c += sky_reflect(skyView, reflect(-v, n), s.rough, k.skySun.xyz, k.sunE.rgb, k.atmo.z) * fr * s.ao;
    }
    return c;
}

// --- The land near the eye, for layers (§9.3, 9.5) --------------------------------------------------------------------------
// leafIndex holds, for the 32 × 32 leaves round the eye, `surfaceSlot | (traceSlot + 1) << 16` (−1: none).
static inline int world_leafEntry(float2 xz, constant WorldGPU& g, texture2d<int> leafIndex, thread float2& uv) {
    float2 q = (xz - g.leafOrigin.xy) / g.leafOrigin.z;
    int2 c = int2(floor(q));
    uv = q - float2(c);
    if (any(c < 0) || any(c >= int(g.leafOrigin.w))) return -1;
    return leafIndex.read(uint2(c)).r;
}
/// The baked surface (R rock, G snow, B wetness, A water depth / 16 m) at a render-space point near the eye; 0 off the cache.
static inline float4 world_landAt(float2 xz, constant WorldGPU& g, texture2d<int> leafIndex, texture2d_array<float> surface) {
    float2 uv; int e = world_leafEntry(xz, g, leafIndex, uv);
    if (e < 0) return 0;
    return surface.sample(world_cs, uv, uint(e & 0xffff));
}
/// MATTER's trace (R rut depth, G disturbed, B mud, A rubber) at a render-space point; 0 where there's none.
static inline float4 world_traceAt(float2 xz, constant WorldGPU& g, texture2d<int> leafIndex, texture2d_array<float> traces) {
    if (g.flags.y < 0.5) return 0;
    float2 uv; int e = world_leafEntry(xz, g, leafIndex, uv);
    if (e < 0 || (e >> 16) <= 0) return 0;
    return traces.sample(world_cs, uv, uint((e >> 16) - 1));
}
