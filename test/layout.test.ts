import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APPROACH, PATHS, SPOTS, nodes, placeXY } from '../src/world/layout.ts';
import { ACTIONS } from '../src/world/actions.ts';
import { PLACE_IDS } from '../src/world/places.ts';

test('every action has somewhere to happen in 3D, near its place', () => {
  for (const def of ACTIONS) {
    if (def.place === 'here') continue;
    const spot = SPOTS[def.id];
    assert.ok(spot, `${def.id} has a spot`);
    const [px, py] = APPROACH[def.place] ?? placeXY(def.place);
    const d = Math.hypot(spot.at[0] - px, spot.at[1] - py);
    assert.ok(d < 12, `${def.id} is ${d.toFixed(1)} m from ${def.place}`);
    if (spot.inside) assert.ok(def.place === 'burrow' || def.place === 'bakery', `${def.id} is indoors only where there is a door`);
  }
});

test('the paths reach every place', () => {
  const all = nodes();
  for (const [a, b] of PATHS) assert.ok(all[a] && all[b], `path ${a}–${b} joins known points`);
  const seen = new Set(['burrow']);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [a, b] of PATHS) {
      if (seen.has(a) !== seen.has(b)) {
        seen.add(a).add(b);
        grew = true;
      }
    }
  }
  for (const id of PLACE_IDS) assert.ok(seen.has(id), `${id} can be walked to`);
});

test('every villager has a spot wherever the sim can put them, clear of colliders, paths and Khina', async () => {
  const { VILLAGER_SPOTS } = await import('../src/world/layout.ts');
  const { newWorld, updatePresence } = await import('../src/world/village.ts');
  const { Rng } = await import('../src/rng.ts');
  const { readFileSync } = await import('node:fs');
  // Everywhere the sim puts anyone over two weeks of hours (with a traveller in town).
  const w = newWorld();
  const rng = new Rng(5);
  const seen = new Set<string>();
  for (let t = 0; t < 14 * 1440; t += 60) {
    w.travellerUntil = t + 1;
    updatePresence(w, t, rng);
    for (const [place, who] of Object.entries(w.present)) for (const v of who ?? []) seen.add(`${v}@${place}`);
  }
  for (const key of seen) {
    const [v, place] = key.split('@') as [string, string];
    assert.ok(VILLAGER_SPOTS[v]?.[place as keyof (typeof VILLAGER_SPOTS)[string]], `${v} has a spot at the ${place}`);
  }
  const terrain = JSON.parse(readFileSync('art/export/terrain.json', 'utf8')) as {
    colliders: ({ kind: 'circle'; x: number; y: number; r: number } | { kind: 'box'; x: number; y: number; w: number; d: number; rot: number })[];
  };
  const all = nodes();
  const segDist = ([px, py]: [number, number], [ax, ay]: [number, number], [bx, by]: [number, number]) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  for (const [v, places] of Object.entries(VILLAGER_SPOTS)) {
    for (const [place, spot] of Object.entries(places)) {
      const [x, y] = spot!.at;
      const name = `${v} at the ${place}`;
      for (const c of terrain.colliders) {
        if (c.kind === 'circle') assert.ok(Math.hypot(x - c.x, y - c.y) > c.r + 0.35, `${name} is clear of a post or tree at ${c.x},${c.y}`);
        else {
          const cos = Math.cos(-c.rot);
          const sin = Math.sin(-c.rot);
          const lx = (x - c.x) * cos - (y - c.y) * sin;
          const ly = (x - c.x) * sin + (y - c.y) * cos;
          assert.ok(Math.abs(lx) > c.w / 2 + 0.35 || Math.abs(ly) > c.d / 2 + 0.35, `${name} is clear of a wall or fence at ${c.x},${c.y}`);
        }
      }
      for (const [a, b] of PATHS) assert.ok(segDist([x, y], all[a]!, all[b]!) > 0.8, `${name} is off the ${a}–${b} path`);
      for (const [id, s] of Object.entries(SPOTS)) assert.ok(Math.hypot(x - s.at[0], y - s.at[1]) > 1.2, `${name} is clear of Khina's ${id} spot`);
      // The last stretch Khina walks, from where the path reaches a place to the spot for an action there.
      for (const def of ACTIONS) {
        const s = SPOTS[def.id];
        if (!s || def.place === 'here') continue;
        assert.ok(segDist([x, y], all[def.place]!, s.at) > 0.7, `${name} is out of Khina's way to ${def.id}`);
      }
    }
  }
});
