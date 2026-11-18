// A stand-in for a language model stuck in a rut: it always proposes its same few favourite
// actions with high weight, whatever is going on. Free to run, so the anti-repetition systems
// can be tested against the failure they exist for (LLM life-loops reach 95%+ repetition).

import type { Rng } from '../rng.ts';
import { Rng as Seeded } from '../rng.ts';
import type { State } from '../state.ts';
import { ACTION_IDS, BEYOND_IDS } from '../world/actions.ts';
import { offlineMind, type Mind, type Proposal } from './decide.ts';
import type { Option } from './score.ts';

export function stickyMind(seed: number): Mind {
  // One fixed preference order per copy, like a model's frozen idea of what a bunny "would do".
  const order = new Seeded(seed * 31 + 7).shuffle(ACTION_IDS.filter((id) => !BEYOND_IDS.has(id)));
  const rank = new Map(order.map((id, i) => [id, i]));
  return {
    kind: 'model',
    unavailable: () => null,
    async propose(_s: State, list: Option[], _rng: Rng): Promise<Proposal> {
      const picks = [...list].sort((a, b) => (rank.get(a.def.id) ?? 99) - (rank.get(b.def.id) ?? 99)).slice(0, 3);
      return {
        ok: true,
        candidates: picks.map((o, i) => ({ action: o.def.id, reason: 'As usual.', weight: [10, 6, 3][i] ?? 1, detail: '' })),
      };
    },
    narrate: async () => null,
    stats: () => offlineMind.stats(),
  };
}
