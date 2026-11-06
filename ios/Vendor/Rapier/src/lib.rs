//! The native app's physics engine: Rapier 0.36.0 (the crate inside the web's
//! @dimforge/rapier3d-deterministic 0.21.0) behind a C API the Swift sim calls (docs/NATIVE.md §3).
//!
//! Every function mirrors what the TypeScript bindings do for the same call, defaults included
//! (bindings/typescript/src.ts and src/ at rapier v0.36.0): the descriptors below carry the TS
//! ColliderDesc / RigidBodyDesc defaults, a rigid body always gets `additional_mass_properties`
//! unless `mass_only`, rotations are taken with `from_xyzw` (no normalisation), handles pack
//! (index | generation << 32) like the bindings' FlatHandle bits. A JS number reaches the engine
//! as an f32 rounded to nearest; Swift's `Float(double)` rounds the same way.
#![allow(clippy::missing_safety_doc)]

mod libm_shim;
use rapier3d::prelude::*;
use std::slice;

pub struct CgWorld {
    gravity: Vector,
    params: IntegrationParameters,
    pipeline: PhysicsPipeline,
    islands: IslandManager,
    broad_phase: DefaultBroadPhase,
    narrow_phase: NarrowPhase,
    bodies: RigidBodySet,
    colliders: ColliderSet,
    soft_bodies: SoftBodySet,
    impulse_joints: ImpulseJointSet,
    multibody_joints: MultibodyJointSet,
    ccd: CCDSolver,
    /// Collision events of the last stepped-with-events tick, in the order the engine emitted them
    /// (what the bindings' ChannelEventCollector hands drainCollisionEvents).
    events: Vec<(u64, u64, bool)>,
}

/// Collects collision events in emission order (the JS EventQueue's channel, without the channel).
struct Collector<'a>(std::sync::Mutex<&'a mut Vec<(u64, u64, bool)>>);
impl<'a> EventHandler for Collector<'a> {
    fn handle_collision_event(&self, _b: &RigidBodySet, _c: &ColliderSet, event: CollisionEvent, _p: Option<&ContactPair>) {
        let e = match event {
            CollisionEvent::Started(a, b, _) => (flat(a.0), flat(b.0), true),
            CollisionEvent::Stopped(a, b, _) => (flat(a.0), flat(b.0), false),
        };
        self.0.lock().unwrap().push(e);
    }
    fn handle_contact_force_event(&self, _dt: f32, _b: &RigidBodySet, _c: &ColliderSet, _p: &ContactPair, _f: f32) {}
    fn handle_soft_body_tear_event(&self, _s: &SoftBodySet, _e: &SoftBodyTearEvent) {}
}

pub struct CgShape(SharedShape);

pub const CG_NONE: u64 = u64::MAX;

#[inline]
fn flat(i: rapier3d::data::Index) -> u64 {
    let (i, g) = i.into_raw_parts();
    i as u64 | ((g as u64) << 32)
}
#[inline]
fn body_h(h: u64) -> RigidBodyHandle { RigidBodyHandle::from_raw_parts(h as u32, (h >> 32) as u32) }
#[inline]
fn col_h(h: u64) -> ColliderHandle { ColliderHandle::from_raw_parts(h as u32, (h >> 32) as u32) }
#[inline]
fn v3(x: f32, y: f32, z: f32) -> Vector { Vector::new(x, y, z) }

// --- world -----------------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn cg_world_new(gx: f32, gy: f32, gz: f32) -> *mut CgWorld {
    Box::into_raw(Box::new(CgWorld {
        gravity: v3(gx, gy, gz),
        params: IntegrationParameters::default(),
        pipeline: PhysicsPipeline::new(),
        islands: IslandManager::new(),
        broad_phase: DefaultBroadPhase::new(),
        narrow_phase: NarrowPhase::new(),
        bodies: RigidBodySet::new(),
        colliders: ColliderSet::new(),
        soft_bodies: SoftBodySet::new(),
        impulse_joints: ImpulseJointSet::new(),
        multibody_joints: MultibodyJointSet::new(),
        ccd: CCDSolver::new(),
        events: Vec::with_capacity(64),
    }))
}
#[no_mangle]
pub unsafe extern "C" fn cg_world_free(w: *mut CgWorld) { if !w.is_null() { drop(Box::from_raw(w)); } }
#[no_mangle]
pub unsafe extern "C" fn cg_world_set_timestep(w: *mut CgWorld, dt: f32) { (*w).params.dt = dt; }
#[no_mangle]
pub unsafe extern "C" fn cg_world_step(w: *mut CgWorld) {
    let w = &mut *w;
    w.pipeline.step(
        w.gravity, &w.params, &mut w.islands, &mut w.broad_phase, &mut w.narrow_phase, &mut w.bodies,
        &mut w.colliders, &mut w.impulse_joints, &mut w.multibody_joints, &mut w.soft_bodies, &mut w.ccd, &(), &(),
    );
}

