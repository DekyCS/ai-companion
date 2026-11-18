// The village clock. Runs minute by minute: the body ticks, actions start and finish,
// the world changes on the hour. Every event is appended to events.jsonl.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { addThought, applyEffects, needThoughts, tickBody } from './body.ts';
import { habit, memoryCfg, NEEDS, type Effects, type Needs } from './config.ts';
import { decay, feltValue, noveltyFactor, recordFeeling, recordUse, ROUTINE, staleEffects, staleFactor, unfamiliarNovelty } from './mind/habit.ts';
import { remember } from './mind/memory.ts';
import { nightly } from './mind/sleep.ts';
import { maybeDrama } from './world/drama.ts';
import { decide, SENSES, type Decision, type Mind } from './mind/decide.ts';
import { onMind, STALE_NOTE, templateDiary } from './mind/prompts.ts';
import { formFor, pieceRequest } from './mind/making.ts';
import type { PieceStore } from './pieces.ts';
import { Rng as Seeded, type Rng } from './rng.ts';
import { HISTORY_KEEP, type Activity, type Completed, type FoodId, type State, type WorkResult } from './state.ts';
import { clock, dayOf, hourOf, minuteOfDay, stamp } from './time.ts';
import { actionDef, type ActionDef, type Ctx } from './world/actions.ts';
import { PLACES, travelMinutes } from './world/places.ts';
import { isWet, newLetter, nextWeather, presentAt, updatePresence } from './world/village.ts';

/** Report days run from 06:00 to 06:00, so a night's sleep belongs to the day before it. */
export const reportDay = (t: number) => dayOf(t - 360);

export interface DayStats {
  day: number;
  minutes: number;
  sleepMin: number;
  starvingMin: number;
  exhaustedMin: number;
  longestPastLine: Needs;
  moodMin: number;
  moodMax: number;
}

export interface HourSnap {
  t: number;
  place: string;
  doing: string;
  weather: string;
  mood: number;
  energy: number;
  needs: Needs;
}

export interface SimOptions {
  mind: Mind;
  rng: Rng;
  /** Where events.jsonl goes. null writes nothing (tests). */
  outDir: string | null;
  /** Real milliseconds to wait per game minute. 0 runs as fast as possible. */
  speedMs?: number;
  onLine?: (line: string) => void;
  /** Every event as it happens (the live server forwards these to the browser). */
  onEvent?: (e: Record<string, unknown>) => void;
  /**
   * Live server only: where real pieces are kept. With it, Khina may make real things, have ideas
   * of its own and use the internet hut (when the model is on and the budget lasts). Without it the
   * village life is exactly the fixed one, so experiments measure what they always measured.
   */
  pieces?: PieceStore;
}

