// The visitor: a little felt bunny the person at the keyboard walks around the village.
// WASD or the arrow keys move (relative to the camera), Shift runs, Space hops.
// Animation is procedural, on the pivots art/visitor.py builds:
//   Visitor > BodyPivot > HeadPivot > Ear.L / Ear.R;  BodyPivot > Tail
//   Visitor > Paw.FL / Paw.FR / Foot.BL / Foot.BR
// Positions are three.js (x, height, z); layout metres (x, y) sit at (x, h, -y).

import * as THREE from 'three';
import type { Terrain } from './terrain.ts';

export interface Player {
  object: THREE.Object3D;
  update(dt: number, cameraYaw: number): void;
  readonly moving: boolean;
  readonly wantsControl: boolean;
  takeControl(): void;
  placeAt(x: number, y: number): void;
}

const WALK = 2.2;
const RUN = 4.5;
const RADIUS = 0.35;
const MARGIN = 3;
const GRAVITY = 14;
const HOP_SPEED = 3.6;

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
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  // GLTFLoader drops the dots from names ("Ear.L" arrives as "EarL").
  const find = (name: string) => model.getObjectByName(name) ?? model.getObjectByName(name.replace(/\./g, '')) ?? new THREE.Object3D();
  const body = find('BodyPivot');
  const head = find('HeadPivot');
  const ears = [find('Ear.L'), find('Ear.R')];
  const tail = find('Tail');
  const paws = [find('Paw.FL'), find('Paw.FR')];
  const feet = [find('Foot.BL'), find('Foot.BR')];
  const face = ['Nose', 'Muzzle.L', 'Muzzle.R', 'Mouth.L', 'Mouth.R', 'Mouth.Mid'].map(find);
  const base = new Map<THREE.Object3D, THREE.Vector3>();
  for (const o of [body, head, tail, ...ears, ...paws, ...feet, ...face]) base.set(o, o.position.clone());
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
  let phase = 0; // hop cycle while moving, 0..1
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
  const kick = (v: number) => {
    for (const s of earPitch) s.vel += v;
    for (const [i, s] of earRoll.entries()) s.vel += v * 0.6 * (i === 0 ? -1 : 1);
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

    // Hops: Space jumps; walking is a run of little hops of its own (below).
    if (hopQueued && airY <= 0.001) {
      airV = HOP_SPEED + (speed > WALK + 0.5 ? 0.6 : 0);
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
    const t = clock;
    const moving = speed > 0.12 && !inAir;
    gaitAmt = damp(gaitAmt, moving ? 1 : 0, moving ? 10 : 6, dt);
    const hopLen = 0.5 + speed * 0.17;
    if (gaitAmt > 0.01) {
      const before = phase;
      phase = (phase + (Math.max(speed, 0.8) * dt) / hopLen) % 1;
      if (phase < before) {
        // Landed one of the walking hops.
        kick(5 + speed);
        squash.vel += 1.5 + speed * 0.4;
      }
    }
    if (!moving && gaitAmt < 0.05) phase = 0;
    // Airborne for the first 75% of a hop, a squash on the ground for the rest.
    const air = phase < 0.75 ? Math.sin((Math.PI * phase) / 0.75) : 0;
    const hopH = (0.07 + 0.03 * Math.min(speed, RUN)) * gaitAmt;
    const lift = air * hopH;
    squash.step(0, dt);
    const sq = squash.value + (phase >= 0.75 ? Math.sin((Math.PI * (phase - 0.75)) / 0.25) * 0.08 * gaitAmt : 0);
    const breathe = 0.014 * Math.sin(t * 2.4) * (1 - gaitAmt);

    const jumpStretch = inAir ? Math.min(0.12, Math.abs(airV) * 0.03) : 0;
    const sy2 = 1 - sq * 0.6 + breathe + jumpStretch + air * 0.05 * gaitAmt;
    const sxz = 1 + sq * 0.35 - jumpStretch * 0.4;
    const bb = at(body);
    body.position.set(bb.x, bb.y + lift - sq * 0.03, bb.z);
    body.scale.set(sxz, sy2, sxz);
    // Lean into the hop: nose down taking off, up landing; lean into a run.
    const lean = gaitAmt * (0.12 * Math.cos(Math.PI * phase * 1.33) + speed * 0.025) + (inAir ? -airV * 0.03 : 0);
    body.rotation.x = damp(body.rotation.x, lean, 14, dt);

    // Head: looks about when idle, stays level while hopping, nose wiggles in bursts.
    lookIn -= dt;
    if (lookIn <= 0) {
      lookTarget = (Math.random() - 0.5) * 1.0;
      lookIn = 1.5 + Math.random() * 3;
    }
    lookYaw = damp(lookYaw, moving ? 0 : lookTarget, 3, dt);
    head.rotation.set(-body.rotation.x * 0.6 + (moving ? 0 : 0.04 * Math.sin(t * 0.9)), lookYaw, (moving ? 0 : 0.06 * Math.sin(t * 0.6)) * (1 - gaitAmt));
    const sniff = Math.sin(t * 0.8) > 0.2 ? Math.sin(t * 26) * 0.004 : 0;
    for (const o of face) {
      const fb = at(o);
      o.position.set(fb.x, fb.y + sniff, fb.z + Math.abs(sniff) * 0.5);
    }

    // Ears: swept back by speed, flop on landings, twitch now and then.
    twitchIn -= dt;
    if (twitchIn <= 0) {
      const i = Math.random() < 0.5 ? 0 : 1;
      earRoll[i]!.vel += (i === 0 ? -1 : 1) * (6 + Math.random() * 4);
      earPitch[i]!.vel -= 4;
      twitchIn = 2 + Math.random() * 5;
    }
    const back = -Math.min(0.9, speed * 0.16) - (inAir ? 0.25 : 0);
    ears.forEach((ear, i) => {
      earPitch[i]!.step(back, dt);
      earRoll[i]!.step(0, dt);
      ear.rotation.set(earPitch[i]!.value, 0, earRoll[i]!.value);
    });

    // Paws reach forward in the air; big back feet push off together.
    const reach = Math.sin(Math.PI * Math.min(1, phase / 0.75)) * gaitAmt;
    paws.forEach((paw, i) => {
      const pb = at(paw);
      const off = i === 0 ? 0 : 0.04;
      paw.position.set(pb.x, pb.y + lift * 0.85 + Math.max(0, reach - off) * 0.025, pb.z + (reach - off) * 0.05 * Math.min(1.4, 0.6 + speed * 0.2));
      paw.rotation.x = -reach * 0.5;
    });
    const push = phase < 0.3 ? Math.sin((Math.PI * phase) / 0.3) : 0;
    feet.forEach((foot) => {
      const fb = at(foot);
      foot.position.set(fb.x, fb.y + lift * 0.9 + push * 0.015 * gaitAmt, fb.z - push * 0.05 * gaitAmt + reach * 0.02);
      foot.rotation.x = push * 0.45 * gaitAmt;
    });

    // Tail: a little flick with each hop.
    tail.rotation.set(-air * 0.4 * gaitAmt, Math.sin(t * 3) * 0.08 * (1 - gaitAmt), 0);
  }

  return {
    object,
    update,
    get moving() {
      return speed > 0.12;
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
