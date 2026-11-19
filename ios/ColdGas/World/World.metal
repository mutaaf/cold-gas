// Free Drive's world in Metal (docs/NATIVE-FREEDRIVE.md §4.3, §9): the CDLOD terrain with its geomorph and its baked surfaces,
// the road ribbons, the GPU-culled props, grass, the loose things and the rubber, all drawn camera-relative (positions arrive
// as `piece − origin`, so a tile 40 km out is as precise as one at the centre). The light is WorldShading.h's (one sun, one
// sky, one air, three looks). Compute:
//   cg_world_surface_bake  once when a tile enters: its 64 × 64 surface (rock, snow, wetness, water depth) from its own grid,
//                          with world-anchored, seamless noise breaking up the edges (WorldCache)
//   cg_world_prop_cull     every frame: each pooled instance against the frustum and its range, its LOD by distance, into
//                          per-kind, per-LOD lists, and the casters near the car into a shadow list (WorldProps)
//   cg_world_prop_args     the lists' counts into indirect draw arguments, and the counters back to zero
#include "WorldShading.h"
#include "WorldMatter.h"

// --- Terrain ------------------------------------------------------------------------------------------------------------
// A tile vertex (TileSpec.stride = 9 floats): position + the parent's height, normal, colour (rgb, a: scree), material
// (r snow, g wetness or water depth / 16, b road distance × 8, a flags: 1 water, 2 the slab).
struct WTerrainIn { float4 pm [[attribute(0)]]; float3 n [[attribute(1)]]; float4 col [[attribute(2)]]; float4 mat [[attribute(3)]]; };
// offset: the tile's corner − origin, w its level; morph: start, 1 / span, the tile's surface slot, its size (m).
struct WTile { float4 offset; float4 morph; };
struct WTerrainOut {
    float4 clip [[position]]; float3 world; float3 n; float4 col; float4 mat; float4 lightClip; float level;
    float3 amb; float3 airT; float3 airIn; float2 uv; float slot [[flat]];
};

vertex WTerrainOut cg_world_terrain_vertex(WTerrainIn in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WTile& t [[buffer(2)]],
                                           constant WLook& k [[buffer(4)]], texture2d<float> skyView [[texture(8)]]) {
    float3 p = in.pm.xyz + t.offset.xyz;
    float d = length(p.xz - f.eye.xz);
    float m = clamp((d - t.morph.x) * t.morph.y, 0.0, 1.0);
    p.y = mix(in.pm.y, in.pm.w, m) + t.offset.y;
    WTerrainOut o;
    o.world = p; o.n = in.n; o.col = in.col; o.mat = in.mat; o.level = t.offset.w;
    o.clip = f.viewProj * float4(p, 1);
    o.lightClip = f.lightViewProj * float4(p, 1);
    WSky sk = world_vsky(p, normalize(in.n + 1e-6), f, k, skyView);
    o.amb = sk.amb; o.airT = sk.T; o.airIn = sk.In;
    o.uv = in.pm.xz / t.morph.w; o.slot = t.morph.z;
    return o;
}

// The near land into the world's cached shadow (WorldProps): a hill throws its shade across the road at a low sun.
vertex float4 cg_world_terrain_shadow_vertex(WTerrainIn in [[stage_in]], constant float4x4& vp [[buffer(1)]], constant WTile& t [[buffer(2)]]) {
    return vp * float4(in.pm.xyz + t.offset.xyz, 1);
}

// The land's material (0310): the tile's bare colour (the biomes, the sand by the sea) dressed by its baked surface (rock and
// scree, snow, the wet shore), then the detail texture's few taps (a macro tone, dry patches and bare soil, grass clumps, rock
// strata and fractures), all world-anchored.
static WSurf world_land(float3 col, float scree, float3 n0, float2 w, float4 S, texture2d<float> det) {
    WSurf s = world_surf(col, n0);
    float rockK = smoothstep(0.45, 0.7, S.r), screeK = smoothstep(0.1, 0.45, S.r) * (1.0 - rockK) * scree;
    float snowK = S.g, wet = S.b;
    float green = clamp((col.g - max(col.r, col.b)) * 30.0, 0.0, 1.0);
    float4 M = det.sample(world_ds, w / 160.0), R = det.sample(world_ds, w / 47.0);
    float4 P = det.sample(world_ds, w / 23.0), C = det.sample(world_ds, w / 1.9);
    float3 a = col * (0.72 + 0.56 * M.r) * (0.82 + 0.36 * R.g);
    // Meadow: lush and dry patches, bare soil where the ground breaks.
    float dry = smoothstep(0.45, 0.75, P.r);
    float3 dryC = float3(0.12, 0.12, 0.055), lush = float3(0.045, 0.085, 0.03);
    float3 g = mix(a, mix(lush * (0.8 + 0.6 * M.r), dryC * (0.7 + 0.5 * M.r), dry * 0.7), 0.6 * green);
    g *= mix(1.0, 0.75 + 0.5 * C.b, green);
    float soil = smoothstep(0.7, 0.85, P.g + S.r * 0.35) * (1.0 - S.r * 0.5);
    g = mix(g, float3(0.13, 0.095, 0.065) * (0.8 + 0.4 * C.b), soil * 0.8 * green);
    // Scree: loose grey stone over the grass on the steeper ground.
    float3 scr = float3(0.2, 0.19, 0.175) * (0.7 + 0.5 * C.b) * (0.85 + 0.3 * R.b);
    g = mix(g, scr, screeK);
    // Rock: strata across the slope (the tone in bands of height) and fractures (the Worley edges).
    float crack = smoothstep(0.0, 0.12, C.a);
    float strata = 0.85 + 0.3 * R.b;
    float3 rock = float3(0.17, 0.155, 0.14) * (0.65 + 0.5 * R.b) * (0.75 + 0.25 * crack) * strata;
    a = mix(g, rock, rockK);
    s.rough = mix(1.0, 0.75, rockK);
    s.ao = mix(1.0, 0.6 + 0.4 * crack, rockK) * mix(1.0, 0.85 + 0.15 * C.b, green * (1.0 - rockK));
    // Snow: lying snow over all of it, wind-blown thin at its edge, crusted (a little sheen).
    float3 snowC = float3(0.72, 0.75, 0.8) * (0.92 + 0.12 * C.b);
    a = mix(a, snowC, snowK);
    s.rough = mix(s.rough, 0.55, snowK);
    s.ao = mix(s.ao, 1.0, snowK);
    // Wet: darker and glossier (sand and soil drink the water: albedo × ≈ 0.55), a skin of water at the very edge.
    a *= mix(1.0, 0.55, wet * (1.0 - snowK));
    s.rough = mix(s.rough, 0.35, smoothstep(0.55, 1.0, wet));
    s.albedo = a;
    return s;
}