// --- shapes ----------------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn cg_shape_cuboid(hx: f32, hy: f32, hz: f32) -> *mut CgShape { Box::into_raw(Box::new(CgShape(SharedShape::cuboid(hx, hy, hz)))) }
#[no_mangle]
pub extern "C" fn cg_shape_ball(r: f32) -> *mut CgShape { Box::into_raw(Box::new(CgShape(SharedShape::ball(r)))) }
#[no_mangle]
pub extern "C" fn cg_shape_cylinder(half_height: f32, r: f32) -> *mut CgShape { Box::into_raw(Box::new(CgShape(SharedShape::cylinder(half_height, r)))) }
/// `verts`: n_verts × 3 floats; `idx`: n_idx u32 (a multiple of 3). Null when the mesh is invalid.
#[no_mangle]
pub unsafe extern "C" fn cg_shape_trimesh(verts: *const f32, n_verts: usize, idx: *const u32, n_idx: usize, flags: u32) -> *mut CgShape {
    let flags = TriMeshFlags::from_bits(flags as u16).unwrap_or_default();
    let v: Vec<Vector> = slice::from_raw_parts(verts, n_verts * 3).chunks(3).map(Vector::from_slice).collect();
    let i: Vec<[u32; 3]> = slice::from_raw_parts(idx, n_idx).chunks(3).map(|t| [t[0], t[1], t[2]]).collect();
    match SharedShape::trimesh_with_flags(v, i, flags) { Ok(s) => Box::into_raw(Box::new(CgShape(s))), Err(_) => std::ptr::null_mut() }
}
/// `points`: n × 3 floats. Null when the hull fails (as ColliderDesc.convexHull returns null).
#[no_mangle]
pub unsafe extern "C" fn cg_shape_convex_hull(points: *const f32, n: usize) -> *mut CgShape {
    let p: Vec<Vector> = slice::from_raw_parts(points, n * 3).chunks(3).map(Vector::from_slice).collect();
    match SharedShape::convex_hull(&p) { Some(s) => Box::into_raw(Box::new(CgShape(s))), None => std::ptr::null_mut() }
}
#[no_mangle]
pub unsafe extern "C" fn cg_shape_free(s: *mut CgShape) { if !s.is_null() { drop(Box::from_raw(s)); } }

// --- colliders -------------------------------------------------------------------------------

