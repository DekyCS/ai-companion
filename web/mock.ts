// ?mock: made-up pieces, readings and night pages, so the HUD can be checked without the model.
// Loaded only when the page is opened with ?mock.

import type { Ask, HudSnap, PieceFull, PieceRef, PieceSource, Reading } from './hud.ts';

const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#7a5a3f"/><path d="M0 230 Q100 210 200 228 T400 222 V300 H0Z" fill="#4a3526"/><path d="M60 228 C70 170 90 120 120 100 C150 120 170 170 178 228" fill="none" stroke="#1f1610" stroke-width="5" stroke-linecap="round"/><path d="M120 100 C100 70 130 40 160 60 C190 40 230 70 205 100 C240 110 225 150 190 140 C170 160 130 150 120 100Z" fill="#2a1f17" opacity="0.8"/><circle cx="300" cy="70" r="26" fill="none" stroke="#1f1610" stroke-width="3" stroke-dasharray="6 5"/><path d="M250 240 q10 -14 22 0 q10 -14 22 0" fill="none" stroke="#1f1610" stroke-width="3"/></svg>`;

const TOY = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#f3ead8;font:14px sans-serif;overflow:hidden}canvas{display:block}</style></head><body><canvas id="c" width="400" height="300"></canvas><script>const c=document.getElementById('c'),g=c.getContext('2d');let x=200,y=150,b=[];c.onpointermove=e=>{const r=c.getBoundingClientRect();x=(e.clientX-r.left)*400/r.width;y=(e.clientY-r.top)*300/r.height};setInterval(()=>{b.push({x:Math.random()*400,y:-10});},500);(function f(){g.fillStyle='#f3ead8';g.fillRect(0,0,400,300);g.fillStyle='#a7745a';for(const p of b){p.y+=2;g.beginPath();g.arc(p.x,p.y,6,0,7);g.fill();}b=b.filter(p=>p.y<310&&Math.hypot(p.x-x,p.y-y)>18);g.fillStyle='#3b2a20';g.beginPath();g.arc(x,y,14,0,7);g.fill();requestAnimationFrame(f)})();</script></body></html>`;

const FULL: PieceFull[] = [
  { id: 'm1', form: 'picture', title: 'The Oak at Dusk', about: 'the old oak, from very low down', t: 0, clock: '18:40', text: '', notes: [], tempo: 0 },
  { id: 'm2', form: 'poem', title: 'Button', about: 'a poem about the blue button', t: 0, clock: '10:12', text: 'Blue button in the moss.\nNobody lost you on purpose.\nI looked for the coat.\nThere was no coat.\nYou are mine now.\nThat is how it goes.', notes: [], tempo: 0 },
  { id: 'm3', form: 'song', title: 'Heron Leaves', about: 'a song for when the heron goes', t: 0, clock: '12:30', text: 'Grey legs, grey sky,\nhe stands, I wait,\nhe goes, I hum,\nthe stream is mine.', notes: ['E4', 'G4', 'A4', 'G4', 'E4', 'D4', 'E4', 'rest', 'G4', 'A4', 'B4', 'A4', 'G4', 'E4', 'D4', 'C4'].map((p, i) => ({ p, d: i % 4 === 3 ? 2 : 1 })), tempo: 88 },
  { id: 'm4', form: 'story', title: 'The Spoon That Stayed', about: 'a story told by a spoon', t: 0, clock: '15:05', text: 'I was whittled on a Tuesday, which is a fine day to be made. Khina turned me over and over and said I was crooked. I am. I stir the left side of the soup better than the right. Nobody has complained. Nobody else eats the soup.', notes: [], tempo: 0 },
  { id: 'm5', form: 'toy', title: 'Catch the Acorns', about: 'a little game about dodging acorns', t: 0, clock: '16:50', text: '', notes: [], tempo: 0 },
];

export function mockSource(now: number): PieceSource {
  FULL.forEach((p, i) => (p.t = now - (i + 1) * 170));
  return {
    list: async () => FULL.map(({ text: _t, notes: _n, tempo: _x, ...ref }) => ref as PieceRef),
    get: async (id) => FULL.find((p) => p.id === id) ?? null,
    svgUrl: () => `data:image/svg+xml,${encodeURIComponent(PICTURE)}`,
    toyFrame: () => ({ srcdoc: TOY }),
  };
}

