// The village in the browser. The sim runs on the server (src/live.ts) and streams snapshots;
// this page draws: it hops Khina (a felt bunny) along the paths to each action's spot and animates her
// from rigid parts (body, head, ears, nose, feet), with day and night, weather, lit windows and smoke.
// You can walk around too, as a little felt hedgehog: WASD or arrows, Shift runs, Space hops.
//
// Debug: ?hour=19.5 fixes the light, ?weather=rain, ?pose=curl (walk, sniff, work, eat, sit,
// paddle, stand) with ?dist=3 (and ?table=0.55 to put her paws on a table for work; ?act=dam, crusts or
// pea for what is in her paws; at a ?spot she keeps its facing and table), ?cam=x,y,z,tx,ty,tz (three.js; add ?clear to keep it out of trees
// like the normal camera), ?play starts as the hedgehog, ?train=8 brings a train in 8 s after load,
// ?lite drops ambient occlusion and thins the grass for slow machines (phones get it by themselves;
// ?lite=0 keeps a phone on full quality), ?hq keeps full quality even when frames are slow,
// ?villagers=all shows every villager at their first spot whatever the sim says.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CHIMNEYS, PATHS, SPOTS, VILLAGER_SPOTS, nodes, placeXY, type Spot, type XY } from '../src/world/layout.ts';
import { PLACES, type PlaceId } from '../src/world/places.ts';
import { loadTerrain } from './terrain.ts';
import { createLook, type Weather } from './look.ts';
import { createGrass, windify } from './grass.ts';
import { addFuzz } from './fuzz.ts';
import { createPlayer, type Player } from './player.ts';
import { createHud, type DiaryLine, type PieceRef, type Reading } from './hud.ts';
import { createSound, mountSoundButton } from './sound.ts';
import { createClearance } from './clearance.ts';
import { createTrain } from './train.ts';

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
  /** Who is where this hour (villager ids by place). */
  present?: Partial<Record<PlaceId, string[]>>;
  /** Minutes of the day the train stops at the halt. */
  trains?: number[];
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
// Quality. ?lite (and any phone or tablet: a coarse pointer, unless ?lite=0) starts lite: no ambient
// occlusion, pixel ratio 1, thinner grass and fur, and the hedgehog fetched only when you first walk.
// ?hq keeps everything on. Otherwise a slow frame rate turns things down as it goes (see adaptQuality).
const hq = params.has('hq');
const liteAsked = params.has('lite') && params.get('lite') !== '0';
const lite = !hq && (liteAsked || (!params.has('lite') && matchMedia('(pointer: coarse)').matches));
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
// The models are meshopt-compressed (npm run pack), hence the decoder. Each is asked for with its
// content hash (from the server, src/static.ts), so the browser can keep it until it changes.
const ART_V = ((): Record<string, string> => {
  try {
    return JSON.parse(document.querySelector('meta[name="khina-art"]')?.getAttribute('content') ?? '{}');
  } catch {
    return {};
  }
})();
const art = (file: string) => `/art/export/${file}${ART_V[file] ? `?v=${ART_V[file]}` : ''}`;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
/** Lite (unless ?play) leaves the hedgehog until you first want to walk: see loadVisitor. */
const lazyVisitor = lite && !params.has('play');
const [terrain, village, khinaGltf, visitorGltf, villagersGltf, trainGltf] = await Promise.all([
  loadTerrain(art('terrain.json')),
  loader.loadAsync(art('village.glb')),
  loader.loadAsync(art('khina.glb')),
  lazyVisitor ? null : loader.loadAsync(art('visitor.glb')).catch(() => null),
  loader.loadAsync(art('villagers.glb')).catch(() => null),
  loader.loadAsync(art('train.glb')).catch(() => null),
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

// ---------- keeping the camera out of trees, roofs and hills ----------
const clearance = createClearance(
  village.scene,
  (x, z) => terrain.heightAt(x, -z),
  (m) => /^(Ground|Water|Glow|Screen|Flag)/.test(m.name) || (m.material as THREE.Material).name.startsWith('Water'),
);
/** How far the camera is pulled in toward what it looks at, smoothed (0 when nothing is in the way). */
let camPull = 0;
/** Set once the viewer drags, zooms or turns the camera: from then on it keeps their angle. */
let viewerMoved = false;
/** Where the camera is drifting to while Khina is settled (an angle round her from her nose, whether it
 * climbs, and how far out it stays), looked for again twice a second. */
let camAim: { rel: number; high: boolean; dist: number; clear: boolean } | null = null;
let camLook = 0;
/** How high the camera climbs when the way round her is blocked lower down (the sine of its elevation). */
const HIGH = 0.76;
/** How close it comes in when the way round her is blocked from further out, in metres. */
const CLOSE = 3.2;
controls.addEventListener('start', () => {
  viewerMoved = true;
});

// ---------- sound (off until the visitor turns it on) ----------
const sound = createSound();
// A phone that is lite only by itself keeps its sound button; ?lite asked for by hand drops it, as before.
if (!liteAsked) mountSoundButton(document.getElementById('soundBtn') as HTMLButtonElement, sound);
/** Points along the water (the stream), to know how near the camera is to it. */
const waterPts: THREE.Vector3[] = [];
village.scene.updateMatrixWorld(true);
village.scene.traverse((o) => {
  if (!(o instanceof THREE.Mesh) || !(o.material as THREE.Material).name.startsWith('Water')) return;
  const pos = o.geometry.attributes.position!;
  const every = Math.max(1, Math.floor(pos.count / 400));
  for (let i = 0; i < pos.count; i += every) waterPts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
});
let streamDist = 99;
let streamCheck = 0;
let playerStep = 0;

// ---------- Khina ----------
// A felt bunny on rigid parts (art/khina.py): BodyPivot > HeadPivot > Ear.L / Ear.R / Nose, BodyPivot >
// Tail, and four feet and two forelegs on the root. She hops from place to place, sits up on her
// haunches, nibbles, washes her face, and settles into a loaf to rest, ears laid back along her head.
const pet = new THREE.Group();
const K = khinaGltf.scene;
pet.add(K);
scene.add(pet);
K.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  const mat = o.material as THREE.MeshStandardMaterial;
  o.castShadow = !/^(Shine|Mouth|Eye)/.test(mat.name);
  o.receiveShadow = true;
  if (mat.name === 'Eye' && !mat.userData.gloss) {
    // Glossy, but not a mirror: the warm brown iris painted in art/khina.py has to show through.
    mat.roughness = 0.1;
    const phys = mat as THREE.MeshPhysicalMaterial;
    if (phys.isMeshPhysicalMaterial) {
      phys.clearcoat = 0.45;
      phys.clearcoatRoughness = 0.08;
    }
    mat.userData.gloss = [0.5, 1.1];
  }
  if (mat.name === 'Shine' && !mat.userData.glow) {
    // Catch-lights lit from within only, and kept under the bloom threshold (0.92 in look.ts), so
    // they stay crisp white dots instead of glowing haloes.
    mat.color.set('#000000');
    mat.roughness = 1;
    mat.emissive.set('#ffffff');
    mat.userData.glow = [0.2, 0.85];
  }
});
// 16 shells look like 20 even from as close as the camera comes (12 thins the fringe a little there);
// on a phone screen 10 keep the fibres at her edge that 8 smudge.
addFuzz(K, { layers: lite ? 10 : 16 });
const part = (name: string) => byName(K, name) ?? new THREE.Object3D();
const body = part('BodyPivot');
const head = part('HeadPivot');
const feet = ['Foot.FL', 'Foot.FR', 'Foot.BL', 'Foot.BR'].map(part);
/** Forelegs, stretched every frame from each front paw's wrist up into her chest. */
const legs = [part('Leg.FL'), part('Leg.FR')];
/** Where each foreleg meets her chest, in the body pivot's frame; and the wrist, in the paw's. */
const SHOULDER = [new THREE.Vector3(0.085, -0.05, 0.26), new THREE.Vector3(-0.085, -0.05, 0.26)];
const WRIST = new THREE.Vector3(0, 0.02, -0.012);
/** A foreleg's length at scale 1 (art/khina.py: 2 * LEG_HALF). */
const LEG_REST = 0.18;
/** The furthest a front paw's wrist gets from her shoulder (the leg at about 1.4 times its length). */
const LEG_MAX = 0.2;
/** Where her paws hold a bite to her mouth, in the head pivot's frame (x out to each side). */
const HOLD = new THREE.Vector3(0.042, 0.0, 0.37);
/** Where her paws rub when she washes her face, in the head pivot's frame (x out to each side). */
const FACE = new THREE.Vector3(0.07, 0.15, 0.4);
const ears = [part('Ear.L'), part('Ear.R')];
/** The ears' "Lie" shape key (curled back along her head), blended in as she loafs (the fuzz shells share the weights). */
const earLie: THREE.Mesh[] = [];
/** Eye gloss and catch-lights, toned down at night so her eyes don't glow like lamps. */
const shineMats = new Set<THREE.MeshStandardMaterial>();
const eyeMats = new Set<THREE.MeshStandardMaterial>();
K.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  if (!(o instanceof THREE.InstancedMesh) && /^Ear(Outer|Inner)/.test(o.name) && o.morphTargetInfluences?.length) earLie.push(o);
  const mat = o.material as THREE.MeshStandardMaterial;
  if (mat.name === 'Shine') shineMats.add(mat);
  if (mat.name === 'Eye') eyeMats.add(mat);
});
const nose = part('Nose');
const tail = part('Tail');
const feetBase = feet.map((f) => f.position.clone());
const bodyBase = body.position.clone();
const headBase = head.position.clone();
const noseBase = nose.position.clone();
/** Open eyes (with their shines) and the closed-eye arcs, swapped to blink and to sleep. */
const openEyes: THREE.Object3D[] = [];
const shutEyes: THREE.Object3D[] = [];
K.traverse((o) => {
  if (/^(Eye|Shine2?)[LR]$/.test(o.name)) openEyes.push(o);
  if (/^EyeShut[LR]$/.test(o.name)) shutEyes.push(o);
});
function eyesShut(shut: boolean) {
  for (const o of openEyes) o.visible = !shut;
  for (const o of shutEyes) o.visible = shut;
}
eyesShut(false);
/** Sitting up turns the body about her rump (three.js, from the body pivot), not its middle. */
const RUMP = new THREE.Vector3(0, -0.21, -0.27);
/** Khina's travelling pace in metres a second, when the clock is slow enough to allow it. */
const HOP_PACE = 0.75;

