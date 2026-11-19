// Free Drive's water in Metal (0320, docs/NATIVE-FREEDRIVE.md "Water"). Four programs:
//   waves    a compute pass: two cascades of Gerstner waves (ColdGasWorld Waves: the same numbers the physics floats the car
//            on) baked into one period each, 256², at a capped rate (60 Hz Real, 24 Anime "on twos", 10 8-bit "tiles"): the
//            displacement (xyz) and Jacobian (w), and the slopes with their second moment (the mips average them: a far
//            pixel's normal is the mean slope and its spread is roughness, LEAN-style, so the far sea doesn't sparkle or go
//            to glass). The fragment never sums waves; it reads three texels.
//   surface  one draw for all the water in view: a polar grid round the camera (fine underfoot, kilometres apart at the
//            horizon), each vertex at its water body's level from the maps (the sea, a lake, a river's slope: 0310's
//            FreeWorld.water), displaced by the cascades (the swell only on the open sea) and calmed toward the shore by the
//            depth. A world layer (0310, §9.4): drawn after the sky with the world's frame, look, drive and sky bound, and
//            seen through the world's own air (WorldShading.h world_vsky / world_air) in every look. Shaded by look:
//              Real   Fresnel (Schlick, F0 0.02) between the reflection (the dusk sky, the land's skyline mirrored from the
//                     horizon row, the moon's glint, the headlamps) and the body of the water (Beer–Lambert through the
//                     path to the bed, sea water's absorption, in-scatter lit by the sky); whitecaps from the swell's
//                     Jacobian, a foam line on every shore, the haze.
//              Anime  flat cel water: three depth bands, a hard Fresnel band of the sky, bold star glints, foam as solid
//                     shapes with an ink line round them.
//              8-bit  palette water: banded depth, a reflection in two bands, animated sparkle tiles stepped four frames a
//                     second, solid foam pixels on the shore.
//   wake     the car's trail on the water: a ribbon of segments that spreads and fades over ≈ 8 s.
//   spray    droplets: thrown by a splash, the bow, the tyres, dripping off a wet car; streaked by their speed.
#include <metal_stdlib>
#include "WorldShading.h"
#include "Water.h"
using namespace metal;

// The world's frame, look and drive (WorldShading.h, §9.4's fixed bindings 1, 4, 5).
typedef WFrame WaFrame;
typedef WLook WaLook;
typedef WDrive WaDrive;
// WaterView.WaterU.
struct WaterU {
    float4 grid;      // x rings, y segments, z growth, w scale (m): ring i at scale·(growthⁱ − 1)
    float4 centre;    // xz the grid's centre (render space), y the still level (render space), w time (s)
    float4 nearMap;   // x0, z0 (render space), 1 / span, 1 if valid
    float4 midMap;
    float4 farMap;
    float4 cascades;  // x 1/swell L, y 1/chop L, z the surface's reach (m), w the calm depth (m)
    float4 anchor;    // xy the origin mod 4,096 m (world-anchored patterns), z look (0 Real, 1 Anime, 2 8-bit), w exposure
    float4 sky;       // x the horizon row's bearings (count), y wind dir (rad), zw spare
    float4 refs;      // the near, mid and far maps' reference levels (render space): each texel's level is stored against it
};
struct WaveGPU { float4 k; float4 p; };   // kx kz amp omega; phase q cascade 0

constant float WATER_ABSORB_R = 0.38, WATER_ABSORB_G = 0.075, WATER_ABSORB_B = 0.05;   // per m: coastal sea water (ESTIMATE)