fragment float4 cg_world_terrain_fragment(WTerrainOut in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]],
                                          constant WDrive& dr [[buffer(5)]], constant WorldGPU& g [[buffer(6)]],
                                          depth2d<float> shadow [[texture(3)]], texture2d<float> skyView [[texture(8)]],
                                          texture2d<float> det [[texture(10)]], texture2d_array<float> surface [[texture(11)]],
                                          texture2d_array<float> traces [[texture(12)]], texture2d<int> leafIndex [[texture(13)]],
                                          depth2d<float> wshadow [[texture(14)]]) {
    if (dr.params.z > 0.5) {   // debug (`-fd-lod`): each level its own colour, with the stored albedo
        float3 lc[8] = { float3(1,0,0), float3(0,1,0), float3(0,0,1), float3(1,1,0), float3(0,1,1), float3(1,0,1), float3(1,1,1), float3(0.5,0.5,0.5) };
        return float4(lc[int(clamp(in.level, 0.0, 7.0))] * 0.05 + in.col.rgb * 0.3, 1);
    }
    float3 n = normalize(in.n + 1e-6);
    float4 S = surface.sample(world_cs, clamp(in.uv, 0.0, 1.0), uint(in.slot));
    int fl = int(in.mat.a * 255.0 + 0.5);
    bool waterFlat = (fl & 1) != 0 && g.flags.x < 0.5;
    float2 w = in.world.xz + dr.anchor.xy;
    WSurf s;
    if (!waterFlat) {
        s = world_land(in.col.rgb, in.col.a, n, w, S, det);
        if (S.a > 0) {   // the seabed (a layer draws the water over it): wet sand and silt, darker with depth
            float dep = S.a * 16.0;
            s.albedo = mix(s.albedo, float3(0.09, 0.08, 0.06), smoothstep(0.0, 6.0, dep)) * mix(1.0, 0.4, smoothstep(2.0, 16.0, dep));
            s.rough = 0.6;
        }
        // MATTER's ruts, scuffs and mud (WorldMatter.h), on the finest tiles round the car.
        float4 tr = in.level < 0.5 ? world_traceAt(in.world.xz, g, leafIndex, traces) : float4(0);
        matter_ground(s, in.world, tr, S, dr);
        s.ao *= world_carAO(in.world, dr);
    } else {
        // The sea drawn flat (until a water layer owns it): small waves from the detail, clearer and greener where it's shallow.
        float t = dr.params.y;
        float wv = det.sample(world_ds, w / 40.0 + t * 0.004).g - 0.5, wv2 = det.sample(world_ds, w / 9.0 - t * 0.011).b - 0.5;
        s = world_surf(in.col.rgb, normalize(float3(sin(in.world.x * 0.21 + t * 0.6) * 0.03 + wv * 0.08 + wv2 * 0.03, 1.0,
                                                     cos(in.world.z * 0.17 + t * 0.5) * 0.03 - wv * 0.06 - wv2 * 0.03)));
        float dep = in.mat.g * 16.0;
        s.albedo = mix(float3(0.03, 0.075, 0.07), in.col.rgb, smoothstep(0.5, 8.0, dep));
        s.spec = 0.85; s.rough = 0.05;
        // Surf: a pale line where the sea meets the land, breathing in and out.
        float surf = (1.0 - smoothstep(0.0, 0.6, dep)) * (0.6 + 0.4 * sin(t * 0.8 + w.x * 0.05 + w.y * 0.04));
        s.albedo = mix(s.albedo, float3(0.6, 0.62, 0.62), surf * 0.7);
        s.spec *= 1.0 - surf * 0.7;
    }
    float3 c = world_light(s, in.world, in.lightClip, in.amb, f, k, dr, shadow, skyView, wshadow);
    return float4(world_air(c, in.airT, in.airIn, f), 1);
}