// ---------- you ----------
let player: Player | null = null;
/** The hedgehog, ready to go into the scene. */
function makeVisitor(gltf: GLTF): Player {
  const p = createPlayer(gltf.scene, terrain);
  addFuzz(gltf.scene, { layers: lite ? 8 : 12 });
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mat = o.material as THREE.MeshStandardMaterial;
    if (mat.name === 'Eye') {
      mat.envMapIntensity = 2.2;
      eyeMats.add(mat);
    }
    if (mat.name === 'Shine') shineMats.add(mat);
  });
  const at = (params.get('at') ?? '3.5,-2.5').split(',').map(Number);
  p.placeAt(at[0] ?? 3.5, at[1] ?? -2.5);
  return p;
}
if (visitorGltf) {
  player = makeVisitor(visitorGltf);
  scene.add(player.object);
}
/** Lite: fetches the hedgehog the first time you want to walk, its shaders compiled off the main thread. */
let visitorLoad: Promise<void> | null = null;
function loadVisitor(): Promise<void> {
  visitorLoad ??= loader
    .loadAsync(art('visitor.glb'))
    .then(async (gltf) => {
      const p = makeVisitor(gltf);
      await renderer.compileAsync(p.object, camera, scene).catch(() => undefined);
      scene.add(p.object);
      player = p;
    })
    .catch(() => {
      visitorLoad = null; // try again on the next "Walk around"
    });
  return visitorLoad;
}
// ---------- the neighbours ----------
// Bramwell, Old Wren, Tansy, Pip and Nettle, the voles and the traveller, each shown at their spot
// while the sim has them at a place (snap.present), fading in and out as they come and go.
interface Part { body: THREE.Object3D; head: THREE.Object3D; base: THREE.Vector3; phase: number; yaw: number; pitch: number }
interface Neighbour { id: string; root: THREE.Object3D; parts: Part[]; place: PlaceId | null; shown: number; radius: number }
const RADIUS: Record<string, number> = { bramwell: 0.55, wren: 0.5, tansy: 0.35, kids: 0.65, voles: 0.5, traveller: 0.6 };
const neighbours: Neighbour[] = [];
if (villagersGltf) {
  villagersGltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const name = (o.material as THREE.Material).name;
    o.castShadow = !/^(Shine|Mouth|Eye)/.test(name);
    o.receiveShadow = true;
    if (name === 'Eye') {
      (o.material as THREE.MeshStandardMaterial).envMapIntensity = 2.2;
      eyeMats.add(o.material as THREE.MeshStandardMaterial);
    }
    if (name === 'Shine') shineMats.add(o.material as THREE.MeshStandardMaterial);
  });
  if (!lite) addFuzz(villagersGltf.scene, { layers: 10 });
  for (const id of Object.keys(VILLAGER_SPOTS)) {
    const root = byName(villagersGltf.scene, `Villager.${id}`);
    if (!root) continue;
    const parts: Part[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.Mesh || !o.name.endsWith('Body')) return;
      let head: THREE.Object3D | null = null;
      o.traverse((c) => {
        if (!head && !(c instanceof THREE.Mesh) && c !== o && c.name.endsWith('Head')) head = c;
      });
      if (head) parts.push({ body: o, head, base: o.position.clone(), phase: Math.random() * 6.28, yaw: 0, pitch: 0 });
    });
    root.visible = false;
    scene.add(root);
    neighbours.push({ id, root, parts, place: null, shown: 0, radius: RADIUS[id] ?? 0.5 });
  }
}
const showAll = params.get('villagers') === 'all';

/** Where the sim has this villager now (a place with a spot for them), or null. */
function whereIs(n: Neighbour): PlaceId | null {
  const spots = VILLAGER_SPOTS[n.id] ?? {};
  if (showAll) return (Object.keys(spots)[0] as PlaceId | undefined) ?? null;
  for (const [place, who] of Object.entries(snap?.present ?? {}) as [PlaceId, string[]][]) if (who?.includes(n.id) && spots[place]) return place;
  return null;
}

