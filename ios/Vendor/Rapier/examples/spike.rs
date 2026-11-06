// scripts/engine-spike.js through the C API, number for number: JS doubles where the JS has doubles,
// rounded to f32 where a JS number crosses into the engine. Prints the same FNV-1a hash.
//   cargo run --release --example spike -- <verts-hex-file> [steps]
use coldgas_rapier::*;
use std::io::Read;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut s = String::new();
    std::fs::File::open(&args[1]).unwrap().read_to_string(&mut s).unwrap();
    let verts: Vec<f32> = s.split_whitespace().map(|h| f32::from_bits(u32::from_str_radix(h, 16).unwrap())).collect();
    let steps: usize = args.get(2).map(|x| x.parse().unwrap()).unwrap_or(2400);
    unsafe {
        let w = cg_world_new(0.0, -9.81f64 as f32, 0.0);
        cg_world_set_timestep(w, (1.0f64 / 240.0) as f32);
        let mut d = cg_collider_desc_default();
        d.translation = [0.0, -0.5, 0.0];
        d.friction = 0.9;
        let sh = cg_shape_cuboid(200.0, 0.5, 200.0);
        cg_collider_create(w, sh, &d, CG_NONE);
        cg_shape_free(sh);
        let n = 120usize;
        let mut idx: Vec<u32> = Vec::new();
        for i in 0..n { let k = (2 * i) as u32; idx.extend_from_slice(&[k, k + 2, k + 1, k + 1, k + 2, k + 3]); }
        let tm = cg_shape_trimesh(verts.as_ptr(), verts.len() / 3, idx.as_ptr(), idx.len(), 0x90 /* TS TriMeshFlags.FIX_INTERNAL_EDGES = 0x80 | MERGE_DUPLICATE_VERTICES */);
        let mut d = cg_collider_desc_default();
        d.friction = 1.0;
        cg_collider_create(w, tm, &d, CG_NONE);
        cg_shape_free(tm);
        let mut boxes = Vec::new();
        for i in 0..6 {
            let mut bd = cg_body_desc_default(0);
            let fi = i as f64;
            bd.translation = [((i % 2) as f64 * 0.3) as f32, (0.75 + 1.52 * (fi / 2.0).floor()) as f32, (12.0 + ((i % 3) as f64) * 0.1) as f32];
            let b = cg_body_create(w, &bd);
            let mut cd = cg_collider_desc_default();
            cd.density = (300.0 + 50.0 * fi) as f32;
            cd.friction = 0.6;
            cd.restitution = 0.1f64 as f32;
            let sh = cg_shape_cuboid(0.9, 0.75, 2.3);
            cg_collider_create(w, sh, &cd, b);
            cg_shape_free(sh);
            boxes.push(b);
        }
        let mut bd = cg_body_desc_default(0);
        bd.translation = [0.4, 1.0, -10.0];
        bd.can_sleep = false;
        let car = cg_body_create(w, &bd);
        let mut cd = cg_collider_desc_default();
        cd.mass_props_mode = 1;
        cd.mass = 2400.0;
        cd.friction = 0.5;
        let sh = cg_shape_cuboid(1.0, 0.35, 2.2);
        let car_col = cg_collider_create(w, sh, &cd, car);
        cg_shape_free(sh);
        let anchors: [[f64; 3]; 4] = [[-0.85, -0.2, 1.4], [0.85, -0.2, 1.4], [-0.85, -0.2, -1.4], [0.85, -0.2, -1.4]];
        let mut prev = [0.0f64; 4];
        let mut p = [0f32; 3];
        let mut q = [0f32; 4];
        let mut hit = CgRayHit { toi: 0.0, normal: [0.0; 3], collider: 0 };
        for t in 0..steps {
            cg_body_translation(w, car, p.as_mut_ptr());
            cg_body_rotation(w, car, q.as_mut_ptr());
            let (px, py, pz) = (p[0] as f64, p[1] as f64, p[2] as f64);
            let (qx, qy, qz, qw) = (q[0] as f64, q[1] as f64, q[2] as f64, q[3] as f64);
            for wh in 0..4 {
                let a = anchors[wh];
                let tx = 2.0 * (qy * a[2] - qz * a[1]);
                let ty = 2.0 * (qz * a[0] - qx * a[2]);
                let tz = 2.0 * (qx * a[1] - qy * a[0]);
                let wx = a[0] + qw * tx + (qy * tz - qz * ty);
                let wy = a[1] + qw * ty + (qz * tx - qx * tz);
                let wz = a[2] + qw * tz + (qx * ty - qy * tx);
                let (ox, oy, oz) = (px + wx, py + wy, pz + wz);
                if !cg_cast_ray_and_get_normal(w, ox as f32, oy as f32, oz as f32, 0.0, -1.0, 0.0, 0.8, true, 0, CG_NONE, car_col, CG_NONE, &mut hit) {
                    prev[wh] = 0.0;
                    continue;
                }
                let comp = 0.8 - hit.toi as f64;
                let f = (90000.0 * comp + 6000.0 * (comp - prev[wh]) * 240.0).max(0.0);
                prev[wh] = comp;
                let (nx, ny, nz) = (hit.normal[0] as f64, hit.normal[1] as f64, hit.normal[2] as f64);
                // The JS ray origin holds the doubles; the engine gets them as f32.
                let (rx, ry, rz) = ((ox as f32), (oy as f32), (oz as f32));
                cg_body_add_force_at_point(w, car, (nx * f) as f32, (ny * f) as f32, (nz * f) as f32, rx, ry, rz, true);
                let body = cg_collider_parent(w, hit.collider);
                if body != CG_NONE && body != car {
                    cg_body_add_force_at_point(w, body, (-nx * f) as f32, (-ny * f) as f32, (-nz * f) as f32, rx, ry, rz, true);
                }
            }
            let push: f64 = if t < 600 { 9000.0 } else if t < 900 { -4000.0 } else { 2500.0 };
            cg_body_add_force(w, car, ((t % 97) as f64 * 3.0) as f32, 0.0, push as f32, true);
            let ty: f64 = if t > 1200 && t < 1300 { 4000.0 } else { 0.0 };
            let tz: f64 = if t > 1500 && t < 1530 { 30000.0 } else { 0.0 };
            cg_body_add_torque(w, car, 0.0, ty as f32, tz as f32, true);
            cg_world_step(w);
            cg_body_reset_forces(w, car, true);
            cg_body_reset_torques(w, car, true);
            for &b in &boxes { cg_body_reset_forces(w, b, false); }
        }
        let mut h: u32 = 0x811c9dc5;
        let mut all = vec![car];
        all.extend(&boxes);
        let mut v = [0f32; 3];
        let mut av = [0f32; 3];
        for &b in &all {
            cg_body_translation(w, b, p.as_mut_ptr());
            cg_body_rotation(w, b, q.as_mut_ptr());
            cg_body_linvel(w, b, v.as_mut_ptr());
            cg_body_angvel(w, b, av.as_mut_ptr());
            for x in [p[0], p[1], p[2], q[0], q[1], q[2], q[3], v[0], v[1], v[2], av[0], av[1], av[2]] {
                h ^= x.to_bits();
                h = h.wrapping_mul(0x01000193);
            }
        }
        cg_body_translation(w, car, p.as_mut_ptr());
        println!("{:08x} car {:.4},{:.4},{:.4}", h, p[0], p[1], p[2]);
        cg_world_free(w);
    }
}
