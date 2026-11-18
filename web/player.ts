// The visitor: a little felt hedgehog the person at the keyboard walks around the village.
// WASD or the arrow keys move (relative to the camera), Shift runs, Space hops (a small hop).
// Animation is procedural, on the pivots art/visitor.py builds:
//   Visitor > BodyPivot > HeadPivot > Ear.L / Ear.R / Nose
//   Visitor > Foot.FL / Foot.FR / Foot.BL / Foot.BR
// Positions are three.js (x, height, z); layout metres (x, y) sit at (x, h, -y).

import * as THREE from 'three';
import type { Terrain } from './terrain.ts';

export interface Player {
  object: THREE.Object3D;
  update(dt: number, cameraYaw: number): void;
  readonly moving: boolean;
  /** Footfalls so far (for footstep sounds). */
  readonly steps: number;
  readonly wantsControl: boolean;
  takeControl(): void;
  placeAt(x: number, y: number): void;
}

const WALK = 2.2;
const RUN = 4.5;
const RADIUS = 0.35;
const MARGIN = 3;
const GRAVITY = 14;
/** A small hop: about 0.2 m up. */
const HOP_SPEED = 2.5;
/** Metres per full step cycle of the scurry. */
const STRIDE = 0.42;
/** The feet in order FL, FR, BL, BR: diagonal pairs step together. */
const FOOT_PHASE = [0, Math.PI, Math.PI, 0];

const MOVE_KEYS: Record<string, 'f' | 'b' | 'l' | 'r'> = {
  KeyW: 'f', ArrowUp: 'f',
  KeyS: 'b', ArrowDown: 'b',
  KeyA: 'l', ArrowLeft: 'l',
  KeyD: 'r', ArrowRight: 'r',
};

const damp = (a: number, b: number, rate: number, dt: number) => a + (b - a) * (1 - Math.exp(-rate * dt));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** An angle on a spring: ears lag behind the body and wobble back. */
class Spring {
  value = 0;
  vel = 0;
  k: number;
  c: number;
  constructor(k = 140, c = 9) {
    this.k = k;
    this.c = c;
  }
  step(target: number, dt: number) {
    this.vel += (-this.k * (this.value - target) - this.c * this.vel) * dt;
    this.value += this.vel * dt;
  }
}

