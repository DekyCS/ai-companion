// The little train. It keeps the sim's timetable (TRAINS in src/world/village.ts, sent in each
// snapshot as `trains`): it rolls in along the rails from the north, slowing to a stop at the halt
// at each train time, waits a little, then puffs off south. Read-only: the page only draws it; the sim decides when Khina watches it and
// whether the traveller gets off (then the traveller turns up in the square through snap.present).
//
// Time: the visit is laid out in "train seconds" around the train time. At ordinary speeds (a
// Khina day in 24 minutes or slower) one train second is one real second, so the train moves at a
// believable pace; at fast debug speeds it is squeezed so a visit still fits in about an hour of
// game time.

import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

const DAY = 24 * 60;
const RAILS_X = 47;
const RAIL_TOP = 0.28;
const HALT_Y = -9; // layout y of the platform's middle
const NORTH = 70, SOUTH = -70; // where it appears and goes (layout y)
const IN = 20; // train seconds slowing from the north end to the halt
const WAIT = 12; // train seconds standing at the halt
const OUT = 20; // train seconds speeding up to the south end
/** The fastest it goes, as it enters or leaves (m per train second). */
const TOP = Math.max((2 * (NORTH - HALT_Y)) / IN, (2 * (HALT_Y - SOUTH)) / OUT);

export interface TrainView {
  /** Moves the train for game time `now` (minutes) at `speed` game minutes per real second. */
  update(now: number, speed: number, trains: readonly number[], dt: number, wind: number): void;
  /** Where the train's middle is (three.js) while it is out, for sound or the camera, else null. */
  readonly at: THREE.Vector3 | null;
  /** 0 standing, 1 at full speed (for a chuff, if wanted). */
  readonly pace: number;
}

/** Train seconds since this train time (negative before it), for the visit that is on now, if any. */
function visitClock(now: number, speed: number, trains: readonly number[]): number | null {
  const perMin = Math.max(1 / Math.max(speed, 1e-6), 0.6); // train seconds per game minute
  const day = Math.floor(now / DAY) * DAY;
  for (const d of [day - DAY, day, day + DAY])
    for (const tm of trains) {
      const tau = (now - (d + tm)) * perMin;
      if (tau >= -IN && tau <= WAIT + OUT) return tau;
    }
  return null;
}

/** Layout y of the train's middle at visit time tau, and how fast it is going (m per train second). */
function along(tau: number): { y: number; v: number } {
  if (tau < 0) {
    const k = -tau / IN; // 1 at the north end, 0 at the halt: steady braking
    return { y: HALT_Y + (NORTH - HALT_Y) * k * k, v: (2 * (NORTH - HALT_Y) * k) / IN };
  }
  if (tau < WAIT) return { y: HALT_Y, v: 0 };
  const k = (tau - WAIT) / OUT;
  return { y: HALT_Y - (HALT_Y - SOUTH) * k * k, v: (2 * (HALT_Y - SOUTH) * k) / OUT };
}

interface Puff { s: THREE.Sprite; age: number; spin: number; life: number }

export function createTrain(
  scene: THREE.Scene,
  gltf: GLTF,
  dot: THREE.Texture,
  /** Debug (?train=s): a train due s seconds after the page opened, whatever the timetable says. */
  debugIn: number | null,
): TrainView {
  const root = gltf.scene;
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  const axles: { o: THREE.Object3D; r: number }[] = [];
  let funnel: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (/^Train\.?Axle\.?\d+$/.test(o.name)) axles.push({ o, r: Math.max(0.1, o.position.y) });
    if (/^Train\.?Smoke$/.test(o.name)) funnel = o;
  });
  root.visible = false;
  scene.add(root);

  const t0 = performance.now();
  const puffs: Puff[] = [];
  const tip = new THREE.Vector3();
  let nextPuff = 0;
  let lastY: number | null = null;
  const view = { at: null as THREE.Vector3 | null, pace: 0 };

  function puff(at: THREE.Vector3, strong: boolean) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: '#f1ece4', transparent: true, opacity: 0, depthWrite: false }));
    s.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.15, 0, (Math.random() - 0.5) * 0.15));
    scene.add(s);
    puffs.push({ s, age: 0, spin: Math.random(), life: strong ? 3.2 : 4.5 });
  }

  function update(now: number, speed: number, trains: readonly number[], dt: number, wind: number) {
    const tau = debugIn !== null ? (performance.now() - t0) / 1000 - debugIn : visitClock(now, speed, trains);
    const out = tau !== null && tau >= -IN && tau <= WAIT + OUT;
    if (out) {
      const { y, v } = along(tau);
      root.visible = true;
      root.position.set(RAILS_X, RAIL_TOP, -y);
      // Wheels turn with the distance actually moved (it heads south, three.js +z).
      const moved = lastY === null ? 0 : Math.max(0, lastY - y);
      for (const a of axles) a.o.rotation.x += moved / a.r;
      lastY = y;
      view.at = root.position;
      view.pace = Math.min(1, v / TOP);
      // Smoke: quick chuffs while it moves, a lazy curl while it waits.
      nextPuff -= dt;
      if (funnel && nextPuff <= 0) {
        (funnel as THREE.Object3D).getWorldPosition(tip);
        puff(tip, view.pace > 0.05);
        nextPuff = view.pace > 0.05 ? 0.42 - 0.24 * view.pace : 0.9 + Math.random() * 0.4;
      }
    } else {
      root.visible = false;
      lastY = null;
      view.at = null;
      view.pace = 0;
    }
    for (const p of puffs) {
      p.age += dt;
      p.s.position.y += dt * (0.9 - p.age * 0.08);
      p.s.position.x += dt * 0.3 * wind;
      p.s.position.z += dt * 0.1 * Math.sin(p.age * 1.3 + p.spin * 6);
      p.s.scale.setScalar(0.45 + p.age * 0.6);
      (p.s.material as THREE.SpriteMaterial).opacity = Math.min(1, p.age * 3) * Math.max(0, 0.6 * (1 - p.age / p.life));
    }
    while (puffs.length && puffs[0]!.age > puffs[0]!.life) {
      const p = puffs.shift()!;
      scene.remove(p.s);
      p.s.material.dispose();
    }
  }

  return {
    update,
    get at() {
      return view.at;
    },
    get pace() {
      return view.pace;
    },
  };
}