/// ColliderDesc as the TS bindings hold it. `cg_collider_desc_default` fills the TS defaults.
#[repr(C)]
pub struct CgColliderDesc {
    pub enabled: bool,
    pub translation: [f32; 3],
    pub rotation: [f32; 4],          // x, y, z, w
    pub mass_props_mode: u32,        // 0 Density, 1 Mass, 2 MassProps (TS MassPropsMode)
    pub mass: f32,
    pub center_of_mass: [f32; 3],
    pub principal_inertia: [f32; 3],
    pub inertia_frame: [f32; 4],
    pub density: f32,
    pub friction: f32,
    pub restitution: f32,
    pub friction_combine_rule: u32,  // 0 Average, 1 Min, 2 Multiply, 3 Max
    pub restitution_combine_rule: u32,
    pub is_sensor: bool,
    pub collision_groups: u32,
    pub solver_groups: u32,
    pub active_collision_types: u16,
    pub active_hooks: u32,
    pub active_events: u32,
    pub contact_force_event_threshold: f32,
    pub contact_skin: f32,
}
#[no_mangle]
pub extern "C" fn cg_collider_desc_default() -> CgColliderDesc {
    CgColliderDesc {
        enabled: true, translation: [0.0; 3], rotation: [0.0, 0.0, 0.0, 1.0], mass_props_mode: 0, mass: 0.0,
        center_of_mass: [0.0; 3], principal_inertia: [0.0; 3], inertia_frame: [0.0, 0.0, 0.0, 1.0], density: 1.0,
        friction: 0.5, restitution: 0.0, friction_combine_rule: 0, restitution_combine_rule: 0, is_sensor: false,
        collision_groups: 0xffff_ffff, solver_groups: 0xffff_ffff, active_collision_types: ActiveCollisionTypes::default().bits(),
        active_hooks: 0, active_events: 0, contact_force_event_threshold: 0.0, contact_skin: 0.0,
    }
}
fn combine(r: u32) -> CoefficientCombineRule {
    match r { 0 => CoefficientCombineRule::Average, 1 => CoefficientCombineRule::Min, 2 => CoefficientCombineRule::Multiply, _ => CoefficientCombineRule::Max }   // the bindings' combine_rule_from_u32
}
fn groups(g: u32) -> InteractionGroups {
    // The bindings' unpack_interaction_groups: membership in the high 16 bits, filter in the low 16.
    InteractionGroups::new(Group::from_bits_retain(g >> 16), Group::from_bits_retain(g & 0x0000_ffff), InteractionTestMode::And)
}
/// `parent`: a body handle, or CG_NONE for a fixed collider.
#[no_mangle]
pub unsafe extern "C" fn cg_collider_create(w: *mut CgWorld, shape: *const CgShape, d: *const CgColliderDesc, parent: u64) -> u64 {
    let w = &mut *w;
    let d = &*d;
    let pos = Pose::from_parts(Vector::from(d.translation), Rotation::from_xyzw(d.rotation[0], d.rotation[1], d.rotation[2], d.rotation[3]));
    let mut b = ColliderBuilder::new((*shape).0.clone())
        .enabled(d.enabled)
        .position(pos)
        .friction(d.friction)
        .restitution(d.restitution)
        .collision_groups(groups(d.collision_groups))
        .solver_groups(groups(d.solver_groups))
        .active_hooks(ActiveHooks::from_bits(d.active_hooks).unwrap_or(ActiveHooks::empty()))
        .active_events(ActiveEvents::from_bits(d.active_events).unwrap_or(ActiveEvents::empty()))
        .active_collision_types(ActiveCollisionTypes::from_bits(d.active_collision_types).unwrap_or(ActiveCollisionTypes::empty()))
        .sensor(d.is_sensor)
        .friction_combine_rule(combine(d.friction_combine_rule))
        .restitution_combine_rule(combine(d.restitution_combine_rule))
        .contact_force_event_threshold(d.contact_force_event_threshold)
        .contact_skin(d.contact_skin);
    b = match d.mass_props_mode {
        2 => b.mass_properties(MassProperties::with_principal_inertia_frame(
            Vector::from(d.center_of_mass), d.mass, Vector::from(d.principal_inertia),
            Rotation::from_xyzw(d.inertia_frame[0], d.inertia_frame[1], d.inertia_frame[2], d.inertia_frame[3]))),
        1 => b.mass(d.mass),
        _ => b.density(d.density),
    };
    let c = b.build();
    if parent == CG_NONE { flat(w.colliders.insert(c).0) } else { flat(w.colliders.insert_with_parent(c, body_h(parent), &mut w.bodies).0) }
}
/// The collider's parent body, or CG_NONE.
#[no_mangle]
pub unsafe extern "C" fn cg_collider_parent(w: *const CgWorld, c: u64) -> u64 {
    (*w).colliders.get(col_h(c)).and_then(|c| c.parent()).map(|h| flat(h.0)).unwrap_or(CG_NONE)
}

// --- rigid bodies ----------------------------------------------------------------------------

