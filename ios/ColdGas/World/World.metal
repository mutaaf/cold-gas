// Free Drive's world in Metal (docs/NATIVE-FREEDRIVE.md §4.3): the CDLOD terrain with its geomorph, the road ribbons and
// the instanced props, all drawn camera-relative (positions arrive as `piece − origin`, so a tile 40 km out is as precise
// as one at the centre). Lit like the stage (the key light and its shadow, the hemisphere, film.js's haze from
// Shaders.metal, recomputed here under world_ names: one namespace, no duplicate names), plus the car's headlamps.
#include <metal_stdlib>
using namespace metal;

// The stage's frame and look (Renderer.FrameU / LookU), field for field.
struct WFrame {
    float4x4 viewProj, lightViewProj;
    float4 eye, keyDir, keyColor, fogColor, fogRange;
    float4x4 invViewProj;
    float4 proj, misc;
};
struct WLook {
    float4 hemiSky, hemiGround, hazeCol, sunCol, sunDir, fogExp;
    float4 skyZenith, skyMid, skyHorizon, skySun, bloom;
};
// What the world adds a frame: the headlamps (position, direction, intensity) and the props' fade.
struct WDrive {
    float4 lampPos;      // xyz; w intensity (0 off)
    float4 lampDir;      // xyz; w cos of the cone's edge
    float4 params;       // x: props' far distance (m), y: time
    float4 anchor;       // xy: the floating origin mod 4,096 m (world-anchored detail)
};

// Value noise on a hashed lattice (world metres, anchored: render-space + anchor). Every scale divides 4,096, so the pattern
// is continuous when the origin moves (0226).
static float world_hash(float2 p) { p = fract(p * float2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
static float world_noise(float2 p) {
    float2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(world_hash(i), world_hash(i + float2(1, 0)), u.x), mix(world_hash(i + float2(0, 1)), world_hash(i + float2(1, 1)), u.x), u.y);
}

static float3 world_hazed(float3 c, float3 d, float L, float3 eye, constant WLook& k) {
    float a = k.hazeCol.w;
    if (a <= 0) return c;
    float b = k.sunCol.w, dens = a * exp(-b * eye.y), dy = d.y * b;
    float tau = abs(dy) > 1e-4 ? dens * (1.0 - exp(-clamp(dy * L, -12.0, 12.0))) / dy : dens * L;
    float fog = 1.0 - exp(-clamp(tau, 0.0, 12.0));
    float sun = pow(max(dot(d, k.sunDir.xyz), 0.0), 6.0);
    return mix(c, k.hazeCol.rgb + k.sunCol.rgb * sun, fog);
}
static float world_shadow(float4 lc, depth2d<float> sm, float texel) {
    float3 p = lc.xyz / max(lc.w, 1e-6);
    float2 uv = float2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    if (any(uv < 0.0) || any(uv > 1.0) || p.z > 1.0) return 1.0;
    constexpr sampler cmp(coord::normalized, filter::linear, compare_func::less_equal, address::clamp_to_edge);
    float s = 0;
    for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) s += sm.sample_compare(cmp, uv + (float2(x, y) - 0.5) * texel, p.z - 0.0015);
    return s * 0.25;
}
// Matte land: the key light (shadowed), the sky and ground hemisphere, the headlamps; then the air.
static float3 world_light(float3 albedo, float3 n, float3 p, float4 lightClip, float spec, constant WFrame& f, constant WLook& k,
                          constant WDrive& dr, depth2d<float> shadow) {
    float3 l = normalize(f.keyDir.xyz + 1e-6);
    float nl = clamp(dot(n, l), 0.0, 1.0);
    float sh = nl > 0 ? world_shadow(lightClip, shadow, f.fogRange.w) : 1.0;
    float3 c = albedo * f.keyColor.rgb * f.keyDir.w * nl * sh / M_PI_F;
    float3 hemi = mix(k.hemiGround.rgb, k.hemiSky.rgb, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
    c += albedo * hemi;
    float3 v = normalize(f.eye.xyz - p + 1e-6);
    if (spec > 0) {   // water and wet road: the sky's horizon, by Fresnel
        float fr = 0.02 + 0.98 * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.0);
        float3 r = reflect(-v, n);
        float3 sky = mix(k.skyHorizon.rgb, k.skyZenith.rgb, smoothstep(0.0, 0.5, r.y));
        c = mix(c, sky, fr * spec);
    }
    if (dr.lampPos.w > 0) {   // the headlamps: a soft cone, inverse-square, out to ≈ 140 m
        float3 d = dr.lampPos.xyz - p;
        float dist = max(length(d), 0.5);
        float3 ld = d / dist;
        // A wide, soft edge (squared) so the beam has no hard wedge on the verges, and a near-field floor so a bank
        // right at the nose isn't blown white.
        float cone = smoothstep(dr.lampDir.w - 0.05, dr.lampDir.w + 0.06, dot(-ld, dr.lampDir.xyz)); cone *= cone;
        float att = cone * dr.lampPos.w / (dist * dist + 25.0) * clamp(1.0 - pow(dist / 140.0, 4.0), 0.0, 1.0);
        c += albedo * clamp(dot(n, ld), 0.0, 1.0) * att * float3(1.0, 0.95, 0.86);
    }
    return c;
}
static float3 world_air(float3 c, float3 p, constant WFrame& f, constant WLook& k) {
    float3 toP = p - f.eye.xyz;
    float dist = max(length(toP), 1e-3);
    return world_hazed(max(c, 0.0), toP / dist, dist, f.eye.xyz, k);
}

