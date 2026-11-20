// The stage's look in Metal (docs/NATIVE.md §4, 0153, 0163): physically based materials from the web's own (colour,
// roughness, metalness, clear coat, emissive, their maps), the course's lights (spots and points with three's inverse-
// square falloff), the key light with a shadow map, the course's environment as a prefiltered cube (three's PMREM read back)
// and its hemisphere, three's fog, film.js's height fog, the wet slab; then bloom and the film pass (exposure, tone,
// vignette) into an LDR target that MetalFX upscales. One namespace, no duplicate names (moon-club); every
// input to pow/sqrt/normalize is clamped (LESSONS: one NaN pixel is a flicker storm).
#include <metal_stdlib>
using namespace metal;
#include "SetSurface.h"
#include "Sky.h"
#include "../World/Water.h"

struct Frame {
    float4x4 viewProj, lightViewProj;
    float4 eye;                 // xyz, time
    float4 keyDir;              // towards the light, xyz; w intensity
    float4 keyColor;            // rgb; w nLights
    float4 fogColor;            // rgb; w enabled
    float4 fogRange;            // near, far, exposure, shadowTexel
    float4x4 invViewProj;
    float4 proj;                // P00, P11, render width, render height
    float4 misc;                // x: this is the mirror's draw; y: the slab has a mirror to read; zw: 1 / render size
    float4 style;               // the look (0280, Look.swift): x 0 Real, 1 Anime, 2 8-bit; y, z the projection's z scale and offset
                                // (depth → distance for the ink); w anime's speed lines (0…1)
    float4 fx;                  // 0290: x anime's impact frame (0…1); yz the moon's bearing (unit xz), w 1 when set
    float4x4 worldShadowVP;     // 0310: Free Drive's cached world shadow (trees, rocks, the near land), render space
    float4 worldShadow;         // x 1 when it's drawn; y its texel
    float4 matter[6];           // 0332: what the ground left on the car (CarMatter.h); matter[0].w 0: none
    float4 splash;              // 0353: a set's splash-down: xz where (render space), z its age (s), w how hard (0: none)
    float4 wade;                // 0353: the car in a set's tank: xz where, z its speed (m/s), w 1 while it's in the water
};
#include "CarMatter.h"
// What doesn't change in a course (Renderer.lookU).
struct LookU {
    float4 hemiSky;             // three's hemisphere light, rgb × intensity; w: the environment's intensity (0: no cube fetches)
    float4 hemiGround;          // rgb; w: the sky (0 the night's, 1 the dusk's)
    float4 hazeCol;             // film.js fogCol; w: fogA (0: no height fog)
    float4 sunCol;              // film.js sunCol; w: fogB
    float4 sunDir;              // film.js sunDir; w: vignette
    float4 fogExp;              // x: FogExp2's density (0: linear, fogRange); y: 1 with the wet slab on; z: 1 with the stars on; w: bloom on
    float4 skyZenith, skyMid, skyHorizon, skySun;
    float4 bloom;               // threshold, and UnrealBloomPass's strength × each level's factor (three levels' worth; see compose)
    float4 atmo;                // Free Drive's physical sky (0231, 0310): x on, y haze, z the eye's height (km), w night
    float4 sunE;                // the sun's illuminance at the top of the air (rgb), time
};
struct Light { float4 posRange; float4 colorIntensity; float4 dirCos; float4 params; };   // params: decay, cosOuter, kind (0 point, 1 spot), penumbra
struct Material {
    float4 color;               // linear rgb, opacity
    float4 emissive;            // rgb; w unlit
    float4 pbr;                 // metalness, roughness, clearcoat, clearcoatRoughness
    float4 uvTransform;         // repeat xy, offset zw
    uint4 flags;                // hasMap, hasRough, hasEmissiveMap, vertexColors | fog << 1
    float4 effect;              // the web ShaderMaterial's colour, power
    uint4 effectKind;           // x: 0 none, 1 beam, 2 glow decal, 3 spill, 4 a flood bank's beam; y: has alphaMap; z: wet; w: additive
};
struct Object { float4x4 model; float4x4 normal; };

struct VIn { float3 pos [[attribute(0)]]; float3 nrm [[attribute(1)]]; float2 uv [[attribute(2)]]; float3 col [[attribute(3)]]; };
struct VOut { float4 clip [[position]]; float3 world; float3 nrm; float2 uv; float3 col; float4 lightClip; };

vertex VOut cg_stage_vertex(VIn in [[stage_in]], constant Frame& f [[buffer(1)]], constant Object& o [[buffer(2)]]) {
    VOut v;
    float4 w = o.model * float4(in.pos, 1);
    v.world = w.xyz;
    v.nrm = (o.normal * float4(in.nrm, 0)).xyz;
    v.uv = in.uv; v.col = in.col;
    v.clip = f.viewProj * w;
    v.lightClip = f.lightViewProj * w;
    return v;
}
vertex float4 cg_shadow_vertex(VIn in [[stage_in]], constant Frame& f [[buffer(1)]], constant Object& o [[buffer(2)]]) {
    return f.lightViewProj * (o.model * float4(in.pos, 1));
}

constexpr sampler envSampler(coord::normalized, filter::linear, mip_filter::linear, address::clamp_to_edge);
// film.js HAZE_FS's fog, integrated along the ray (L metres, unit d): thick on the slab, thin above, and the sun's forward scatter.
static float3 hazed(float3 c, float3 d, float L, float3 eye, constant LookU& k) {
    float a = k.hazeCol.w;
    if (a <= 0) return c;
    float b = k.sunCol.w, dens = a * exp(-b * eye.y), dy = d.y * b;
    float tau = abs(dy) > 1e-4 ? dens * (1.0 - exp(-clamp(dy * L, -12.0, 12.0))) / dy : dens * L;
    float fog = 1.0 - exp(-clamp(tau, 0.0, 12.0));
    float sun = pow(max(dot(d, k.sunDir.xyz), 0.0), 6.0);
    return mix(c, k.hazeCol.rgb + k.sunCol.rgb * sun, fog);
}
// The drawn looks' air (0290): the same haze in four flat layers of depth (a painted background's), not a gradient across a
// surface: the curl, the floor and the set each take one even tint. Eased over about a pixel in Anime, hard in 8-bit.
static float3 hazedDrawn(float3 c, float3 d, float L, float3 eye, constant LookU& k, bool pixel) {
    float a = k.hazeCol.w;
    if (a <= 0) return c;
    float b = k.sunCol.w, dens = a * exp(-b * eye.y), dy = d.y * b;
    float tau = abs(dy) > 1e-4 ? dens * (1.0 - exp(-clamp(dy * L, -12.0, 12.0))) / dy : dens * L;
    float fog = (1.0 - exp(-clamp(tau, 0.0, 12.0))) * 4.0;
    float w = pixel ? 1e-3 : clamp(fwidth(fog), 0.01, 0.5);
    float fl = floor(fog), q = (fl + smoothstep(1.0 - w, 1.0, fog - fl)) / 4.0;
    float sun = pow(max(dot(d, k.sunDir.xyz), 0.0), 6.0);
    return mix(c, k.hazeCol.rgb + k.sunCol.rgb * sun, q);
}
// The most one set lamp lights the car with (0270): ≈ 1.8× the Show's key (1.7), so white paint under two of them stays under
// the tone curve's shoulder (AgX) and the car keeps its shape.
constant float HERO_LUX = 3.0;
static float ggx(float nh, float a) { float a2 = max(a * a, 1e-4), d = nh * nh * (a2 - 1.0) + 1.0; return a2 / max(M_PI_F * d * d, 1e-6); }
static float3 brdf(float3 n, float3 v, float3 l, float3 base, float metal, float rough, float3 radiance, float cc, float ccRough) {
    float3 h = normalize(l + v + 1e-6);
    float nl = clamp(dot(n, l), 0.0, 1.0), nv = clamp(dot(n, v), 1e-3, 1.0), nh = clamp(dot(n, h), 0.0, 1.0), vh = clamp(dot(v, h), 0.0, 1.0);
    if (nl <= 0) return 0;
    float r = clamp(rough, 0.045, 1.0), a = r * r;
    float3 f0 = mix(float3(0.04), base, metal);
    float3 F = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
    float k = (r + 1.0) * (r + 1.0) / 8.0;
    float G = (nl / (nl * (1.0 - k) + k)) * (nv / (nv * (1.0 - k) + k));
    float3 spec = ggx(nh, a) * F * G / max(4.0 * nl * nv, 1e-4);
    float3 kd = (1.0 - F) * (1.0 - metal);
    float3 c = (kd * base / M_PI_F + spec) * radiance * nl;
    if (cc > 0) {   // three's BRDF_GGX_Clearcoat: GGX with the height-correlated Smith visibility
        float ca = max(clamp(ccRough, 0.03, 1.0), 0.03), a2 = ca * ca * ca * ca, Fc = 0.04 + 0.96 * pow(1.0 - vh, 5.0);
        float gv = nl * sqrt(a2 + (1.0 - a2) * nv * nv), gl = nv * sqrt(a2 + (1.0 - a2) * nl * nl);
        c += cc * Fc * ggx(nh, ca * ca) * (0.5 / max(gv + gl, 1e-4)) * radiance * nl;
    }
    return c;
}
// --- The drawn looks' light (0290, Look.swift) ------------------------------------------------------------------------------
// Anime and 8-bit light a surface through a ramp instead of a BRDF. `T` is the light falling on it as a factor of its albedo
// (the direct light's irradiance / π plus the ambient: what Real's diffuse multiplies the colour by), before exposure. Its
// brightness picks a band: deep, shadow, mid or lit, each a fixed level of the material's own colour, so a lamp that would
// blow the paint to white lights it to the lit band and no further. The shadows take a cool violet tint (never grey), the
// lit band the light's own hue (a red lamp's pool reads red). Returned before exposure (the film multiplies it back).
constant float3 LUMA = float3(0.2126, 0.7152, 0.0722);
constant float3 CEL_SHADOW = float3(0.70, 0.76, 1.45);   // the shadows' violet-blue (luma ≈ 0.8)
// 8-bit's palette (0290): 32 fixed colours (sRGB) for this game at night: seven night blues (0–6), six neutrals for concrete and
// the white car (7–12), six reds for the loop, the LEDs and the lamps (13–18), five warms for sparks, dust and the dusk (19–23),
// four greens for Free Drive's land (24–27), three dusk violets (28–30) and the jets' ice blue (31). PAL_LAB is each in Oklab,
// where the film pass finds the nearest (scratch tool: an sRGB → Oklab conversion of the list above).
constant float3 PAL_SRGB[32] = {
    float3(0.0392, 0.0314, 0.0706), float3(0.0824, 0.0902, 0.1686), float3(0.1255, 0.1647, 0.2902), float3(0.1843, 0.2471, 0.4314),
    float3(0.2902, 0.3725, 0.5882), float3(0.4392, 0.5333, 0.7529), float3(0.6510, 0.7294, 0.8745), float3(0.1686, 0.1686, 0.2078),
    float3(0.2941, 0.2941, 0.3451), float3(0.4549, 0.4549, 0.4980), float3(0.6392, 0.6392, 0.6784), float3(0.8235, 0.8235, 0.8471),
    float3(0.9843, 0.9843, 0.9647), float3(0.2039, 0.0314, 0.1020), float3(0.3922, 0.0627, 0.1216), float3(0.6275, 0.1059, 0.1647),
    float3(0.8627, 0.1725, 0.2118), float3(1.0000, 0.4000, 0.3137), float3(1.0000, 0.6824, 0.6275), float3(0.2431, 0.1412, 0.0941),
    float3(0.4784, 0.2902, 0.1725), float3(0.7804, 0.5059, 0.2353), float3(0.9647, 0.7725, 0.3529), float3(1.0000, 0.9412, 0.7490),
    float3(0.0745, 0.1647, 0.1137), float3(0.1451, 0.3137, 0.1725), float3(0.3098, 0.5098, 0.2157), float3(0.5961, 0.7490, 0.3608),
    float3(0.1804, 0.1020, 0.2706), float3(0.3529, 0.1961, 0.4549), float3(0.6392, 0.3608, 0.5804), float3(0.4745, 0.8471, 0.9490) };
