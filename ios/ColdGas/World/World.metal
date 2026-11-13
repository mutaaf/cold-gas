// Free Drive's world in Metal (docs/NATIVE-FREEDRIVE.md §4.3): the CDLOD terrain with its geomorph, the road ribbons and
// the instanced props, all drawn camera-relative (positions arrive as `piece − origin`, so a tile 40 km out is as precise
// as one at the centre). Lit like the stage (the key light and its shadow, then either 0226's painted dusk or, since 0228,
// the physical sky of Sky.h: its ambient, its reflections and its aerial perspective), plus the car's headlamps.
// Surfaces are procedural (0228): no textures, every detail a function of the world position, anchored so it doesn't swim
// when the floating origin moves, and faded by its own screen-space footprint so it never shimmers.
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
    float4 atmo, sunE;   // the physical sky (0228, Sky.h)
};
// What the world adds a frame: the headlamps (position, direction, intensity), the props' fade, and the car (0228: its
// footprint darkens the ground under it, the ambient occlusion a body that low makes).
struct WDrive {
    float4 lampPos;      // xyz; w intensity (0 off)
    float4 lampDir;      // xyz; w cos of the cone's edge
    float4 params;       // x: props' far distance (m), y: time, z: debug LOD colours, w: wind (0…1)
    float4 anchor;       // xy: the floating origin mod 4,096 m (world-anchored detail); z: the near pool's radius
    float4 carPos;       // xyz the car's centre on the ground (render space); w: 1 when it's on its wheels
    float4 carFwd;       // xy the car's heading on the ground (unit, x and z); z half its length, w half its width
};

