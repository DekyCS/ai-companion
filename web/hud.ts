// Everything drawn over the village: how Khina feels, what Khina is doing right now, the clock,
// a feed of the latest diary lines, and sheets for the diary, the gallery of things Khina made,
// what Khina looked up on the internet, and what Khina asked the Keeper for (with answer buttons
// for the Keeper only). Every string from the server goes in as text, never as HTML; only http(s)
// addresses become links.

import { PLACES, type PlaceId } from '../src/world/places.ts';

// ---------- what the server sends ----------
export type PieceForm = 'picture' | 'poem' | 'story' | 'song' | 'toy';
export interface PieceRef {
  id: string;
  form: PieceForm;
  title: string;
  about: string;
  t: number;
  clock?: string;
}
export interface PieceFull extends PieceRef {
  text: string;
  notes: { p: string; d: number }[];
  tempo: number;
}
export interface Reading {
  t: number;
  clock?: string;
  question: string;
  learned: string;
  sources: { title: string; url: string }[];
}
export interface Post {
  t: number;
  clock?: string;
  text: string;
  about: string;
  piece?: { id: string; title: string; form: PieceForm };
  sent?: Record<string, string>;
}
/** Something Khina asked the Keeper (the human who looks after the village) for. */
export type AskAnswer = 'done' | 'notnow' | 'no';
export interface Ask {
  id: string;
  /** Game minute she asked. */
  t: number;
  /** Real time she asked (epoch ms). */
  at: number;
  text: string;
  why: string;
  status: 'open' | AskAnswer;
  answeredAt?: number;
  note?: string;
  clock?: string;
  day?: number;
}
export interface DiaryLine {
  t: number;
  clock: string;
  day?: number;
  text: string;
  place: string;
  actionId?: string;
}
export interface HudActivity {
  kind: 'walk' | 'act';
  actionId: string;
  place: PlaceId;
  label: string;
  doing: string;
  detail: string;
  reason: string;
  origin: string;
}
export interface HudSnap {
  t: number;
  speed: number;
  brain: string;
  clock: string;
  day: number;
  weekday: string;
  part: string;
  dark: boolean;
  weather: string;
  mood: number;
  needs: Record<string, number>;
  activity: HudActivity | null;
  diary: DiaryLine[];
  pieces?: PieceRef[];
  readings?: Reading[];
  posts?: Post[];
  /** Accounts Khina's posts also go to (e.g. bluesky, x); empty means the site only. */
  postsTo?: string[];
  pages?: { day: number; text: string }[];
  moodArc?: { t: number; mood: number }[];
  /** What she asked the Keeper for, newest first. */
  asks?: Ask[];
}

/** Where pieces come from: the server, or made-up ones for ?mock. */
export interface PieceSource {
  list(): Promise<PieceRef[] | null>;
  get(id: string): Promise<PieceFull | null>;
  svgUrl(id: string): string;
  toyFrame(id: string): { src?: string; srcdoc?: string };
}

const safeId = (id: string) => encodeURIComponent(id);

export const httpSource: PieceSource = {
  async list() {
    try {
      const r = await fetch('/pieces');
      if (!r.ok) return null;
      const j = (await r.json()) as { pieces?: PieceRef[] };
      return Array.isArray(j.pieces) ? j.pieces : null;
    } catch {
      return null;
    }
  },
  async get(id) {
    try {
      const r = await fetch(`/pieces/${safeId(id)}.json`);
      return r.ok ? ((await r.json()) as PieceFull) : null;
    } catch {
      return null;
    }
  },
  svgUrl: (id) => `/pieces/${safeId(id)}.svg`,
  toyFrame: (id) => ({ src: `/pieces/${safeId(id)}.html` }),
};

export type Mode = 'khina' | 'player';
export interface Hud {
  update(s: HudSnap): void;
  piece(p: PieceRef): void;
  reading(r: Reading): void;
  post(p: Post): void;
  ask(a: Ask): void;
  setMode(m: Mode): void;
  setSource(src: PieceSource): void;
  show(): void;
}

// ---------- small helpers ----------
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const placeShort = (p: string) => PLACES[p as PlaceId]?.short ?? p;

/** Khina minutes per real minute, from the latest snapshot (24 when Khina lives a day an hour). */
let pace = 1;

/** How long ago, in real time: Khina's clock runs faster than the visitor's. */
function ago(now: number, then: number): string {
  return agoMinutes(Math.max(0, Math.round((now - then) / pace)));
}

/** How long ago a real time (epoch ms) was, in the same words. */
const agoReal = (ms: number) => agoMinutes(Math.max(0, Math.round((Date.now() - ms) / 60_000)));