// The surface bake (0310, §9.3): one thread a texel of a tile's 64 × 64 slice, once when the tile enters.
struct WBake { uint slot; uint vertexBase; float size; float level; float2 corner; float2 pad; };
// Value noise whose lattice wraps every `period` cells (the corner is the origin-free world position mod 4,096 m, and every
// scale used divides 4,096), so the pattern is seamless across tiles and across the wrap.
static float world_pnoise(float2 p, float period) {
    float2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    float2 i0 = fmod(fmod(i, period) + period, period), i1 = fmod(i0 + 1.0, period);
    return mix(mix(world_hash(i0), world_hash(float2(i1.x, i0.y)), u.x), mix(world_hash(float2(i0.x, i1.y)), world_hash(i1), u.x), u.y);
}
static float world_pfbm(float2 w, float scale, float texel) {
    float s = 0, a = 0.5, tot = 0;
    for (int o = 0; o < 3; o++) {
        float sc = scale / float(1 << o);
        if (sc < texel * 1.5) break;   // finer than the texel: it would alias
        s += a * world_pnoise(w / sc, 4096.0 / sc); tot += a; a *= 0.5;
    }
    return tot > 0 ? s / tot : 0.5;
}
kernel void cg_world_surface_bake(uint2 gid [[thread_position_in_grid]], constant WBake& b [[buffer(0)]], const device float* slab [[buffer(1)]],
                                  texture2d_array<float, access::write> surface [[texture(0)]]) {
    if (gid.x >= 64 || gid.y >= 64) return;
    const int W = 33, ST = 9;
    float2 uv = (float2(gid) + 0.5) / 64.0;
    float2 q = uv * 32.0;
    int2 c0 = min(int2(floor(q)), int2(31));
    float2 fr = q - float2(c0);
    float y = 0, snow = 0, wet = 0, water = 0, depth = 0, scree = 0;
    float3 n = 0;
    for (int k = 0; k < 4; k++) {
        int2 c = c0 + int2(k & 1, k >> 1);
        float wgt = ((k & 1) ? fr.x : 1.0 - fr.x) * ((k >> 1) ? fr.y : 1.0 - fr.y);
        uint base = b.vertexBase + uint(c.y * W + c.x) * ST;
        y += slab[base + 1] * wgt;
        n += float3(slab[base + 4], slab[base + 5], slab[base + 6]) * wgt;
        uint col = as_type<uint>(slab[base + 7]), mat = as_type<uint>(slab[base + 8]);
        scree += float(col >> 24) / 255.0 * wgt;
        bool wv = (mat >> 24 & 1u) != 0;
        float mg = float((mat >> 8) & 255u) / 255.0;
        snow += float(mat & 255u) / 255.0 * wgt;
        wet += (wv ? 1.0 : mg) * wgt;
        water += (wv ? 1.0 : 0.0) * wgt;
        depth += (wv ? mg : 0.0) * wgt;
    }
    n = normalize(n + 1e-6);
    float texel = b.size / 64.0;
    float2 wp = fmod(b.corner + uv * b.size, 4096.0);
    float n1 = world_pfbm(wp, 64.0, texel), n2 = world_pfbm(wp + 517.0, 128.0, texel), n3 = world_pfbm(wp + 1301.0, 32.0, texel);
    float slope = 1.0 - n.y + (n1 - 0.5) * 0.14;
    // Rockiness: scree (0.1 … 0.45) on the steeper ground of the mountains and the desert, bare rock past ≈ 30° (0.45 … 1).
    float rock = max(scree * 0.45 * smoothstep(0.2, 0.34, slope), smoothstep(0.3, 0.5, slope));
    // Snow: the land's snow line broken by drifts, never on the steep rock.
    float sn = smoothstep(0.3, 0.7, snow + (n2 - 0.5) * 0.45) * (1.0 - smoothstep(0.42, 0.6, slope));
    // Wetness: the shore's damp band, its edge ragged; under water, soaked.
    float wt = clamp(wet + (n3 - 0.5) * 0.3 * wet, 0.0, 1.0);
    surface.write(float4(rock * (1.0 - water), sn, wt, clamp(depth, 0.0, 1.0)), gid, b.slot);
    (void)y;
}

// A trace slice made blank when a leaf takes it (WorldCache.assignTraces).
kernel void cg_world_trace_clear(uint2 gid [[thread_position_in_grid]], constant uint& slice [[buffer(0)]],
                                 texture2d_array<float, access::write> traces [[texture(0)]]) {
    if (gid.x >= traces.get_width() || gid.y >= traces.get_height()) return;
    traces.write(float4(0), gid, slice);
}