// --- Waves (compute) ---------------------------------------------------------------------------------------------------
kernel void cg_water_waves(uint3 gid [[thread_position_in_grid]],
                           texture2d_array<half, access::write> disp [[texture(0)]],
                           texture2d_array<half, access::write> slope [[texture(1)]],
                           constant WaveGPU* waves [[buffer(0)]],
                           constant float4& u [[buffer(1)]]) {   // x time, y swell L, z chop L, w waves per cascade
    uint n = disp.get_width();
    if (gid.x >= n || gid.y >= n) return;
    uint c = gid.z;
    float L = c == 0 ? u.y : u.z;
    float2 p = (float2(gid.xy) + 0.5) / float(n) * L;
    float t = u.x;
    float3 D = 0;
    float sx = 0, sz = 0, jxx = 0, jzz = 0, jxz = 0;
    uint count = uint(u.w);
    for (uint i = 0; i < count; i++) {
        WaveGPU w = waves[c * count + i];
        float2 k = w.k.xy;
        float kl = max(length(k), 1e-5), A = w.k.z, q = w.p.y;
        float th = dot(k, p) - w.k.w * t + w.p.x;
        float s = sin(th), co = cos(th);
        D.x += -q * A * k.x / kl * s;
        D.z += -q * A * k.y / kl * s;
        D.y += A * co;
        sx += -A * k.x * s; sz += -A * k.y * s;
        float qa = q * A / kl * co;
        jxx += qa * k.x * k.x; jzz += qa * k.y * k.y; jxz += qa * k.x * k.y;
    }
    float ax = 1.0 - jxx, az = 1.0 - jzz;
    float J = ax * az - jxz * jxz;
    float2 s2 = float2(sx / max(ax, 0.2), sz / max(az, 0.2));
    disp.write(half4(half3(D), half(J)), gid.xy, c);
    slope.write(half4(half2(s2), half(dot(s2, s2)), half(J)), gid.xy, c);
}

// --- The surface -------------------------------------------------------------------------------------------------------
constexpr sampler waveS(coord::normalized, filter::linear, mip_filter::linear, address::repeat, max_anisotropy(4));
constexpr sampler mapS(coord::normalized, filter::linear, address::clamp_to_edge);

/// The water at render-space xz from the finest map that holds it: x the ground above its body's still level (− the depth),
/// y that level (render space), z the open sea's share (1 the swell runs, 0 a lake or a river). Deep open sea past them.
static float3 water_at(float2 xz, constant WaterU& u, texture2d<float> nearM, texture2d<float> midM, texture2d<float> farM) {
    float4 maps[3] = { u.nearMap, u.midMap, u.farMap };
    for (int i = 0; i < 3; i++) {
        float4 m = maps[i];
        if (m.w < 0.5) continue;
        float2 uv = (xz - m.xy) * m.z;
        if (any(uv < 0.004) || any(uv > 0.996)) continue;
        float4 t = i == 0 ? nearM.sample(mapS, uv, level(0)) : i == 1 ? midM.sample(mapS, uv, level(0)) : farM.sample(mapS, uv, level(0));
        return float3(t.r, u.refs[i] + t.g, t.b);
    }
    return float3(-60.0, u.centre.y, 1.0);
}

struct WaterOut {
    float4 clip [[position]];
    float3 world;     // render space, displaced
    float2 param;     // world-anchored xz before the Gerstner shift (the wave textures' coordinates)
    float bed;        // the ground above its water's still level under the vertex (m; − is water)
    float calm;
    float still;      // the body's still level here (render space)
    float3 amb;       // the sky's light on the water (WorldShading.h world_vsky)
    float3 airT, airIn;   // the air between the eye and it
};
vertex WaterOut cg_water_vertex(uint vid [[vertex_id]], constant WaFrame& f [[buffer(1)]], constant WaterU& u [[buffer(2)]],
                                constant WaLook& k [[buffer(4)]], texture2d<float> skyView [[texture(8)]],
                                texture2d_array<float> disp [[texture(0)]],
                                texture2d<float> nearM [[texture(2)]], texture2d<float> midM [[texture(15)]], texture2d<float> farM [[texture(16)]]) {
    const uint2 corner[6] = { uint2(0, 0), uint2(1, 0), uint2(1, 1), uint2(0, 0), uint2(1, 1), uint2(0, 1) };
    uint S = uint(u.grid.y);
    uint quad = vid / 6, ring = quad / S + corner[vid % 6].x, seg = quad % S + corner[vid % 6].y;
    float r = u.grid.w * (pow(u.grid.z, float(ring)) - 1.0);
    float a = float(seg % S) / float(S) * 2.0 * M_PI_F;
    float2 xz = u.centre.xz + r * float2(cos(a), sin(a));
    float3 wa = water_at(xz, u, nearM, midM, farM);
    float bed = wa.x;
    float calm = smoothstep(0.2, u.cascades.w, -bed);
    float2 anch = xz + u.anchor.xy;
    // Displacement fades out with distance (past ≈ 1 km the waves are the normals' alone) and toward the shore.
    float d = length(xz - f.eye.xz);
    float swellK = calm * wa.z * (1.0 - smoothstep(400.0, 1600.0, d)), chopK = calm * mix(0.4, 1.0, wa.z) * (1.0 - smoothstep(60.0, 260.0, d));
    float3 D = 0;
    if (swellK > 0) D += disp.sample(waveS, anch * u.cascades.x, 0, level(0)).xyz * swellK;
    if (chopK > 0) D += disp.sample(waveS, anch * u.cascades.y, 1, level(0)).xyz * chopK;
    float3 p = float3(xz.x + D.x, wa.y + D.y, xz.y + D.z);
    WaterOut o;
    o.world = p; o.param = anch; o.bed = bed; o.calm = calm; o.still = wa.y;
    WSky sk = world_vsky(p, float3(0, 1, 0), f, k, skyView);
    o.amb = sk.amb; o.airT = sk.T; o.airIn = sk.In;
    o.clip = f.viewProj * float4(p, 1);
    return o;
}

