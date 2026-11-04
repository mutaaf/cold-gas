// The spike's look (docs/NATIVE.md §4, 0148): blue-hour sky, matte concrete, the roadster's clear-coat paint.
// One namespace, no duplicate function names (moon-club). Everything that goes into pow/sqrt/normalize is
// clamped first (LESSONS: "One NaN pixel is a flicker storm").
#include <metal_stdlib>
using namespace metal;

struct Frame {
    float4x4 viewProj;
    float4x4 model;
    float3 eye; float time;
    float3 keyDir; float hingeOpen;
    float2 viewport; float2 _pad;
};
struct Material {
    float4 color;              // linear rgb, opacity
    float metalness, roughness, clearcoat, clearcoatRoughness;
    uint emissive; uint _p0, _p1, _p2;
};
struct VIn { float3 pos [[attribute(0)]]; float3 nrm [[attribute(1)]]; };
struct VOut { float4 clip [[position]]; float3 world; float3 nrm; };

vertex VOut cg_car_vertex(VIn in [[stage_in]], constant Frame& f [[buffer(1)]]) {
    VOut o;
    float4 w = f.model * float4(in.pos, 1);
    o.world = w.xyz;
    o.nrm = normalize((f.model * float4(in.nrm, 0)).xyz + 1e-7);
    o.clip = f.viewProj * w;
    return o;
}

static float3 sky(float3 d, float hinge) {
    float t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
    float3 zenith = float3(0.004, 0.008, 0.024), horizon = float3(0.045, 0.055, 0.095) + float3(0.02, 0.012, 0.0) * hinge;
    return mix(horizon, zenith, pow(t, 0.6));
}
static float ggx(float nh, float a) {
    float a2 = max(a * a, 1e-4), d = nh * nh * (a2 - 1.0) + 1.0;
    return a2 / max(M_PI_F * d * d, 1e-6);
}
static float3 tonemap(float3 c) {   // ACES-ish filmic
    c = max(c, 0.0);
    return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
}

fragment float4 cg_car_fragment(VOut in [[stage_in]], constant Frame& f [[buffer(1)]], constant Material& m [[buffer(2)]]) {
    if (m.emissive != 0) return float4(tonemap(m.color.rgb * 3.0), 1);
    float3 n = normalize(in.nrm), v = normalize(f.eye - in.world + 1e-6), l = normalize(f.keyDir);
    float3 h = normalize(l + v);
    float nl = clamp(dot(n, l), 0.0, 1.0), nv = clamp(dot(n, v), 1e-3, 1.0), nh = clamp(dot(n, h), 0.0, 1.0), vh = clamp(dot(v, h), 0.0, 1.0);
    float3 base = m.color.rgb;
    float rough = clamp(m.roughness, 0.04, 1.0);
    float3 f0 = mix(float3(0.04), base, m.metalness);
    float3 F = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
    float k = (rough + 1.0) * (rough + 1.0) / 8.0;
    float G = (nl / (nl * (1.0 - k) + k + 1e-5)) * (nv / (nv * (1.0 - k) + k));
    float3 spec = ggx(nh, rough * rough) * F * G / max(4.0 * nl * nv, 1e-4);
    float3 kd = (1.0 - F) * (1.0 - m.metalness);
    float3 keyCol = float3(1.0, 0.86, 0.70) * (2.6 + 0.6 * f.hingeOpen);   // sodium-warm key
    float3 col = (kd * base / M_PI_F + spec) * keyCol * nl;
    // Cool sky fill and a rim from behind.
    float3 r = reflect(-v, n);
    col += kd * base * sky(n, f.hingeOpen) * 1.2;
    col += F * sky(r, f.hingeOpen) * (1.0 - rough) * 1.6;
    float rim = pow(clamp(1.0 - nv, 0.0, 1.0), 3.0) * clamp(dot(n, normalize(float3(0.2, 0.4, -1.0))) + 0.3, 0.0, 1.0);
    col += rim * float3(0.35, 0.45, 0.75) * 0.8;
    // Clear coat: a second, sharp lobe over everything.
    if (m.clearcoat > 0) {
        float cr = clamp(m.clearcoatRoughness, 0.03, 1.0);
        float Fc = 0.04 + 0.96 * pow(1.0 - vh, 5.0);
        col += m.clearcoat * Fc * ggx(nh, cr * cr) * keyCol * nl * 0.25;
        col += m.clearcoat * Fc * sky(r, f.hingeOpen) * 1.5;
    }
    return float4(tonemap(col), m.color.a);
}

// The floor: matte concrete under the key light, a soft contact shadow under the car, fading into the dark.
struct FOut { float4 clip [[position]]; float3 world; };
vertex FOut cg_floor_vertex(uint vid [[vertex_id]], constant Frame& f [[buffer(1)]]) {
    const float2 q[6] = { {-1,-1}, {1,-1}, {1,1}, {-1,-1}, {1,1}, {-1,1} };
    float3 w = float3(q[vid].x * 40.0, 0.0, q[vid].y * 40.0);
    FOut o; o.world = w; o.clip = f.viewProj * float4(w, 1); return o;
}
fragment float4 cg_floor_fragment(FOut in [[stage_in]], constant Frame& f [[buffer(1)]]) {
    float2 p = in.world.xz;
    float d = length(p);
    float pool = exp(-d * d / 90.0);                       // the lit pad
    float2 e = p / float2(1.25, 2.7);
    float shadow = 1.0 - 0.82 * exp(-pow(max(length(e), 0.0), 2.0) * 2.2);   // contact shadow under the car
    float grain = fract(sin(dot(floor(p * 40.0), float2(12.9898, 78.233))) * 43758.5453) * 0.03;
    float3 concrete = float3(0.20, 0.205, 0.215) + grain;
    float3 col = concrete * (0.025 + 0.55 * pool * (0.9 + 0.2 * f.hingeOpen)) * shadow;
    float fog = clamp(d / 38.0, 0.0, 1.0);
    col = mix(col, sky(normalize(float3(p.x, 0.15, p.y) + 1e-6), f.hingeOpen), fog);
    return float4(tonemap(col), 1);
}

// The sky behind everything: a full-screen triangle.
struct SOut { float4 clip [[position]]; float2 uv; };
vertex SOut cg_sky_vertex(uint vid [[vertex_id]]) {
    float2 p = float2((vid << 1) & 2, vid & 2);
    SOut o; o.clip = float4(p * 2.0 - 1.0, 0.0, 1.0); o.uv = p; return o;
}
fragment float4 cg_sky_fragment(SOut in [[stage_in]], constant Frame& f [[buffer(1)]]) {
    float y = clamp(1.0 - in.uv.y, 0.0, 1.0);
    return float4(tonemap(sky(normalize(float3(0.0, y * 1.4 - 0.25, 1.0)), f.hingeOpen)), 1);
}