// --- Roads ---------------------------------------------------------------------------------------------------------------
struct WRoadIn { float3 pos [[attribute(0)]]; float2 la [[attribute(1)]]; float3 n [[attribute(2)]]; float4 col [[attribute(3)]]; };
struct WRoadOut { float4 clip [[position]]; float3 world; float2 la; float3 n; float3 col; float4 lightClip; float3 amb; float3 airT; float3 airIn; };
vertex WRoadOut cg_world_road_vertex(WRoadIn in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WTile& t [[buffer(2)]],
                                     constant WLook& k [[buffer(4)]], texture2d<float> skyView [[texture(8)]]) {
    float3 p = in.pos + t.offset.xyz;
    WRoadOut o; o.world = p; o.la = in.la; o.n = in.n; o.col = in.col.rgb;
    o.clip = f.viewProj * float4(p, 1); o.lightClip = f.lightViewProj * float4(p, 1);
    WSky sk = world_vsky(p, normalize(in.n + 1e-6), f, k, skyView);
    o.amb = sk.amb; o.airT = sk.T; o.airIn = sk.In;
    return o;
}
// The road (#365's, kept): a used two-lane asphalt. The binder's tone in patches and relaid repairs, sealed cracks and the
// centre joint as glossy tar, the wheel tracks polished, an oil line down each lane, aggregate up close, dust toward the edges,
// the paint worn where the tyres cross it; the gravel shoulder; the verge in the land's colour, dressed by the baked surface.
fragment float4 cg_world_road_fragment(WRoadOut in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]],
                                       constant WDrive& dr [[buffer(5)]], constant WorldGPU& g [[buffer(6)]],
                                       depth2d<float> shadow [[texture(3)]], texture2d<float> skyView [[texture(8)]],
                                       texture2d<float> det [[texture(10)]], texture2d_array<float> surface [[texture(11)]],
                                       texture2d_array<float> traces [[texture(12)]], texture2d<int> leafIndex [[texture(13)]],
                                       depth2d<float> wshadow [[texture(14)]]) {
    float lat = in.la.x, along = in.la.y, al = abs(lat);
    const float hw = 3.5;
    float dist = distance(in.world, f.eye.xyz);
    float pxM = dist * 2.0 / max(f.proj.y * f.proj.w, 1.0);
    float2 w = in.world.xz + dr.anchor.xy;
    float2 ra = float2(lat, along);
    float3 n = normalize(in.n + 1e-6);
    WSurf s = world_surf(float3(0), n);
    float4 A = det.sample(world_ds, ra / float2(6.0, 26.0));
    float4 G = det.sample(world_ds, w / 0.45);
    float4 K = det.sample(world_ds, ra / float2(2.4, 3.6));
    float4 Wr = det.sample(world_ds, ra / float2(0.5, 1.6));
    float3 asphalt = float3(0.062, 0.061, 0.064) * (0.78 + 0.5 * A.r);
    float cellA = floor(along / 11.0), rnd = world_hash(float2(cellA, 3.7));
    float pL0 = (world_hash(float2(cellA, 9.1)) - 0.5) * 4.0, pL1 = pL0 + 1.2 + world_hash(float2(cellA, 1.3)) * 2.2;
    float pA = fract(along / 11.0) * 11.0, pA0 = 1.0 + world_hash(float2(cellA, 5.5)) * 3.0, pA1 = pA0 + 2.0 + world_hash(float2(cellA, 2.2)) * 4.0;
    float isP = step(0.72, rnd);
    float inPatch = isP * step(pL0, lat) * step(lat, pL1) * step(pA0, pA) * step(pA, pA1);
    float near = min(min(abs(lat - pL0), abs(lat - pL1)), min(abs(pA - pA0), abs(pA - pA1)));
    float patchEdge = isP * (1.0 - smoothstep(0.0, 0.05 + pxM, near)) * step(pL0 - 0.06, lat) * step(lat, pL1 + 0.06) * step(pA0 - 0.06, pA) * step(pA, pA1 + 0.06);
    asphalt = mix(asphalt, float3(0.035, 0.036, 0.04), inPatch * 0.85);
    float lane = abs(al - 1.75);
    float track = (1.0 - smoothstep(0.18, 0.42, abs(lane - 0.8))) * (1.0 - smoothstep(hw - 0.4, hw, al));
    float oil = (1.0 - smoothstep(0.1, 0.45, lane)) * (0.6 + 0.4 * A.g);
    asphalt *= 1.0 - 0.07 * track - 0.15 * oil * (1.0 - track);
    asphalt *= 0.92 + 0.12 * G.b + 0.12 * smoothstep(0.25, 0.05, G.a);
    float crack = (1.0 - smoothstep(0.0, 0.05 + pxM * 2.0, K.a)) * smoothstep(0.55, 0.75, K.g) * (1.0 - smoothstep(0.03, 0.12, pxM));
    float joint = (1.0 - smoothstep(0.02, 0.05 + pxM, abs(lat))) * 0.7;
    float tar = max(max(crack, joint), patchEdge * 0.9);
    asphalt = mix(asphalt, float3(0.012, 0.012, 0.014), tar);
    float dust = smoothstep(hw - 1.1, hw - 0.2, al) * (0.5 + 0.5 * Wr.g);
    asphalt = mix(asphalt, float3(0.11, 0.098, 0.082), dust * 0.55);
    float3 gravel = float3(0.17, 0.155, 0.13) * (0.7 + 0.6 * G.b);
    float shoulder = smoothstep(hw - 0.02, hw + 0.02 + pxM, al);
    float3 albedo = mix(asphalt, gravel, shoulder);
    float vergeK = 0.0;
    WSurf land = s;
    float4 S = 0;
    if (al > hw + 1.2) {
        S = world_landAt(in.world.xz, g, leafIndex, surface);
        S.r *= 0.5;   // (the verge lies on the road's own gentle cutting: only its loose stone shows)
        land = world_land(in.col, 0.6, n, w, S, det);
        vergeK = smoothstep(hw + 1.2, hw + 2.4 + (A.b - 0.5) * 1.2, al);
        albedo = mix(albedo, land.albedo, vergeK);
    }
    float wl = max(fwidth(lat), 1e-3), wa = max(fwidth(along), 1e-3);
    float edge = smoothstep(0.12 + wl, 0.12 - wl, abs(al - (hw - 0.3)));
    float dash = smoothstep(0.075 + wl, 0.075 - wl, al) * smoothstep(0.25 + wa / 12.0, 0.25 - wa / 12.0, abs(fract(along / 12.0) - 0.125) * 2.0);
    float fade = 1.0 - smoothstep(300.0, 900.0, dist);
    float keep = smoothstep(0.18, 0.42, Wr.b + 0.15 - track * 0.35);
    float mk = max(edge, dash) * fade * mix(1.0, keep, 1.0 - smoothstep(0.03, 0.12, pxM));
    float3 paint = float3(0.66, 0.66, 0.63);
    albedo = mix(albedo, paint * (0.88 + 0.12 * G.b), mk);
    s.albedo = albedo; s.n = n;
    s.rough = mix(mix(0.82 - 0.14 * track, 0.42, tar), 0.6, mk);
    s.rough = mix(s.rough, 1.0, shoulder);
    s.rough = mix(s.rough, land.rough, vergeK);
    s.ao = mix(1.0, land.ao, vergeK);
    if (vergeK > 0) {
        float4 tr = world_traceAt(in.world.xz, g, leafIndex, traces);
        WSurf v = s;
        matter_ground(v, in.world, tr, S, dr);
        s = v;
    }
    s.ao *= world_carAO(in.world, dr);
    float3 c = world_light(s, in.world, in.lightClip, in.amb, f, k, dr, shadow, skyView, wshadow);
    // Painted lines are retroreflective: the headlamps come back off them.
    if (dr.lampPos.w > 0 && mk > 0) {
        float3 d = dr.lampPos.xyz - in.world; float dl = max(length(d), 1.0);
        float cone = smoothstep(dr.lampDir.w - 0.05, dr.lampDir.w + 0.06, dot(-d / dl, dr.lampDir.xyz)); cone *= cone;
        c += paint * mk * cone * dr.lampPos.w * 0.02 / dl * (1.0 - smoothstep(60.0, 160.0, dl));
    }
    return float4(world_air(c, in.airT, in.airIn, f), 1);
}

