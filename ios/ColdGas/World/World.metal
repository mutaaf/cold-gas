// Free Drive's world in Metal (docs/NATIVE-FREEDRIVE.md §4.3): the CDLOD terrain with its geomorph, the road ribbons and
// the instanced props, all drawn camera-relative (positions arrive as `piece − origin`, so a tile 40 km out is as precise
// as one at the centre). Lit like the stage (the key light and its shadow, then either 0226's painted dusk or, since 0231,
// the physical sky of Sky.h: its ambient, its reflections and its aerial perspective), plus the car's headlamps.
// Cheap per pixel by design (0231, after the open Duo's bench: the main pass was ≈ 17 ms at half resolution):
//   - the surfaces' detail is a few taps of DetailTexture (our own baked noise, world-anchored, its mips the distance fade),
//     never value noise, fbm or Worley cells per pixel;
//   - the sky's ambient and the aerial perspective are worked out per vertex and interpolated;
//   - the sky is reflected per pixel only where it shows (water, tar, paint).
#include <metal_stdlib>
using namespace metal;
#include "../Render/Sky.h"

// The stage's frame and look (Renderer.FrameU / LookU), field for field.
struct WFrame {
    float4x4 viewProj, lightViewProj;
    float4 eye, keyDir, keyColor, fogColor, fogRange;
    float4x4 invViewProj;
    float4 proj, misc;
};
struct WLook {
    float4 hemiSky, hemiGround, hazeCol, sunCol, sunDir, fogExp;
    float4 skyZenith, skyMid, skyHorizon, skySun, bloom;
    float4 atmo, sunE;   // the physical sky (0231, Sky.h)
};
// What the world adds a frame: the headlamps (position, direction, intensity), the props' fade, and the car (0231: its
// footprint darkens the ground under it, the ambient occlusion a body that low makes).
struct WDrive {
    float4 lampPos;      // xyz; w intensity (0 off)
    float4 lampDir;      // xyz; w cos of the cone's edge
    float4 params;       // x: props' far distance (m), y: time, z: debug LOD colours, w: wind (0…1)
    float4 anchor;       // xy: the floating origin mod 4,096 m (world-anchored detail); z: the near pool's radius; w: quality
    float4 carPos;       // xyz the car's centre on the ground (render space); w: 1 when it's on its wheels
    float4 carFwd;       // xy the car's heading on the ground (unit, x and z); z half its length, w half its width
};

constexpr sampler world_ds(coord::normalized, filter::linear, mip_filter::linear, address::repeat, max_anisotropy(2));

// A hashed lattice (for the vertex shaders' and the road's per-cell choices only; no per-pixel noise).
static float world_hash(float2 p) { p = fract(p * float2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
static float world_noise(float2 p) {
    float2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(world_hash(i), world_hash(i + float2(1, 0)), u.x), mix(world_hash(i + float2(0, 1)), world_hash(i + float2(1, 1)), u.x), u.y);
}

static float world_shadow(float4 lc, depth2d<float> sm, float texel) {
    float3 p = lc.xyz / max(lc.w, 1e-6);
    float2 uv = float2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    if (any(uv < 0.0) || any(uv > 1.0) || p.z > 1.0) return 1.0;
    constexpr sampler cmp(coord::normalized, filter::linear, compare_func::less_equal, address::clamp_to_edge);
    float s = 0;
    for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) s += sm.sample_compare(cmp, uv + (float2(x, y) - 0.5) * texel, p.z - 0.0015);
    // Faded out toward the shadow box's edge, so where the map ends isn't a line across the land.
    float2 e = abs(uv - 0.5) * 2.0;
    float edge = smoothstep(0.8, 1.0, max(e.x, e.y));
    return mix(s * 0.25, 1.0, edge);
}
static float world_ggx(float nh, float a) { float a2 = max(a * a, 1e-4), d = nh * nh * (a2 - 1.0) + 1.0; return a2 / max(M_PI_F * d * d, 1e-6); }

// The car's occlusion of the ground round it (0231): its footprint as a soft rectangle, darkest under the middle, ≈ 0.7 m of
// falloff past its sides; nothing once it's off the ground.
static float world_carAO(float3 p, constant WDrive& dr) {
    if (dr.carPos.w <= 0) return 1.0;
    float3 rel = p - dr.carPos.xyz;
    if (dot(rel, rel) > 36.0) return 1.0;
    float2 f = dr.carFwd.xy, s = float2(f.y, -f.x);
    float2 q = float2(dot(rel.xz, s), dot(rel.xz, f));
    float2 dd = abs(q) - float2(dr.carFwd.w, dr.carFwd.z) * 0.92;
    float outside = length(max(dd, 0.0)), inside = min(max(dd.x, dd.y), 0.0);
    float k = 1.0 - smoothstep(-0.9, 0.75, outside + inside);
    k *= 1.0 - smoothstep(0.3, 1.4, abs(rel.y));
    return 1.0 - 0.72 * k;
}

