// Free Drive's atmosphere LUTs (0228, Sky.h): full-screen passes into small float targets.
//   transmittance   256 × 64, once: the air's transmittance from a height along a zenith cosine to the top
//   multi-scatter   32 × 32, once: the isotropic multiple-scattering term (Hillaire §5.5), per sun cosine and height
//   sky-view        192 × 108, each frame (≈ 20 k pixels × 30 steps): what the eye sees in every direction, single
//                   scattering of the sun plus the multi-scatter term, then mipmapped
#include "Sky.h"

struct SkyLutOut { float4 clip [[position]]; float2 uv; };
vertex SkyLutOut cg_skylut_vertex(uint vid [[vertex_id]]) {
    float2 p = float2((vid << 1) & 2, vid & 2);
    SkyLutOut o; o.clip = float4(p * 2.0 - 1.0, 0.0, 1.0); o.uv = float2(p.x, 1.0 - p.y); return o;
}
struct SkyParams { float4 sun; float4 eye; float4 light; };   // sun: direction xyz; eye: x altitude km, y ground albedo, z night; light: the sun's illuminance, time

fragment float4 cg_skylut_trans_fragment(SkyLutOut in [[stage_in]]) {
    float2 rm = sky_transParams(in.uv);
    float r = rm.x, mu = rm.y;
    float t = sky_sphere(r, mu, SKY_RT);
    if (t < 0.0) return float4(1);
    float3 od = 0;
    const int N = 40;
    float dt = t / float(N);
    for (int i = 0; i < N; i++) {
        float s = (float(i) + 0.5) * dt;
        float h = sqrt(r * r + s * s + 2.0 * r * s * mu) - SKY_RG;
        od += sky_medium(h).ext * dt;
    }
    return float4(exp(-od), 1);
}

// The sun's light reaching a point (r, sun zenith cosine), the earth's shadow included.
static float3 skylut_sunLight(texture2d<float> T, float r, float muS) {
    float3 tr = sky_trans(T, r, muS);
    float horizon = -sqrt(max(1.0 - (SKY_RG / r) * (SKY_RG / r), 0.0));
    return tr * smoothstep(horizon - 0.01, horizon + 0.01, muS);
}

fragment float4 cg_skylut_ms_fragment(SkyLutOut in [[stage_in]], texture2d<float> T [[texture(0)]], constant SkyParams& p [[buffer(0)]]) {
    float muS = in.uv.x * 2.0 - 1.0;
    float r = SKY_RG + clamp(in.uv.y, 0.002, 0.998) * (SKY_RT - SKY_RG);
    float3 sun = float3(sqrt(max(1.0 - muS * muS, 0.0)), muS, 0.0);
    float3 lum = 0, fms = 0;
    const int SQ = 8, N = 20;
    float iso = 1.0 / (4.0 * M_PI_F);
    for (int i = 0; i < SQ; i++) for (int j = 0; j < SQ; j++) {
        float th = 2.0 * M_PI_F * (float(i) + 0.5) / float(SQ), ph = acos(1.0 - 2.0 * (float(j) + 0.5) / float(SQ));
        float3 d = float3(cos(th) * sin(ph), cos(ph), sin(th) * sin(ph));
        float mu = d.y;
        float tg = sky_sphere(r, mu, SKY_RG), ta = sky_sphere(r, mu, SKY_RT);
        float t = tg > 0.0 ? tg : ta;
        if (t <= 0.0) continue;
        float dt = t / float(N);
        float3 tr = 1, L = 0, F = 0;
        for (int k = 0; k < N; k++) {
            float s = (float(k) + 0.5) * dt;
            float3 P = float3(0, r, 0) + d * s;
            float rr = length(P), h = rr - SKY_RG;
            SkyMedium m = sky_medium(h);
            float3 stepT = exp(-m.ext * dt);
            float muSs = dot(P / rr, sun);
            float3 S = m.scatter * iso * skylut_sunLight(T, rr, muSs);
            float3 ext = max(m.ext, 1e-6);
            L += tr * (S - S * stepT) / ext;
            F += tr * (m.scatter - m.scatter * stepT) / ext;
            tr *= stepT;
        }
        if (tg > 0.0) {   // the ground's bounce, Lambertian
            float3 P = float3(0, r, 0) + d * tg, n = normalize(P);
            L += tr * skylut_sunLight(T, SKY_RG, dot(n, sun)) * max(dot(n, sun), 0.0) * p.eye.y / M_PI_F;
        }
        float w = 1.0 / float(SQ * SQ);
        lum += L * w; fms += F * w;
    }
    return float4(lum / max(1.0 - fms, 1e-3), 1);
}

