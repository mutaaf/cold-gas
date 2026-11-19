// The ground's memory, written (0331, docs/NATIVE-MATTER.md §2): a wheel's stroke pressed into its tile's layer of the trace
// texture (TraceField.swift; ColdGasWorld TraceAtlas cuts the strokes). One small dispatch per stroke and tile, over the
// stroke's own texel box (a few hundred texels), only on a frame a tyre crossed soft ground; nothing when idle.
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

kernel void cg_trace_clear(texture2d_array<half, access::write> t [[texture(0)]], constant uint& slot [[buffer(0)]], uint2 gid [[thread_position_in_grid]]) {
    if (gid.x >= t.get_width() || gid.y >= t.get_height()) return;
    t.write(half4(0), gid, slot);
}

kernel void cg_trace_stamp(texture2d_array<half, access::read_write> t [[texture(0)]], constant TraceStamp& s [[buffer(0)]], uint2 gid [[thread_position_in_grid]]) {
    int2 p = int2(gid) + s.lo;
    if (any(p > s.hi)) return;
    float2 c = float2(p) + 0.5, ab = s.b - s.a;
    float l2 = dot(ab, ab);
    // A half-open strip: a texel belongs to the stroke whose span it falls in, so consecutive strokes of one pass don't
    // press the same texels twice (a bead every 30 cm). A stroke with no length (the first contact) presses its patch.
    float u = l2 > 1e-4 ? dot(c - s.a, ab) / l2 : 0.5;
    if (l2 > 1e-4 && (u <= 0.0 || u > 1.0)) return;
    float d = length(c - (s.a + ab * clamp(u, 0.0, 1.0))) / max(s.hw, 0.5);   // 0 under the tread's middle, 1 at its edge
    if (d >= 1.8) return;
    half4 v = t.read(uint2(p), s.slot);
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
    t.write(half4(half(r), half(g), half(bb), half(float(s.tag) / 255.0)), uint2(p), s.slot);
}
