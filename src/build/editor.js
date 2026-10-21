// BUILD MODE: placing, moving, rotating, scaling and deleting pieces on a grid, with a ghost that
// shows where a piece will go (ice: it fits; signal red: it doesn't, and why), undo/redo, and an
// orbit camera. The car waits while you build.
//
// Mouse      move: the ghost follows · click: place (Place) or pick (Edit) · drag: orbit ·
//            right-drag: pan · wheel: zoom
// Keyboard   arrows/WASD move the ghost a cell (Shift: 5) · Enter/Space place · Q/E rotate 15° ·
//            Z/X scale · M material · Tab Place/Edit · Delete remove · Ctrl+Z / Ctrl+Shift+Z undo/redo
//            · 1–0 − = pick a piece · B or Esc done
// Touch      tap: place (or pick) · drag the ghost or the picked piece to move it · drag the world
//            to pan · pinch: zoom · two-finger twist: rotate the piece · + opens the radial menu ·
//            drag a piece from the palette onto the world to drop it there
import * as THREE from 'three';
import { PIECES, PIECE_IDS, POWERUP_IDS, MATERIAL_IDS, GRID, SCALE } from './catalogue.js';
import { objectSdf } from './objects.js';

const D2R = Math.PI / 180;
const snap = (v, s) => Math.round(v / s) * s;
const clampScale = (s) => Math.min(SCALE.max, Math.max(SCALE.min, snap(s, SCALE.step)));

