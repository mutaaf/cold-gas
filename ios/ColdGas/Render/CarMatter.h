// What the ground left on the car (0332, docs/NATIVE-MATTER.md §2): mud, dust and packed snow on the roadster's lower body
// and wheels, and the water on it (the WATER track's wetness), drawn on the car's own materials (Material.flags.w & 4) from
// ColdGasPhysics CarDirt, sent once a frame in Frame.matter. The coat is a mask in the car's own frame (it rides with the
// car, never swims): its height above the sills, how far toward the nose or the tail, how near a wheel; broken up by a
// noise fixed to the body so it lies in splashes and runs, not a band. Mud is matte (it kills the clear coat), dust a
// pale film, snow white packed in the arches. Water darkens and polishes: the clear coat's sheen comes up, dust goes to mud.
// Its looks: Real soft-edged splashes; Anime one flat tone with a clean edge; 8-bit chunkier blobs (the palette and the
// pixel pass do the rest). Off (one branch) when the car is clean and dry, and always on a scored run.
#pragma once
#include <metal_stdlib>
using namespace metal;

static float cm_hash(float3 p) { p = fract(p * float3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
static float cm_noise(float3 p) {
    float3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(cm_hash(i), cm_hash(i + float3(1, 0, 0)), u.x), mix(cm_hash(i + float3(0, 1, 0)), cm_hash(i + float3(1, 1, 0)), u.x), u.y);
    float b = mix(mix(cm_hash(i + float3(0, 0, 1)), cm_hash(i + float3(1, 0, 1)), u.x), mix(cm_hash(i + float3(0, 1, 1)), cm_hash(i + float3(1, 1, 1)), u.x), u.y);
    return mix(a, b, u.z);
}

/// The coat on a car pixel at `world`. m[0]: the car's ground point (xyz), w on; m[1]: its up, w wetness; m[2]: its forward,
/// w packed snow; m[3]: the coat's colour, w the body's coat; m[4]: sills, nose, tail, wheels; m[5]: front axle z, rear axle z,
/// half track, 0. Returns how much of the pixel is coated (0…1) and changes its colour, roughness and metal.
static float carMatter(float3 world, constant float4* m, float style, thread float3& base, thread float& rough, thread float& metal) {
    if (m[0].w < 0.5) return 0.0;
    float3 up = m[1].xyz, fw = m[2].xyz, rt = normalize(cross(up, fw) + 1e-6);
    float3 d = world - m[0].xyz;
    float h = dot(d, up), z = dot(d, fw), x = dot(d, rt);
    bool pixel = style > 1.5, drawn = style > 0.5;
    // Where each coat lies: the sills' band (thrown by the fronts), the tail's lower half (the rears'), the nose's (reversing),
    // the wheels and arches, and a light wash up the body in heavy mud.
    float low = 1.0 - smoothstep(0.18, 0.62, h);
    float nearWheel = max(1.0 - smoothstep(0.25, 0.55, length(float2(z - m[5].x, h - 0.33))), 1.0 - smoothstep(0.25, 0.55, length(float2(z - m[5].y, h - 0.33))));
    nearWheel *= smoothstep(m[5].z - 0.35, m[5].z - 0.1, abs(x));
    float tail = smoothstep(m[5].y - 0.2, m[5].y - 0.9, z) * (1.0 - smoothstep(0.3, 0.85, h));
    float nose = smoothstep(m[5].x + 0.2, m[5].x + 0.8, z) * (1.0 - smoothstep(0.2, 0.6, h));
    float body = 1.0 - smoothstep(0.35, 1.0, h);
    float want = max(max(m[4].x * low, m[4].w * nearWheel), max(max(m[4].z * tail, m[4].y * nose), m[3].w * body));
    // Broken into splashes, fixed to the body: two octaves in the car's frame (coarser in 8-bit: blocks, not grain).
    float3 q = float3(x, h, z) * (pixel ? 3.0 : 7.0);
    float nz = cm_noise(q) * 0.65 + cm_noise(q * 2.7 + 17.0) * 0.35;
    float edge = drawn ? 0.002 : 0.08;
    float k = smoothstep(nz - edge, nz + edge, want * 1.15 - 0.08);
    // Packed snow: in the arches and on the sills, white.
    float snow = smoothstep(nz - edge, nz + edge, m[2].w * max(nearWheel, low * 0.7) * 1.1 - 0.1);
    float wet = clamp(m[1].w, 0.0, 1.0);
    float3 coat = m[3].rgb * (1.0 - 0.35 * wet);   // wet mud is darker
    base = mix(base, coat, k * 0.95);
    base = mix(base, float3(0.62, 0.66, 0.72), snow);
    rough = mix(rough, mix(0.95, 0.45, wet), max(k, snow));   // matte coat; wet, it glistens
    metal *= 1.0 - max(k, snow);
    // Water on the paint: darker base, a smoother surface.
    base *= 1.0 - 0.18 * wet * (1.0 - k);
    rough = mix(rough, rough * 0.55, wet * (1.0 - k));
    return max(k, snow);
}