// Per vertex (0231): the sky's light on a surface facing n, and the air between the eye and p (c · T + In), or 0226's
// hemisphere and haze when the physical sky is off.
struct WSky { float3 amb; float3 T; float3 In; };
static WSky world_vsky(float3 p, float3 n, constant WFrame& f, constant WLook& k, texture2d<float> V) {
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

struct WSurf { float3 albedo; float3 n; float rough; float spec; float ao; float wrap; float trans; };
static WSurf world_surf(float3 albedo, float3 n) { WSurf s; s.albedo = albedo; s.n = n; s.rough = 1.0; s.spec = 0.0; s.ao = 1.0; s.wrap = 0.0; s.trans = 0.0; return s; }

// The key light (shadowed), the sky's light (`amb`, interpolated), a dielectric's highlight, the headlamps.
static float3 world_light(WSurf s, float3 p, float4 lightClip, float3 amb, constant WFrame& f, constant WLook& k,
                          constant WDrive& dr, depth2d<float> shadow, texture2d<float> skyView) {
    float3 n = s.n, albedo = s.albedo;
    float3 l = normalize(f.keyDir.xyz + 1e-6);
    float ndl = dot(n, l);
    float nl = clamp((ndl + s.wrap) / (1.0 + s.wrap), 0.0, 1.0);
    float sh = (nl > 0 || s.trans > 0) && f.keyDir.w > 0.001 ? world_shadow(lightClip, shadow, f.fogRange.w) : 1.0;
    float3 E = f.keyColor.rgb * f.keyDir.w * sh;
    float3 c = albedo * (E * nl / M_PI_F + amb * s.ao);
    float3 v = normalize(f.eye.xyz - p + 1e-6);
    if (s.trans > 0) {   // leaves, needles and grass: the low sun through them, seen against it
        float back = clamp(dot(-v, l), 0.0, 1.0); back *= back; back *= back;
        c += albedo * E * s.trans * (0.25 + 1.6 * back) * clamp(-ndl * 0.5 + 0.5, 0.0, 1.0) / M_PI_F;
    }
    float nv = clamp(dot(n, v), 1e-3, 1.0);
    if (s.rough < 0.99 && nl > 0) {   // GGX, Schlick, Smith
        float3 h = normalize(l + v);
        float nh = clamp(dot(n, h), 0.0, 1.0), vh = clamp(dot(v, h), 0.0, 1.0);
        float a = s.rough * s.rough, F = 0.04 + 0.96 * pow(1.0 - vh, 5.0);
        float kk = (s.rough + 1.0) * (s.rough + 1.0) / 8.0, G = (nl / (nl * (1.0 - kk) + kk)) * (nv / (nv * (1.0 - kk) + kk));
        c += E * world_ggx(nh, a) * F * G / max(4.0 * nl * nv, 1e-3) * nl * (1.0 - 0.6 * s.rough);
    }
    bool atmo = k.atmo.x > 0.5;
    if (s.spec > 0) {   // water: the sky by Fresnel
        float fr = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
        float3 r = reflect(-v, n);
        float3 sky = atmo ? sky_reflect(skyView, r, 0.02, k.skySun.xyz, k.sunE.rgb, k.atmo.z) : mix(k.skyHorizon.rgb, k.skyZenith.rgb, smoothstep(0.0, 0.5, r.y));
        c = mix(c, sky, fr * s.spec);
    } else if (atmo && s.rough < 0.6) {   // tar and paint: a sheen of the sky at a grazing look
        float fr = pow(1.0 - nv, 5.0) * (1.0 - s.rough) * 0.6;
        if (fr > 0.01) c += sky_reflect(skyView, reflect(-v, n), s.rough, k.skySun.xyz, k.sunE.rgb, k.atmo.z) * fr * s.ao;
    }
    if (dr.lampPos.w > 0) {   // the headlamps: a soft cone with a hot spot, inverse-square, out to ≈ 140 m
        float3 d = dr.lampPos.xyz - p;
        float dist = max(length(d), 0.5);
        float3 ld = d / dist;
        float cd = dot(-ld, dr.lampDir.xyz);
        float cone = smoothstep(dr.lampDir.w - 0.05, dr.lampDir.w + 0.06, cd); cone *= cone;
        float hot = smoothstep(dr.lampDir.w + 0.04, 0.995, cd);
        float att = (cone + 1.5 * hot) * dr.lampPos.w / (dist * dist + 25.0) * clamp(1.0 - pow(dist / 140.0, 4.0), 0.0, 1.0);
        c += albedo * clamp(dot(n, ld), 0.0, 1.0) * att * float3(1.0, 0.95, 0.86);
    }
    return c;
}

// --- Terrain ----------------------------------------------------------------------------------------------------------
struct WTerrainIn { float4 pm [[attribute(0)]]; float3 n [[attribute(1)]]; float4 col [[attribute(2)]]; };
struct WTile { float4 offset; float4 morph; };   // offset: the tile's corner − origin; morph: start, 1 / span
struct WTerrainOut { float4 clip [[position]]; float3 world; float3 n; float4 col; float4 lightClip; float level; float3 amb; float3 airT; float3 airIn; };

vertex WTerrainOut cg_world_terrain_vertex(WTerrainIn in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WTile& t [[buffer(2)]],
                                           constant WLook& k [[buffer(4)]], texture2d<float> skyView [[texture(8)]]) {
    float3 p = in.pm.xyz + t.offset.xyz;
    float d = length(p.xz - f.eye.xz);
    float m = clamp((d - t.morph.x) * t.morph.y, 0.0, 1.0);
    p.y = mix(in.pm.y, in.pm.w, m) + t.offset.y;
    WTerrainOut o;
    o.world = p; o.n = in.n; o.col = in.col; o.level = t.offset.w;
    o.clip = f.viewProj * float4(p, 1);
    o.lightClip = f.lightViewProj * float4(p, 1);
    WSky sk = world_vsky(p, normalize(in.n + 1e-6), f, k, skyView);
    o.amb = sk.amb; o.airT = sk.T; o.airIn = sk.In;
    return o;
}

// The land's materials from the tile's albedo and the slope (0231), four taps of the detail: a macro tone and relief, dry
// patches and bare soil, grass clumps, and on the steep rock with strata and fractures; the snow the albedo carries.
static WSurf world_land(float3 col, float3 n0, float2 w, texture2d<float> det) {
    WSurf s = world_surf(col, n0);
    float steep = clamp((1.0 - n0.y) * 3.0, 0.0, 1.0);
    float lum = dot(col, float3(0.33));
    bool snow = lum > 0.4;
    float green = clamp((col.g - max(col.r, col.b)) * 30.0, 0.0, 1.0);
    float4 M = det.sample(world_ds, w / 160.0), R = det.sample(world_ds, w / 47.0);
    float4 P = det.sample(world_ds, w / 23.0), C = det.sample(world_ds, w / 1.9);
    float3 a = col * (0.72 + 0.56 * M.r) * (0.82 + 0.36 * R.g);
    if (!snow) {
        float dry = smoothstep(0.45, 0.75, P.r);
        float3 dryC = float3(0.12, 0.12, 0.055), lush = float3(0.045, 0.085, 0.03);
        float3 g = mix(a, mix(lush * (0.8 + 0.6 * M.r), dryC * (0.7 + 0.5 * M.r), dry * 0.7), 0.6 * green);
        g *= mix(1.0, 0.75 + 0.5 * C.b, green);
        float soil = smoothstep(0.7, 0.85, P.g + steep * 0.35) * (1.0 - steep * 0.5);
        g = mix(g, float3(0.13, 0.095, 0.065) * (0.8 + 0.4 * C.b), soil * 0.8 * green);
        float rockK = smoothstep(0.35, 0.75, steep + (P.b - 0.5) * 0.4);
        float crack = smoothstep(0.0, 0.12, C.a);
        float3 rock = float3(0.17, 0.155, 0.14) * (0.65 + 0.5 * R.b) * (0.75 + 0.25 * crack);
        a = mix(g, rock, rockK);
        s.rough = mix(1.0, 0.75, rockK);
        s.ao = mix(1.0, 0.6 + 0.4 * crack, rockK) * mix(1.0, 0.85 + 0.15 * C.b, green);
    } else {
        a *= 0.92 + 0.12 * C.b;
        s.rough = 0.7;
    }
    s.albedo = a;
    return s;
}

fragment float4 cg_world_terrain_fragment(WTerrainOut in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]],
                                          constant WDrive& dr [[buffer(5)]], depth2d<float> shadow [[texture(3)]], texture2d<float> skyView [[texture(8)]],
                                          texture2d<float> det [[texture(10)]]) {
    if (dr.params.z > 0.5) {   // debug (`-fd-lod`): each level its own colour, with the stored albedo
        float3 lc[8] = { float3(1,0,0), float3(0,1,0), float3(0,0,1), float3(1,1,0), float3(0,1,1), float3(1,0,1), float3(1,1,1), float3(0.5,0.5,0.5) };
        return float4(lc[int(clamp(in.level, 0.0, 7.0))] * 0.05 + in.col.rgb * 0.3, 1);
    }
    float3 n = normalize(in.n + 1e-6);
    bool water = in.col.a > 0.998;   // (the byte's 255; below it, the road's distance: 0231)
    float2 w = in.world.xz + dr.anchor.xy;
    WSurf s = world_surf(in.col.rgb, n);
    if (!water) {
        s = world_land(in.col.rgb, n, w, det);
        s.ao *= world_carAO(in.world, dr);
    } else {
        float t = dr.params.y;
        float wv = det.sample(world_ds, w / 40.0 + t * 0.004).g - 0.5;
        s.n = normalize(float3(sin(in.world.x * 0.21 + t * 0.6) * 0.03 + wv * 0.08, 1.0, cos(in.world.z * 0.17 + t * 0.5) * 0.03 - wv * 0.06));
        s.spec = 0.85; s.rough = 0.05;
    }
    float3 c = world_light(s, in.world, in.lightClip, in.amb, f, k, dr, shadow, skyView);
    return float4(max(c, 0.0) * in.airT + in.airIn, 1);
}