function updateNeighbours(dt: number, tau: number) {
  for (const n of neighbours) {
    const want = whereIs(n);
    // Moving between places: fade out where they were, then appear at the new spot.
    if (want !== n.place && n.shown < 0.05) {
      n.place = want;
      const spot = want ? VILLAGER_SPOTS[n.id]?.[want] : undefined;
      if (spot) {
        const p = V(spot.at);
        n.root.position.set(p.x, groundY(p), p.z);
        const f = V(spot.face).sub(p);
        n.root.rotation.y = Math.atan2(f.x, f.z);
      }
    }
    n.shown = damp(n.shown, want && want === n.place ? 1 : 0, 4, dt);
    n.root.visible = n.shown > 0.02;
    if (!n.root.visible) continue;
    n.root.scale.setScalar(0.4 + 0.6 * n.shown);
    // Who to look at: Khina, or you, whoever is nearer (and within a few metres).
    let look: THREE.Vector3 | null = null;
    let best = 4;
    for (const [who, ok] of [[pet.position, pet.visible], [player?.object.position, !!player]] as [THREE.Vector3 | undefined, boolean][]) {
      if (!who || !ok) continue;
      const d = Math.hypot(who.x - n.root.position.x, who.z - n.root.position.z);
      if (d < best) {
        best = d;
        look = who;
      }
    }
    for (const p of n.parts) {
      // Breathing, a little sway, and a slow look round; heads turn toward whoever comes close.
      p.body.position.y = p.base.y + 0.006 * Math.sin(tau * 2 + p.phase);
      p.body.scale.set(1, 1 + 0.014 * Math.sin(tau * 2 + p.phase), 1);
      p.body.rotation.z = 0.025 * Math.sin(tau * 0.6 + p.phase);
      let yaw = 0.4 * Math.sin(tau * 0.23 + p.phase) * Math.sin(tau * 0.09 + p.phase * 2);
      let pitch = 0.05 * Math.sin(tau * 0.4 + p.phase);
      if (look) {
        const world = new THREE.Vector3();
        p.head.getWorldPosition(world);
        const parentYaw = new THREE.Euler().setFromQuaternion(p.head.parent!.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
        const rel = wrap(Math.atan2(look.x - world.x, look.z - world.z) - parentYaw);
        if (Math.abs(rel) < 1.9) {
          const k = THREE.MathUtils.smoothstep(4 - best, 0, 1.2);
          yaw = THREE.MathUtils.lerp(yaw, THREE.MathUtils.clamp(rel, -1.0, 1.0), k);
          pitch = THREE.MathUtils.lerp(pitch, -0.12, k);
        }
      }
      p.yaw = damp(p.yaw, yaw, 4, dt);
      p.pitch = damp(p.pitch, pitch, 4, dt);
      p.head.rotation.set(p.pitch, p.yaw, 0);
    }
  }
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

// ---------- what Khina holds, and what flies off her paws ----------
// A bite held to her mouth when she eats (a crust at the bakery, a pea pod at the patch, a clover
// sprig anywhere else), and a pebble for the little dam; earth flying back when she digs, and drops
// when she shakes the water off a paw.
function propMesh(geo: THREE.BufferGeometry, color: string, at: [number, number, number], scale: [number, number, number], rot: [number, number, number] = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  m.position.set(...at);
  m.scale.set(...scale);
  m.rotation.set(...rot);
  m.castShadow = true;
  return m;
}
const BALL = new THREE.SphereGeometry(1, 16, 10);
const STALK = new THREE.CylinderGeometry(1, 1, 1, 6);
const PROPS: Record<string, THREE.Group> = {};
{
  const clover = new THREE.Group();
  clover.add(propMesh(STALK, '#4f7a35', [0, 0.03, 0], [0.004, 0.07, 0.004]));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    clover.add(propMesh(BALL, '#6aa846', [Math.sin(a) * 0.017, 0.068, Math.cos(a) * 0.017], [0.02, 0.005, 0.016], [0.35 * Math.cos(a), a, -0.35 * Math.sin(a)]));
  }
  clover.add(propMesh(BALL, '#f1d6e4', [0, 0.078, 0], [0.011, 0.011, 0.011]));
  const crust = new THREE.Group();
  crust.add(propMesh(BALL, '#c98a4a', [0, 0.02, 0], [0.048, 0.026, 0.03], [0, 0, 0.5]));
  crust.add(propMesh(BALL, '#f0dcb4', [0, 0.02, 0.012], [0.04, 0.02, 0.02], [0, 0, 0.5]));
  const pod = new THREE.Group();
  pod.add(propMesh(BALL, '#7cb04a', [0, 0.035, 0], [0.017, 0.05, 0.014], [0.2, 0, 0.25]));
  const pebble = new THREE.Group();
  pebble.add(propMesh(BALL, '#9b968e', [0, 0, 0], [0.042, 0.03, 0.036]));
  clover.userData.size = 1.3;
  Object.assign(PROPS, { clover, crust, pod, pebble });
  for (const g of Object.values(PROPS)) {
    g.visible = false;
    K.add(g);
  }
}
/** The bite she eats at an action's spot (a clover sprig anywhere else). */
const PROP_OF: Record<string, string> = { crusts: 'crust', pea: 'pod' };

// Little solid crumbs rather than sprites: the ambient-occlusion pass would draw a sprite's square.
interface Bit { s: THREE.Mesh; v: THREE.Vector3; age: number; life: number; size: number }
const BIT_MATS: Record<string, THREE.Material> = {
  earth: new THREE.MeshStandardMaterial({ color: '#5e3f27', roughness: 1 }),
  loam: new THREE.MeshStandardMaterial({ color: '#86643f', roughness: 1 }),
  drop: new THREE.MeshStandardMaterial({ color: '#cfe9f6', emissive: '#9fd0ea', emissiveIntensity: 0.35, roughness: 0.15 }),
};
const BIT_GEO = new THREE.IcosahedronGeometry(1, 1);
const bits: Bit[] = [];
for (let i = 0; i < 48; i++) {
  const s = new THREE.Mesh(BIT_GEO, BIT_MATS.earth);
  s.visible = false;
  scene.add(s);
  bits.push({ s, v: new THREE.Vector3(), age: 1, life: 0, size: 0 });
}
let nextBit = 0;
let bitClock = 0;
const bitAt = new THREE.Vector3();
const bitDir = new THREE.Vector3();
function spray(from: THREE.Vector3, vel: THREE.Vector3, kind: keyof typeof BIT_MATS, size: number, life: number) {
  const b = bits[nextBit]!;
  nextBit = (nextBit + 1) % bits.length;
  b.s.position.copy(from);
  b.s.material = BIT_MATS[kind]!;
  b.v.copy(vel);
  b.age = 0;
  b.life = life;
  b.size = size;
  b.s.visible = true;
}

function updateHeld(actId: string, dt: number, tau: number) {
  // The thing in her paws, between them and a little in front.
  const w = Math.max(cur.hold, cur.carry);
  const want = cur.carry > cur.hold ? 'pebble' : (PROP_OF[actId] ?? 'clover');
  for (const [name, g] of Object.entries(PROPS)) {
    g.visible = name === want && w > 0.05 && pet.visible;
    if (!g.visible) continue;
    const a = feet[0]!.position;
    const b = feet[1]!.position;
    g.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    if (name === 'pebble') {
      // Turned over in her paws while she holds it up; on the ground once it is set down.
      g.position.z += 0.05;
      g.position.y = Math.max(0.03, g.position.y + 0.02);
      g.rotation.set(0.4 * Math.sin(tau * 0.7) * (1 - cur.set), tau * 0.6 * (1 - cur.set), 0);
    } else {
      g.position.z += 0.03;
      g.position.y += 0.012;
      g.rotation.set(-0.2, 0, 0);
    }
    g.scale.setScalar(((g.userData.size as number | undefined) ?? 1) * Math.min(1, w * 1.25));
  }

  // Earth and water drops: a few at a time, in the world, falling and fading.
  bitClock -= dt;
  if (pet.visible && bitClock <= 0) {
    if (cur.dig > 0.6) {
      // Thrown up and out past her sides, so it shows from in front of her too.
      bitClock = 0.045;
      const i = Math.floor((tau * 11) / Math.PI) % 2;
      feet[i]!.getWorldPosition(bitAt);
      const out = (i === 0 ? 1 : -1) * (0.35 + Math.random() * 0.5);
      bitDir.set(out, 1.1 + Math.random() * 0.6, -(0.5 + Math.random() * 0.6)).applyAxisAngle(UP, pet.rotation.y);
      spray(bitAt, bitDir, Math.random() < 0.7 ? 'earth' : 'loam', 0.016 + Math.random() * 0.014, 0.6);
    } else if (cur.shake > 0.5) {
      bitClock = 0.035;
      feet[0]!.getWorldPosition(bitAt);
      bitDir.set(0.3 + Math.random() * 0.7, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6).applyAxisAngle(UP, pet.rotation.y);
      spray(bitAt, bitDir, 'drop', 0.008 + Math.random() * 0.005, 0.45);
    } else {
      bitClock = 0.05;
    }
  }
  for (const b of bits) {
    if (!b.s.visible) continue;
    b.age += dt;
    if (b.age >= b.life) {
      b.s.visible = false;
      continue;
    }
    b.v.y -= 5 * dt;
    b.s.position.addScaledVector(b.v, dt);
    // Down on the ground, it stays put and shrinks away.
    const floor = groundY(b.s.position);
    if (b.s.position.y < floor) {
      b.s.position.y = floor;
      b.v.set(0, 0, 0);
    }
    b.s.scale.setScalar(b.size * Math.min(1, 3 * (1 - b.age / b.life)));
  }
}
const train = trainGltf ? createTrain(scene, trainGltf, DOT, params.has('train') ? Number(params.get('train')) : null) : null;

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
const hud = createHud({ canWalk: !!player || lazyVisitor, onMode: (m) => setMode(m) });
if (mock) {
  hud.setSource(mock.mockSource(0));
  hud.setNotesSource(mock.mockNotes);
  setTimeout(() => {
    const p = snap ? mock.mockSnap(snap).pieces?.[0] : undefined;
    if (p) hud.piece(p);
  }, 4000);
  // Two made-up answers arrive a little later, half a second apart, for the toast and the badge.
  setTimeout(() => {
    if (!snap) return;
    const [a, b] = mock.mockAnswerArrives(snap);
    hud.reply(a!);
    setTimeout(() => hud.reply(b!), 500);
  }, 9000);
}

function setMode(next: Mode) {
  if (next === 'player' && !player) {
    // Lite: the hedgehog comes now, and you take it over as soon as it is here.
    if (lazyVisitor) void loadVisitor().then(() => player && setMode('player'));
    return;
  }
  mode = next;
  hud.setMode(mode);
  if (mode === 'player' && player) {
    player.takeControl();
    // Come in close behind the hedgehog if the camera is far away.
    const d = camera.position.distanceTo(controls.target);
    if (d > 12) {
      const back = camera.position.clone().sub(controls.target).setLength(8);
      controls.target.copy(player.object.position).add(new THREE.Vector3(0, 0.45, 0));
      camera.position.copy(controls.target).add(back);
    }
  }
  renderer.domElement.focus();
}
setMode(mode);
if (lazyVisitor) {
  // The keys that walk the hedgehog (web/player.ts) fetch it first; it listens for itself after that.
  const walkKey = (e: KeyboardEvent) => {
    const el = document.activeElement as HTMLElement | null;
    if (e.metaKey || e.ctrlKey || e.altKey || !/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Space)$/.test(e.code)) return;
    if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
    removeEventListener('keydown', walkKey);
    setMode('player');
  };
  addEventListener('keydown', walkKey);
}

