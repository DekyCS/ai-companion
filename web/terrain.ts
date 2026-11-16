// The lie of the land, as art/village.py wrote it to art/export/terrain.json: ground height,
// where grass grows, and what you cannot walk through. All in layout metres (x east, y north);
// three.js puts (x, y) at (x, height, -y).
//
// terrain.json:
//   origin [x0, y0]  layout metres of sample (0, 0)
//   step             metres between samples
//   nx, ny           samples along x and along y
//   height[]         nx*ny metres, index j*nx + i is (x0 + i*step, y0 + j*step)
//   grass[]          nx*ny, 0..1: how thick the grass grows (0 on paths, water, floors)
//   colliders[]      {kind:'circle', x, y, r} or {kind:'box', x, y, w, d, rot}
//                    (box: centre, size along its own x and y, rot radians about up)

export type Collider = { kind: 'circle'; x: number; y: number; r: number } | { kind: 'box'; x: number; y: number; w: number; d: number; rot: number };

export interface Terrain {
  heightAt(x: number, y: number): number;
  grassAt(x: number, y: number): number;
  /** Moves a circle of radius r out of every collider it overlaps; returns the new centre. */
  push(x: number, y: number, r: number): [number, number];
  bounds: { x0: number; y0: number; x1: number; y1: number };
  colliders: Collider[];
}

interface File {
  origin: [number, number];
  step: number;
  nx: number;
  ny: number;
  height: number[];
  grass: number[];
  colliders: Collider[];
}

export async function loadTerrain(url = '/art/export/terrain.json'): Promise<Terrain> {
  let f: File | null = null;
  try {
    const res = await fetch(url);
    if (res.ok) f = (await res.json()) as File;
  } catch {
    f = null;
  }
  return f ? fromFile(f) : flat();
}

function flat(): Terrain {
  return {
    heightAt: () => 0,
    grassAt: () => 1,
    push: (x, y) => [x, y],
    bounds: { x0: -60, y0: -60, x1: 80, y1: 70 },
    colliders: [],
  };
}

function fromFile(f: File): Terrain {
  const [x0, y0] = f.origin;
  const { step, nx, ny } = f;
  const h = Float32Array.from(f.height);
  const g = Float32Array.from(f.grass);
  const sample = (arr: Float32Array, x: number, y: number) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / step));
    const fy = Math.min(ny - 1.001, Math.max(0, (y - y0) / step));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const a = arr[j * nx + i]!;
    const b = arr[j * nx + i + 1]!;
    const c = arr[(j + 1) * nx + i]!;
    const d = arr[(j + 1) * nx + i + 1]!;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };

  // A coarse grid of colliders, so pushing out only looks at what is nearby.
  const CELL = 4;
  const grid = new Map<string, Collider[]>();
  const reach = (c: Collider) => (c.kind === 'circle' ? c.r : Math.hypot(c.w, c.d) / 2);
  for (const c of f.colliders) {
    const r = reach(c) + 1;
    for (let gx = Math.floor((c.x - r) / CELL); gx <= Math.floor((c.x + r) / CELL); gx++)
      for (let gy = Math.floor((c.y - r) / CELL); gy <= Math.floor((c.y + r) / CELL); gy++) {
        const k = `${gx},${gy}`;
        grid.set(k, [...(grid.get(k) ?? []), c]);
      }
  }

  function push(x: number, y: number, r: number): [number, number] {
    for (let pass = 0; pass < 3; pass++) {
      const near = grid.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) ?? [];
      let moved = false;
      for (const c of near) {
        if (c.kind === 'circle') {
          const dx = x - c.x;
          const dy = y - c.y;
          const d = Math.hypot(dx, dy);
          const min = c.r + r;
          if (d < min) {
            const k = d > 1e-6 ? (min - d) / d : 0;
            x += d > 1e-6 ? dx * k : min;
            y += d > 1e-6 ? dy * k : 0;
            moved = true;
          }
        } else {
          // Into the box's own frame, clamp to its rectangle, push out from the nearest point.
          const cs = Math.cos(-c.rot);
          const sn = Math.sin(-c.rot);
          const lx = (x - c.x) * cs - (y - c.y) * sn;
          const ly = (x - c.x) * sn + (y - c.y) * cs;
          const hw = c.w / 2;
          const hd = c.d / 2;
          const qx = Math.max(-hw, Math.min(hw, lx));
          const qy = Math.max(-hd, Math.min(hd, ly));
          let ox = lx - qx;
          let oy = ly - qy;
          let d = Math.hypot(ox, oy);
          if (d >= r) continue;
          if (d < 1e-6) {
            // Centre inside the box: leave by the nearest side.
            const sides = [hw - lx, lx + hw, hd - ly, ly + hd];
            const m = sides.indexOf(Math.min(...sides));
            ox = m === 0 ? 1 : m === 1 ? -1 : 0;
            oy = m === 2 ? 1 : m === 3 ? -1 : 0;
            d = 0;
            const out = sides[m]! + r;
            const nx2 = lx + ox * out;
            const ny2 = ly + oy * out;
            x = c.x + nx2 * Math.cos(c.rot) - ny2 * Math.sin(c.rot);
            y = c.y + nx2 * Math.sin(c.rot) + ny2 * Math.cos(c.rot);
          } else {
            const k = (r - d) / d;
            const nx2 = lx + ox * k;
            const ny2 = ly + oy * k;
            x = c.x + nx2 * Math.cos(c.rot) - ny2 * Math.sin(c.rot);
            y = c.y + nx2 * Math.sin(c.rot) + ny2 * Math.cos(c.rot);
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    return [x, y];
  }

  return {
    heightAt: (x, y) => sample(h, x, y),
    grassAt: (x, y) => sample(g, x, y),
    push,
    bounds: { x0, y0, x1: x0 + (nx - 1) * step, y1: y0 + (ny - 1) * step },
    colliders: f.colliders,
  };
}
