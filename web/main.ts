// The village in the browser. The sim runs on the server (src/live.ts) and streams snapshots;
// this page only draws: it walks Khina along the paths to each action's spot and animates him
// from his rigid parts (body, head, feet), with day and night, weather, lit windows and smoke.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CHIMNEYS, PATHS, SPOTS, nodes, placeXY, type Spot, type XY } from '../src/world/layout.ts';
import { PLACES, type PlaceId } from '../src/world/places.ts';

// ---------- what the server sends ----------
interface Activity {
  kind: 'walk' | 'act';
  actionId: string;
  place: PlaceId;
  startedAt: number;
  endsAt: number | null;
  label: string;
  doing: string;
  detail: string;
  reason: string;
  origin: string;
}
interface Snap {
  t: number;
  speed: number;
  brain: string;
  clock: string;
  day: number;
  weekday: string;
  part: string;
  dark: boolean;
  weather: 'clear' | 'cloudy' | 'drizzle' | 'rain' | 'fog';
  bakeryOpen: boolean;
  mood: number;
  energy: number;
  needs: Record<string, number>;
  place: PlaceId;
  activity: Activity | null;
  letters: number;
  diary: { t: number; clock: string; text: string; place: string }[];
}
type Pose = Spot['pose'];

/** Layout metres (x east, y north) to three.js (x east, z south, y up). */
const V = (xy: XY, y = 0) => new THREE.Vector3(xy[0], y, -xy[1]);
const damp = (a: number, b: number, rate: number, dt: number) => a + (b - a) * (1 - Math.exp(-rate * dt));

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const skyColor = new THREE.Color('#bfe0f5');
scene.background = skyColor;
scene.fog = new THREE.Fog(skyColor, 45, 170);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 500);
camera.position.set(6, 5, 9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 2.5;
controls.maxDistance = 90;

const hemi = new THREE.HemisphereLight(0xe8f4ff, 0x6f8f4f, 1.1);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -28;
sun.shadow.camera.right = sun.shadow.camera.top = 28;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 140;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(hemi, sun, sun.target);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- paths ----------
const NODE_XY = nodes();
const ADJ = new Map<string, string[]>();
for (const [a, b] of PATHS) {
  ADJ.set(a, [...(ADJ.get(a) ?? []), b]);
  ADJ.set(b, [...(ADJ.get(b) ?? []), a]);
}
const dist = (a: string, b: string) => Math.hypot(NODE_XY[a]![0] - NODE_XY[b]![0], NODE_XY[a]![1] - NODE_XY[b]![1]);

/** Shortest way along the paths, as node names. */
function route(from: string, to: string): string[] {
  const best = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([from]);
  while (open.size) {
    let cur = '';
    for (const n of open) if (!cur || best.get(n)! < best.get(cur)!) cur = n;
    open.delete(cur);
    if (cur === to) break;
    for (const nb of ADJ.get(cur) ?? []) {
      const d = best.get(cur)! + dist(cur, nb);
      if (d < (best.get(nb) ?? Infinity)) {
        best.set(nb, d);
        prev.set(nb, cur);
        open.add(nb);
      }
    }
  }
  const out = [to];
  while (out[0] !== from && prev.has(out[0]!)) out.unshift(prev.get(out[0]!)!);
  return out[0] === from ? out : [from, to];
}

// ---------- the village ----------
const loader = new GLTFLoader();
const [village, khinaGltf] = await Promise.all([loader.loadAsync('/art/export/village.glb'), loader.loadAsync('/art/export/khina.glb')]);
scene.add(village.scene);
const byName = (root: THREE.Object3D, name: string) => root.getObjectByName(name) ?? root.getObjectByName(name.replace(/\./g, ''));

village.scene.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  o.receiveShadow = true;
  o.castShadow = o.name !== 'Ground' && o.name !== 'Water';
});
const water = byName(village.scene, 'Water') as THREE.Mesh | undefined;
if (water) {
  const m = water.material as THREE.MeshStandardMaterial;
  m.transparent = true;
  m.opacity = 0.88;
  m.roughness = 0.12;
}