// ---------- following the sim ----------
let snap: Snap | null = null;
let clockT = 0;
let clockAt = 0;
interface Plan { key: string; pts: THREE.Vector3[]; cum: number[]; start: number; end: number }
let plan: Plan | null = null;
let placed = false;
/** Set by the first frame: "Waking up the village…" stays until then, even if the sim has answered. */
let drawing = false;

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
  if (drawing) document.getElementById('status')!.textContent = '';
  if (!params.has('clean')) hud.show();
}

const events = new EventSource('/events');
events.addEventListener('snap', (e) => onSnap(JSON.parse((e as MessageEvent).data).snap));
events.addEventListener('piece', (e) => hud.piece(JSON.parse((e as MessageEvent).data).piece));
events.addEventListener('reading', (e) => hud.reading(JSON.parse((e as MessageEvent).data).reading));
events.addEventListener('post', (e) => hud.post(JSON.parse((e as MessageEvent).data).post));
events.addEventListener('ask', (e) => hud.ask(JSON.parse((e as MessageEvent).data).ask));
events.addEventListener('reply', (e) => hud.reply(JSON.parse((e as MessageEvent).data).reply));
events.addEventListener('clock', (e) => {
  clockT = JSON.parse((e as MessageEvent).data).t;
  clockAt = performance.now();
});
events.onerror = () => {
  document.getElementById('status')!.textContent = 'Lost the village. Reconnecting…';
};


// ---------- animation ----------
const forcedPose = params.get('pose');
/** ?fidget=groom (look, sniff, turn) makes her do that fidget over and over, to check it. */
const forcedFidget = params.get('fidget') as Fidget['kind'] | null;
/** With ?pose=work, a table top this high for her paws (the workbench is 0.55). */
const forcedTable = params.has('table') ? Number(params.get('table')) : undefined;
/** ?spot=browse puts Khina at that action's spot, in its pose, whatever the sim says. */
const forcedSpot = params.has('spot') ? (SPOTS[params.get('spot')!] ?? null) : null;
const startDist = Number(params.get('dist')) || 0;
/** With ?dist, swing the close camera round her by this many degrees. */
const orbit = (Number(params.get('orbit')) || 0) * (Math.PI / 180);
const camParam = params.get('cam')?.split(',').map(Number);
let inside = false;
let shown = 1;
/** Where she is in a hop, 0..1: on the ground until 0.3, in the air until 0.9, landing after. */
let hop = 0;
let hopping = 0;
const cur = { pitch: 0, roll: 0, bodyY: 0, loaf: 0, headPitch: 0, headYaw: 0, headRoll: 0, headDrop: 0, ear: 0, earSpread: 0, earTurn: 0, earTwist: 0, paws: 0, reach: 0, groom: 0, dig: 0, dab: 0, shake: 0, hold: 0, carry: 0, set: 0, chew: 0, twitch: 0 };
type Targets = typeof cur;
/** An angle on a spring: her ears lag behind the body and wobble back. */
class Spring {
  value = 0;
  vel = 0;
  k: number;
  c: number;
  constructor(k = 90, c = 7) {
    this.k = k;
    this.c = c;
  }
  step(target: number, dt: number) {
    this.vel += (-this.k * (this.value - target) - this.c * this.vel) * dt;
    this.value += this.vel * dt;
  }
}
const earPitch = [new Spring(), new Spring()];
const earRoll = [new Spring(110, 7), new Spring(110, 7)];
let earTwitchIn = 3;
let blinkUntil = 0;
let nextBlink = 2;
// Small things Khina does now and then during a long activity, so a real-time hour isn't a still life.
type Fidget = { kind: 'look' | 'sniff' | 'turn' | 'groom'; until: number; dir: number };
let fidget: Fidget | null = null;
let nextFidget = 6;
let turnOffset = 0;
/** Ears in a loaf: pitch back, outward roll, and a half turn on their long axis so the pink fronts face
 * her head (the "Lie" shape key curls them toward the front, so they wrap her head cream side up). */