// --- Roads -------------------------------------------------------------------------------------------------------------
struct WRoadIn { float3 pos [[attribute(0)]]; float2 la [[attribute(1)]]; float3 n [[attribute(2)]]; float4 col [[attribute(3)]]; };
struct WRoadOut { float4 clip [[position]]; float3 world; float2 la; float3 n; float3 col; float4 lightClip; float3 amb; float3 airT; float3 airIn; };
vertex WRoadOut cg_world_road_vertex(WRoadIn in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WTile& t [[buffer(2)]],
                                     constant WLook& k [[buffer(4)]], texture2d<float> skyView [[texture(8)]]) {
    float3 p = in.pos + t.offset.xyz;
    WRoadOut o; o.world = p; o.la = in.la; o.n = in.n; o.col = in.col.rgb;
    o.clip = f.viewProj * float4(p, 1); o.lightClip = f.lightViewProj * float4(p, 1);
    WSky sk = world_vsky(p, normalize(in.n + 1e-6), f, k, skyView);
    o.amb = sk.amb; o.airT = sk.T; o.airIn = sk.In;
    return o;
}
// The road (0231): a used two-lane asphalt. The binder's tone in patches and relaid repairs, sealed cracks and the centre
// joint as glossy tar, the wheel tracks polished, an oil line down each lane, aggregate up close, dust toward the edges, the
// paint worn where the tyres cross it; the gravel shoulder; the verge in the land's colour.
fragment float4 cg_world_road_fragment(WRoadOut in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]],
                                       constant WDrive& dr [[buffer(5)]], depth2d<float> shadow [[texture(3)]], texture2d<float> skyView [[texture(8)]],
                                       texture2d<float> det [[texture(10)]]) {
    float lat = in.la.x, along = in.la.y, al = abs(lat);
    const float hw = 3.5;
    float dist = distance(in.world, f.eye.xyz);
    float pxM = dist * 2.0 / max(f.proj.y * f.proj.w, 1.0);
    float2 w = in.world.xz + dr.anchor.xy;
    float2 ra = float2(lat, along);
    float3 n = normalize(in.n + 1e-6);
    WSurf s = world_surf(float3(0), n);
    float4 A = det.sample(world_ds, ra / float2(6.0, 26.0));     // R binder age, G oil, B dust, A —
    float4 G = det.sample(world_ds, w / 0.45);                   // B grain, A aggregate (cell edges)
    float4 K = det.sample(world_ds, ra / float2(2.4, 3.6));      // A crack network, G where cracked
    float4 Wr = det.sample(world_ds, ra / float2(0.5, 1.6));     // B paint wear, G dust grain
    float3 asphalt = float3(0.062, 0.061, 0.064) * (0.78 + 0.5 * A.r);
    // Repairs: now and then a rectangle where the road's been cut and relaid, darker, edged by a tar seam.
    float cellA = floor(along / 11.0), rnd = world_hash(float2(cellA, 3.7));
    float pL0 = (world_hash(float2(cellA, 9.1)) - 0.5) * 4.0, pL1 = pL0 + 1.2 + world_hash(float2(cellA, 1.3)) * 2.2;
    float pA = fract(along / 11.0) * 11.0, pA0 = 1.0 + world_hash(float2(cellA, 5.5)) * 3.0, pA1 = pA0 + 2.0 + world_hash(float2(cellA, 2.2)) * 4.0;
    float isP = step(0.72, rnd);
    float inPatch = isP * step(pL0, lat) * step(lat, pL1) * step(pA0, pA) * step(pA, pA1);
    float near = min(min(abs(lat - pL0), abs(lat - pL1)), min(abs(pA - pA0), abs(pA - pA1)));
    float patchEdge = isP * (1.0 - smoothstep(0.0, 0.05 + pxM, near)) * step(pL0 - 0.06, lat) * step(lat, pL1 + 0.06) * step(pA0 - 0.06, pA) * step(pA, pA1 + 0.06);
    asphalt = mix(asphalt, float3(0.035, 0.036, 0.04), inPatch * 0.85);
    // Wheel tracks: two per lane (± 0.8 m about each lane's centre at ± 1.75 m), polished, a shade darker; an oil line between.
    float lane = abs(al - 1.75);
    float track = (1.0 - smoothstep(0.18, 0.42, abs(lane - 0.8))) * (1.0 - smoothstep(hw - 0.4, hw, al));
    float oil = (1.0 - smoothstep(0.1, 0.45, lane)) * (0.6 + 0.4 * A.g);
    asphalt *= 1.0 - 0.07 * track - 0.15 * oil * (1.0 - track);
    // Aggregate and grain up close (the mips average them out further off).
    asphalt *= 0.92 + 0.12 * G.b + 0.12 * smoothstep(0.25, 0.05, G.a);
    // Cracks sealed with tar, where the network is (thin, glossy black); the centre joint.
    float crack = (1.0 - smoothstep(0.0, 0.05 + pxM * 2.0, K.a)) * smoothstep(0.55, 0.75, K.g) * (1.0 - smoothstep(0.03, 0.12, pxM));
    float joint = (1.0 - smoothstep(0.02, 0.05 + pxM, abs(lat))) * 0.7;
    float tar = max(max(crack, joint), patchEdge * 0.9);
    asphalt = mix(asphalt, float3(0.012, 0.012, 0.014), tar);
    // Dust and grit toward the edges.
    float dust = smoothstep(hw - 1.1, hw - 0.2, al) * (0.5 + 0.5 * Wr.g);
    asphalt = mix(asphalt, float3(0.11, 0.098, 0.082), dust * 0.55);
    // The shoulder's gravel, and the verge (the land's colour, out to it).
    float3 gravel = float3(0.17, 0.155, 0.13) * (0.7 + 0.6 * G.b);
    float shoulder = smoothstep(hw - 0.02, hw + 0.02 + pxM, al);
    float3 albedo = mix(asphalt, gravel, shoulder);
    if (al > hw + 1.2) {
        WSurf land = world_land(in.col, n, w, det);
        float k2 = smoothstep(hw + 1.2, hw + 2.4 + (A.b - 0.5) * 1.2, al);
        albedo = mix(albedo, land.albedo, k2);
    }
    // The markings (EU): solid edge lines, a dashed centre line (3 m on, 9 m off), worn where the tyres run. Antialiased by
    // their own width on screen; faded far off where they'd shimmer.
    float wl = max(fwidth(lat), 1e-3), wa = max(fwidth(along), 1e-3);
    float edge = smoothstep(0.12 + wl, 0.12 - wl, abs(al - (hw - 0.3)));
    float dash = smoothstep(0.075 + wl, 0.075 - wl, al) * smoothstep(0.25 + wa / 12.0, 0.25 - wa / 12.0, abs(fract(along / 12.0) - 0.125) * 2.0);
    float fade = 1.0 - smoothstep(300.0, 900.0, dist);
    float keep = smoothstep(0.18, 0.42, Wr.b + 0.15 - track * 0.35);
    float mk = max(edge, dash) * fade * mix(1.0, keep, 1.0 - smoothstep(0.03, 0.12, pxM));
    float3 paint = float3(0.66, 0.66, 0.63);
    albedo = mix(albedo, paint * (0.88 + 0.12 * G.b), mk);
    s.albedo = albedo; s.n = n;
    s.rough = mix(mix(0.82 - 0.14 * track, 0.42, tar), 0.6, mk);
    s.rough = mix(s.rough, 1.0, shoulder);
    s.ao = world_carAO(in.world, dr);
    float3 c = world_light(s, in.world, in.lightClip, in.amb, f, k, dr, shadow, skyView);
    // Painted lines are retroreflective: the headlamps come back off them.
    if (dr.lampPos.w > 0 && mk > 0) {
        float3 d = dr.lampPos.xyz - in.world; float dl = max(length(d), 1.0);
        float cone = smoothstep(dr.lampDir.w - 0.05, dr.lampDir.w + 0.06, dot(-d / dl, dr.lampDir.xyz)); cone *= cone;
        c += paint * mk * cone * dr.lampPos.w * 0.02 / dl * (1.0 - smoothstep(60.0, 160.0, dl));
    }
    return float4(max(c, 0.0) * in.airT + in.airIn, 1);
}