// Value noise on a hashed lattice (world metres, anchored: render-space + anchor). Every scale divides 4,096, so the pattern
// is continuous when the origin moves (0226).
static float world_hash(float2 p) { p = fract(p * float2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
static float world_noise(float2 p) {
    float2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(world_hash(i), world_hash(i + float2(1, 0)), u.x), mix(world_hash(i + float2(0, 1)), world_hash(i + float2(1, 1)), u.x), u.y);
}
static float world_fbm(float2 p, int n) {
    float a = 0.5, s = 0;
    for (int i = 0; i < n; i++) { s += a * world_noise(p); p = float2(p.x * 1.62 - p.y * 1.18, p.x * 1.18 + p.y * 1.62) + 3.1; a *= 0.5; }
    return s;
}
// A cell's own random point (Worley): the distances to the nearest two, for stones and cracks.
static float2 world_cells(float2 p) {
    float2 i = floor(p), f = fract(p);
    float d1 = 9, d2 = 9;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        float2 g = float2(x, y), o = float2(world_hash(i + g), world_hash(i + g + 17.3));
        float d = length(g + o - f);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
    return float2(d1, d2);
}

static float3 world_hazed(float3 c, float3 d, float L, float3 eye, constant WLook& k) {
    float a = k.hazeCol.w;
    if (a <= 0) return c;
    float b = k.sunCol.w, dens = a * exp(-b * eye.y), dy = d.y * b;
    float tau = abs(dy) > 1e-4 ? dens * (1.0 - exp(-clamp(dy * L, -12.0, 12.0))) / dy : dens * L;
    float fog = 1.0 - exp(-clamp(tau, 0.0, 12.0));
    float sun = pow(max(dot(d, k.sunDir.xyz), 0.0), 6.0);
    return mix(c, k.hazeCol.rgb + k.sunCol.rgb * sun, fog);
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

// The car's occlusion of the ground round it (0228): its footprint as a soft rectangle, darkest under the middle, ≈ 0.7 m of
// falloff past its sides; nothing once it's off the ground.
static float world_carAO(float3 p, constant WDrive& dr) {
    if (dr.carPos.w <= 0) return 1.0;
    float3 rel = p - dr.carPos.xyz;
    float2 f = dr.carFwd.xy, s = float2(f.y, -f.x);
    float2 q = float2(dot(rel.xz, s), dot(rel.xz, f));
    float2 dd = abs(q) - float2(dr.carFwd.w, dr.carFwd.z) * 0.92;
    float outside = length(max(dd, 0.0)), inside = min(max(dd.x, dd.y), 0.0);
    float k = 1.0 - smoothstep(-0.9, 0.75, outside + inside);
    k *= 1.0 - smoothstep(0.3, 1.4, abs(rel.y));
    return 1.0 - 0.72 * k;
}

struct WSurf { float3 albedo; float3 n; float rough; float spec; float ao; float wrap; float trans; };
static WSurf world_surf(float3 albedo, float3 n) { WSurf s; s.albedo = albedo; s.n = n; s.rough = 1.0; s.spec = 0.0; s.ao = 1.0; s.wrap = 0.0; s.trans = 0.0; return s; }

// The key light (shadowed), the sky (the physical one's ambient and reflection, or 0226's hemisphere), the headlamps.
static float3 world_light(WSurf s, float3 p, float4 lightClip, constant WFrame& f, constant WLook& k,
                          constant WDrive& dr, depth2d<float> shadow, texture2d<float> skyView) {
    float3 n = s.n, albedo = s.albedo;
    float3 l = normalize(f.keyDir.xyz + 1e-6);
    float ndl = dot(n, l);
    float nl = clamp((ndl + s.wrap) / (1.0 + s.wrap), 0.0, 1.0);
    float sh = (nl > 0 || s.trans > 0) ? world_shadow(lightClip, shadow, f.fogRange.w) : 1.0;
    float3 E = f.keyColor.rgb * f.keyDir.w * sh;
    float3 c = albedo * E * nl / M_PI_F;
    float3 v = normalize(f.eye.xyz - p + 1e-6);
    if (s.trans > 0) {   // leaves and needles: the low sun through them, seen against it
        float back = pow(clamp(dot(-v, l), 0.0, 1.0), 4.0);
        c += albedo * E * s.trans * (0.25 + 1.6 * back) * clamp(-ndl * 0.5 + 0.5, 0.0, 1.0) / M_PI_F;
    }
    bool atmo = k.atmo.x > 0.5;
    if (atmo) c += albedo * sky_ambient(skyView, n, k.skySun.xyz, k.sunE.rgb, k.atmo.z) * s.ao;
    else c += albedo * mix(k.hemiGround.rgb, k.hemiSky.rgb, clamp(n.y * 0.5 + 0.5, 0.0, 1.0)) * s.ao;
    float nv = clamp(dot(n, v), 1e-3, 1.0);
    if (s.rough < 0.99 && nl > 0) {   // a dielectric's highlight (asphalt, wet rock, paint): GGX, Schlick, Smith
        float3 h = normalize(l + v);
        float nh = clamp(dot(n, h), 0.0, 1.0), vh = clamp(dot(v, h), 0.0, 1.0);
        float a = s.rough * s.rough, F = 0.04 + 0.96 * pow(1.0 - vh, 5.0);
        float kk = (s.rough + 1.0) * (s.rough + 1.0) / 8.0, G = (nl / (nl * (1.0 - kk) + kk)) * (nv / (nv * (1.0 - kk) + kk));
        c += E * world_ggx(nh, a) * F * G / max(4.0 * nl * nv, 1e-3) * nl * (1.0 - 0.6 * s.rough);
    }
    if (s.spec > 0) {   // water and wet road: the sky by Fresnel
        float fr = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
        float3 r = reflect(-v, n);
        float3 sky = atmo ? sky_reflect(skyView, r, 0.02, k.skySun.xyz, k.sunE.rgb, k.atmo.z) : mix(k.skyHorizon.rgb, k.skyZenith.rgb, smoothstep(0.0, 0.5, r.y));
        c = mix(c, sky, fr * s.spec);
    } else if (atmo && s.rough < 0.6) {   // a smoother surface's sheen of the sky at a grazing look (tar, paint, the tracks)
        float fr = pow(1.0 - nv, 5.0) * (1.0 - s.rough) * 0.6;
        c += sky_reflect(skyView, reflect(-v, n), s.rough, k.skySun.xyz, k.sunE.rgb, k.atmo.z) * fr * s.ao;
    }
    if (dr.lampPos.w > 0) {   // the headlamps: a soft cone, inverse-square, out to ≈ 140 m
        float3 d = dr.lampPos.xyz - p;
        float dist = max(length(d), 0.5);
        float3 ld = d / dist;
        float cd = dot(-ld, dr.lampDir.xyz);
        // A wide, soft edge (squared) so the beam has no hard wedge on the verges, a hot spot down its middle, and a
        // near-field floor so a bank right at the nose isn't blown white.
        float cone = smoothstep(dr.lampDir.w - 0.05, dr.lampDir.w + 0.06, cd); cone *= cone;
        float hot = smoothstep(dr.lampDir.w + 0.04, 0.995, cd);
        float att = (cone + 1.5 * hot) * dr.lampPos.w / (dist * dist + 25.0) * clamp(1.0 - pow(dist / 140.0, 4.0), 0.0, 1.0);
        c += albedo * clamp(dot(n, ld), 0.0, 1.0) * att * float3(1.0, 0.95, 0.86);
    }
    return c;
}
static float3 world_air(float3 c, float3 p, constant WFrame& f, constant WLook& k, texture2d<float> skyView) {
    float3 toP = p - f.eye.xyz;
    float dist = max(length(toP), 1e-3);
    if (k.atmo.x > 0.5) return sky_aerial(skyView, max(c, 0.0), toP / dist, dist, f.eye.y, k.skySun.xyz, k.atmo.z, k.atmo.y);
    return world_hazed(max(c, 0.0), toP / dist, dist, f.eye.xyz, k);
}

// --- Terrain ----------------------------------------------------------------------------------------------------------
struct WTerrainIn { float4 pm [[attribute(0)]]; float3 n [[attribute(1)]]; float4 col [[attribute(2)]]; };
struct WTile { float4 offset; float4 morph; };   // offset: the tile's corner − origin; morph: start, 1 / span
struct WTerrainOut { float4 clip [[position]]; float3 world; float3 n; float4 col; float4 lightClip; float level; };

vertex WTerrainOut cg_world_terrain_vertex(WTerrainIn in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WTile& t [[buffer(2)]]) {
    float3 p = in.pm.xyz + t.offset.xyz;
    float d = length(p.xz - f.eye.xz);
    float m = clamp((d - t.morph.x) * t.morph.y, 0.0, 1.0);
    p.y = mix(in.pm.y, in.pm.w, m) + t.offset.y;
    WTerrainOut o;
    o.world = p; o.n = in.n; o.col = in.col; o.level = t.offset.w;
    o.clip = f.viewProj * float4(p, 1);
    o.lightClip = f.lightViewProj * float4(p, 1);
    return o;
}

// The land's materials (0228) from the tile's albedo and the slope: grass in clumps and dry patches, bare soil, rock with
// its strata and fractures on the steep, and the snow the albedo already carries; each with its own bump.
static WSurf world_land(float3 col, float3 n0, float3 wp, float2 w, float dist, float pxM) {
    WSurf s = world_surf(col, n0);
    float steep = clamp((1.0 - n0.y) * 3.0, 0.0, 1.0);
    float lum = dot(col, float3(0.33));
    bool snow = lum > 0.4;
    float green = clamp((col.g - max(col.r, col.b)) * 30.0, 0.0, 1.0);
    // Macro tone (kills tiling and flat facets) near and far.
    float macro = world_fbm(w / 96.0, 3);
    float3 a = col * (0.72 + 0.56 * macro);
    // The near detail, faded by the pixel's footprint (pxM: metres a pixel covers here).
    // (pxM ≈ distance / 2,900 on an upright phone: nearK to ≈ 150 m, midK to ≈ 700 m; past that only the tone.)
    float nearK = 1.0 - smoothstep(0.012, 0.05, pxM);
    float midK = 1.0 - smoothstep(0.08, 0.25, pxM);
    if (midK <= 0.0) {   // far off (a pixel spans metres): the tone and the rock by slope only, none of the detail's taps
        float rockF = smoothstep(0.45, 0.85, steep);
        s.albedo = mix(a, float3(0.17, 0.155, 0.14) * (0.8 + 0.4 * macro), rockF * (snow ? 0.0 : 1.0));
        return s;
    }
    if (!snow) {
        // Grass: dry, sun-bleached patches and lush hollows, then clumps at 0.6 m.
        float dry = smoothstep(0.45, 0.75, world_fbm(w / 23.0 + 11.0, 3));
        float3 dryC = float3(0.15, 0.14, 0.065), lush = float3(0.045, 0.085, 0.03);
        float3 g = mix(a, mix(lush * (0.8 + 0.6 * macro), dryC * (0.7 + 0.5 * macro), dry * 0.7), 0.6 * green);
        float clump = world_noise(w / 0.6);
        g *= mix(1.0, 0.75 + 0.5 * clump, midK * green);
        // Bare soil showing through on the slopes and in patches.
        float soil = smoothstep(0.62, 0.8, world_fbm(w / 9.0 + 3.0, 3) + steep * 0.35) * (1.0 - steep * 0.5);
        g = mix(g, float3(0.13, 0.095, 0.065) * (0.8 + 0.4 * clump), soil * 0.8 * green);
        a = g;
        // Rock on the steep: grey-brown, banded along its strata, fractured.
        float rockK = smoothstep(0.35, 0.75, steep + (world_noise(w / 7.0) - 0.5) * 0.4);
        float strataK = 1.0 - smoothstep(0.01, 0.05, pxM);   // banding only where a band is many pixels tall
        float strata = mix(0.5, world_noise(float2(wp.y * 0.6 + world_fbm(w / 21.0, 2) * 6.0, w.x * 0.01)), 0.55 * strataK) + 0.25 * (world_fbm(w / 5.0, 2) - 0.5);
        float2 cr = world_cells(w / 2.3);
        float crack = smoothstep(0.0, 0.08, cr.y - cr.x);
        float3 rock = float3(0.17, 0.155, 0.14) * (0.65 + 0.5 * strata) * (0.75 + 0.25 * crack);
        a = mix(a, rock, rockK);
        s.rough = mix(1.0, 0.75, rockK);
        s.ao = mix(1.0, 0.6 + 0.4 * crack, rockK * midK) * mix(1.0, 0.85 + 0.15 * clump, green * midK);
    } else {
        float sparkle = world_noise(w / 0.15);
        a *= 0.92 + 0.12 * sparkle * nearK + 0.08 * macro;
        s.rough = 0.7;
    }
    s.albedo = a;
    // The bump: 4 m and 1 m near.
    float3 n = n0;
    if (dist < 400.0) {
        float e = 0.3;
        float b = world_noise(w / 4.0), bx = world_noise((w + float2(e, 0)) / 4.0), bz = world_noise((w + float2(0, e)) / 4.0);
        float amp = (0.35 + 1.1 * steep) * (1.0 - smoothstep(60.0, 400.0, dist));
        n = normalize(n + float3(-(bx - b), 0.0, -(bz - b)) * (amp / e));
        if (midK > 0) {
            float e2 = 0.08, c0 = world_noise(w / 1.1), cx = world_noise((w + float2(e2, 0)) / 1.1), cz = world_noise((w + float2(0, e2)) / 1.1);
            n = normalize(n + float3(-(cx - c0), 0.0, -(cz - c0)) / e2 * 0.18 * midK * (0.5 + steep));
        }
    }
    s.n = n;
    return s;
}

fragment float4 cg_world_terrain_fragment(WTerrainOut in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]],
                                          constant WDrive& dr [[buffer(5)]], depth2d<float> shadow [[texture(3)]], texture2d<float> skyView [[texture(8)]]) {
    if (dr.params.z > 0.5) {   // debug (`-fd-lod`): each level its own colour, with the stored albedo
        float3 lc[8] = { float3(1,0,0), float3(0,1,0), float3(0,0,1), float3(1,1,0), float3(0,1,1), float3(1,0,1), float3(1,1,1), float3(0.5,0.5,0.5) };
        return float4(lc[int(clamp(in.level, 0.0, 7.0))] * 0.05 + in.col.rgb * 0.3, 1);
    }
    float3 n = normalize(in.n + 1e-6);
    bool water = in.col.a > 0.998;   // (the byte's 255; below it, the road's distance: 0228)
    float dist = distance(in.world, f.eye.xyz);
    float2 w = in.world.xz + dr.anchor.xy;
    float pxM = dist * 2.0 / max(f.proj.y * f.proj.w, 1.0);   // metres one pixel spans at this distance
    WSurf s = world_surf(in.col.rgb, n);
    if (!water) {
        s = world_land(in.col.rgb, n, in.world, w, dist, pxM);
        if (dist >= 300.0) {
            // Far off (0226): a mountainside is drawn with 32–512 m triangles. A 48 m relief in the normal and a 128 / 512 m
            // tone break their flat planes into ridges and gullies, fading into the haze.
            float far = smoothstep(300.0, 700.0, dist) * (1.0 - smoothstep(5000.0, 9000.0, dist));
            float steep = clamp((1.0 - n.y) * 2.5, 0.0, 1.0);
            s.albedo *= mix(1.0, 0.8 + 0.25 * world_noise(w / 128.0) + 0.15 * world_noise(w / 512.0), far);
            float e = 4.0, b = world_noise(w / 48.0), bx = world_noise((w + float2(e, 0)) / 48.0), bz = world_noise((w + float2(0, e)) / 48.0);
            s.n = normalize(s.n + float3(-(bx - b), 0.0, -(bz - b)) / e * 48.0 * (0.15 + 0.35 * steep) * far);
        }
        s.ao *= world_carAO(in.world, dr);
    } else {
        float t = dr.params.y;
        float wv = world_noise(w / 9.0 + t * 0.05) - world_noise(w / 9.0 - t * 0.04 + 5.0);
        s.n = normalize(float3(sin(in.world.x * 0.21 + t * 0.6) * 0.03 + wv * 0.04, 1.0, cos(in.world.z * 0.17 + t * 0.5) * 0.03 + wv * 0.03));
        s.spec = 0.85; s.rough = 0.05;
    }
    float3 c = world_light(s, in.world, in.lightClip, f, k, dr, shadow, skyView);
    return float4(world_air(c, in.world, f, k, skyView), 1);
}