function agoMinutes(m: number): string {
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  const d = Math.round(m / 1440);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function safeLink(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

// Fixed icons (constant markup, never server text).
const P = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS: Record<string, string> = {
  diary: P('<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>'),
  gallery: P('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.6"/>'),
  internet: P('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>'),
  asks: P('<path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M9.8 8.4a2.3 2.3 0 1 1 3.3 2.1c-.7.3-1.1.8-1.1 1.5"/><path d="M12 14.6h.01"/>'),
  follow: P('<circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>'),
  walk: P('<circle cx="7" cy="9" r="2"/><circle cx="12" cy="6.5" r="2"/><circle cx="17" cy="9" r="2"/><path d="M8 17c0-3 2-5 4-5s4 2 4 5c0 2-2 3-4 3s-4-1-4-3z"/>'),
  menu: P('<path d="M5 7h14M5 12h14M5 17h14"/>'),
  close: P('<path d="M6 6l12 12M18 6L6 18"/>'),
  sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5"/>'),
  moon: P('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  song: P('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  toy: P('<rect x="2.5" y="7" width="19" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r="1"/><circle cx="18" cy="13.5" r="1"/>'),
  words: P('<path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>'),
};
function iconEl(name: string, cls = ''): HTMLElement {
  const i = el('i', cls);
  i.innerHTML = ICONS[name] ?? '';
  return i;
}

const NEEDS: [string, string, string, string][] = [
  ['mood', 'Mood', 'Mood', '#6f8f4e'],
  ['fullness', 'Belly', 'Belly', '#e39a4b'],
  ['rest', 'Rest', 'Rest', '#7d8fc6'],
  ['calm', 'Calm', 'Calm', '#5aa6a0'],
  ['company', 'Friends', 'Friends', '#d97c8c'],
  ['novelty', 'New', 'New', '#d1ad3f'],
  ['making', 'Making', 'Making', '#a7745a'],
];
const TIP: Record<string, string> = { company: 'Company: wanting to see a face', novelty: 'Something new: wanting a change', fullness: 'Belly: how full', rest: 'Rest: how rested', calm: 'Calm', making: 'Making: the urge to make things', mood: 'Mood' };
const WEATHER_WORD: Record<string, string> = { clear: 'clear', cloudy: 'grey', drizzle: 'drizzle', rain: 'rain', fog: 'fog' };
const FORM_NAME: Record<PieceForm, string> = { picture: 'a picture', poem: 'a poem', story: 'a short story', song: 'a song', toy: 'a little game' };
const FORM_DID: Record<PieceForm, string> = { picture: 'drew a picture', poem: 'wrote a poem', story: 'wrote a story', song: 'made up a song', toy: 'made a little game' };
const FORM_GO: Record<PieceForm, string> = { picture: 'look', poem: 'read', story: 'read', song: 'listen', toy: 'play' };

/** A menu label read about her rather than by her ("about my day or something I made" becomes
 * "about her day or something she made"), for the visitor's status line. */
function aboutHer(label: string): string {
  return label
    .replace(/\bKhina has\b/g, 'she has')
    .replace(/\bI (made|have|had|was|am)\b/g, (_, v: string) => `she ${v === 'have' ? 'has' : v === 'am' ? 'is' : v}`)
    .replace(/\bmy\b/g, 'her')
    .replace(/\bmyself\b/g, 'herself');
}

/** What Khina is up to, in a few forms: the card title, the purpose of a walk, the status line. */
function describe(a: HudActivity | null): { title: string; status: string; chip: string } {
  if (!a) return { title: 'Deciding what to do', status: 'deciding what to do next', chip: '' };
  const own = a.actionId.startsWith('own.');
  // Her own words ("the heron song I made") read about her on the page: "the heron song she made"
  // (a question she looks up is quoted as she asked it).
  const raw = a.detail?.trim() ?? '';
  const detail = a.actionId === 'browse' ? raw : aboutHer(raw);
  const doing = own
    ? capital(detail || 'trying an idea of her own')
    : a.actionId === 'make'
      ? `Making ${detail || 'something'}`
      : a.actionId === 'browse'
        ? `Looking up “${detail || 'something'}” on the internet`
        : a.actionId === 'post'
          ? `Writing a post about ${detail || 'the day'}`
          : capital(a.doing) + (detail ? ` (${detail})` : '');
  const chip = own ? 'own idea' : a.actionId === 'make' ? 'making' : a.actionId === 'browse' || a.actionId === 'post' ? 'online' : '';
  if (a.kind === 'walk') {
    const to = placeShort(a.place);
    const purpose = own
      ? lower(detail) || 'try an idea of her own'
      : a.actionId === 'make'
        ? `make ${detail || 'something'}`
        : a.actionId === 'browse'
          ? `look up “${detail || 'something'}”`
          : a.actionId === 'post'
            ? `write a post about ${detail || 'her day'}`
            : aboutHer(a.label) + (detail ? ` (${detail})` : '');
    return { title: `On the way to ${to}`, status: `hopping over to ${to}, to ${purpose}`, chip };
  }
  return { title: doing, status: own ? `trying an idea of her own${detail ? `: ${lower(detail)}` : ''}` : lower(doing), chip };
}

function paceText(speed: number): string {
  const x = speed * 60;
  if (Math.abs(x - 1) < 0.05) return 'real time';
  const day = 24 / x;
  return `${Math.round(x)}× real time · a Khina day every ${day >= 1 ? `${+day.toFixed(1)} h` : `${Math.round(day * 60)} min`}`;
}

// ---------- songs ----------
const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function freqOf(p: string): number | null {
  const m = /^([A-G])([#b]?)(\d)$/.exec(p);
  if (!m) return null;
  const midi = 12 * (Number(m[3]) + 1) + SEMI[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 440 * Math.pow(2, (midi - 69) / 12);
}
let audioCtx: AudioContext | null = null;
let stopSong: (() => void) | null = null;
function playSong(p: PieceFull, onEnd: () => void): () => void {
  stopSong?.();
  audioCtx ??= new AudioContext();
  const ctx = audioCtx;
  void ctx.resume();
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2200;
  filter.connect(master).connect(ctx.destination);
  const beat = 60 / Math.min(180, Math.max(50, p.tempo || 96));
  let t = ctx.currentTime + 0.06;
  const oscs: OscillatorNode[] = [];
  for (const n of p.notes ?? []) {
    const dur = Math.max(0.1, (Number(n.d) || 1) * beat);
    const f = n.p === 'rest' ? null : freqOf(n.p);
    if (f) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.025);
      g.gain.exponentialRampToValueAtTime(0.1, t + dur * 0.6);
      g.gain.linearRampToValueAtTime(0.0001, t + dur * 0.96);
      g.connect(filter);
      const a = ctx.createOscillator();
      a.type = 'triangle';
      a.frequency.value = f;
      const b = ctx.createOscillator();
      b.type = 'sine';
      b.frequency.value = f * 2;
      const bg = ctx.createGain();
      bg.gain.value = 0.22;
      a.connect(g);
      b.connect(bg).connect(g);
      for (const o of [a, b]) {
        o.start(t);
        o.stop(t + dur);
        oscs.push(o);
      }
    }
    t += dur;
  }
  const total = t - ctx.currentTime;
  const timer = setTimeout(() => stop(), total * 1000 + 150);
  let done = false;
  function stop() {
    if (done) return;
    done = true;
    clearTimeout(timer);
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    setTimeout(() => {
      for (const o of oscs) {
        try {
          o.stop();
        } catch {
          /* already stopped */
        }
      }
      master.disconnect();
    }, 200);
    if (stopSong === stopper) stopSong = null;
    onEnd();
  }
  const stopper = () => stop();
  stopSong = stopper;
  return stopper;
}

// ---------- the Keeper ----------
// The Keeper opens the site once with #keeper (the page asks for the key) or #keeper=<key>, also on a
// tab that is already open. The key is kept in this browser only (storage can be off, so every use is
// wrapped) and taken out of the address bar, so it is not shared by accident with a copied link. With
// it, open asks get answer buttons; visitors never see them.
const KEEPER_STORE = 'khina.keeperKey';

function storedKeeperKey(): string | null {
  try {
    return localStorage.getItem(KEEPER_STORE);
  } catch {
    return null;
  }
}

function storeKeeperKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(KEEPER_STORE, key);
    else localStorage.removeItem(KEEPER_STORE);
  } catch {
    /* storage is off: the key lasts until the page is closed */
  }
}

/**
 * The Keeper's hand-over in the address, removed from it straight away: the key from #keeper=<key>,
 * '' for a bare #keeper (ask for the key on the page, so it never has to be in an address), or null.
 */
function keeperFromHash(): string | null {
  const m = /^#keeper(?:=(.*))?$/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    return decodeURIComponent(m[1] ?? '').trim();
  } catch {
    return (m[1] ?? '').trim();
  }
}

const ANSWER_SAY: Record<AskAnswer, string> = { done: 'done', notnow: 'not now', no: 'no, sorry' };
const ANSWER_CHIP: Record<Ask['status'], [string, string]> = {
  open: ['waiting', 'chip orange'],
  done: ['done', 'chip moss'],
  notnow: ['not now', 'chip'],
  no: ['no', 'chip rose'],
};

// ---------- the HUD ----------
export function createHud(o: { canWalk: boolean; onMode: (m: Mode) => void }): Hud {
  let source: PieceSource = httpSource;
  let snap: HudSnap | null = null;
  let mode: Mode = 'khina';

  // Needs strip.
  const needsEl = $('needs');
  const needBars = new Map<string, { root: HTMLElement; fill: HTMLElement }>();
  for (const [key, long, short, colour] of NEEDS) {
    const root = el('div', 'need');
    root.title = TIP[key] ?? long;
    const label = el('div', 'nl');
    const dot = el('span', 'nd');
    dot.style.background = colour;
    const l = el('span', 'long', long);
    const sh = el('span', 'short', short);
    label.append(dot, l, sh);
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.background = colour;
    bar.append(fill);
    root.append(label, bar);
    needsEl.append(root);
    needBars.set(key, { root, fill });
  }
  const style = document.createElement('style');
  style.textContent = '.need .short{display:none}@media (max-width:720px){.need .long{display:none}.need .short{display:inline}#modeBtn,#walk{display:none!important}}';
  document.head.append(style);

  // Right now card.
  const nowEl = $('now');
  const toggle = $('nowToggle');
  const narrow = matchMedia('(max-width: 720px)').matches;
  if (narrow) nowEl.classList.add('collapsed');
  toggle.addEventListener('click', () => {
    nowEl.classList.toggle('collapsed');
    toggle.setAttribute('aria-expanded', String(!nowEl.classList.contains('collapsed')));
  });

  // Top right.
  $('menuBtn').innerHTML = ICONS.menu!;
  $('sheetClose').innerHTML = ICONS.close!;
  for (const i of document.querySelectorAll<HTMLElement>('#menu [data-icon]')) i.innerHTML = ICONS[i.dataset.icon!] ?? '';
  const menu = $('menu');
  const menuBtn = $('menuBtn');
  // How many asks are waiting for the Keeper, on the menu button and on "Khina asks".
  const menuBadge = el('b', 'badge');
  const asksBadge = el('b', 'badge');
  menuBadge.hidden = asksBadge.hidden = true;
  menuBtn.append(menuBadge);
  document.querySelector('#menu [data-sheet="asks"] .round')?.append(asksBadge);
  const setMenu = (show: boolean) => {
    menu.hidden = !show;
    // On shorter screens the menu reaches down to the diary feed: the feed steps aside while it is open.
    $('hud').classList.toggle('menuOpen', show);
    menuBtn.setAttribute('aria-expanded', String(show));
    menuBtn.innerHTML = show ? ICONS.close! : ICONS.menu!;
    // While the menu is open, the count sits on "Khina asks" itself.
    if (!show) menuBtn.append(menuBadge);
  };
  menuBtn.addEventListener('click', () => setMenu(Boolean(menu.hidden)));
  for (const b of document.querySelectorAll<HTMLButtonElement>('#menu [data-sheet]')) {
    b.addEventListener('click', () => {
      setMenu(false);
      openSheet(b.dataset.sheet as SheetKind);
    });
  }
  const modeBtn = $('modeBtn');
  const followBtn = $('follow');
  const walkBtn = $('walk');
  if (!o.canWalk) {
    modeBtn.hidden = true;
    walkBtn.hidden = true;
  }
  modeBtn.addEventListener('click', () => {
    modeBtn.blur();
    o.onMode(mode === 'khina' ? 'player' : 'khina');
  });
  followBtn.addEventListener('click', () => {
    setMenu(false);
    o.onMode('khina');
  });
  walkBtn.addEventListener('click', () => {
    setMenu(false);
    o.onMode('player');
  });

  // Toast.
  const toast = $('toast');
  let toastTimer = 0;
  function showToast(text: string, go: string, onClick: () => void) {
    const t = el('span', 'tt', text);
    const g = el('span', 'go', go);
    toast.replaceChildren(t, g);
    toast.hidden = false;
    toast.onclick = () => {
      toast.hidden = true;
      onClick();
    };
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.hidden = true), 9000);
  }

  // Feed.
  const feed = $('feed');
  const seen = new Set<string>();
  let firstFeed = true;
  function renderFeed(s: HudSnap) {
    const lines = s.diary.slice(-3);
    feed.replaceChildren(
      ...lines.map((d) => {
        const key = `${d.t}|${d.text}`;
        const b = el('div', 'bubble');
        if (!seen.has(key) && !firstFeed) b.classList.add('new');
        seen.add(key);
        const meta = el('div', 'meta');
        meta.append(el('span', 'chip', d.place), el('span', '', d.clock));
        b.append(el('div', '', d.text), meta);
        b.addEventListener('click', () => openSheet('diary'));
        return b;
      }),
    );
    firstFeed = false;
  }

  // ---------- sheets ----------
  type SheetKind = 'diary' | 'gallery' | 'internet' | 'asks';
  const sheet = $('sheet');
  const scrim = $('scrim');
  const body = $('sheetBody');
  const tabsEl = $('sheetTabs');
  let open: SheetKind | null = null;
  let tab = '';
  let viewing: string | null = null;
  let galleryList: PieceRef[] | null = null;
  let galleryKey = '';
  const full = new Map<string, Promise<PieceFull | null>>();
  const getFull = (id: string) => {
    let p = full.get(id);
    if (!p) {
      p = source.get(id);
      full.set(id, p);
    }
    return p;
  };

  const TABS: Record<SheetKind, [string, string][]> = {
    diary: [['recent', 'recent'], ['nights', 'nights']],
    gallery: [['all', 'everything'], ['picture', 'pictures'], ['words', 'words'], ['song', 'songs'], ['toy', 'games']],
    internet: [['looked', 'looked up'], ['posts', 'posts']],
    // "waiting" like the chip on each card; renderAsks adds the counts.
    asks: [['open', 'waiting'], ['answered', 'answered']],
  };
  const TITLES: Record<SheetKind, string> = { diary: 'Diary', gallery: 'Things Khina made', internet: 'Khina on the internet', asks: 'Khina asks' };

  function openSheet(kind: SheetKind, opts: { piece?: string; tab?: string } = {}) {
    stopSong?.();
    open = kind;
    tab = opts.tab ?? TABS[kind][0]?.[0] ?? '';
    viewing = opts.piece ?? null;
    sheet.hidden = false;
    scrim.hidden = false;
    $('sheetTitle').textContent = TITLES[kind];
    tabsEl.replaceChildren(
      ...TABS[kind].map(([id, label]) => {
        const b = el('button', '', label);
        b.dataset.tab = id;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(id === tab));
        b.addEventListener('click', () => {
          tab = id;
          viewing = null;
          stopSong?.();
          for (const x of tabsEl.children) x.setAttribute('aria-selected', String(x === b));
          renderSheet(true);
        });
        return b;
      }),
    );
    if (kind === 'gallery') galleryList = null;
    renderSheet(true);
    body.scrollTop = 0;
  }
  function closeSheet() {
    stopSong?.();
    open = null;
    notice = null;
    keyBox = false;
    sheet.hidden = true;
    scrim.hidden = true;
    body.replaceChildren();
  }
  $('sheetClose').addEventListener('click', closeSheet);
  scrim.addEventListener('click', closeSheet);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (open) closeSheet();
      else setMenu(false);
    }
  });

  function renderSheet(force = false) {
    if (!open || !snap) return;
    if (open === 'diary') renderDiary(snap);
    else if (open === 'internet') renderInternet(snap);
    else if (open === 'asks') renderAsks(snap, force);
    else if (force || !viewing) void renderGallery(snap, force);
  }

  // ---------- Khina asks ----------
  let keeperKey = storedKeeperKey();
  /** Show a box for the key: opened with a bare #keeper, or after a key did not work. */
  let keyBox = false;
  /** The server can't take answers (KHINA_KEEPER_KEY unset or too short): no buttons, and a line saying why. */
  let keeperOff = false;
  /** Opened with #keeper before the first snapshot: show the asks as soon as it is in. */
  let asksOnStart = false;
  /** A line at the top of the sheet: an answer sent (good), or why it did not go through. */
  let notice: { text: string; good?: boolean } | null = null;
  let asksKey = '';
  /** What the Keeper has typed per ask, kept across re-renders and across a key typed again. */
  const drafts = new Map<string, string>();
  const sending = new Set<string>();

  /**
   * #keeper or #keeper=<key>, on load or added to a tab that is already open (no reload comes then).
   * True when it handed over a key (which useKey has already tried).
   */
  function takeKeeperHash(): boolean {
    const k = keeperFromHash();
    if (k === null) return false;
    notice = null;
    if (k) useKey(k);
    else if (!keeperKey) keyBox = true;
    if (snap) openSheet('asks');
    else asksOnStart = true;
    return !!k;
  }

  function useKey(k: string) {
    keeperKey = k;
    storeKeeperKey(k);
    keyBox = false;
    keeperOff = false;
    void checkKey();
  }

  function forgetKey() {
    keeperKey = null;
    storeKeeperKey(null);
    keeperOff = false;
  }

  /** Tries the key once when keeper mode starts, so a wrong one shows before a note is typed. */
  async function checkKey() {
    const k = keeperKey;
    if (!k) return;
    let r: Response;
    try {
      r = await fetch('/asks/check', { method: 'POST', headers: { 'x-keeper-key': k } });
    } catch {
      return; // offline: the answer itself will say
    }
    if (k !== keeperKey) return;
    if (r.status === 204) keeperOff = false;
    else keyRefused(r.status, r.status === 503);
    if (open === 'asks' && snap) renderAsks(snap, true);
  }

  /** What a refused key means: a wrong one is forgotten (the notes typed stay), one the server can't use yet is kept. */
  function keyRefused(status: number, off: boolean): boolean {
    if (off) {
      keeperOff = true;
      notice = { text: 'Answering is off on the server: KHINA_KEEPER_KEY is not set there, or is too short.' };
    } else if (status === 403) {
      forgetKey();
      keyBox = true;
      notice = { text: "That key didn't work. Type it again below." };
    } else if (status === 429) {
      notice = { text: 'Too many wrong keys lately. Try again in 10 minutes.' };
    } else return false;
    return true;
  }

  // A key kept from an earlier visit is tried once too.
  if (!takeKeeperHash() && keeperKey) void checkKey();
  addEventListener('hashchange', () => void takeKeeperHash());

  function renderAsks(s: HudSnap, force: boolean) {
    const asks = s.asks ?? [];
    const key = JSON.stringify([tab, !!keeperKey, keyBox, keeperOff, notice, [...sending], asks.map((a) => [a.id, a.status])]);
    if (!force && key === asksKey) return;
    // Never pull a box away while the Keeper is typing in it.
    const typing = (document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement) && body.contains(document.activeElement);
    if (!force && typing) return;
    asksKey = key;
    const waiting = asks.filter((a) => a.status === 'open');
    // Answered ones newest answer first: an old ask answered today comes to the top.
    const answeredList = asks.filter((a) => a.status !== 'open').sort((a, b) => (b.answeredAt ?? 0) - (a.answeredAt ?? 0));
    for (const b of tabsEl.querySelectorAll<HTMLElement>('[data-tab]')) {
      const n = b.dataset.tab === 'open' ? waiting.length : answeredList.length;
      b.textContent = `${b.dataset.tab === 'open' ? 'waiting' : 'answered'} · ${n}`;
    }
    const out: HTMLElement[] = [el('p', 'intro', "Some things a bunny can't do by herself. Khina asks the Keeper, who looks after the village and reads her asks once a day. The answer comes to her letterbox.")];
    if (notice) out.push(el('div', notice.good ? 'notice good' : 'notice', notice.text));
    if (keyBox && !keeperKey) out.push(keyForm());
    const answered = tab === 'answered';
    const list = answered ? answeredList : waiting;
    if (!list.length) out.push(el('div', 'empty', answered ? 'Nothing answered yet.' : 'Nothing waiting. Most nights Khina asks for nothing.'));
    for (const a of list) out.push(askCard(a));
    if (keeperKey) {
      const line = el('div', 'keeperline', 'keeper · ');
      const forget = el('a', '', 'forget key');
      forget.href = '#';
      forget.addEventListener('click', (e) => {
        e.preventDefault();
        forgetKey();
        notice = null;
        renderAsks(snap!, true);
      });
      line.append(forget);
      out.push(line);
    }
    body.replaceChildren(...out);
  }

  /** Only after a bare #keeper or a key that did not work: the key typed here never goes in an address. */
  function keyForm(): HTMLElement {
    const f = el('form', 'keeper keyform');
    const input = el('input');
    input.type = 'password';
    input.autocomplete = 'current-password';
    input.placeholder = "The Keeper's key";
    input.setAttribute('aria-label', "The Keeper's key");
    const go = el('button', 'kbtn done', 'Use key');
    go.type = 'submit';
    f.append(input, go);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const k = input.value.trim();
      if (!k) return;
      notice = null;
      useKey(k);
      renderAsks(snap!, true);
    });
    return f;
  }

  function askCard(a: Ask): HTMLElement {
    const e = el('div', 'entry ask');
    const top = el('div', 'top');
    const [word, cls] = ANSWER_CHIP[a.status] ?? ANSWER_CHIP.open;
    top.append(el('span', cls, word), el('span', 't', `Khina's day ${a.day ?? '?'} · ${a.clock ?? ''} · ${agoReal(a.at)}`));
    e.append(top, el('h4', '', a.text));
    if (a.why) e.append(el('p', 'why', a.why));
    if (a.status !== 'open') {
      const ans = el('div', 'answer');
      const head = el('div', 'ah');
      head.append(el('b', '', `The Keeper: ${ANSWER_SAY[a.status]}`));
      if (a.answeredAt) head.append(el('span', '', agoReal(a.answeredAt)));
      ans.append(head);
      if (a.note) ans.append(el('p', '', a.note));
      e.append(ans);
    } else if (keeperKey && !keeperOff) {
      e.append(keeperControls(a));
    }
    return e;
  }

  /** Only in keeper mode: the three answers and a note for Khina. */
  function keeperControls(a: Ask): HTMLElement {
    const box = el('div', 'keeper');
    const note = el('textarea');
    note.maxLength = 300;
    note.rows = 2;
    // The note is public: it shows on the site, in her letter and diary, and on her later nights.
    note.placeholder = 'A note for Khina (everyone can read it)';
    note.setAttribute('aria-label', 'A note for Khina. Everyone can read it.');
    note.value = drafts.get(a.id) ?? '';
    note.addEventListener('input', () => drafts.set(a.id, note.value));
    const row = el('div', 'kbtns');
    for (const [status, label] of [['done', 'Done'], ['notnow', 'Not now'], ['no', 'No']] as const) {
      const b = el('button', `kbtn ${status}`, label);
      b.type = 'button';
      b.disabled = sending.has(a.id);
      b.addEventListener('click', () => void answer(a, status, note.value));
      row.append(b);
    }
    box.append(note, row);
    return box;
  }

  async function answer(a: Ask, status: AskAnswer, note: string) {
    if (!keeperKey || sending.has(a.id)) return;
    sending.add(a.id);
    notice = null;
    renderAsks(snap!, true);
    let r: Response | null = null;
    try {
      r = await fetch(`/asks/${encodeURIComponent(a.id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-keeper-key': keeperKey },
        body: JSON.stringify({ status, note: note.trim() }),
      });
    } catch {
      r = null;
    }
    sending.delete(a.id);
    const j = r ? ((await r.json().catch(() => null)) as { ask?: Ask; off?: boolean } | null) : null;
    if (r?.ok) {
      drafts.delete(a.id);
      // Moves to "answered" now; the server's next snapshot says the same.
      if (snap?.asks) snap = { ...snap, asks: snap.asks.map((x) => (x.id === a.id ? (j?.ask ?? { ...x, status, answeredAt: Date.now(), note: note.trim() }) : x)) };
      // In the sheet the line says so; a toast would sit over the cards.
      if (open === 'asks') notice = { text: "Sent. It's in Khina's letterbox.", good: true };
      else showToast("Sent. It's in Khina's letterbox", 'see', () => openSheet('asks', { tab: 'answered' }));
    } else if (!r || !keyRefused(r.status, !!j?.off)) {
      notice = { text: r?.status === 409 ? 'That one was already answered.' : r?.status === 404 ? 'That ask is gone.' : 'Could not send that. Try again.' };
    }
    if (open === 'asks' && snap) renderAsks(snap, true);
  }

  function moodArc(s: HudSnap): HTMLElement | null {
    const pts = s.moodArc ?? [];
    if (pts.length < 2) return null;
    const box = el('div', 'arc');
    const lbl = el('div', 'lbl');
    lbl.append(el('span', '', 'Mood, lately'), el('span', '', `${Math.round(s.mood)} / 100`));
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 300 60');
    svg.setAttribute('preserveAspectRatio', 'none');
    const t0 = pts[0]!.t;
    const span = Math.max(1, pts[pts.length - 1]!.t - t0);
    const xy = pts.map((p) => `${((p.t - t0) / span) * 296 + 2},${58 - (Math.max(0, Math.min(100, p.mood)) / 100) * 56}`).join(' ');
    const mid = document.createElementNS(NS, 'line');
    for (const [k, v] of [['x1', '0'], ['x2', '300'], ['y1', '30'], ['y2', '30'], ['stroke', 'rgba(59,42,32,0.18)'], ['stroke-dasharray', '3 4']]) mid.setAttribute(k!, v!);
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', xy);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', '#6f8f4e');
    line.setAttribute('stroke-width', '2.5');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(mid, line);
    box.append(lbl, svg);
    return box;
  }

  function actionChip(id?: string): HTMLElement | null {
    if (!id) return null;
    if (id === 'make' || id === 'draw') return el('span', 'chip orange', 'made something');
    if (id === 'browse') return el('span', 'chip moss', 'online');
    if (id === 'post') return el('span', 'chip moss', 'posted');
    if (id.startsWith('own.')) return el('span', 'chip moss', 'own idea');
    return null;
  }

  function renderDiary(s: HudSnap) {
    const out: HTMLElement[] = [];
    const arc = moodArc(s);
    if (arc) out.push(arc);
    if (tab === 'nights') {
      // A night she wrote nothing (code alone, or a page turned away) is left out, not shown blank.
      const pages = (s.pages ?? []).filter((p) => p.text?.trim()).reverse();
      if (!pages.length) out.push(el('div', 'empty', 'No night pages yet. Khina writes one each night while asleep.'));
      for (const p of pages) {
        const e = el('div', 'entry');
        const top = el('div', 'top');
        top.append(el('span', 'chip', `night of day ${p.day}`));
        e.append(top, el('p', '', p.text));
        out.push(e);
      }
    } else {
      // Every recent line, newest first, under a header per Khina day: at a fast clock a day
      // lasts an hour, so "today only" was often empty while Khina slept.
      const lines = [...s.diary].reverse();
      if (!lines.length) out.push(el('div', 'empty', 'Nothing in the diary yet.'));
      let shownDay: number | undefined;
      for (const d of lines) {
        if (d.day !== undefined && d.day !== shownDay) {
          shownDay = d.day;
          const head = d.day === s.day ? `Khina's day ${d.day} · today` : d.day === s.day - 1 ? `Khina's day ${d.day} · yesterday` : `Khina's day ${d.day}`;
          out.push(el('div', 'dayhead', head));
        }
        const e = el('div', 'entry');
        const top = el('div', 'top');
        top.append(el('span', 'chip', d.place));
        const c = actionChip(d.actionId);
        if (c) top.append(c);
        top.append(el('span', 't', d.clock));
        e.append(top, el('p', '', d.text));
        out.push(e);
      }
    }
    body.replaceChildren(...out);
  }

  const OUTLET_NAME: Record<string, string> = { bluesky: 'Bluesky', x: 'X' };

  function renderPosts(s: HudSnap) {
    const posts = [...(s.posts ?? [])].reverse();
    const where = (s.postsTo ?? []).map((k) => OUTLET_NAME[k] ?? k);
    const note = el('div', 'empty', where.length ? `Khina's posts also go to ${where.join(' and ')}.` : 'Posts stay on this page for now: no account is connected yet.');
    if (!posts.length) {
      body.replaceChildren(el('div', 'empty', 'Khina has not posted anything yet. A few times a day, the old computer at the internet hut can post a short note.'), note);
      return;
    }
    body.replaceChildren(
      ...posts.map((p) => {
        const e = el('div', 'entry reading');
        const top = el('div', 'top');
        top.append(el('span', 'chip moss', 'posted'), el('span', 't', `${p.clock ?? ''} · ${ago(s.t, p.t)}`));
        e.append(top, el('p', '', p.text));
        const src = el('div', 'src');
        if (p.piece) {
          const b = el('a', '', `see “${p.piece.title}”`);
          b.href = `#piece=${p.piece.id}`;
          b.addEventListener('click', (ev) => {
            ev.preventDefault();
            openSheet('gallery', { piece: p.piece!.id });
          });
          src.append(b);
        }
        for (const [k, v] of Object.entries(p.sent ?? {})) {
          const u = safeLink(v);
          if (!u) continue;
          const a = el('a', '', `on ${OUTLET_NAME[k] ?? k}`);
          a.href = u.href;
          a.target = '_blank';
          a.rel = 'noopener nofollow ugc';
          src.append(a);
        }
        if (src.children.length) e.append(src);
        return e;
      }),
      note,
    );
  }

  function renderInternet(s: HudSnap) {
    if (tab === 'posts') return renderPosts(s);
    const reads = [...(s.readings ?? [])].reverse();
    if (!reads.length) {
      body.replaceChildren(el('div', 'empty', 'Khina has not looked anything up yet. The old computer is at the internet hut.'));
      return;
    }
    body.replaceChildren(
      ...reads.map((r) => {
        const e = el('div', 'entry reading');
        const top = el('div', 'top');
        top.append(el('span', 'chip moss', 'looked up'), el('span', 't', `${r.clock ?? ''} · ${ago(s.t, r.t)}`));
        const src = el('div', 'src');
        for (const x of r.sources ?? []) {
          const u = safeLink(x.url);
          if (!u) continue;
          const a = el('a', '', x.title?.trim() || u.hostname);
          a.href = u.href;
          a.target = '_blank';
          a.rel = 'noopener nofollow ugc';
          a.title = u.hostname;
          src.append(a);
        }
        e.append(top, el('h4', '', r.question), el('p', '', r.learned));
        if (src.children.length) e.append(src);
        return e;
      }),
    );
  }

  const matches = (p: PieceRef) =>
    tab === 'all' || tab === '' || p.form === tab || (tab === 'words' && (p.form === 'poem' || p.form === 'story'));

  async function renderGallery(s: HudSnap, force: boolean) {
    if (viewing) {
      await renderViewer(viewing);
      return;
    }
    const key = `${tab}|${(s.pieces ?? []).length}|${s.pieces?.[s.pieces.length - 1]?.id ?? ''}`;
    if (!force && key === galleryKey) return;
    galleryKey = key;
    if (!galleryList || force) galleryList = (await source.list()) ?? [...(s.pieces ?? [])].reverse();
    if (open !== 'gallery' || viewing) return;
    const list = galleryList.filter(matches);
    if (!list.length) {
      body.replaceChildren(el('div', 'empty', galleryList.length ? 'Nothing of this kind yet.' : 'Nothing made yet. When Khina draws, writes, makes up a song or a little game, it lands here.'));
      return;
    }
    const grid = el('div', 'grid');
    for (const p of list) grid.append(card(p, s));
    body.replaceChildren(grid);
  }

  function card(p: PieceRef, s: HudSnap): HTMLElement {
    const c = el('button', 'card');
    c.type = 'button';
    const art = el('div', 'art');
    if (p.form === 'picture') {
      const img = el('img');
      img.loading = 'lazy';
      img.alt = p.title;
      img.src = source.svgUrl(p.id);
      art.append(img);
    } else if (p.form === 'toy') {
      art.append(iconEl('toy', 'icon'));
    } else {
      const words = el('div', 'words', '…');
      if (p.form === 'song') {
        const wrap = el('div');
        wrap.style.cssText = 'display:grid;justify-items:center';
        const btn = el('span', 'play small', '▶ play');
        btn.setAttribute('role', 'button');
        let stop: (() => void) | null = null;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (stop) return stop();
          btn.textContent = '■ stop';
          void getFull(p.id).then((f) => {
            if (!f) return void (btn.textContent = '▶ play');
            stop = playSong(f, () => {
              stop = null;
              btn.textContent = '▶ play';
            });
          });
        });
        wrap.append(iconEl('song', 'icon'), btn);
        art.append(wrap);
      } else art.append(words);
      if (p.form !== 'song')
        void getFull(p.id).then((f) => {
          words.textContent = (f?.text ?? '').split('\n').slice(0, 6).join('\n') || p.about;
        });
    }
    const cap = el('div', 'cap');
    cap.append(el('b', '', p.title), el('span', '', `${FORM_NAME[p.form] ?? p.form} · ${ago(s.t, p.t)}`));
    c.append(art, cap);
    c.addEventListener('click', () => {
      viewing = p.id;
      void renderViewer(p.id);
      body.scrollTop = 0;
    });
    return c;
  }

  async function renderViewer(id: string) {
    const ref = galleryList?.find((x) => x.id === id) ?? snap?.pieces?.find((x) => x.id === id);
    const back = el('button', 'back', '← everything Khina made');
    back.addEventListener('click', () => {
      stopSong?.();
      viewing = null;
      galleryKey = '';
      void renderGallery(snap!, false);
    });
    const v = el('div', 'viewer');
    v.append(back);
    body.replaceChildren(v);
    const f = await getFull(id);
    const p: PieceFull | null = f ?? (ref ? { ...ref, text: '', notes: [], tempo: 96 } : null);
    if (!p || viewing !== id || open !== 'gallery') {
      if (!p) v.append(el('div', 'empty', 'That piece could not be found.'));
      return;
    }
    v.append(el('h3', '', p.title));
    v.append(el('p', 'about', `${capital(FORM_NAME[p.form] ?? p.form)}${p.about ? `, from the idea: ${p.about}` : ''}${p.clock ? ` · ${p.clock}` : ''}`));
    if (p.form === 'picture') {
      const img = el('img');
      img.alt = p.title;
      img.src = source.svgUrl(p.id);
      v.append(img);
    } else if (p.form === 'toy') {
      const frame = el('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.title = p.title;
      const f2 = source.toyFrame(p.id);
      if (f2.srcdoc !== undefined) frame.srcdoc = f2.srcdoc;
      else if (f2.src) frame.src = f2.src;
      v.append(frame);
    } else if (p.form === 'song') {
      const btn = el('button', 'play', '▶ play the song');
      let stop: (() => void) | null = null;
      btn.addEventListener('click', () => {
        if (stop) {
          stop();
          return;
        }
        btn.textContent = '■ stop';
        stop = playSong(p, () => {
          stop = null;
          btn.textContent = '▶ play the song';
        });
      });
      v.append(btn);
      if (p.text) v.append(el('div', 'text', p.text));
    } else {
      v.append(el('div', 'text', p.text || '…'));
    }
  }

  // ---------- updates ----------
  const lastMade = $('lastMade');
  const lastRead = $('lastRead');
  lastMade.addEventListener('click', () => {
    const p = snap?.pieces?.[snap.pieces.length - 1];
    if (p) openSheet('gallery', { piece: p.id });
  });
  lastRead.addEventListener('click', () => openSheet('internet'));

  // A shared link like /#piece=<id> opens that piece once the first snapshot is in.
  let linkedPiece = /^#piece=([a-z0-9]+-[a-z0-9]+)$/.exec(location.hash)?.[1] ?? null;

  function update(s: HudSnap) {
    snap = s;
    if (linkedPiece) {
      const id = linkedPiece;
      linkedPiece = null;
      openSheet('gallery', { piece: id });
    }
    if (asksOnStart) {
      asksOnStart = false;
      openSheet('asks');
    }
    const waiting = (s.asks ?? []).filter((a) => a.status === 'open').length;
    for (const b of [menuBadge, asksBadge]) {
      b.textContent = String(waiting);
      b.hidden = waiting === 0;
    }
    menuBtn.title = waiting ? `Menu · Khina is waiting on ${waiting} ask${waiting === 1 ? '' : 's'}` : 'Menu';
    for (const [key] of NEEDS) {
      const v = key === 'mood' ? s.mood : (s.needs[key] ?? 0);
      const n = needBars.get(key)!;
      n.fill.style.width = `${Math.max(2, Math.min(100, v))}%`;
      n.root.classList.toggle('low', v < 25);
    }
    const d = describe(s.activity);
    pace = Math.max(0.01, (s.speed || 1 / 60) * 60);
    $('nowWhen').textContent = `Khina's day ${s.day} · ${s.clock}`;
    const doing = $('doing');
    doing.textContent = d.title;
    if (d.chip) {
      doing.append(' ');
      doing.append(el('span', d.chip === 'making' ? 'chip orange' : 'chip moss', d.chip));
    }
    $('why').textContent = s.activity?.reason ? `“${s.activity.reason}”` : '';
    const lp = s.pieces?.[s.pieces.length - 1];
    lastMade.hidden = !lp;
    if (lp) {
      const k = el('span', 'k', 'last made');
      lastMade.replaceChildren(k, el('b', '', lp.title), ` · ${FORM_NAME[lp.form] ?? lp.form} · ${ago(s.t, lp.t)}`);
    }
    const lr = s.readings?.[s.readings.length - 1];
    lastRead.hidden = !lr;
    if (lr) lastRead.replaceChildren(el('span', 'k', 'last looked up'), el('b', '', lr.question), ` · ${ago(s.t, lr.t)}`);
    $('brain').textContent = `Brain: ${s.brain} · ${paceText(s.speed)}`;
    $('clockIcon').innerHTML = s.dark ? ICONS.moon! : ICONS.sun!;
    $('clockText').replaceChildren(el('small', '', "Khina's time"), el('span', '', `${s.weekday.slice(0, 3)} ${s.clock} · ${WEATHER_WORD[s.weather] ?? s.weather}`));
    $('clockPill').title = Math.abs(pace - 1) < 0.05 ? 'Khina lives on real time' : `Khina's clock runs ${Math.round(pace)}× faster than yours: ${paceText(s.speed)}`;
    const st = $('statusText');
    st.replaceChildren(el('b', '', 'Khina'), ` is ${d.status}`);
    renderFeed(s);
    if (open === 'diary' || open === 'internet' || open === 'asks') renderSheet();
    else if (open === 'gallery' && !viewing) void renderGallery(s, false);
  }

  return {
    update,
    piece(p) {
      galleryList = null;
      full.delete(p.id);
      showToast(`Khina ${FORM_DID[p.form] ?? 'made something'}: “${p.title}”`, FORM_GO[p.form] ?? 'look', () => openSheet('gallery', { piece: p.id }));
      if (open === 'gallery' && !viewing) void renderGallery(snap!, true);
    },
    reading(r) {
      showToast(`Khina looked up “${r.question}”`, 'read', () => openSheet('internet'));
    },
    post(p) {
      showToast(`Khina posted: “${p.text.length > 70 ? `${p.text.slice(0, 67)}...` : p.text}”`, 'read', () => openSheet('internet', { tab: 'posts' }));
    },
    ask() {
      showToast('Khina asked the Keeper for something', 'read', () => openSheet('asks'));
    },
    setMode(m) {
      mode = m;
      followBtn.setAttribute('aria-pressed', String(m === 'khina'));
      walkBtn.setAttribute('aria-pressed', String(m === 'player'));
      followBtn.setAttribute('aria-current', String(m === 'khina'));
      walkBtn.setAttribute('aria-current', String(m === 'player'));
      modeBtn.textContent = m === 'khina' ? 'Walk around' : 'Follow Khina';
    },
    setSource(src) {
      source = src;
      full.clear();
      galleryList = null;
    },
    show() {
      $('hud').hidden = false;
    },
  };
}