/// RigidBodyDesc as the TS bindings hold it. `cg_body_desc_default` fills the TS defaults.
#[repr(C)]
pub struct CgBodyDesc {
    pub body_type: u32,              // 0 Dynamic, 1 Fixed, 2 KinematicPositionBased, 3 KinematicVelocityBased (TS RigidBodyType)
    pub enabled: bool,
    pub translation: [f32; 3],
    pub rotation: [f32; 4],
    pub gravity_scale: f32,
    pub mass: f32,
    pub mass_only: bool,
    pub center_of_mass: [f32; 3],
    pub linvel: [f32; 3],
    pub angvel: [f32; 3],
    pub principal_inertia: [f32; 3],
    pub inertia_frame: [f32; 4],
    pub translations_enabled: [bool; 3],
    pub rotations_enabled: [bool; 3],
    pub linear_damping: f32,
    pub angular_damping: f32,
    pub can_sleep: bool,
    pub sleeping: bool,
    pub soft_ccd_prediction: f32,
    pub ccd_enabled: bool,
    pub dominance_group: i8,
    pub additional_solver_iterations: u32,
    pub additional_pgs_iterations: u32,
}
#[no_mangle]
pub extern "C" fn cg_body_desc_default(body_type: u32) -> CgBodyDesc {
    CgBodyDesc {
        body_type, enabled: true, translation: [0.0; 3], rotation: [0.0, 0.0, 0.0, 1.0], gravity_scale: 1.0, mass: 0.0,
        mass_only: false, center_of_mass: [0.0; 3], linvel: [0.0; 3], angvel: [0.0; 3], principal_inertia: [0.0; 3],
        inertia_frame: [0.0, 0.0, 0.0, 1.0], translations_enabled: [true; 3], rotations_enabled: [true; 3],
        linear_damping: 0.0, angular_damping: 0.0, can_sleep: true, sleeping: false, soft_ccd_prediction: 0.0,
        ccd_enabled: false, dominance_group: 0, additional_solver_iterations: 0, additional_pgs_iterations: 0,
    }
}
#[no_mangle]
pub unsafe extern "C" fn cg_body_create(w: *mut CgWorld, d: *const CgBodyDesc) -> u64 {
    let w = &mut *w;
    let d = &*d;
    // The TS RigidBodyType enum order: Dynamic, Fixed, KinematicPositionBased, KinematicVelocityBased.
    let t = match d.body_type { 1 => RigidBodyType::Fixed, 2 => RigidBodyType::KinematicPositionBased, 3 => RigidBodyType::KinematicVelocityBased, _ => RigidBodyType::Dynamic };
    let pos = Pose::from_parts(Vector::from(d.translation), Rotation::from_xyzw(d.rotation[0], d.rotation[1], d.rotation[2], d.rotation[3]));
    let mut b = RigidBodyBuilder::new(t)
        .enabled(d.enabled)
        .pose(pos)
        .gravity_scale(d.gravity_scale)
        .enabled_translations(d.translations_enabled[0], d.translations_enabled[1], d.translations_enabled[2])
        .enabled_rotations(d.rotations_enabled[0], d.rotations_enabled[1], d.rotations_enabled[2])
        .linvel(Vector::from(d.linvel))
        .angvel(Vector::from(d.angvel))
        .linear_damping(d.linear_damping)
        .angular_damping(d.angular_damping)
        .can_sleep(d.can_sleep)
        .sleeping(d.sleeping)
        .ccd_enabled(d.ccd_enabled)
        .dominance_group(d.dominance_group)
        .additional_solver_iterations(d.additional_solver_iterations as usize)
        .additional_pgs_iterations(d.additional_pgs_iterations as usize)
        .soft_ccd_prediction(d.soft_ccd_prediction);
    b = if d.mass_only {
        b.additional_mass(d.mass)
    } else {
        b.additional_mass_properties(MassProperties::with_principal_inertia_frame(
            Vector::from(d.center_of_mass), d.mass, Vector::from(d.principal_inertia),
            Rotation::from_xyzw(d.inertia_frame[0], d.inertia_frame[1], d.inertia_frame[2], d.inertia_frame[3])))
    };
    flat(w.bodies.insert(b.build()).0)
}
macro_rules! with_body {
    ($w:expr, $h:expr, |$rb:ident| $body:expr) => {
        if let Some($rb) = (*$w).bodies.get_mut(body_h($h)) { $body }
    };
}
/// out: [x, y, z]
#[no_mangle]
pub unsafe extern "C" fn cg_body_translation(w: *const CgWorld, h: u64, out: *mut f32) {
    if let Some(rb) = (*w).bodies.get(body_h(h)) { let t = rb.translation(); *out = t.x; *out.add(1) = t.y; *out.add(2) = t.z; }
}
/// out: [x, y, z, w]
#[no_mangle]
pub unsafe extern "C" fn cg_body_rotation(w: *const CgWorld, h: u64, out: *mut f32) {
    if let Some(rb) = (*w).bodies.get(body_h(h)) { let q = rb.rotation(); *out = q.x; *out.add(1) = q.y; *out.add(2) = q.z; *out.add(3) = q.w; }
}
#[no_mangle]
pub unsafe extern "C" fn cg_body_linvel(w: *const CgWorld, h: u64, out: *mut f32) {
    if let Some(rb) = (*w).bodies.get(body_h(h)) { let v = rb.linvel(); *out = v.x; *out.add(1) = v.y; *out.add(2) = v.z; }
}
#[no_mangle]
pub unsafe extern "C" fn cg_body_angvel(w: *const CgWorld, h: u64, out: *mut f32) {
    if let Some(rb) = (*w).bodies.get(body_h(h)) { let v = rb.angvel(); *out = v.x; *out.add(1) = v.y; *out.add(2) = v.z; }
}
#[no_mangle]
pub unsafe extern "C" fn cg_body_add_force(w: *mut CgWorld, h: u64, x: f32, y: f32, z: f32, wake: bool) { with_body!(w, h, |rb| rb.add_force(v3(x, y, z), wake)); }
#[no_mangle]
pub unsafe extern "C" fn cg_body_add_torque(w: *mut CgWorld, h: u64, x: f32, y: f32, z: f32, wake: bool) { with_body!(w, h, |rb| rb.add_torque(v3(x, y, z), wake)); }
#[no_mangle]
pub unsafe extern "C" fn cg_body_add_force_at_point(w: *mut CgWorld, h: u64, fx: f32, fy: f32, fz: f32, px: f32, py: f32, pz: f32, wake: bool) {
    with_body!(w, h, |rb| rb.add_force_at_point(v3(fx, fy, fz), v3(px, py, pz).into(), wake));
}
#[no_mangle]
pub unsafe extern "C" fn cg_body_reset_forces(w: *mut CgWorld, h: u64, wake: bool) { with_body!(w, h, |rb| rb.reset_forces(wake)); }
#[no_mangle]
pub unsafe extern "C" fn cg_body_reset_torques(w: *mut CgWorld, h: u64, wake: bool) { with_body!(w, h, |rb| rb.reset_torques(wake)); }

