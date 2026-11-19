// Rubber on a set's floor (0281): the scored run's skid marks, one pass of its own (RunSkids.swift) so a look can restyle it
// here without touching the stage's shader. The quads are the drive's (World/Marks.swift's ring: position relative to the
// origin, w the mark's strength), drawn over the floor with a depth bias, blended, and fading into the course's fog as
// the stage's own surfaces do (Shaders.metal: linear fog, or FogExp2 where the look has a density).
#include <metal_stdlib>
using namespace metal;

// Shaders.metal's Frame and LookU, as World.metal copies them (one layout, two names).
struct SkFrame {
    float4x4 viewProj, lightViewProj;
    float4 eye, keyDir, keyColor, fogColor, fogRange;
    float4x4 invViewProj;
    float4 proj, misc;
};
struct SkLook {
    float4 hemiSky, hemiGround, hazeCol, sunCol, sunDir, fogExp;
    float4 skyZenith, skyMid, skyHorizon, skySun, bloom;
};
struct SkIn { float4 pa [[attribute(0)]]; };
struct SkOut { float4 clip [[position]]; float3 world; float a; };

vertex SkOut cg_skid_vertex(SkIn in [[stage_in]], constant SkFrame& f [[buffer(1)]]) {
    SkOut o; o.world = in.pa.xyz; o.a = in.pa.w; o.clip = f.viewProj * float4(in.pa.xyz, 1);
    return o;
}
fragment float4 cg_skid_fragment(SkOut in [[stage_in]], constant SkFrame& f [[buffer(1)]], constant SkLook& k [[buffer(4)]]) {
    // Near-black rubber, polished by the slide: it takes a little of the sky's horizon as a sheen, so on the stage's dark
    // concrete it reads as a darker, smoother stripe rather than a hole.
    float3 c = float3(0.006, 0.006, 0.007) + k.skyHorizon.rgb * 0.06;
    float dist = max(distance(in.world, f.eye.xyz), 1e-3);
    float fog = 0;
    if (f.fogColor.w > 0.5) {
        fog = k.fogExp.x > 0 ? 1.0 - exp(-k.fogExp.x * k.fogExp.x * dist * dist) : clamp((dist - f.fogRange.x) / max(f.fogRange.y - f.fogRange.x, 1.0), 0.0, 1.0);
    }
    float a = clamp(0.2 + in.a, 0.0, 1.0) * 0.72 * (1.0 - fog);
    return float4(c, a);
}
