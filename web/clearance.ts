// Keeps the camera out of trees, roofs and hills. At load, the village's solid things (trunks,
// canopies, buildings) are sampled into a coarse grid of filled cells; each frame the line from
// what we look at out to the camera is walked through that grid and the ground, and the camera may
// come no further than the first thing in the way. The village is a few big merged meshes, so a
// grid is far cheaper than raycasting them every frame.

import * as THREE from 'three';

export interface Clearance {
  /** How far from `target` toward `cam` the camera can be, at most |cam - target|. */
  clearDist(target: THREE.Vector3, cam: THREE.Vector3): number;
  /** Filled cells, for checking. */
  readonly filled: number;
}

const CELL = 0.5;
/** Things lower than this above the ground (rocks, rails, benches, crops) don't block the camera. */
const LOW = 0.7;

export function createClearance(root: THREE.Object3D, heightAt: (x: number, z: number) => number, skip: (m: THREE.Mesh) => boolean): Clearance {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || skip(o)) return;
    meshes.push(o);
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox!.clone().applyMatrix4(o.matrixWorld));
  });
  const x0 = box.min.x - CELL, y0 = box.min.y - CELL, z0 = box.min.z - CELL;
  const nx = Math.ceil((box.max.x - x0) / CELL) + 2;
  const ny = Math.ceil((box.max.y - y0) / CELL) + 2;
  const nz = Math.ceil((box.max.z - z0) / CELL) + 2;
  const bits = new Uint8Array(Math.ceil((nx * ny * nz) / 8));
  let filled = 0;
  const cells: number[] = [];
  const idx = (x: number, y: number, z: number) => {
    const i = Math.floor((x - x0) / CELL), j = Math.floor((y - y0) / CELL), k = Math.floor((z - z0) / CELL);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -1;
    return (k * ny + j) * nx + i;
  };
  const mark = (p: THREE.Vector3) => {
    if (p.y - heightAt(p.x, p.z) < LOW) return;
    const n = idx(p.x, p.y, p.z);
    if (n < 0 || bits[n >> 3]! & (1 << (n & 7))) return;
    bits[n >> 3]! |= 1 << (n & 7);
    cells.push(n);
    filled++;
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
  for (const m of meshes) {
    const pos = m.geometry.attributes.position!;
    const index = m.geometry.index;
    const tris = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < tris; t++) {
      const ia = index ? index.getX(t * 3) : t * 3;
      const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld);
      // Sample the triangle finely enough that no cell it passes through is missed.
      const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
      const n = Math.max(1, Math.ceil(longest / (CELL * 0.5)));
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= n - i; j++) {
          const u = i / n, v = j / n;
          p.copy(a).multiplyScalar(1 - u - v).addScaledVector(b, u).addScaledVector(c, v);
          mark(p);
        }
    }
  }
  // Only thick things block: a cell needs a good few filled neighbours. A stove pipe, a lamp post
  // or a thin trunk fills a single column of cells and is fine to look past; a canopy, a roof, a
  // wall or the old oak fills many.
  const has = (n: number) => (bits[n >> 3]! & (1 << (n & 7))) !== 0;
  const thick = new Uint8Array(bits.length);
  for (const n of cells) {
    const i = n % nx, j = Math.floor(n / nx) % ny, k = Math.floor(n / (nx * ny));
    let around = 0;
    for (let dk = -1; dk <= 1; dk++)
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj && !dk) continue;
          const ii = i + di, jj = j + dj, kk = k + dk;
          if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
          if (has((kk * ny + jj) * nx + ii)) around++;
        }
    if (around >= 6) thick[n >> 3]! |= 1 << (n & 7);
  }
  const solid = (q: THREE.Vector3) => {
    const n = idx(q.x, q.y, q.z);
    return n >= 0 && (thick[n >> 3]! & (1 << (n & 7))) !== 0;
  };

  const dir = new THREE.Vector3(), side = new THREE.Vector3(), q = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  /** Blocked here: the ground, something wide (the centre line and both side lines are in it), or anything at the camera itself. */
  const blocked = (target: THREE.Vector3, d: number, atCamera: boolean) => {
    q.copy(target).addScaledVector(dir, d);
    if (q.y < heightAt(q.x, q.z) + 0.25) return true;
    if (!solid(q)) return false;
    if (atCamera) return true; // right where the camera is, anything solid counts
    q.add(side);
    if (!solid(q)) return false;
    q.addScaledVector(side, -2);
    return solid(q);
  };
  return {
    filled,
    clearDist(target, cam) {
      dir.subVectors(cam, target);
      const full = dir.length();
      if (full < 1e-3) return full;
      dir.divideScalar(full);
      // Side lines 0.5 m either way: a pipe, a post or a thin trunk only crosses the middle one.
      side.crossVectors(dir, UP);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.setLength(0.5);
      let leaving = true; // starting inside something (Khina in the burrow): skip until clear
      for (let d = 0.3; d < full; d += 0.2) {
        const b = blocked(target, d, d > full - 0.7);
        if (leaving) {
          if (!b) leaving = false;
          continue;
        }
        if (b) return Math.max(0.9, d - 0.45);
      }
      return full;
    },
  };
}