// --- Props (instanced; the stage's 44-byte vertex: pos, nrm, uv, col) -----------------------------------------------------
struct WPropIn { float3 pos [[attribute(0)]]; float3 nrm [[attribute(1)]]; float2 uv [[attribute(2)]]; float3 col [[attribute(3)]]; };
struct WInst { float4 posYaw; float4 scaleTint; };   // xyz relative to the block's corner, yaw; scale, tint
struct WPropOut { float4 clip [[position]]; float3 world; float3 n; float3 col; float glow; float4 lightClip; float seed; float3 amb; float3 airT; float3 airIn; };
static float3 world_propPos(WPropIn in, WInst I, constant WFrame& f, constant WTile& t, constant WDrive& dr, thread float3& nOut) {
    float3 base = I.posYaw.xyz + t.offset.xyz;
    float d = length(base.xz - f.eye.xz);
    // Grown in from nothing over the last 15 % of the range (no pop), and gone past it.
    float far = dr.params.x;
    // (a negative scale: a roadside item broken loose, drawn by the loose view instead, 0227)
    float s = max(I.scaleTint.x, 0.0) * (1.0 - smoothstep(far * 0.85, far, d));
    // The near pool (0226): a block's draw leaves out what the pool draws (mode 1), the pool what's past its radius (2).
    if ((t.morph.x == 1.0 && d < dr.anchor.z) || (t.morph.x == 2.0 && d >= dr.anchor.z)) s = 0.0;
    float c = cos(I.posYaw.w), sn = sin(I.posYaw.w);
    float3 lp = in.pos * s;
    // The wind (0231): crowns sway, more toward the top, each tree on its own phase; trunks, rocks and posts stay put.
    float green = clamp((in.col.g - max(in.col.r, in.col.b)) * 40.0, 0.0, 1.0);
    float sway = dr.params.w * green * max(lp.y - 1.0, 0.0) * 0.012;
    float ph = I.posYaw.x * 0.37 + I.posYaw.z * 0.23, tm = dr.params.y;
    lp.x += sway * (sin(tm * 1.3 + ph) + 0.4 * sin(tm * 3.1 + ph * 2.0));
    lp.z += sway * 0.6 * cos(tm * 1.1 + ph * 1.3);
    nOut = float3(in.nrm.x * c + in.nrm.z * sn, in.nrm.y, -in.nrm.x * sn + in.nrm.z * c);
    return float3(lp.x * c + lp.z * sn, lp.y, -lp.x * sn + lp.z * c) + base;
}
vertex WPropOut cg_world_prop_vertex(WPropIn in [[stage_in]], uint iid [[instance_id]], constant WFrame& f [[buffer(1)]], constant WTile& t [[buffer(2)]],
                                     constant WInst* inst [[buffer(3)]], constant WDrive& dr [[buffer(5)]],
                                     constant WLook& k [[buffer(4)]], texture2d<float> skyView [[texture(8)]]) {
    WInst I = inst[iid];
    float3 n;
    float3 p = world_propPos(in, I, f, t, dr, n);
    WPropOut o; o.world = p; o.n = n; o.col = in.col * I.scaleTint.y; o.glow = in.uv.x; o.seed = I.posYaw.x * 1.31 + I.posYaw.z * 0.77;
    o.clip = f.viewProj * float4(p, 1); o.lightClip = f.lightViewProj * float4(p, 1);
    WSky sk = world_vsky(p, normalize(n + 1e-6), f, k, skyView);
    o.amb = sk.amb; o.airT = sk.T; o.airIn = sk.In;
    return o;
}
// The props into the key light's shadow map (0231): trees, rocks and the roadside cast on the road, the land and the car.
vertex float4 cg_world_prop_shadow_vertex(WPropIn in [[stage_in]], uint iid [[instance_id]], constant WFrame& f [[buffer(1)]], constant WTile& t [[buffer(2)]],
                                          constant WInst* inst [[buffer(3)]], constant WDrive& dr [[buffer(5)]]) {
    WInst I = inst[iid];
    float3 n;
    float3 p = world_propPos(in, I, f, t, dr, n);
    return f.lightViewProj * float4(p, 1);
}
fragment float4 cg_world_prop_fragment(WPropOut in [[stage_in]], bool front [[front_facing]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]],
                                       constant WDrive& dr [[buffer(5)]], depth2d<float> shadow [[texture(3)]], texture2d<float> skyView [[texture(8)]],
                                       texture2d<float> det [[texture(10)]]) {
    float3 n = normalize(in.n + 1e-6);
    if (!front) n = -n;
    float3 col = in.col;
    WSurf s = world_surf(col, n);
    float green = clamp((col.g - max(col.r, col.b)) * 40.0, 0.0, 1.0);
    float g = det.sample(world_ds, float2(in.world.x + in.world.z, in.world.y * 3.0) * 0.6).b;
    if (green > 0) {
        // Foliage: each tree its own hue, lit softly through (wrap) and from behind (transmission), a leafy grain.
        float hue = world_hash(float2(in.seed, 1.7));
        float3 tint = mix(float3(0.92, 1.0, 0.82), float3(1.25, 1.08, 0.72), hue);
        s.albedo = col * mix(float3(1), tint * (0.75 + 0.5 * g), green);
        s.wrap = 0.45 * green; s.trans = 0.55 * green;
        s.ao = 0.75 + 0.25 * g;
    } else {
        s.albedo = col * (0.85 + 0.3 * g);
        s.rough = 0.85;
    }
    s.ao *= world_carAO(in.world, dr);
    float3 c = world_light(s, in.world, in.lightClip, in.amb, f, k, dr, shadow, skyView);
    if (in.glow > 0.5 && dr.lampPos.w > 0) {   // a delineator's reflector: it lights up in the headlamps, from far off
        float3 d = dr.lampPos.xyz - in.world; float dist = max(length(d), 1.0);
        float cone = smoothstep(dr.lampDir.w - 0.25, dr.lampDir.w, dot(-d / dist, dr.lampDir.xyz));
        c += float3(1.0, 0.72, 0.35) * cone * dr.lampPos.w * 0.5 / (dist * 2.0) * (1.0 - smoothstep(220.0, 400.0, dist));
    }
    return float4(max(c, 0.0) * in.airT + in.airIn, 1);
}