// --- Props: GPU-culled, instanced (the stage's 44-byte vertex: pos, nrm, uv, col) -----------------------------------------
struct WPropIn { float3 pos [[attribute(0)]]; float3 nrm [[attribute(1)]]; float2 uv [[attribute(2)]]; float3 col [[attribute(3)]]; };
// What the cull writes for each drawn instance: render-space position and yaw; scale (faded at the range's edge), tint, a seed.
struct WOutInst { float4 posYaw; float4 scaleTint; };
struct WPropOut { float4 clip [[position]]; float3 world; float3 n; float3 col; float glow; float4 lightClip; float seed; float3 amb; float3 airT; float3 airIn; };
static float3 world_propPos(WPropIn in, WOutInst I, constant WDrive& dr, thread float3& nOut) {
    float s = I.scaleTint.x;
    float c = cos(I.posYaw.w), sn = sin(I.posYaw.w);
    float3 lp = in.pos * s;
    // The wind (#365): crowns sway, more toward the top, each tree on its own phase; trunks, rocks and posts stay put.
    float green = clamp((in.col.g - max(in.col.r, in.col.b)) * 40.0, 0.0, 1.0);
    float sway = dr.params.w * green * max(lp.y - 1.0, 0.0) * 0.012;
    float ph = I.scaleTint.z, tm = dr.params.y;
    lp.x += sway * (sin(tm * 1.3 + ph) + 0.4 * sin(tm * 3.1 + ph * 2.0));
    lp.z += sway * 0.6 * cos(tm * 1.1 + ph * 1.3);
    nOut = float3(in.nrm.x * c + in.nrm.z * sn, in.nrm.y, -in.nrm.x * sn + in.nrm.z * c);
    return float3(lp.x * c + lp.z * sn, lp.y, -lp.x * sn + lp.z * c) + I.posYaw.xyz;
}
vertex WPropOut cg_world_prop_vertex(WPropIn in [[stage_in]], uint iid [[instance_id]], constant WFrame& f [[buffer(1)]],
                                     const device WOutInst* inst [[buffer(3)]], constant WDrive& dr [[buffer(5)]],
                                     constant WLook& k [[buffer(4)]], texture2d<float> skyView [[texture(8)]]) {
    WOutInst I = inst[iid];
    float3 n;
    float3 p = world_propPos(in, I, dr, n);
    WPropOut o; o.world = p; o.n = n; o.col = in.col * I.scaleTint.y; o.glow = in.uv.x; o.seed = I.scaleTint.z;
    o.clip = f.viewProj * float4(p, 1); o.lightClip = f.lightViewProj * float4(p, 1);
    WSky sk = world_vsky(p, normalize(n + 1e-6), f, k, skyView);
    o.amb = sk.amb; o.airT = sk.T; o.airIn = sk.In;
    return o;
}
// Into a shadow map: `frame` carries that map's view-projection as its viewProj (WorldProps' cached map).
vertex float4 cg_world_prop_shadow_vertex(WPropIn in [[stage_in]], uint iid [[instance_id]], constant float4x4& vp [[buffer(1)]],
                                          const device WOutInst* inst [[buffer(3)]], constant WDrive& dr [[buffer(5)]]) {
    float3 n;
    return vp * float4(world_propPos(in, inst[iid], dr, n), 1);
}
fragment float4 cg_world_prop_fragment(WPropOut in [[stage_in]], bool front [[front_facing]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]],
                                       constant WDrive& dr [[buffer(5)]], depth2d<float> shadow [[texture(3)]], texture2d<float> skyView [[texture(8)]],
                                       texture2d<float> det [[texture(10)]], depth2d<float> wshadow [[texture(14)]]) {
    float3 n = normalize(in.n + 1e-6);
    if (!front) n = -n;
    float3 col = in.col;
    WSurf s = world_surf(col, n);
    float green = clamp((col.g - max(col.r, col.b)) * 40.0, 0.0, 1.0);
    float gr = det.sample(world_ds, float2(in.world.x + in.world.z, in.world.y * 3.0) * 0.6).b;
    if (green > 0) {
        // Foliage: each tree its own hue, lit softly through (wrap) and from behind (transmission), a leafy grain.
        float hue = world_hash(float2(in.seed, 1.7));
        float3 tint = mix(float3(0.92, 1.0, 0.82), float3(1.25, 1.08, 0.72), hue);
        s.albedo = col * mix(float3(1), tint * (0.75 + 0.5 * gr), green);
        s.wrap = 0.45 * green; s.trans = 0.55 * green;
        s.ao = 0.75 + 0.25 * gr;
    } else {
        s.albedo = col * (0.85 + 0.3 * gr);
        s.rough = 0.85;
    }
    s.ao *= world_carAO(in.world, dr);
    float3 c = world_light(s, in.world, in.lightClip, in.amb, f, k, dr, shadow, skyView, wshadow);
    if (in.glow > 0.5 && dr.lampPos.w > 0) {   // a delineator's reflector: it lights up in the headlamps, from far off
        float3 d = dr.lampPos.xyz - in.world; float dist = max(length(d), 1.0);
        float cone = smoothstep(dr.lampDir.w - 0.25, dr.lampDir.w, dot(-d / dist, dr.lampDir.xyz));
        c += float3(1.0, 0.72, 0.35) * cone * dr.lampPos.w * 0.5 / (dist * 2.0) * (1.0 - smoothstep(220.0, 400.0, dist));
    }
    return float4(world_air(c, in.airT, in.airIn, f), 1);
}