const EAR_LOAF = [-1.2, 0.55, Math.PI] as const;
/** Face-wash strokes, radians a second (about three strokes a second). */
const GROOM_RATE = 2 * Math.PI * 3;
const bump = (x: number, a: number, b: number) => (x > a && x < b ? Math.sin((Math.PI * (x - a)) / (b - a)) : 0);
const ss = THREE.MathUtils.smoothstep;
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

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
    // Hop along at least at a bunny's easy pace. On a slow clock (real time) the sim's walk lasts
    // minutes, so Khina gets there early and starts on the thing; on a fast clock the sim's own
    // timing is quicker and wins.
    const total = plan.cum[plan.cum.length - 1]!;
    const gameFrac = (now - plan.start) / Math.max(1e-6, plan.end - plan.start);
    const realSec = (now - plan.start) / Math.max(1e-6, snap?.speed ?? 1);
    const frac = total > 0 ? Math.max(gameFrac, Math.min(1, (HOP_PACE * realSec) / total)) : 1;
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
      // Hop over to the spot for the next thing at the same place (or catch up, if a fast
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
  if (forcedSpot) {
    const p = V(forcedSpot.at);
    pet.position.x = p.x;
    pet.position.z = p.z;
    moving = false;
    atSpot = true;
    pose = forcedSpot.pose;
    wantInside = false;
    faceDir = V(forcedSpot.face).sub(p).normalize();
  }
  const here = forcedSpot ?? spot;
  const realMove = moving;
  if (forcedPose) {
    moving = forcedPose === 'walk';
    speedMs = moving ? HOP_PACE : 0;
    pose = (moving ? 'stand' : forcedPose) as Pose;
    wantInside = false;
    atSpot = false; // no random fidgets (?fidget= forces one)
    // At a ?spot she keeps its facing (and its table, unless ?table says otherwise).
    if (!forcedSpot) faceDir = new THREE.Vector3(1, 0, 0.4).normalize();
  }
  const table = forcedPose ? (forcedTable ?? forcedSpot?.table) : atSpot ? here?.table : undefined;
  /** What she is busy with, for poses that differ by what is in her paws (?spot= or ?act= names it). */
  const actId = forcedSpot ? params.get('spot')! : forcedPose ? (params.get('act') ?? '') : (a?.actionId ?? '');
  // On a raised spot (a bench, the platform) Khina sits at its height; elsewhere on the ground.
  const raised = atSpot && !forcedPose ? here?.z : undefined;
  const wantY = raised ?? groundY(pet.position);
  pet.position.y = damp(pet.position.y, wantY, moving ? 20 : 10, dt);
  inside = wantInside;
  shown = damp(shown, inside ? 0 : 1, 8, dt);
  pet.visible = shown > 0.02;
  pet.scale.setScalar(0.4 + 0.6 * shown);
  // Fidgets: only when settled at a spot, outside, and not curled up asleep.
  if (!moving && atSpot && pose !== 'curl' && !inside) {
    nextFidget -= dt;
    if (!fidget && nextFidget <= 0) {
      const kinds: Fidget['kind'][] = ['look', 'look', 'sniff', 'turn', 'groom'];
      let kind = kinds[Math.floor(Math.random() * kinds.length)]!;
      if (kind === 'groom' && pose !== 'stand' && pose !== 'sit') kind = 'look';
      // Busy paws (a bite to her mouth, digging, the water, a pebble): only a look round.
      if (kind === 'sniff' && (pose === 'eat' || pose === 'paddle' || (pose === 'work' && table === undefined))) kind = 'look';
      fidget = { kind, until: tau + 2 + Math.random() * 2, dir: Math.random() < 0.5 ? -1 : 1 };
      nextFidget = 10 + Math.random() * 20;
    }
  }
  if (fidget && (tau > fidget.until || moving)) fidget = null;
  if (forcedFidget && !moving) fidget = { kind: forcedFidget, until: tau + 1, dir: 1 };
  turnOffset = damp(turnOffset, fidget?.kind === 'turn' ? 0.55 * fidget.dir : 0, 3, dt);
  if (faceDir) {
    const want = Math.atan2(faceDir.x, faceDir.z) + turnOffset;
    let d = want - pet.rotation.y;
    d = wrap(d);
    pet.rotation.y += d * (1 - Math.exp(-(moving ? 10 : 4) * dt));
  }

  // ----- the hop: little forward hops, back feet pushing together, front paws landing together -----
  hopping = damp(hopping, moving ? 1 : 0, moving ? 10 : 6, dt);
  const before = hop;
  if (moving || hop > 0.25) {
    // About two hops a second at her easy pace, quicker (and longer) when she hurries.
    hop += THREE.MathUtils.clamp(speedMs / 0.4, 1.7, 3.2) * dt;
    if (hop >= 1) hop = moving ? hop - 1 : 0;
  }
  const h = hopping;
  const hopLen = moving ? Math.min(0.6, speedMs / THREE.MathUtils.clamp(speedMs / 0.4, 1.7, 3.2)) : 0;
  const air = bump(hop, 0.3, 0.9);
  const lift = (0.1 + 0.04 * Math.min(1, speedMs / 1.6)) * air * h;
  // Most of the way is covered in the air; on the ground she stays put (so her feet don't slide).
  const fwd = realMove ? hopLen * (ss(hop, 0.26, 0.92) - hop) * h : 0;
  const hopPitch = (-0.2 * bump(hop, 0.2, 0.55) + 0.2 * bump(hop, 0.55, 0.98)) * h;
  const hopSquash = (0.9 * bump(hop, 0.86, 1.0) + 0.4 * bump(hop, 0.0, 0.24) - 0.6 * bump(hop, 0.3, 0.62)) * h;
  if (before < 0.3 && hop >= 0.3 && h > 0.3) {
    // Take-off: the ears flop back; landing: they swing forward.
    for (const s of earPitch) s.vel -= 5;
  }
  const landed = before < 0.9 && hop >= 0.9 && h > 0.3;
  if (landed) for (const s of earPitch) s.vel += 4.5;

  // ----- pose targets -----
  const T: Targets = { pitch: 0, roll: 0, bodyY: 0, loaf: 0, headPitch: 0, headYaw: 0, headRoll: 0, headDrop: 0, ear: 0.04, earSpread: 0, earTurn: 0, earTwist: 0, paws: 0, reach: 0, groom: 0, dig: 0, dab: 0, shake: 0, hold: 0, carry: 0, set: 0, chew: 0, twitch: 0 };
  let breathe = 0.012;
  let asleep = false;
  // Her nose twitches in little bursts when she is idle.
  const burst = Math.sin(tau * 0.7) * Math.sin(tau * 0.31 + 1) > 0.15 ? 1 : 0;
  if (moving) {
    T.ear = -0.22;
    T.headPitch = -hopPitch * 0.55;
    breathe = 0;
  } else {
    switch (pose) {
      case 'stand':
        T.headPitch = 0.04 * Math.sin(tau * 0.5);
        T.headYaw = 0.45 * Math.sin(tau * 0.31) * Math.sin(tau * 0.13);
        T.twitch = burst;
        break;
      case 'sit':
        // Up on her haunches, paws held at her chest, looking about. Sunk a little, so her haunches
        // stay down on her long back feet as her front rises.
        T.pitch = -0.5;
        T.bodyY = -0.045;
        T.headPitch = 0.36 + 0.05 * Math.sin(tau * 0.7);
        T.headYaw = 0.5 * Math.sin(tau * 0.2);
        T.paws = 1;
        T.ear = 0.14;
        T.twitch = burst;
        break;
      // Head-down poses keep the head pitch small and bring the nose down with the body instead,
      // so both eyes still show from a camera above her.
      case 'sniff':
        T.pitch = 0.17;
        T.bodyY = -0.03;
        T.headPitch = 0.2 + 0.04 * Math.sin(tau * 2.3);
        T.headYaw = 0.35 * Math.sin(tau * 0.7);
        T.ear = 0.3;
        T.twitch = 1;
        break;
      case 'work':
        if (table !== undefined) {
          // Up at the table with her front paws on it, patting at whatever is there: the higher
          // the table, the more she sits up.
          T.pitch = -THREE.MathUtils.clamp(0.56 * (table - (raised ?? 0)), 0.1, 0.32);
          T.headPitch = 0.22 - 0.5 * T.pitch + 0.05 * Math.sin(tau * 1.3);
          T.headYaw = 0.2 * Math.sin(tau * 0.6);
          T.reach = 1;
          T.ear = 0.16;
        } else if (actId === 'dam') {
          // Building the little dam: up on her haunches turning a pebble over in her paws, then
          // down to set it at the water's edge, and up again with the next one.
          const cyc = (tau / 6.5) % 1;
          const down = ss(cyc, 0.52, 0.62) * (1 - ss(cyc, 0.86, 0.96));
          T.pitch = THREE.MathUtils.lerp(-0.42, 0.24, down);
          T.bodyY = -0.04 + 0.015 * down;
          T.headPitch = THREE.MathUtils.lerp(0.4, 0.16, down) + 0.04 * Math.sin(tau * 0.9);
          T.headRoll = 0.16 * Math.sin(tau * 0.8) * (1 - down);
          T.headYaw = 0.1 * Math.sin(tau * 0.5);
          T.paws = 1 - down;
          T.carry = 1;
          T.set = down;
          T.ear = 0.16;
          T.earSpread = 0.06;
        } else {
          // Digging (weeding, burrowing about): tipped well forward with her head up, front paws
          // scooping at the ground in turn out in front of her, and the earth flying back.
          T.pitch = 0.26;
          T.bodyY = -0.035;
          T.headPitch = -0.14 + 0.04 * Math.sin(tau * 3);
          T.headYaw = 0.12 * Math.sin(tau * 0.8);
          T.dig = 1;
          T.ear = 0.06;
          T.earSpread = 0.08;
        }
        T.twitch = 0.5;
        break;
      case 'eat':
        // Up on her haunches with a bite held to her mouth in both front paws, chewing.
        T.pitch = -0.42;
        T.bodyY = -0.04;
        T.headPitch = 0.3 + 0.03 * Math.sin(tau * 0.9);
        T.headYaw = 0.12 * Math.sin(tau * 0.45);
        T.paws = 1;
        T.hold = 1;
        T.chew = 1;
        T.ear = 0.04;
        T.earSpread = 0.1;
        T.twitch = 1;
        break;
      case 'curl':
        // A loaf: paws tucked in, rounder and lower, eyes closed, ears laid back: tipped back at the
        // root and curled along the round of her head by their "Lie" shape key (blended in with the loaf).
        T.loaf = 1;
        T.headPitch = 0.12;
        T.headDrop = 1;
        T.ear = EAR_LOAF[0];
        T.earSpread = EAR_LOAF[1];
        T.earTwist = EAR_LOAF[2];
        breathe = 0.022 * Math.sin(tau * 1.3);
        asleep = true;
        break;
      case 'paddle': {
        // At the water's edge, leaning over and dabbling her front paws in it; every few seconds she
        // sits back, lifts her left paw out and shakes it dry, looking at it, ears flicked back.
        const cyc = (tau / 4.8) % 1;
        const shake = ss(cyc, 0.6, 0.68) * (1 - ss(cyc, 0.92, 0.99));
        T.pitch = 0.17 - 0.3 * shake;
        T.bodyY = -0.02;
        T.headPitch = 0.2 + 0.08 * shake;
        T.headYaw = 0.25 * Math.sin(tau * 0.5) * (1 - shake) + 0.5 * shake;
        T.headRoll = 0.12 * shake;
        T.dab = 1 - shake;
        T.shake = shake;
        T.ear = 0.22 - 0.34 * shake;
        T.earSpread = 0.14 * shake;
        T.twitch = burst;
        break;
      }
    }
    if (fidget?.kind === 'look') {
      T.headYaw = 0.85 * fidget.dir;
      T.headPitch = T.paws ? 0.2 : -0.22;
      T.ear = 0.3;
      T.earTurn = 0.35 * fidget.dir;
    } else if (fidget?.kind === 'sniff') {
      T.pitch = Math.max(T.pitch, 0.15);
      T.headPitch = Math.min(T.headPitch + 0.12, 0.22);
      T.headYaw = 0.25 * fidget.dir;
      T.ear = 0.28;
      T.twitch = 1;
    } else if (fidget?.kind === 'turn') {
      T.roll = 0.05 * Math.sin(tau * 9);
    } else if (fidget?.kind === 'groom') {
      // Up on her haunches, washing her face: both paws up at her muzzle, rubbing down over her
      // cheeks in turn (see the feet), and her head nodding into each stroke.
      T.pitch = -0.5;
      T.bodyY = -0.045;
      T.paws = 1;
      T.groom = 1;
      T.headPitch = 0.46 + 0.12 * Math.sin(tau * GROOM_RATE);
      T.headRoll = 0.12 * Math.sin(tau * 2.2);
      T.ear = -0.1;
    }
    // If you come close, Khina looks up at you (unless resting or inside).
    if (player && pose !== 'curl' && !inside) {
      const dx = player.object.position.x - pet.position.x;
      const dz = player.object.position.z - pet.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 4.5) {
        const yaw = wrap(Math.atan2(dx, dz) - pet.rotation.y);
        if (Math.abs(yaw) < 1.9) {
          const k = THREE.MathUtils.smoothstep(4.5 - d, 0, 1.5);
          T.headYaw = THREE.MathUtils.lerp(T.headYaw, THREE.MathUtils.clamp(yaw, -1.0, 1.0), k);
          T.headPitch = THREE.MathUtils.lerp(T.headPitch, T.paws || T.reach ? 0.2 : -0.18, k);
          T.ear = THREE.MathUtils.lerp(T.ear, 0.3, k);
        }
      }
    }
  }
  for (const k of Object.keys(T) as (keyof Targets)[]) cur[k] = damp(cur[k], T[k], k === 'headYaw' || k === 'headPitch' ? 6 : 7, dt);

  // ----- body: about her rump when sitting up, about its middle otherwise -----
  K.position.set(0, lift, fwd);
  const pitch = cur.pitch + hopPitch;
  const pivotK = THREE.MathUtils.clamp(-pitch * 6, 0, 1);
  tmpQ.setFromEuler(tmpE.set(pitch, 0, cur.roll));
  const pv = RUMP.clone().multiplyScalar(pivotK);
  tmpV.copy(pv).applyQuaternion(tmpQ);
  body.quaternion.copy(tmpQ);
  body.position.copy(bodyBase).add(pv).sub(tmpV);
  body.position.y += cur.bodyY - 0.045 * cur.loaf - 0.025 * hopSquash;
  const sq = hopSquash * 0.06;
  const breath = cur.loaf > 0.5 ? breathe : breathe * Math.sin(tau * 2.2);
  body.scale.set(1 + 0.08 * cur.loaf + sq * 0.6, 1 - 0.1 * cur.loaf - sq + breath, 1 + 0.05 * cur.loaf + sq * 0.4);

  // ----- head -----
  const chew = cur.chew * (0.035 * Math.max(0, Math.sin(tau * 11)) + 0.02 * Math.sin(tau * 0.8));
  head.position.set(headBase.x, headBase.y - 0.06 * cur.headDrop, headBase.z - 0.02 * cur.headDrop);
  head.rotation.set(cur.headPitch + chew, cur.headYaw, cur.headRoll);
  // The head (and the scarf on it) keeps its own shape when the body squashes into a loaf or breathes.
  head.scale.set(1 / body.scale.x, 1 / body.scale.y, 1 / body.scale.z);

  // ----- nose: little twitches (fast and constant when sniffing or nibbling) -----
  const tw = cur.twitch * Math.sin(tau * 26) * 0.009 + cur.chew * Math.sin(tau * 11) * 0.006;
  nose.position.set(noseBase.x, noseBase.y + tw, noseBase.z + Math.abs(tw) * 0.4);
  nose.rotation.x = -tw * 13;
  nose.scale.set(1 + Math.abs(tw) * 6, 1 - Math.abs(tw) * 11, 1);

  // ----- ears: on springs, so they bounce and lag; one flicks now and then -----
  earTwitchIn -= dt;
  if (earTwitchIn <= 0 && !moving) {
    const i = Math.random() < 0.5 ? 0 : 1;
    earRoll[i]!.vel += (i === 0 ? -1 : 1) * (4 + Math.random() * 3) * (asleep ? 0.4 : 1);
    earPitch[i]!.vel -= 2.5;
    earTwitchIn = 2.5 + Math.random() * 5;
  }
  const travelBack = moving ? -0.12 * Math.min(1, speedMs / 1.5) : 0;
  ears.forEach((ear, i) => {
    const side = i === 0 ? 1 : -1;
    earPitch[i]!.step(cur.ear + travelBack - 0.25 * air * h, dt);
    earRoll[i]!.step(0, dt);
    // Spread is outward: her left ear is on +x, so it tips out with a negative roll about z.
    ear.rotation.set(earPitch[i]!.value, cur.earTurn, -side * cur.earSpread + earRoll[i]!.value);
    // In a loaf each ear also turns half round on its long axis (front outward first), so it lies
    // back with its pink front against her head and its cream back up.
    if (cur.earTwist > 0.001) ear.quaternion.multiply(tmpQ.setFromAxisAngle(UP, side * cur.earTwist));
  });
  const lie = THREE.MathUtils.smoothstep(cur.loaf, 0.1, 0.9);
  for (const m of earLie) m.morphTargetInfluences![0] = lie;
  tail.rotation.set(-0.5 * air * h + 0.15 * cur.loaf, 0.12 * Math.sin(tau * 2.6) * (1 - h) * (1 - cur.loaf), 0);

  // ----- eyes: a blink now and then; closed in a loaf -----
  if (tau > nextBlink) {
    blinkUntil = tau + 0.12;
    nextBlink = tau + 2.5 + Math.random() * 4 + (Math.random() < 0.2 ? -2 : 0);
  }
  eyesShut((asleep && cur.loaf > 0.6) || tau < blinkUntil);

  // ----- feet -----
  const tableY = table !== undefined ? table - (raised ?? 0) : 0.5;
  body.updateMatrix();
  head.updateMatrix();
  feet.forEach((f, i) => {
    const b = feetBase[i]!;
    const side = i % 2 === 0 ? 1 : -1;
    const front = i < 2;
    let x = b.x;
    let y = b.y;
    let z = b.z;
    let rx = 0;
    let s = 1;
    if (front) {
      // Held at her chest when sitting up.
      const up = Math.max(cur.paws, cur.reach);
      x -= side * 0.02 * up;
      y += 0.36 * cur.paws;
      z -= 0.08 * cur.paws;
      rx += 0.9 * cur.paws;
      // On a table top: reach up and forward onto it, patting.
      const pat = Math.max(0, Math.sin(tau * 5 + (side > 0 ? 0 : 2.2))) * 0.025;
      y += (tableY - b.y + 0.02 + pat) * cur.reach;
      z += 0.07 * cur.reach;
      // Digging at the ground, one paw then the other: out in front of her and up, down, and
      // scraped back under her chest.
      const dp = tau * 11 + (side > 0 ? 0 : Math.PI);
      z += cur.dig * (0.1 + 0.08 * Math.sin(dp));
      y += cur.dig * 0.07 * Math.max(0, Math.cos(dp));
      rx -= cur.dig * 0.6 * Math.max(0, Math.cos(dp));
      // Dabbling at the water: a little way out, then down into it and back.
      const ph = tau * 3.2 + (side > 0 ? 0 : Math.PI * 0.8);
      z += cur.dab * (0.025 + 0.025 * Math.sin(ph));
      y += cur.dab * (0.03 * Math.max(0, Math.cos(ph)) - 0.03 * Math.max(0, -Math.cos(ph)) - 0.01);
      // Shaking the water off: her left paw lifted out to the side and shaken fast.
      if (side > 0) {
        const sh = Math.sin(tau * 42);
        x += cur.shake * (0.05 + 0.014 * sh);
        y += cur.shake * 0.2;
        z += cur.shake * 0.05;
        rx -= cur.shake * (0.7 + 0.3 * sh);
      }
      // Setting a pebble down at the water's edge: both paws out in front, down on the ground.
      z += 0.1 * cur.set;
      // Tucked under her chest in a loaf.
      z -= 0.09 * cur.loaf;
      s -= 0.3 * cur.loaf;
      // Hopping: rise with her, paws tucked up under her chest in the air, and only in the last
      // moment before landing reach forward and down, to land first, together.
      z += 0.05 * bump(hop, 0.35, 0.95) * h;
      y += 0.4 * lift * air;
      y -= lift * ss(hop, 0.8, 0.9) * 0.35;
      rx -= 0.4 * bump(hop, 0.35, 0.8) * h;
      // Both paws up at her face: washing it (rubbing down over her cheeks in turn), or holding a
      // bite to her mouth.
      if (cur.groom > 0.001 || cur.hold > 0.001) {
        const g = Math.max(cur.groom, cur.hold);
        const st = 0.5 + 0.5 * Math.sin(tau * GROOM_RATE + (side > 0 ? 0 : Math.PI));
        const gx = THREE.MathUtils.lerp(side * (FACE.x + 0.025 * (1 - st)), side * HOLD.x, cur.hold / g);
        const gy = THREE.MathUtils.lerp(FACE.y - 0.075 * st, HOLD.y, cur.hold / g);
        const gz = THREE.MathUtils.lerp(FACE.z + 0.012 * st, HOLD.z, cur.hold / g);
        tmpV.set(gx, gy, gz).applyMatrix4(head.matrix).applyMatrix4(body.matrix);
        x += (tmpV.x - x) * g;
        y += (tmpV.y - y) * g;
        z += (tmpV.z - z) * g;
        rx += (0.35 - rx) * g;
      }
    } else {
      // Back feet: push off together, trail behind in the air, swing forward to land. On the
      // push-off the heels come up a little more than the toes go down, so the feet stay feet
      // from behind and not thin fins.
      z -= (0.08 * bump(hop, 0.22, 0.62) - 0.04 * bump(hop, 0.62, 0.98)) * h;
      y += (0.03 * bump(hop, 0.35, 0.85) + 0.025 * bump(hop, 0.22, 0.6)) * h;
      rx += 0.25 * bump(hop, 0.25, 0.6) * h;
      // Tucked in under her in a loaf, and back under her haunches (heels up a little) when she sits up.
      x -= side * 0.04 * cur.loaf;
      s -= 0.15 * cur.loaf;
      const tuck = Math.max(cur.paws, 0.6 * cur.reach);
      z -= 0.08 * tuck;
      y += 0.008 * tuck;
      rx -= 0.08 * tuck;
    }
    f.position.set(x, y, z);
    f.rotation.set(rx, 0, 0);
    f.scale.setScalar(Math.max(0.001, s));
  });
  // Forelegs: from each front paw's wrist up into her chest, so the paws never float apart from her.
  legs.forEach((leg, i) => {
    const f = feet[i]!;
    f.updateMatrix();
    const wrist = tmpV.copy(WRIST).applyMatrix4(f.matrix);
    const dir = tmpV2.copy(SHOULDER[i]!).applyMatrix4(body.matrix).sub(wrist);
    let len = dir.length();
    dir.divideScalar(Math.max(1e-6, len));
    if (len > LEG_MAX) {
      // A paw reaches no further than its short plush foreleg: past that it is drawn back toward
      // her chest, so the leg never thins into a stilt.
      f.position.addScaledVector(dir, len - LEG_MAX);
      wrist.addScaledVector(dir, len - LEG_MAX);
      len = LEG_MAX;
    }
    leg.position.copy(wrist).addScaledVector(dir, len * 0.5);
    leg.quaternion.setFromUnitVectors(UP, dir);
    const thick = f.scale.x;
    leg.scale.set(thick, Math.max(0.2, (len + 0.05) / LEG_REST), thick);
  });
  updateHeld(actId, dt, tau);

  if (sound.on && landed && pet.visible) sound.step(camera.position.distanceTo(pet.position), 0.5);

  // You.
  if (player) {
    const yaw = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
    player.update(dt, yaw); // always animates; the first key press also hands you the camera
    if (mode !== 'player' && player.wantsControl) setMode('player');
    // Don't walk through the neighbours.
    for (const n of neighbours) {
      if (!n.root.visible) continue;
      const dx = player.object.position.x - n.root.position.x;
      const dz = player.object.position.z - n.root.position.z;
      const d = Math.hypot(dx, dz);
      const r = n.radius + 0.35;
      if (d < r && d > 1e-4) {
        player.object.position.x = n.root.position.x + (dx / d) * r;
        player.object.position.z = n.root.position.z + (dz / d) * r;
      }
    }
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

  updateNeighbours(dt, tau);

  // Footsteps: Khina's on each hop landing (above), the hedgehog's on every other footfall.
  if (sound.on && player) {
    if (player.steps !== playerStep && player.steps % 2 === 0) sound.step(camera.position.distanceTo(player.object.position), 0.7);
    playerStep = player.steps;
  }

  // The world around.
  const s = snap;
  const lightT = forcedHour !== null ? forcedHour * 60 : now;
  const weather: Weather = forcedWeather ?? s?.weather ?? 'clear';
  const minuteOfDay = ((lightT % 1440) + 1440) % 1440;
  const dark = forcedHour !== null ? minuteOfDay < 6.5 * 60 || minuteOfDay > 19.7 * 60 : (s?.dark ?? false);
  const wet = weather === 'rain' || weather === 'drizzle';
  // Catch-lights and eye gloss follow the light, so eyes don't shine like lamps in the dark.
  // (Khina's own are softer: see where her model is loaded.)
  for (const m of shineMats) {
    const [night, day] = (m.userData.glow as [number, number] | undefined) ?? [0.25, 2];
    m.emissiveIntensity = night + (day - night) * look.daylight;
  }
  for (const m of eyeMats) {
    const [night, day] = (m.userData.gloss as [number, number] | undefined) ?? [0.9, 2.2];
    m.envMapIntensity = night + (day - night) * look.daylight;
  }
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
  train?.update(now, snap?.speed ?? 1, snap?.trains ?? [], dt, look.wind);
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
    const goal = player.object.position.clone().add(new THREE.Vector3(0, 0.45, 0));
    const step = goal.sub(controls.target).multiplyScalar(1 - Math.exp(-8 * dt));
    controls.target.add(step);
    camera.position.add(step);
  } else if (startDist && placed) {
    controls.target.copy(pet.position).add(new THREE.Vector3(0, 0.5, 0));
    camera.position.copy(controls.target).add(new THREE.Vector3(0.45, 0.3, 0.82).applyAxisAngle(new THREE.Vector3(0, 1, 0), orbit).multiplyScalar(startDist));
  } else if (placed) {
    const goal = pet.position.clone().add(new THREE.Vector3(0, inside ? 1.2 : 0.5, 0));
    const step = goal.sub(controls.target).multiplyScalar(1 - Math.exp(-3 * dt));
    controls.target.add(step);
    camera.position.add(step);
    // Until the viewer moves the camera, it drifts slowly round to the side she faces once she
    // settles (about 70 degrees off her nose: her face and whatever she is busy with, not one
    // hidden behind the other), so a first look shows her face rather than her tail, if the way is clear.
    // Where that is clear of walls and trunks; failing that, square from the side, then nearer her
    // front; then the same from closer in (at the shed's workbench the shed and the great oak are in
    // the way from further out), then from higher up (over a bench, barrels or a fence); and if nothing
    // is clear, from close in, up over her shoulder, looking down on her paws.
    if (!viewerMoved && mode === 'khina' && atSpot && !moving && !inside) {
      const off = tmpV.copy(camera.position).sub(controls.target);
      const az = Math.atan2(off.x, off.z);
      const face = pet.rotation.y;
      const near = wrap(az - face) >= 0 ? 1 : -1;
      const len = Math.max(1e-6, off.length());
      const el = off.y / len;
      camLook -= dt;
      /** Whether the camera would see her from this angle round her, this high and this far out. */
      const clearAt = (at: number, high: boolean, dist: number) => {
        const y = (high ? Math.max(el, HIGH) : el) * dist;
        const r = Math.sqrt(Math.max(0, dist * dist - y * y));
        return clearView(controls.target, tmpV2.set(Math.sin(at) * r, y, Math.cos(at) * r), dist <= CLOSE + 0.1 ? 1 : 2);
      };
      if (camLook <= 0 || camAim === null) {
        camLook = 0.5;
        // Keep to where it is going while that stays clear, rather than swapping sides on the way.
        if (!camAim?.clear || !clearAt(face + camAim.rel, camAim.high, camAim.dist)) {
          camAim = null;
          search: for (const high of [false, true]) {
            for (const dist of len > CLOSE + 0.1 ? [len, CLOSE] : [len]) {
              for (const mag of [1.2, 1.6, 0.9]) {
                for (const sideOf of [near, -near]) {
                  if (clearAt(face + mag * sideOf, high, dist)) {
                    camAim = { rel: mag * sideOf, high, dist, clear: true };
                    break search;
                  }
                }
              }
            }
          }
          camAim ??= { rel: 2.4 * near, high: true, dist: Math.min(len, CLOSE), clear: false };
        }
      }
      const aim = camAim!;
      const want = wrap(face + aim.rel - az);
      if (Math.abs(want) > 0.01) off.applyAxisAngle(UP, THREE.MathUtils.clamp(want, -0.4 * dt, 0.4 * dt));
      const to = damp(len, aim.dist, 0.8, dt);
      const y = to * (aim.high ? damp(el, Math.max(el, HIGH), 0.8, dt) : el);
      const k = Math.sqrt(Math.max(0, to * to - y * y)) / Math.max(1e-6, Math.hypot(off.x, off.z));
      off.set(off.x * k, y, off.z * k);
      camera.position.copy(controls.target).add(off);
    } else {
      camAim = null;
    }
  }
  // Never let the camera dip under the ground.
  const floor = terrain.heightAt(camera.position.x, -camera.position.z) + 0.35;
  if (camera.position.y < floor) camera.position.y = floor;

  look.update(lightT, weather, controls.target, dt);
  if (sound.on) {
    streamCheck -= dt;
    if (streamCheck <= 0 && waterPts.length) {
      streamCheck = 0.25;
      streamDist = Math.min(...waterPts.map((p) => p.distanceTo(camera.position)));
    }
    sound.update({ dt, daylight: look.daylight, weather, wind: look.wind, streamDist });
  }
  windUniforms.uTime.value = look.time;
  windUniforms.uWind.value = look.wind;
  waterUniforms.uTime.value = look.time;
  grass.update(controls.target, look.time, look.wind);
  controls.update();
  // Nothing between the camera and what it follows: if a trunk, canopy, roof or hill is in the
  // way, draw from just in front of it. Only for this frame's picture, so the orbit keeps the
  // distance the viewer chose and the camera eases back out once the way is clear.
  const orbitPos = camera.position.clone();
  if (!camParam || params.has('clear')) {
    const full = orbitPos.distanceTo(controls.target);
    const want = Math.max(0, full - clearance.clearDist(controls.target, orbitPos));
    camPull = damp(camPull, want, want > camPull ? 14 : 2.5, dt);
    if (camPull > 0.01) {
      camera.position.lerpVectors(controls.target, orbitPos, Math.max(0.05, (full - camPull) / full));
      const ground = terrain.heightAt(camera.position.x, -camera.position.z) + 0.35;
      if (camera.position.y < ground) camera.position.y = ground;
    }
  }
  look.render();
  camera.position.copy(orbitPos);
}