// --- Roads -------------------------------------------------------------------------------------------------------------
struct WRoadIn { float3 pos [[attribute(0)]]; float2 la [[attribute(1)]]; float3 n [[attribute(2)]]; float4 col [[attribute(3)]]; };
struct WRoadOut { float4 clip [[position]]; float3 world; float2 la; float3 n; float3 col; float4 lightClip; };
vertex WRoadOut cg_world_road_vertex(WRoadIn in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WTile& t [[buffer(2)]]) {
    float3 p = in.pos + t.offset.xyz;
    WRoadOut o; o.world = p; o.la = in.la; o.n = in.n; o.col = in.col.rgb;
    o.clip = f.viewProj * float4(p, 1); o.lightClip = f.lightViewProj * float4(p, 1);
    return o;
}
// The road (0228): a used two-lane asphalt. Its aggregate (stones a few centimetres across, some pale), the binder's tone in
// patches and repairs, sealed cracks and the centre joint as glossy tar lines, the two wheel tracks in each lane polished
// darker and smoother (they glint toward a low sun), an oil line down each lane's middle, dust toward the edges, and the
// paint worn through where the tyres cross it. Then the gravel shoulder and the verge in the land's colour.
fragment float4 cg_world_road_fragment(WRoadOut in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]],
                                       constant WDrive& dr [[buffer(5)]], depth2d<float> shadow [[texture(3)]], texture2d<float> skyView [[texture(8)]]) {
    float lat = in.la.x, along = in.la.y, al = abs(lat);
    const float hw = 3.5;
    float dist = distance(in.world, f.eye.xyz);
    float pxM = dist * 2.0 / max(f.proj.y * f.proj.w, 1.0);
    float2 w = in.world.xz + dr.anchor.xy;
    float2 ra = float2(lat, along);
    // (quality < 2, anchor.w: the drive's extras cut back, 0228: no stones, no cracks)
    float hiQ = dr.anchor.w >= 2.0 ? 1.0 : 0.0;
    float fine = (1.0 - smoothstep(0.004, 0.02, pxM)) * hiQ, mid = 1.0 - smoothstep(0.03, 0.12, pxM);
    float3 n = normalize(in.n + 1e-6);
    WSurf s = world_surf(float3(0), n);
    float3 asphalt = float3(0.062, 0.061, 0.064);
    // Patches of older (paler, greyer) and newer (darker) binder.
    float age = world_fbm(ra / float2(5.0, 23.0) + 7.0, 3);
    asphalt *= 0.78 + 0.5 * age;
    // Repairs: now and then a rectangle where the road's been cut and relaid, darker, edged by a tar seam.
    float cellA = floor(along / 11.0), rnd = world_hash(float2(cellA, 3.7));
    float pL0 = (world_hash(float2(cellA, 9.1)) - 0.5) * 4.0, pL1 = pL0 + 1.2 + world_hash(float2(cellA, 1.3)) * 2.2;
    float pA = fract(along / 11.0) * 11.0, pA0 = 1.0 + world_hash(float2(cellA, 5.5)) * 3.0, pA1 = pA0 + 2.0 + world_hash(float2(cellA, 2.2)) * 4.0;
    float isP = step(0.72, rnd);
    float inPatch = isP * step(pL0, lat) * step(lat, pL1) * step(pA0, pA) * step(pA, pA1);
    float near = min(min(abs(lat - pL0), abs(lat - pL1)), min(abs(pA - pA0), abs(pA - pA1)));
    float patchEdge = isP * (1.0 - smoothstep(0.0, 0.05 + pxM, near)) * step(pL0 - 0.06, lat) * step(lat, pL1 + 0.06) * step(pA0 - 0.06, pA) * step(pA, pA1 + 0.06);
    asphalt = mix(asphalt, float3(0.035, 0.036, 0.04), inPatch * 0.85);
    // Wheel tracks: two per lane (± 0.8 m about each lane's centre at ± 1.75 m), polished and a shade darker; an oil line between.
    float lane = abs(al - 1.75);
    float track = (1.0 - smoothstep(0.18, 0.42, abs(lane - 0.8))) * (1.0 - smoothstep(hw - 0.4, hw, al));
    float oil = (1.0 - smoothstep(0.1, 0.45, lane)) * (0.6 + 0.4 * world_noise(ra / float2(0.5, 3.0)));
    asphalt *= 1.0 - 0.07 * track - 0.15 * oil * (1.0 - track);
    // Aggregate: stones at 2–4 cm (some pale quartz), fading out with the pixel's footprint.
    float stone = 0;
    if (fine > 0) { float2 st = world_cells(w / 0.018); stone = smoothstep(0.38, 0.16, st.x); }
    float pale = step(0.9, world_hash(floor(w / 0.018)));
    float grain = world_noise(w / 0.006);
    asphalt *= mix(1.0, 0.9 + 0.14 * stone + 0.55 * pale * stone + 0.12 * (grain - 0.5), fine);
    asphalt *= mix(1.0, 0.9 + 0.2 * world_noise(w / 0.22), mid);
    // Cracks, sealed with tar: thin, meandering, glossy black; and the centre joint.
    float crack = 0;
    if (mid * hiQ > 0) {
        float2 cr = world_cells(ra / float2(1.6, 2.4) + world_fbm(ra / 0.9, 2) * 0.6);
        float crackW = 0.035 + pxM * 0.6;
        crack = (1.0 - smoothstep(0.0, crackW, cr.y - cr.x)) * smoothstep(0.55, 0.75, world_fbm(ra / float2(4.0, 9.0) + 1.0, 2)) * mid;
    }
    float joint = (1.0 - smoothstep(0.02, 0.05 + pxM, abs(lat))) * 0.7;
    float tar = max(max(crack, joint * mid), patchEdge * 0.9);
    asphalt = mix(asphalt, float3(0.012, 0.012, 0.014), tar);
    // Dust and grit toward the edges.
    float dust = smoothstep(hw - 1.1, hw - 0.2, al) * (0.5 + 0.5 * world_noise(ra / float2(0.7, 2.0)));
    asphalt = mix(asphalt, float3(0.11, 0.098, 0.082), dust * 0.55);
    // The shoulder's gravel and the verge (0226's: the land's colour, out to it).
    float3 gravel = float3(0.17, 0.155, 0.13) * (0.7 + 0.5 * world_noise(w / 0.09) * fine + 0.3 * world_noise(w / 0.9));
    float shoulder = smoothstep(hw - 0.02, hw + 0.02 + pxM, al);
    float3 albedo = mix(asphalt, gravel, shoulder);
    if (al > hw + 1.2) {
        WSurf land = world_land(in.col, n, in.world, w, dist, pxM);
        float k2 = smoothstep(hw + 1.2, hw + 2.4 + (world_noise(w / 1.3) - 0.5) * 1.2, al);
        albedo = mix(albedo, land.albedo, k2);
        n = normalize(mix(n, land.n, k2));
    }
    // The markings (EU): solid edge lines, a dashed centre line (3 m on, 9 m off), worn through where the tyres run and
    // chipped along their edges. Antialiased by their own width on screen; faded far off where they'd shimmer.
    float wl = max(fwidth(lat), 1e-3), wa = max(fwidth(along), 1e-3);
    float edge = smoothstep(0.12 + wl, 0.12 - wl, abs(al - (hw - 0.3)));
    float dash = smoothstep(0.075 + wl, 0.075 - wl, al) * smoothstep(0.25 + wa / 12.0, 0.25 - wa / 12.0, abs(fract(along / 12.0) - 0.125) * 2.0);
    float fade = 1.0 - smoothstep(300.0, 900.0, dist);
    float wear = world_noise(ra / float2(0.09, 0.3)) * 0.6 + world_noise(ra / float2(0.6, 2.5)) * 0.4;
    float keep = mix(1.0, smoothstep(0.18, 0.42, wear + 0.15 - track * 0.35), mid);
    float mk = max(edge, dash) * fade * keep;
    float3 paint = float3(0.66, 0.66, 0.63);
    albedo = mix(albedo, paint * (0.85 + 0.15 * grain), mk);
    // The bump: the stones near, from the stone mask's own screen derivatives (no extra taps).
    if (fine > 0 && shoulder < 0.5) {
        float3 dpx = dfdx(in.world), dpy = dfdy(in.world);
        float2 g2 = float2(dfdx(stone), dfdy(stone));
        float3 grad = (cross(dpy, n) * g2.x + cross(n, dpx) * g2.y) / max(abs(dot(dpx, cross(dpy, n))), 1e-8);
        n = normalize(n - grad * 0.004 * (1.0 - mk) * fine);
    }
    s.albedo = albedo; s.n = n;
    // Roughness: open asphalt is rough, the tracks and the tar smoother, the paint a little smoother still.
    s.rough = mix(mix(0.82 - 0.14 * track, 0.42, tar), 0.6, mk);
    s.rough = mix(s.rough, 1.0, shoulder);
    s.ao = (1.0 - 0.15 * stone * fine * (1.0 - mk)) * world_carAO(in.world, dr);
    float3 c = world_light(s, in.world, in.lightClip, f, k, dr, shadow, skyView);
    // Painted lines are retroreflective: the headlamps come back off them.
    if (dr.lampPos.w > 0 && mk > 0) {
        float3 d = dr.lampPos.xyz - in.world; float dl = max(length(d), 1.0);
        float cone = smoothstep(dr.lampDir.w - 0.05, dr.lampDir.w + 0.06, dot(-d / dl, dr.lampDir.xyz)); cone *= cone;
        c += paint * mk * cone * dr.lampPos.w * 0.02 / dl * (1.0 - smoothstep(60.0, 160.0, dl));
    }
    return float4(world_air(c, in.world, f, k, skyView), 1);
}

