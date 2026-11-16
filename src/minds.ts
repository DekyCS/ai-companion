// Picks the mind for a run: code alone, the stuck stand-in, or Claude.

import { ClaudeMind } from './mind/claude.ts';
import { offlineMind, type Mind } from './mind/decide.ts';
import { stickyMind } from './mind/sticky.ts';

export type MindKind = 'offline' | 'sticky' | 'model';

export function makeMind(
  kind: MindKind,
  o: { seed: number; runDir: string; capUsd: number; night?: 'model' | 'code' },
): Mind {
  if (kind === 'sticky') return stickyMind(o.seed);
  if (kind === 'offline' || !process.env.ANTHROPIC_API_KEY) return offlineMind;
  const m = new ClaudeMind({ outDir: o.runDir, runCapUsd: o.capUsd });
  if (o.night !== 'code') return m;
  // Same Claude for days, but code does the night alone (no Opus page). Cheaper for experiments about choices.
  return {
    kind: m.kind,
    unavailable: () => m.unavailable(),
    propose: (s, list, rng) => m.propose(s, list, rng),
    narrate: (s, rec, recent, sense) => m.narrate(s, rec, recent, sense),
    stats: () => m.stats(),
  };
}
