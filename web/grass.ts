// Grass and wild flowers, grown where terrain.json says grass grows, swaying in the wind.
// Drawn in 8 m tiles around whatever the camera looks at; tiles are built the first time they
// come near and hidden when far away. The blades' normals point straight up, so a lawn is lit
// softly like the ground under it.

import * as THREE from 'three';
import type { Terrain } from './terrain.ts';

const TILE = 8;
const RADIUS = 42;

/** One blade: a tapered, slightly curved strip, 1 high, built along +y. */
function bladeGeometry(): THREE.BufferGeometry {
  const pts: number[] = [];
  const cols: number[] = [];
  const rows = [
    [0, 0.5],
    [0.35, 0.42],
    [0.7, 0.26],
    [1, 0],
  ];
  const root = new THREE.Color('#3f6a2a');
  const tip = new THREE.Color('#b5cf6e');
  for (const [y, w] of rows) {
    const bend = y! * y! * 0.18;
    pts.push(-w! * 0.05, y!, bend, w! * 0.05, y!, bend);
    const c = root.clone().lerp(tip, Math.pow(y!, 0.8));
    cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  const idx: number[] = [];
  for (let r = 0; r < rows.length - 1; r++) {
    const a = r * 2;
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pts.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

/** One flower: a stem and a little five-petalled head facing up, 1 high. */
function flowerGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const stem = new THREE.Color('#4d7a32');
  const push = (x: number, y: number, z: number, c: THREE.Color, n = [0, 1, 0]) => {
    pos.push(x, y, z);
    col.push(c.r, c.g, c.b);
    nor.push(n[0]!, n[1]!, n[2]!);
  };
  // stem (two crossed thin quads)
  for (const [dx, dz] of [
    [0.012, 0],
    [0, 0.012],
  ]) {
    push(-dx!, 0, -dz!, stem);
    push(dx!, 0, dz!, stem);
    push(dx!, 0.92, dz!, stem);
    push(-dx!, 0, -dz!, stem);
    push(dx!, 0.92, dz!, stem);
    push(-dx!, 0.92, -dz!, stem);
  }
  // petals: white here, tinted per flower by instance colour; the centre stays warm
  const petal = new THREE.Color(1, 1, 1);
  const centre = new THREE.Color('#ffd34d');
  const P = 5;
  for (let k = 0; k < P; k++) {
    const a0 = (k / P) * Math.PI * 2;
    const a1 = a0 + 0.55;
    const a2 = a0 - 0.55;
    const r = 0.11;
    push(0, 0.93, 0, petal);
    push(Math.cos(a1) * r * 0.7, 0.95, Math.sin(a1) * r * 0.7, petal);
    push(Math.cos(a0) * r, 0.97, Math.sin(a0) * r, petal);
    push(0, 0.93, 0, petal);
    push(Math.cos(a0) * r, 0.97, Math.sin(a0) * r, petal);
    push(Math.cos(a2) * r * 0.7, 0.95, Math.sin(a2) * r * 0.7, petal);
  }
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * Math.PI * 2;
    const a1 = ((k + 1) / 6) * Math.PI * 2;
    push(0, 0.965, 0, centre);
    push(Math.cos(a1) * 0.03, 0.955, Math.sin(a1) * 0.03, centre);
    push(Math.cos(a0) * 0.03, 0.955, Math.sin(a0) * 0.03, centre);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/** Sways vertices by their height in the model (0 at the root, 1 at the top). */
export function windify(mat: THREE.Material, uniforms: { uTime: { value: number }; uWind: { value: number } }, opts: { amount: number; heightFrom?: number; heightTo?: number }) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;').replace(
      '#include <project_vertex>',
      `vec4 mvPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      vec4 wpos = modelMatrix * mvPosition;
      float hgt = smoothstep(${(opts.heightFrom ?? 0).toFixed(2)}, ${(opts.heightTo ?? 1).toFixed(2)}, position.y);
      float gust = 0.5 + 0.5 * sin(uTime * 0.6 + wpos.x * 0.06 + wpos.z * 0.045);
      float sway = sin(uTime * 2.1 + wpos.x * 0.55 + wpos.z * 0.38) * (0.35 + 0.65 * gust) + 0.4 * gust;
      vec2 push = vec2(0.85, 0.45) * sway * uWind * hgt * hgt * ${opts.amount.toFixed(3)};
      mvPosition = modelMatrix * mvPosition;
      mvPosition.xz += push;
      mvPosition = viewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  mat.customProgramCacheKey = () => `wind-${opts.amount}-${opts.heightFrom}-${opts.heightTo}`;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothNoise = (x: number, y: number) => (Math.sin(x * 0.21 + y * 0.13) + Math.sin(x * 0.083 - y * 0.17 + 1.3) + 0.6 * Math.sin(x * 0.47 + y * 0.39 + 4.1)) / 2.6;

export interface Grass {
  update(focus: THREE.Vector3, time: number, wind: number): void;
}

export function createGrass(scene: THREE.Scene, terrain: Terrain, opts: { density?: number } = {}): Grass {
  const density = opts.density ?? 70;
  const uniforms = { uTime: { value: 0 }, uWind: { value: 1 } };
  const bladeMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.92 });
  windify(bladeMat, uniforms, { amount: 0.22 });
  const flowerMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
  windify(flowerMat, uniforms, { amount: 0.12 });
  const blade = bladeGeometry();
  const flower = flowerGeometry();
  const PETALS = ['#ffffff', '#fff4c2', '#ffd84a', '#f6a8c4', '#c8a8f0', '#9ec4ff', '#ffffff'].map((c) => new THREE.Color(c));

  const tiles = new Map<string, THREE.Group>();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();

  function build(tx: number, ty: number): THREE.Group {
    const g = new THREE.Group();
    const r = rng(tx * 7349 + ty * 1931 + 17);
    const blades: [number, number, number, number, number][] = [];
    const flowers: [number, number, number, number][] = [];
    const n = Math.round(TILE * TILE * density);
    for (let i = 0; i < n; i++) {
      const x = tx * TILE + r() * TILE;
      const y = ty * TILE + r() * TILE;
      const g0 = terrain.grassAt(x, y);
      if (g0 <= 0.02 || r() > g0) continue;
      blades.push([x, y, g0, r(), r()]);
    }
    const nf = Math.round(TILE * TILE * 1.6);
    for (let i = 0; i < nf; i++) {
      const x = tx * TILE + r() * TILE;
      const y = ty * TILE + r() * TILE;
      const g0 = terrain.grassAt(x, y);
      const patch = smoothNoise(x * 0.9, y * 0.9);
      if (g0 < 0.6 || r() > (patch - 0.05) * 1.6) continue;
      flowers.push([x, y, r(), patch]);
    }
    if (blades.length) {
      const im = new THREE.InstancedMesh(blade, bladeMat, blades.length);
      blades.forEach(([x, y, g0, a, b], i) => {
        const h = (0.1 + 0.17 * g0 + 0.1 * b * b) * (0.8 + 0.4 * (0.5 + 0.5 * smoothNoise(x * 1.7, y * 1.7)));
        q.setFromAxisAngle(up, a * Math.PI * 2);
        m.compose(p.set(x, terrain.heightAt(x, y) - 0.02, -y), q, s.set(0.55 + 0.4 * b, h, 0.55 + 0.4 * b));
        im.setMatrixAt(i, m);
        const tone = 0.82 + 0.3 * a * b + 0.12 * smoothNoise(x * 0.6 + 9, y * 0.6);
        c.setRGB(tone, tone * (0.97 + 0.06 * b), tone * (0.9 + 0.1 * a));
        if (g0 < 0.5) c.multiplyScalar(0.8);
        im.setColorAt(i, c);
      });
      im.receiveShadow = true;
      im.castShadow = false;
      im.computeBoundingSphere();
      g.add(im);
    }
    if (flowers.length) {
      const im = new THREE.InstancedMesh(flower, flowerMat, flowers.length);
      flowers.forEach(([x, y, a, patch], i) => {
        const h = 0.2 + 0.14 * a;
        q.setFromAxisAngle(up, a * 40);
        m.compose(p.set(x, terrain.heightAt(x, y) - 0.01, -y), q, s.set(0.8 + a * 0.4, h, 0.8 + a * 0.4));
        im.setMatrixAt(i, m);
        im.setColorAt(i, PETALS[Math.floor((patch * 7 + a * 1.5) * 3) % PETALS.length]!);
      });
      im.receiveShadow = true;
      im.computeBoundingSphere();
      g.add(im);
    }
    scene.add(g);
    return g;
  }

  return {
    update(focus, time, wind) {
      uniforms.uTime.value = time;
      uniforms.uWind.value = wind;
      const fx = focus.x;
      const fy = -focus.z;
      const r = Math.ceil(RADIUS / TILE);
      const cx = Math.floor(fx / TILE);
      const cy = Math.floor(fy / TILE);
      for (const [key, g] of tiles) {
        const [tx, ty] = key.split(',').map(Number) as [number, number];
        g.visible = Math.hypot((tx + 0.5) * TILE - fx, (ty + 0.5) * TILE - fy) < RADIUS;
      }
      // Build at most two new tiles a frame, nearest first, so the page never stalls.
      const want: [number, number, number][] = [];
      for (let tx = cx - r; tx <= cx + r; tx++)
        for (let ty = cy - r; ty <= cy + r; ty++) {
          const d = Math.hypot((tx + 0.5) * TILE - fx, (ty + 0.5) * TILE - fy);
          if (d < RADIUS && !tiles.has(`${tx},${ty}`)) want.push([d, tx, ty]);
        }
      want.sort((a, b) => a[0] - b[0]);
      for (const [, tx, ty] of want.slice(0, 2)) tiles.set(`${tx},${ty}`, build(tx, ty));
    },
  };
}
