// The stage's look in Metal (docs/NATIVE.md §4, 0153): physically based materials from the web's own (colour,
// roughness, metalness, clear coat, emissive, their maps), the course's lights (spots and points with three's inverse-
// square falloff), the key light with a shadow map, the sky's fill, linear fog; then the film pass (exposure, tone,
// grain, vignette) into an LDR target that MetalFX upscales. One namespace, no duplicate names (moon-club); every
// input to pow/sqrt/normalize is clamped (LESSONS: one NaN pixel is a flicker storm).
#include <metal_stdlib>
using namespace metal;

struct Frame {
    float4x4 viewProj, lightViewProj;
    float4 eye;                 // xyz, time
    float4 keyDir;              // towards the light, xyz; w intensity
    float4 keyColor;            // rgb; w nLights
    float4 fogColor;            // rgb; w enabled
    float4 fogRange;            // near, far, exposure, shadowTexel
};
struct Light { float4 posRange; float4 colorIntensity; float4 dirCos; float4 params; };   // params: decay, cosOuter, kind (0 point, 1 spot), penumbra
struct Material {
    float4 color;               // linear rgb, opacity
    float4 emissive;            // rgb; w unlit
    float4 pbr;                 // metalness, roughness, clearcoat, clearcoatRoughness
    float4 uvTransform;         // repeat xy, offset zw
    uint4 flags;                // hasMap, hasRough, hasEmissiveMap, vertexColors | fog << 1
    float4 effect;              // the web ShaderMaterial's colour, power
    uint4 effectKind;           // 0 none, 1 beam, 2 glow decal, 3 spill; y: has alphaMap
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

static float3 skyFill(float3 n) {
    float t = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    return mix(float3(0.018, 0.02, 0.026), float3(0.035, 0.048, 0.085), t);   // blue hour: a cool sky over dark ground
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
    if (cc > 0) { float ca = max(clamp(ccRough, 0.03, 1.0), 0.03); float Fc = 0.04 + 0.96 * pow(1.0 - vh, 5.0); c += cc * Fc * ggx(nh, ca * ca) * radiance * nl * 0.25; }
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

fragment float4 cg_stage_fragment(VOut in [[stage_in]], bool front [[front_facing]], constant Frame& f [[buffer(1)]], constant Material& m [[buffer(2)]],
                                  constant Light* lights [[buffer(3)]], texture2d<float> map [[texture(0)]], texture2d<float> roughMap [[texture(1)]],
                                  texture2d<float> emiMap [[texture(2)]], depth2d<float> shadow [[texture(3)]], texture2d<float> alphaMap [[texture(4)]]) {
    constexpr sampler s(coord::normalized, filter::linear, mip_filter::linear, address::repeat, max_anisotropy(8));
    float3 V0 = normalize(f.eye.xyz - in.world + 1e-6);
    // The web's ShaderMaterials (src/render/wall.js), their falloffs as written there; additive.
    if (m.effectKind.x == 1) {   // beamFS: brightest where the beam is seen side-on, fading along it
        float along = clamp(in.uv.y, 0.0, 1.0);
        float edge = pow(abs(dot(normalize(in.nrm + 1e-6), V0)), 1.6);
        float a = m.effect.w * edge * pow(1.0 - along, 1.7) * smoothstep(0.0, 0.02, along);
        return float4(m.effect.rgb * a, a);
    }
    if (m.effectKind.x == 2) {   // glowDecal: a radial pool on the slab
        float d = length(in.uv - 0.5) * 2.0;
        float a = m.effect.w * pow(max(0.0, 1.0 - d), 2.2);
        return float4(m.effect.rgb * a, a);
    }
    if (m.effectKind.x == 3) {   // the red spill beside the deck's LED strips
        float a = m.effect.w * pow(clamp(in.uv.x, 0.0, 1.0), 4.0);
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
        float metal = m.pbr.x;
        float sh = shadowAt(in.lightClip, shadow, f.fogRange.w);
        color = brdf(n, V, normalize(f.keyDir.xyz), base.rgb, metal, rough, f.keyColor.rgb * f.keyDir.w * sh, m.pbr.z, m.pbr.w);
        int nl = int(f.keyColor.w);
        for (int i = 0; i < nl; i++) {
            Light L = lights[i];
            float3 d = L.posRange.xyz - in.world;
            float dist = max(length(d), 1e-3);
            float3 l = d / dist;
            if (L.posRange.w > 0 && dist >= L.posRange.w) continue;   // out of a point light's range
            if (dot(n, l) <= 0) continue;                                   // facing away
            float cone = 1.0;
            if (L.params.z > 0.5) {   // spot: smooth from the cone's edge in by the penumbra; outside it, nothing to do
                float cd = dot(-l, L.dirCos.xyz), co = L.params.y;
                if (cd <= co) continue;
                float ci = mix(co, 1.0, clamp(L.params.w, 0.0, 1.0));
                cone = smoothstep(co, max(ci, co + 1e-4), cd);
            }
            float att = cone / max(dist * dist, 1e-4);   // three: intensity / d^decay (decay 2 on every stage light)
            if (L.posRange.w > 0) { float q = clamp(1.0 - pow(dist / L.posRange.w, 4.0), 0.0, 1.0); att *= q * q; }
            color += brdf(n, V, l, base.rgb, metal, rough, L.colorIntensity.rgb * L.colorIntensity.w * att, m.pbr.z, m.pbr.w);
        }
        float3 kd = base.rgb * (1.0 - metal);
        color += kd * skyFill(n) * 1.4;
        float3 r = reflect(-V, n);
        float3 F0 = mix(float3(0.04), base.rgb, metal);
        color += (F0 + (1.0 - F0) * pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 5.0)) * skyFill(r) * (1.0 - clamp(rough, 0.0, 1.0)) * 2.0;
        color += m.pbr.z * 0.04 * skyFill(r) * 2.0;
        color += emissive;
    }
    if (f.fogColor.w > 0.5 && (m.flags.w & 2u)) {
        float d = length(f.eye.xyz - in.world);
        color = mix(color, f.fogColor.rgb, clamp((d - f.fogRange.x) / max(f.fogRange.y - f.fogRange.x, 1.0), 0.0, 1.0));
    }
    return float4(max(color, 0.0), base.a);
}

// The sky behind everything (HDR, linear).
struct SOut { float4 clip [[position]]; float2 uv; };
vertex SOut cg_full_vertex(uint vid [[vertex_id]]) {
    float2 p = float2((vid << 1) & 2, vid & 2);
    SOut o; o.clip = float4(p * 2.0 - 1.0, 0.0, 1.0); o.uv = float2(p.x, 1.0 - p.y); return o;
}
fragment float4 cg_sky_fragment(SOut in [[stage_in]], constant Frame& f [[buffer(1)]]) {
    float y = clamp(1.0 - in.uv.y, 0.0, 1.0);
    float3 zenith = float3(0.006, 0.010, 0.030), horizon = float3(0.030, 0.038, 0.065);
    return float4(mix(horizon, zenith, pow(y, 0.7)), 1);
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

// The film pass: exposure, ACES-ish tone, a touch of grain and vignette, into the LDR target MetalFX reads.
fragment float4 cg_film_fragment(SOut in [[stage_in]], texture2d<float> hdr [[texture(0)]], constant Frame& f [[buffer(1)]]) {
    constexpr sampler s(filter::linear, address::clamp_to_edge);
    float3 c = max(hdr.sample(s, in.uv).rgb, 0.0) * f.fogRange.z;
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
    float2 q = in.uv - 0.5;
    c *= 1.0 - 0.28 * dot(q, q) * 2.0;
    float n = fract(sin(dot(in.uv * 1024.0 + f.eye.w, float2(12.9898, 78.233))) * 43758.5453);
    c += (n - 0.5) * 0.012;
    c = clamp(c, 0.0, 1.0);
    c = select(1.055 * pow(c, 1.0 / 2.4) - 0.055, c * 12.92, c <= 0.0031308);   // sRGB encode: MetalFX's perceptual mode reads it so
    return float4(c, 1);
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
