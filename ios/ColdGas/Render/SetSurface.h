// The sets' surfaces (0273): concrete and steel that look built and used, from one baked 512² texture (set-detail.png,
// scripts/bake-set-detail.swift) sampled twice in world space, plus the slab's saw-cut joints and the run line's rubber,
// worked out here. Two fetches and a few dozen ALU ops on a set pixel; the car, the parked row and the effects never
// come here (Material.flags.w bits 8 and 16, set by SetSurface.swift on the static stage only).
//   detail.r  grain (near, 4 m)      detail.g  wear (far, 37 m)
//   detail.b  stains (far)           detail.a  steel brushing and scratches (near)
// Material.effect on a set surface (unused by a lit material otherwise): x the run line's x, y/z the z its rubber spans
// (near, far), w 1 where a run's rubber is laid.
#pragma once
#include <metal_stdlib>
using namespace metal;

struct SetSurfaceOut { float3 base; float rough; float wetK; };

static inline SetSurfaceOut setSurface(float3 base, float rough, float3 p, float3 n, uint kind, float4 run, texture2d<float> detail, float pixel) {
    constexpr sampler ds(coord::normalized, filter::linear, mip_filter::linear, address::repeat, max_anisotropy(2));
    float3 an = abs(n);
    bool floor = an.y > 0.7;
    // One planar projection by the face's main axis (no triplanar blend: three fetches would be twice the cost).
    float2 uv = floor ? p.xz : (an.x > an.z ? p.zy : p.xy);
    float4 near = detail.sample(ds, uv * 0.25);
    float4 far = detail.sample(ds, uv * (1.0 / 37.0) + float2(0.31, 0.57));
    SetSurfaceOut o;
    o.wetK = 1.0;
    // How much of the near detail survives this pixel's footprint (beyond ≈ 60 m it's all averaged anyway: the mips do it,
    // this just keeps the contrast from sparkling at a grazing angle).
    float nearK = 1.0 - smoothstep(0.08, 0.5, pixel);
    if (kind == 16u) {   // steel: brushed, scratched, darker and rougher where boots and tyres kick grime up
        float br = near.a - 0.5;
        o.base = base * (1.0 + 0.35 * br * nearK) * mix(0.82, 1.06, far.g);
        o.rough = clamp(rough + 0.22 * (0.5 - near.a) * nearK + 0.12 * (far.g - 0.5), 0.12, 1.0);
        float grime = 1.0 - smoothstep(0.0, 1.4, p.y);
        o.base *= 1.0 - 0.35 * grime * far.b;
        o.rough = mix(o.rough, 0.9, grime * 0.6);
        return o;
    }
    // concrete: the trowel's cloud and the aggregate, worn patches, stains
    float grain = mix(0.0, near.r - 0.5, nearK);
    float wear = far.g;
    float stain = far.b;
    float3 c = base * (1.0 + 0.55 * grain) * mix(0.8, 1.16, wear);
    float r = rough + 0.18 * (0.5 - wear) - 0.25 * grain * nearK;
    c *= 1.0 - 0.55 * stain;
    r = mix(r, 0.35, stain * 0.6);   // oil and rubber are smoother than the slab round them
    // Dust: where the slab is worn and dry, a pale film over the dark sealer (it reads on the black slabs, where darkening
    // alone can't), and the damp doesn't stand on it.
    float dust = smoothstep(0.45, 0.95, wear) * (1.0 - stain) * (0.75 + 0.5 * grain);
    c = mix(c, max(c, float3(0.085, 0.082, 0.078)), dust * 0.75);
    r = mix(r, 0.95, dust * 0.7);
    o.wetK = 1.0 - 0.8 * dust;
    if (floor) {
        // Saw-cut joints every 6 m, a few millimetres of shadow each; faded once a joint is under a pixel wide.
        float2 g = abs(fract(p.xz * (1.0 / 6.0) + 0.5) - 0.5) * 6.0;
        float jw = max(pixel * 0.75, 0.012);
        float joint = (1.0 - smoothstep(jw, jw * 2.0, min(g.x, g.y))) * (1.0 - smoothstep(0.15, 0.6, pixel));
        c *= 1.0 - 0.55 * joint;
        r = mix(r, 1.0, joint);
        o.wetK *= 1.0 - joint;
        // The run line's rubber: two tracks per wheel pair, heaviest where a launch spins up, thinning down the run.
        if (run.w > 0.5) {
            float zn = run.y, zf = run.z, along = clamp((p.z - zn) / (zf - zn), 0.0, 1.0);
            float inRun = step(min(zn, zf), p.z) * step(p.z, max(zn, zf));
            float dx = abs(abs(p.x - run.x) - 0.8);
            float track = (1.0 - smoothstep(0.08, 0.16, dx)) * inRun * mix(0.75, 0.15, along);
            track *= 0.6 + 0.4 * near.b + 0.3 * (far.g - 0.5);
            c *= 1.0 - 0.6 * clamp(track, 0.0, 1.0);
            r = mix(r, 0.45, clamp(track, 0.0, 1.0));
        }
        // Low in the corners of a wall's foot the floor gathers dust (vertical faces near y = 0 do the same below).
    } else {
        float foot = 1.0 - smoothstep(0.0, 0.8, p.y);
        c *= 1.0 - 0.3 * foot * (0.5 + wear);
    }
    o.base = max(c, 0.0);
    o.rough = clamp(r, 0.08, 1.0);
    return o;
}
