// The stage's look in Metal (docs/NATIVE.md §4, 0153, 0163): physically based materials from the web's own (colour,
// roughness, metalness, clear coat, emissive, their maps), the course's lights (spots and points with three's inverse-
// square falloff), the key light with a shadow map, the course's environment as a prefiltered cube (three's PMREM read back)
// and its hemisphere, three's fog, film.js's height fog, the wet slab; then bloom and the film pass (exposure, tone,
// vignette) into an LDR target that MetalFX upscales. One namespace, no duplicate names (moon-club); every
// input to pow/sqrt/normalize is clamped (LESSONS: one NaN pixel is a flicker storm).
#include <metal_stdlib>
using namespace metal;
#include "Sky.h"

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
};
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
    float4 atmo;                // Free Drive's physical sky (0228, Sky.h): x on, y the haze's thickness, z the eye's height (km), w night (0…1)
    float4 sunE;                // the sun's illuminance at the ground (rgb); w: time (s), for the clouds
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

fragment float4 cg_stage_fragment(VOut in [[stage_in]], bool front [[front_facing]], constant Frame& f [[buffer(1)]], constant Material& m [[buffer(2)]],
                                  constant Light* lights [[buffer(3)]], texture2d<float> map [[texture(0)]], texture2d<float> roughMap [[texture(1)]],
                                  texture2d<float> emiMap [[texture(2)]], depth2d<float> shadow [[texture(3)]], texture2d<float> alphaMap [[texture(4)]],
                                  constant LookU& look [[buffer(4)]], texture2d<float> wetMask [[texture(5)]], texture2d<float> mirror [[texture(6)]], texturecube<float> env [[texture(7)]],
                                  texture2d<float> skyView [[texture(8)]]) {
    constexpr sampler s(coord::normalized, filter::linear, mip_filter::linear, address::repeat, max_anisotropy(4));   // (8 on the web: on a slab at a grazing angle that's 8 taps a pixel at 120 Hz)
    float3 V0 = normalize(f.eye.xyz - in.world + 1e-6);
    // The web's ShaderMaterials (src/render/wall.js), their falloffs as written there; additive.
    if (m.effectKind.x == 1) {   // beamFS: brightest where the beam is seen side-on, fading along it
        float along = clamp(in.uv.y, 0.0, 1.0);
        float edge = pow(abs(dot(normalize(in.nrm + 1e-6), V0)), 1.6);
        float a = m.effect.w * edge * pow(1.0 - along, 1.7) * smoothstep(0.0, 0.02, along);
        return float4(m.effect.rgb * a * a, a);   // three's AdditiveBlending is (src alpha, one) and these write (colour · a, a): a counts twice
    }
    if (m.effectKind.x == 2) {   // glowDecal: a radial pool on the slab
        float d = length(in.uv - 0.5) * 2.0;
        float a = m.effect.w * pow(max(0.0, 1.0 - d), 2.2);
        return float4(m.effect.rgb * a * a, a);
    }
    if (m.effectKind.x == 3) {   // the red spill beside the deck's LED strips
        float a = m.effect.w * pow(clamp(in.uv.x, 0.0, 1.0), 4.0);
        return float4(m.effect.rgb * a * a, a);
    }
    if (m.effectKind.x == 4) {   // rocket.js BEAM_FS, its haze and mean dust in the power (the exporter's)
        float along = clamp(in.uv.y, 0.0, 1.0);
        float edge = pow(abs(dot(normalize(in.nrm + 1e-6), V0)), 1.4);
        float a = m.effect.w * edge * pow(1.0 - along, 1.5) * smoothstep(0.0, 0.05, along);
        return float4(m.effect.rgb * a, a);
    }
    float2 uv = in.uv * m.uvTransform.xy + m.uvTransform.zw;
    float4 base = m.color;
    if (m.effectKind.y) base.a *= alphaMap.sample(s, in.uv).g;   // three's alphaMap reads green
    if (m.flags.x) base *= map.sample(s, uv);
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
        float metal = m.pbr.x, wet = 0;
        if (m.effectKind.z != 0 && look.fogExp.y > 0) {   // wall.js wetSlab: damp everywhere, standing water in places
            constexpr sampler ws(coord::normalized, filter::linear, mip_filter::linear, address::repeat);
            wet = 0.6 + 0.4 * wetMask.sample(ws, in.world.xz / 200.0).r;
            base.rgb *= 1.0 - 0.12 * wet;
            rough = mix(rough, max(rough * 0.55, 0.2), wet);
        }
        float sh = shadowAt(in.lightClip, shadow, f.fogRange.w);
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
            if (L.posRange.w > 0) { float q = clamp(1.0 - pow(dist / L.posRange.w, 4.0), 0.0, 1.0); att *= q * q; }
            color += brdf(n, V, l, base.rgb, metal, rough, L.colorIntensity.rgb * L.colorIntensity.w * att, m.pbr.z, m.pbr.w);
        }
        // Indirect, as three's RE_IndirectDiffuse/Specular_Physical: the hemisphere (irradiance / π) and the environment (its
        // roughest mip is irradiance / π already), the specular through the split-sum DFG with its multiple-scattering term.
        bool atmo = look.atmo.x > 0.5;   // Free Drive's physical sky (0228): the sky-view lights and is reflected
        float3 cosIrr = atmo ? sky_ambient(skyView, n, look.skySun.xyz, look.sunE.rgb, look.atmo.z)
                             : mix(look.hemiGround.rgb, look.hemiSky.rgb, clamp(n.y * 0.5 + 0.5, 0.0, 1.0)) * M_1_PI_F;
        float nv = clamp(dot(n, V), 0.0, 1.0), r1 = clamp(rough, 0.0, 1.0);
        float4 rr = r1 * float4(-1.0, -0.0275, -0.572, 0.022) + float4(1.0, 0.0425, 1.04, -0.04);
        float a004 = min(rr.x * rr.x, exp2(-9.28 * nv)) * rr.x + rr.y;
        float2 fab = float2(-1.04, 1.04) * a004 + rr.zw;
        float3 radiance = 0;
        bool sky = look.skySun.w > 0.5;   // Free Drive out in the world: the dusk is the environment (duskEnv)
        if (atmo) {
            float3 refl = normalize(mix(reflect(-V, n), n, r1 * r1 * r1 * r1));
            radiance = sky_reflect(skyView, refl, r1, look.skySun.xyz, look.sunE.rgb, look.atmo.z);
        } else if (sky) {
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
            float3 cc = atmo ? sky_reflect(skyView, reflect(-V, n), cr, look.skySun.xyz, look.sunE.rgb, look.atmo.z) : sky ? duskEnv(reflect(-V, n), cr, look) : look.hemiSky.w > 0 ? env.sample(envSampler, reflect(-V, n), level(cr * 5.0)).rgb * look.hemiSky.w : float3(0);
            float4 rc = cr * float4(-1.0, -0.0275, -0.572, 0.022) + float4(1.0, 0.0425, 1.04, -0.04);
            float ac = min(rc.x * rc.x, exp2(-9.28 * nv)) * rc.x + rc.y;
            float2 fc = float2(-1.04, 1.04) * ac + rc.zw;
            float Fcc = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
            color = color * (1.0 - m.pbr.z * Fcc) + cc * (0.04 * fc.x + fc.y) * m.pbr.z;
        }
        color += emissive;
        if (wet > 0 && f.misc.y > 0) {   // film.js's reflection: Fresnel on the mirror's image, which is drawn at this pixel's place
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
            color = mix(color, f.fogColor.rgb, k);
        }
        color = look.atmo.x > 0.5 ? sky_aerial(skyView, max(color, 0.0), toP / dist, dist, f.eye.y + look.atmo.z * 0.0, look.skySun.xyz, look.atmo.z, look.atmo.y)
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
// A deck of clouds (0228): fair-weather cumulus and a high veil of cirrus on a plane over the drive, fbm with a domain warp,
// lit by the sun through them (a silver lining toward the sun, warm undersides at a low sun) and dimmed into the haze at the
// horizon. Drawn only where the sky shows.
static float cloudHash(float2 p) { p = fract(p * float2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
static float cloudNoise(float2 p) {
    float2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(cloudHash(i), cloudHash(i + float2(1, 0)), u.x), mix(cloudHash(i + float2(0, 1)), cloudHash(i + float2(1, 1)), u.x), u.y);
}
static float cloudFbm(float2 p, int n) {
    float a = 0.5, s = 0;
    for (int i = 0; i < n; i++) { s += a * cloudNoise(p); p = float2(p.x * 1.6 - p.y * 1.2, p.x * 1.2 + p.y * 1.6) + 7.3; a *= 0.5; }
    return s;
}
static float4 cloudDeck(float3 d, float3 sun, float3 sunE, float3 skyUp, float t, float night) {
    if (d.y < 0.012) return 0;
    // Where the ray meets a plane 2 km up (the cumulus) and 8 km up (the cirrus), in km across the ground.
    float2 p = d.xz / d.y * 2.0 + float2(t * 0.004, t * 0.0015);
    float2 q = float2(cloudFbm(p * 0.35, 3), cloudFbm(p * 0.35 + 5.2, 3));
    float base = cloudFbm(p * 0.55 + q * 1.6, 5);
    float cov = smoothstep(0.50, 0.78, base);
    float2 pc = d.xz / d.y * 8.0 + float2(t * 0.01, 0.0);
    float cir = smoothstep(0.52, 0.9, cloudFbm(float2(pc.x * 0.12, pc.y * 0.5), 4)) * 0.45;
    // The light through the cloud: thicker centres darker, the sun's side lit, a forward-scattered rim toward the sun.
    float mu = dot(d, sun), lowSun = 1.0 - smoothstep(0.0, 0.35, sun.y);
    float thick = smoothstep(0.55, 0.95, base);
    float3 lit = sunE * (0.10 + 0.55 * pow(max(mu, 0.0), 8.0) * (1.0 - thick) + 0.06 * lowSun) * (1.0 - 0.6 * thick);
    float3 c = lit + skyUp * (1.6 - thick * 0.8);
    float3 ci = sunE * (0.06 + 0.4 * pow(max(mu, 0.0), 12.0)) + skyUp * 1.2;
    float fade = smoothstep(0.012, 0.14, d.y);
    float a = cov * 0.92 * fade, ac = cir * fade * (1.0 - a);
    float3 col = (c * a + ci * ac) * (1.0 - 0.85 * night);
    return float4(col, a + ac);
}
fragment float4 cg_sky_fragment(SkyOut in [[stage_in]], constant Frame& f [[buffer(1)]], constant LookU& k [[buffer(4)]], texture2d<float> skyView [[texture(8)]]) {
    float3 d = normalize(in.dir + 1e-6);
    float h = clamp(d.y, -1.0, 1.0);
    float3 c;
    if (k.atmo.x > 0.5) {   // Free Drive's physical sky (0228): the sky-view LUT, the sun's disc, clouds, the stars after dusk
        float3 sun = k.skySun.xyz;
        c = sky_view(skyView, d, sun, k.atmo.z, 0.0);
        float mu = dot(d, sun);
        // The disc (a little larger than the real 0.53°, so a phone's screen shows it), limb-darkened, through the air.
        float disc = smoothstep(0.99994, 0.99997, mu);
        float limb = sqrt(max(1.0 - (1.0 - mu) / 3e-5, 0.0));
        c += k.sunE.rgb * disc * (0.4 + 0.6 * limb) * 900.0 * smoothstep(-0.01, 0.01, d.y);
        float3 skyUp = sky_view(skyView, float3(0, 1, 0), sun, k.atmo.z, 5.0);
        float4 cl = cloudDeck(d, sun, k.sunE.rgb, skyUp, k.sunE.w, k.atmo.w);
        c = c * (1.0 - cl.a) + cl.rgb;
        if (k.atmo.w > 0.01) {   // the stars, and the night's own glow (airglow, the towns over the horizon) so it isn't black
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
// film.js's lit air round a lamp: (1/h)-falloff from the ray's miss distance with an exponential skirt, the closed form's two far
// tails taken as π. A billboard the size of the halo, its depth pulled to the lens by its radius so the slab doesn't cut it.
struct GlowOut { float4 clip [[position]]; float2 p; float3 color; float radius; };
vertex GlowOut cg_glow_vertex(uint vid [[vertex_id]], uint iid [[instance_id]], constant Frame& f [[buffer(1)]], constant GlintGPU* g [[buffer(2)]], constant LookU& k [[buffer(4)]]) {
    const float2 corners[6] = { {-1, -1}, {1, -1}, {1, 1}, {-1, -1}, {1, 1}, {-1, 1} };
    float2 c = corners[vid];
    float3 pos = g[iid].pos.xyz; float radius = g[iid].pos.w;
    float3 toEye = f.eye.xyz - pos; float dist = max(length(toEye), 0.01);
    float near = smoothstep(radius * 2.0, radius * 6.0, dist);
    GlowOut o; o.radius = radius; o.p = c * radius * 3.0;
    o.color = g[iid].color.rgb * near * exp(-k.sunCol.w * max(pos.y, 0.0));
    if (near <= 0) { o.clip = float4(2, 2, 2, 1); return o; }
    float4 p = f.viewProj * float4(pos, 1);
    float4 q = f.viewProj * float4(pos + toEye / dist * min(radius * 3.0, dist * 0.5), 1);
    p.z = q.z / max(q.w, 0.01) * p.w;
    p.xy += o.p * f.proj.xy;
    o.clip = p; return o;
}
fragment float4 cg_glow_fragment(GlowOut in [[stage_in]]) {
    float h = max(length(in.p), 0.6);
    float edge = 1.0 - smoothstep(0.7, 1.0, h / (in.radius * 3.0));
    return float4(in.color * (M_PI_F / h) * exp(-h / in.radius) * edge, 0);
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
static float3 highPass(float3 c, float threshold) {
    c = min(max(c, 0.0), 32.0);
    float v = dot(c, float3(0.2126, 0.7152, 0.0722));
    return c * smoothstep(threshold, threshold + 0.01, v);
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
fragment float4 cg_film_fragment(SOut in [[stage_in]], texture2d<float> hdr [[texture(0)]], texture2d<float> bloom [[texture(1)]], constant Frame& f [[buffer(1)]], constant LookU& look [[buffer(4)]]) {
    constexpr sampler s(filter::linear, address::clamp_to_edge);
    float3 c = max(hdr.sample(s, in.uv).rgb, 0.0);
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
fragment float4 cg_present_fragment(SOut in [[stage_in]], texture2d<float> src [[texture(0)]]) {
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
fragment float4 cg_puff_fragment(FxOut in [[stage_in]]) {
    float r = length(in.uv); if (r > 1.0) discard_fragment();
    float a = in.color.a * pow(1.0 - r, 1.6);
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
fragment float4 cg_mist_fragment(FxOut in [[stage_in]]) {
    float r = length(in.uv);
    float t = r < 0.35 ? mix(0.55, 0.28, r / 0.35) : r < 0.7 ? mix(0.28, 0.08, (r - 0.35) / 0.35) : mix(0.08, 0.0, clamp((r - 0.7) / 0.3, 0.0, 1.0));
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