const READINGS: Omit<Reading, 't'>[] = [
  { clock: '09:20', question: 'Why do rabbits thump their back feet?', learned: 'A rabbit thumps a back foot to warn others of danger. The thump carries through the ground to nearby burrows.', sources: [{ title: 'Rabbit behaviour', url: 'https://example.org/rabbits' }, { title: '', url: 'https://en.wikipedia.org/wiki/Rabbit' }] },
  { clock: '14:02', question: 'Why do herons stand so still?', learned: 'Herons keep still so fish do not notice them, then strike very fast with their long neck.', sources: [{ title: 'Grey heron', url: 'https://en.wikipedia.org/wiki/Grey_heron' }] },
];

/** Fills a real snapshot with made-up extras. */
export function mockSnap<T extends HudSnap>(s: T): T {
  const pieces = [...FULL].map((p, i) => ({ ...p, t: s.t - (i + 1) * 170 })).reverse().map(({ text: _t, notes: _n, tempo: _x, ...ref }) => ref as PieceRef);
  const readings = READINGS.map((r, i) => ({ ...r, t: s.t - (READINGS.length - i) * 200 }));
  const moodArc = Array.from({ length: 48 }, (_, i) => ({ t: s.t - (47 - i) * 60, mood: 55 + 18 * Math.sin(i / 5) + 6 * Math.sin(i * 1.7) }));
  const diary = s.diary.length
    ? s.diary.map((d) => ({ ...d, day: d.day ?? s.day }))
    : [
        { t: s.t - 300, clock: '07:06', day: s.day, text: 'Slipped a pea pod off Old Wren’s vine before the fog lifted. Nobody saw.', place: 'the vegetable patch', actionId: 'pea' },
        { t: s.t - 200, clock: '08:55', day: s.day, text: 'Looked up why rabbits thump their back feet. It is a warning, apparently. I have been warning the furniture.', place: 'the internet hut', actionId: 'browse' },
        { t: s.t - 90, clock: '10:30', day: s.day, text: 'Wrote a poem about the blue button. It is short, like the button.', place: 'the burrow', actionId: 'make' },
      ];
  return {
    ...s,
    diary,
    pieces,
    readings,
    posts: [
      { t: s.t - 400, clock: '09:12', text: 'Fog all morning. I sat at the stream and the heron did not move once. Neither did I, for a while.', about: 'the fog at the stream' },
      { t: s.t - 120, clock: '13:40', text: 'Made a little picture of the bakery window in the rain. The glass came out wobbly, which is how it looks.', about: 'the bakery picture', piece: { id: pieces[0]!.id, title: pieces[0]!.title, form: pieces[0]!.form }, sent: { bluesky: 'https://bsky.app/profile/example/post/1' } },
    ],
    postsTo: ['bluesky'],
    moodArc,
    pages: [
      { day: Math.max(1, s.day - 1), text: 'The lantern still does not light. I fiddled with it twice and said so to the bench. Bramwell gave me crusts, which helped more than the lantern did.' },
    ],
    asks: mockAsks(s),
  };
}

/** Two asks waiting for the Keeper and two answered, newest first, as the server sends them. */
function mockAsks(s: HudSnap): Ask[] {
  const now = Date.now();
  const hour = 3_600_000;
  const when = (minutesAgo: number) => {
    const t = Math.max(0, s.t - minutesAgo);
    const day = Math.floor(t / 1440) + 1;
    const m = t % 1440;
    const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(day - 1) % 7];
    return { t, day, clock: `${wd} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` };
  };
  return [
    { id: 'mock4', ...when(200), at: now - 2 * hour, text: 'Could the stream have a few stepping stones by the dam?', why: 'I keep getting my paws wet halfway across.', status: 'open' },
    { id: 'mock3', ...when(900), at: now - 14 * hour, text: 'Could I have a place on the site where visitors can leave me a note?', why: 'The letterbox only ever has Tansy and the squirrels in it.', status: 'open' },
    { id: 'mock2', ...when(1700), at: now - 27 * hour, text: 'Could I have a little boat for the stream?', why: 'I would like to see where the water goes.', status: 'no', answeredAt: now - 20 * hour, note: 'Not a boat, deep water is no place for a bunny. Ask me for a bridge instead.' },
    { id: 'mock1', ...when(2600), at: now - 40 * hour, text: 'Could I have an account somewhere, so strangers can read my posts?', why: 'Right now my posts only stay on the computer in the hut.', status: 'done', answeredAt: now - 30 * hour, note: 'Made you one on Bluesky. Your posts go there now.' },
  ];
}
