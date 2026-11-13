// Free Drive's sky (0228): a physically based atmosphere, Hillaire 2020 ("A Scalable and Production Ready Sky and Atmosphere
// Rendering Technique") after Bruneton 2008: Rayleigh, Mie and ozone over a spherical earth, single scattering raymarched and
// multiple scattering from its isotropic LUT. Three small LUTs (SkyLUT.swift): transmittance (256 × 64) and multiple
// scattering (32 × 32) once, the sky-view (192 × 108, mipmapped) each frame. The sky pass, the paint's reflections, the land's
// ambient and the aerial perspective all read the sky-view, so the whole frame is lit by one sky. Shared by Shaders.metal
// and World.metal (static: each file gets its own copy, under sky_ names only). Units: km in the atmosphere, metres in the
// world; radiance in the renderer's linear units (the sun's illuminance at the top of the air is SKY_SUN_E).
#pragma once
#include <metal_stdlib>
using namespace metal;

constant float SKY_RG = 6360.0, SKY_RT = 6460.0;
constant float3 SKY_RAY = float3(5.802, 13.558, 33.1) * 1e-3;     // Rayleigh scattering, /km
constant float SKY_MIE_S = 3.996e-3, SKY_MIE_E = 4.44e-3;          // Mie scattering, extinction, /km
constant float3 SKY_OZONE = float3(0.650, 1.881, 0.085) * 1e-3;   // ozone absorption, /km
constant float SKY_SUN_E = 7.0;                                     // the sun's illuminance above the air (renderer units)
constant float SKY_MIE_G = 0.8;