// --- Props (instanced; the stage's 44-byte vertex: pos, nrm, uv, col) -----------------------------------------------------
struct WPropIn { float3 pos [[attribute(0)]]; float3 nrm [[attribute(1)]]; float2 uv [[attribute(2)]]; float3 col [[attribute(3)]]; };
struct WInst { float4 posYaw; float4 scaleTint; };   // xyz relative to the block's corner, yaw; scale, tint
struct WPropOut { float4 clip [[position]]; float3 world; float3 n; float3 col; float glow; float4 lightClip; float seed; };
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
    // The wind (0228): crowns sway, more toward the top, each tree on its own phase; trunks, rocks and posts stay put.
    float green = clamp((in.col.g - max(in.col.r, in.col.b)) * 40.0, 0.0, 1.0);
    float sway = dr.params.w * green * max(lp.y - 1.0, 0.0) * 0.012;
    float ph = I.posYaw.x * 0.37 + I.posYaw.z * 0.23, tm = dr.params.y;
    lp.x += sway * (sin(tm * 1.3 + ph) + 0.4 * sin(tm * 3.1 + ph * 2.0));
    lp.z += sway * 0.6 * cos(tm * 1.1 + ph * 1.3);
    nOut = float3(in.nrm.x * c + in.nrm.z * sn, in.nrm.y, -in.nrm.x * sn + in.nrm.z * c);
    return float3(lp.x * c + lp.z * sn, lp.y, -lp.x * sn + lp.z * c) + base;
}
vertex WPropOut cg_world_prop_vertex(WPropIn in [[stage_in]], uint iid [[instance_id]], constant WFrame& f [[buffer(1)]], constant WTile& t [[buffer(2)]],
                                     constant WInst* inst [[buffer(3)]], constant WDrive& dr [[buffer(5)]]) {
    WInst I = inst[iid];
    float3 n;
    float3 p = world_propPos(in, I, f, t, dr, n);
    WPropOut o; o.world = p; o.n = n; o.col = in.col * I.scaleTint.y; o.glow = in.uv.x; o.seed = I.posYaw.x * 1.31 + I.posYaw.z * 0.77;
    o.clip = f.viewProj * float4(p, 1); o.lightClip = f.lightViewProj * float4(p, 1);
    return o;
}
// The props into the key light's shadow map (0228): trees, rocks and the roadside cast on the road, the land and the car.
vertex float4 cg_world_prop_shadow_vertex(WPropIn in [[stage_in]], uint iid [[instance_id]], constant WFrame& f [[buffer(1)]], constant WTile& t [[buffer(2)]],
                                          constant WInst* inst [[buffer(3)]], constant WDrive& dr [[buffer(5)]]) {
    WInst I = inst[iid];
    float3 n;
    float3 p = world_propPos(in, I, f, t, dr, n);
    return f.lightViewProj * float4(p, 1);
}
fragment float4 cg_world_prop_fragment(WPropOut in [[stage_in]], bool front [[front_facing]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]],
                                       constant WDrive& dr [[buffer(5)]], depth2d<float> shadow [[texture(3)]], texture2d<float> skyView [[texture(8)]]) {
    float3 n = normalize(in.n + 1e-6);
    if (!front) n = -n;
    float3 col = in.col;
    WSurf s = world_surf(col, n);
    float green = clamp((col.g - max(col.r, col.b)) * 40.0, 0.0, 1.0);
    if (green > 0) {
        // Foliage: each tree its own hue (some yellower, some bluer), lit softly through (wrap) and from behind (transmission),
        // and a leafy grain so a crown's facets break into clusters.
        float hue = world_hash(float2(in.seed, 1.7));
        float3 tint = mix(float3(0.92, 1.0, 0.82), float3(1.25, 1.08, 0.72), hue);
        float cl = world_noise(in.world.xz * 2.3 + in.world.y * 1.7);
        s.albedo = col * mix(float3(1), tint * (0.75 + 0.5 * cl), green);
        s.wrap = 0.45 * green; s.trans = 0.55 * green;
        s.ao = 0.75 + 0.25 * cl;
    } else {
        // Bark, stone and timber: a grain along their height.
        float g = world_noise(float2(in.world.x * 3.0 + in.world.z * 3.0, in.world.y * 12.0));
        s.albedo = col * (0.85 + 0.3 * g);
        s.rough = 0.85;
    }
    s.ao *= world_carAO(in.world, dr);
    float3 c = world_light(s, in.world, in.lightClip, f, k, dr, shadow, skyView);
    if (in.glow > 0.5 && dr.lampPos.w > 0) {   // a delineator's reflector: it lights up in the headlamps, from far off
        float3 d = dr.lampPos.xyz - in.world; float dist = max(length(d), 1.0);
        float cone = smoothstep(dr.lampDir.w - 0.25, dr.lampDir.w, dot(-d / dist, dr.lampDir.xyz));
        c += float3(1.0, 0.72, 0.35) * cone * dr.lampPos.w * 0.5 / (dist * 2.0) * (1.0 - smoothstep(220.0, 400.0, dist));
    }
    return float4(world_air(c, in.world, f, k, skyView), 1);
}