export function createEditor(api, bui, { onEditing } = {}) {
  const { host } = api;
  const camera = host.camera, canvas = host.canvas;
  const st = {
    on: false, mode: 'place', type: 'kicker', material: null, yaw: 0, scale: 1,
    ghost: { x: 0, y: 0, z: 0, yaw: 0, scale: 1 }, valid: { ok: false, why: '' }, hover: null, sel: null,
    cam: { fx: 0, fy: 0, fz: 0, yaw: 0, pitch: 0.62, dist: 34 }, camPos: new THREE.Vector3(), camInit: false,
    undo: [], redo: [], drag: null, pointers: new Map(), lastPinch: null, pressT: 0,
  };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), sn = { x: 0, y: 0, z: 0 }, tn = { x: 0, y: 0, z: 0 };

  // --- Picking: march the camera ray through the world's distance field (pieces included) --------
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    let t = 0.2;
    for (let i = 0; i < 220 && t < 900; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const phi = api.course.sdf(x, y, z, sn);
      if (phi < 0.02) return hitAt(x, y, z);
      t += Math.max(0.03, phi * 0.6);
    }
    // Nothing hit (looking at the sky): the ground plane at the focus height.
    if (d.y < -1e-3) { const tt = (st.cam.fy - o.y) / d.y; if (tt > 0) return hitAt(o.x + d.x * tt, st.cam.fy, o.z + d.z * tt); }
    return null;
  }
  const near = [];
  function hitAt(x, y, z) {
    let obj = null, best = 0.12;
    api.store.objectsNear(x, z, 2, near);
    for (const o of near) {
      if (o.sensor) {
        // Sensors have no solid; pick them by their box.
        if (x > o.min[0] - 0.5 && x < o.max[0] + 0.5 && z > o.min[2] - 0.5 && z < o.max[2] + 0.5 && o.tag === 'build') obj = obj || o;
        continue;
      }
      const d = Math.abs(objectSdf(o, x, y, z, tn));
      if (d < best && o.tag === 'build') { best = d; obj = o; }
    }
    return { x, y, z, obj, top: obj && !obj.sensor ? y : null };
  }

  // --- The ghost ------------------------------------------------------------------------------------
  function setGhostAt(h) {
    if (!h) return;
    const g = st.ghost;
    g.x = snap(h.x, GRID.move); g.z = snap(h.z, GRID.move);
    // On top of a piece (stacking) or on the world's own ground.
    g.y = h.top != null ? Math.round(h.top * 100) / 100 : host.groundAt(g.x, g.z);
    g.yaw = st.yaw; g.scale = st.scale;
    refreshGhost();
  }
  function refreshGhost() {
    if (!st.on) return;
    if (st.mode === 'place') {
      st.valid = api.canPlace(st.type, st.ghost);
      api.render.showGhost(st.type, st.ghost, st.valid.ok);
    } else api.render.hideGhost();
    api.render.highlight(st.sel || st.hover);
    bui.editorState(state());
  }
  const state = () => ({
    mode: st.mode, type: st.type, material: st.material || PIECES[st.type]?.mat || 'concrete', yaw: st.yaw, scale: st.scale,
    valid: st.valid, sel: st.sel, cost: api.buildCost(), undo: st.undo.length, redo: st.redo.length, progress: api.progress,
  });

  // --- Operations (all undoable) --------------------------------------------------------------------
  function push(op) { st.undo.push(op); if (st.undo.length > 200) st.undo.shift(); st.redo.length = 0; }
  function place() {
    if (st.mode !== 'place') return false;
    st.valid = api.canPlace(st.type, st.ghost);
    if (!st.valid.ok) { api.cue(st.valid.why, 1600); refreshGhost(); return false; }
    const isPickup = st.type.startsWith('pickup:');
    const o = api.add({ type: st.type, material: isPickup ? undefined : st.material || PIECES[st.type].mat, transform: { ...st.ghost } });
    push({ kind: 'add', spec: api.specOf(o) });
    if (isPickup && !api.arcade) api.cue('Power-ups only work with the Arcade layer on', 2200);
    refreshGhost();
    return true;
  }
  function removeObj(o) {
    if (!o || o.tag !== 'build') return;
    push({ kind: 'remove', spec: api.specOf(o) });
    api.remove(o.id);
    if (st.sel === o) st.sel = null;
    if (st.hover === o) st.hover = null;
    refreshGhost();
  }
  function setObj(o, to) {
    const from = api.specOf(o);
    const next = { ...from, ...to, transform: { ...from.transform, ...(to.transform || {}) } };
    if (to.transform) { const v = api.canPlace(o.type, next.transform, o.id); if (!v.ok) { api.cue(v.why, 1400); return o; } }
    api.remove(o.id);
    const n = api.add(next);
    push({ kind: 'set', from, to: api.specOf(n) });
    st.sel = n;
    refreshGhost();
    return n;
  }
  function apply(op, inverse) {
    if (op.kind === 'add') { if (inverse) api.remove(op.spec.id); else api.add(op.spec); }
    else if (op.kind === 'remove') { if (inverse) api.add(op.spec); else api.remove(op.spec.id); }
    else if (op.kind === 'set') { const a = inverse ? op.to : op.from, b = inverse ? op.from : op.to; api.remove(a.id); api.add(b); }
    st.sel = null; st.hover = null;
  }
  function undo() { const op = st.undo.pop(); if (!op) return; apply(op, true); st.redo.push(op); refreshGhost(); api.cue('Undo', 600); }
  function redo() { const op = st.redo.pop(); if (!op) return; apply(op, false); st.undo.push(op); refreshGhost(); api.cue('Redo', 600); }
  function rotate(dir) {
    if (st.mode === 'edit' && st.sel) { setObj(st.sel, { transform: { yaw: st.sel.transform.yaw + dir * GRID.yaw * D2R } }); return; }
    st.yaw = snap((st.yaw / D2R + dir * GRID.yaw), GRID.yaw) * D2R; st.ghost.yaw = st.yaw; refreshGhost();
  }
  function scaleBy(dir) {
    if (st.mode === 'edit' && st.sel) { setObj(st.sel, { transform: { scale: clampScale(st.sel.transform.scale + dir * SCALE.step) } }); return; }
    st.scale = clampScale(st.scale + dir * SCALE.step); st.ghost.scale = st.scale; refreshGhost();
  }
  function cycleMaterial() {
    const cur = st.mode === 'edit' && st.sel ? st.sel.material : st.material || PIECES[st.type]?.mat || 'concrete';
    const next = MATERIAL_IDS[(MATERIAL_IDS.indexOf(cur) + 1) % MATERIAL_IDS.length];
    setMaterial(next);
  }
  function setMaterial(m) {
    if (st.mode === 'edit' && st.sel && !st.sel.sensor) { setObj(st.sel, { material: m }); return; }
    st.material = m; refreshGhost();
  }
  function choose(type) {
    st.type = type; st.mode = 'place'; st.sel = null;
    if (!type.startsWith('pickup:') && PIECES[type]) st.material = null;
    refreshGhost();
  }
  function setMode(m) { st.mode = m; if (m === 'place') st.sel = null; refreshGhost(); }
  function moveGhost(dx, dz) {
    // Camera-relative: "up" moves away from the camera.
    const c = Math.cos(st.cam.yaw), s = Math.sin(st.cam.yaw);
    const wx = dx * c + dz * s, wz = -dx * s + dz * c;   // +dx is the camera's left (+x is left of +z)
    if (st.mode === 'edit' && st.sel) { const t = st.sel.transform; setObj(st.sel, { transform: { x: snap(t.x + wx, GRID.move), z: snap(t.z + wz, GRID.move), y: host.groundAt(t.x + wx, t.z + wz) } }); return; }
    st.ghost.x = snap(st.ghost.x + wx, GRID.move); st.ghost.z = snap(st.ghost.z + wz, GRID.move);
    st.ghost.y = host.groundAt(st.ghost.x, st.ghost.z);
    st.cam.fx = st.ghost.x; st.cam.fz = st.ghost.z; st.cam.fy = st.ghost.y;
    refreshGhost();
  }

  // --- Camera --------------------------------------------------------------------------------------
  const want = new THREE.Vector3();
  function updateCamera(dt) {
    const c = st.cam;
    want.set(c.fx - Math.sin(c.yaw) * Math.cos(c.pitch) * c.dist, c.fy + Math.sin(c.pitch) * c.dist, c.fz - Math.cos(c.yaw) * Math.cos(c.pitch) * c.dist);
    const g = host.groundAt(want.x, want.z) + 1.5;
    if (want.y < g) want.y = g;
    if (!st.camInit) { st.camPos.copy(want); st.camInit = true; }
    st.camPos.lerp(want, 1 - Math.exp(-dt * 10));
    camera.position.copy(st.camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(c.fx, c.fy + 1, c.fz);
    if (Math.abs(camera.fov - 50) > 0.01) { camera.fov = 50; camera.updateProjectionMatrix(); }
  }

  // --- Pointer input ---------------------------------------------------------------------------------
  function onDown(e) {
    if (!st.on) return;
    canvas.setPointerCapture?.(e.pointerId);
    st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, button: e.button, type: e.pointerType });
    st.lastPinch = null;
    if (st.pointers.size === 1) {
      st.pressT = performance.now();
      const h = pick(e.clientX, e.clientY);
      // Touch: a drag that starts on the ghost (or the picked piece) moves it.
      st.drag = null;
      if (e.pointerType !== 'mouse' && h) {
        const g = st.mode === 'edit' && st.sel ? st.sel.transform : st.ghost;
        if (Math.hypot(h.x - g.x, h.z - g.z) < 3.5 * g.scale) st.drag = 'piece';
      }
      if (e.pointerType === 'mouse' && e.button === 0 && st.mode === 'edit' && h?.obj && h.obj === st.sel) st.drag = 'piece';
    }
  }
  function onMove(e) {
    if (!st.on) return;
    const p = st.pointers.get(e.pointerId);
    if (!p) {
      // Hover (mouse, no buttons): the ghost follows the cursor; pieces under it light up.
      if (e.pointerType === 'mouse') { const h = pick(e.clientX, e.clientY); st.hover = h?.obj || null; if (st.mode === 'place') setGhostAt(h); else refreshGhost(); }
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const moved = Math.hypot(p.x - p.x0, p.y - p.y0) > 6;
    if (st.pointers.size >= 2) { twoFinger(); return; }
    if (!moved) return;
    if (st.drag === 'piece') {
      const h = pick(e.clientX, e.clientY);
      if (!h) return;
      if (st.mode === 'edit' && st.sel) { st.sel = moveSel(h); } else setGhostAt(h);
      return;
    }
    if (p.type === 'mouse' && p.button === 2) pan(dx, dy);
    else if (p.type === 'mouse') { st.cam.yaw -= dx * 0.006; st.cam.pitch = Math.min(1.45, Math.max(0.12, st.cam.pitch + dy * 0.005)); }
    else pan(dx, dy);
  }
  let moveTimer = 0;
  function moveSel(h) {
    // Live: move the piece on screen; commit (undoable) when the finger lifts.
    const o = st.sel, t = o.transform;
    if (!st.dragFrom) st.dragFrom = api.specOf(o);
    t.x = snap(h.x, GRID.move); t.z = snap(h.z, GRID.move); t.y = host.groundAt(t.x, t.z);
    clearTimeout(moveTimer);
    api.remove(o.id);
    const n = api.add({ ...st.dragFrom, id: o.id, transform: { ...t } });
    refreshGhost();
    return n;
  }
  function onUp(e) {
    if (!st.on) return;
    const p = st.pointers.get(e.pointerId);
    st.pointers.delete(e.pointerId);
    if (!p) return;
    const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 6;
    if (st.dragFrom && st.sel) { const to = api.specOf(st.sel); push({ kind: 'set', from: st.dragFrom, to }); st.dragFrom = null; }
    if (moved || st.pointers.size > 0 || (p.type === 'mouse' && p.button !== 0)) { st.drag = null; return; }
    // A tap / click.
    const h = pick(e.clientX, e.clientY);
    if (st.mode === 'edit') { st.sel = h?.obj || null; refreshGhost(); return; }
    if (p.type === 'mouse') { setGhostAt(h); place(); return; }
    // Touch: the first tap moves the ghost there; a tap on the ghost places it.
    const g = st.ghost;
    if (h && Math.hypot(h.x - g.x, h.z - g.z) < 2.5 * g.scale && st.drag !== 'piece') place();
    else setGhostAt(h);
    st.drag = null;
  }
  function pan(dx, dy) {
    const k = st.cam.dist * 0.0022, c = Math.cos(st.cam.yaw), s = Math.sin(st.cam.yaw);
    // Grab the ground: drag right and the world follows the finger; drag down to look further on.
    st.cam.fx += (dx * c + dy * s) * k; st.cam.fz += (-dx * s + dy * c) * k;
    st.cam.fy = host.groundAt(st.cam.fx, st.cam.fz);
  }
  function twoFinger() {
    const [a, b] = [...st.pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (st.lastPinch) {
      st.cam.dist = Math.min(160, Math.max(8, st.cam.dist * (st.lastPinch.dist / Math.max(20, dist))));
      // Twist: every 15° of finger rotation turns the piece one step.
      st.twist = (st.twist || 0) + angleDiff(ang, st.lastPinch.ang);
      while (st.twist > 15 * D2R) { rotate(1); st.twist -= 15 * D2R; }
      while (st.twist < -15 * D2R) { rotate(-1); st.twist += 15 * D2R; }
    }
    st.lastPinch = { dist, ang };
  }
  const angleDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  function onWheel(e) { if (!st.on) return; e.preventDefault(); st.cam.dist = Math.min(160, Math.max(8, st.cam.dist * Math.exp(e.deltaY * 0.0012))); }
  const onContext = (e) => { if (st.on) e.preventDefault(); };

  // --- Keyboard (captured while building, so driving keys don't fire) ----------------------------
  const KEYS = Object.fromEntries([...PIECE_IDS.map((id) => [PIECES[id].key, id])]);
  function onKey(e) {
    if (!st.on || e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
    const k = e.key, code = e.code, mod = e.ctrlKey || e.metaKey;
    let used = true;
    if (mod && (k === 'z' || k === 'Z')) { if (e.shiftKey) redo(); else undo(); }
    else if (mod && (k === 'y' || k === 'Y')) redo();
    else if (mod) used = false;
    else if (code === 'Escape' || code === 'KeyB') toggle(false);
    else if (code === 'Tab') setMode(st.mode === 'place' ? 'edit' : 'place');
    else if (code === 'KeyQ') rotate(-1);
    else if (code === 'KeyE') rotate(1);
    else if (code === 'KeyZ') scaleBy(-1);
    else if (code === 'KeyX') scaleBy(1);
    else if (code === 'KeyM') cycleMaterial();
    else if (code === 'Delete' || code === 'Backspace') removeObj(st.sel || st.hover);
    else if (code === 'Enter' || code === 'Space') { if (st.mode === 'place') place(); }
    else if (code === 'ArrowUp' || code === 'KeyW') moveGhost(0, e.shiftKey ? 5 : 1);
    else if (code === 'ArrowDown' || code === 'KeyS') moveGhost(0, e.shiftKey ? -5 : -1);
    else if (code === 'ArrowLeft' || code === 'KeyA') moveGhost(e.shiftKey ? 5 : 1, 0);
    else if (code === 'ArrowRight' || code === 'KeyD') moveGhost(e.shiftKey ? -5 : -1, 0);
    else if (KEYS[k] && !e.repeat) choose(KEYS[k]);
    else used = false;
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
  }

  // --- On / off ------------------------------------------------------------------------------------
  function toggle(on = !st.on) {
    if (on === st.on) return;
    if (on && api.questActive) { api.cue('Leave the quest to build (your build is waiting)', 2000); return; }
    st.on = on;
    if (on) {
      const car = host.getCar();
      const q = car.quat, fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), l = Math.hypot(fx, fz) || 1;
      st.cam.yaw = Math.atan2(fx / l, fz / l);
      st.ghost.x = snap(car.pos.x + (fx / l) * 22, GRID.move); st.ghost.z = snap(car.pos.z + (fz / l) * 22, GRID.move);
      st.ghost.y = host.groundAt(st.ghost.x, st.ghost.z);
      st.ghost.yaw = st.yaw = snap(st.cam.yaw / D2R, GRID.yaw) * D2R; st.ghost.scale = st.scale;
      st.cam.fx = (car.pos.x + st.ghost.x) / 2; st.cam.fz = (car.pos.z + st.ghost.z) / 2; st.cam.fy = st.ghost.y;
      st.cam.dist = api.coarse ? 40 : 34; st.cam.pitch = 0.62; st.camInit = false;
      addEventListener('keydown', onKey, true);
      canvas.addEventListener('pointerdown', onDown);
      addEventListener('pointermove', onMove);
      addEventListener('pointerup', onUp);
      addEventListener('pointercancel', onUp);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('contextmenu', onContext);
      document.body.classList.add('building');
    } else {
      removeEventListener('keydown', onKey, true);
      canvas.removeEventListener('pointerdown', onDown);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      st.pointers.clear(); st.sel = null; st.hover = null;
      api.render.hideGhost(); api.render.highlight(null);
      document.body.classList.remove('building');
    }
    bui.showBuild(on, state());
    onEditing?.(on);
    if (on) refreshGhost();
  }

  return {
    toggle, place, undo, redo, rotate, scaleBy, choose, setMode, setMaterial, cycleMaterial, moveGhost,
    remove: () => removeObj(st.sel || st.hover),
    // Drop a piece at a screen point (drag from the palette, radial menu at a finger).
    dropAt(type, clientX, clientY) { choose(type); const h = pick(clientX, clientY); if (h) { setGhostAt(h); place(); } },
    ghostAtScreen(clientX, clientY) { const h = pick(clientX, clientY); if (h) setGhostAt(h); },
    frame(dt) { if (st.on) updateCamera(dt); },
    get on() { return st.on; }, state, st,
    pickups: POWERUP_IDS,
    dispose() { toggle(false); clearTimeout(moveTimer); },
  };
}