// --- Loose things (0223: cones, barriers, signs; a full pose each, they tip and roll) --------------------------------------
struct WLooseInst { float4x4 m; float4 tint; };
vertex WPropOut cg_world_loose_vertex(WPropIn in [[stage_in]], uint iid [[instance_id]], constant WFrame& f [[buffer(1)]],
                                      constant WLooseInst* inst [[buffer(3)]], constant WLook& k [[buffer(4)]], texture2d<float> skyView [[texture(8)]]) {
    WLooseInst I = inst[iid];
    float3 p = (I.m * float4(in.pos, 1)).xyz;
    WPropOut o; o.world = p; o.n = (I.m * float4(in.nrm, 0)).xyz; o.col = in.col * I.tint.rgb; o.glow = in.uv.x; o.seed = 0;
    o.clip = f.viewProj * float4(p, 1); o.lightClip = f.lightViewProj * float4(p, 1);
    WSky sk = world_vsky(p, normalize(o.n + 1e-6), f, k, skyView);
    o.amb = sk.amb; o.airT = sk.T; o.airIn = sk.In;
    return o;
}

// --- Skid marks (0223): rubber on the ground, blended over it, hazed with distance ----------------------------------------
struct WMarkIn { float4 pa [[attribute(0)]]; };
struct WMarkOut { float4 clip [[position]]; float3 world; float a; float3 airT; float3 airIn; };
vertex WMarkOut cg_world_mark_vertex(WMarkIn in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]], texture2d<float> skyView [[texture(8)]]) {
    WMarkOut o; o.world = in.pa.xyz; o.a = in.pa.w; o.clip = f.viewProj * float4(in.pa.xyz, 1);
    WSky sk = world_vsky(in.pa.xyz, float3(0, 1, 0), f, k, skyView);
    o.airT = sk.T; o.airIn = sk.In;
    return o;
}
fragment float4 cg_world_mark_fragment(WMarkOut in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]]) {
    // Rubber is near black and polished smooth by the slide: darker than asphalt, and on the stage's black floor it reads
    // by the sky's faint sheen along it.
    float3 c = (float3(0.004, 0.004, 0.005) + k.skyHorizon.rgb * 0.08) * in.airT + in.airIn;
    float fade = 1.0 - smoothstep(120.0, 260.0, distance(in.world, f.eye.xyz));
    return float4(c, clamp(0.25 + in.a, 0.0, 1.0) * 0.8 * fade);
}