// --- Loose things (0223: cones, barriers, signs; a full pose each, they tip and roll) --------------------------------------
struct WLooseInst { float4x4 m; float4 tint; };
vertex WPropOut cg_world_loose_vertex(WPropIn in [[stage_in]], uint iid [[instance_id]], constant WFrame& f [[buffer(1)]],
                                      constant WLooseInst* inst [[buffer(3)]]) {
    WLooseInst I = inst[iid];
    float3 p = (I.m * float4(in.pos, 1)).xyz;
    WPropOut o; o.world = p; o.n = (I.m * float4(in.nrm, 0)).xyz; o.col = in.col * I.tint.rgb; o.glow = in.uv.x; o.seed = 0;
    o.clip = f.viewProj * float4(p, 1); o.lightClip = f.lightViewProj * float4(p, 1);
    return o;
}

// --- Skid marks (0223): rubber on the ground, blended over it, hazed with distance ----------------------------------------
struct WMarkIn { float4 pa [[attribute(0)]]; };
struct WMarkOut { float4 clip [[position]]; float3 world; float a; };
vertex WMarkOut cg_world_mark_vertex(WMarkIn in [[stage_in]], constant WFrame& f [[buffer(1)]]) {
    WMarkOut o; o.world = in.pa.xyz; o.a = in.pa.w; o.clip = f.viewProj * float4(in.pa.xyz, 1);
    return o;
}
fragment float4 cg_world_mark_fragment(WMarkOut in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]], texture2d<float> skyView [[texture(8)]]) {
    // Rubber is near black and polished smooth by the slide: darker than asphalt, and on the stage's black floor it reads
    // by the sky's faint sheen along it.
    float3 c = world_air(float3(0.004, 0.004, 0.005) + k.skyHorizon.rgb * 0.08, in.world, f, k, skyView);
    float fade = 1.0 - smoothstep(120.0, 260.0, distance(in.world, f.eye.xyz));
    return float4(c, clamp(0.25 + in.a, 0.0, 1.0) * 0.8 * fade);
}