// --- Terrain ----------------------------------------------------------------------------------------------------------
struct WTerrainIn { float4 pm [[attribute(0)]]; float3 n [[attribute(1)]]; float4 col [[attribute(2)]]; };
struct WTile { float4 offset; float4 morph; };   // offset: the tile's corner − origin; morph: start, 1 / span
struct WTerrainOut { float4 clip [[position]]; float3 world; float3 n; float4 col; float4 lightClip; float level; };

vertex WTerrainOut cg_world_terrain_vertex(WTerrainIn in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WTile& t [[buffer(2)]]) {
    float3 p = in.pm.xyz + t.offset.xyz;
    float d = length(p.xz - f.eye.xz);
    float m = clamp((d - t.morph.x) * t.morph.y, 0.0, 1.0);
    p.y = mix(in.pm.y, in.pm.w, m) + t.offset.y;
    WTerrainOut o;
    o.world = p; o.n = in.n; o.col = in.col; o.level = t.offset.w;
    o.clip = f.viewProj * float4(p, 1);
    o.lightClip = f.lightViewProj * float4(p, 1);
    return o;
}
fragment float4 cg_world_terrain_fragment(WTerrainOut in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]],
                                          constant WDrive& dr [[buffer(5)]], depth2d<float> shadow [[texture(3)]]) {
    if (dr.params.z > 0.5) {   // debug (`-fd-lod`): each level its own colour, with the stored albedo
        float3 lc[8] = { float3(1,0,0), float3(0,1,0), float3(0,0,1), float3(1,1,0), float3(0,1,1), float3(1,0,1), float3(1,1,1), float3(0.5,0.5,0.5) };
        return float4(lc[int(clamp(in.level, 0.0, 7.0))] * 0.05 + in.col.rgb * 0.3, 1);
    }
    float3 n = normalize(in.n + 1e-6);
    bool water = in.col.a > 0.5;
    float3 albedo = in.col.rgb;
    float dist = distance(in.world, f.eye.xyz);
    if (!water && dist < 900.0) {
        // The land's grain (0226): a 64 m and an 8 m octave of colour, and a 4 m bump in the normal, faded out with distance,
        // so a 4–16 m triangle doesn't read as a flat facet. Rock (steep) takes more of it than grass.
        float2 w = in.world.xz + dr.anchor.xy;
        float near = 1.0 - smoothstep(250.0, 900.0, dist), steep = clamp((1.0 - n.y) * 3.0, 0.0, 1.0);
        float macro = world_noise(w / 64.0), fine = world_noise(w / 8.0);
        albedo *= mix(1.0, 0.78 + 0.28 * macro + 0.16 * (fine - 0.5) * (1.0 + steep), near);
        float e = 0.35, b = world_noise(w / 4.0), bx = world_noise((w + float2(e, 0)) / 4.0), bz = world_noise((w + float2(0, e)) / 4.0);
        float amp = (0.35 + 0.9 * steep) * (1.0 - smoothstep(60.0, 300.0, dist));
        n = normalize(n + float3(-(bx - b), 0.0, -(bz - b)) * (amp / e * 4.0) * 0.25);
    }
    if (!water && dist >= 300.0) {
        // Far off (0226): a mountainside is drawn with 32–512 m triangles. A 48 m relief in the normal and a 128 / 512 m
        // tone break their flat planes into ridges and gullies, fading into the haze.
        float2 w = in.world.xz + dr.anchor.xy;
        float far = smoothstep(300.0, 700.0, dist) * (1.0 - smoothstep(5000.0, 9000.0, dist));
        float steep = clamp((1.0 - n.y) * 2.5, 0.0, 1.0);
        albedo *= mix(1.0, 0.8 + 0.25 * world_noise(w / 128.0) + 0.15 * world_noise(w / 512.0), far);
        float e = 4.0, b = world_noise(w / 48.0), bx = world_noise((w + float2(e, 0)) / 48.0), bz = world_noise((w + float2(0, e)) / 48.0);
        n = normalize(n + float3(-(bx - b), 0.0, -(bz - b)) / e * 48.0 * (0.15 + 0.35 * steep) * far);
    }
    if (water) {
        float t = dr.params.y;
        n = normalize(float3(sin(in.world.x * 0.21 + t * 0.6) * 0.03, 1.0, cos(in.world.z * 0.17 + t * 0.5) * 0.03));
    }
    float3 c = world_light(albedo, n, in.world, in.lightClip, water ? 0.85 : 0.0, f, k, dr, shadow);
    return float4(world_air(c, in.world, f, k), 1);
}