// --- Grass (0231): blades on the ground near the eye ------------------------------------------------------------------------
// Each instance a clump of blades (one tapered triangle each, `params.w` of them) on a jittered grid over a finest-level
// terrain tile. The ground's height, normal, colour and the road's distance come from the tile's own vertices (its 4 m grid,
// the split the tile's triangles use), so a clump stands exactly on the land drawn. None on the road, its shoulder and
// gravel, on water, rock, snow or the set's slab; thinner and shorter with distance, gone by the radius; bent by the wind.
struct WGrass { float4 offset; int4 cells; float4 params; };   // offset: the tile's corner − origin; cells: i0, j0, columns, —; params: spacing, radius, density, blades
struct WGrassOut { float4 clip [[position]]; float3 world; float3 n; float3 col; float tip; float4 lightClip; float3 amb; float3 airT; float3 airIn; };
vertex WGrassOut cg_world_grass_vertex(uint vid [[vertex_id]], uint iid [[instance_id]], constant WFrame& f [[buffer(1)]],
                                        constant WGrass& g [[buffer(2)]], const device float* tile [[buffer(0)]], constant WDrive& dr [[buffer(5)]],
                                        constant WLook& k [[buffer(4)]], texture2d<float> skyView [[texture(8)]], texture2d<float> det [[texture(10)]]) {
    WGrassOut o;
    o.clip = float4(2, 2, 2, 1); o.world = 0; o.n = float3(0, 1, 0); o.col = 0; o.tip = 0; o.lightClip = 0; o.amb = 0; o.airT = 1; o.airIn = 0;
    int ci = g.cells.x + int(iid) % g.cells.z, cj = g.cells.y + int(iid) / g.cells.z;
    float sp = g.params.x;
    float2 cellW = float2(ci, cj) * sp + g.offset.xz + dr.anchor.xy;   // world-anchored, for the jitter and the patches
    float h0 = world_hash(cellW * 0.37 + 0.5), h1 = world_hash(cellW * 0.71 + 3.1), h2 = world_hash(cellW * 0.13 + 7.7);
    float2 lp = (float2(ci, cj) + float2(h0, h1)) * sp;                 // tile-local metres
    if (any(lp < 0.0) || any(lp >= 128.0)) return o;
    float3 base = float3(lp.x, 0, lp.y) + g.offset.xyz;
    float d = length(base.xz - f.eye.xz);
    float R = g.params.y;
    // Thinner with distance (the far clumps drop out first, by their own hash).
    float keep = 1.0 - smoothstep(R * 0.35, R, d);
    if (h2 > keep * g.params.z) return o;
    // The ground here, from the tile's grid (32 cells of 4 m, 8 floats a vertex: x y z parentY nx ny nz rgba).
    const int W = 33;
    float2 q = lp / 4.0; int2 c0 = int2(floor(q)); float2 fr = q - float2(c0);
    c0 = clamp(c0, int2(0), int2(31));
    int ia = (c0.y * W + c0.x) * 8, ib = ia + 8, ic = ia + W * 8, id = ic + 8;
    float ya = tile[ia + 1], yb = tile[ib + 1], yc = tile[ic + 1], yd = tile[id + 1];
    float y = fr.x > fr.y ? ya + (yb - ya) * fr.x + (yd - yb) * fr.y : ya + (yc - ya) * fr.y + (yd - yc) * fr.x;
    float3 n = normalize(float3(tile[ia + 4], tile[ia + 5], tile[ia + 6]));
    uint cb = as_type<uint>(tile[ia + 7]);
    float3 col = float3(cb & 255u, (cb >> 8) & 255u, (cb >> 16) & 255u) / 255.0;
    float road = float(cb >> 24) / 8.0;
    if ((cb >> 24) == 255u) return o;                                    // water
    if (road < 5.4) return o;                                            // the road, its shoulder and the gravel
    if (n.y < 0.82) return o;                                            // too steep: rock and scree
    if (col.r > col.g * 1.3 || dot(col, float3(0.33)) > 0.3) return o;  // sand, desert, snow, concrete
    // The verge's ribbon lies on the exact ground over a dip in the tile: stand on the ribbon, not in the dip.
    y += 0.4 * (1.0 - smoothstep(14.7 - 3.0, 14.7, road));   // (RoadSpec.vergeDip, vergeOut)
    // A patchy meadow: tall tufts here, short turf there; drier in the land's dry patches (the detail's own).
    float2 wp = cellW;
    float4 pd = det.sample(world_ds, wp / 23.0, level(0.0));
    float patch = det.sample(world_ds, wp / 7.0, level(0.0)).g;
    float tall = (0.14 + 0.42 * smoothstep(0.25, 0.85, patch)) * (0.7 + 0.6 * h0) * mix(0.55, 1.0, keep);
    tall *= smoothstep(5.4, 7.0, road);                                   // mown short by the shoulder
    // The blade: `blades` round the clump, each a triangle leaning out, the wind bending its tip.
    uint blade = vid / 3, corner = vid % 3;
    float nb = g.params.w;
    float ang = (float(blade) + h1 * nb) * (6.2832 / nb) + h0 * 6.28;
    float2 dir = float2(cos(ang), sin(ang));
    float bw = 0.035 + 0.035 * h2, lean = 0.35 + 0.4 * world_hash(float2(float(blade), h0 * 31.0));
    float bh = tall * (0.65 + 0.5 * world_hash(float2(h1 * 17.0, float(blade))));
    float tm = dr.params.y, wind = dr.params.w;
    float2 gust = float2(0.8, 0.45) * (0.5 + 0.5 * sin(tm * 1.7 + wp.x * 0.21 + wp.y * 0.13)) * wind;
    float3 p;
    float2 side = float2(-dir.y, dir.x) * bw;
    if (corner == 0) p = float3(-side.x, 0, -side.y);
    else if (corner == 1) p = float3(side.x, 0, side.y);
    else { float2 tipXZ = dir * lean * bh + gust * bh; p = float3(tipXZ.x, bh, tipXZ.y); }
    p += float3(dir.x, 0, dir.y) * 0.04;
    float3 w = base + float3(0, y, 0) + p;
    float3 bn = normalize(float3(dir.x, 0.6, dir.y));
    o.world = w; o.n = normalize(n * 0.6 + bn * 0.4);
    o.tip = corner == 2 ? 1.0 : 0.0;
    float dry = smoothstep(0.45, 0.75, pd.r);
    o.col = mix(col * float3(0.9, 1.15, 0.8), float3(0.2, 0.17, 0.08), dry * 0.6) * (0.75 + 0.5 * h2);
    o.clip = f.viewProj * float4(w, 1); o.lightClip = f.lightViewProj * float4(w, 1);
    WSky sk = world_vsky(w, o.n, f, k, skyView);
    o.amb = sk.amb; o.airT = sk.T; o.airIn = sk.In;
    return o;
}
fragment float4 cg_world_grass_fragment(WGrassOut in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]],
                                        constant WDrive& dr [[buffer(5)]], depth2d<float> shadow [[texture(3)]], texture2d<float> skyView [[texture(8)]]) {
    WSurf s = world_surf(in.col * (0.55 + 0.75 * in.tip), normalize(in.n));
    s.wrap = 0.6; s.trans = 0.8;
    s.ao = 0.45 + 0.55 * in.tip;
    float3 c = world_light(s, in.world, in.lightClip, in.amb, f, k, dr, shadow, skyView);
    return float4(max(c, 0.0) * in.airT + in.airIn, 1);
}