constant float3 PAL_LAB[32] = {
    float3(0.1430, 0.0086, -0.0202), float3(0.2137, 0.0056, -0.0390), float3(0.2930, -0.0007, -0.0601), float3(0.3784, -0.0028, -0.0831),
    float3(0.4939, -0.0045, -0.0920), float3(0.6307, -0.0061, -0.0891), float3(0.7863, -0.0073, -0.0569), float3(0.2933, 0.0047, -0.0174),
    float3(0.4178, 0.0057, -0.0207), float3(0.5627, 0.0046, -0.0162), float3(0.7186, 0.0040, -0.0138), float3(0.8655, 0.0023, -0.0079),
    float3(0.9867, -0.0019, 0.0063), float3(0.2233, 0.0722, -0.0001), float3(0.3314, 0.1108, 0.0341), float3(0.4590, 0.1547, 0.0619),
    float3(0.5827, 0.1912, 0.0864), float3(0.7010, 0.1642, 0.0973), float3(0.8253, 0.0847, 0.0492), float3(0.2906, 0.0316, 0.0319),
    float3(0.4582, 0.0488, 0.0617), float3(0.6632, 0.0557, 0.1069), float3(0.8470, 0.0133, 0.1348), float3(0.9551, -0.0035, 0.0650),
    float3(0.2615, -0.0355, 0.0147), float3(0.3899, -0.0650, 0.0414), float3(0.5528, -0.0874, 0.0822), float3(0.7546, -0.0814, 0.1075),
    float3(0.2681, 0.0429, -0.0662), float3(0.3983, 0.0735, -0.0870), float3(0.5751, 0.1071, -0.0493), float3(0.8331, -0.0768, -0.0592) };
static float3 celRamp(float3 base, float3 T, float exposure, bool pixel) {
    float I = max(dot(T, LUMA) * exposure, 1e-6);
    float3 hue = T / max(dot(T, LUMA), 1e-6);
    hue = mix(float3(1.0), min(hue, float3(2.2)), 0.75);
    hue /= max(dot(hue, LUMA), 1e-3);
    // The band edges in log brightness, eased over about a pixel (anime) or hard (8-bit: the palette makes the edge).
    float li = log2(I), w = pixel ? 1e-3 : clamp(fwidth(li) * 0.75, 0.02, 0.12);
    float b0 = smoothstep(-6.2 - w, -6.2 + w, li);    // deep → shadow   (I ≈ 0.014)
    float b1 = smoothstep(-3.9 - w, -3.9 + w, li);    // shadow → mid    (I ≈ 0.067)
    float b2 = smoothstep(-2.1 - w, -2.1 + w, li);    // mid → lit       (I ≈ 0.23)
    float3 deep = CEL_SHADOW * 0.08, shade = CEL_SHADOW * 0.15, mid = mix(CEL_SHADOW, hue, 0.55) * 0.36, lit = hue * 0.74;
    float3 k = mix(mix(mix(deep, shade, b0), mid, b1), lit, b2);
    return base * k / max(exposure, 1e-4);
}
// The highlight as a shape: where the GGX lobe passes a level, on panels polished enough to have one (rough concrete none).
static float celBlob(float3 n, float3 v, float3 l, float rough) {
    float3 h = normalize(l + v + 1e-6);
    float nh = clamp(dot(n, h), 0.0, 1.0), nv = clamp(dot(n, v), 0.2, 1.0);
    float r = clamp(rough, 0.08, 1.0), a = r * r;
    float a2 = max(a * a, 1e-4), d = nh * nh * (a2 - 1.0) + 1.0;
    float lobe = a2 / max(M_PI_F * d * d, 1e-6) * 0.25 / nv;
    return smoothstep(0.9, 1.1, lobe) * (1.0 - smoothstep(0.5, 0.7, r));
}

static float shadowAt(float4 lc, depth2d<float> sm, float texel) {
    float3 p = lc.xyz / max(lc.w, 1e-6);
    float2 uv = float2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    if (any(uv < 0.0) || any(uv > 1.0) || p.z > 1.0) return 1.0;
    constexpr sampler cmp(coord::normalized, filter::linear, compare_func::less_equal, address::clamp_to_edge);
    // 2×2 taps, each a hardware bilinear comparison (four depths): a 16-sample soft edge for four fetches.
    float s = 0, bias = 0.0015;
    for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) s += sm.sample_compare(cmp, uv + (float2(x, y) - 0.5) * texel, p.z - bias);
    return s * 0.25;
}

// The dusk sky as the sky pass draws it (scene.js skyMaterial), and below the horizon the land going dark: Free Drive's
// environment out in the world (0225), where the stage's own cube (its lamps and walls) isn't what's round the car.
// `rough` widens the horizon's edge and pulls toward the sky's average, a prefiltered lobe's look without the cube.
static float3 duskEnv(float3 d, float rough, constant LookU& k) {
    float h = clamp(d.y, -1.0, 1.0);
    float3 sun = k.skySun.xyz;
    float3 c = mix(k.skyMid.rgb, k.skyZenith.rgb, smoothstep(0.02, 0.55, h));
    float band = exp(-max(h, 0.0) * mix(14.0, 4.0, rough));
    float3 flat = normalize(float3(d.x, 0.0, d.z) + float3(1e-5, 0.0, 0.0)), sunFlat = normalize(float3(sun.x, 0.0, sun.z) + float3(1e-5, 0.0, 0.0));
    float sunSide = pow(max(dot(flat, sunFlat), 0.0), 3.0);
    c = mix(c, k.skyHorizon.rgb, band * (0.35 + 0.65 * sunSide));
    c += k.skyHorizon.rgb * pow(max(dot(d, sun), 0.0), mix(220.0, 6.0, rough)) * mix(1.4, 0.2, rough);
    float3 land = mix(k.skyHorizon.rgb * 0.12 + k.skyMid.rgb * 0.15, k.hemiGround.rgb * 0.6, smoothstep(0.0, -0.3, h));
    float edge = 0.01 + rough * 0.35;
    c = mix(land, c, smoothstep(-edge, edge, h));
    float3 avg = k.skyMid.rgb * 0.45 + k.skyHorizon.rgb * 0.25 + k.hemiGround.rgb * 0.3;
    return mix(c, avg, clamp(rough * rough, 0.0, 1.0));
}

