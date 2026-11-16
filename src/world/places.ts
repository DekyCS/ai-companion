// The forest village. Coordinates are rough hedgehog-scale distances.

export type PlaceId = 'burrow' | 'shed' | 'bakery' | 'square' | 'patch' | 'stream' | 'woods' | 'clearing' | 'halt';

export interface Place {
  id: PlaceId;
  /** Full name, used in prompts. */
  name: string;
  /** Short name, used in summaries: "the woods". */
  short: string;
  x: number;
  y: number;
  outdoors: boolean;
  /** "in the woods", for memories. */
  at: string;
}

export const PLACES: Record<PlaceId, Place> = {
  burrow: { id: 'burrow', name: 'the burrow under the old oak (home)', short: 'the burrow', x: 0, y: 0, outdoors: false, at: 'in the burrow' },
  shed: { id: 'shed', name: 'the little shed with the workbench', short: 'the shed', x: 2, y: 1.5, outdoors: false, at: 'in the shed' },
  bakery: { id: 'bakery', name: "Bramwell's bakery", short: 'the bakery', x: 11, y: 2, outdoors: false, at: 'at the bakery' },
  square: { id: 'square', name: 'the village square', short: 'the square', x: 9, y: -1, outdoors: true, at: 'in the square' },
  patch: { id: 'patch', name: 'the vegetable patch', short: 'the vegetable patch', x: 6, y: 3, outdoors: true, at: 'at the vegetable patch' },
  stream: { id: 'stream', name: 'the stream', short: 'the stream', x: 4, y: -5, outdoors: true, at: 'by the stream' },
  woods: { id: 'woods', name: 'the deep woods', short: 'the woods', x: -6, y: 6, outdoors: true, at: 'in the woods' },
  clearing: { id: 'clearing', name: 'the mossy clearing', short: 'the clearing', x: -3, y: 10, outdoors: true, at: 'in the clearing' },
  halt: { id: 'halt', name: 'the little train halt', short: 'the halt', x: 14, y: -3, outdoors: true, at: 'at the halt' },
};

export const PLACE_IDS = Object.keys(PLACES) as PlaceId[];

/** Walking time in game minutes. */
export function travelMinutes(from: PlaceId, to: PlaceId): number {
  if (from === to) return 0;
  const a = PLACES[from];
  const b = PLACES[to];
  return Math.max(2, Math.round(Math.hypot(a.x - b.x, a.y - b.y) * 1.5));
}