/** Windows and the lamp: each gets its own material so they light up separately. */
const glows: Record<string, { mat: THREE.MeshStandardMaterial; level: number }> = {};
for (const id of ['burrow', 'bakery', 'lamp']) {
  const mesh = byName(village.scene, `Glow.${id}`) as THREE.Mesh | undefined;
  if (!mesh) continue;
  const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
  mat.emissive = new THREE.Color('#ffc46b');
  mesh.material = mat;
  mesh.castShadow = false;
  glows[id] = { mat, level: 0 };
}
const GLASS_OFF = new THREE.Color('#4a5560');
const GLASS_ON = new THREE.Color('#ffd27a');
const flag = byName(village.scene, 'Flag.letterbox');

// ---------- Khina ----------
const pet = new THREE.Group();
pet.add(khinaGltf.scene);
scene.add(pet);
khinaGltf.scene.traverse((o) => {
  if (o instanceof THREE.Mesh) {
    o.castShadow = true;
    o.receiveShadow = true;
  }
});
const body = byName(khinaGltf.scene, 'BodyPivot')!;
const head = byName(khinaGltf.scene, 'HeadPivot')!;
const feet = ['Foot.FL', 'Foot.FR', 'Foot.BL', 'Foot.BR'].map((n) => byName(khinaGltf.scene, n)!);
const feetBase = feet.map((f) => f.position.clone());
const bodyBase = body.position.clone();
const FOOT_PHASE = [0, Math.PI, Math.PI, 0];

// ---------- smoke and rain ----------
interface Puff { mesh: THREE.Mesh; age: number }
const puffGeo = new THREE.IcosahedronGeometry(0.28, 1);
function chimney(at: [number, number, number]) {
  const origin = V([at[0], at[1]], at[2]);
  const puffs: Puff[] = [];
  let next = 0;
  return {
    update(active: boolean, dt: number) {
      next -= dt;
      if (active && next <= 0) {
        next = 0.7;
        const mesh = new THREE.Mesh(puffGeo, new THREE.MeshLambertMaterial({ color: '#d9d4cc', transparent: true, opacity: 0.7, depthWrite: false }));
        mesh.position.copy(origin);
        scene.add(mesh);
        puffs.push({ mesh, age: 0 });
      }
      for (const p of puffs) {
        p.age += dt;
        p.mesh.position.y += dt * 0.55;
        p.mesh.position.x += dt * 0.25;
        p.mesh.scale.setScalar(1 + p.age * 0.45);
        (p.mesh.material as THREE.MeshLambertMaterial).opacity = Math.max(0, 0.7 * (1 - p.age / 5));
      }
      while (puffs.length && puffs[0]!.age > 5) {
        const p = puffs.shift()!;
        scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
      }
    },
  };
}
const smoke = { burrow: chimney(CHIMNEYS.burrow!), bakery: chimney(CHIMNEYS.bakery!) };

const RAIN_N = 1800;
const rainPos = new Float32Array(RAIN_N * 6);
for (let i = 0; i < RAIN_N; i++) {
  const x = (Math.random() - 0.5) * 50;
  const y = Math.random() * 22;
  const z = (Math.random() - 0.5) * 50;
  rainPos.set([x, y, z, x + 0.03, y + 0.45, z], i * 6);
}
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#c9d6e3', transparent: true, opacity: 0.55 }));
rain.frustumCulled = false;
scene.add(rain);

// ---------- following the sim ----------
let snap: Snap | null = null;
let clockT = 0;
let clockAt = 0;
interface Plan { key: string; pts: THREE.Vector3[]; cum: number[]; start: number; end: number }
let plan: Plan | null = null;
let placed = false;

/** The game clock, moving smoothly between the server's once-a-second ticks. */
function gameNow(): number {
  if (!snap) return 0;
  const ahead = ((performance.now() - clockAt) / 1000) * snap.speed;
  return clockT + Math.min(ahead, Math.max(1.5, snap.speed * 1.5));
}

function spotOf(a: Activity | null): Spot | null {
  return a ? (SPOTS[a.actionId] ?? null) : null;
}