// --- queries ---------------------------------------------------------------------------------

/// A ray hit: time of impact along `dir` (units of |dir|), the normal, the collider.
#[repr(C)]
pub struct CgRayHit {
    pub toi: f32,
    pub normal: [f32; 3],
    pub collider: u64,
}
/// world.castRayAndGetNormal(ray, maxToi, solid, flags, groups, excludeCollider, excludeRigidBody), no predicate.
/// `groups`, `exclude_collider`, `exclude_body`: CG_NONE when absent. Returns false on no hit.
#[no_mangle]
pub unsafe extern "C" fn cg_cast_ray_and_get_normal(
    w: *const CgWorld, ox: f32, oy: f32, oz: f32, dx: f32, dy: f32, dz: f32, max_toi: f32, solid: bool,
    filter_flags: u32, groups_bits: u64, exclude_collider: u64, exclude_body: u64, out: *mut CgRayHit,
) -> bool {
    let w = &*w;
    let filter = QueryFilter {
        flags: QueryFilterFlags::from_bits(filter_flags).unwrap_or(QueryFilterFlags::empty()),
        groups: if groups_bits == CG_NONE { None } else { Some(groups(groups_bits as u32)) },
        exclude_collider: if exclude_collider == CG_NONE { None } else { Some(col_h(exclude_collider)) },
        exclude_rigid_body: if exclude_body == CG_NONE { None } else { Some(body_h(exclude_body)) },
        predicate: None,
    };
    let qp = w.broad_phase.as_query_pipeline(w.narrow_phase.query_dispatcher(), &w.bodies, &w.colliders, filter);
    let ray = Ray::new(v3(ox, oy, oz), v3(dx, dy, dz));
    match qp.cast_ray_and_get_normal(&ray, max_toi, solid) {
        Some((h, inter)) => {
            let o = &mut *out;
            o.toi = inter.time_of_impact;
            o.normal = [inter.normal.x, inter.normal.y, inter.normal.z];
            o.collider = flat(h.0);
            true
        }
        None => false,
    }
}

