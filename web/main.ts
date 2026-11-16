// The village in the browser. The sim runs on the server (src/live.ts) and streams snapshots;
// this page draws: it walks Khina along the paths to each action's spot and animates Khina from
// rigid parts (body, head, feet), with day and night, weather, lit windows and smoke.
// You can walk around too, as a little felt bunny: WASD or arrows, Shift runs, Space hops.
//
// Debug: ?hour=19.5 fixes the light, ?weather=rain, ?pose=curl (walk, sniff, work, eat, sit,
// paddle, stand) with ?dist=3, ?cam=x,y,z,tx,ty,tz (three.js), ?play starts as the bunny,
// ?lite drops ambient occlusion and thins the grass for slow machines.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CHIMNEYS, PATHS, SPOTS, nodes, placeXY, type Spot, type XY } from '../src/world/layout.ts';
import { PLACES, type PlaceId } from '../src/world/places.ts';
import { loadTerrain } from './terrain.ts';
import { createLook, type Weather } from './look.ts';
import { createGrass, windify } from './grass.ts';
import { addFuzz } from './fuzz.ts';
import { createPlayer, type Player } from './player.ts';
import { createHud, type DiaryLine, type PieceRef, type Reading } from './hud.ts';

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
  weather: Weather;
  bakeryOpen: boolean;
  mood: number;
  energy: number;
  needs: Record<string, number>;
  place: PlaceId;
  activity: Activity | null;
  letters: number;
  diary: DiaryLine[];
  pieces?: PieceRef[];
  readings?: Reading[];
  pages?: { day: number; text: string }[];
  moodArc?: { t: number; mood: number }[];
}
type Pose = Spot['pose'];

