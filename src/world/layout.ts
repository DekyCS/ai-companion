// Where things are in 3D, shared by the Blender scripts (via art/layout.json) and the browser.
// Metres on the ground plane: x east, y north (Blender's axes; the browser maps y to -z).
// Places come from places.ts scaled by SCALE, so walking times in the sim match distances here.

import { PLACES, PLACE_IDS, type PlaceId } from './places.ts';

export type XY = [number, number];

/** Metres per unit of the sim's place coordinates. */
export const SCALE = 3;

export const placeXY = (id: PlaceId): XY => [PLACES[id].x * SCALE, PLACES[id].y * SCALE];

/**
 * Where paths reach a place, when its centre is taken by something (the well, the bakery, the bench).
 * Khina walks to here, then to the spot for the action.
 */
export const APPROACH: Partial<Record<PlaceId, XY>> = {
  shed: [5.6, 2.4],
  bakery: [33, 3.4],
  square: [30.5, -2],
  patch: [18, 7.4],
  // In front of the internet hut's porch (the hut is at [18, -9], its front faces south).
  nethut: [18, -12.6],
};

/** Bends in the paths that are not places. */
export const JUNCTIONS: Record<string, XY> = {
  lane: [13.5, -1.5],
  fork: [-4.5, 12],
  // West of the oak, so the way to the woods goes round the trunk and its roots, not through them.
  oakwest: [-4.4, -0.6],
  // On the lane down to the stream, where the little path to the internet hut turns off.
  netlane: [12.27, -12.6],
};

/** Dirt paths between places and junctions. Khina walks along these. */
export const PATHS: [string, string][] = [
  ['burrow', 'shed'],
  ['burrow', 'lane'],
  ['shed', 'lane'],
  ['lane', 'patch'],
  ['lane', 'netlane'],
  ['netlane', 'stream'],
  ['netlane', 'nethut'],
  ['lane', 'square'],
  ['square', 'bakery'],
  ['patch', 'bakery'],
  ['square', 'halt'],
  ['burrow', 'oakwest'],
  ['oakwest', 'fork'],
  ['fork', 'woods'],
  ['fork', 'clearing'],
];

export interface Spot {
  /** Where Khina stands. */
  at: XY;
  /** Height above the ground (on a bench, say). */
  z?: number;
  /** A point Khina faces. */
  face: XY;
  /** Inside a building: Khina is out of sight. */
  inside?: boolean;
  /** How Khina holds still there. */
  pose: 'stand' | 'sit' | 'curl' | 'sniff' | 'work' | 'eat' | 'paddle';
  /** For work at a table: the height of its top above the ground, where her front paws rest. */
  table?: number;
}

const BURROW_DOOR: XY = [0, 0.6];
const BAKERY_DOOR: XY = [33, 4.6];