// The cull (0310, §9.6). One thread a pool slot.
struct WPoolInst { float4 posYaw; float scale; float tint; uint kindItem; uint blockCell; };   // kindItem 0xffffffff: free
struct WKind { float4 ends; float4 info; };   // ends: LOD0, LOD1, LOD2 end distances (m), the kind's last; info: LODs, shadow LOD, casts, bound radius
struct WCull {
    float4 planes[6];
    float4 eye;        // xyz render space; w: the props' far range (m)
    float4 shadow;     // xyz the shadow box's centre (render space); w its radius (0: no shadow list)
    uint4 counts;      // x: slots to look at; y: kinds; z: lists a kind (4); w: —
    WKind kinds[8];
    uint4 cap[8];      // each kind's list capacities: LOD0, LOD1, LOD2, shadow
    uint4 base[8];     // each kind's lists' first instance in the output
};
kernel void cg_world_prop_cull(uint id [[thread_position_in_grid]], constant WCull& u [[buffer(0)]], const device WPoolInst* pool [[buffer(1)]],
                               constant float4* blocks [[buffer(2)]], device WOutInst* out [[buffer(3)]], device atomic_uint* counters [[buffer(4)]]) {
    if (id >= u.counts.x) return;
    WPoolInst I = pool[id];
    if (I.kindItem == 0xffffffffu || I.scale <= 0) return;
    uint kind = I.kindItem & 255u;
    if (kind >= u.counts.y) return;
    float4 blk = blocks[I.blockCell & 0xffffu];
    if (blk.w < 0.5) return;
    float3 p = I.posYaw.xyz + blk.xyz;
    WKind K = u.kinds[kind];
    float d = length(p.xz - u.eye.xz);
    float far = min(u.eye.w, K.ends.w);
    float seed = I.posYaw.x * 1.31 + I.posYaw.z * 0.77 + float(I.blockCell & 0xffffu) * 13.7;
    // The shadow list: casters near the car, whatever the camera sees (their shadows fall into view).
    if (u.shadow.w > 0 && K.info.z > 0.5 && distance(p.xz, u.shadow.xz) < u.shadow.w) {
        uint li = kind * 4 + 3;
        uint at = atomic_fetch_add_explicit(&counters[li], 1, memory_order_relaxed);
        if (at < u.cap[kind][3]) out[u.base[kind][3] + at] = WOutInst{ float4(p, I.posYaw.w), float4(I.scale, I.tint, seed, float(kind)) };
    }
    if (d > far) return;
    // The frustum: the instance's bounding sphere against the six planes.
    float r = K.info.w * I.scale;
    float3 c = p + float3(0, r * 0.8, 0);
    for (int i = 0; i < 6; i++) if (dot(u.planes[i].xyz, c) + u.planes[i].w < -r) return;
    uint lods = uint(K.info.x);
    uint lod = d < K.ends.x ? 0u : (d < K.ends.y ? 1u : 2u);
    lod = min(lod, lods - 1);
    // Grown in from nothing over the last 15 % of the range (no pop).
    float s = I.scale * (1.0 - smoothstep(far * 0.85, far, d));
    uint li = kind * 4 + lod;
    uint at = atomic_fetch_add_explicit(&counters[li], 1, memory_order_relaxed);
    if (at < u.cap[kind][lod]) out[u.base[kind][lod] + at] = WOutInst{ float4(p, I.posYaw.w), float4(s, I.tint, seed, float(kind)) };
}
// One thread a list: the indirect arguments (MTLDrawIndexedPrimitivesIndirectArguments), the count kept for the stats, the
// counter back to zero for the next frame.
struct WDrawArgs { uint indexCount; uint instanceCount; uint indexStart; int baseVertex; uint baseInstance; };
kernel void cg_world_prop_args(uint id [[thread_position_in_grid]], constant uint4& n [[buffer(0)]], device atomic_uint* counters [[buffer(1)]],
                               constant uint* indexCounts [[buffer(2)]], constant uint* caps [[buffer(3)]], device WDrawArgs* args [[buffer(4)]],
                               device uint* stats [[buffer(5)]]) {
    if (id >= n.x) return;
    uint c = atomic_exchange_explicit(&counters[id], 0u, memory_order_relaxed);
    uint k = min(c, caps[id]);
    args[id] = WDrawArgs{ indexCounts[id], indexCounts[id] > 0 ? k : 0u, 0u, 0, 0u };
    stats[id] = c;
}