// The drawn looks' light (0290): the key (its shadow's edge made hard), every set lamp as Real takes it (the car's HERO_LUX cap
// kept), the hemisphere and the environment's diffuse, summed as irradiance and put through the ramp; then a hard highlight
// shape from the brightest light on a polished panel, and a rim on the car (and a faint one on what stands) so the car's
// outline reads against the stage. No reflections, no clear coat, no wet mirror: the paint is flat colour.
static float3 drawnLight(float3 n, float3 V, float3 world, float3 base, float metal, float rough, float sh, bool hero, constant Frame& f,
                         constant Light* lights, constant LookU& look, texturecube<float> env) {
    bool pixel = f.style.x > 1.5;
    float ex = f.fogRange.z;
    sh = smoothstep(0.4, 0.6, sh);   // a cel shadow's hard edge
    float3 kd = normalize(f.keyDir.xyz + 1e-6), kr = f.keyColor.rgb * f.keyDir.w * sh;
    float nlk = clamp(dot(n, kd), 0.0, 1.0);
    float3 T = kr * nlk;
    float spec = celBlob(n, V, kd, rough) * step(1e-3, nlk) * clamp(dot(kr, LUMA) * ex * 4.0, 0.0, 1.0);
    int nl = int(f.keyColor.w);
    for (int i = 0; i < nl; i++) {
        Light L = lights[i];
        float3 l; float att = 1.0;
        if (L.params.z > 1.5) l = L.dirCos.xyz;
        else {
            float3 d = L.posRange.xyz - world;
            float dist = max(length(d), 1e-3);
            l = d / dist;
            if (L.posRange.w > 0 && dist >= L.posRange.w) continue;
            float cone = 1.0;
            if (L.params.z > 0.5) {
                float cd = dot(-l, L.dirCos.xyz), co = L.params.y;
                if (cd <= co) continue;
                cone = smoothstep(co, max(L.dirCos.w, co + 1e-4), cd);
            }
            att = cone / max(dist * dist, 1e-2);
            if (hero) att = min(att, HERO_LUX / max(L.colorIntensity.w, 1e-3));
            if (L.posRange.w > 0) { float q = clamp(1.0 - pow(dist / L.posRange.w, 4.0), 0.0, 1.0); att *= q * q; }
        }
        float nll = dot(n, l);
        if (nll <= 0) continue;
        float3 rad = L.colorIntensity.rgb * L.colorIntensity.w * att;
        T += rad * nll;
        spec = max(spec, celBlob(n, V, l, rough) * clamp(dot(rad, LUMA) * ex * 4.0, 0.0, 1.0));
    }
    float3 amb = mix(look.hemiGround.rgb, look.hemiSky.rgb, clamp(n.y * 0.5 + 0.5, 0.0, 1.0)) * M_1_PI_F;
    if (look.skySun.w <= 0.5 && look.hemiSky.w > 0) amb += env.sample(envSampler, n, level(5.0)).rgb * look.hemiSky.w;
    T = T * M_1_PI_F + amb;
    float3 albedo = mix(base, base * 0.55 + 0.12, metal);   // a metal's flat colour: its tint, lightened (no reflection to carry it)
    float3 c = celRamp(albedo, T, ex, pixel);
    float3 hue = T / max(dot(T, LUMA), 1e-6);
    c += mix(float3(1.0), clamp(hue, 0.0, 1.6), 0.25) * spec * (pixel ? 0.8 : 0.62) / max(ex, 1e-4);
    float nv = clamp(dot(n, V), 0.0, 1.0);
    float rimW = hero ? (pixel ? 0.45 : 0.5) : pixel ? 0.0 : 0.12 * step(abs(n.y), 0.6);
    float rim = smoothstep(0.64, 0.70, 1.0 - nv) * rimW;
    c += float3(0.55, 0.68, 1.0) * rim * (0.3 + 0.7 * albedo) / max(ex, 1e-4);
    return c;
}
// The set's light shafts and pools in the drawn looks (0290): three flat steps of their own falloff, at 60 %, so a beam reads as
// painted light and the jets and lamps never sum to a white frame.
static float4 drawnFx(float3 rgb, float a, constant Frame& f, bool shaft = false) {
    if (f.style.x < 0.5) return float4(rgb * a * a, a);
    float q = floor(clamp(a, 0.0, 1.0) * 3.0 + 0.35) / 3.0;
    if (shaft && a > 0.04) q = max(q, 0.34);   // a faint beam stays a flat shaft, not nothing (a pool's skirt goes)
    return float4(rgb * q * q * 0.6, q * 0.6);
}
// --- A set's splash tank (0353) ----------------------------------------------------------------------------------------------
// The stage bakes the tanks' water as a dark plane (scripts/native-stage.mjs, from the web's buildSurfaces); at night it read as
// a black box. Here it's water in all three looks, from the set's own light: ripples that move, the floodlights' glints on
// them, the stage's environment and the red LED lip mirrored at the walls, a teal body lit by the lamps that reach it, and the
// splash-down's rings running out to the walls (Frame.splash) with white water where the car went in, the car's own ripples
// while it's in (Frame.wade). Material.effect: the tank's inside (x, z m; the plane's uv spans it), w 1. Pixels only.
struct SetWaterOut { float3 color; float alpha; };
/// The surface's slope at p: two drifting ripple octaves (Water.h's noise, finite differences), the splash's ring train and the
/// car's ripples. `foam` gets the white water: the ring's crest early on, the churn where it went in, the bow's wash.
static float2 setWaterSlope(float2 p, float t, constant Frame& f, thread float& foam) {
    // Five short travelling waves at odd angles and lengths (0.5–1.6 m, their slopes summed analytically: a few sines a
    // pixel, no noise taps), a cat's-paw of wind on still water under a roof of floodlights.
    const float2 D[5] = { float2(0.94, 0.34), float2(-0.42, 0.91), float2(0.6, -0.8), float2(-0.97, -0.24), float2(0.17, 0.98) };
    const float K[5] = { 4.1, 6.3, 8.9, 11.7, 5.2 }, A[5] = { 0.010, 0.0065, 0.0045, 0.0032, 0.008 };
    float2 g = 0;
    for (int i = 0; i < 5; i++) {
        float ph = dot(p, D[i]) * K[i] - t * sqrt(9.81 * K[i]) * 0.6 + float(i) * 1.7;
        g += D[i] * (K[i] * A[i] * cos(ph));
    }
    foam = 0;
    float4 s = f.splash;
    if (s.w > 0.0 && s.z < 7.0) {
        float2 d = p - s.xy;
        float r = length(d) + 1e-4, age = s.z;
        float front = 0.6 + 3.6 * age / (1.0 + 0.3 * age);   // ≈ 3.5 m/s out, easing (gravity waves of ≈ 0.6 m)
        float x = front - r;                                 // > 0 behind the front
        float env = smoothstep(-0.3, 0.0, x) * exp(-max(x, 0.0) / 1.4) * exp(-age * 0.45) * s.w;
        const float kk = 2.0 * M_PI_F / 0.6;
        g += d / r * (-kk * cos(kk * x)) * 0.05 * env;
        foam = max(foam, exp(-x * x / 0.03) * exp(-age * 1.3) * s.w);                         // the crest of the ring
        foam = max(foam, (1.0 - smoothstep(0.6, 1.8 + age * 0.3, r)) * exp(-age * 0.8) * s.w
                         * smoothstep(0.25, 0.65, water_noise(p * 2.6 + float2(age * 1.3, -age))));   // the churn where it went in
    }
    float4 w = f.wade;
    if (w.w > 0.5) {
        float2 d = p - w.xy;
        float r = length(d) + 1e-4;
        float A = (0.012 + 0.006 * min(w.z, 6.0)) * exp(-r / 2.6);
        const float kw = 2.0 * M_PI_F / 0.45;
        g += d / r * (kw * cos(kw * r - t * 9.0)) * A;
        foam = max(foam, (1.0 - smoothstep(1.4, 2.4, r)) * smoothstep(0.8, 3.0, w.z) * smoothstep(0.35, 0.7, water_noise(p * 3.0 - t * 2.0)));
    }
    return g;
}
static SetWaterOut setWaterShade(float3 world, float2 uv, float4 tank, float sh, constant Frame& f, constant Light* lights,
                                 constant LookU& look, texturecube<float> env) {
    bool drawn = f.style.x > 0.5, pixel = f.style.x > 1.5;
    float ex = max(f.fogRange.z, 1e-4);
    float t = f.eye.w;
    float2 p = world.xz;
    if (pixel) p = floor(p * 6.0 + 0.5) / 6.0;   // 8-bit: whole blocks of water (≈ 17 cm), the rings stepped with them
    float foam;
    float2 g = setWaterSlope(p, pixel ? floor(t * 8.0) / 8.0 : t, f, foam);
    float3 n = normalize(float3(-g.x, 1.0, -g.y));
    float3 V = normalize(f.eye.xyz - world + 1e-6);
    float nv = clamp(dot(n, V), 0.0, 1.0);
    // How far in from the walls (m): the LED lip's red mirrored there, a thin wet line of foam against the concrete.
    float2 inside = min(uv, 1.0 - uv) * tank.xy;
    float edge = min(inside.x, inside.y);
    float lip = exp(-edge / 0.12) * (0.8 + 0.4 * sin(dot(p, float2(3.1, 4.7)) + t * 2.0));
    foam = max(foam, (1.0 - smoothstep(0.0, 0.06, edge)) * 0.8);
    // The set's lamps: the light that reaches the water (the body's in-scatter) and their glints on the ripples.
    float3 kd = normalize(f.keyDir.xyz + 1e-6);
    float3 E = f.keyColor.rgb * f.keyDir.w * sh * max(kd.y, 0.0);
    float rough = 0.09 + 0.6 * length(g);
    float3 glint = f.keyColor.rgb * f.keyDir.w * sh * ggx(clamp(dot(n, normalize(kd + V)), 0.0, 1.0), rough * rough) * step(0.0, dot(n, kd));
    float spot = 0;   // (the drawn looks: the brightest glint's level)
    int nl = int(f.keyColor.w);
    for (int i = 0; i < nl; i++) {
        Light L = lights[i];
        float3 l; float att = 1.0;
        if (L.params.z > 1.5) l = L.dirCos.xyz;
        else {
            float3 d = L.posRange.xyz - world;
            float dist = max(length(d), 1e-3);
            l = d / dist;
            if (L.posRange.w > 0 && dist >= L.posRange.w) continue;
            if (L.params.z > 0.5) {
                float cd = dot(-l, L.dirCos.xyz), co = L.params.y;
                if (cd <= co) continue;
                att = smoothstep(co, max(L.dirCos.w, co + 1e-4), cd);
            }
            att /= max(dist * dist, 1e-2);
            if (L.posRange.w > 0) { float q = clamp(1.0 - pow(dist / L.posRange.w, 4.0), 0.0, 1.0); att *= q * q; }
        }
        if (l.y <= 0) continue;
        float3 rad = L.colorIntensity.rgb * L.colorIntensity.w * att;
        E += rad * l.y;
        float gl = ggx(clamp(dot(n, normalize(l + V)), 0.0, 1.0), rough * rough);
        glint += rad * gl;
        spot = max(spot, gl * dot(rad, LUMA) * ex);
    }
    float3 amb = look.hemiSky.rgb + (look.hemiSky.w > 0 ? env.sample(envSampler, float3(0, 1, 0), level(5.0)).rgb * look.hemiSky.w * M_PI_F : float3(0));
    E += amb;
    // What the water mirrors: the stage's environment (its lamps and walls), or the dusk out in the world.
    float3 r = reflect(-V, n); r.y = abs(r.y);
    float3 refl = look.skySun.w > 0.5 ? duskEnv(r, 0.05, look) : look.hemiSky.w > 0 ? env.sample(envSampler, r, level(0.6)).rgb * look.hemiSky.w : look.skyMid.rgb;
    const float3 LED = float3(3.2, 0.12, 0.18);
    const float3 TEAL = float3(0.012, 0.055, 0.065);   // in-scatter albedo over the dark floor (a metre down)
    SetWaterOut o;
    if (!drawn) {
        float F = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
        float3 body = TEAL * E * M_1_PI_F;
        float3 c = body * (1.0 - F) + refl * F + glint * F * 0.25 + LED * lip * 0.06;
        float3 white = float3(0.85, 0.9, 0.95) * E * M_1_PI_F * 0.9 + glint * 0.02;
        float fa = saturate(foam);
        o.color = mix(c, white, fa);
        o.alpha = mix(mix(0.86, 1.0, F), 1.0, fa);
        return o;
    }
    // Anime and 8-bit: the body through the cel ramp, a hard band of the mirrored set at grazing angles, the glints cut to
    // stars, the lip's red as a flat stripe, the rings and the white water as solid shapes (Anime inks their edge).
    float3 c = celRamp(TEAL * 4.0, E * M_1_PI_F, ex, pixel);   // (a night's deep teal: the lamps light it to the mid band)
    float fr = smoothstep(0.74, 0.76, 1.0 - nv);
    c = mix(c, min(refl, float3(4.0)) * 0.55, fr * 0.6);
    float star = step(0.6, spot);
    c += float3(0.9, 0.94, 1.0) * star * (pixel ? 0.8 : 0.62) / ex;
    c += LED * step(0.55, lip) * 0.12 / ex;
    float fw = pixel ? 1e-3 : max(fwidth(foam), 1e-3) * 1.5;
    float solid = smoothstep(0.45 - fw, 0.45 + fw, foam);
    float3 white = celRamp(float3(0.8, 0.86, 0.92), E * M_1_PI_F, ex, pixel) + float3(0.15) / ex;
    c = mix(c, white, solid);
    if (!pixel) c = mix(c, float3(0.006, 0.008, 0.02) / ex, (1.0 - smoothstep(0.0, fw * 1.6, abs(foam - 0.38))) * 0.85);
    o.color = c;
    o.alpha = 1.0;
    return o;
}
// The tank's own pipeline (Renderer.setWaterPipe), so none of this weighs on the stage's shader: the water, then the set's fog
// and air as cg_stage_fragment ends.
fragment float4 cg_setwater_fragment(VOut in [[stage_in]], constant Frame& f [[buffer(1)]], constant Material& m [[buffer(2)]],
                                     constant Light* lights [[buffer(3)]], depth2d<float> shadow [[texture(3)]], constant LookU& look [[buffer(4)]],
                                     texturecube<float> env [[texture(7)]]) {
    float sh = shadowAt(in.lightClip, shadow, f.fogRange.w);
    SetWaterOut w = setWaterShade(in.world, in.uv, m.effect, sh, f, lights, look, env);
    float3 color = w.color;
    float3 toP = in.world - f.eye.xyz;
    float dist = max(length(toP), 1e-3);
    if (f.fogColor.w > 0.5 && (m.flags.w & 2u)) {
        float k = look.fogExp.x > 0 ? 1.0 - exp(-look.fogExp.x * look.fogExp.x * dist * dist) : clamp((dist - f.fogRange.x) / max(f.fogRange.y - f.fogRange.x, 1.0), 0.0, 1.0);
        if (f.style.x > 0.5) k = floor(k * 4.0 + 0.5) / 4.0;
        color = mix(color, f.fogColor.rgb, k);
    }
    color = f.style.x > 0.5 ? hazedDrawn(max(color, 0.0), toP / dist, dist, f.eye.xyz, look, f.style.x > 1.5)
                            : hazed(max(color, 0.0), toP / dist, dist, f.eye.xyz, look);
    return float4(max(color, 0.0), w.alpha);
}
fragment float4 cg_stage_fragment(VOut in [[stage_in]], bool front [[front_facing]], constant Frame& f [[buffer(1)]], constant Material& m [[buffer(2)]],
                                  constant Light* lights [[buffer(3)]], texture2d<float> map [[texture(0)]], texture2d<float> roughMap [[texture(1)]],
                                  texture2d<float> emiMap [[texture(2)]], depth2d<float> shadow [[texture(3)]], texture2d<float> alphaMap [[texture(4)]],
                                  constant LookU& look [[buffer(4)]], texture2d<float> wetMask [[texture(5)]], texture2d<float> mirror [[texture(6)]], texturecube<float> env [[texture(7)]],
                                  texture2d<float> detail [[texture(8)]], depth2d<float> wshadow [[texture(14)]]) {
    constexpr sampler s(coord::normalized, filter::linear, mip_filter::linear, address::repeat, max_anisotropy(4));   // (8 on the web: on a slab at a grazing angle that's 8 taps a pixel at 120 Hz)
    float3 V0 = normalize(f.eye.xyz - in.world + 1e-6);
    // The web's ShaderMaterials (src/render/wall.js), their falloffs as written there; additive.
    if (m.effectKind.x == 1) {   // beamFS: brightest where the beam is seen side-on, fading along it
        float along = clamp(in.uv.y, 0.0, 1.0);
        float edge = pow(abs(dot(normalize(in.nrm + 1e-6), V0)), 1.6);
        float a = m.effect.w * edge * pow(1.0 - along, 1.7) * smoothstep(0.0, 0.02, along);
        return drawnFx(m.effect.rgb, a, f, true);   // three's AdditiveBlending is (src alpha, one) and these write (colour · a, a): a counts twice
    }
    if (m.effectKind.x == 2) {   // glowDecal: a radial pool on the slab
        float d = length(in.uv - 0.5) * 2.0;
        float a = m.effect.w * pow(max(0.0, 1.0 - d), 2.2);
        return drawnFx(m.effect.rgb, a, f);
    }
    if (m.effectKind.x == 3) {   // the red spill beside the deck's LED strips
        float a = m.effect.w * pow(clamp(in.uv.x, 0.0, 1.0), 4.0);
        return drawnFx(m.effect.rgb, a, f);
    }
    if (m.effectKind.x == 4) {   // rocket.js BEAM_FS, its haze and mean dust in the power (the exporter's)
        float along = clamp(in.uv.y, 0.0, 1.0);
        float edge = pow(abs(dot(normalize(in.nrm + 1e-6), V0)), 1.4);
        float a = m.effect.w * edge * pow(1.0 - along, 1.5) * smoothstep(0.0, 0.05, along);
        if (f.style.x > 0.5) return drawnFx(m.effect.rgb, a, f, true);
        return float4(m.effect.rgb * a, a);
    }
    float2 uv = in.uv * m.uvTransform.xy + m.uvTransform.zw;
    float4 base = m.color;
    if (m.effectKind.y) base.a *= alphaMap.sample(s, in.uv).g;   // three's alphaMap reads green
    if (m.flags.x) base *= f.style.x > 1.5 ? map.sample(s, uv, bias(1.5)) : map.sample(s, uv);   // 8-bit: the texture's broad tone, not its grain
    if (m.flags.w & 1u) base.rgb *= in.col;
    float3 emissive = m.emissive.rgb;
    if (m.flags.z) emissive *= emiMap.sample(s, uv).rgb;
    float3 color;
    float3 V = normalize(f.eye.xyz - in.world + 1e-6);
    if (m.emissive.w > 0.5) {
        color = base.rgb + emissive;            // unlit (MeshBasic): the colour as given (HDR lamps bloom)
    } else {
        float3 n = normalize(in.nrm + 1e-6);
        if (!front) n = -n;
        float rough = m.pbr.y;
        if (m.flags.y) rough *= roughMap.sample(s, uv).g;
        float metal = m.pbr.x, wet = 0, setWet = 1;
        float coat = 0.0;
        if ((m.flags.w & 4u) && f.matter[0].w > 0.5) { float3 b3 = base.rgb; coat = carMatter(in.world, f.matter, f.style.x, b3, rough, metal); base.rgb = b3; }   // 0332: mud, dust, snow, water
        if (m.flags.w & 24u) {   // the sets' concrete and steel (0273, SetSurface.h)
            SetSurfaceOut so = setSurface(base.rgb, rough, in.world, n, m.flags.w & 24u, m.effect, detail, length(fwidth(in.world)));
            base.rgb = so.base; rough = so.rough; setWet = so.wetK;
        }
        if (m.effectKind.z != 0 && look.fogExp.y > 0) {   // wall.js wetSlab: damp everywhere, standing water in places
            constexpr sampler ws(coord::normalized, filter::linear, mip_filter::linear, address::repeat);
            wet = (0.6 + 0.4 * wetMask.sample(ws, in.world.xz / 200.0).r) * setWet;
            base.rgb *= 1.0 - 0.12 * wet;
            rough = mix(rough, max(rough * 0.55, 0.2), wet);
        }
        float sh = shadowAt(in.lightClip, shadow, f.fogRange.w);
        if (f.worldShadow.x > 0.5) sh = min(sh, shadowAt(f.worldShadowVP * float4(in.world, 1), wshadow, f.worldShadow.y));   // 0310: under the trees
        if (f.style.x > 0.5) {   // Anime and 8-bit (0290): the ramp, not the BRDF
            color = drawnLight(n, V, in.world, base.rgb, metal, rough, sh, (m.flags.w & 4u) != 0, f, lights, look, env);
        } else {
        color = brdf(n, V, normalize(f.keyDir.xyz), base.rgb, metal, rough, f.keyColor.rgb * f.keyDir.w * sh, m.pbr.z, m.pbr.w);
        int nl = int(f.keyColor.w);
        for (int i = 0; i < nl; i++) {
            Light L = lights[i];
            if (L.params.z > 1.5) {   // a directional light beyond the key (the Lineup's rim): no shadow, no falloff
                color += brdf(n, V, L.dirCos.xyz, base.rgb, metal, rough, L.colorIntensity.rgb * L.colorIntensity.w, m.pbr.z, m.pbr.w);
                continue;
            }
            float3 d = L.posRange.xyz - in.world;
            float dist = max(length(d), 1e-3);
            float3 l = d / dist;
            if (L.posRange.w > 0 && dist >= L.posRange.w) continue;   // out of a point light's range
            if (dot(n, l) <= 0) continue;                                   // facing away
            float cone = 1.0;
            if (L.params.z > 0.5) {   // spot: three's smoothstep(cos(angle), cos(angle · (1 − penumbra)), cos θ)
                float cd = dot(-l, L.dirCos.xyz), co = L.params.y;
                if (cd <= co) continue;
                cone = smoothstep(co, max(L.dirCos.w, co + 1e-4), cd);
            }
            float att = cone / max(dist * dist, 1e-2);   // three: intensity / max(d^decay, 0.01) (decay 2 on every stage light)
            // The car (flags.w & 4, 0270): a set lamp lights its paint to at most HERO_LUX. The base uplights stand 1–3 m off the
            // car at the curl's foot, and inverse-square put hundreds of times the key on it: a white blown-out car at every
            // run's opening. The lamps still light the set at full strength; on the car they read as a bright rake, never a blaze.
            if (m.flags.w & 4u) att = min(att, HERO_LUX / max(L.colorIntensity.w, 1e-3));
            if (L.posRange.w > 0) { float q = clamp(1.0 - pow(dist / L.posRange.w, 4.0), 0.0, 1.0); att *= q * q; }
            color += brdf(n, V, l, base.rgb, metal, rough, L.colorIntensity.rgb * L.colorIntensity.w * att, m.pbr.z, m.pbr.w);
        }
        // Indirect, as three's RE_IndirectDiffuse/Specular_Physical: the hemisphere (irradiance / π) and the environment (its
        // roughest mip is irradiance / π already), the specular through the split-sum DFG with its multiple-scattering term.
        float3 cosIrr = mix(look.hemiGround.rgb, look.hemiSky.rgb, clamp(n.y * 0.5 + 0.5, 0.0, 1.0)) * M_1_PI_F;
        float nv = clamp(dot(n, V), 0.0, 1.0), r1 = clamp(rough, 0.0, 1.0);
        float4 rr = r1 * float4(-1.0, -0.0275, -0.572, 0.022) + float4(1.0, 0.0425, 1.04, -0.04);
        float a004 = min(rr.x * rr.x, exp2(-9.28 * nv)) * rr.x + rr.y;
        float2 fab = float2(-1.04, 1.04) * a004 + rr.zw;
        float3 radiance = 0;
        bool sky = look.skySun.w > 0.5;   // Free Drive out in the world: the dusk is the environment (duskEnv)
        if (sky) {
            float3 refl = normalize(mix(reflect(-V, n), n, r1 * r1 * r1 * r1));
            radiance = duskEnv(refl, r1, look);
        } else if (look.hemiSky.w > 0) {
            cosIrr += env.sample(envSampler, n, level(5.0)).rgb * look.hemiSky.w;
            float3 refl = normalize(mix(reflect(-V, n), n, r1 * r1 * r1 * r1));
            radiance = env.sample(envSampler, refl, level(r1 * 5.0)).rgb * look.hemiSky.w;
        }
        float3 F0 = mix(float3(0.04), base.rgb, metal);
        float3 Fss = F0 * fab.x + fab.y;
        float Ess = fab.x + fab.y, Ems = 1.0 - Ess;
        float3 Favg = F0 + (1.0 - F0) * 0.047619;
        float3 Fms = Fss * Favg / max(1.0 - Ems * Favg, 1e-3);
        float diel = 0.04 * fab.x + fab.y; float dielMs = (0.04 * fab.x + fab.y) * (0.04 + 0.96 * 0.047619) / max(1.0 - Ems * (0.04 + 0.96 * 0.047619), 1e-3) * Ems;
        color += base.rgb * (1.0 - metal) * (1.0 - (diel + dielMs)) * cosIrr + radiance * Fss + Fms * Ems * cosIrr;
        if (m.pbr.z > 0) {   // the clear coat over it all
            float cr = max(clamp(m.pbr.w, 0.0, 1.0), 0.03);
            float3 cc = sky ? duskEnv(reflect(-V, n), cr, look) : look.hemiSky.w > 0 ? env.sample(envSampler, reflect(-V, n), level(cr * 5.0)).rgb * look.hemiSky.w : float3(0);
            float4 rc = cr * float4(-1.0, -0.0275, -0.572, 0.022) + float4(1.0, 0.0425, 1.04, -0.04);
            float ac = min(rc.x * rc.x, exp2(-9.28 * nv)) * rc.x + rc.y;
            float2 fc = float2(-1.04, 1.04) * ac + rc.zw;
            float Fcc = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
            float ccK = m.pbr.z * (1.0 - coat);   // 0332: a coat of mud has no clear coat over it
            color = color * (1.0 - ccK * Fcc) + cc * (0.04 * fc.x + fc.y) * ccK;
        }
        }
        color += emissive;
        if (wet > 0 && f.misc.y > 0 && f.style.x < 0.5) {   // film.js's reflection: Fresnel on the mirror's image, which is drawn at this pixel's place
            float fres = 0.03 + 0.97 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
            constexpr sampler ms(coord::normalized, filter::linear, address::clamp_to_edge);
            color += mirror.sample(ms, in.clip.xy * f.misc.zw).rgb * fres * wet * wet * 0.7;
        }
    }
    if (f.misc.x > 0) {   // the mirror's own draw: no air (the slab's pixel gets that), fading with height
        return float4(max(color, 0.0) / (1.0 + max(in.world.y, 0.0) * 0.012), 1);
    }
    if (m.effectKind.w == 0) {
        float3 toP = in.world - f.eye.xyz;
        float dist = max(length(toP), 1e-3);
        if (f.fogColor.w > 0.5 && (m.flags.w & 2u)) {
            float k = look.fogExp.x > 0 ? 1.0 - exp(-look.fogExp.x * look.fogExp.x * dist * dist) : clamp((dist - f.fogRange.x) / max(f.fogRange.y - f.fogRange.x, 1.0), 0.0, 1.0);
            if (f.style.x > 0.5) k = floor(k * 4.0 + 0.5) / 4.0;   // the drawn looks: in flat layers
            color = mix(color, f.fogColor.rgb, k);
        }
        color = f.style.x > 0.5 ? hazedDrawn(max(color, 0.0), toP / dist, dist, f.eye.xyz, look, f.style.x > 1.5)
                                : hazed(max(color, 0.0), toP / dist, dist, f.eye.xyz, look);
    }
    return float4(max(color, 0.0), base.a);
}