function endPoint(a: Activity): THREE.Vector3 {
  const spot = spotOf(a);
  return spot ? V(spot.at, spot.z ?? 0) : V(NODE_XY[a.place]!);
}

function makePlan(from: PlaceId, a: Activity): Plan {
  const start = placed ? pet.position.clone() : V(NODE_XY[from]!);
  const raw = [start, ...route(from, a.place).map((n) => V(NODE_XY[n]!)), endPoint(a)];
  const pts = raw.filter((p, i) => i === 0 || p.distanceTo(raw[i - 1]!) > 0.05);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
  return { key: `${a.startedAt}:${a.actionId}`, pts, cum, start: a.startedAt, end: a.endsAt ?? a.startedAt + 1 };
}

function along(p: Plan, frac: number): { pos: THREE.Vector3; dir: THREE.Vector3 } {
  const total = p.cum[p.cum.length - 1]!;
  const d = Math.min(total, Math.max(0, frac) * total);
  let i = 1;
  while (i < p.cum.length - 1 && p.cum[i]! < d) i++;
  const a = p.pts[i - 1]!;
  const b = p.pts[i] ?? a;
  const seg = Math.max(1e-6, p.cum[i]! - p.cum[i - 1]!);
  const pos = a.clone().lerp(b, Math.min(1, (d - p.cum[i - 1]!) / seg));
  return { pos, dir: b.clone().sub(a).setY(0).normalize() };
}

function onSnap(next: Snap) {
  snap = next;
  clockT = next.t;
  clockAt = performance.now();
  const a = next.activity;
  if (a?.kind === 'walk') {
    const key = `${a.startedAt}:${a.actionId}`;
    if (plan?.key !== key) plan = makePlan(next.place, a);
  } else {
    plan = null;
  }
  if (!placed) {
    const spot = spotOf(a);
    pet.position.copy(a && a.kind === 'act' && spot ? V(spot.at, spot.z ?? 0) : V(placeXY(next.place)));
    placed = true;
  }
  hud(next);
  document.getElementById('status')!.textContent = '';
  for (const id of ['now', 'diary', 'tools']) document.getElementById(id)!.hidden = false;
}

const events = new EventSource('/events');
events.addEventListener('snap', (e) => onSnap(JSON.parse((e as MessageEvent).data).snap));
events.addEventListener('clock', (e) => {
  clockT = JSON.parse((e as MessageEvent).data).t;
  clockAt = performance.now();
});
events.onerror = () => {
  document.getElementById('status')!.textContent = 'Lost the village. Reconnecting…';
};

// ---------- HUD ----------
const NEED_LABELS: [string, string][] = [
  ['fullness', 'Belly'],
  ['rest', 'Rest'],
  ['calm', 'Calm'],
  ['company', 'Company'],
  ['novelty', 'Something new'],
  ['making', 'Making'],
];
const WEATHER: Record<Snap['weather'], string> = { clear: 'clear', cloudy: 'grey', drizzle: 'drizzle', rain: 'rain', fog: 'fog' };
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function hud(s: Snap) {
  document.getElementById('when')!.textContent = `Day ${s.day} · ${s.weekday} ${s.part} · ${s.clock} · ${WEATHER[s.weather]}`;
  const a = s.activity;
  let doing = 'Deciding what to do';
  if (a?.kind === 'walk') doing = `On the way to ${PLACES[a.place].short}, to ${a.label}`;
  else if (a) doing = capital(a.doing) + (a.detail ? ` (${a.detail})` : '');
  document.getElementById('doing')!.textContent = doing;
  document.getElementById('why')!.textContent = a?.reason ? `“${a.reason}”` : '';
  const needs = document.getElementById('needs')!;
  needs.replaceChildren();
  const row = (label: string, value: number, cls = '') => {
    const name = document.createElement('span');
    name.textContent = label;
    const bar = document.createElement('div');
    bar.className = `bar ${cls}`;
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    bar.append(fill);
    needs.append(name, bar);
  };
  row('Mood', s.mood, 'mood');
  for (const [k, label] of NEED_LABELS) row(label, s.needs[k] ?? 0);
  const lines = document.getElementById('lines')!;
  lines.replaceChildren(
    ...s.diary
      .slice(-5)
      .reverse()
      .map((d) => {
        const p = document.createElement('p');
        const time = document.createElement('time');
        time.textContent = d.clock;
        p.append(time, d.text);
        return p;
      }),
  );
  const pace = s.speed === 1 ? '1 game minute a second' : s.speed < 0.02 ? 'real time' : `${s.speed} game minutes a second`;
  document.getElementById('brain')!.textContent = `Brain: ${s.brain} · ${pace}`;
}