// --- Grass (#365, on the baked land): blades near the eye -------------------------------------------------------------------
// Each instance a clump of blades on a jittered grid over a finest-level tile. The ground's height, normal, colour and the road's
// distance come from the tile's own vertices, so a clump stands exactly on the land drawn. None on the road, its shoulder, on
// water, rock, snow or the set's slab; thinner and shorter with distance, gone by the radius; bent by the wind.
struct WGrass { float4 offset; int4 cells; float4 params; };   // offset: the tile's corner − origin, w its slot; cells: i0, j0, columns; params: spacing, radius, density, blades
struct WGrassOut { float4 clip [[position]]; float3 world; float3 n; float3 col; float tip; float4 lightClip; float3 amb; float3 airT; float3 airIn; };
vertex WGrassOut cg_world_grass_vertex(uint vid [[vertex_id]], uint iid [[instance_id]], constant WFrame& f [[buffer(1)]],
                                        constant WGrass& g [[buffer(2)]], const device float* tile [[buffer(0)]], constant WDrive& dr [[buffer(5)]],
                                        constant WLook& k [[buffer(4)]], texture2d<float> skyView [[texture(8)]], texture2d<float> det [[texture(10)]],
                                        texture2d_array<float> surface [[texture(11)]]) {
    WGrassOut o;
    o.clip = float4(2, 2, 2, 1); o.world = 0; o.n = float3(0, 1, 0); o.col = 0; o.tip = 0; o.lightClip = 0; o.amb = 0; o.airT = 1; o.airIn = 0;
    int ci = g.cells.x + int(iid) % g.cells.z, cj = g.cells.y + int(iid) / g.cells.z;
    float sp = g.params.x;
    float2 cellW = float2(ci, cj) * sp + g.offset.xz + dr.anchor.xy;
    float h0 = world_hash(cellW * 0.37 + 0.5), h1 = world_hash(cellW * 0.71 + 3.1), h2 = world_hash(cellW * 0.13 + 7.7);
    float2 lp = (float2(ci, cj) + float2(h0, h1)) * sp;
    if (any(lp < 0.0) || any(lp >= 128.0)) return o;
    float3 base = float3(lp.x, 0, lp.y) + g.offset.xyz;
    float d = length(base.xz - f.eye.xz);
    float R = g.params.y;
    float keep = 1.0 - smoothstep(R * 0.35, R, d);
    if (h2 > keep * g.params.z) return o;
    const int W = 33, ST = 9;
    float2 q = lp / 4.0; int2 c0 = clamp(int2(floor(q)), int2(0), int2(31)); float2 fr = q - float2(c0);
    int ia = (c0.y * W + c0.x) * ST, ib = ia + ST, ic = ia + W * ST, id = ic + ST;
    float ya = tile[ia + 1], yb = tile[ib + 1], yc = tile[ic + 1], yd = tile[id + 1];
    float y = fr.x > fr.y ? ya + (yb - ya) * fr.x + (yd - yb) * fr.y : ya + (yc - ya) * fr.y + (yd - yc) * fr.x;
    float3 n = normalize(float3(tile[ia + 4], tile[ia + 5], tile[ia + 6]));
    uint cb = as_type<uint>(tile[ia + 7]), mb = as_type<uint>(tile[ia + 8]);
    float3 col = float3(cb & 255u, (cb >> 8) & 255u, (cb >> 16) & 255u) / 255.0;
    float road = float((mb >> 16) & 255u) / 8.0;
    if ((mb >> 24) != 0u) return o;                                     // water or the slab
    if (road < 5.4) return o;                                           // the road, its shoulder and the gravel
    float4 S = surface.sample(world_cs, lp / 128.0, uint(g.offset.w), level(0.0));
    if (S.r > 0.3 || S.g > 0.3 || n.y < 0.82) return o;                 // rock, scree, snow, too steep
    if (col.r > col.g * 1.3 || dot(col, float3(0.33)) > 0.3) return o; // sand, desert, concrete
    y += 0.4 * (1.0 - smoothstep(14.7 - 3.0, 14.7, road));             // stand on the verge's ribbon, not in the dip under it
    float2 wp = cellW;
    float4 pd = det.sample(world_ds, wp / 23.0, level(0.0));
    float patch = det.sample(world_ds, wp / 7.0, level(0.0)).g;
    float tall = (0.14 + 0.42 * smoothstep(0.25, 0.85, patch)) * (0.7 + 0.6 * h0) * mix(0.55, 1.0, keep);
    tall *= smoothstep(5.4, 7.0, road) * (1.0 - S.b * 0.6);
    uint blade = vid / 3, corner = vid % 3;
    float nb = g.params.w;
    float ang = (float(blade) + h1 * nb) * (6.2832 / nb) + h0 * 6.28;
    float2 dir = float2(cos(ang), sin(ang));
    float bw = 0.035 + 0.035 * h2, lean = 0.35 + 0.4 * world_hash(float2(float(blade), h0 * 31.0));
    float bh = tall * (0.65 + 0.5 * world_hash(float2(h1 * 17.0, float(blade))));
    float tm = dr.params.y, wind = dr.params.w;
    float2 gust = float2(0.8, 0.45) * (0.5 + 0.5 * sin(tm * 1.7 + wp.x * 0.21 + wp.y * 0.13)) * wind;
    float3 p;
    float2 side = float2(-dir.y, dir.x) * bw;
    if (corner == 0) p = float3(-side.x, 0, -side.y);
    else if (corner == 1) p = float3(side.x, 0, side.y);
    else { float2 tipXZ = dir * lean * bh + gust * bh; p = float3(tipXZ.x, bh, tipXZ.y); }
    p += float3(dir.x, 0, dir.y) * 0.04;
    float3 w = base + float3(0, y, 0) + p;
    float3 bn = normalize(float3(dir.x, 0.6, dir.y));
    o.world = w; o.n = normalize(n * 0.6 + bn * 0.4);
    o.tip = corner == 2 ? 1.0 : 0.0;
    float dry = smoothstep(0.45, 0.75, pd.r);
    o.col = mix(col * float3(0.9, 1.15, 0.8), float3(0.2, 0.17, 0.08), dry * 0.6) * (0.75 + 0.5 * h2);
    o.clip = f.viewProj * float4(w, 1); o.lightClip = f.lightViewProj * float4(w, 1);
    WSky sk = world_vsky(w, o.n, f, k, skyView);
    o.amb = sk.amb; o.airT = sk.T; o.airIn = sk.In;
    return o;
}
fragment float4 cg_world_grass_fragment(WGrassOut in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]],
                                        constant WDrive& dr [[buffer(5)]], depth2d<float> shadow [[texture(3)]], texture2d<float> skyView [[texture(8)]],
                                        depth2d<float> wshadow [[texture(14)]]) {
    WSurf s = world_surf(in.col * (0.55 + 0.75 * in.tip), normalize(in.n));
    s.wrap = 0.6; s.trans = 0.8;
    s.ao = 0.45 + 0.55 * in.tip;
    float3 c = world_light(s, in.world, in.lightClip, in.amb, f, k, dr, shadow, skyView, wshadow);
    return float4(world_air(c, in.airT, in.airIn, f), 1);
}