// --- Roads -------------------------------------------------------------------------------------------------------------
struct WRoadIn { float3 pos [[attribute(0)]]; float2 la [[attribute(1)]]; float3 n [[attribute(2)]]; float4 col [[attribute(3)]]; };
struct WRoadOut { float4 clip [[position]]; float3 world; float2 la; float3 n; float3 col; float4 lightClip; };
vertex WRoadOut cg_world_road_vertex(WRoadIn in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WTile& t [[buffer(2)]]) {
    float3 p = in.pos + t.offset.xyz;
    WRoadOut o; o.world = p; o.la = in.la; o.n = in.n; o.col = in.col.rgb;
    o.clip = f.viewProj * float4(p, 1); o.lightClip = f.lightViewProj * float4(p, 1);
    return o;
}
fragment float4 cg_world_road_fragment(WRoadOut in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]],
                                       constant WDrive& dr [[buffer(5)]], depth2d<float> shadow [[texture(3)]]) {
    float lat = in.la.x, along = in.la.y, al = abs(lat);
    const float hw = 3.5;
    float3 asphalt = float3(0.034, 0.035, 0.039), gravel = float3(0.19, 0.18, 0.16), paint = float3(0.62, 0.62, 0.6);
    float3 albedo = al > hw ? gravel : asphalt;
    // The verge (0226): the land's colour, from the shoulder's gravel out to the land (the shoulder's edge is 4.7 m).
    if (al > hw + 1.2) albedo = mix(gravel, in.col, smoothstep(hw + 1.2, hw + 2.4, al));
    // The markings (the web's endless road: EU): solid edge lines, a dashed centre line (3 m on, 9 m off). Antialiased by
    // their own screen-space width, faded out with distance where they'd shimmer.
    float w = max(fwidth(lat), 1e-3), wa = max(fwidth(along), 1e-3);
    float edge = smoothstep(0.12 + w, 0.12 - w, abs(al - (hw - 0.3)));
    float dash = smoothstep(0.075 + w, 0.075 - w, al) * smoothstep(0.25 + wa / 12.0, 0.25 - wa / 12.0, abs(fract(along / 12.0) - 0.125) * 2.0);
    float fade = 1.0 - smoothstep(300.0, 900.0, distance(in.world, f.eye.xyz));
    float mk = max(edge, dash) * fade;
    albedo = mix(albedo, paint, mk);
    float3 n = normalize(in.n + 1e-6);
    float3 c = world_light(albedo, n, in.world, in.lightClip, 0.0, f, k, dr, shadow);
    // Painted lines are retroreflective: the headlamps come back off them.
    if (dr.lampPos.w > 0 && mk > 0) {
        float3 d = dr.lampPos.xyz - in.world; float dist = max(length(d), 1.0);
        float cone = smoothstep(dr.lampDir.w - 0.05, dr.lampDir.w + 0.06, dot(-d / dist, dr.lampDir.xyz)); cone *= cone;
        c += paint * mk * cone * dr.lampPos.w * 0.02 / dist * (1.0 - smoothstep(60.0, 160.0, dist));
    }
    return float4(world_air(c, in.world, f, k), 1);
}

