// BUILD: drawing the pieces, rings, pads and power-ups. One InstancedMesh per (kind, material),
// rebuilt only when the build changes (never per frame); only the pickups' bob and spin and the
// boost pads' pulse move per frame, through a reused dummy. Solid geometry comes from the same
// numbers as the colliders (src/build/colliders.js shapeMesh), so the drawn curve is the driven one.
import * as THREE from 'three';
import { PIECES, BUILD_MATERIALS, POWERUPS, SKIRT } from './catalogue.js';
import { shapeMesh } from './colliders.js';
import { DECAL } from '../render/sliver.js';

const ICE = 0xbfe6ff, SIGNAL = 0xd7262e;

// A parked car inside its collider box (w × h × d): body, glasshouse, four wheels; vertex colours
// (paint white, so the instance colour is the paint; glass and tyres dark).
function parkedCarGeo({ w, h, d }) {
  const parts = [];
  const add = (geo, rgb) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) { c[i] = rgb[0]; c[i + 1] = rgb[1]; c[i + 2] = rgb[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  const body = new THREE.BoxGeometry(w, h * 0.5, d); body.translate(0, h * 0.2 + h * 0.25, 0); add(body, [1, 1, 1]);
  const cab = new THREE.BoxGeometry(w * 0.86, h * 0.36, d * 0.5); cab.translate(0, h * 0.7 + h * 0.18 - 0.01, -d * 0.04); add(cab, [0.08, 0.09, 0.11]);
  const roof = new THREE.BoxGeometry(w * 0.8, 0.04, d * 0.42); roof.translate(0, h - 0.02, -d * 0.04); add(roof, [1, 1, 1]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wh = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16); wh.rotateZ(Math.PI / 2); wh.translate(sx * (w / 2 - 0.1), 0.34, sz * d * 0.32); add(wh, [0.05, 0.05, 0.05]);
  }
  const n = parts.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); col.set(g.attributes.color.array, o); o += g.attributes.position.array.length; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createBuildRender(parent, { tier = 'high' } = {}) {
  const group = new THREE.Group();
  group.name = 'build';
  parent.add(group);
  const shadows = tier !== 'low';

  // --- Materials ---------------------------------------------------------------------------------
  const mats = {
    concrete: new THREE.MeshStandardMaterial({ color: BUILD_MATERIALS.concrete.color, roughness: 0.86, metalness: 0 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xaab2bb, roughness: 0.42, metalness: 0.6 }),
    wood: new THREE.MeshStandardMaterial({ color: BUILD_MATERIALS.wood.color, roughness: 0.72, metalness: 0 }),
    rubber: new THREE.MeshStandardMaterial({ color: BUILD_MATERIALS.rubber.color, roughness: 0.96, metalness: 0 }),
  };
  // Wood reads as planks: faint stripes across the run, from the local position.
  mats.wood.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLp = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLp;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat pl = abs(fract(vLp.z * 3.3) - 0.5); diffuseColor.rgb *= 1.0 - 0.2 * smoothstep(0.44, 0.5, pl) + 0.035 * sin(vLp.z * 17.0 + vLp.x * 0.7);');
  };
  const lipMat = new THREE.MeshBasicMaterial({ color: ICE, toneMapped: false });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const pickMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.1 });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0xb08350, roughness: 0.7 });
  const carMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.38, metalness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const boostTex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#1b1d21'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ff4a43'; g.lineWidth = 14; g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < 3; i++) { const y = 70 + i * 62; g.beginPath(); g.moveTo(22, y + 30); g.lineTo(64, y - 4); g.lineTo(106, y + 30); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3; g.strokeRect(5, 5, w - 10, h - 10);
  });
  const boostMat = new THREE.MeshBasicMaterial({ map: boostTex, toneMapped: false, ...DECAL });
  const padTex = canvasTex(256, 256, (g, w) => {
    g.clearRect(0, 0, w, w);
    g.strokeStyle = 'rgba(245,246,248,0.85)';
    for (const [r, lw] of [[0.42, 3], [0.27, 3], [0.12, 4]]) { g.lineWidth = lw; g.beginPath(); g.arc(w / 2, w / 2, r * w, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#d7262e'; g.beginPath(); g.arc(w / 2, w / 2, 0.035 * w, 0, Math.PI * 2); g.fill();
  });
  const padMarkMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, depthWrite: false, toneMapped: false, ...DECAL });

  // --- Geometry per kind ---------------------------------------------------------------------------
  const geos = new Map();
  function geoFor(type) {
    if (geos.has(type)) return geos.get(type);
    let g;
    const def = PIECES[type];
    if (type === 'ring') { g = new THREE.TorusGeometry(def.shape.r, def.shape.tube, 10, 72); g.translate(0, def.shape.lift, 0); }
    else if (type === 'boost') { g = new THREE.PlaneGeometry(def.shape.w, def.shape.d); g.rotateX(-Math.PI / 2); g.translate(0, 0.03, 0); }
    else if (type === 'crate') { g = new THREE.BoxGeometry(def.shape.s, def.shape.s, def.shape.s); g.translate(0, def.shape.s / 2, 0); }
    else if (type === 'pickup') { g = new THREE.OctahedronGeometry(0.62, 0); }
    else if (type === 'padmark') { g = new THREE.PlaneGeometry(9.4, 9.4); g.rotateX(-Math.PI / 2); g.translate(0, PIECES.pad.shape.h + 0.004, 0); }
    else if (type === 'lip') g = null;
    else if (type === 'car') g = parkedCarGeo(def.shape);
    else {
      const m = shapeMesh(def.shape);
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
      g.setIndex(new THREE.BufferAttribute(m.index, 1));
      g.computeBoundingSphere();
    }
    geos.set(type, g);
    return g;
  }
  // The LED lip on a launch edge: kickers, wedges and the quarter-pipe's coping.
  function lipGeo(type) {
    const key = `lip:${type}`;
    if (geos.has(key)) return geos.get(key);
    const sh = PIECES[type].shape;
    let g = null;
    if (type === 'kicker' || type === 'wedge') { g = new THREE.BoxGeometry(sh.w, 0.035, 0.035); g.translate(0, sh.h + 0.01, sh.len / 2 - 0.02); }
    else if (type === 'quarter') { g = new THREE.BoxGeometry(sh.w, 0.035, 0.035); g.translate(0, sh.r + 0.01, -(sh.r + sh.deck) / 2 + sh.r); }
    geos.set(key, g);
    return g;
  }

  // --- Instanced buckets -------------------------------------------------------------------------
  const buckets = new Map();
  function bucket(key, geo, mat, cap, cast = true) {
    let b = buckets.get(key);
    if (b && b.cap >= cap) return b;
    if (b) { group.remove(b.mesh); b.mesh.dispose(); }
    const size = Math.max(8, 1 << Math.ceil(Math.log2(cap)));
    const mesh = new THREE.InstancedMesh(geo, mat, size);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = cast && shadows; mesh.receiveShadow = shadows;
    mesh.count = 0;
    mesh.frustumCulled = false;
    group.add(mesh);
    b = { mesh, cap: size, key };
    buckets.set(key, b);
    return b;
  }

  const dummy = new THREE.Object3D(), col = new THREE.Color();
  const animated = [];         // pickups and boost pads: [{ b, i, o }]
  let lastVersion = -1, lastState = -1;
  function setMatrix(o, extraY = 0, spin = 0) {
    const t = o.transform;
    dummy.position.set(t.x, t.y + extraY, t.z);
    dummy.rotation.set(0, t.yaw + spin, 0);
    dummy.scale.setScalar(t.scale);
    dummy.updateMatrix();
  }

  // Rebuild every instance from the store. `state`: { cleared: Set of ring ids, taken: Set of pickup
  // ids, hideIds: Set } (quests mark rings and pickups as they're used).
  function sync(store, state = {}) {
    // Cheap per-frame check (no strings): the store's version and the layer's revision counter.
    const sig = (state.rev || 0) * 4096 + (state.cleared?.size || 0) * 64 + (state.taken?.size || 0);
    if (store.version === lastVersion && sig === lastState) return;
    lastVersion = store.version; lastState = sig;
    const groups = new Map();
    for (const o of store.all()) {
      if (state.hideIds?.has(o.id) || state.taken?.has(o.id)) continue;
      const k = o.pickup ? 'pickup' : o.type === 'ring' || o.type === 'boost' || o.type === 'crate' ? o.type : o.type === 'car' ? 'car' : `${o.type}|${o.material}`;
      let a = groups.get(k); if (!a) groups.set(k, (a = [])); a.push(o);
    }
    for (const b of buckets.values()) b.mesh.count = 0;
    animated.length = 0;
    for (const [k, list] of groups) {
      const [type, material] = k.split('|');
      const n = list.length;
      let b;
      if (type === 'pickup') b = bucket(k, geoFor('pickup'), pickMat, n, false);
      else if (type === 'ring') b = bucket(k, geoFor('ring'), ringMat, n, false);
      else if (type === 'boost') b = bucket(k, geoFor('boost'), boostMat, n, false);
      else if (type === 'crate') b = bucket(k, geoFor('crate'), crateMat, n);
      else if (type === 'car') b = bucket(k, geoFor('car'), carMat, n);
      else b = bucket(k, geoFor(type), mats[material] || mats.concrete, n);
      list.forEach((o, i) => {
        setMatrix(o, type === 'pickup' ? 1.4 : 0);
        b.mesh.setMatrixAt(i, dummy.matrix);
        if (type === 'pickup') { b.mesh.setColorAt(i, col.set(POWERUPS[o.pickup].color)); animated.push({ b, i, o, kind: 'pickup' }); }
        if (type === 'ring') b.mesh.setColorAt(i, col.set(state.cleared?.has(o.id) ? 0x3e8f6a : ICE));
        if (type === 'car') b.mesh.setColorAt(i, col.set([0xe8e8ea, 0x1d1f24, 0x9aa0a6, 0xd8b25a][hashId(o.id) % 4]));
      });
      b.mesh.count = n;
      b.mesh.instanceMatrix.needsUpdate = true;
      if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
      // LED lips and pad markings ride along.
      if (type === 'kicker' || type === 'wedge' || type === 'quarter') {
        const lb = bucket(`lip:${type}`, lipGeo(type), lipMat, n, false);
        list.forEach((o, i) => { setMatrix(o); lb.mesh.setMatrixAt(i, dummy.matrix); });
        lb.mesh.count = n; lb.mesh.instanceMatrix.needsUpdate = true;
      }
      if (type === 'pad') {
        const pb = bucket(`padmark:${material}`, geoFor('padmark'), padMarkMat, n, false);
        list.forEach((o, i) => { setMatrix(o); pb.mesh.setMatrixAt(i, dummy.matrix); });
        pb.mesh.count = n; pb.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
  const hashId = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

  function frame(time) {
    let touched = null;
    for (const a of animated) {
      setMatrix(a.o, 1.4 + Math.sin(time * 2.2 + a.i) * 0.18, time * 1.6);
      a.b.mesh.setMatrixAt(a.i, dummy.matrix);
      touched = a.b;
    }
    if (touched) touched.mesh.instanceMatrix.needsUpdate = true;
    boostMat.color.setScalar(0.8 + 0.2 * Math.sin(time * 6));
    beacons.forEach((m, i) => { m.material.opacity = 0.22 + 0.1 * Math.sin(time * 2 + i); });
  }

  // --- The ghost: where the piece would go, ice when it fits, signal red when it doesn't ---------
  const ghostFill = new THREE.MeshBasicMaterial({ color: ICE, transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false });
  const ghostLine = new THREE.LineBasicMaterial({ color: ICE, transparent: true, opacity: 0.9, toneMapped: false });
  const ghost = new THREE.Group();
  ghost.visible = false; ghost.renderOrder = 10;
  group.add(ghost);
  let ghostType = null;
  const ghostParts = new Map();
  function ghostPart(type) {
    if (ghostParts.has(type)) return ghostParts.get(type);
    const g = geoFor(type === 'pickup' ? 'pickup' : type);
    const fill = new THREE.Mesh(g, ghostFill), line = new THREE.LineSegments(new THREE.EdgesGeometry(g, 28), ghostLine);
    if (type === 'pickup') { fill.position.y = 1.4; line.position.y = 1.4; }
    const p = new THREE.Group(); p.add(fill, line);
    ghostParts.set(type, p);
    return p;
  }
  function showGhost(type, t, valid) {
    const key = String(type).startsWith('pickup:') ? 'pickup' : type;
    if (ghostType !== key) { ghost.clear(); ghost.add(ghostPart(key)); ghostType = key; }
    ghost.position.set(t.x, t.y, t.z); ghost.rotation.set(0, t.yaw, 0); ghost.scale.setScalar(t.scale);
    const c = valid ? ICE : SIGNAL;
    ghostFill.color.set(c); ghostLine.color.set(c);
    ghostFill.opacity = valid ? 0.26 : 0.34;
    ghost.visible = true;
  }
  // The hovered or selected piece: a white hairline outline.
  const selLine = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, toneMapped: false, depthTest: false });
  const sel = new THREE.Group(); sel.visible = false; sel.renderOrder = 11; group.add(sel);
  let selType = null;
  function highlight(o) {
    if (!o) { sel.visible = false; return; }
    const key = o.pickup ? 'pickup' : o.type;
    if (selType !== key) {
      sel.clear();
      const g = geoFor(key);
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(g, 28), selLine);
      if (key === 'pickup') l.position.y = 1.4;
      sel.add(l); selType = key;
    }
    const t = o.transform;
    sel.position.set(t.x, t.y, t.z); sel.rotation.set(0, t.yaw, 0); sel.scale.setScalar(t.scale);
    sel.visible = true;
  }

  // --- Quest beacons: thin vertical light where an objective is ------------------------------------
  const beacons = [];
  const beaconGeo = new THREE.CylinderGeometry(0.09, 0.09, 80, 6, 1, true);
  beaconGeo.translate(0, 40, 0);
  let beaconKey = '';
  function setBeacons(points) {
    const key = points.map((p) => `${Math.round(p.x)},${Math.round(p.z)},${p.color}`).join(';');
    if (key === beaconKey) return;
    beaconKey = key;
    for (const b of beacons) { group.remove(b); b.material.dispose(); }
    beacons.length = 0;
    for (const p of points) {
      const m = new THREE.Mesh(beaconGeo, new THREE.MeshBasicMaterial({ color: p.color ?? ICE, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      m.position.set(p.x, p.y ?? 0, p.z);
      group.add(m); beacons.push(m);
    }
  }

  // --- The crate on the roof, while it's being delivered ---------------------------------------
  let carried = null;
  function carry(on, carRoot) {
    if (on && !carried) {
      carried = new THREE.Mesh(geoFor('crate'), crateMat);
      carried.scale.setScalar(0.7); carried.position.set(0, 0.55, -0.4); carried.castShadow = shadows;
      carRoot.add(carried);
    } else if (!on && carried) { carried.parent?.remove(carried); carried = null; }
  }

  function dispose() {
    parent.remove(group);
    carry(false);
    for (const b of buckets.values()) b.mesh.dispose();
    for (const g of geos.values()) g?.dispose?.();
    for (const m of [...Object.values(mats), lipMat, ringMat, pickMat, crateMat, carMat, boostMat, padMarkMat, ghostFill, ghostLine, selLine]) m.dispose();
    boostTex.dispose(); padTex.dispose(); beaconGeo.dispose();
  }

  return {
    group, sync, frame, showGhost, hideGhost: () => { ghost.visible = false; }, highlight, setBeacons, carry, dispose,
    // Warm every material once (stage.renderer.compileAsync) so the first placement doesn't hitch.
    warm(store) { void store; },
    stats: () => ({ buckets: buckets.size, instances: [...buckets.values()].reduce((a, b) => a + b.mesh.count, 0), drawCalls: [...buckets.values()].filter((b) => b.mesh.count > 0).length }),
  };
}
export { SKIRT };
