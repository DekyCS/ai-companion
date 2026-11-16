// Once a night, while Khina sleeps: code updates beliefs and memory; the model (Opus) may
// write the night's diary page, choose memories to keep or drop, and propose one new line
// for the character sheet. Code checks every choice against its own records.

import { beliefs as beliefCfg, memoryCfg } from '../config.ts';
import type { Completed, NightPage, State } from '../state.ts';
import { clock, weekday } from '../time.ts';
import { actionDef } from '../world/actions.ts';
import { PLACES } from '../world/places.ts';
import { moodWord } from '../body.ts';
import type { Mind } from './decide.ts';
import { computeBeliefs, keyLabel } from './habit.ts';
import { forget, promote, promotionCandidates } from './memory.ts';

export interface ReflectInput {
  day: number;
  /** The day's facts, as written by code. */
  log: string;
  /** Short-term memories that may be kept for good ("m12": text). */
  keepable: { id: string; text: string }[];
  /** Short-term memories that may be dropped. */
  droppable: { id: string; text: string }[];
  /** Patterns strong enough to become a sheet line ("k1": text). */
  patterns: { id: string; text: string }[];
}

export interface ReflectOutput {
  page: string;
  keep: string[];
  drop: string[];
  sheetLine: string;
  evidence: string;
}

export const labelFor = (key: string) => keyLabel(key, (id) => actionDef(id).doing);

export function dayLog(records: Completed[]): string {
  return records
    .filter((r) => r.actionId !== 'idle')
    .map((r) => {
      const felt = r.felt === undefined ? '' : r.felt > 1.5 ? ' (felt better after)' : r.felt < -1.5 ? ' (felt worse after)' : '';
      const stale = r.stale !== undefined && r.stale < 0.6 ? ' (done a lot lately)' : '';
      return `- ${clock(r.start)} ${PLACES[r.place].at}: ${r.outcome}${felt}${stale}`;
    })
    .join('\n');
}

const BANNED = /\b(cozy|cosy|adventure|journey|magical|delightful|whimsical)\b/i;

function cleanLine(text: string, maxWords: number): string {
  const t = text.replace(/\s+/g, ' ').replace(/!/g, '.').trim();
  if (!t || BANNED.test(t) || t.split(' ').length > maxWords) return '';
  return /[.]$/.test(t) ? t : `${t}.`;
}

export async function nightly(s: State, day: number, records: Completed[], m: Mind): Promise<NightPage> {
  // 1. Beliefs come from code's counts.
  s.beliefs = computeBeliefs(s, labelFor);
  for (const line of s.learned) {
    if (s.beliefs.some((b) => b.key === line.key)) line.night = Math.max(line.night, day);
  }
  // A learned line with no support for a month fades from the sheet.
  s.learned = s.learned.filter((l) => day - l.night <= beliefCfg.windowDays);

  // 2. What the night may decide about.
  const candidates = promotionCandidates(s);
  const short = s.memories.filter((x) => x.tier === 'short');
  // Sheet lines are rare: actions only (places just echo them), strong evidence, one every few nights.
  const eligible = s.beliefs.filter(
    (b) => b.key.startsWith('a:') && b.days >= beliefCfg.sheetMinDays && !s.learned.some((l) => l.key === b.key),
  );
  const lastAdded = Math.max(0, ...s.learned.map((l) => l.added ?? 0));
  const canAddLine =
    eligible.length > 0 && s.learned.length < beliefCfg.maxLearnedLines && day - lastAdded >= beliefCfg.sheetEveryNights;

  let out: ReflectOutput | null = null;
  if (m.reflect && !m.unavailable()) {
    out = await m.reflect(s, {
      day,
      log: dayLog(records),
      keepable: candidates.map((x) => ({ id: `m${x.id}`, text: `${x.text} (${x.where})` })),
      droppable: short.map((x) => ({ id: `m${x.id}`, text: `${x.text} (${x.where})` })),
      patterns: canAddLine
        ? eligible.map((b, i) => ({ id: `k${i + 1}`, text: `${b.text} Mood went the same way on ${b.days} of ${b.of} days.` }))
        : [],
    });
  }

  // 3. Apply, but only what code allows.
  const num = (id: string) => Number(id.replace(/^m/, ''));
  const keepIds = out
    ? out.keep.map(num).filter((id) => candidates.some((c) => c.id === id))
    : candidates.slice(0, memoryCfg.promotePerNight).map((c) => c.id);
  const promoted = promote(s, keepIds);
  const dropIds = out ? out.drop.map(num).filter((id) => short.some((x) => x.id === id) && !keepIds.includes(id)).slice(0, 3) : [];
  const dropped = forget(s, dropIds);

  let sheetLine = '';
  if (canAddLine) {
    if (out) {
      const idx = Number(out.evidence.replace(/^k/, '')) - 1;
      const b = eligible[idx];
      const line = cleanLine(out.sheetLine, 14);
      if (b && line) {
        s.learned.push({ key: b.key, text: line, night: day, added: day });
        sheetLine = line;
      }
    } else {
      const b = eligible[0] as (typeof eligible)[number];
      const line = b.polarity === 'likes' ? `Has come to like ${labelFor(b.key)}.` : `Has gone off ${labelFor(b.key)}.`;
      s.learned.push({ key: b.key, text: line, night: day, added: day });
      sheetLine = line;
    }
  }

  s.lastReflectDay = day;
  const page: NightPage = {
    day,
    text: out ? cleanLine(out.page, 110) || out.page.trim() : '',
    by: out ? 'model' : 'none',
    promoted: promoted.map((x) => x.text),
    dropped: dropped.map((x) => x.text),
    sheetLine,
  };
  s.pages.push(page);
  return page;
}

export function reflectPrompt(s: State, input: ReflectInput): string {
  const lines = [
    `Day ${input.day}, ${weekday((input.day - 1) * 1440 + 720)}. Khina's mood tonight: ${moodWord(s.mood)}.`,
    '',
    "Today, from the village's records:",
    input.log || '- Nothing much.',
    '',
    'Memories that could be kept for good:',
    ...(input.keepable.length ? input.keepable.map((x) => `- ${x.id}: ${x.text}`) : ['- none']),
    '',
    'Short-term memories (may be dropped):',
    ...(input.droppable.length ? input.droppable.map((x) => `- ${x.id}: ${x.text}`) : ['- none']),
  ];
  if (input.patterns.length) {
    lines.push('', 'Patterns in the records (counted by code):', ...input.patterns.map((p) => `- ${p.id}: ${p.text}`));
  }
  lines.push('', 'Do the night jobs.');
  return lines.join('\n');
}

export const REFLECT_SCHEMA = {
  type: 'object',
  properties: {
    page: { type: 'string' },
    keep: { type: 'array', items: { type: 'string' } },
    drop: { type: 'array', items: { type: 'string' } },
    sheet_line: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['page', 'keep', 'drop', 'sheet_line', 'evidence'],
  additionalProperties: false,
} as const;