// --- Props (instanced; the stage's 44-byte vertex: pos, nrm, uv, col) -----------------------------------------------------
struct WPropIn { float3 pos [[attribute(0)]]; float3 nrm [[attribute(1)]]; float2 uv [[attribute(2)]]; float3 col [[attribute(3)]]; };
struct WInst { float4 posYaw; float4 scaleTint; };   // xyz relative to the block's corner, yaw; scale, tint
struct WPropOut { float4 clip [[position]]; float3 world; float3 n; float3 col; float glow; float4 lightClip; };
vertex WPropOut cg_world_prop_vertex(WPropIn in [[stage_in]], uint iid [[instance_id]], constant WFrame& f [[buffer(1)]], constant WTile& t [[buffer(2)]],
                                     constant WInst* inst [[buffer(3)]], constant WDrive& dr [[buffer(5)]]) {
    WInst I = inst[iid];
    float3 base = I.posYaw.xyz + t.offset.xyz;
    float d = length(base.xz - f.eye.xz);
    // Grown in from nothing over the last 15 % of the range (no pop), and gone past it.
    float far = dr.params.x;
    // (a negative scale: a roadside item broken loose, drawn by the loose view instead, 0227)
    float s = max(I.scaleTint.x, 0.0) * (1.0 - smoothstep(far * 0.85, far, d));
    // The near pool (0226): a block's draw leaves out what the pool draws (mode 1), the pool what's past its radius (2).
    if ((t.morph.x == 1.0 && d < dr.anchor.z) || (t.morph.x == 2.0 && d >= dr.anchor.z)) s = 0.0;
    float c = cos(I.posYaw.w), sn = sin(I.posYaw.w);
    float3 lp = in.pos * s;
    float3 p = float3(lp.x * c + lp.z * sn, lp.y, -lp.x * sn + lp.z * c) + base;
    float3 n = float3(in.nrm.x * c + in.nrm.z * sn, in.nrm.y, -in.nrm.x * sn + in.nrm.z * c);
    WPropOut o; o.world = p; o.n = n; o.col = in.col * I.scaleTint.y; o.glow = in.uv.x;
    o.clip = f.viewProj * float4(p, 1); o.lightClip = f.lightViewProj * float4(p, 1);
    return o;
}
fragment float4 cg_world_prop_fragment(WPropOut in [[stage_in]], bool front [[front_facing]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]],
                                       constant WDrive& dr [[buffer(5)]], depth2d<float> shadow [[texture(3)]]) {
    float3 n = normalize(in.n + 1e-6);
    if (!front) n = -n;
    float3 c = world_light(in.col, n, in.world, in.lightClip, 0.0, f, k, dr, shadow);
    if (in.glow > 0.5 && dr.lampPos.w > 0) {   // a delineator's reflector: it lights up in the headlamps, from far off
        float3 d = dr.lampPos.xyz - in.world; float dist = max(length(d), 1.0);
        float cone = smoothstep(dr.lampDir.w - 0.25, dr.lampDir.w, dot(-d / dist, dr.lampDir.xyz));
        c += float3(1.0, 0.72, 0.35) * cone * dr.lampPos.w * 0.5 / (dist * 2.0) * (1.0 - smoothstep(220.0, 400.0, dist));
    }
    return float4(world_air(c, in.world, f, k), 1);
}

// --- Loose things (0223: cones, barriers, signs; a full pose each, they tip and roll) --------------------------------------
struct WLooseInst { float4x4 m; float4 tint; };
vertex WPropOut cg_world_loose_vertex(WPropIn in [[stage_in]], uint iid [[instance_id]], constant WFrame& f [[buffer(1)]],
                                      constant WLooseInst* inst [[buffer(3)]]) {
    WLooseInst I = inst[iid];
    float3 p = (I.m * float4(in.pos, 1)).xyz;
    WPropOut o; o.world = p; o.n = (I.m * float4(in.nrm, 0)).xyz; o.col = in.col * I.tint.rgb; o.glow = in.uv.x;
    o.clip = f.viewProj * float4(p, 1); o.lightClip = f.lightViewProj * float4(p, 1);
    return o;
}

// --- Skid marks (0223): rubber on the ground, blended over it, hazed with distance ----------------------------------------
struct WMarkIn { float4 pa [[attribute(0)]]; };
struct WMarkOut { float4 clip [[position]]; float3 world; float a; };
vertex WMarkOut cg_world_mark_vertex(WMarkIn in [[stage_in]], constant WFrame& f [[buffer(1)]]) {
    WMarkOut o; o.world = in.pa.xyz; o.a = in.pa.w; o.clip = f.viewProj * float4(in.pa.xyz, 1);
    return o;
}
fragment float4 cg_world_mark_fragment(WMarkOut in [[stage_in]], constant WFrame& f [[buffer(1)]], constant WLook& k [[buffer(4)]]) {
    // Rubber is near black and polished smooth by the slide: darker than asphalt, and on the stage's black floor it reads
    // by the sky's faint sheen along it.
    float3 c = world_air(float3(0.004, 0.004, 0.005) + k.skyHorizon.rgb * 0.08, in.world, f, k);
    float fade = 1.0 - smoothstep(120.0, 260.0, distance(in.world, f.eye.xyz));
    return float4(c, clamp(0.25 + in.a, 0.0, 1.0) * 0.8 * fade);
}
