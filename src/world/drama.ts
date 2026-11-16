// The drama manager: if nothing notable has happened for a while, the village makes
// something happen. Khina cannot cause or prevent these, which is the point.

import { addThought, applyEffects } from '../body.ts';
import { dramaCfg } from '../config.ts';
import type { Rng } from '../rng.ts';
import type { State } from '../state.ts';
import { hourOf } from '../time.ts';
import { bakeryOpen, generateFind, generateSight, newLetter } from './village.ts';

export type DramaEvent = 'letter' | 'traveller' | 'treefall' | 'seedcake' | 'kids';

export function maybeDrama(s: State, rng: Rng): { event: DramaEvent; text: string } | null {
  if (!s.features.drama) return null;
  const h = hourOf(s.t);
  if (h < 8 || h >= 19) return null;
  if (s.activity?.actionId === 'sleep') return null;
  if (s.t - s.lastNotable < dramaCfg.quietHours * 60 || s.t < s.dramaUntil) return null;

  const events: DramaEvent[] = ['letter', 'traveller', 'treefall', 'kids'];
  if (bakeryOpen(s.t)) events.push('seedcake');
  const event = rng.pick(events);
  const text = fire(s, rng, event);
  s.dramaUntil = s.t + dramaCfg.cooldownHours * 60;
  s.lastNotable = s.t;
  return { event, text };
}

function fire(s: State, rng: Rng, event: DramaEvent): string {
  const w = s.world;
  switch (event) {
    case 'letter':
      w.letters.push(newLetter(s.t, rng));
      w.flagSeen = false;
      return 'a letter arrived';
    case 'traveller': {
      w.travellerUntil = s.t + 180;
      const sq = (w.present.square ??= []);
      if (!sq.includes('traveller')) sq.push('traveller');
      addThought(s, { key: 'rumour', text: 'Heard there is a stranger in the square', value: 1, hours: 3 });
      return 'a traveller arrived in the square';
    }
    case 'treefall':
      for (let i = 0; i < 3; i++) w.sightsLeft.push(generateSight(w, rng));
      for (let i = 0; i < 2; i++) w.findsLeft.push(generateFind(w, rng));
      w.woodsNewsUntil = s.t + 24 * 60;
      addThought(s, { key: 'treefall', text: 'Heard a big tree came down in the woods', value: 2, hours: 10 });
      return 'a tree came down in the woods, opening new paths';
    case 'seedcake':
      w.bakeSpecialUntil = s.t + 300;
      addThought(s, { key: 'seedcake', text: 'Smell of seed cake drifting from the bakery', value: 2, hours: 5 });
      return 'Bramwell baked seed cake';
    case 'kids':
      if ((s.place === 'burrow' || s.place === 'shed') && s.activity?.kind !== 'walk') {
        applyEffects(s, { company: 12, novelty: 6 });
        addThought(s, { key: 'kids-visit', text: 'Pip and Nettle came knocking at the door', value: 3, hours: 6 });
        return 'Pip and Nettle knocked at the door';
      }
      w.letters.push({ from: 'kids', text: 'we came to your door and you were OUT. where do you go all day', t: s.t });
      w.flagSeen = false;
      return 'Pip and Nettle left a note';
  }
}