/** Where each action happens. */
export const SPOTS: Record<string, Spot> = {
  sleep: { at: BURROW_DOOR, face: [0, 3], inside: true, pose: 'curl' },
  nap: { at: BURROW_DOOR, face: [0, 3], inside: true, pose: 'curl' },
  snack: { at: BURROW_DOOR, face: [0, 3], inside: true, pose: 'eat' },
  tidy: { at: BURROW_DOOR, face: [0, 3], inside: true, pose: 'work' },
  rain: { at: BURROW_DOOR, face: [0, 3], inside: true, pose: 'sit' },
  letterbox: { at: [2.2, -1.1], face: [2.2, 0], pose: 'stand' },
  // At the shed's workbench (front edge y 4.2, top 0.55): up on her haunches, paws on the edge.
  whittle: { at: [5, 3.93], face: [5, 5], pose: 'work', table: 0.55 },
  draw: { at: [5.9, 3.93], face: [5.9, 5], pose: 'work', table: 0.55 },
  sort: { at: [4.1, 3.93], face: [4.1, 5], pose: 'work', table: 0.55 },
  tinker: { at: [5.3, 3.93], face: [5.3, 5], pose: 'work', table: 0.55 },
  crusts: { at: [30.6, 3.4], face: [29.6, 3.6], pose: 'eat' },
  warm: { at: BAKERY_DOOR, face: [33, 7], inside: true, pose: 'sit' },
  bench: { at: [27, -0.15], z: 0.5, face: [27, -4], pose: 'sit' },
  chat: { at: [29.4, -4.4], face: [27, -3.4], pose: 'stand' },
  weed: { at: [17, 8], face: [17, 10], pose: 'work' },
  pea: { at: [20.6, 8], face: [20.6, 10], pose: 'eat' },
  // On the north bank, facing the water (the stream is about 3.5 m wide; its middle here is at y -17.8).
  paddle: { at: [9.4, -15.84], face: [9.4, -18], pose: 'paddle' },
  fish: { at: [12.4, -15.7], face: [12.4, -18], pose: 'sit' },
  dam: { at: [14.8, -15.92], face: [15, -18], pose: 'work' },
  forage: { at: [-16.4, 16.6], face: [-15, 15], pose: 'sniff' },
  birds: { at: [-18.6, 18.4], face: [-19, 21], pose: 'sit' },
  explore: { at: [-24, 24], face: [-27, 27], pose: 'sniff' },
  poke: { at: [-6.6, 31], face: [-5.5, 32], pose: 'sniff' },
  moss: { at: [-9.6, 29.4], face: [-9, 31], pose: 'curl' },
  train: { at: [44.4, -9], z: 0.45, face: [47, -9], pose: 'sit' },
  timetable: { at: [44.4, -5.6], z: 0.45, face: [45.4, -5.6], pose: 'stand' },
  // The internet hut: Khina sits on the front of a cushion (centre [18.01, -11.43], top 0.08) at
  // the old computer on the porch, paws on the keyboard (top 0.31) in front of her.
  browse: { at: [17.78, -11.31], z: 0.08, face: [17.38, -11.09], pose: 'work', table: 0.31 },
  post: { at: [17.78, -11.31], z: 0.08, face: [17.38, -11.09], pose: 'work', table: 0.31 },
  nethut_idle: { at: [18.95, -11.05], face: [18.95, -13], pose: 'stand' },
};

/**
 * Where each villager stands when the sim says they are at a place (s.world.present), and what they
 * face. Off Khina's own spots and the paths, so Khina never walks through them. Villagers are only
 * ever at the bakery, the vegetable patch or the square (src/world/village.ts updatePresence).
 * Browser only: not in layoutJson, so the village model doesn't change.
 */
export const VILLAGER_SPOTS: Record<string, Partial<Record<PlaceId, { at: XY; face: XY }>>> = {
  // By the bakery door, to one side, looking out for customers.
  bramwell: { bakery: { at: [34.7, 4.3], face: [33, 2.4] } },
  // In the patch she tends the peas from the open side; in the square she sits west of the well.
  wren: { patch: { at: [18.8, 8.7], face: [18.8, 10.5] }, square: { at: [24, -3.4], face: [27, -3.4] }, bakery: { at: [35.6, 3.2], face: [34.7, 4.3] } },
  tansy: { square: { at: [28.5, -5.7], face: [29.4, -4.4] }, bakery: { at: [35.6, 3.2], face: [34.7, 4.3] } },
  kids: { square: { at: [25, -5.2], face: [27, -3.4] } },
  voles: { square: { at: [29.7, -7], face: [29.4, -4.4] }, bakery: { at: [35.6, 3.2], face: [34.7, 4.3] } },
  traveller: { square: { at: [32.6, -5], face: [29.4, -4.4] } },
};

/** Chimney tops, where the browser puffs smoke when a fire is lit. */
export const CHIMNEYS: Record<string, [number, number, number]> = {
  burrow: [1.5, 4.4, 3.1],
  bakery: [34.8, 8.6, 6.0],
};

/** Every node Khina can walk through, with its position. */
export function nodes(): Record<string, XY> {
  const out: Record<string, XY> = { ...JUNCTIONS };
  for (const id of PLACE_IDS) out[id] = APPROACH[id] ?? placeXY(id);
  return out;
}

/** Everything the Blender scripts need, as plain JSON. */
export function layoutJson(): object {
  return {
    scale: SCALE,
    places: Object.fromEntries(PLACE_IDS.map((id) => [id, placeXY(id)])),
    junctions: JUNCTIONS,
    nodes: nodes(),
    paths: PATHS,
    spots: SPOTS,
    doors: { burrow: BURROW_DOOR, bakery: BAKERY_DOOR },
    chimneys: CHIMNEYS,
  };
}