// --- more of the TS surface the sim uses (world.js, vehicle.js) --------------------------------------

/// world.step(eventQueue) with an auto-draining queue: clears the last tick's events, steps, records new ones.
#[no_mangle]
pub unsafe extern "C" fn cg_world_step_events(w: *mut CgWorld) {
    let w = &mut *w;
    w.events.clear();
    let mut ev = std::mem::take(&mut w.events);
    {
        let c = Collector(std::sync::Mutex::new(&mut ev));
        w.pipeline.step(
            w.gravity, &w.params, &mut w.islands, &mut w.broad_phase, &mut w.narrow_phase, &mut w.bodies,
            &mut w.colliders, &mut w.impulse_joints, &mut w.multibody_joints, &mut w.soft_bodies, &mut w.ccd, &(), &c,
        );
    }
    w.events = ev;
}
/// The events of the last cg_world_step_events: up to `cap` (h1, h2, started) triples. Returns how many there were.
#[no_mangle]
pub unsafe extern "C" fn cg_world_collision_events(w: *const CgWorld, h1: *mut u64, h2: *mut u64, started: *mut bool, cap: usize) -> usize {
    let w = &*w;
    for (i, e) in w.events.iter().enumerate().take(cap) { *h1.add(i) = e.0; *h2.add(i) = e.1; *started.add(i) = e.2; }
    w.events.len()
}
#[no_mangle]
pub unsafe extern "C" fn cg_world_remove_collider(w: *mut CgWorld, c: u64, wake: bool) {
    let w = &mut *w;
    w.colliders.remove(col_h(c), &mut w.islands, &mut w.bodies, &mut w.soft_bodies, wake);
}
#[no_mangle]
pub unsafe extern "C" fn cg_collider_set_collision_groups(w: *mut CgWorld, c: u64, g: u32) {
    if let Some(col) = (*w).colliders.get_mut(col_h(c)) { col.set_collision_groups(groups(g)); }
}
#[no_mangle]
pub unsafe extern "C" fn cg_body_is_sleeping(w: *const CgWorld, h: u64) -> bool { (*w).bodies.get(body_h(h)).map(|b| b.is_sleeping()).unwrap_or(true) }
#[no_mangle]
pub unsafe extern "C" fn cg_body_velocity_at_point(w: *const CgWorld, h: u64, px: f32, py: f32, pz: f32, out: *mut f32) {
    if let Some(rb) = (*w).bodies.get(body_h(h)) { let u = rb.velocity_at_point(v3(px, py, pz)); *out = u.x; *out.add(1) = u.y; *out.add(2) = u.z; }
}
#[no_mangle]
pub unsafe extern "C" fn cg_body_apply_impulse_at_point(w: *mut CgWorld, h: u64, ix: f32, iy: f32, iz: f32, px: f32, py: f32, pz: f32, wake: bool) {
    with_body!(w, h, |rb| rb.apply_impulse_at_point(v3(ix, iy, iz), v3(px, py, pz).into(), wake));
}
/// rb.setAdditionalMassProperties(mass, com, principalInertia, frame, wake)
#[no_mangle]
pub unsafe extern "C" fn cg_body_set_additional_mass_properties(w: *mut CgWorld, h: u64, mass: f32, cx: f32, cy: f32, cz: f32,
    ix: f32, iy: f32, iz: f32, fx: f32, fy: f32, fz: f32, fw: f32, wake: bool) {
    with_body!(w, h, |rb| rb.set_additional_mass_properties(
        MassProperties::with_principal_inertia_frame(v3(cx, cy, cz).into(), mass, v3(ix, iy, iz), Rotation::from_xyzw(fx, fy, fz, fw)), wake));
}
#[no_mangle]
pub unsafe extern "C" fn cg_body_set_translation(w: *mut CgWorld, h: u64, x: f32, y: f32, z: f32, wake: bool) { with_body!(w, h, |rb| rb.set_translation(v3(x, y, z), wake)); }
#[no_mangle]
/// As the bindings' rbSetRotation: a zero quaternion is ignored, any other is normalised first.
pub unsafe extern "C" fn cg_body_set_rotation(w: *mut CgWorld, h: u64, x: f32, y: f32, z: f32, qw: f32, wake: bool) {
    let q = Rotation::from_xyzw(x, y, z, qw);
    if q.length_squared() > 0.0 { let q = q.normalize(); with_body!(w, h, |rb| rb.set_rotation(q, wake)); }
}
#[no_mangle]
pub unsafe extern "C" fn cg_body_set_linvel(w: *mut CgWorld, h: u64, x: f32, y: f32, z: f32, wake: bool) { with_body!(w, h, |rb| rb.set_linvel(v3(x, y, z), wake)); }
#[no_mangle]
pub unsafe extern "C" fn cg_body_set_angvel(w: *mut CgWorld, h: u64, x: f32, y: f32, z: f32, wake: bool) { with_body!(w, h, |rb| rb.set_angvel(v3(x, y, z), wake)); }