/// The sky in direction d: the physical sky's (0310, the hour's sun) when it's on, else the dusk (Shaders.metal
/// cg_sky_fragment's, without stars).
static float3 water_sky(float3 d, float rough, constant WaLook& k, texture2d<float> V) {
    if (k.atmo.x > 0.5) return sky_reflect(V, d, rough, k.skySun.xyz, k.sunE.rgb, k.atmo.z);
    float h = clamp(d.y, -1.0, 1.0);
    float3 sun = k.skySun.xyz;
    float3 c = mix(k.skyMid.rgb, k.skyZenith.rgb, smoothstep(0.02, 0.55, h));
    float band = exp(-max(h, 0.0) * 14.0);
    float3 flat = normalize(float3(d.x, 0.0, d.z) + float3(1e-5, 0.0, 0.0)), sunFlat = normalize(float3(sun.x, 0.0, sun.z) + 1e-5);
    float sunSide = pow(max(dot(flat, sunFlat), 0.0), 3.0);
    c = mix(c, k.skyHorizon.rgb, band * (0.35 + 0.65 * sunSide));
    c += k.skyHorizon.rgb * pow(max(dot(d, sun), 0.0), 220.0) * 1.4;
    return c;
}
/// film.js's haze along a ray (World.metal world_hazed): the air's colour toward d, and how much of the view it takes.
static float4 water_fog(float3 d, float L, float3 eye, constant WaLook& k) {
    float a = k.hazeCol.w;
    if (a <= 0) return float4(0);
    float b = k.sunCol.w, dens = a * exp(-b * eye.y), dy = d.y * b;
    float tau = abs(dy) > 1e-4 ? dens * (1.0 - exp(-clamp(dy * L, -12.0, 12.0))) / dy : dens * L;
    float fog = 1.0 - exp(-clamp(tau, 0.0, 12.0));
    float sun = pow(max(dot(d, k.sunDir.xyz), 0.0), 6.0);
    return float4(k.hazeCol.rgb + k.sunCol.rgb * sun, fog);
}
static float3 water_haze(float3 c, float3 d, float L, float3 eye, constant WaLook& k) {
    float4 g = water_fog(d, L, eye, k);
    return mix(c, g.rgb, g.a);
}
/// A premultiplied colour (c, a) seen through the world's air (WorldShading.h: the physical sky's aerial perspective, or the
/// painted dusk's haze; the drawn looks' flat bands): what the water sends is dimmed and the air's light added, and what it
/// lets through from behind is dimmed alike (the colour's transmittance as the alpha's share).
static float4 water_air(float3 c, float a, float3 T, float3 In, constant WaFrame& f) {
    float3 cc = world_air(c, T, In, f);
    float tl = clamp(dot(T, float3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    return float4(cc, 1.0 - (1.0 - a) * tl);
}
/// The land mirrored: below the skyline's elevation at this bearing the reflection is the far land (dark, hazed by its
/// distance), above it the sky. `soft` widens the edge (a rough far sea blurs it).
static float3 water_reflect(float3 r, float soft, constant WaLook& k, constant WaterU& u, texture2d<float> horizon, float3 eye, texture2d<float> V) {
    float3 sky = water_sky(r, soft, k, V);
    float az = atan2(r.z, r.x);
    float2 hz = horizon.sample(mapS, float2(fract(az / (2.0 * M_PI_F) + 1.0), 0.5)).rg;
    if (hz.x <= -0.99) return sky;
    float el = r.y / max(length(r.xz), 1e-4);
    float land = 1.0 - smoothstep(hz.x - soft, hz.x + soft, el);
    if (land <= 0) return sky;
    // The land under the hour's light: its albedo under the sky's fill (and the sun on it by day), through the air to it.
    float3 col = float3(0.06, 0.07, 0.05) * k.hemiSky.rgb * 1.4;
    if (k.atmo.x > 0.5) {
        float3 dir = normalize(float3(r.x, max(r.y, 0.0), r.z));
        float3 T, In;
        col = float3(0.06, 0.07, 0.05) * (sky_ambient(V, float3(0, 1, 0), k.skySun.xyz, k.sunE.rgb, k.atmo.z) + k.sunE.rgb * max(k.skySun.y, 0.0) * 0.3);
        sky_aerialTI(V, dir, hz.y, eye.y, k.skySun.xyz, k.atmo.z, k.atmo.y, T, In);
        col = col * T + In;
    } else {
        col = water_haze(col, normalize(float3(r.x, max(r.y, 0.0), r.z)), hz.y, eye, k);
    }
    return mix(sky, col, land);
}

struct WaterPix { float4 color [[color(0)]]; };
fragment WaterPix cg_water_fragment(WaterOut in [[stage_in]], constant WaFrame& f [[buffer(1)]], constant WaterU& u [[buffer(2)]],
                                    constant WaLook& k [[buffer(4)]], constant WaDrive& dr [[buffer(5)]],
                                    texture2d<float> skyView [[texture(8)]],
                                    texture2d_array<float> slope [[texture(1)]],
                                    texture2d<float> nearM [[texture(2)]], texture2d<float> midM [[texture(15)]], texture2d<float> farM [[texture(16)]],
                                    texture2d<float> horizon [[texture(17)]]) {
    float3 wa = water_at(in.world.xz, u, nearM, midM, farM);
    float bed = wa.x;
    if (bed > 0.8) discard_fragment();   // over land: the beach stands in front anyway
    // A coarse far triangle across two water bodies (a lake's shore and the sea's level beyond) is drawn only where it's at
    // the body's own level: the rest of it is over land.
    if (abs(in.still - wa.y) > 1.5) discard_fragment();
    float depth = max(-bed, 0.0);
    float3 toEye = f.eye.xyz - in.world;
    float dist = max(length(toEye), 1e-3);
    float3 v = toEye / dist;
    float style = u.anchor.z, t = u.centre.w;
    float calm = smoothstep(0.2, u.cascades.w, depth) * mix(0.35, 1.0, wa.z);   // a lake or a river: the chop alone
    // The slopes: the swell, the chop, and the chop again finer and turned (no visible repeat), each fading with distance by
    // its mips (LEAN: the mean slope and its second moment).
    float4 s1 = slope.sample(waveS, in.param * u.cascades.x, 0);
    float4 s2 = slope.sample(waveS, in.param * u.cascades.y, 1);
    const float2x2 R = float2x2(0.8, 0.6, -0.6, 0.8);
    float4 s3 = slope.sample(waveS, (R * in.param) * u.cascades.y * 2.71 + float2(0.37, 0.11) * t * 0.05, 1);
    float k1 = calm, k2 = mix(0.35, 1.0, calm);
    float2 sl = s1.xy * k1 + s2.xy * k2 + s3.xy * 0.45 * k2;
    float m2 = s1.z * k1 * k1 + s2.z * k2 * k2 + s3.z * 0.2 * k2 * k2;
    float variance = max(m2 - dot(sl, sl), 0.0) + 0.0004;
    float3 n = normalize(float3(-sl.x, 1.0, -sl.y));
    float J = s1.w * k1 + (1.0 - k1);   // the swell's pinch (whitecaps where its crests fold)
    float3 c;
    float alpha;
    // Shore foam: lines rolling in up the last ≈ 1.6 m of depth, broken by noise, and the swash's edge.
    float shore = 1.0 - smoothstep(0.0, 1.6, depth);
    float roll = sin(depth * 4.5 + t * 1.6 + water_noise(in.param / 9.0) * 5.0);
    float grain = water_noise(in.param * 0.9 + float2(t * 0.3, -t * 0.2));
    float foamShore = shore * smoothstep(0.35, 0.9, roll * 0.5 + 0.5 + grain * 0.6 - depth * 0.25) + smoothstep(0.08, 0.0, depth) * 0.9;
    float foamCap = smoothstep(0.45, 0.15, J) * smoothstep(0.4, 0.8, grain + 0.2) * calm;
    float foam = saturate(max(foamShore, foamCap));
    float cosV = clamp(dot(n, v), 0.0, 1.0);
    float3 l = normalize(f.keyDir.xyz + 1e-6);
    float3 hemi = k.atmo.x > 0.5 ? in.amb * 0.25 : k.hemiSky.rgb;
    if (style > 1.5) {
        // 8-bit: palette water. Depth in three bands, the sky in two, sparkle tiles stepped at 4 fps, solid foam pixels.
        float step4 = floor(t * 4.0);
        float2 tile = floor(in.param / 2.0);
        float ph = water_hash(tile + float2(step4 * 0.0, 0.0));
        float sparkle = step(0.93, fract(ph + step4 * 0.25)) * step(0.5, water_hash(tile * 1.7 + step4));
        float3 deep = float3(0.010, 0.022, 0.07), mid = float3(0.02, 0.07, 0.16), shallow = float3(0.05, 0.20, 0.28);
        float3 body = depth > 4.0 ? deep : depth > 1.2 ? mid : shallow;
        float fres = 1.0 - cosV;
        float3 skyB = fres > 0.82 ? k.skyHorizon.rgb * 0.8 : fres > 0.6 ? k.skyMid.rgb : body;
        c = fres > 0.6 ? skyB : body;
        c = mix(c, float3(0.55, 0.65, 0.8), sparkle * 0.9);
        c = mix(c, float3(0.75, 0.8, 0.85), step(0.5, foam));
        alpha = depth < 0.4 ? 0.6 : depth < 3.0 ? 0.8 : 1.0;   // the bed and a car in the shallows show through
        return { water_air(c * alpha, alpha, in.airT, in.airIn, f) };
    }
    if (style > 0.5) {
        // Anime: flat cel water. Depth in three bands, a hard Fresnel band of the sky, bold glints, inked foam.
        float3 deep = float3(0.008, 0.02, 0.06), mid = float3(0.012, 0.05, 0.10), shallow = float3(0.03, 0.13, 0.15);
        float b1 = smoothstep(0.9, 1.1, depth), b2 = smoothstep(3.8, 4.2, depth);
        float3 body = mix(mix(shallow, mid, b1), deep, b2);
        float3 sky = k.atmo.x > 0.5 ? sky_view(skyView, normalize(float3(0, 0.3, 0) + reflect(-v, n) * 0.7), k.skySun.xyz, k.atmo.z, 2.0) : mix(k.skyHorizon.rgb, k.skyMid.rgb, 0.45);
        float fr = smoothstep(0.78, 0.8, 1.0 - cosV);
        c = mix(body, sky, fr * 0.55);
        // Glints: the moon's highlight cut to a hard star where the slope faces it.
        float3 h = normalize(l + v);
        float spec = pow(max(dot(n, h), 0.0), 900.0);
        float star = step(0.45, spec) + step(0.985, water_hash(floor(in.param * 1.5) + floor(t * 6.0))) * step(0.15, pow(max(dot(n, h), 0.0), 60.0));
        c += float3(0.9, 0.92, 1.0) * saturate(star) * 0.6 * (1.0 - smoothstep(150.0, 600.0, dist));
        // Foam as solid shapes with an ink line round them.
        float fw = max(fwidth(foam), 1e-3) * 1.5;
        float solid = smoothstep(0.5 - fw, 0.5 + fw, foam);
        float ink = 1.0 - smoothstep(0.0, fw * 1.6, abs(foam - 0.42));
        c = mix(c, float3(0.6, 0.66, 0.74), solid);
        c = mix(c, float3(0.006, 0.008, 0.02), ink * 0.85 * (1.0 - smoothstep(80.0, 300.0, dist)));
        alpha = mix(smoothstep(0.0, 0.6, depth) * 0.85, 1.0, max(fr, solid));
        alpha = max(alpha, 0.5);
        return { water_air(c * alpha, alpha, in.airT, in.airIn, f) };
    }
    // Real. Fresnel (Schlick, F0 0.02), with the roughness from the slopes' spread.
    float F = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
    float3 r = reflect(-v, n);
    r.y = abs(r.y);   // a ray reflected under the surface (a steep wave's back face) reads the sky just above
    float3 refl = water_reflect(r, 0.01 + sqrt(variance) * 0.6, k, u, horizon, f.eye.xyz, skyView);
    // The moon's glint (the key light), a GGX lobe as rough as the slopes' spread.
    float3 h = normalize(l + v);
    float a2 = clamp(variance * 2.0, 0.0006, 0.4);
    float nh = max(dot(n, h), 0.0), dd = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / (M_PI_F * dd * dd);
    float3 glint = f.keyColor.rgb * f.keyDir.w * D * F * 0.25 * step(0.0, dot(n, l));
    // The headlamps' reflection: their own GGX highlight off each wave.
    if (dr.lampPos.w > 0) {
        float3 ld = dr.lampPos.xyz - in.world; float ldist = max(length(ld), 0.5); ld /= ldist;
        float cone = smoothstep(dr.lampDir.w - 0.05, dr.lampDir.w + 0.06, dot(-ld, dr.lampDir.xyz));
        float3 hl = normalize(ld + v); float nhl = max(dot(n, hl), 0.0), dl = nhl * nhl * (a2 - 1.0) + 1.0;
        glint += float3(1.0, 0.95, 0.86) * dr.lampPos.w * cone * (a2 / (M_PI_F * dl * dl)) * F * 0.02 / (ldist * ldist + 25.0) * clamp(1.0 - pow(ldist / 160.0, 4.0), 0.0, 1.0);
    }
    // The body of the water: what comes back out of it (in-scatter, lit by the sky and the moon) and what the bed sends
    // through it (transmittance along the refracted path: depth over the cosine of the refracted angle, n = 1.33).
    float cosT = sqrt(max(1.0 - (1.0 - cosV * cosV) / 1.77, 0.05));
    float path = depth / cosT + 0.2;
    float3 sigma = float3(WATER_ABSORB_R, WATER_ABSORB_G, WATER_ABSORB_B);
    float3 T = exp(-sigma * path);
    float3 scatter = float3(0.010, 0.045, 0.055) * (hemi * 6.0 + f.keyColor.rgb * f.keyDir.w * max(l.y, 0.0) * 0.35);
    float3 inner = scatter * (1.0 - T);
    // The bed shows through in proportion to its transmittance: alpha is what the water covers.
    float Tm = dot(T, float3(0.2, 0.6, 0.2));
    c = refl * F + inner * (1.0 - F) + glint;
    alpha = 1.0 - (1.0 - F) * Tm;
    // Foam: white water lit by the sky and the moon, opaque where it's thick.
    float3 foamC = float3(0.8, 0.85, 0.9) * (hemi * 2.2 + f.keyColor.rgb * f.keyDir.w * max(dot(n, l), 0.0) / M_PI_F);
    float fa = foam * (0.55 + 0.45 * grain);
    c = mix(c, foamC, fa); alpha = mix(alpha, 1.0, fa);
    // c is what the water sends (premultiplied: the bed's share comes through the blend, × (1 − alpha)). The air to it
    // closes the far sea into the sky at the horizon.
    return { water_air(c, alpha, in.airT, in.airIn, f) };
}

// --- The wake -------------------------------------------------------------------------------------------------------------
struct WakeGPU { float4 a; float4 b; };   // xz (render space), half-width, age (s); the next point the same
struct WakeOut { float4 clip [[position]]; float3 world; float2 uv; float k; float2 param; };
vertex WakeOut cg_wake_vertex(uint vid [[vertex_id]], uint iid [[instance_id]], constant WaFrame& f [[buffer(1)]], constant WaterU& u [[buffer(2)]],
                              constant WakeGPU* segs [[buffer(3)]], texture2d_array<float> disp [[texture(0)]],
                              texture2d<float> nearM [[texture(2)]], texture2d<float> midM [[texture(15)]], texture2d<float> farM [[texture(16)]]) {
    const float2 corner[6] = { {0, -1}, {1, -1}, {1, 1}, {0, -1}, {1, 1}, {0, 1} };
    WakeGPU s = segs[iid];
    float2 c = corner[vid];
    float4 P = mix(s.a, s.b, c.x);
    float2 dir = normalize(s.b.xy - s.a.xy + 1e-5), side = float2(-dir.y, dir.x);
    float2 xz = P.xy + side * c.y * P.z;
    float2 anch = xz + u.anchor.xy;
    float3 wa = water_at(xz, u, nearM, midM, farM);
    float calm = smoothstep(0.2, u.cascades.w, -wa.x);
    float3 D = disp.sample(waveS, anch * u.cascades.x, 0, level(0)).xyz * calm * wa.z + disp.sample(waveS, anch * u.cascades.y, 1, level(0)).xyz * calm;
    WakeOut o;
    o.world = float3(xz.x + D.x, wa.y + D.y + 0.03, xz.y + D.z);
    o.uv = float2(c.x, c.y);
    o.k = exp(-P.w / 6.0) * (P.w < 0 ? 0.0 : 1.0);
    o.param = anch;
    o.clip = f.viewProj * float4(o.world, 1);
    return o;
}
fragment float4 cg_wake_fragment(WakeOut in [[stage_in]], constant WaFrame& f [[buffer(1)]], constant WaterU& u [[buffer(2)]], constant WaLook& k [[buffer(4)]]) {
    // A V of churned water: strongest along its two arms and the propwash down the middle, broken up by noise.
    float a = abs(in.uv.y);
    float arms = smoothstep(0.55, 0.85, a) * (1.0 - smoothstep(0.92, 1.0, a));
    float core = 1.0 - smoothstep(0.0, 0.35, a);
    float t = u.centre.w;
    float n = water_noise(in.param * 1.3 + float2(t * 0.2, 0.0));
    float m = saturate(max(arms, core * 0.6) * (0.4 + 0.9 * n)) * in.k;
    float style = u.anchor.z;
    float3 c = float3(0.8, 0.85, 0.9) * (k.hemiSky.rgb * 2.2 + f.keyColor.rgb * f.keyDir.w * 0.1);
    if (style > 1.5) { m = step(0.35, m) * step(0.3, in.k); }
    else if (style > 0.5) {
        float fw = max(fwidth(m), 1e-3);
        float ink = 1.0 - smoothstep(0.0, fw * 1.5, abs(m - 0.3));
        c = mix(float3(0.6, 0.66, 0.74), float3(0.006, 0.008, 0.02), ink);
        m = max(smoothstep(0.35 - fw, 0.35 + fw, m), ink * 0.8);
    }
    float3 toEye = f.eye.xyz - in.world; float dist = length(toEye);
    c = water_haze(c, -toEye / max(dist, 1e-3), dist, f.eye.xyz, k);
    m *= 0.85;
    return float4(c * m, m);
}

// --- Spray ------------------------------------------------------------------------------------------------------------------
struct SprayGPU { float4 p; float4 v; };   // render-space position, size (m); velocity, alpha
struct SprayOut { float4 clip [[position]]; float2 uv; float a; float3 world; };
vertex SprayOut cg_spray_vertex(uint vid [[vertex_id]], uint iid [[instance_id]], constant WaFrame& f [[buffer(1)]], constant SprayGPU* drops [[buffer(3)]]) {
    const float2 corner[6] = { {-1, -1}, {1, -1}, {1, 1}, {-1, -1}, {1, 1}, {-1, 1} };
    SprayGPU d = drops[iid];
    float2 c = corner[vid];
    float3 p = d.p.xyz, toEye = normalize(f.eye.xyz - p);
    // A streak along the drop's speed (≈ its travel in a 120th of a second), the width its size.
    float3 vel = d.v.xyz;
    float sp = length(vel);
    float3 along = sp > 0.2 ? vel / sp : float3(0, 1, 0);
    float3 side = normalize(cross(along, toEye) + 1e-5);
    float len = d.p.w + sp * 0.012;
    float3 w = p + along * c.y * len + side * c.x * d.p.w;
    SprayOut o; o.clip = f.viewProj * float4(w, 1); o.uv = c; o.a = d.v.w; o.world = w;
    return o;
}
fragment float4 cg_spray_fragment(SprayOut in [[stage_in]], constant WaFrame& f [[buffer(1)]], constant WaLook& k [[buffer(4)]], constant WaterU& u [[buffer(2)]]) {
    float r = length(in.uv);
    float style = u.anchor.z;
    float a = style > 1.5 ? step(r, 0.8) : style > 0.5 ? smoothstep(1.0, 0.8, r) : (1.0 - smoothstep(0.2, 1.0, r));
    a *= in.a;
    if (a <= 0.003) discard_fragment();
    float3 c = float3(0.75, 0.82, 0.9) * (k.hemiSky.rgb * 2.6 + f.keyColor.rgb * f.keyDir.w * 0.12);
    float3 toEye = f.eye.xyz - in.world; float dist = length(toEye);
    c = water_haze(c, -toEye / max(dist, 1e-3), dist, f.eye.xyz, k);
    return float4(c * a, a);
}