/** Whether a camera at target + off would see the target with nothing near the line of sight:
 * checked down the middle and along lines 0.9 (and, with wide = 2, 1.8) m to either side, so that a
 * wall or a trunk beside the camera, filling half the picture, counts too. A camera close in sees
 * less to the sides, so it checks only the nearer lines. */
function clearView(target: THREE.Vector3, off: THREE.Vector3, wide = 2): boolean {
  const side = new THREE.Vector3(off.z, 0, -off.x).setLength(0.9);
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  for (const k of wide >= 2 ? [0, 1, -1, 2, -2] : [0, 1, -1]) {
    from.copy(target).addScaledVector(side, k);
    to.copy(from).add(off);
    if (clearance.clearDist(from, to) < off.length() - 0.05) return false;
  }
  return off.lengthSq() > 0;
}

// ---------- quality that follows the frame rate ----------
// After the first few seconds, two 2-second spells in a row under 50 frames a second turn one thing down
// (one slow spell is more likely a hitch than a slow machine), the least missed first: ambient
// occlusion, then the extra pixels of a sharp screen, then multisampling. One step at a time, a second
// to settle in between, and never back up in the same visit (it would only go back and forth).
// ?hq never steps down. window.quality says where it got to.
const STEPS: { name: string; can: () => boolean; drop: () => void }[] = [
  { name: 'ambient occlusion', can: () => look.ao, drop: () => look.dropAO() },
  { name: 'pixel ratio 1', can: () => renderer.getPixelRatio() > 1, drop: () => look.setPixelRatio(1) },
  { name: 'multisampling', can: () => look.msaa, drop: () => look.dropMSAA() },
];
const quality = { dropped: [] as string[], fps: 0 };
(window as unknown as { quality: typeof quality }).quality = quality;
let adaptFrom = 0;
let adaptFrames = 0;
let adaptQuiet = 0;
let slowSpells = 0;
function adaptQuality(t: number, dtMs: number) {
  if (hq) return;
  adaptQuiet ||= t + 3000;
  // Warming up or settling, a hidden tab, or one long hitch (a big load): start the count again.
  if (t < adaptQuiet || document.hidden || dtMs > 400) {
    adaptFrom = t;
    adaptFrames = 0;
    return;
  }
  adaptFrames++;
  if (t - adaptFrom < 2000) return;
  quality.fps = Math.round((adaptFrames * 1000) / (t - adaptFrom));
  adaptFrom = t;
  adaptFrames = 0;
  if (quality.fps >= 50) {
    slowSpells = 0;
    return;
  }
  if (++slowSpells < 2) return;
  slowSpells = 0;
  const step = STEPS.find((s) => s.can());
  if (!step) return;
  step.drop();
  quality.dropped.push(step.name);
  console.info(`quality: ${quality.fps} fps, turned off ${step.name}`);
  adaptQuiet = t + 1000;
}

// Every shader is compiled before the first frame, by the browser in the background where it can
// (KHR_parallel_shader_compile), instead of stalling the first frames. The sky goes first, so the
// shaders are the ones that see its light. Hidden things (the villagers, the train) count too.
look.update(forcedHour !== null ? forcedHour * 60 : gameNow(), forcedWeather ?? 'clear', controls.target, 0);
performance.mark('khina:compile');
await Promise.race([renderer.compileAsync(scene, camera).catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);

let last = performance.now();
let frames = 0;
let fpsFrom = last;
renderer.setAnimationLoop(() => {
  const t = performance.now();
  frame(t - last);
  if (!drawing) {
    drawing = true;
    performance.mark('khina:first-frame');
    if (snap) document.getElementById('status')!.textContent = '';
  }
  adaptQuality(t, t - last);
  last = t;
  frames++;
  if (t - fpsFrom > 2000) {
    (window as unknown as { fps: number }).fps = Math.round((frames * 1000) / (t - fpsFrom));
    frames = 0;
    fpsFrom = t;
  }
});