/** How long the sim waits, at most, for real work to come back when an action ends. */
const WORK_WAIT_MS = 150_000;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Sim {
  readonly s: State;
  readonly log: Completed[] = [];
  readonly decisions: Decision[] = [];
  readonly days = new Map<number, DayStats>();
  readonly hours: HourSnap[] = [];
  private readonly rng: Rng;
  private readonly mind: Mind;
  private readonly outDir: string | null;
  private readonly speedMs: number;
  private readonly onLine: (line: string) => void;
  private readonly onEvent: ((e: Record<string, unknown>) => void) | null;
  private decisionCount = 0;
  private readonly pieces: PieceStore | null;
  /** Real work running for an activity, by decision id. */
  private readonly jobs = new Map<number, Promise<WorkResult>>();
  /** Random numbers for real work, kept off the seeded stream. */
  private readonly workRng = new Seeded(Date.now() % 2147483647);

  constructor(s: State, o: SimOptions) {
    this.s = s;
    this.rng = o.rng;
    this.mind = o.mind;
    this.outDir = o.outDir;
    this.speedMs = o.speedMs ?? 0;
    this.onLine = o.onLine ?? (() => {});
    this.onEvent = o.onEvent ?? null;
    this.pieces = o.pieces ?? null;
    s.pieces ??= [];
    s.readings ??= [];
    if (this.outDir) mkdirSync(this.outDir, { recursive: true });
    updatePresence(s.world, s.t, this.rng);
  }

  async run(until: number): Promise<void> {
    while (this.s.t < until) {
      await this.tick();
      if (this.speedMs > 0) await wait(this.speedMs);
    }
    this.s.rngState = this.rng.state;
  }

  private ctx(): Ctx {
    return { s: this.s, rng: this.rng, at: this.s.t };
  }

  async tick(): Promise<void> {
    const s = this.s;
    if (minuteOfDay(s.t) % 60 === 0) this.hourly();
    if (!s.activity) await this.startNext();
    const a = s.activity as Activity;
    const def = actionDef(a.actionId);
    const asleep = a.kind === 'act' && def.id === 'sleep';
    tickBody(s, a.kind === 'act' ? perMinute(def, a) : null, asleep);
    this.count(asleep);
    s.t += 1;
    if (s.place === 'burrow' && s.world.letters.length > 0) s.world.flagSeen = true;

    if (a.kind === 'walk') {
      if (s.t >= (a.endsAt as number)) await this.arrive(a);
    } else if (def.done ? def.done(s, a) : s.t >= (a.endsAt as number)) {
      await this.complete(def, a);
    }

    // Once a night, when Khina goes down for the night, the day is reflected on.
    const now = s.activity;
    if (now?.actionId === 'sleep' && now.kind === 'act' && now.wakeAfter !== undefined) {
      const day = reportDay(now.startedAt);
      if (s.lastReflectDay < day) await this.reflect(day);
    }
  }

  private async reflect(day: number): Promise<void> {
    const page = await nightly(this.s, day, this.log.filter((r) => reportDay(r.start) === day), this.mind);
    this.event({ type: 'night', ...page, beliefs: this.s.beliefs, learned: this.s.learned });
    if (page.text) this.onLine(`${' '.repeat(10)}night ☾ ${page.text}`);
    if (page.sheetLine) this.onLine(`${' '.repeat(10)}sheet + ${page.sheetLine}`);
  }

  private hourly(): void {
    const s = this.s;
    const w = s.world;
    decay(s, 60);
    w.weather = nextWeather(w.weather, s.t, this.rng);
    updatePresence(w, s.t, this.rng);
    const drama = maybeDrama(s, this.rng);
    if (drama) {
      this.event({ type: 'drama', ...drama });
      this.onLine(`${stamp(s.t)}  ✦ ${drama.text}`);
    }
    const h = hourOf(s.t);
    if (h >= 8 && h < 19 && w.letters.length < 2 && this.rng.chance(0.06)) {
      w.letters.push(newLetter(s.t, this.rng));
      w.flagSeen = false;
      this.event({ type: 'letter', from: w.letters[w.letters.length - 1]?.from });
    }
    const out = s.activity?.kind === 'walk' || PLACES[s.place].outdoors;
    if (isWet(w.weather) && out && s.activity?.actionId !== 'sleep') {
      applyEffects(s, { calm: -3 });
      addThought(s, { key: 'wet', text: 'Got rained on', value: -2, hours: 2 });
    }
    const a = s.activity;
    const snap: HourSnap = {
      t: s.t,
      place: PLACES[s.place].short,
      doing: !a ? '' : a.kind === 'walk' ? `walking to ${PLACES[a.place].short}` : actionDef(a.actionId).doing,
      weather: w.weather,
      mood: Math.round(s.mood),
      energy: Math.round(s.energy),
      needs: { ...s.needs },
    };
    this.hours.push(snap);
    this.event({ type: 'hour', ...snap, needs: roundNeeds(s.needs) });
  }

  private count(asleep: boolean): void {
    const s = this.s;
    const d = reportDay(s.t);
    let st = this.days.get(d);
    if (!st) {
      st = {
        day: d, minutes: 0, sleepMin: 0, starvingMin: 0, exhaustedMin: 0,
        longestPastLine: Object.fromEntries(NEEDS.map((n) => [n, 0])) as Needs,
        moodMin: s.mood, moodMax: s.mood,
      };
      this.days.set(d, st);
    }
    st.minutes += 1;
    if (asleep) st.sleepMin += 1;
    if (s.needs.fullness < 10) st.starvingMin += 1;
    if (s.needs.rest < 12) st.exhaustedMin += 1;
    for (const n of NEEDS) st.longestPastLine[n] = Math.max(st.longestPastLine[n], s.pastLine[n]);
    st.moodMin = Math.min(st.moodMin, s.mood);
    st.moodMax = Math.max(st.moodMax, s.mood);
  }

  private async startNext(): Promise<void> {
    const s = this.s;
    if (this.pieces) {
      const modelUp = this.mind.kind === 'model' && this.mind.unavailable() === null;
      // Making and the internet only while there is budget for the real thing, so the diary never
      // says Khina made something that is not in the Gallery.
      const work = modelUp && !!this.mind.canWork?.();
      s.world.can = { make: work, own: modelUp, net: work, post: modelUp && !!this.mind.canPost?.() };
    }
    const d = await decide(s, this.rng, this.mind, ++this.decisionCount);
    this.decisions.push(d);
    this.event({ type: 'decision', ...d });
    const def = actionDef(d.actionId);
    const place = d.place ?? (def.place === 'here' ? s.place : def.place);
    const base: Activity = {
      kind: 'walk', actionId: def.id, detail: d.detail, reason: d.reason, origin: d.origin, place,
      startedAt: s.t, endsAt: null, duration: 0, moodBefore: s.mood, decisionId: d.id,
    };
    const what = `${def.label}${d.detail ? ` (${d.detail})` : ''}`;
    this.onLine(`${stamp(s.t)}  ${pad(PLACES[s.place].short, 20)} → ${what}  · "${d.reason}" [${d.origin}${d.why ? `: ${d.why}` : ''}]`);
    if (place !== s.place) {
      s.activity = { ...base, endsAt: s.t + travelMinutes(s.place, place) };
    } else {
      this.begin(def, base);
    }
  }

  private begin(def: ActionDef, a: Activity): void {
    const s = this.s;
    const c = this.ctx();
    const duration = def.duration?.(c) ?? this.rng.int(def.minutes[0], def.minutes[1]);
    const act: Activity = {
      ...a,
      kind: 'act',
      startedAt: s.t,
      duration: def.done ? 0 : duration,
      endsAt: def.done ? null : s.t + duration,
      who: [...presentAt(s.world, a.place)],
      stale: staleFactor(s, def),
      needBefore: needMood(s),
    };
    def.begin?.(c, act);
    s.activity = act;
    this.startWork(def, act);
    this.event({ type: 'start', id: def.id, place: act.place, endsAt: act.endsAt, wakeAfter: act.wakeAfter });
  }

  private async arrive(a: Activity): Promise<void> {
    const s = this.s;
    s.place = a.place;
    const def = actionDef(a.actionId);
    const why = def.blocked?.(this.ctx());
    if (!why) {
      this.begin(def, a);
      return;
    }
    const short = PLACES[a.place].short;
    addThought(s, { key: 'thwarted', text: `Walked to ${short} for nothing`, value: -2, hours: 2 });
    await this.finish(
      {
        kind: 'refused', actionId: def.id, label: def.label, gist: def.gist, place: a.place,
        start: a.startedAt, end: s.t, detail: a.detail, reason: a.reason, origin: a.origin,
        outcome: `walked to ${short} to ${def.label}, but ${why}`,
        who: [...presentAt(s.world, a.place)],
        diary: '', diaryBy: 'none', moodBefore: a.moodBefore, moodAfter: s.mood,
      },
      true,
    );
  }

  /** Starts the real work behind an action (a piece, a search), if there is any to do. */
  private startWork(def: ActionDef, act: Activity): void {
    const m = this.mind;
    const store = this.pieces;
    if (!def.work || !store) return;
    const s = this.s;
    // Asking the same thing twice: Khina remembers the answer, and no search is paid for.
    const before = def.work === 'web' ? s.readings.findLast((r) => sameQuestion(r.question, act.detail)) : undefined;
    if (before) {
      this.jobs.set(act.decisionId, Promise.resolve({ kind: 'web', reading: before, again: true }));
      return;
    }
    if (def.work === 'post') {
      if (!m.writePost || !m.canPost?.()) return;
      const latest = s.pieces.at(-1);
      const hoursAgo = latest ? (s.t - latest.t) / 60 : null;
      const recent = this.log.filter((r) => r.diary).slice(-5).map((r) => r.diary as string);
      const job = m.writePost(s, act.detail, recent, latest, hoursAgo).then((p): WorkResult =>
        typeof p === 'string'
          ? { kind: 'none', why: p }
          : { kind: 'post', post: { t: s.t, text: p.text, about: act.detail, ...(p.sharePiece && latest ? { piece: { id: latest.id, title: latest.title, form: latest.form } } : {}) } },
      );
      this.jobs.set(act.decisionId, job.catch((err: unknown) => ({ kind: 'none', why: String(err).slice(0, 120) })));
      return;
    }
    if (!m.canWork?.()) return;
    const mindLine = onMind(s, 1, false)[0] ?? '';
    let job: Promise<WorkResult> | null = null;
    if (def.work === 'piece' && m.makePiece) {
      const draw = def.id === 'draw';
      const form = draw ? 'picture' : formFor(act.detail, this.workRng);
      const req = pieceRequest(s, form, act.detail, draw ? 'charcoal on a strip of bark' : '', this.workRng, mindLine);
      job = m.makePiece(s, req).then((d) => (typeof d === 'string' ? { kind: 'none', why: d } : { kind: 'piece', piece: store.save(d, s.t) }));
    }
    if (def.work === 'web' && m.browse) {
      job = m.browse(s, act.detail, mindLine).then((r) => (typeof r === 'string' ? { kind: 'none', why: r } : { kind: 'web', reading: r }));
    }
    if (job) this.jobs.set(act.decisionId, job.catch((err: unknown) => ({ kind: 'none', why: String(err).slice(0, 120) })));
  }

  private async collectWork(a: Activity): Promise<void> {
    const job = this.jobs.get(a.decisionId);
    if (!job) return;
    this.jobs.delete(a.decisionId);
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<WorkResult>((r) => (timer = setTimeout(() => r({ kind: 'none', why: 'took too long' }), WORK_WAIT_MS)));
    a.result = await Promise.race([job, late]);
    clearTimeout(timer);
    const s = this.s;
    const r = a.result;
    if (r.kind === 'piece') {
      s.pieces.push(r.piece);
      if (s.pieces.length > 200) s.pieces.splice(0, s.pieces.length - 200);
      this.event({ type: 'piece', piece: r.piece });
      this.onLine(`${' '.repeat(10)}✎ made ${r.piece.form === 'toy' ? 'a little game' : `a ${r.piece.form}`}: "${r.piece.title}"`);
    } else if (r.kind === 'web' && r.again) {
      this.onLine(`${' '.repeat(10)}⌕ asked again "${r.reading.question}" (remembered, no search)`);
    } else if (r.kind === 'web') {
      s.readings.push(r.reading);
      if (s.readings.length > 60) s.readings.splice(0, s.readings.length - 60);
      this.event({ type: 'reading', reading: r.reading });
      this.onLine(`${' '.repeat(10)}⌕ looked up "${r.reading.question}": ${r.reading.learned}`);
    } else if (r.kind === 'post') {
      s.posts ??= [];
      s.posts.push(r.post);
      if (s.posts.length > 100) s.posts.splice(0, s.posts.length - 100);
      this.event({ type: 'post', post: r.post });
      this.onLine(`${' '.repeat(10)}✉ posted: ${r.post.text}`);
    } else {
      this.event({ type: 'work-failed', why: r.why });
      this.onLine(`${' '.repeat(10)}✗ real work failed: ${r.why}`);
    }
  }

  private async complete(def: ActionDef, a: Activity): Promise<void> {
    const s = this.s;
    await this.collectWork(a);
    const out = def.outcome?.(this.ctx(), a) ?? { text: def.doing };
    const stale = a.stale ?? 1;
    const newness = noveltyFactor(def, stale);
    if (out.extra) applyEffects(s, staleEffects(out.extra, newness));
    // Doing something unfamiliar is itself new; doing the same old thing is noticed.
    const curiosity = unfamiliarNovelty(s, def, a.place);
    if (curiosity) applyEffects(s, { novelty: curiosity });
    if (stale < habit.feltBelow && !ROUTINE.has(def.id)) {
      out.text += STALE_NOTE;
      if (!out.thought) out.thought = { key: 'stale', text: `${capital(def.gist)} did less for me than it used to`, value: -1, hours: 3 };
    }
    recordUse(s, def, a.place);
    if (out.pantry) {
      for (const [k, v] of Object.entries(out.pantry) as [FoodId, number][]) s.pantry[k] = Math.max(0, s.pantry[k] + v);
    }
    if (out.find) s.finds.push({ name: out.find, t: s.t });
    if (out.made) s.made.push({ what: out.made, t: s.t });
    if (out.thought) addThought(s, out.thought);
    s.recent.unshift(def.id);
    s.recent.length = Math.min(s.recent.length, 10);

    // How it actually felt becomes taste and evidence. Strong moments become memories.
    const felt = feltValue(out.thought?.value ?? 0, needMood(s) - (a.needBefore ?? needMood(s)));
    recordFeeling(s, def, a.place, felt);
    const strength = Math.abs(out.thought?.value ?? 0) + (out.find ? 1 : 0) + (out.made ? 1 : 0);
    if (out.thought && strength >= memoryCfg.minSalience) {
      remember(s, { text: out.thought.text, where: PLACES[a.place].at, category: out.thought.key.split('-')[0] as string, salience: strength });
    }
    if (strength >= 3) s.lastNotable = s.t;
    await this.finish(
      {
        kind: 'done', actionId: def.id, label: def.label, gist: def.gist, place: a.place,
        start: a.startedAt, end: s.t, detail: a.detail, reason: a.reason, origin: a.origin,
        outcome: out.text, diary: '', diaryBy: 'none', moodBefore: a.moodBefore, moodAfter: s.mood,
        who: a.who ?? [], stale, felt: Math.round(felt * 10) / 10,
      },
      def.diary !== false,
    );
  }

  private async finish(rec: Completed, writeDiary: boolean): Promise<void> {
    const s = this.s;
    s.activity = null;
    if (writeDiary) {
      const recent = this.log.filter((r) => r.diary).slice(-4).map((r) => r.diary);
      // Only draw from the seeded random stream when the model is on, so offline replays stay identical.
      const sense = this.mind.kind === 'model' ? this.rng.pick(SENSES) : 'none';
      const line = await this.mind.narrate(s, rec, recent, sense);
      rec.diary = line ?? templateDiary(rec);
      rec.diaryBy = line ? 'model' : 'template';
    }
    s.history.push(rec);
    if (s.history.length > HISTORY_KEEP) s.history.splice(0, s.history.length - HISTORY_KEEP);
    this.log.push(rec);
    this.event({ type: rec.kind, ...rec });
    if (rec.diary) this.onLine(`${' '.repeat(10)}${clock(rec.end)} ✎ ${rec.diary}`);
  }

  private event(e: Record<string, unknown>): void {
    if (!this.outDir && !this.onEvent) return;
    const full = { at: stamp(this.s.t), t: this.s.t, ...e };
    this.onEvent?.(full);
    if (this.outDir) appendFileSync(join(this.outDir, 'events.jsonl'), `${JSON.stringify(full)}\n`);
  }
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function perMinute(def: ActionDef, a: Activity): Effects {
  const out: Effects = {};
  const effects = staleEffects(def.effects, noveltyFactor(def, a.stale ?? 1));
  for (const n of NEEDS) {
    let v = 0;
    if (a.duration > 0 && effects[n]) v += (effects[n] as number) / a.duration;
    if (def.perHour?.[n]) v += (def.perHour[n] as number) / 60;
    if (v) out[n] = v;
  }
  return out;
}

function roundNeeds(n: Needs): Needs {
  return Object.fromEntries(NEEDS.map((k) => [k, Math.round(n[k])])) as Needs;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

/** How much the needs are pulling mood down (or up) right now. */
function needMood(s: State): number {
  return needThoughts(s).reduce((a, t) => a + t.value, 0);
}

/** The same question in other punctuation or case. */
export function sameQuestion(a: string, b: string): boolean {
  const norm = (q: string) => q.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return norm(a) !== '' && norm(a) === norm(b);
}