struct SkyMedium { float3 scatter, ext, ray; float mie; };
static inline SkyMedium sky_medium(float hKm) {
    float h = max(hKm, 0.0);
    float dr = exp(-h / 8.0), dm = exp(-h / 1.2), dz = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
    SkyMedium m;
    m.ray = SKY_RAY * dr; m.mie = SKY_MIE_S * dm;
    m.scatter = m.ray + m.mie;
    m.ext = m.ray + SKY_MIE_E * dm + SKY_OZONE * dz;
    return m;
}
static inline float sky_rayPhase(float c) { return 3.0 / (16.0 * M_PI_F) * (1.0 + c * c); }
static inline float sky_miePhase(float c) {   // Cornette-Shanks
    float g = SKY_MIE_G, g2 = g * g;
    return 3.0 / (8.0 * M_PI_F) * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
// Distance along a ray from r (km, the earth's centre at the origin, the point on +y) with zenith cosine mu to the sphere R; −1 if none.
static inline float sky_sphere(float r, float mu, float R) {
    float b = r * mu, c = r * r - R * R, d = b * b - c;
    if (d < 0.0) return -1.0;
    float s = sqrt(d), t0 = -b - s, t1 = -b + s;
    return t0 > 0.0 ? t0 : (t1 > 0.0 ? t1 : -1.0);
}
// The transmittance LUT's mapping (Bruneton).
static inline float2 sky_transUV(float r, float mu) {
    float H = sqrt(SKY_RT * SKY_RT - SKY_RG * SKY_RG), rho = sqrt(max(r * r - SKY_RG * SKY_RG, 0.0));
    float disc = r * r * (mu * mu - 1.0) + SKY_RT * SKY_RT;
    float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
    float dmin = SKY_RT - r, dmax = rho + H;
    return float2((d - dmin) / max(dmax - dmin, 1e-4), rho / H);
}
static inline float2 sky_transParams(float2 uv) {   // → (r, mu)
    float H = sqrt(SKY_RT * SKY_RT - SKY_RG * SKY_RG), rho = H * uv.y, r = sqrt(rho * rho + SKY_RG * SKY_RG);
    float dmin = SKY_RT - r, dmax = rho + H, d = dmin + uv.x * (dmax - dmin);
    float mu = d == 0.0 ? 1.0 : (H * H - rho * rho - d * d) / (2.0 * r * d);
    return float2(r, clamp(mu, -1.0, 1.0));
}
static inline float3 sky_trans(texture2d<float> T, float r, float mu) {
    constexpr sampler s(filter::linear, address::clamp_to_edge);
    return T.sample(s, sky_transUV(r, mu)).rgb;
}
// The sky-view LUT's mapping (Hillaire): longitude from the sun (0…π, symmetric), latitude packed toward the horizon.
static inline float2 sky_viewUV(float r, float viewZenithCos, float lightViewCos) {
    float vh = sqrt(max(r * r - SKY_RG * SKY_RG, 0.0)), beta = acos(clamp(vh / r, -1.0, 1.0)), zh = M_PI_F - beta;
    float a = acos(clamp(viewZenithCos, -1.0, 1.0)), v;
    if (a < zh) { float c = 1.0 - sqrt(max(1.0 - a / zh, 0.0)); v = c * 0.5; }
    else { float c = sqrt(clamp((a - zh) / max(beta, 1e-4), 0.0, 1.0)); v = c * 0.5 + 0.5; }
    float u = sqrt(clamp(-lightViewCos * 0.5 + 0.5, 0.0, 1.0));
    return float2(u, v);
}
// A world direction (y up) in the sky-view LUT, at `mip` (0 sharp; higher mips stand in for rougher lobes and irradiance).
static inline float3 sky_view(texture2d<float> V, float3 d, float3 sun, float eyeKm, float mip) {
    constexpr sampler s(filter::linear, mip_filter::linear, address::clamp_to_edge);
    float r = SKY_RG + max(eyeKm, 0.002);
    float2 hd = d.xz, hs = sun.xz;
    float ld = length(hd), ls = length(hs);
    float lv = (ld > 1e-4 && ls > 1e-4) ? dot(hd / ld, hs / ls) : 1.0;
    return V.sample(s, sky_viewUV(r, clamp(d.y, -1.0, 1.0), lv), level(mip)).rgb;
}
// The sky's light on a surface facing n, as its average radiance (irradiance / π): the sky-view blurred down its mips, and below
// the horizon the ground's bounce (a mid albedo under the sun and the sky).
static inline float3 sky_ambient(texture2d<float> V, float3 n, float3 sun, float3 sunE, float eyeKm) {
    float3 up = sky_view(V, normalize(float3(n.x, max(n.y, 0.0) + 0.35, n.z)), sun, eyeKm, 5.5);
    float3 ground = 0.12 * (sunE * max(sun.y, 0.0) / M_PI_F + up);   // (the sky's own light standing in for the zenith's: one tap)
    // ×1.4: the LUT's multiple scattering is isotropic and a single order short of the real sky's fill in the shade.
    return mix(ground, up, smoothstep(-0.6, 0.6, n.y)) * 1.4;
}
// What a mirror-like or glossy surface reflects: the sky-view at a mip for its roughness, and the ground below the horizon.
static inline float3 sky_reflect(texture2d<float> V, float3 d, float rough, float3 sun, float3 sunE, float eyeKm) {
    float3 sky = sky_view(V, float3(d.x, max(d.y, 0.0), d.z), sun, eyeKm, rough * 6.0);
    float3 ground = 0.09 * (sunE * max(sun.y, 0.0) / M_PI_F + sky * 0.5);
    float edge = 0.02 + rough * 0.3;
    return mix(ground, sky, smoothstep(-edge, edge * 0.5, d.y));
}
// Aerial perspective (the haze between the eye and a point L metres off along unit d): the air's extinction per channel through
// an exponential atmosphere between the two heights (Rayleigh's 8 km and the haze's 1.2 km, the haze thickened by `haze`), and
// the light scattered in, taken as the sky-view's radiance along the ray (the sky toward the sun warm, away from it blue).
static inline float3 sky_aerial(texture2d<float> V, float3 c, float3 d, float L, float eyeY, float3 sun, float eyeKm, float haze) {
    float Lk = L * 1e-3, h0 = max(eyeY, 0.0) * 1e-3, h1 = max(eyeY + d.y * L, 0.0) * 1e-3;
    float dh = h1 - h0;
    float odR = abs(dh) > 1e-4 ? Lk * (exp(-h0 / 8.0) - exp(-h1 / 8.0)) / (dh / 8.0) : Lk * exp(-h0 / 8.0);
    float odM = abs(dh) > 1e-4 ? Lk * (exp(-h0 / 1.2) - exp(-h1 / 1.2)) / (dh / 1.2) : Lk * exp(-h0 / 1.2);
    float3 T = exp(-clamp(SKY_RAY * odR * 1.6 + SKY_MIE_E * haze * odM, 0.0, 40.0));
    float3 in = sky_view(V, normalize(float3(d.x, max(d.y, 0.012), d.z)), sun, eyeKm, 0.5);
    return c * T + in * (1.0 - T);
}

// A deck of clouds (0228): fair-weather cumulus and a high veil of cirrus on a plane over the drive, fbm with a domain warp,
// lit by the sun through them (a silver lining toward the sun, warm undersides at a low sun) and dimmed into the haze at the
// horizon. Drawn only where the sky shows.
static inline float sky_cloudHash(float2 p) { p = fract(p * float2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
static inline float sky_cloudNoise(float2 p) {
    float2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(sky_cloudHash(i), sky_cloudHash(i + float2(1, 0)), u.x), mix(sky_cloudHash(i + float2(0, 1)), sky_cloudHash(i + float2(1, 1)), u.x), u.y);
}
static inline float sky_cloudFbm(float2 p, int n) {
    float a = 0.5, s = 0;
    for (int i = 0; i < n; i++) { s += a * sky_cloudNoise(p); p = float2(p.x * 1.6 - p.y * 1.2, p.x * 1.2 + p.y * 1.6) + 7.3; a *= 0.5; }
    return s;
}
static inline float4 sky_cloudDeck(float3 d, float3 sun, float3 sunE, float3 skyUp, float t, float night) {
    if (d.y < 0.012) return 0;
    // Where the ray meets a plane 2 km up (the cumulus) and 8 km up (the cirrus), in km across the ground.
    float2 p = d.xz / d.y * 2.0 + float2(t * 0.004, t * 0.0015);
    float2 q = float2(sky_cloudFbm(p * 0.35, 3), sky_cloudFbm(p * 0.35 + 5.2, 3));
    float base = sky_cloudFbm(p * 0.55 + q * 1.6, 5);
    float cov = smoothstep(0.50, 0.78, base);
    float2 pc = d.xz / d.y * 8.0 + float2(t * 0.01, 0.0);
    float cir = smoothstep(0.52, 0.9, sky_cloudFbm(float2(pc.x * 0.12, pc.y * 0.5), 4)) * 0.45;
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
// The cloud map's mapping: azimuth round the whole sky across, elevation up (packed toward the horizon, where clouds crowd).
static inline float2 sky_cloudUV(float3 d) {
    float az = atan2(d.x, d.z) / (2.0 * M_PI_F) + 0.5, el = asin(clamp(d.y, 0.0, 1.0)) / (0.5 * M_PI_F);
    return float2(az, sqrt(el));
}
static inline float3 sky_cloudDir(float2 uv) {
    float az = (uv.x - 0.5) * 2.0 * M_PI_F, el = uv.y * uv.y * 0.5 * M_PI_F;
    return float3(sin(az) * cos(el), sin(el), cos(az) * cos(el));
}
static inline float4 sky_clouds(texture2d<float> C, float3 d) {
    if (d.y < 0.0) return 0;
    constexpr sampler s(filter::linear, s_address::repeat, t_address::clamp_to_edge);
    return C.sample(s, sky_cloudUV(d));
}