/** Layout metres (x east, y north) to three.js (x east, z south, y up). */
const V = (xy: XY, y = 0) => new THREE.Vector3(xy[0], y, -xy[1]);
const damp = (a: number, b: number, rate: number, dt: number) => a + (b - a) * (1 - Math.exp(-rate * dt));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const params = new URLSearchParams(location.search);
const lite = params.has('lite');
const forcedHour = params.has('hour') ? Number(params.get('hour')) : null;
const forcedWeather = params.get('weather') as Weather | null;

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, lite ? 1 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(6, 4.5, 9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 1.6;
controls.maxDistance = 90;

const look = createLook(renderer, scene, camera, { ao: !lite && params.get('ao') !== '0', quality: lite ? 0 : 1 });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  look.resize();
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

// ---------- loading ----------
const loader = new GLTFLoader();
const [terrain, village, khinaGltf, visitorGltf] = await Promise.all([
  loadTerrain(),
  loader.loadAsync('/art/export/village.glb'),
  loader.loadAsync('/art/export/khina.glb'),
  loader.loadAsync('/art/export/visitor.glb').catch(() => null),
]);
const byName = (root: THREE.Object3D, name: string) => root.getObjectByName(name) ?? root.getObjectByName(name.replace(/\./g, ''));
const groundY = (p: THREE.Vector3) => terrain.heightAt(p.x, -p.z);

// ---------- the village ----------
scene.add(village.scene);
const windUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };
const waterUniforms = { uTime: { value: 0 } };
village.scene.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  const mat = o.material as THREE.MeshStandardMaterial;
  o.receiveShadow = true;
  o.castShadow = !/^(Ground|Water)/.test(o.name) && !mat.name.startsWith('Water');
  if (mat.name === 'Foliage' && !mat.userData.windy) {
    mat.userData.windy = true;
    windify(mat, windUniforms, { amount: 0.09, heightFrom: 1.5, heightTo: 9 });
  }
  if (mat.name.startsWith('Water') && !mat.userData.water) {
    mat.userData.water = true;
    o.castShadow = false;
    mat.transparent = true;
    mat.opacity = 0.84;
    mat.roughness = 0.05;
    mat.metalness = 0;
    mat.color.set('#3d8aa8');
    mat.envMapIntensity = 1.3;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, waterUniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWPos;').replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec2 grad = vec2(0.0);
          for (int i = 0; i < 5; i++) {
            float fi = float(i);
            vec2 dir = vec2(cos(fi * 2.399 + 0.4), sin(fi * 2.399 + 0.4));
            float fr = 1.4 + fi * 1.15;
            float ph = dot(dir, vWPos.xz) * fr + uTime * (1.1 + fi * 0.35);
            grad += dir * cos(ph) * 0.07 / (1.0 + fi * 0.6);
          }
          vec3 nW = normalize(vec3(-grad.x, 1.0, -grad.y));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`,
      );
    };
  }
});

/** Windows and the lamp: each gets its own material so they light up separately. */
const glows: Record<string, { mat: THREE.MeshStandardMaterial; level: number; light: THREE.PointLight }> = {};
for (const id of ['burrow', 'bakery', 'lamp']) {
  const mesh = byName(village.scene, `Glow.${id}`) as THREE.Mesh | undefined;
  if (!mesh) continue;
  const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
  mat.emissive = new THREE.Color('#ffb85c');
  mesh.material = mat;
  mesh.castShadow = false;
  // A little warm light spilling out, so lit windows warm what is near them.
  const light = new THREE.PointLight('#ffb062', 0, 9, 1.6);
  mesh.geometry.computeBoundingBox();
  mesh.geometry.boundingBox!.getCenter(light.position);
  mesh.localToWorld(light.position);
  light.position.y = Math.max(light.position.y - 0.2, 0.4);
  scene.add(light);
  glows[id] = { mat, level: 0, light };
}
// A window pane facing the path: push its light a little outward, toward the viewer's side.
if (glows.burrow) glows.burrow.light.position.z += 0.6;
if (glows.bakery) glows.bakery.light.position.z += 0.8;
const GLASS_OFF = new THREE.Color('#3c4650');
const GLASS_ON = new THREE.Color('#ffd27a');
const flag = byName(village.scene, 'Flag.letterbox');

const grass = createGrass(scene, terrain, { density: lite ? 34 : 60 });

// ---------- Khina ----------
const pet = new THREE.Group();
pet.add(khinaGltf.scene);
scene.add(pet);
khinaGltf.scene.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  o.castShadow = true;
  o.receiveShadow = true;
  const mat = o.material as THREE.MeshStandardMaterial;
  if (mat.name === 'Spines') mat.roughness = 0.5;
  if (mat.name === 'Eye') {
    mat.roughness = 0.04;
    mat.envMapIntensity = 2.2;
  }
  if (mat.name === 'Shine' || mat.name === 'Mouth' || mat.name === 'Eye') o.castShadow = false;
});
addFuzz(khinaGltf.scene, { layers: lite ? 12 : 20 });
const body = byName(khinaGltf.scene, 'BodyPivot')!;
const head = byName(khinaGltf.scene, 'HeadPivot')!;
const feet = ['Foot.FL', 'Foot.FR', 'Foot.BL', 'Foot.BR'].map((n) => byName(khinaGltf.scene, n)!);
const feetBase = feet.map((f) => f.position.clone());
const bodyBase = body.position.clone();
const FOOT_PHASE = [0, Math.PI, Math.PI, 0];
/** Khina's walking pace in metres a second, when the clock is slow enough to allow it. */
const WADDLE = 0.75;

// ---------- you ----------
let player: Player | null = null;
if (visitorGltf) {
  player = createPlayer(visitorGltf.scene, terrain);
  addFuzz(visitorGltf.scene, { layers: lite ? 10 : 16 });
  visitorGltf.scene.traverse((o) => {
    if (o instanceof THREE.Mesh && (o.material as THREE.Material).name === 'Eye') (o.material as THREE.MeshStandardMaterial).envMapIntensity = 2.2;
  });
  const at = (params.get('at') ?? '3.5,-2.5').split(',').map(Number);
  player.placeAt(at[0] ?? 3.5, at[1] ?? -2.5);
  scene.add(player.object);
}
type Mode = 'khina' | 'player';
let mode: Mode = params.has('play') && player ? 'player' : 'khina';

// ---------- smoke, rain, fireflies ----------
function softDot(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const DOT = softDot();

interface Puff { s: THREE.Sprite; age: number; spin: number }
function chimney(at: [number, number, number]) {
  const origin = V([at[0], at[1]], at[2]);
  const puffs: Puff[] = [];
  let next = 0;
  return {
    update(active: boolean, dt: number, wind: number) {
      next -= dt;
      if (active && next <= 0) {
        next = 0.45 + Math.random() * 0.3;
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color: '#e9e4dc', transparent: true, opacity: 0, depthWrite: false }));
        s.position.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2));
        scene.add(s);
        puffs.push({ s, age: 0, spin: Math.random() });
      }
      for (const p of puffs) {
        p.age += dt;
        p.s.position.y += dt * (0.7 - p.age * 0.05);
        p.s.position.x += dt * 0.35 * wind;
        p.s.position.z += dt * 0.12 * Math.sin(p.age + p.spin * 6);
        p.s.scale.setScalar(0.5 + p.age * 0.55);
        (p.s.material as THREE.SpriteMaterial).opacity = Math.min(1, p.age * 2) * Math.max(0, 0.55 * (1 - p.age / 6));
      }
      while (puffs.length && puffs[0]!.age > 6) {
        const p = puffs.shift()!;
        scene.remove(p.s);
        p.s.material.dispose();
      }
    },
  };
}
const smoke = { burrow: chimney(CHIMNEYS.burrow!), bakery: chimney(CHIMNEYS.bakery!) };

const RAIN_N = 2400;
const rainPos = new Float32Array(RAIN_N * 6);
for (let i = 0; i < RAIN_N; i++) {
  const x = (Math.random() - 0.5) * 44;
  const y = Math.random() * 20;
  const z = (Math.random() - 0.5) * 44;
  rainPos.set([x, y, z, x + 0.04, y + 0.5, z], i * 6);
}
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#dbe6f0', transparent: true, opacity: 0.35 }));
rain.frustumCulled = false;
scene.add(rain);

const FLY_N = 70;
const flyBase: THREE.Vector3[] = [];
for (let i = 0; i < FLY_N; i++) {
  // Over the meadows near the stream and the woods' edge.
  const near = i % 2 ? [-12 + Math.random() * 30, -20 + Math.random() * 9] : [-22 + Math.random() * 18, 8 + Math.random() * 16];
  flyBase.push(new THREE.Vector3(near[0], 0.4 + Math.random() * 1.6, -near[1]!));
}
const flyGeo = new THREE.BufferGeometry();
flyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FLY_N * 3), 3));
const flyMat = new THREE.PointsMaterial({ map: DOT, color: new THREE.Color(3.2, 2.6, 0.9), size: 0.22, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
const flies = new THREE.Points(flyGeo, flyMat);
flies.frustumCulled = false;
scene.add(flies);

// ---------- HUD ----------
// ?mock fills the HUD with made-up pieces and readings, to check it without the model.
const mock = params.has('mock') ? await import('./mock.ts') : null;
const hud = createHud({ canWalk: !!player, onMode: (m) => setMode(m) });
if (mock) {
  hud.setSource(mock.mockSource(0));
  setTimeout(() => {
    const p = snap ? mock.mockSnap(snap).pieces?.[0] : undefined;
    if (p) hud.piece(p);
  }, 4000);
}

function setMode(next: Mode) {
  mode = next;
  hud.setMode(mode);
  if (mode === 'player' && player) {
    player.takeControl();
    // Come in close behind the bunny if the camera is far away.
    const d = camera.position.distanceTo(controls.target);
    if (d > 12) {
      const back = camera.position.clone().sub(controls.target).setLength(8);
      controls.target.copy(player.object.position).add(new THREE.Vector3(0, 0.6, 0));
      camera.position.copy(controls.target).add(back);
    }
  }
  renderer.domElement.focus();
}
setMode(mode);

// ---------- following the sim ----------
let snap: Snap | null = null;
let clockT = 0;
let clockAt = 0;
interface Plan { key: string; pts: THREE.Vector3[]; cum: number[]; start: number; end: number }
let plan: Plan | null = null;
let placed = false;

/** The game clock, moving smoothly between the server's once-a-second ticks. */
function gameNow(): number {
  if (!snap) return 12 * 60;
  const ahead = ((performance.now() - clockAt) / 1000) * snap.speed;
  return clockT + Math.min(ahead, Math.max(1.5, snap.speed * 1.5));
}

/** For things without a spot of their own (making something, Khina's own ideas): a good spot at that place. */
const PLACE_SPOT: Partial<Record<PlaceId, string>> = {
  burrow: 'tidy', shed: 'draw', bakery: 'crusts', square: 'chat', patch: 'weed', stream: 'fish',
  woods: 'forage', clearing: 'poke', halt: 'timetable', nethut: 'nethut_idle',
};
const KIND_POSE: Record<string, Pose> = { making: 'work', home: 'work', rest: 'sit', nature: 'sit', exploring: 'sniff', social: 'stand' };

function spotOf(a: Activity | null): Spot | null {
  if (!a) return null;
  const own = SPOTS[a.actionId];
  if (own) return own;
  const kind = a.actionId === 'make' ? 'making' : a.actionId.startsWith('own.') ? a.actionId.slice(4) : null;
  if (!kind) return null;
  const pose = KIND_POSE[kind] ?? 'stand';
  const base = SPOTS[`${a.place}_idle`] ?? SPOTS[PLACE_SPOT[a.place] ?? ''];
  if (base) return base.inside ? base : { ...base, pose };
  const at = NODE_XY[a.place]!;
  const centre = placeXY(a.place);
  const face: XY = Math.hypot(centre[0] - at[0], centre[1] - at[1]) > 0.5 ? centre : [at[0], at[1] + 1];
  return { at, face, pose };
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
    if (mode === 'khina') {
      // Start the camera near Khina, at a friendly angle.
      controls.target.copy(pet.position).add(new THREE.Vector3(0, 0.5, 0));
      camera.position.copy(controls.target).add(new THREE.Vector3(3.2, 2.2, 5.6));
    }
  }
  hud.update(mock ? mock.mockSnap(next) : next);
  document.getElementById('status')!.textContent = '';
  if (!params.has('clean')) hud.show();
}

const events = new EventSource('/events');
events.addEventListener('snap', (e) => onSnap(JSON.parse((e as MessageEvent).data).snap));
events.addEventListener('piece', (e) => hud.piece(JSON.parse((e as MessageEvent).data).piece));
events.addEventListener('reading', (e) => hud.reading(JSON.parse((e as MessageEvent).data).reading));
events.addEventListener('clock', (e) => {
  clockT = JSON.parse((e as MessageEvent).data).t;
  clockAt = performance.now();
});
events.onerror = () => {
  document.getElementById('status')!.textContent = 'Lost the village. Reconnecting…';
};


// ---------- animation ----------
const forcedPose = params.get('pose');
const startDist = Number(params.get('dist')) || 0;
const camParam = params.get('cam')?.split(',').map(Number);
let gait = 0;
let inside = false;
let shown = 1;
const cur = { bodyY: 0, bodyPitch: 0, bodyRoll: 0, headPitch: 0, headYaw: 0, sink: 0, feet: 1 };
// Small things Khina does now and then during a long activity, so a real-time hour isn't a still life.
type Fidget = { kind: 'look' | 'sniff' | 'turn'; until: number; dir: number };
let fidget: Fidget | null = null;
let nextFidget = 6;
let turnOffset = 0;

function frame(dtMs: number) {
  const dt = Math.min(0.1, dtMs / 1000);
  const tau = performance.now() / 1000;
  const now = gameNow();
  const a = snap?.activity ?? null;
  const spot = spotOf(a);

  // Where Khina should be, and whether Khina is on the move.
  let moving = false;
  let speedMs = 0;
  let faceDir: THREE.Vector3 | null = null;
  let pose: Pose = 'stand';
  let wantInside = false;
  let atSpot = false;
  if (plan) {
    // Walk at least at a hedgehog's natural pace. On a slow clock (real time) the sim's walk lasts
    // minutes, so Khina gets there early and starts on the thing; on a fast clock the sim's own
    // timing is quicker and wins.
    const total = plan.cum[plan.cum.length - 1]!;
    const gameFrac = (now - plan.start) / Math.max(1e-6, plan.end - plan.start);
    const realSec = (now - plan.start) / Math.max(1e-6, snap?.speed ?? 1);
    const frac = total > 0 ? Math.max(gameFrac, Math.min(1, (WADDLE * realSec) / total)) : 1;
    const { pos, dir } = along(plan, frac);
    const step = Math.hypot(pos.x - pet.position.x, pos.z - pet.position.z);
    speedMs = step / Math.max(dt, 1e-3);
    moving = frac < 1 && step > 1e-4;
    pet.position.x = pos.x;
    pet.position.z = pos.z;
    if (dir.lengthSq() > 0) faceDir = dir;
    if (frac >= 1 && spot) {
      atSpot = true;
      pose = spot.pose;
      wantInside = !!spot.inside;
      faceDir = V(spot.face).sub(V(spot.at)).normalize();
    }
  } else if (a && placed) {
    const target = spot ? V(spot.at, spot.z ?? 0) : pet.position.clone();
    const gap = target.clone().sub(pet.position).setY(0);
    if (gap.length() > 0.08) {
      // Shuffle over to the spot for the next thing at the same place (or catch up, if a fast
      // clock ended the walk between frames: the further behind, the faster).
      speedMs = Math.max(1.4, gap.length() * 2.5);
      const step = Math.min(gap.length(), speedMs * dt);
      pet.position.addScaledVector(gap.normalize(), step);
      moving = true;
      faceDir = gap.clone().normalize();
    } else {
      atSpot = true;
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
  // On a raised spot (a bench, the platform) Khina sits at its height; elsewhere on the ground.
  const wantY = atSpot && spot?.z !== undefined ? spot.z : groundY(pet.position);
  pet.position.y = damp(pet.position.y, wantY, moving ? 20 : 10, dt);
  inside = wantInside;
  shown = damp(shown, inside ? 0 : 1, 8, dt);
  pet.visible = shown > 0.02;
  pet.scale.setScalar(0.4 + 0.6 * shown);
  // Fidgets: only when settled at a spot, outside, and not curled up asleep.
  if (!moving && atSpot && pose !== 'curl' && !inside) {
    nextFidget -= dt;
    if (!fidget && nextFidget <= 0) {
      const kinds: Fidget['kind'][] = ['look', 'look', 'sniff', 'turn'];
      fidget = { kind: kinds[Math.floor(Math.random() * kinds.length)]!, until: tau + 2 + Math.random() * 2, dir: Math.random() < 0.5 ? -1 : 1 };
      nextFidget = 10 + Math.random() * 20;
    }
  }
  if (fidget && (tau > fidget.until || moving)) fidget = null;
  turnOffset = damp(turnOffset, fidget?.kind === 'turn' ? 0.55 * fidget.dir : 0, 3, dt);
  if (faceDir) {
    const want = Math.atan2(faceDir.x, faceDir.z) + turnOffset;
    let d = want - pet.rotation.y;
    d = wrap(d);
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
    if (fidget?.kind === 'look') {
      T.headYaw = 0.85 * fidget.dir;
      T.headPitch = -0.22;
    } else if (fidget?.kind === 'sniff') {
      T.bodyPitch = 0.1;
      T.headPitch = 0.4 + 0.07 * Math.sin(tau * 16);
      T.headYaw = 0.25 * fidget.dir;
    } else if (fidget?.kind === 'turn') {
      T.bodyRoll = 0.06 * Math.sin(tau * 9);
    }
    // If you come close, Khina looks up at you (unless curled up or inside).
    if (player && pose !== 'curl' && !inside) {
      const dx = player.object.position.x - pet.position.x;
      const dz = player.object.position.z - pet.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 4.5) {
        const yaw = wrap(Math.atan2(dx, dz) - pet.rotation.y);
        if (Math.abs(yaw) < 1.9) {
          const k = THREE.MathUtils.smoothstep(4.5 - d, 0, 1.5);
          T.headYaw = THREE.MathUtils.lerp(T.headYaw, THREE.MathUtils.clamp(yaw, -1.0, 1.0), k);
          T.headPitch = THREE.MathUtils.lerp(T.headPitch, -0.18, k);
        }
      }
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

  // You.
  if (player) {
    const yaw = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
    player.update(dt, yaw); // always animates; the first key press also hands you the camera
    if (mode !== 'player' && player.wantsControl) setMode('player');
    // Don't walk through Khina.
    if (pet.visible) {
      const dx = player.object.position.x - pet.position.x;
      const dz = player.object.position.z - pet.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.85 && d > 1e-4) {
        player.object.position.x = pet.position.x + (dx / d) * 0.85;
        player.object.position.z = pet.position.z + (dz / d) * 0.85;
      }
    }
  }

  // The world around.
  const s = snap;
  const lightT = forcedHour !== null ? forcedHour * 60 : now;
  const weather: Weather = forcedWeather ?? s?.weather ?? 'clear';
  const minuteOfDay = ((lightT % 1440) + 1440) % 1440;
  const dark = forcedHour !== null ? minuteOfDay < 6.5 * 60 || minuteOfDay > 19.7 * 60 : (s?.dark ?? false);
  const wet = weather === 'rain' || weather === 'drizzle';
  if (s) {
    const home = s.place === 'burrow' && a?.kind !== 'walk';
    const asleep = a?.actionId === 'sleep' && a.kind === 'act';
    const want: Record<string, number> = {
      burrow: home ? (asleep ? 0.6 : dark || wet ? 3.2 : 1.2) : 0,
      bakery: s.bakeryOpen ? (dark || weather !== 'clear' ? 3.2 : 1.4) : 0,
      lamp: dark ? 4 : 0,
    };
    for (const [id, g] of Object.entries(glows)) {
      g.level = damp(g.level, want[id] ?? 0, 3, dt);
      g.mat.emissiveIntensity = g.level;
      g.mat.color.copy(GLASS_OFF).lerp(GLASS_ON, Math.min(1, g.level / 1.5));
      g.light.intensity = g.level * (1 - look.daylight * 0.8) * 2.2;
    }
    smoke.bakery.update(s.bakeryOpen, dt, look.wind);
    smoke.burrow.update(home && !asleep && (minuteOfDay < 9 * 60 || minuteOfDay > 17 * 60 || wet), dt, look.wind);
    if (flag) flag.rotation.x = damp(flag.rotation.x, s.letters > 0 ? 0 : -Math.PI / 2, 4, dt);
  }
  rain.visible = wet;
  if (wet) {
    const fall = dt * 15;
    const arr = rainGeo.attributes.position!.array as Float32Array;
    for (let i = 0; i < RAIN_N; i++) {
      let y = arr[i * 6 + 1]! - fall;
      if (y < 0) y += 20;
      arr[i * 6 + 1] = y;
      arr[i * 6 + 4] = y + 0.5;
    }
    rainGeo.attributes.position!.needsUpdate = true;
    rainGeo.setDrawRange(0, (weather === 'rain' ? RAIN_N : RAIN_N * 0.35) * 2);
    rain.position.set(controls.target.x, controls.target.y - 2, controls.target.z);
  }
  // Fireflies on dry nights.
  flyMat.opacity = damp(flyMat.opacity, dark && !wet ? 1 : 0, 1, dt);
  flies.visible = flyMat.opacity > 0.01;
  if (flies.visible) {
    const arr = flyGeo.attributes.position!.array as Float32Array;
    flyBase.forEach((b, i) => {
      const t = tau * 0.4 + i * 1.7;
      arr[i * 3] = b.x + Math.sin(t) * 1.2 + Math.sin(t * 2.3) * 0.3;
      arr[i * 3 + 1] = groundY(b) + b.y + Math.sin(t * 1.7) * 0.35;
      arr[i * 3 + 2] = b.z + Math.cos(t * 0.8) * 1.2;
    });
    flyGeo.attributes.position!.needsUpdate = true;
  }

  // Camera: keep the viewer's angle, slide along with whoever we follow.
  if (camParam && camParam.length === 6) {
    camera.position.set(camParam[0]!, camParam[1]!, camParam[2]!);
    controls.target.set(camParam[3]!, camParam[4]!, camParam[5]!);
  } else if (mode === 'player' && player) {
    const goal = player.object.position.clone().add(new THREE.Vector3(0, 0.6, 0));
    const step = goal.sub(controls.target).multiplyScalar(1 - Math.exp(-8 * dt));
    controls.target.add(step);
    camera.position.add(step);
  } else if (startDist && placed) {
    controls.target.copy(pet.position).add(new THREE.Vector3(0, 0.4, 0));
    camera.position.copy(controls.target).add(new THREE.Vector3(0.45, 0.3, 0.82).multiplyScalar(startDist));
  } else if (placed) {
    const goal = pet.position.clone().add(new THREE.Vector3(0, inside ? 1.2 : 0.5, 0));
    const step = goal.sub(controls.target).multiplyScalar(1 - Math.exp(-3 * dt));
    controls.target.add(step);
    camera.position.add(step);
  }
  // Never let the camera dip under the ground.
  const floor = terrain.heightAt(camera.position.x, -camera.position.z) + 0.35;
  if (camera.position.y < floor) camera.position.y = floor;

  look.update(lightT, weather, controls.target, dt);
  windUniforms.uTime.value = look.time;
  windUniforms.uWind.value = look.wind;
  waterUniforms.uTime.value = look.time;
  grass.update(controls.target, look.time, look.wind);
  controls.update();
  look.render();
}

let last = performance.now();
let frames = 0;
let fpsFrom = last;
renderer.setAnimationLoop(() => {
  const t = performance.now();
  frame(t - last);
  last = t;
  frames++;
  if (t - fpsFrom > 2000) {
    (window as unknown as { fps: number }).fps = Math.round((frames * 1000) / (t - fpsFrom));
    frames = 0;
    fpsFrom = t;
  }
});