// Contacts: world.contactPairsWith(collider, f) and world.contactPair(c1, c2, f(manifold, flipped)).
/// The colliders in a contact pair with `c` (the bindings' order). Writes up to `cap`; returns how many.
#[no_mangle]
pub unsafe extern "C" fn cg_contact_pairs_with(w: *const CgWorld, c: u64, out: *mut u64, cap: usize) -> usize {
    let w = &*w;
    let h1 = col_h(c);
    let mut n = 0;
    for pair in w.narrow_phase.contact_pairs_with(h1) {
        let other = if pair.collider1 == h1 { pair.collider2 } else { pair.collider1 };
        if n < cap { *out.add(n) = flat(other.0); }
        n += 1;
    }
    n
}
/// The pair (c1, c2)'s manifold count, or -1 when there is no pair; `flipped`: the pair's collider1 isn't c1.
#[no_mangle]
pub unsafe extern "C" fn cg_contact_pair(w: *const CgWorld, c1: u64, c2: u64, flipped: *mut bool) -> i32 {
    match (*w).narrow_phase.contact_pair(col_h(c1), col_h(c2)) {
        Some(p) => { *flipped = p.collider1 != col_h(c1); p.manifolds().len() as i32 }
        None => -1,
    }
}
/// Manifold m of the pair: its normal (`data.normal`, as manifold.normal()) and its contact count.
#[no_mangle]
pub unsafe extern "C" fn cg_manifold(w: *const CgWorld, c1: u64, c2: u64, m: usize, normal: *mut f32) -> i32 {
    match (*w).narrow_phase.contact_pair(col_h(c1), col_h(c2)).and_then(|p| p.manifolds().get(m)) {
        Some(mf) => { let u = mf.data.normal; *normal = u.x; *normal.add(1) = u.y; *normal.add(2) = u.z; mf.points.len() as i32 }
        None => -1,
    }
}
/// Contact k of manifold m: impulse, dist, local_p1, local_p2 (as contactImpulse / contactDist / localContactPoint1/2).
#[repr(C)]
pub struct CgContact { pub impulse: f32, pub dist: f32, pub p1: [f32; 3], pub p2: [f32; 3] }
#[no_mangle]
pub unsafe extern "C" fn cg_manifold_contact(w: *const CgWorld, c1: u64, c2: u64, m: usize, k: usize, out: *mut CgContact) -> bool {
    match (*w).narrow_phase.contact_pair(col_h(c1), col_h(c2)).and_then(|p| p.manifolds().get(m)).and_then(|mf| mf.points.get(k)) {
        Some(c) => {
            let o = &mut *out;
            o.impulse = c.data.impulse; o.dist = c.dist;
            o.p1 = [c.local_p1.x, c.local_p1.y, c.local_p1.z]; o.p2 = [c.local_p2.x, c.local_p2.y, c.local_p2.z];
            true
        }
        None => false,
    }
}