// --- Grass (0228): blades on the ground near the eye ------------------------------------------------------------------------
// Each instance a clump of five blades (one tapered triangle each) on a jittered grid over a finest-level terrain tile. The
// ground's height, normal, colour and the road's distance come from the tile's own vertices (its 4 m grid, the split the
// tile's triangles use), so a clump stands exactly on the land drawn. None on the road, its shoulder and gravel, on water,
// rock, snow or the set's slab; thinner and shorter with distance, gone by the radius; bent by the wind.
struct WGrass { float4 offset; int4 cells; float4 params; };   // offset: the tile's corner − origin; cells: i0, j0, columns, —; params: spacing, radius, density, —
struct WGrassOut { float4 clip [[position]]; float3 world; float3 n; float3 col; float tip; float4 lightClip; };
vertex WGrassOut cg_world_grass_vertex(uint vid [[vertex_id]], uint iid [[instance_id]], constant WFrame& f [[buffer(1)]],
                                        constant WGrass& g [[buffer(2)]], const device float* tile [[buffer(0)]], constant WDrive& dr [[buffer(5)]]) {
    WGrassOut o;
    o.clip = float4(2, 2, 2, 1); o.world = 0; o.n = float3(0, 1, 0); o.col = 0; o.tip = 0; o.lightClip = 0;
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
    float green = clamp((col.g - max(col.r, col.b)) * 30.0, 0.0, 1.0);
    if (col.r > col.g * 1.3 || dot(col, float3(0.33)) > 0.3) return o;  // sand, desert, snow, concrete
    // The verge's ribbon lies on the exact ground over a dip in the tile (0226): stand on the ribbon, not in the dip.
    y += 0.22 * (1.0 - smoothstep(10.7 - 2.0, 10.7, road));
    // A patchy meadow: tall tufts here, short turf there.
    float2 wp = cellW;
    float patch = world_noise(wp / 7.0) * 0.7 + world_noise(wp / 1.7) * 0.3;
    float tall = (0.12 + 0.42 * smoothstep(0.25, 0.85, patch)) * (0.7 + 0.6 * h0) * mix(0.55, 1.0, keep);
    tall *= smoothstep(5.4, 7.0, road);                                   // mown short by the shoulder
    // The blade: five round the clump, each a triangle leaning out, the wind bending its tip.
    uint blade = vid / 3, corner = vid % 3;
    float ang = (float(blade) + h1 * 5.0) * 1.2566 + h0 * 6.28;
    float2 dir = float2(cos(ang), sin(ang));
    float bw = 0.03 + 0.03 * h2, lean = 0.35 + 0.4 * world_hash(float2(float(blade), h0 * 31.0));
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
    // Its colour: the land's green, lighter and yellower at the tip, drier in the dry patches.
    float dry = smoothstep(0.45, 0.75, world_fbm(wp / 23.0 + 11.0, 3));
    o.col = mix(col * float3(0.9, 1.15, 0.8), float3(0.2, 0.17, 0.08), dry * 0.6) * (0.75 + 0.5 * h2);
    o.clip = f.viewProj * float4(w, 1); o.lightClip = f.lightViewProj * float4(w, 1);
    return o;
}
fragment float4 cg_world_grass_fragment(WGrassOut in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]],
                                        constant WDrive& dr [[buffer(5)]], depth2d<float> shadow [[texture(3)]], texture2d<float> skyView [[texture(8)]]) {
    WSurf s = world_surf(in.col * (0.55 + 0.75 * in.tip), normalize(in.n));
    s.wrap = 0.6; s.trans = 0.8;
    s.ao = (0.45 + 0.55 * in.tip) * world_carAO(in.world, dr);
    float3 c = world_light(s, in.world, in.lightClip, f, k, dr, shadow, skyView);
    return float4(world_air(c, in.world, f, k, skyView), 1);
}
