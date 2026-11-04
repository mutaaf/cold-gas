// C API of ios/Vendor/Rapier (src/lib.rs): Rapier 0.36.0, the engine inside the web's
// @dimforge/rapier3d-deterministic 0.21.0, for the Swift sim (docs/NATIVE.md §3). Keep in step with lib.rs.
#ifndef COLDGAS_RAPIER_H
#define COLDGAS_RAPIER_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define CG_NONE UINT64_MAX

typedef struct CgWorld CgWorld;
typedef struct CgShape CgShape;

typedef struct {
  bool enabled;
  float translation[3];
  float rotation[4];
  uint32_t mass_props_mode;   // 0 Density, 1 Mass, 2 MassProps
  float mass;
  float center_of_mass[3];
  float principal_inertia[3];
  float inertia_frame[4];
  float density, friction, restitution;
  uint32_t friction_combine_rule, restitution_combine_rule;   // 0 Average, 1 Min, 2 Multiply, 3 Max
  bool is_sensor;
  uint32_t collision_groups, solver_groups;
  uint16_t active_collision_types;
  uint32_t active_hooks, active_events;
  float contact_force_event_threshold, contact_skin;
} CgColliderDesc;

typedef struct {
  uint32_t body_type;         // 0 Dynamic, 1 Fixed, 2 KinematicPositionBased, 3 KinematicVelocityBased
  bool enabled;
  float translation[3];
  float rotation[4];
  float gravity_scale, mass;
  bool mass_only;
  float center_of_mass[3], linvel[3], angvel[3], principal_inertia[3];
  float inertia_frame[4];
  bool translations_enabled[3], rotations_enabled[3];
  float linear_damping, angular_damping;
  bool can_sleep, sleeping;
  float soft_ccd_prediction;
  bool ccd_enabled;
  int8_t dominance_group;
  uint32_t additional_solver_iterations, additional_pgs_iterations;
} CgBodyDesc;

typedef struct { float toi; float normal[3]; uint64_t collider; } CgRayHit;

CgWorld *cg_world_new(float gx, float gy, float gz);
void cg_world_free(CgWorld *w);
void cg_world_set_timestep(CgWorld *w, float dt);
void cg_world_step(CgWorld *w);

CgShape *cg_shape_cuboid(float hx, float hy, float hz);
CgShape *cg_shape_ball(float r);
CgShape *cg_shape_cylinder(float half_height, float r);
CgShape *cg_shape_trimesh(const float *verts, size_t n_verts, const uint32_t *idx, size_t n_idx, uint32_t flags);
CgShape *cg_shape_convex_hull(const float *points, size_t n);
void cg_shape_free(CgShape *s);

CgColliderDesc cg_collider_desc_default(void);
uint64_t cg_collider_create(CgWorld *w, const CgShape *shape, const CgColliderDesc *d, uint64_t parent);
uint64_t cg_collider_parent(const CgWorld *w, uint64_t collider);

CgBodyDesc cg_body_desc_default(uint32_t body_type);
uint64_t cg_body_create(CgWorld *w, const CgBodyDesc *d);
void cg_body_translation(const CgWorld *w, uint64_t h, float *out3);
void cg_body_rotation(const CgWorld *w, uint64_t h, float *out4);
void cg_body_linvel(const CgWorld *w, uint64_t h, float *out3);
void cg_body_angvel(const CgWorld *w, uint64_t h, float *out3);
void cg_body_add_force(CgWorld *w, uint64_t h, float x, float y, float z, bool wake);
void cg_body_add_torque(CgWorld *w, uint64_t h, float x, float y, float z, bool wake);
void cg_body_add_force_at_point(CgWorld *w, uint64_t h, float fx, float fy, float fz, float px, float py, float pz, bool wake);
void cg_body_reset_forces(CgWorld *w, uint64_t h, bool wake);
void cg_body_reset_torques(CgWorld *w, uint64_t h, bool wake);

bool cg_cast_ray_and_get_normal(const CgWorld *w, float ox, float oy, float oz, float dx, float dy, float dz, float max_toi,
                                bool solid, uint32_t filter_flags, uint64_t groups, uint64_t exclude_collider,
                                uint64_t exclude_body, CgRayHit *out);
#endif