static float3 skylut_ms(texture2d<float> M, float r, float muS) {
    constexpr sampler s(filter::linear, address::clamp_to_edge);
    return M.sample(s, float2(muS * 0.5 + 0.5, (r - SKY_RG) / (SKY_RT - SKY_RG))).rgb;
}

fragment float4 cg_skylut_view_fragment(SkyLutOut in [[stage_in]], texture2d<float> T [[texture(0)]], texture2d<float> M [[texture(1)]], constant SkyParams& p [[buffer(0)]]) {
    float r = SKY_RG + max(p.eye.x, 0.002);
    // The texel's direction (Hillaire's UvToSkyViewLutParams), in a frame whose x is the sun's side.
    float vh = sqrt(max(r * r - SKY_RG * SKY_RG, 0.0)), beta = acos(clamp(vh / r, -1.0, 1.0)), zh = M_PI_F - beta;
    float a;
    if (in.uv.y < 0.5) { float c = 1.0 - in.uv.y * 2.0; c = 1.0 - c * c; a = zh * c; }   // inverse of sky_viewUV's upper half
    else { float c = in.uv.y * 2.0 - 1.0; a = zh + beta * c * c; }
    float vz = cos(a), lv = -((in.uv.x * in.uv.x) * 2.0 - 1.0);
    float sinA = sqrt(max(1.0 - vz * vz, 0.0));
    float3 d = float3(lv * sinA, vz, sqrt(max(1.0 - lv * lv, 0.0)) * sinA);
    float3 sunW = normalize(p.sun.xyz + 1e-6);
    float3 sun = float3(length(sunW.xz), sunW.y, 0.0);   // the sun turned into the frame's xz half-plane at azimuth 0
    float tg = sky_sphere(r, d.y, SKY_RG), ta = sky_sphere(r, d.y, SKY_RT);
    float t = tg > 0.0 ? tg : ta;
    if (t <= 0.0) return float4(0, 0, 0, 1);
    t = min(t, 300.0);
    const int N = 30;
    float cosT = dot(d, sun), pr = sky_rayPhase(cosT), pm = sky_miePhase(cosT);
    float3 tr = 1, L = 0;
    float prev = 0;
    for (int k = 0; k < N; k++) {
        // Steps bunched near the eye (squared), where the air is thickest.
        float f = (float(k) + 0.6) / float(N), s = t * f * f, dt = s - prev; prev = s;
        float3 P = float3(0, r, 0) + d * s;
        float rr = length(P), h = rr - SKY_RG;
        SkyMedium m = sky_medium(h);
        float3 stepT = exp(-m.ext * dt);
        float muSs = dot(P / rr, sun);
        float3 S = (m.ray * pr + m.mie * pm) * skylut_sunLight(T, rr, muSs) + m.scatter * skylut_ms(M, rr, muSs);
        float3 ext = max(m.ext, 1e-6);
        L += tr * (S - S * stepT) / ext;
        tr *= stepT;
    }
    return float4(L * SKY_SUN_E, 1);
}

// The clouds over the sky's upper half (0228), redrawn every other frame as they drift: the sky pass reads this map instead of
// running the fbm per pixel (≈ 70 k texels instead of the sky's share of the screen).
fragment float4 cg_skylut_cloud_fragment(SkyLutOut in [[stage_in]], texture2d<float> V [[texture(0)]], constant SkyParams& p [[buffer(0)]]) {
    float3 d = sky_cloudDir(in.uv);
    float3 sun = normalize(p.sun.xyz + 1e-6);
    float3 skyUp = sky_view(V, float3(0, 1, 0), sun, p.eye.x, 5.0);
    return sky_cloudDeck(d, sun, p.light.rgb, skyUp, p.light.w, p.eye.z);
}