// The sky behind everything (HDR, linear).
struct SOut { float4 clip [[position]]; float2 uv; };
vertex SOut cg_full_vertex(uint vid [[vertex_id]]) {
    float2 p = float2((vid << 1) & 2, vid & 2);
    SOut o; o.clip = float4(p * 2.0 - 1.0, 0.0, 1.0); o.uv = float2(p.x, 1.0 - p.y); return o;
}
// Drawn after the opaque stage, at the far plane, so it's shaded only where it shows. The ray from the inverse view-projection.
struct SkyOut { float4 clip [[position]]; float3 dir; };
vertex SkyOut cg_sky_vertex(uint vid [[vertex_id]], constant Frame& f [[buffer(1)]]) {
    float2 p = float2((vid << 1) & 2, vid & 2) * 2.0 - 1.0;
    float4 w = f.invViewProj * float4(p, 1.0, 1.0);
    SkyOut o; o.clip = float4(p, 1.0, 1.0); o.dir = w.xyz / w.w - f.eye.xyz; return o;
}
// wall.js STARS: one cell in a few hundred of a grid over the sky, a round dot with a soft edge a pixel wide.
static float starHash(float3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
static float3 starField(float3 dir, float cells, float keep, float h0, bool vary) {
    float3 q = dir * cells, sp = floor(q);
    float on = step(keep, starHash(sp));
    if (on <= 0) return 0;
    on *= smoothstep(h0, h0 < 0.2 ? 0.5 : 0.7, dir.y);
    float aa = max(length(fwidth(q)), 1e-4);
    float d = length(fract(q) - 0.5);
    float disc = 1.0 - smoothstep(0.32 - aa * 0.5, 0.32 + aa * 0.5, d);
    return float3(on * disc * 1.6) * (vary ? 0.35 + 0.65 * starHash(sp + 3.1) : 1.0);
}
// --- The drawn looks' skies (0290) -----------------------------------------------------------------------------------------
// Both write the colour they want on screen, divided by the exposure (the film multiplies it back and, for these looks, has no
// tone curve under 0.8), and no haze: the sky is the painting's own.
static float3 s2l(float3 c) { return select(pow((c + 0.055) / 1.055, 2.4), c / 12.92, c <= 0.04045); }
static float skyHash(float2 p) { p = fract(p * float2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
static float skyNoise(float2 p) {
    float2 i = floor(p), g = fract(p), u = g * g * (3.0 - 2.0 * g);
    return mix(mix(skyHash(i), skyHash(i + float2(1, 0)), u.x), mix(skyHash(i + float2(0, 1)), skyHash(i + float2(1, 1)), u.x), u.y);
}
static float skyFbm(float2 p) { return 0.55 * skyNoise(p) + 0.3 * skyNoise(p * 2.03 + 7.1) + 0.15 * skyNoise(p * 4.11 + 3.7); }
// The moon (the night) or the sun (the dusk): 17° up on the bearing the renderer fixes when a run starts (a little left of where
// the lens first looks: over the set the run is flown toward), fixed in the world from then on.
static float3 lightBody(constant Frame& f, constant LookU& k) {
    if (k.hemiGround.w > 0.5) return normalize(k.skySun.xyz + float3(0, 1e-4, 0));
    float2 hz = f.fx.w > 0.5 ? f.fx.yz : -f.keyDir.xz; float l = length(hz);
    hz = l > 1e-3 ? hz / l : float2(0.6, 0.8);
    return float3(hz.x * 0.9563, 0.2924, hz.y * 0.9563);   // 17° up
}
// Anime: a painted gradient (deep indigo to a violet horizon at night; the course's own dusk, saturated, by day's end), soft
// clouds in the lower sky lit on the side toward the moon, a big flat moon with a shaded side and two pale craters, a halo
// ring, and sparse stars.
static float3 animeSky(float3 d, constant Frame& f, constant LookU& k) {
    float h = d.y, ex = max(f.fogRange.z, 1e-4);
    bool dusk = k.hemiGround.w > 0.5;
    float3 c;
    float3 cloudBody, cloudLit, below;
    if (!dusk) {
        float3 zen = s2l(float3(0.035, 0.05, 0.15)), up = s2l(float3(0.08, 0.11, 0.30)), low = s2l(float3(0.19, 0.21, 0.47)), hor = s2l(float3(0.47, 0.38, 0.62));
        c = mix(hor, low, smoothstep(0.0, 0.1, h));
        c = mix(c, up, smoothstep(0.08, 0.32, h));
        c = mix(c, zen, smoothstep(0.3, 0.75, h));
        cloudBody = s2l(float3(0.15, 0.16, 0.36)); cloudLit = s2l(float3(0.58, 0.56, 0.82)); below = s2l(float3(0.05, 0.05, 0.11));
    } else {
        float3 zen = k.skyZenith.rgb * ex, mid = k.skyMid.rgb * ex, hor = k.skyHorizon.rgb * ex;
        c = mix(hor, mid, smoothstep(0.0, 0.16, h));
        c = mix(c, zen, smoothstep(0.12, 0.6, h));
        float y = dot(c, LUMA); c = max(mix(float3(y), c, 1.3), 0.0);
        cloudBody = mix(mid, zen, 0.5) * 0.8; cloudLit = min(hor * 1.6 + 0.05, float3(0.95)); below = mid * 0.35;
    }
    float3 md = lightBody(f, k);
    float cosA = clamp(dot(d, md), -1.0, 1.0), ang = sqrt(max(2.0 * (1.0 - cosA), 0.0));
    float R = dusk ? 0.05 : 0.058, aa = max(fwidth(ang), 1e-4);
    float disc = 1.0 - smoothstep(R - aa, R + aa, ang);
    if (!dusk) {
        c += s2l(float3(0.36, 0.38, 0.62)) * exp(-max(ang - R, 0.0) * 9.0) * 0.45;                       // the glow round it
        c += s2l(float3(0.5, 0.52, 0.78)) * (1.0 - smoothstep(0.0, aa * 1.5, abs(ang - R * 1.9))) * 0.35;  // a painted halo ring
        float3 u = normalize(cross(md, float3(0, 1, 0)) + 1e-5), v = cross(u, md);
        float2 q = float2(dot(d, u), dot(d, v)) / R;
        float3 moon = s2l(float3(1.0, 0.96, 0.84));
        float crater = max(1.0 - smoothstep(0.2, 0.24, length(q - float2(0.28, 0.22))), 1.0 - smoothstep(0.13, 0.17, length(q - float2(-0.3, -0.18))));
        moon = mix(moon, s2l(float3(0.88, 0.82, 0.72)), crater);
        moon = mix(moon, s2l(float3(0.74, 0.74, 0.9)), smoothstep(0.52, 0.56, dot(q, float2(-0.6, -0.8))));   // the shaded side, flat
        c = mix(c, moon, disc);
    } else {
        c += cloudLit * exp(-max(ang - R, 0.0) * 6.0) * 0.5;
        c = mix(c, min(cloudLit * 1.3 + 0.1, float3(1.0)), disc);
    }
    float body = 0.0;
    if (h > 0.0) {
        float2 uv = d.xz / (h + 0.08) * 0.8 + float2(f.eye.w * 0.006, 0.0);
        float band = smoothstep(0.015, 0.08, h) * (1.0 - smoothstep(0.26, 0.5, h));
        float n0 = skyFbm(uv);
        body = smoothstep(0.5, 0.6, n0) * band;
        float2 tm = normalize(md.xz + 1e-5) * 0.1;
        float lit = clamp(smoothstep(0.5, 0.6, n0) - smoothstep(0.5, 0.6, skyFbm(uv + tm)), 0.0, 1.0) * band;
        c = mix(c, cloudBody, body * 0.92);
        c = mix(c, cloudLit, lit * 0.85);
    }
    if (k.fogExp.z > 0 && !dusk) c += starField(d, 300.0, 0.9968, 0.12, true) * 0.55 * (1.0 - body) * (1.0 - disc);
    if (h < 0.0) c = below;
    return c / ex;
}
// 8-bit: bands of the palette with a one-pixel checker where they meet, single-pixel stars fixed to the sky (each star is the one
// pixel its direction projects into, so it steps with the lens and never smears), and a pixel moon (or sun) on the key light.
static float3 pixelSky(float3 d, float2 clip, constant Frame& f, constant LookU& k) {
    float h = d.y;
    bool dusk = k.hemiGround.w > 0.5;
    int2 p = int2(clip);
    float hd = h + (((p.x + p.y) & 1) != 0 ? 0.006 : -0.006);
    int idx;
    if (!dusk) idx = hd >= 0.42 ? 0 : hd >= 0.22 ? 1 : hd >= 0.09 ? 2 : hd >= 0.025 ? 3 : h >= 0.0 ? 4 : 1;
    else idx = hd >= 0.45 ? 2 : hd >= 0.24 ? 29 : hd >= 0.11 ? 30 : hd >= 0.035 ? 18 : h >= 0.0 ? 21 : 19;
    float3 md = lightBody(f, k);
    float cosA = clamp(dot(d, md), -1.0, 1.0), ang = sqrt(max(2.0 * (1.0 - cosA), 0.0));
    float R = 0.05;
    if (ang < R) {
        idx = dusk ? 22 : 12;
        float3 u = normalize(cross(md, float3(0, 1, 0)) + 1e-5), v = cross(u, md);
        float2 q = float2(dot(d, u), dot(d, v)) / R;
        if (!dusk && (length(q - float2(0.3, 0.2)) < 0.26 || length(q - float2(-0.3, -0.25)) < 0.18)) idx = 11;
        if (!dusk && dot(q, float2(-0.6, -0.8)) > 0.55) idx = 10;
    } else if (!dusk && ang < R * 1.35) idx = idx == 0 || idx == 1 ? 2 : idx;   // a one-band glow round it
    else if (k.atmo.x > 0.5) {
        // Free Drive's time of day (0310): the sky's own colours in five flat bands (the checker where they meet), which the
        // film's palette then snaps to the nearest of the 32.
        float band = hd >= 0.45 ? 1.0 : hd >= 0.24 ? 0.72 : hd >= 0.11 ? 0.45 : hd >= 0.035 ? 0.2 : 0.0;
        float3 c = mix(mix(k.skyHorizon.rgb, k.skyMid.rgb, smoothstep(0.0, 0.5, band)), k.skyZenith.rgb, smoothstep(0.5, 1.0, band));
        return h < 0.0 ? k.skyMid.rgb * 0.35 : c;
    }
    if (!dusk && h > 0.05 && k.fogExp.z > 0 && ang > R * 1.4) {
        const float cells = 70.0;
        float3 cell = floor(d * cells);
        float r = skyHash(cell.xy * 1.37 + cell.z * 7.93);
        if (r > 0.975) {
            float3 o = float3(skyHash(cell.yz + 3.1), skyHash(cell.zx + 5.7), skyHash(cell.xy + 9.2)) * 0.5 + 0.25;
            float3 sd = normalize((cell + o) / cells);
            float4 q = f.viewProj * float4(f.eye.xyz + sd * 500.0, 1.0);
            if (q.w > 0) {
                float2 ndc = q.xy / q.w;
                int2 sp = int2(floor(float2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5) * f.proj.zw));
                if (all(sp == p)) idx = r > 0.992 ? 12 : 6;
            }
        }
    }
    return s2l(PAL_SRGB[idx]) / max(f.fogRange.z, 1e-4);
}
fragment float4 cg_sky_fragment(SkyOut in [[stage_in]], constant Frame& f [[buffer(1)]], constant LookU& k [[buffer(4)]], texture2d<float> skyView [[texture(15)]],
                                texture2d<float> clouds [[texture(16)]]) {
    float3 d = normalize(in.dir + 1e-6);
    float h = clamp(d.y, -1.0, 1.0);
    float3 c;
    if (k.atmo.x > 0.5 && f.style.x < 0.5) {   // Free Drive's physical sky (#365's, 0310): the sky-view LUT, the sun's disc, clouds, the stars
        float3 sun = k.skySun.xyz;
        c = sky_view(skyView, d, sun, k.atmo.z, 0.0);
        float mu = dot(d, sun);
        // The disc (a little larger than the real 0.53°, so a phone's screen shows it), limb-darkened, through the air.
        float disc = smoothstep(0.99994, 0.99997, mu);
        float limb = sqrt(max(1.0 - (1.0 - mu) / 3e-5, 0.0));
        c += k.sunE.rgb * disc * (0.4 + 0.6 * limb) * 900.0 * smoothstep(-0.01, 0.01, d.y) * max(f.keyColor.rgb * f.keyDir.w / 7.0, 0.002);
        float4 cl = sky_clouds(clouds, d);
        c = c * (1.0 - cl.a) + cl.rgb;
        if (k.atmo.w > 0.01) {   // the stars, and the night's own glow so it isn't black
            c += starField(d, 520.0, 0.9982, 0.04, true) * 0.6 * k.atmo.w * (1.0 - cl.a);
            c += float3(0.0018, 0.0024, 0.0045) * k.atmo.w * (0.4 + 0.6 * exp(-max(h, 0.0) * 6.0));
        }
        if (h < 0.0) c = mix(c, c * 0.5, smoothstep(0.0, -0.1, h));
        return float4(max(c, 0.0), 1);
    }
    if (k.hemiGround.w > 0.5) {   // scene.js skyMaterial, the dusk
        float3 sun = k.skySun.xyz;
        c = mix(k.skyMid.rgb, k.skyZenith.rgb, smoothstep(0.02, 0.55, h));
        float band = exp(-max(h, 0.0) * 14.0);
        float3 flat = normalize(float3(d.x, 0.0, d.z) + float3(1e-5, 0.0, 0.0)), sunFlat = normalize(float3(sun.x, 0.0, sun.z));
        float sunSide = pow(max(dot(flat, sunFlat), 0.0), 3.0);
        c = mix(c, k.skyHorizon.rgb, band * (0.35 + 0.65 * sunSide));
        c += k.skyHorizon.rgb * pow(max(dot(d, sun), 0.0), 220.0) * 1.4;
        if (k.fogExp.z > 0) c += starField(d, 420.0, 0.9985, 0.25, false) * 0.7;
        if (h < 0.0) c = mix(k.skyMid.rgb * 0.6, float3(0.02), smoothstep(0.0, -0.2, h));
    } else {                      // wall.js nightSkyMaterial
        c = mix(float3(0.010, 0.013, 0.022), float3(0.0015, 0.002, 0.004), smoothstep(0.0, 0.5, h));
        c += float3(0.02, 0.022, 0.03) * exp(-abs(h) * 22.0);
        if (k.fogExp.z > 0) c += starField(d, 520.0, 0.9982, 0.08, true);
        if (h < 0.0) c = float3(0.004, 0.005, 0.007);
    }
    if (f.style.x > 1.5) return float4(pixelSky(d, in.clip.xy, f, k), 1);   // 8-bit (0290)
    if (f.style.x > 0.5) return float4(animeSky(d, f, k), 1);                // Anime (0290)
    return float4(hazed(c, d, 700.0, f.eye.xyz, k), 1);   // the sky: a long but finite path through the air (film.js)
}

// rocket.js glints: a gaussian on a camera-facing quad, never under minPx (energy kept as it widens). `pos.w` is the instance's own
// tint slot (unused); the group's size, minimum and tint come in `g`.
struct GlintGPU { float4 pos; float4 color; };
struct GlintGroup { float size, minPx, tint, pad; };
struct GlintOut { float4 clip [[position]]; float2 uv; float3 color; };
vertex GlintOut cg_glint_vertex(uint vid [[vertex_id]], uint iid [[instance_id]], constant Frame& f [[buffer(1)]], constant GlintGPU* g [[buffer(2)]], constant GlintGroup& u [[buffer(3)]]) {
    const float2 corners[6] = { {-1, -1}, {1, -1}, {1, 1}, {-1, -1}, {1, 1}, {-1, 1} };
    float2 c = corners[vid];
    float4 p = f.viewProj * float4(g[iid].pos.xyz, 1);
    float pxPerM = f.proj.y * f.proj.w * 0.5 / max(p.w, 1e-3);
    float size = max(u.size, u.minPx / max(pxPerM, 1e-4)), k = u.size / size;
    p.xy += c * size * f.proj.xy;
    GlintOut o; o.clip = p; o.uv = c; o.color = g[iid].color.rgb * u.tint * k * k; return o;
}
fragment float4 cg_glint_fragment(GlintOut in [[stage_in]]) { return float4(in.color * exp(-dot(in.uv, in.uv) * 4.5), 0); }
// film.js's lit air round a lamp: the in-scattering along each pixel's ray up to the surface it hits (the integral of 1/d²,
// closed form), with an exponential skirt. A billboard the size of the halo bounds it, drawn after the main pass over the
// resolved HDR frame with the resolved depth read per pixel (0291): the glow stops where geometry stands in front of the lamp,
// as on the web. Drawn in the main pass with its depth pulled to the lens, the billboard laid the lamp's whole halo (both tails
// of the ray, π/h) over a car standing 1–3 m from the base uplights: the white haze that drowned the car at every run's opening.
// And the air between the lens and the car is kept off the car (HERO_AIR): the uplights stand beside the mark, between the
// run-up's camera and the car, and even the honest near half of their halo veiled it (a grey-white cloud over the paint).
struct GlowHero { float4x4 toCar; float4 lo, hi; };   // world → the car's own frame, and its box there (Renderer.heroBox)
constant float HERO_AIR = 0.15;
struct GlowOut { float4 clip [[position]]; float2 p; float3 color; float radius; float3 lamp [[flat]]; };
vertex GlowOut cg_glow_vertex(uint vid [[vertex_id]], uint iid [[instance_id]], constant Frame& f [[buffer(1)]], constant GlintGPU* g [[buffer(2)]], constant LookU& k [[buffer(4)]]) {
    const float2 corners[6] = { {-1, -1}, {1, -1}, {1, 1}, {-1, -1}, {1, 1}, {-1, 1} };
    float2 c = corners[vid];
    float3 pos = g[iid].pos.xyz; float radius = g[iid].pos.w;
    float3 toEye = f.eye.xyz - pos; float dist = max(length(toEye), 0.01);
    float near = smoothstep(radius * 2.0, radius * 6.0, dist);
    GlowOut o; o.radius = radius; o.p = c * radius * 3.0; o.lamp = pos;
    o.color = g[iid].color.rgb * near * exp(-k.sunCol.w * max(pos.y, 0.0));
    if (near <= 0) { o.clip = float4(2, 2, 2, 1); return o; }
    float4 p = f.viewProj * float4(pos, 1);
    float4 q = f.viewProj * float4(pos + toEye / dist * min(radius * 3.0, dist * 0.5), 1);
    p.z = q.z / max(q.w, 0.01) * p.w;
    p.xy += o.p * f.proj.xy;
    o.clip = p; return o;
}
fragment float4 cg_glow_fragment(GlowOut in [[stage_in]], constant Frame& f [[buffer(1)]], constant GlowHero& hero [[buffer(2)]], depth2d<float> depthTex [[texture(0)]]) {
    float edge = 1.0 - smoothstep(0.7, 1.0, length(in.p) / (in.radius * 3.0));
    // The pixel's ray and how far it runs before it hits something (film.js HAZE_FS).
    float2 sz = float2(depthTex.get_width(), depthTex.get_height());
    float z = depthTex.read(uint2(min(in.clip.xy, sz - 1.0)));
    float2 uv = in.clip.xy / sz;
    float4 w = f.invViewProj * float4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, z, 1.0);
    float3 d = w.xyz / w.w - f.eye.xyz;
    float L = max(length(d), 1e-3);
    d /= L;
    float veil = 1.0;
    if (z >= 0.99999) L = 700.0;   // the sky: a long but finite path through the air
    else {   // a surface on (or under) the car: its own lit air only as a hint, eased back in within half a metre of its box
        float3 q = (hero.toCar * float4(w.xyz / w.w, 1.0)).xyz;
        float out = length(max(max(hero.lo.xyz - q, q - hero.hi.xyz), 0.0));
        veil = mix(HERO_AIR, 1.0, smoothstep(0.0, 0.5, out));
    }
    float3 o = f.eye.xyz - in.lamp;
    float b = dot(d, o);
    float h = sqrt(max(dot(o, o) - b * b, 0.36));   // a soft core
    float I = (atan((L + b) / h) - atan(b / h)) / h;
    return float4(in.color * max(I, 0.0) * exp(-h / in.radius) * edge * veil, 0);
}

// The mirror's image, smeared along the view as wet concrete does (film.js: taps down the image), into what the slab reads.
fragment float4 cg_smear_fragment(SOut in [[stage_in]], texture2d<float> src [[texture(0)]]) {
    constexpr sampler s(filter::linear, address::clamp_to_edge);
    // Mostly along the view, a little across. Nine taps at quarter size: with five, thin bright edges ghosted into blocks on a big screen.
    const float2 d0 = float2(0.0015, 0.0045), d1 = float2(0.003, 0.009), d3 = float2(-0.001, 0.0145), d2 = float2(-0.005, 0.02);
    float3 c = src.sample(s, in.uv).rgb * 0.2 + (src.sample(s, in.uv + d0).rgb + src.sample(s, in.uv - d0).rgb) * 0.14 + (src.sample(s, in.uv + d1).rgb + src.sample(s, in.uv - d1).rgb) * 0.12
             + (src.sample(s, in.uv + d3).rgb + src.sample(s, in.uv - d3).rgb) * 0.08 + (src.sample(s, in.uv + d2).rgb + src.sample(s, in.uv - d2).rgb) * 0.06;
    return float4(c, 1);
}

// --- Bloom (three's UnrealBloomPass's numbers, far fewer pixels) -----------------------------------------------------------
// Its luminosity high pass in the HDR frame before exposure, per tap so a thin lamp keeps its energy (its average over a quarter-res
// texel would fall under the threshold and flicker), into a quarter-res chain halved five times; one pass then adds the levels.
// A soft knee (0270): only what's over the threshold blooms, eased in over half the threshold below it. The hard step it
// replaces put a pixel's whole colour into the chain the moment it crossed: a lit white car just over 0.82 became a frame-wide
// haze. Lamps, beams and jets (2–10) keep most of their glow. Inputs capped at 16: a glint cannot wash the frame either.
static float3 highPass(float3 c, float threshold) {
    c = min(max(c, 0.0), 16.0);
    float v = dot(c, float3(0.2126, 0.7152, 0.0722)), knee = threshold * 0.5;
    float s = clamp(v - threshold + knee, 0.0, 2.0 * knee);
    float w = max(s * s / (4.0 * knee + 1e-4), v - threshold) / max(v, 1e-4);
    return c * w;
}
fragment float4 cg_bloom_bright_fragment(SOut in [[stage_in]], texture2d<float> hdr [[texture(0)]], constant LookU& k [[buffer(4)]]) {
    constexpr sampler s(filter::linear, address::clamp_to_edge);
    float2 t = float2(1.0 / hdr.get_width(), 1.0 / hdr.get_height());
    float3 c = highPass(hdr.sample(s, in.uv + float2(-t.x, -t.y)).rgb, k.bloom.x) + highPass(hdr.sample(s, in.uv + float2(t.x, -t.y)).rgb, k.bloom.x)
             + highPass(hdr.sample(s, in.uv + float2(-t.x, t.y)).rgb, k.bloom.x) + highPass(hdr.sample(s, in.uv + float2(t.x, t.y)).rgb, k.bloom.x);
    return float4(c * 0.25, 1);
}
fragment float4 cg_bloom_down_fragment(SOut in [[stage_in]], texture2d<float> src [[texture(0)]]) {
    constexpr sampler s(filter::linear, address::clamp_to_edge);
    float2 t = float2(1.0 / src.get_width(), 1.0 / src.get_height());
    float3 c = src.sample(s, in.uv).rgb * 0.2 + (src.sample(s, in.uv + float2(-t.x, -t.y)).rgb + src.sample(s, in.uv + float2(t.x, -t.y)).rgb
             + src.sample(s, in.uv + float2(-t.x, t.y)).rgb + src.sample(s, in.uv + float2(t.x, t.y)).rgb) * 0.2;
    return float4(c, 1);
}
static float3 tent(texture2d<float> t, float2 uv, float r) {
    constexpr sampler s(filter::linear, address::clamp_to_edge);
    float2 d = float2(r / t.get_width(), r / t.get_height());
    return (t.sample(s, uv + float2(-d.x, -d.y)).rgb + t.sample(s, uv + float2(d.x, -d.y)).rgb + t.sample(s, uv + float2(-d.x, d.y)).rgb + t.sample(s, uv + float2(d.x, d.y)).rgb) * 0.25;
}
// A wider ring for the coarsest levels: the web's top mips reach a third of the screen's height.
static float3 ring(texture2d<float> t, float2 uv, float r) {
    constexpr sampler s(filter::linear, address::clamp_to_edge);
    float2 d = float2(r / t.get_width(), r / t.get_height());
    float3 c = t.sample(s, uv).rgb * 2.0;
    c += (t.sample(s, uv + float2(d.x, 0)).rgb + t.sample(s, uv - float2(d.x, 0)).rgb + t.sample(s, uv + float2(0, d.y)).rgb + t.sample(s, uv - float2(0, d.y)).rgb) * 1.5;
    c += (t.sample(s, uv + d * 0.7).rgb + t.sample(s, uv - d * 0.7).rgb + t.sample(s, uv + float2(d.x, -d.y) * 0.7).rgb + t.sample(s, uv - float2(d.x, -d.y) * 0.7).rgb);
    return c / 12.0;
}
fragment float4 cg_bloom_compose_fragment(SOut in [[stage_in]], texture2d<float> b0 [[texture(0)]], texture2d<float> b1 [[texture(1)]], texture2d<float> b2 [[texture(2)]],
                                          texture2d<float> b3 [[texture(3)]], texture2d<float> b4 [[texture(4)]], texture2d<float> b5 [[texture(5)]], constant LookU& k [[buffer(4)]]) {
    constexpr sampler s(filter::linear, address::clamp_to_edge);
    // UnrealBloomPass's five mips, in the share of the screen each reaches: .6 %, 2 %, 6 %, 15 %, 37 %.
    float3 c = b0.sample(s, in.uv).rgb * k.bloom.y + tent(b2, in.uv, 1.0) * k.bloom.y + tent(b3, in.uv, 1.5) * k.bloom.z + ring(b4, in.uv, 2.0) * k.bloom.z + ring(b5, in.uv, 2.5) * k.bloom.w;
    (void)b1;
    return float4(c, 1);
}

// Cold gas's shock diamonds (src/render/plumes.js coneVS / coneFS): an open cone of 24 facets from each firing nozzle, scaled
// by its valve; additive, double-sided, unlit. `along` is the geometry's v as three builds a ConeGeometry: 1 at the apex (the
// nozzle), 0 at the wide end, so the jet is near-invisible at the throat and brightest towards its tip, as on the web.
struct PlumeInst { float4 origin; float4 dir; float4 extra; };   // origin xyz + power; dir xyz + length; extra: radial scale, seed
struct POut { float4 clip [[position]]; float2 uv; float3 n; float3 v; float power; float seed; };
vertex POut cg_plume_vertex(uint vid [[vertex_id]], uint iid [[instance_id]], constant Frame& f [[buffer(1)]], constant PlumeInst* p [[buffer(2)]]) {
    const int SEG = 24;
    const float R = 0.16, SLOPE = 0.16;
    PlumeInst P = p[iid];
    int tri = vid / 3, corner = vid % 3;
    float3 d = normalize(P.dir.xyz + 1e-6), up = abs(d.y) < 0.9 ? float3(0, 1, 0) : float3(1, 0, 0);
    float3 a = normalize(cross(d, up)), b = cross(d, a);
    float len = P.dir.w, sr = P.extra.x;
    float t = corner == 0 ? 0.0 : 1.0;
    float u = float(tri + (corner == 2 ? 1 : 0)) / float(SEG), ang = 2.0 * M_PI_F * u;
    float3 radial = a * cos(ang) + b * sin(ang);
    float3 pos = P.origin.xyz + d * (t * len) + radial * (t * R * sr);
    POut o;
    o.clip = f.viewProj * float4(pos, 1);
    o.uv = float2(u, 1.0 - t);
    o.n = normalize(radial / sr - d * (SLOPE / len));   // the cone's normal through its non-uniform scale
    o.v = normalize(f.eye.xyz - pos + 1e-6);
    o.power = P.origin.w; o.seed = P.extra.y;
    return o;
}
static float plumeHash(float n) { return fract(sin(n) * 43758.5453); }
static float plumeNoise(float2 p) {
    float2 i = floor(p), g = fract(p); g = g * g * (3.0 - 2.0 * g);
    float a = plumeHash(i.x + i.y * 57.0), b = plumeHash(i.x + 1.0 + i.y * 57.0), c = plumeHash(i.x + (i.y + 1.0) * 57.0), d = plumeHash(i.x + 1.0 + (i.y + 1.0) * 57.0);
    return mix(mix(a, b, g.x), mix(c, d, g.x), g.y);
}
fragment float4 cg_plume_fragment(POut in [[stage_in]], constant Frame& f [[buffer(1)]]) {
    float along = clamp(in.uv.y, 0.0, 1.0), time = f.eye.w;
    float rim = pow(clamp(1.0 - abs(dot(in.n, in.v)), 0.0, 1.0), 1.6), core = 1.0 - rim;   // clamped: a NaN pixel is a flicker storm
    float diamonds = 0.55 + 0.45 * cos(along * 38.0 - time * 30.0 + in.seed);
    float n = plumeNoise(float2(in.uv.x * 12.0 + in.seed, along * 6.0 - time * 14.0));
    float fade = pow(1.0 - along, 1.4) * smoothstep(0.0, 0.04, along);
    float a = (0.22 * core * diamonds + 0.55 * rim * n) * fade * in.power;
    float3 col = mix(float3(0.82, 0.92, 1.0), float3(1.0), core * diamonds);
    return float4(col * 1.6 * a, 0);
}

// The film pass: bloom, exposure, AgX, film.js's vignette, half an 8-bit step of dither (a near-black sky bands without it), into the LDR target MetalFX reads.
// --- The drawn looks' finish (0290) ------------------------------------------------------------------------------------
// Ink (Anime, at the render size) and outlines (8-bit, at its ≈ 160 columns) from the main pass's depth, resolved (sample 0):
//   silhouette  a neighbour farther than the plane through the centre and the opposite neighbour predicts (in 1/distance,
//               which is affine across any plane on screen, so a floor seen edge-on reads nothing): the centre is an object's
//               edge against what lies behind it, and only that side is inked
//   crease      the normals rebuilt from the depth on the four quarters round the pixel differ by more than ≈ 40°: a panel's
//               edge, a rail; a tessellated curve (the curl, 5–10° a facet) and a texture's seams never cross it
constant float3 INK = float3(0.055, 0.04, 0.10);
static float inkDist(float d, constant Frame& f) { return f.style.z / min(d + f.style.y, -1e-7); }
static float inkRead(depth2d<float> t, int2 p, int2 hi, constant Frame& f) { return inkDist(t.read(uint2(clamp(p, int2(0), hi))), f); }
static float3 inkPos(int2 p, float L, constant Frame& f) {
    float2 ndc = float2((float(p.x) + 0.5) / f.proj.z * 2.0 - 1.0, 1.0 - (float(p.y) + 0.5) / f.proj.w * 2.0);
    return float3(ndc.x / f.proj.x * L, ndc.y / f.proj.y * L, -L);
}
static float3 inkN(float3 v) { return v * rsqrt(max(dot(v, v), 1e-30)); }
static float silOne(float ic, float iOpp, float iNb) { return (2.0 * ic - iOpp - iNb) / ic; }
struct Ink { float sil, crease, dist; };
// `kNear`: the silhouette's reach in pixels for what's close (Anime draws it thick near, thin far); creases are always 1.
static Ink inkAt(depth2d<float> t, int2 c, int kNear, float creaseLo, constant Frame& f) {
    int2 hi = int2(t.get_width(), t.get_height()) - 1;
    float L = inkRead(t, c, hi, f), far = inkDist(1.0, f);
    Ink o; o.dist = L; o.sil = 0; o.crease = 0;
    if (L >= far * 0.995) return o;   // the sky takes no ink
    float x0 = inkRead(t, c - int2(1, 0), hi, f), x1 = inkRead(t, c + int2(1, 0), hi, f);
    float y0 = inkRead(t, c - int2(0, 1), hi, f), y1 = inkRead(t, c + int2(0, 1), hi, f);
    int k = L < 120.0 ? kNear : L < 320.0 ? max(1, kNear - 1) : 1;
    float ic = 1.0 / L;
    float a0 = x0, a1 = x1, b0 = y0, b1 = y1;
    if (k > 1) {
        a0 = inkRead(t, c - int2(k, 0), hi, f); a1 = inkRead(t, c + int2(k, 0), hi, f);
        b0 = inkRead(t, c - int2(0, k), hi, f); b1 = inkRead(t, c + int2(0, k), hi, f);
    }
    float ia0 = 1.0 / a0, ia1 = 1.0 / a1, ib0 = 1.0 / b0, ib1 = 1.0 / b1;
    // Foreground side only: the far neighbour's 1/distance falls short of the plane's prediction.
    float sx = max(silOne(ic, ia0, ia1) * step(L * 1.02, a1), silOne(ic, ia1, ia0) * step(L * 1.02, a0));
    float sy = max(silOne(ic, ib0, ib1) * step(L * 1.02, b1), silOne(ic, ib1, ib0) * step(L * 1.02, b0));
    o.sil = smoothstep(0.02, 0.05, max(sx, sy));
    float3 P = inkPos(c, L, f), Px0 = inkPos(c - int2(1, 0), x0, f), Px1 = inkPos(c + int2(1, 0), x1, f);
    float3 Py0 = inkPos(c - int2(0, 1), y0, f), Py1 = inkPos(c + int2(0, 1), y1, f);
    float3 nA = inkN(cross(Px1 - P, Py1 - P)), nB = inkN(cross(P - Px0, P - Py0));
    float3 nC = inkN(cross(Px1 - P, P - Py0)), nD = inkN(cross(P - Px0, Py1 - P));
    float bend = max(1.0 - dot(nA, nB), 1.0 - dot(nC, nD));
    // Across a depth step the rebuilt normals mean nothing: the silhouette speaks there.
    float jump = max(max(abs(x0 - L), abs(x1 - L)), max(abs(y0 - L), abs(y1 - L))) / L;
    o.crease = smoothstep(creaseLo, creaseLo + 0.14, bend) * (1.0 - smoothstep(0.05, 0.1, jump));
    return o;
}
// Anime's print: linear to 0.8, then a soft shoulder to 1 per channel, so a lit red stays red and a lit white car stays white
// with its bands, never a blown wash (AgX's path to white is Real's).
static float3 animeTone(float3 c) { return select(0.8 + 0.2 * (1.0 - exp(-(c - 0.8) / 0.2)), c, c <= 0.8); }
// Speed lines on a fast moment (style.w): thin tapered rays from the frame's edge toward the car, re-dealt twelve times a second.
static float speedLines(float2 uv, constant Frame& f) {
    float2 q = (uv - 0.5) * float2(f.proj.z / max(f.proj.w, 1.0), 1.0);
    float r = length(q), a = atan2(q.y, q.x) * 54.0 / M_PI_F, cell = floor(a), fr = fract(a);
    float h = fract(sin(cell * 12.9898 + floor(f.eye.w * 12.0) * 4.137) * 43758.5453);
    float start = 0.3 + 0.28 * fract(h * 7.31);
    float width = 0.05 + 0.12 * smoothstep(start, 0.95, r);   // tapered: a hair at its inner end
    float line = step(0.62, h) * smoothstep(start, start + 0.12, r) * (1.0 - smoothstep(width * 0.6, width, abs(fr - 0.5)));
    return line * f.style.w;
}
static float3 toOklab(float3 c) {
    float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
    float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
    float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
    l = pow(max(l, 1e-9), 1.0 / 3.0); m = pow(max(m, 1e-9), 1.0 / 3.0); s = pow(max(s, 1e-9), 1.0 / 3.0);
    return float3(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                  0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}
// 8-bit: the nearest of the 32 (Oklab, hue weighted a little over lightness so a dim red stays red, not grey).
static float3 paletteNearest(float3 lin) {
    float3 q = toOklab(lin);
    float best = 1e9; int bi = 0;
    for (int i = 0; i < 32; i++) {
        float3 d = (q - PAL_LAB[i]) * float3(1.0, 1.35, 1.35);
        float e = dot(d, d);
        if (e < best) { best = e; bi = i; }
    }
    return PAL_SRGB[bi];
}
static float3 srgbEncode(float3 c) { c = clamp(c, 0.0, 1.0); return select(1.055 * pow(c, 1.0 / 2.4) - 0.055, c * 12.92, c <= 0.0031308); }

fragment float4 cg_film_fragment(SOut in [[stage_in]], texture2d<float> hdr [[texture(0)]], texture2d<float> bloom [[texture(1)]], depth2d<float> depthTex [[texture(2)]],
                                 constant Frame& f [[buffer(1)]], constant LookU& look [[buffer(4)]]) {
    constexpr sampler s(filter::linear, address::clamp_to_edge);
    if (f.style.x > 1.5) {   // 8-bit (0290): the frame as it was lit (the ramp), its outline, the nearest palette colour; no grain
        int2 p = int2(in.clip.xy);
        float3 c = min(max(hdr.read(uint2(p)).rgb, 0.0) * f.fogRange.z, float3(1.0));
        float y = dot(c, LUMA); c = max(mix(float3(y), c, 1.2), 0.0);
        Ink e = inkAt(depthTex, p, 1, 0.4, f);
        c *= 1.0 - 0.5 * e.crease * (1.0 - smoothstep(60.0, 120.0, e.dist));
        float3 o = paletteNearest(c);
        if (e.sil > 0.5) o = PAL_SRGB[0];
        return float4(o, 1);
    }
    float3 c = max(hdr.sample(s, in.uv).rgb, 0.0);
    if (f.style.x > 0.5) {   // Anime (0290)
        if (look.fogExp.w > 0) c += bloom.sample(s, in.uv).rgb * 0.6;
        c = animeTone(c * f.fogRange.z);
        float2 q = (in.uv - 0.5) * float2(f.proj.z / max(f.proj.w, 1.0), 1.0);
        c *= 1.0 - 0.6 * look.sunDir.w * smoothstep(0.35, 1.05, dot(q, q) * 1.6);
        float y = dot(c, LUMA); c = clamp(mix(float3(y), c, 1.12), 0.0, 1.0);
        c = srgbEncode(c);
        int kNear = f.proj.w > 1500.0 ? 3 : 2;   // ≈ 1.5 pt near, 1 pt mid, a hair far
        Ink e = inkAt(depthTex, int2(in.clip.xy), kNear, 0.22, f);
        float ink = max(e.sil, e.crease * 0.75 * (1.0 - smoothstep(45.0, 110.0, e.dist))) * mix(1.0, 0.5, smoothstep(150.0, 700.0, e.dist));
        c = mix(c, INK, ink);
        if (f.style.w > 0.01) c = mix(c, float3(1.0), speedLines(in.uv, f) * 0.8);
        if (f.fx.x > 0.01) {   // the impact frame: two tones, the light parts in ink on paper, the rays dark
            float yy = dot(c, float3(0.299, 0.587, 0.114));
            float3 imp = yy > 0.38 ? INK : yy > 0.12 ? float3(0.78, 0.08, 0.14) : float3(0.97, 0.94, 0.88);
            float2 qq = (in.uv - 0.5) * float2(f.proj.z / max(f.proj.w, 1.0), 1.0);
            float a = atan2(qq.y, qq.x) * 40.0 / M_PI_F, h = fract(sin(floor(a) * 12.9898) * 43758.5453);
            imp = mix(imp, INK, step(0.55, h) * smoothstep(0.32, 0.6, length(qq)) * (1.0 - smoothstep(0.08, 0.2, abs(fract(a) - 0.5))));
            c = mix(c, imp, f.fx.x);
        }
        return float4(c, 1);
    }
    if (look.fogExp.w > 0) c += bloom.sample(s, in.uv).rgb;
    c *= f.fogRange.z;
    // three.js AgXToneMapping (the web renderer's tone mapping, src/render/scene.js), line for line.
    const float3x3 toRec2020 = float3x3(float3(0.6274, 0.0691, 0.0164), float3(0.3293, 0.9195, 0.0880), float3(0.0433, 0.0113, 0.8956));
    const float3x3 fromRec2020 = float3x3(float3(1.6605, -0.1246, -0.0182), float3(-0.5876, 1.1329, -0.1006), float3(-0.0728, -0.0083, 1.1187));
    const float3x3 inset = float3x3(float3(0.856627153315983, 0.137318972929847, 0.11189821299995),
                                    float3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
                                    float3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
    const float3x3 outset = float3x3(float3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
                                     float3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
                                     float3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
    const float minEv = -12.47393, maxEv = 4.026069;
    c = inset * (toRec2020 * c);
    c = clamp((log2(max(c, 1e-10)) - minEv) / (maxEv - minEv), 0.0, 1.0);
    float3 x2 = c * c, x4 = x2 * x2;
    c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232;
    c = outset * c;
    c = pow(max(c, 0.0), 2.2);
    c = clamp(fromRec2020 * c, 0.0, 1.0);
    float2 q = (in.uv - 0.5) * float2(f.proj.z / max(f.proj.w, 1.0), 1.0);
    c *= 1.0 - look.sunDir.w * smoothstep(0.35, 1.05, dot(q, q) * 1.6);
    c = clamp(c, 0.0, 1.0);
    c = select(1.055 * pow(c, 1.0 / 2.4) - 0.055, c * 12.92, c <= 0.0031308);   // sRGB encode: MetalFX's perceptual mode reads it so
    float n = fract(sin(dot(in.uv * 1024.0, float2(12.9898, 78.233))) * 43758.5453);
    return float4(c + (n - 0.5) / 255.0, 1);
}
// The upscaled frame into the drawable.
// 8-bit (k.x, the block in display pixels): each block one texel, read whole (nearest neighbour on an exact grid).
fragment float4 cg_present_fragment(SOut in [[stage_in]], texture2d<float> src [[texture(0)]], constant float4& k [[buffer(0)]]) {
    if (k.x > 0.5) return src.read(min(uint2(in.clip.xy / k.x), uint2(src.get_width() - 1, src.get_height() - 1)));
    constexpr sampler s(filter::linear, address::clamp_to_edge);
    return src.sample(s, in.uv);
}

// --- crash.js's effects (0153) ---------------------------------------------------------------------------
struct SparkGPU { float4 pos; float4 vel; };     // pos.w life, vel.w heat
struct PuffGPU { float4 pos; float4 color; };    // pos.w size
struct ChipGPU { float4 pos; float4 rot; float4 scale; float4 color; };
struct FxOut { float4 clip [[position]]; float2 uv; float life; float heat; float4 color; };
// A spark: a streak from where it is back along its velocity, camera-facing, wider while hot (sparkVS).
vertex FxOut cg_spark_vertex(uint vid [[vertex_id]], uint iid [[instance_id]], constant Frame& f [[buffer(1)]], constant SparkGPU* sp [[buffer(2)]]) {
    SparkGPU S = sp[iid];
    const float2 corners[6] = { {0, -1}, {1, -1}, {1, 1}, {0, -1}, {1, 1}, {0, 1} };
    float2 c = corners[vid];
    float3 head = S.pos.xyz, tail = S.pos.xyz - S.vel.xyz * 0.022;   // uStreak
    float4 h = f.viewProj * float4(head, 1), t = f.viewProj * float4(tail, 1);
    float2 hs = h.xy / max(h.w, 1e-3), ts = t.xy / max(t.w, 1e-3), d = hs - ts;
    float l = length(d); float2 dir = l > 1e-5 ? d / l : float2(1, 0);
    float4 p = mix(h, t, c.x);
    float w = 0.0045 * (0.45 + 0.55 * S.pos.w) * p.w;                 // uWidth, in clip space
    if (f.style.x > 1.5) w = max(w, 2.2 / f.proj.z * p.w);             // 8-bit (0290): at least a pixel
    p.xy += (float2(-dir.y, dir.x) * c.y * w + dir * w * (1.0 - c.x));
    FxOut o; o.clip = p; o.uv = c; o.life = S.pos.w; o.heat = S.vel.w; o.color = 0; return o;
}
fragment float4 cg_spark_fragment(FxOut in [[stage_in]]) {
    float a = 1.0 - in.uv.y * in.uv.y, k = in.life * in.heat;
    float3 c = mix(float3(1.0, 0.18, 0.04), mix(float3(1.0, 0.55, 0.16), float3(1.0, 0.93, 0.78), smoothstep(0.55, 1.0, k)), smoothstep(0.0, 0.55, k));
    float alpha = a * min(1.0, in.life * 4.0) * 0.85;
    return float4(c * (0.75 + 1.1 * k) * alpha * 3.0, 0);   // additive, HDR: the bloom of a hot spark
}
// A puff of dust, smoke or condensation: a soft round billboard of its own colour.
vertex FxOut cg_puff_vertex(uint vid [[vertex_id]], uint iid [[instance_id]], constant Frame& f [[buffer(1)]], constant PuffGPU* pf [[buffer(2)]], constant float4& camRight [[buffer(3)]], constant float4& camUp [[buffer(4)]]) {
    PuffGPU P = pf[iid];
    const float2 corners[6] = { {-1, -1}, {1, -1}, {1, 1}, {-1, -1}, {1, 1}, {-1, 1} };
    float2 c = corners[vid];
    float3 w = P.pos.xyz + (camRight.xyz * c.x + camUp.xyz * c.y) * P.pos.w * 0.5;
    FxOut o; o.clip = f.viewProj * float4(w, 1); o.uv = c; o.life = 0; o.heat = 0; o.color = P.color; return o;
}
// The drawn looks' smoke (0290): a cel puff, two flat tones and a clean edge where the soft one would fade (the faint skirt is
// dropped: quantised, it drew grey discs over the car).
static float celPuff(float a, constant Frame& f) {
    if (f.style.x < 0.5) return a;
    if (f.style.x > 1.5) return a > 0.16 ? 0.7 : 0.0;
    return a > 0.3 ? 0.62 : a > 0.12 ? 0.3 : 0.0;
}
fragment float4 cg_puff_fragment(FxOut in [[stage_in]], constant Frame& f [[buffer(1)]]) {
    float r = length(in.uv); if (r > 1.0) discard_fragment();
    float a = celPuff(in.color.a * pow(1.0 - r, 1.6), f);
    return float4(in.color.rgb * 0.35 * a, a);   // dust is lit by the night: dim, alpha-blended
}
// Mist and dust as the web's gl_Points at its usual lens and a landscape screen: there a particle's side is size · 0.6·h / depth
// pixels, about 0.586·size metres. The native lens holds its horizontal field (≈60°), so the same metres are 0.5·size·width /
// depth pixels at any aspect (the web's height-based rule would draw them 2.6× wider on an upright phone). Clamped to 35 % of the
// width from the centre, so a particle at the lens can't cost the whole screen.
vertex FxOut cg_soft_vertex(uint vid [[vertex_id]], uint iid [[instance_id]], constant Frame& f [[buffer(1)]], constant PuffGPU* pf [[buffer(2)]], constant float& aspect [[buffer(3)]]) {
    PuffGPU P = pf[iid];
    const float2 corners[6] = { {-1, -1}, {1, -1}, {1, 1}, {-1, -1}, {1, 1}, {-1, 1} };
    float2 c = corners[vid];
    float4 clip = f.viewProj * float4(P.pos.xyz, 1);
    // Depth from a point nearer the lens by the particle's world radius, so the slab doesn't cut its quad along a hard line (no depth read: cheap).
    float3 toEye = f.eye.xyz - P.pos.xyz; float dist = max(length(toEye), 0.01);
    float4 nearer = f.viewProj * float4(P.pos.xyz + toEye / dist * min(P.pos.w * 0.29, dist * 0.5), 1);
    clip.z = nearer.z / max(nearer.w, 0.01) * clip.w;
    float half_ = min(P.pos.w * 0.5, 0.35 * max(clip.w, 0.05));
    clip.xy += c * half_ * float2(1.0, aspect);
    FxOut o; o.clip = clip; o.uv = c; o.life = 0; o.heat = 0; o.color = P.color; return o;
}
// The jets' mist as the web's gl_Points exactly: a side of size · 0.6 · the buffer's height / depth pixels, whatever the aspect
// (0159 held the width instead, which drew it 2.6× narrower than the web's on an upright phone and barely showed). `k.x` is the
// budget's scale (Plumes.updateBudget), `k.y` the alpha that makes up for it. Half a side stays under Plumes.maxHalf of the height.
vertex FxOut cg_mist_vertex(uint vid [[vertex_id]], uint iid [[instance_id]], constant Frame& f [[buffer(1)]], constant PuffGPU* pf [[buffer(2)]], constant float4& k [[buffer(3)]]) {
    PuffGPU P = pf[iid];
    const float2 corners[6] = { {-1, -1}, {1, -1}, {1, 1}, {-1, -1}, {1, 1}, {-1, 1} };
    float2 c = corners[vid];
    float4 clip = f.viewProj * float4(P.pos.xyz, 1);
    float3 toEye = f.eye.xyz - P.pos.xyz; float dist = max(length(toEye), 0.01);
    float4 nearer = f.viewProj * float4(P.pos.xyz + toEye / dist * min(P.pos.w * 0.29, dist * 0.5), 1);
    clip.z = nearer.z / max(nearer.w, 0.01) * clip.w;
    float half_ = min(P.pos.w * 0.6, 0.22 * max(clip.w, 0.05)) * k.x;
    clip.xy += c * half_ * float2(f.proj.w / max(f.proj.z, 1.0), 1.0);
    FxOut o; o.clip = clip; o.uv = c; o.life = 0; o.heat = 0; o.color = float4(P.color.rgb, P.color.a * k.y); return o;
}
// plumes.js mistTexture: its radial gradient, without a texture fetch. Straight alpha, no discard (it keeps the tiler's early work).
fragment float4 cg_mist_fragment(FxOut in [[stage_in]], constant Frame& f [[buffer(1)]]) {
    float r = length(in.uv);
    float t = r < 0.35 ? mix(0.55, 0.28, r / 0.35) : r < 0.7 ? mix(0.28, 0.08, (r - 0.35) / 0.35) : mix(0.08, 0.0, clamp((r - 0.7) / 0.3, 0.0, 1.0));
    if (f.style.x > 0.5) return float4(in.color.rgb, celPuff(t * in.color.a * 1.6, f) * 0.7);
    return float4(in.color.rgb, t * in.color.a);
}
// A chip: a tiny box, tumbling (the instance's rotation, scale and colour).
vertex FxOut cg_chip_vertex(uint vid [[vertex_id]], uint iid [[instance_id]], constant Frame& f [[buffer(1)]], constant ChipGPU* ch [[buffer(2)]]) {
    ChipGPU C = ch[iid];
    const float3 corner[8] = { {-1,-1,-1}, {1,-1,-1}, {1,1,-1}, {-1,1,-1}, {-1,-1,1}, {1,-1,1}, {1,1,1}, {-1,1,1} };
    const ushort idx[36] = { 0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 3,7,6, 3,6,2, 0,4,7, 0,7,3, 1,2,6, 1,6,5 };
    float3 v = corner[idx[vid]] * C.scale.xyz * 0.5;
    float4 q = C.rot; float3 t = 2.0 * cross(q.xyz, v); v = v + q.w * t + cross(q.xyz, t);
    FxOut o; o.clip = f.viewProj * float4(C.pos.xyz + v, 1); o.uv = 0; o.life = 0; o.heat = 0; o.color = C.color; return o;
}
fragment float4 cg_chip_fragment(FxOut in [[stage_in]]) { return float4(in.color.rgb * 0.6, 1); }
// The contact's white-hot flash: an additive sprite for a few frames.
fragment float4 cg_flash_fragment(FxOut in [[stage_in]]) {
    float r = length(in.uv); if (r > 1.0) discard_fragment();
    return float4(float3(1.0, 0.92, 0.8) * in.color.a * pow(1.0 - r, 2.0) * 6.0, 0);
}
// A set's splash drops (0353): WATER's spray (WaterFX's drops, Water.metal's streak) on a scored set, lit by the set's own lamps
// per vertex so the crown reads as water under the floods and the dark between them. Real: soft streaks; Anime: a clean round
// edge, two tones; 8-bit: a solid block at least a pixel wide. Straight alpha (the blend pipeline).
struct SetSprayGPU { float4 p; float4 v; };   // position, size (m); velocity, alpha
struct SetSprayOut { float4 clip [[position]]; float2 uv; float a; float3 color; };
vertex SetSprayOut cg_setspray_vertex(uint vid [[vertex_id]], uint iid [[instance_id]], constant Frame& f [[buffer(1)]], constant SetSprayGPU* drops [[buffer(2)]],
                                      constant Light* lights [[buffer(3)]], constant LookU& look [[buffer(4)]]) {
    const float2 corner[6] = { {-1, -1}, {1, -1}, {1, 1}, {-1, -1}, {1, 1}, {-1, 1} };
    SetSprayGPU d = drops[iid];
    float2 c = corner[vid];
    float3 p = d.p.xyz, toEye = normalize(f.eye.xyz - p + 1e-6);
    float3 vel = d.v.xyz;
    float sp = length(vel);
    float3 along = sp > 0.2 ? vel / sp : float3(0, 1, 0);
    float3 side = normalize(cross(along, toEye) + 1e-5);
    float wdt = d.p.w * (f.style.x > 0.5 ? 0.7 : 1.0);   // (the drawn looks' drops are solid: a little smaller reads the same)
    if (f.style.x > 1.5) wdt = max(wdt, 2.2 * length(f.eye.xyz - p) / max(f.proj.z * f.proj.x, 1.0));   // 8-bit: ≥ a pixel
    float len = wdt + sp * 0.012;
    float3 w = p + along * c.y * len + side * c.x * wdt;
    // The light on a drop: the key, every set lamp that reaches it (from any side: a drop scatters), the sky's fill.
    float3 E = f.keyColor.rgb * f.keyDir.w + look.hemiSky.rgb * 2.0;
    int nl = int(f.keyColor.w);
    for (int i = 0; i < nl; i++) {
        Light L = lights[i];
        if (L.params.z > 1.5) { E += L.colorIntensity.rgb * L.colorIntensity.w; continue; }
        float3 dl = L.posRange.xyz - p;
        float dist = max(length(dl), 1e-3);
        if (L.posRange.w > 0 && dist >= L.posRange.w) continue;
        float att = 1.0 / max(dist * dist, 1e-2);
        if (L.params.z > 0.5) {
            float cd = dot(-dl / dist, L.dirCos.xyz), co = L.params.y;
            if (cd <= co) continue;
            att *= smoothstep(co, max(L.dirCos.w, co + 1e-4), cd);
        }
        E += L.colorIntensity.rgb * L.colorIntensity.w * att;
    }
    SetSprayOut o;
    o.clip = f.viewProj * float4(w, 1); o.uv = c; o.a = d.v.w;
    o.color = float3(0.72, 0.84, 0.92) * E * 0.3;
    return o;
}
fragment float4 cg_setspray_fragment(SetSprayOut in [[stage_in]], constant Frame& f [[buffer(1)]]) {
    float r = length(in.uv);
    float a = f.style.x > 1.5 ? step(r, 1.0) : f.style.x > 0.5 ? smoothstep(1.0, 0.85, r) : 1.0 - smoothstep(0.2, 1.0, r);
    a *= in.a;
    if (a <= 0.003) discard_fragment();
    float3 c = in.color;
    if (f.style.x > 0.5) {   // the drawn looks: two flat tones of its light, before the film's exposure
        float ex = max(f.fogRange.z, 1e-4), I = dot(c, LUMA) * ex;
        c = (I > 0.35 ? float3(0.86, 0.92, 1.0) : float3(0.45, 0.58, 0.72)) / ex;
        a = step(0.3, a) * 0.9;
    }
    return float4(c, a);
}
