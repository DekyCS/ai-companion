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