let follow = true;
const followBtn = document.getElementById('follow')!;
followBtn.addEventListener('click', () => {
  follow = !follow;
  followBtn.setAttribute('aria-pressed', String(follow));
});

// ---------- sky ----------
const SKY: [number, string][] = [
  [0, '#101833'], [4.5, '#16224a'], [5.5, '#5b5a8a'], [6.4, '#f0b08c'], [7.4, '#bfe0f5'],
  [17.6, '#bfe0f5'], [19.3, '#f2a273'], [20.3, '#4a4f86'], [21.3, '#16224a'], [24, '#101833'],
];
const tmpA = new THREE.Color();
const tmpB = new THREE.Color();
function skyAt(hour: number, out: THREE.Color) {
  for (let i = 1; i < SKY.length; i++) {
    const [h1, c1] = SKY[i]!;
    const [h0, c0] = SKY[i - 1]!;
    if (hour <= h1) return out.copy(tmpA.set(c0)).lerp(tmpB.set(c1), (hour - h0) / (h1 - h0));
  }
  return out.set(SKY[0]![1]);
}
const LIGHT: Record<Snap['weather'], number> = { clear: 1, cloudy: 0.6, fog: 0.6, drizzle: 0.5, rain: 0.38 };
const GREY = new THREE.Color('#9aa5ad');

function lighting(t: number, focus: THREE.Vector3) {
  const hour = (((t % 1440) + 1440) % 1440) / 60;
  const w = snap?.weather ?? 'clear';
  const a = (Math.PI * (hour - 6)) / 14;
  const el = hour > 6 && hour < 20 ? Math.sin(a) : 0;
  const day = THREE.MathUtils.smoothstep(el, 0, 0.25);
  skyAt(hour, skyColor).lerp(GREY, (1 - LIGHT[w]) * 0.7 * day);
  const fog = scene.fog as THREE.Fog;
  fog.color.copy(skyColor);
  fog.near = w === 'fog' ? 6 : 45;
  fog.far = w === 'fog' ? 60 : 170;
  const dir = day > 0 ? new THREE.Vector3(Math.cos(a), Math.max(0.15, Math.sin(a)), 0.45).normalize() : new THREE.Vector3(-0.3, 0.8, 0.35).normalize();
  sun.position.copy(focus).addScaledVector(dir, 60);
  sun.target.position.copy(focus);
  sun.intensity = day > 0 ? 2.5 * day * LIGHT[w] : 0.35;
  sun.color.set(day > 0 ? '#fff1d6' : '#9fb4ff');
  hemi.intensity = 0.35 + 0.85 * day * (0.6 + 0.4 * LIGHT[w]);
  hemi.color.set(day > 0.3 ? '#e8f4ff' : '#7f8fc7');
}

// ---------- animation ----------
// For checking poses by eye: ?pose=curl (or walk, sniff, work, eat, sit, paddle, stand) and ?dist=3.
const params = new URLSearchParams(location.search);
const forcedPose = params.get('pose');
const startDist = Number(params.get('dist')) || 0;
if (startDist) camera.position.set(startDist * 0.45, startDist * 0.35, startDist * 0.82);
let gait = 0;
let inside = false;
let shown = 1;
const cur = { bodyY: 0, bodyPitch: 0, bodyRoll: 0, headPitch: 0, headYaw: 0, sink: 0, feet: 1 };

