// What placed objects look like (src/sim/objects.js is what they are). Kept plain on purpose: a
// build mode can restyle them; the shapes match the colliders exactly, because they're built from
// the same numbers. Ramps and blocks are poured concrete with a painted chevron, a loop is a
// concrete band, a boost pad glows, a power-up is a slowly turning prism.
import * as THREE from 'three';
import { patch } from '../render/roadlook.js';

export function createObjectView(objects, parent, U) {
  const group = new THREE.Group();
  group.name = 'objects';
  parent.add(group);
  const concrete = patch(new THREE.MeshStandardMaterial({ color: 0xc9c7c1, roughness: 0.86, metalness: 0 }), U, {});
  concrete.name = 'obj-concrete';
  const paint = patch(new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), U, {});
  paint.name = 'obj-paint';
  const glow = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.85, depthWrite: false });
  const prism = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd27a, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.1 });
  const meshes = new Map(), spinning = [];

  function build(o) {
    const g = new THREE.Group();
    g.position.set(o.x, o.y, o.z);
    g.rotation.y = o.yaw;
    if (o.type === 'box') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.l).translate(0, o.h / 2, 0), concrete);
      m.castShadow = true; m.receiveShadow = true; g.add(m);
    } else if (o.type === 'ramp') {
      // A wedge rising along +z: a triangular prism.
      const s = new THREE.Shape();
      s.moveTo(-o.l / 2, 0); s.lineTo(o.l / 2, 0); s.lineTo(o.l / 2, o.h); s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: o.w, bevelEnabled: false });
      geo.rotateY(-Math.PI / 2); geo.translate(o.w / 2, 0, 0);
      const m = new THREE.Mesh(geo, concrete);
      m.castShadow = true; m.receiveShadow = true; g.add(m);
      // Chevrons up the face.
      const k = Math.hypot(o.l, o.h), a = Math.atan2(o.h, o.l);
      for (let c = 0; c < 3; c++) {
        const ch = new THREE.Mesh(new THREE.PlaneGeometry(o.w * 0.5, 0.35), paint);
        const t = (c + 1) / 4;
        ch.position.set(0, o.h * t + 0.01, -o.l / 2 + o.l * t);
        ch.rotation.set(-Math.PI / 2 - a, 0, 0);
        g.add(ch);
      }
      void k;
    } else if (o.type === 'loop') {
      // The band: one turn of a helix of radius r, drifting `shift` m in x, the shell t thick.
      const seg = 96, pts = [], idx = [];
      for (let k = 0; k <= seg; k++) {
        const th = (k / seg) * Math.PI * 2, xc = (o.shift * k) / seg;
        const cy = o.r - Math.cos(th) * o.r, cz = Math.sin(th) * o.r, oy = -Math.cos(th), oz = Math.sin(th);
        // Inner face (riding surface) and outer face, each across the band's width.
        for (const [rr, side] of [[0, 0], [o.t, 1]]) for (const dx of [-o.w / 2, o.w / 2]) {
          pts.push(xc + dx, cy + oy * rr, cz + oz * rr);
          void side;
        }
      }
      for (let k = 0; k < seg; k++) {
        const a = k * 4, b = a + 4;
        idx.push(a, b, a + 1, a + 1, b, b + 1);                   // inner
        idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);       // outer
        idx.push(a, a + 2, b, b, a + 2, b + 2);                   // one edge
        idx.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);       // the other
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, concrete.clone());
      m.material.side = THREE.DoubleSide;
      m.castShadow = true; m.receiveShadow = true; g.add(m);
    } else if (o.type === 'boost') {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.l).rotateX(-Math.PI / 2).translate(0, 0.03, 0), glow);
      g.add(m);
      for (let c = 0; c < 3; c++) {
        const ch = new THREE.Mesh(new THREE.PlaneGeometry(o.w * 0.6, 0.22).rotateX(-Math.PI / 2), paint);
        ch.position.set(0, 0.05, -o.l / 2 + (o.l * (c + 1)) / 4);
        g.add(ch);
      }
    } else if (o.type === 'powerup') {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(o.r * 0.45), prism);
      m.position.y = 1.2;
      g.add(m); spinning.push(m);
    }
    g.traverse((c) => { c.userData.objectId = o.id; });
    return g;
  }

  function onChange(kind, o) {
    if (kind === 'add') { const g = build(o); meshes.set(o.id, g); group.add(g); }
    else if (kind === 'remove') {
      const g = meshes.get(o.id);
      if (!g) return;
      group.remove(g);
      g.traverse((c) => { if (c.geometry) c.geometry.dispose(); if (c.material && c.material !== concrete && c.material !== paint && c.material !== glow && c.material !== prism) c.material.dispose(); });
      const sp = new Set(); g.traverse((c) => sp.add(c));
      for (let k = spinning.length - 1; k >= 0; k--) if (sp.has(spinning[k])) spinning.splice(k, 1);
      meshes.delete(o.id);
    }
  }
  for (const o of objects.all()) onChange('add', o);
  const off = objects.onChange(onChange);

  return {
    group,
    update(time) { for (const m of spinning) { m.rotation.y = time * 1.2; m.position.y = 1.2 + Math.sin(time * 2) * 0.12; } },
    dispose() {
      off();
      for (const id of [...meshes.keys()]) onChange('remove', { id });
      parent.remove(group);
      concrete.dispose(); paint.dispose(); glow.dispose(); prism.dispose();
    },
  };
}