// --- Impostors (0310, WorldImpostors.swift): far trees as a photograph of the near one --------------------------------------
// The bake: the mesh turned by −angle about y, seen from +z in an orthographic box (half width r, height h), into a viewport a side.
struct WImpBakeOut { float4 clip [[position]]; float3 n; float3 col; };
struct WImpBakeFrag { float4 albedo [[color(0)]]; float4 normal [[color(1)]]; };
vertex WImpBakeOut cg_world_imp_bake_vertex(WPropIn in [[stage_in]], constant float4& u [[buffer(1)]]) {
    float c = cos(-u.z), s = sin(-u.z);
    float3 p = float3(in.pos.x * c + in.pos.z * s, in.pos.y, -in.pos.x * s + in.pos.z * c);
    float3 n = float3(in.nrm.x * c + in.nrm.z * s, in.nrm.y, -in.nrm.x * s + in.nrm.z * c);
    WImpBakeOut o;
    o.clip = float4(p.x / u.x, p.y / u.y * 2.0 - 1.0, 0.5 - p.z / (u.x * 2.2), 1);
    o.n = n; o.col = in.col;
    return o;
}
fragment WImpBakeFrag cg_world_imp_bake_fragment(WImpBakeOut in [[stage_in]], bool front [[front_facing]]) {
    float3 n = normalize(in.n + 1e-6);
    if (!front) n = -n;
    WImpBakeFrag o; o.albedo = float4(in.col, 1); o.normal = float4(n * 0.5 + 0.5, 1);
    return o;
}
// The draw: a quad standing at the instance, turned to the camera about y, showing the side of the photograph the camera is on.
struct WImpOut { float4 clip [[position]]; float3 world; float2 uv; float ang; float slice [[flat]]; float4 lightClip; float seed; float3 amb; float3 airT; float3 airIn; };
vertex WImpOut cg_world_imp_vertex(WPropIn in [[stage_in]], uint iid [[instance_id]], constant WFrame& f [[buffer(1)]],
                                   const device WOutInst* inst [[buffer(3)]], constant float4& b [[buffer(7)]], constant WDrive& dr [[buffer(5)]],
                                   constant WLook& k [[buffer(4)]], texture2d<float> skyView [[texture(8)]]) {
    WOutInst I = inst[iid];
    float3 base = I.posYaw.xyz;
    float2 v = f.eye.xz - base.xz; float lv = length(v); v = lv > 1e-3 ? v / lv : float2(0, 1);
    float th = atan2(v.x, v.y) - I.posYaw.w;
    const float N = 8.0;
    float idx = fmod(fmod(round(th / (2.0 * M_PI_F / N)), N) + N, N);
    float s = I.scaleTint.x;
    float3 right = float3(v.y, 0, -v.x);
    // The crown leans with the wind as the near trees' do.
    float sway = dr.params.w * in.pos.y * b.y * s * 0.012 * sin(dr.params.y * 1.3 + I.scaleTint.z);
    float3 p = base + right * (in.pos.x * b.x * s + sway) + float3(0, in.pos.y * b.y * s, 0);
    WImpOut o;
    o.world = p; o.uv = float2((idx + in.pos.x * 0.5 + 0.5) / N, 1.0 - in.pos.y);
    o.ang = idx * (2.0 * M_PI_F / N) + I.posYaw.w;
    o.slice = b.z; o.seed = I.scaleTint.z;
    o.clip = f.viewProj * float4(p, 1); o.lightClip = f.lightViewProj * float4(p, 1);
    WSky sk = world_vsky(p, float3(0, 1, 0), f, k, skyView);
    o.amb = sk.amb * 0.9; o.airT = sk.T; o.airIn = sk.In;
    return o;
}
fragment float4 cg_world_imp_fragment(WImpOut in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]],
                                      constant WDrive& dr [[buffer(5)]], depth2d<float> shadow [[texture(3)]], texture2d<float> skyView [[texture(8)]],
                                      texture2d_array<float> albedo [[texture(0)]], texture2d_array<float> normals [[texture(1)]],
                                      depth2d<float> wshadow [[texture(14)]]) {
    float4 a = albedo.sample(world_cs, in.uv, uint(in.slice));
    if (a.a < 0.5) discard_fragment();
    float3 nb = normals.sample(world_cs, in.uv, uint(in.slice)).xyz * 2.0 - 1.0;
    float c = cos(in.ang), s = sin(in.ang);
    float3 n = normalize(float3(nb.x * c + nb.z * s, nb.y, -nb.x * s + nb.z * c) + 1e-6);
    float hue = world_hash(float2(in.seed, 1.7));
    WSurf sf = world_surf(a.rgb * mix(float3(0.92, 1.0, 0.82), float3(1.25, 1.08, 0.72), hue) * 0.95, n);
    float green = clamp((a.g - max(a.r, a.b)) * 40.0, 0.0, 1.0);
    sf.wrap = 0.45 * green; sf.trans = 0.55 * green; sf.ao = 0.85;
    float3 col = world_light(sf, in.world, in.lightClip, in.amb, f, k, dr, shadow, skyView, wshadow);
    return float4(world_air(col, in.airT, in.airIn, f), 1);
}

// --- Loose things (0223: cones, barriers, signs; a full pose each, they tip and roll) --------------------------------------
struct WLooseInst { float4x4 m; float4 tint; };
vertex WPropOut cg_world_loose_vertex(WPropIn in [[stage_in]], uint iid [[instance_id]], constant WFrame& f [[buffer(1)]],
                                      constant WLooseInst* inst [[buffer(3)]], constant WLook& k [[buffer(4)]], texture2d<float> skyView [[texture(8)]]) {
    WLooseInst I = inst[iid];
    float3 p = (I.m * float4(in.pos, 1)).xyz;
    WPropOut o; o.world = p; o.n = (I.m * float4(in.nrm, 0)).xyz; o.col = in.col * I.tint.rgb; o.glow = in.uv.x; o.seed = 0;
    o.clip = f.viewProj * float4(p, 1); o.lightClip = f.lightViewProj * float4(p, 1);
    WSky sk = world_vsky(p, normalize(o.n + 1e-6), f, k, skyView);
    o.amb = sk.amb; o.airT = sk.T; o.airIn = sk.In;
    return o;
}

// --- Skid marks (0223): rubber on the ground, blended over it, hazed with distance ----------------------------------------
struct WMarkIn { float4 pa [[attribute(0)]]; };
struct WMarkOut { float4 clip [[position]]; float3 world; float a; float3 airT; float3 airIn; };
vertex WMarkOut cg_world_mark_vertex(WMarkIn in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]], texture2d<float> skyView [[texture(8)]]) {
    WMarkOut o; o.world = in.pa.xyz; o.a = in.pa.w; o.clip = f.viewProj * float4(in.pa.xyz, 1);
    WSky sk = world_vsky(in.pa.xyz, float3(0, 1, 0), f, k, skyView);
    o.airT = sk.T; o.airIn = sk.In;
    return o;
}
fragment float4 cg_world_mark_fragment(WMarkOut in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]]) {
    // Rubber is near black and polished smooth by the slide: darker than asphalt, with the sky's faint sheen along it.
    float3 c = world_air(float3(0.004, 0.004, 0.005) + k.skyHorizon.rgb * 0.08, in.airT, in.airIn, f);
    float fade = 1.0 - smoothstep(120.0, 260.0, distance(in.world, f.eye.xyz));
    return float4(c, clamp(0.25 + in.a, 0.0, 1.0) * 0.8 * fade);
}