function frame(dtMs: number) {
  const dt = Math.min(0.1, dtMs / 1000);
  const tau = performance.now() / 1000;
  const now = gameNow();
  const a = snap?.activity ?? null;
  const spot = spotOf(a);

  // Where Khina should be, and whether he is on the move.
  let moving = false;
  let speedMs = 0;
  let faceDir: THREE.Vector3 | null = null;
  let pose: Pose = 'stand';
  let wantInside = false;
  if (plan) {
    const frac = (now - plan.start) / Math.max(1e-6, plan.end - plan.start);
    const { pos, dir } = along(plan, frac);
    const step = pos.distanceTo(pet.position);
    speedMs = step / Math.max(dt, 1e-3);
    moving = frac < 1 && step > 1e-4;
    pet.position.copy(pos);
    if (dir.lengthSq() > 0) faceDir = dir;
  } else if (a && placed) {
    const target = spot ? V(spot.at, spot.z ?? 0) : pet.position.clone();
    const gap = target.clone().sub(pet.position);
    if (gap.length() > 0.08) {
      // Shuffle over to the spot for the next thing at the same place (or catch up, if a fast
      // clock ended the walk between frames: the further behind, the faster).
      speedMs = Math.max(1.4, gap.length() * 2.5);
      const step = Math.min(gap.length(), speedMs * dt);
      pet.position.addScaledVector(gap.normalize(), step);
      moving = true;
      faceDir = gap.clone().setY(0).normalize();
    } else {
      pose = spot?.pose ?? (a.actionId === 'idle' ? 'sit' : 'stand');
      wantInside = !!spot?.inside;
      if (spot) faceDir = V(spot.face).sub(V(spot.at)).normalize();
    }
  }
  if (forcedPose) {
    moving = forcedPose === 'walk';
    speedMs = moving ? 1.2 : 0;
    pose = (moving ? 'stand' : forcedPose) as Pose;
    wantInside = false;
    faceDir = new THREE.Vector3(1, 0, 0.4).normalize();
  }
  inside = wantInside;
  shown = damp(shown, inside ? 0 : 1, 8, dt);
  pet.visible = shown > 0.02;
  pet.scale.setScalar(0.4 + 0.6 * shown);
  if (faceDir) {
    const want = Math.atan2(faceDir.x, faceDir.z);
    let d = want - pet.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    pet.rotation.y += d * (1 - Math.exp(-(moving ? 10 : 4) * dt));
  }

  // Pose targets.
  const T = { bodyY: 0, bodyPitch: 0, bodyRoll: 0, headPitch: 0, headYaw: 0, sink: 0, feet: 1 };
  let breathe = 0.012;
  if (moving) {
    gait += dt * Math.PI * Math.min(4, Math.max(1.5, speedMs / 0.3));
    T.bodyRoll = 0.08 * Math.sin(gait);
    T.bodyY = 0.03 * Math.abs(Math.sin(gait));
    T.headPitch = 0.05 * Math.sin(2 * gait);
    breathe = 0;
  } else {
    switch (pose) {
      case 'stand':
        T.headPitch = 0.05 * Math.sin(tau * 0.5);
        T.headYaw = 0.45 * Math.sin(tau * 0.31) * Math.sin(tau * 0.13);
        break;
      case 'sit':
        T.bodyY = -0.04;
        T.bodyPitch = -0.08;
        T.headPitch = -0.15 + 0.05 * Math.sin(tau * 0.7);
        T.headYaw = 0.5 * Math.sin(tau * 0.2);
        break;
      case 'sniff':
        T.bodyPitch = 0.08;
        T.headPitch = 0.35 + (Math.sin(tau * 0.9) > 0 ? 0.07 * Math.sin(tau * 16) : 0);
        T.headYaw = 0.35 * Math.sin(tau * 0.7);
        break;
      case 'work':
        T.bodyPitch = 0.1;
        T.headPitch = 0.38 + 0.06 * Math.sin(tau * 5.5);
        T.headYaw = 0.18 * Math.sin(tau * 1.1);
        break;
      case 'eat':
        T.headPitch = 0.3 + 0.14 * Math.max(0, Math.sin(tau * 6));
        T.headYaw = 0.1 * Math.sin(tau * 0.9);
        break;
      case 'curl':
        T.bodyPitch = 0.75;
        T.headPitch = 1.25;
        T.bodyY = -0.1;
        T.sink = 0.06;
        T.feet = 0;
        breathe = 0.03 * Math.sin(tau * 1.2);
        break;
      case 'paddle':
        T.sink = 0.16;
        T.headPitch = -0.1;
        T.headYaw = 0.3 * Math.sin(tau * 0.5);
        break;
    }
  }
  for (const k of Object.keys(T) as (keyof typeof T)[]) cur[k] = damp(cur[k], T[k], 7, dt);
  body.position.set(bodyBase.x, bodyBase.y + cur.bodyY, bodyBase.z);
  body.rotation.set(cur.bodyPitch, 0, cur.bodyRoll);
  body.scale.set(1, 1 + (pose === 'curl' ? breathe : breathe * Math.sin(tau * 2.2)), 1);
  head.rotation.set(cur.headPitch, cur.headYaw, 0);
  khinaGltf.scene.position.y = -cur.sink;
  feet.forEach((f, i) => {
    const base = feetBase[i]!;
    const ph = gait + FOOT_PHASE[i]!;
    const paddling = !moving && pose === 'paddle';
    const swing = moving ? Math.sin(ph) * 0.1 : paddling ? Math.sin(tau * 9 + FOOT_PHASE[i]!) * 0.06 : 0;
    const lift = moving ? Math.max(0, Math.cos(ph)) * 0.06 : 0;
    f.position.set(base.x, base.y + lift, base.z + swing);
    f.scale.setScalar(Math.max(0.001, cur.feet));
  });

  // The world around him.
  const s = snap;
  if (s) {
    const home = s.place === 'burrow' && a?.kind !== 'walk';
    const asleep = a?.actionId === 'sleep' && a.kind === 'act';
    const wet = s.weather === 'rain' || s.weather === 'drizzle';
    const md = ((now % 1440) + 1440) % 1440;
    const want: Record<string, number> = {
      burrow: home ? (asleep ? 0.35 : s.dark || wet ? 2.2 : 0.7) : 0,
      bakery: s.bakeryOpen ? (s.dark || s.weather !== 'clear' ? 2.2 : 0.9) : 0,
      lamp: s.dark ? 2.6 : 0,
    };
    for (const [id, g] of Object.entries(glows)) {
      g.level = damp(g.level, want[id] ?? 0, 3, dt);
      g.mat.emissiveIntensity = g.level;
      g.mat.color.copy(GLASS_OFF).lerp(GLASS_ON, Math.min(1, g.level / 1.2));
    }
    smoke.bakery.update(s.bakeryOpen, dt);
    smoke.burrow.update(home && !asleep && (md < 9 * 60 || md > 17 * 60 || wet), dt);
    if (flag) flag.rotation.x = damp(flag.rotation.x, s.letters > 0 ? 0 : -Math.PI / 2, 4, dt);
    rain.visible = wet;
    if (wet) {
      const fall = dt * 16;
      const arr = rainGeo.attributes.position!.array as Float32Array;
      for (let i = 0; i < RAIN_N; i++) {
        let y = arr[i * 6 + 1]! - fall;
        if (y < 0) y += 22;
        arr[i * 6 + 1] = y;
        arr[i * 6 + 4] = y + 0.45;
      }
      rainGeo.attributes.position!.needsUpdate = true;
      rainGeo.setDrawRange(0, (s.weather === 'rain' ? RAIN_N : RAIN_N * 0.35) * 2);
      rain.position.set(controls.target.x, 0, controls.target.z);
    }
  }

  // Camera: keep the viewer's angle, slide along with Khina.
  if (follow && placed) {
    const goal = pet.position.clone().add(new THREE.Vector3(0, inside ? 1.2 : 0.5, 0));
    const step = goal.sub(controls.target).multiplyScalar(1 - Math.exp(-3 * dt));
    controls.target.add(step);
    camera.position.add(step);
  }
  lighting(now, controls.target);
  controls.update();
  renderer.render(scene, camera);
}

let last = performance.now();
renderer.setAnimationLoop(() => {
  const t = performance.now();
  frame(t - last);
  last = t;
});