function typing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function createPlayer(model: THREE.Object3D, terrain: Terrain): Player {
  const object = new THREE.Group();
  object.name = 'Player';
  object.add(model);
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mat = o.material as THREE.MeshStandardMaterial;
    o.castShadow = !/^(Shine|Mouth|Eye)/.test(mat.name);
    o.receiveShadow = true;
    if (mat.name === 'Spines') mat.roughness = 0.5;
    if (mat.name === 'Eye') {
      mat.roughness = 0.04;
      mat.envMapIntensity = 2.2;
    }
  });
  // GLTFLoader drops the dots from names ("Ear.L" arrives as "EarL").
  const find = (name: string) => model.getObjectByName(name) ?? model.getObjectByName(name.replace(/\./g, '')) ?? new THREE.Object3D();
  const body = find('BodyPivot');
  const head = find('HeadPivot');
  const ears = [find('Ear.L'), find('Ear.R')];
  const nose = find('Nose');
  const feet = ['Foot.FL', 'Foot.FR', 'Foot.BL', 'Foot.BR'].map(find);
  const base = new Map<THREE.Object3D, THREE.Vector3>();
  for (const o of [body, head, nose, ...ears, ...feet]) base.set(o, o.position.clone());
  const at = (o: THREE.Object3D) => base.get(o)!;

  // ---------- keys ----------
  const held = new Set<string>();
  let shift = false;
  let hopQueued = false;
  let wants = false;
  addEventListener('keydown', (e) => {
    if (typing() || e.metaKey || e.ctrlKey || e.altKey) return;
    shift = e.shiftKey;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') held.add(e.code);
    if (e.code in MOVE_KEYS) {
      held.add(e.code);
      wants = true;
      e.preventDefault();
    } else if (e.code === 'Space') {
      if (!e.repeat) hopQueued = true;
      wants = true;
      e.preventDefault();
    }
  });
  addEventListener('keyup', (e) => {
    shift = e.shiftKey;
    held.delete(e.code);
    if ((e.code in MOVE_KEYS || e.code === 'Space') && !typing()) e.preventDefault();
  });
  const clear = () => {
    held.clear();
    shift = false;
  };
  addEventListener('blur', clear);
  document.addEventListener('visibilitychange', () => document.hidden && clear());

  // ---------- state ----------
  const vel = new THREE.Vector2(); // three.js x, z
  let heading = 0;
  let airY = 0; // height above the ground from a hop (Space)
  let airV = 0;
  let phase = 0; // step cycle while moving, 0..2π
  let steps = 0;
  let gaitAmt = 0;
  let speed = 0;
  let wasAir = false;
  let clock = 0;
  let twitchIn = 2;
  let lookYaw = 0;
  let lookTarget = 0;
  let lookIn = 1.5;
  const earPitch = [new Spring(), new Spring()];
  const earRoll = [new Spring(120, 8), new Spring(120, 8)];
  const squash = new Spring(260, 14);
  // The hedgehog's ears are small felt cups: they only flick a little.
  const kick = (v: number) => {
    for (const s of earPitch) s.vel += v * 0.12;
    for (const [i, s] of earRoll.entries()) s.vel += v * 0.08 * (i === 0 ? -1 : 1);
  };

  function placeAt(x: number, y: number) {
    object.position.set(x, terrain.heightAt(x, y), -y);
    vel.set(0, 0);
    airY = airV = 0;
  }

  function update(dt: number, cameraYaw: number) {
    dt = Math.min(dt, 0.1);
    clock += dt;

    // Wish direction from the keys, turned to the camera: W goes away from it.
    let fwd = 0;
    let side = 0;
    for (const code of held) {
      const k = MOVE_KEYS[code];
      if (k === 'f') fwd += 1;
      if (k === 'b') fwd -= 1;
      if (k === 'r') side += 1;
      if (k === 'l') side -= 1;
    }
    const sy = Math.sin(cameraYaw);
    const cy = Math.cos(cameraYaw);
    const wish = new THREE.Vector2(-sy * fwd + cy * side, -cy * fwd - sy * side);
    if (wish.lengthSq() > 1) wish.normalize();
    const running = shift || held.has('ShiftLeft') || held.has('ShiftRight');
    const top = running ? RUN : WALK;
    const accel = wish.lengthSq() > 0 ? 9 : 7;
    vel.x = damp(vel.x, wish.x * top, accel, dt);
    vel.y = damp(vel.y, wish.y * top, accel, dt);
    if (vel.lengthSq() < 1e-4 && wish.lengthSq() === 0) vel.set(0, 0);

    // Move, then step out of anything solid and stay inside the map.
    const p = object.position;
    let lx = p.x + vel.x * dt;
    let ly = -(p.z + vel.y * dt);
    [lx, ly] = terrain.push(lx, ly, RADIUS);
    const b = terrain.bounds;
    lx = Math.min(b.x1 - MARGIN, Math.max(b.x0 + MARGIN, lx));
    ly = Math.min(b.y1 - MARGIN, Math.max(b.y0 + MARGIN, ly));
    const moved = Math.hypot(lx - p.x, -ly - p.z);
    speed = moved / Math.max(dt, 1e-4);
    p.x = lx;
    p.z = -ly;

    // Space: a small hop (a little higher on the run).
    if (hopQueued && airY <= 0.001) {
      airV = HOP_SPEED + (speed > WALK + 0.5 ? 0.5 : 0);
      kick(-9);
      squash.vel -= 3;
    }
    hopQueued = false;
    if (airY > 0 || airV > 0) {
      airV -= GRAVITY * dt;
      airY += airV * dt;
      if (airY <= 0) {
        airY = 0;
        airV = 0;
      }
    }
    const inAir = airY > 0.001;
    if (wasAir && !inAir) {
      kick(12);
      squash.vel += 4;
    }
    wasAir = inAir;
    p.y = terrain.heightAt(lx, ly) + airY;

    // Face where you're going.
    const going = vel.length() > 0.15;
    if (going) {
      const want = Math.atan2(vel.x, vel.y);
      heading += wrap(want - heading) * (1 - Math.exp(-12 * dt));
      object.rotation.y = heading;
    }

    // ---------- animation ----------
    // A scurry: the four feet step in diagonal pairs, quicker the faster you go; the body bobs
    // and rocks a little and leans into a run. Space is a small hop with a squash on landing.
    const t = clock;
    const moving = speed > 0.12 && !inAir;
    gaitAmt = damp(gaitAmt, moving ? 1 : 0, moving ? 10 : 5, dt);
    if (moving) {
      const before = Math.floor(phase / Math.PI);
      // One full step cycle per STRIDE metres (two footfalls), capped so a run stays readable.
      phase += Math.min(15, (Math.max(speed, 0.6) / STRIDE) * Math.PI * 2) * dt;
      if (Math.floor(phase / Math.PI) !== before) steps++;
      if (phase >= Math.PI * 2) phase -= Math.PI * 2;
    } else if (gaitAmt < 0.05) phase = 0;
    squash.step(0, dt);
    const breathe = 0.014 * Math.sin(t * 2.4) * (1 - gaitAmt);
    const jumpStretch = inAir ? Math.min(0.1, Math.abs(airV) * 0.025) : 0;
    const sq = squash.value;
    const bb = at(body);
    const bob = Math.abs(Math.sin(phase)) * 0.035 * gaitAmt;
    body.position.set(bb.x, bb.y + bob - sq * 0.04, bb.z);
    body.scale.set(1 + sq * 0.3 - jumpStretch * 0.3, 1 - sq * 0.5 + breathe + jumpStretch, 1 + sq * 0.2);
    const lean = gaitAmt * Math.min(0.14, speed * 0.03) + (inAir ? -airV * 0.025 : 0);
    body.rotation.x = damp(body.rotation.x, lean, 12, dt);
    body.rotation.z = damp(body.rotation.z, 0.07 * Math.sin(phase) * gaitAmt, 16, dt);

    // Head: looks about when idle, steady while scurrying; the nose sniffs in bursts.
    lookIn -= dt;
    if (lookIn <= 0) {
      lookTarget = (Math.random() - 0.5) * 1.0;
      lookIn = 1.5 + Math.random() * 3;
    }
    lookYaw = damp(lookYaw, moving ? 0 : lookTarget, 3, dt);
    head.rotation.set(-body.rotation.x * 0.5 + 0.04 * Math.sin(phase * 2) * gaitAmt + (1 - gaitAmt) * 0.05 * Math.sin(t * 0.9), lookYaw, -body.rotation.z * 0.6);
    const sniffing = Math.sin(t * 0.8) > 0.2 || gaitAmt > 0.5;
    const sniff = sniffing ? Math.sin(t * 24) * 0.006 : 0;
    const nb = at(nose);
    nose.position.set(nb.x, nb.y + sniff, nb.z + Math.abs(sniff) * 0.5);

    // Ears: a twitch now and then, a flick on landing.
    twitchIn -= dt;
    if (twitchIn <= 0) {
      const i = Math.random() < 0.5 ? 0 : 1;
      earRoll[i]!.vel += (i === 0 ? -1 : 1) * (1.5 + Math.random());
      twitchIn = 2 + Math.random() * 5;
    }
    ears.forEach((ear, i) => {
      earPitch[i]!.step(inAir ? -0.06 : 0, dt);
      earRoll[i]!.step(0, dt);
      ear.rotation.set(earPitch[i]!.value, 0, earRoll[i]!.value);
    });

    // Feet: diagonal pairs step together; in the air they tuck up under the body.
    const tuck = inAir ? Math.min(1, airY * 6) : 0;
    feet.forEach((foot, i) => {
      const fb = at(foot);
      const ph = phase + FOOT_PHASE[i]!;
      const swing = Math.sin(ph) * 0.1 * gaitAmt * Math.min(1.3, 0.6 + speed * 0.2);
      const lift = Math.max(0, Math.cos(ph)) * 0.06 * gaitAmt;
      foot.position.set(fb.x * (1 - 0.25 * tuck), fb.y + lift + tuck * 0.06, fb.z + swing + (fb.z > 0 ? -1 : 1) * 0.05 * tuck);
      foot.rotation.x = -Math.sin(ph) * 0.4 * gaitAmt;
    });
  }

  return {
    object,
    update,
    get moving() {
      return speed > 0.12;
    },
    get steps() {
      return steps;
    },
    get wantsControl() {
      return wants;
    },
    takeControl() {
      wants = false;
    },
    placeAt,
  };
}
