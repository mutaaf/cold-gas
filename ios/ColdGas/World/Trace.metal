// The ground's memory, written (0331, docs/NATIVE-MATTER.md §2): a wheel's stroke pressed into its tile's layer of the trace
// texture (TraceField.swift; ColdGasWorld TraceAtlas cuts the strokes). One small quad per stroke over its own texel box (a few
// hundred texels), drawn into its layer with the texel's current value read in place (programmable blending: every Apple GPU,
// with no read-write texture tier needed), only on a frame a tyre crossed soft ground; nothing when idle.
// Channels (RGBA8, 0…1): R the rut's depth (× TraceSpec.depthScale m), G the berm pushed up beside it (× bermScale m), B how
// pressed it is (grass laid down, snow packed), A the matter's tag / 255 (0: untouched).
#include <metal_stdlib>
using namespace metal;

struct TraceStamp {
    float2 a, b;          // the stroke's ends (texels, in the tile's frame)
    float hw;             // the contact patch's half width (texels)
    float depth, berm, press, cap;   // what one pass adds; the deepest the rut gets
    uint slot, tag;
    int2 lo, hi;          // the box (inclusive)
};
struct TraceOut { float4 clip [[position]]; };

/// The stroke's box as a quad (the layer's 256² texels are the viewport; the pass draws into the stroke's layer).
vertex TraceOut cg_trace_vertex(uint vid [[vertex_id]], constant TraceStamp& s [[buffer(0)]], constant float& res [[buffer(1)]]) {
    const float2 c[6] = { {0, 0}, {1, 0}, {1, 1}, {0, 0}, {1, 1}, {0, 1} };
    float2 lo = float2(s.lo), hi = float2(s.hi) + 1.0;
    float2 p = mix(lo, hi, c[vid]) / res;
    TraceOut o; o.clip = float4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0, 1);   // (its layer is the pass's slice)
    return o;
}

fragment half4 cg_trace_fragment(TraceOut in [[stage_in]], constant TraceStamp& s [[buffer(0)]], half4 v [[color(0)]]) {
    float2 c = in.clip.xy, ab = s.b - s.a;   // the texel's centre (pixel coordinates are texels)
    float l2 = dot(ab, ab);
    // A half-open strip: a texel belongs to the stroke whose span it falls in, so consecutive strokes of one pass don't
    // press the same texels twice (a bead every 30 cm). A stroke with no length (the first contact) presses its patch.
    float u = l2 > 1e-4 ? dot(c - s.a, ab) / l2 : 0.5;
    if (l2 > 1e-4 && (u <= 0.0 || u > 1.0)) return v;
    float d = length(c - (s.a + ab * clamp(u, 0.0, 1.0))) / max(s.hw, 0.5);   // 0 under the tread's middle, 1 at its edge
    if (d >= 1.8) return v;
    float r = v.r, g = v.g, bb = v.b;
    if (d < 1.15) {
        // The tread: a flat floor, rounded shoulders; each pass deepens it toward the ground's own limit.
        float prof = 1.0 - smoothstep(0.7, 1.15, d);
        float cap = max(s.cap, 1e-3);
        r = max(r, min(cap, r + s.depth * prof * (1.0 - r / cap)));
        bb = min(1.0, bb + s.press * prof);
        g *= (1.0 - prof);   // the patch rolls flat whatever berm was there
    } else {
        // The berm: what the tread pushed aside, a ridge just outside it.
        float bump = sin((d - 1.15) / 0.65 * M_PI_F);
        g = min(1.0, g + s.berm * bump * (1.0 - r));
    }
    return half4(half(r), half(g), half(bb), half(float(s.tag) / 255.0));
}

// Where a render target can't be read in place (the simulator's GPU): the same stroke written for a max blend. A pass presses
// to its own depth (repeated passes don't deepen it) and the berm isn't rolled flat; everything else is the same.
fragment half4 cg_trace_fragment_max(TraceOut in [[stage_in]], constant TraceStamp& s [[buffer(0)]]) {
    float2 c = in.clip.xy, ab = s.b - s.a;
    float l2 = dot(ab, ab);
    float u = l2 > 1e-4 ? dot(c - s.a, ab) / l2 : 0.5;
    if (l2 > 1e-4 && (u <= 0.0 || u > 1.0)) return half4(0);
    float d = length(c - (s.a + ab * clamp(u, 0.0, 1.0))) / max(s.hw, 0.5);
    if (d >= 1.8) return half4(0);
    float tag = float(s.tag) / 255.0;
    if (d < 1.15) {
        float prof = 1.0 - smoothstep(0.7, 1.15, d);
        return half4(half(min(s.cap, s.depth * 1.6) * prof), 0, half(min(1.0, s.press * 2.0) * prof), half(tag));
    }
    return half4(0, half(min(1.0, s.berm * 1.6) * sin((d - 1.15) / 0.65 * M_PI_F)), 0, half(tag));
}
