import assert from 'node:assert/strict';
import { test } from 'node:test';
import { offlineMind } from '../src/mind/decide.ts';
import { characterSheet, decideSystem, diarySystem, reflectSystem } from '../src/mind/prompts.ts';
import { makeSystem, postSystem, webSystem } from '../src/mind/making.ts';
import { fromHedgehogDays, HEDGEHOG_ONLY, migrateSave, toBunny } from '../src/migrate.ts';
import { HEDGEHOG_SELF } from '../src/mind/prompts.ts';
import { Rng } from '../src/rng.ts';
import { Sim } from '../src/sim.ts';
import { newState, pantryTotal, type Completed, type State } from '../src/state.ts';
import { ACTIONS } from '../src/world/actions.ts';

/** A save from Khina's hedgehog days, as the live server kept it before 2026-11-18. */
function hedgehogSave(): State {
  const s = newState(1);
  delete s.species;
  const pantry = s.pantry as unknown as Record<string, number>;
  delete pantry.clover;
  pantry.beetles = 7;
  pantry.berries = 2;
  s.t = 54 * 1440 + 600;
  s.memories.push(
    { id: 1, t: s.t - 300, text: 'My spines went flat when the heron landed', where: 'by the stream', category: 'heron', salience: 5, recalls: 0, lastRecalled: -Infinity, tier: 'long', days: [53] },
    { id: 2, t: s.t - 200, text: 'Found a white beetle wing', where: 'in the clearing', category: 'find', salience: 5, recalls: 0, lastRecalled: -Infinity, tier: 'short', days: [54] },
    { id: 3, t: s.t - 100, text: 'Had a chat with Old Wren', where: 'in the square', category: 'chat', salience: 4, recalls: 1, lastRecalled: s.t - 50, tier: 'long', days: [40, 54] },
  );
  s.nextMemoryId = 4;
  s.finds.push({ name: 'a white beetle wing', t: s.t - 200 }, { name: 'a blue button', t: s.t - 900 });
  s.thoughts.push(
    { key: 'find', text: 'Found a tiny snail shell', value: 4, at: s.t - 30, until: s.t + 600 },
    { key: 'letter', text: 'Got a note from Bramwell', value: 4, at: s.t - 20, until: s.t + 400 },
  );
  const rec = (outcome: string, actionId = 'poke', label = 'poke around in the moss for odd things'): Completed => ({
    kind: 'done', actionId, label, gist: 'poking about', place: 'clearing', start: s.t - 60, end: s.t - 30,
    detail: '', reason: 'Why not.', origin: 'autopilot', outcome, diary: '', diaryBy: 'template', moodBefore: 60, moodAfter: 60,
  });
  s.history.push(
    rec('poked about in the moss and found a fat beetle, and took it home for the pantry'),
    rec('foraged in the woods and found nothing but wet leaves', 'forage', 'forage for beetles and berries'),
    rec('watched the minnows dart about in the shallows', 'fish', 'watch the fish'),
  );
  s.tastes['a:forage'] = { fast: 1, slow: 2, n: 9, practice: 3, practiceDay: 50 };
  s.tastes['a:beetles'] = { fast: 0.5, slow: 0.5, n: 2 };
  s.evidence['a:forage'] = { 50: { sum: 3, n: 1 } };
  s.familiarity['a:forage'] = 1.2;
  s.beliefs.push({ key: 'a:forage', polarity: 'likes', days: 5, of: 6, text: 'Khina has come to like foraging for beetles.' });
  s.learned.push({ key: 'a:forage', text: 'Has come to like snuffling for beetles.', night: 53, added: 50 });
  s.world.findsLeft.push('an empty snail shell, striped', 'a speckled snail shell');
  s.world.sightsLeft.push('a gap in a fence just hedgehog-sized');
  s.world.letters.push({ from: 'wren', text: 'A hedgehog was here before you, years back. Kept a garden of stones. You remind me of her.', t: s.t - 10 });
  s.readings.push({ t: s.t - 500, question: 'How far can a hedgehog walk in a night?', learned: 'One to two kilometres.', sources: [] });
  s.pieces.push({ id: 'p1', form: 'poem', title: 'Rain', about: 'rain', t: s.t - 700 });
  s.pages.push(
    { day: 52, text: 'Rain all day. I stayed in and counted my spines.', by: 'model', promoted: [], dropped: [], sheetLine: '' },
    { day: 53, text: 'Old Wren let me sit by the peas. Nobody said much.', by: 'model', promoted: [], dropped: [], sheetLine: '' },
  );
  return s;
}

const hedgehogText = (s: State) => {
  const live = [
    ...s.thoughts.map((t) => t.text),
    ...s.memories.map((m) => m.text),
    ...s.finds.map((f) => f.name),
    ...s.history.flatMap((h) => [h.outcome, h.label]),
    ...s.beliefs.map((b) => b.text),
    ...s.learned.map((l) => l.text),
    ...s.world.findsLeft,
    ...s.world.sightsLeft,
    ...s.world.letters.map((l) => l.text),
    // 'beetles' stays in the pantry at 0, only so the hedgehog build could still read the save.
    ...Object.keys(s.pantry).filter((k) => k !== 'beetles'),
    ...s.pages.map((p) => p.text),
    ...Object.keys(s.tastes),
  ];
  return live.filter((t) => HEDGEHOG_ONLY.test(t) || /beetle|snail/i.test(t));
};

test('a hedgehog-era save becomes a bunny, keeping what she lived', () => {
  const s = hedgehogSave();
  assert.ok(hedgehogText(s).length > 5);
  assert.equal(toBunny(s), true);
  assert.equal(s.species, 'bunny');
  assert.deepEqual(hedgehogText(s), []);
  // Dried beetles become dried clover; the pantry adds up again. The beetles key stays at 0 so the
  // hedgehog build could still read this save after a rollback (it adds berries + beetles + crusts + peas).
  assert.deepEqual(s.pantry, { berries: 2, beetles: 0, clover: 7, crusts: 0, peas: 0 });
  assert.equal(pantryTotal(s), 9);
  // Hedgehog-only memories, thoughts, history and night pages go; the rest stays. Finds on the shelf get bunny names.
  assert.deepEqual(s.memories.map((m) => m.id), [3]);
  assert.deepEqual(s.thoughts.map((t) => t.key), ['letter']);
  assert.deepEqual(s.finds.map((f) => f.name), ['a white eggshell', 'a blue button']);
  assert.deepEqual(s.pages.map((p) => p.day), [53]);
  assert.deepEqual(s.history.map((h) => h.actionId), ['forage', 'fish']);
  assert.equal(s.history[0]?.label, 'forage for clover and berries');
  // Tastes and the evidence behind beliefs stay; a beetle key becomes clover; sheet lines keep their evidence in new words.
  assert.deepEqual(s.tastes['a:forage'], { fast: 1, slow: 2, n: 9, practice: 3, practiceDay: 50 });
  assert.ok(s.tastes['a:clover'] && !('a:beetles' in s.tastes));
  assert.equal(s.evidence['a:forage']?.[50]?.n, 1);
  assert.equal(s.beliefs[0]?.text, 'Khina has come to like foraging in the woods.');
  assert.deepEqual(s.learned.map((l) => [l.key, l.text, l.added]), [['a:forage', 'Has come to like foraging in the woods.', 50]]);
  // The village speaks of bunnies; readings and pieces are hers to keep.
  assert.ok(s.world.findsLeft.includes('a hazelnut shell with a neat hole in it'));
  assert.ok(s.world.findsLeft.includes('a speckled hazelnut shell'));
  assert.ok(s.world.sightsLeft.includes('a gap in a fence just bunny-sized'));
  assert.match(s.world.letters[0]?.text ?? '', /^A rabbit lived in your burrow before you/);
  assert.equal(s.readings.length, 1);
  assert.equal(s.pieces.length, 1);
});

test('toBunny is idempotent and leaves a new Khina alone', () => {
  const s = hedgehogSave();
  toBunny(s);
  const once = JSON.stringify(s);
  assert.equal(toBunny(s), false);
  assert.equal(JSON.stringify(s), once);
  // The rules themselves change nothing the second time either.
  delete s.species;
  assert.equal(toBunny(s), true);
  assert.equal(JSON.stringify(s), once);

  const fresh = newState(2);
  const before = JSON.stringify(fresh);
  assert.equal(toBunny(fresh), false);
  assert.equal(JSON.stringify(fresh), before);
});

test('a migrated save lives on: eats clover, nothing breaks', async () => {
  const s = hedgehogSave();
  toBunny(s);
  s.needs.fullness = 20;
  const sim = new Sim(s, { mind: offlineMind, rng: new Rng(4), outDir: null });
  await sim.run(s.t + 2 * 1440);
  assert.ok(Number.isFinite(pantryTotal(s)));
  assert.equal((s.pantry as Record<string, number>).beetles, 0);
  for (const r of sim.log) assert.doesNotMatch(`${r.outcome} ${r.diary}`, /beetle|snail|spine|quill|hedgehog/i);
});

test('Khina is a bunny everywhere Claude reads about her', () => {
  const s = newState(1);
  s.world.can = { make: true, own: true, net: true, post: true };
  const prompts = [characterSheet(s), decideSystem(s), diarySystem(s), reflectSystem(s), makeSystem(s), webSystem(s), postSystem(s)];
  for (const p of prompts) {
    assert.match(p, /bunny/);
    assert.doesNotMatch(p, /hedgehog|beetle|snail|quill/i);
  }
  assert.match(characterSheet(s), /\(she, her\)/);
  assert.match(diarySystem(s), /Never spines or prickles/);
  const words = ACTIONS.flatMap((a) => [a.label, a.doing, a.gist, ...(a.details ?? [])]).join(' ');
  assert.doesNotMatch(words, /hedgehog|beetle|snail|spine|prickl|quill|curl/i);
});

test('a whole save comes over: the state and the saved diary log', () => {
  const s = hedgehogSave();
  const rec = (outcome: string, diary: string, actionId = 'forage', label = 'forage for beetles and berries'): Completed => ({
    kind: 'done', actionId, label, gist: 'foraging', place: 'woods', start: s.t - 90, end: s.t - 60,
    detail: '', reason: 'Hungry.', origin: 'model', outcome, diary, diaryBy: 'model', moodBefore: 50, moodAfter: 55,
  });
  const saved = {
    s,
    log: [
      rec('poked about in the moss and found a fat beetle, and took it home for the pantry', 'Found a fat beetle in the moss. Same as last time, really.', 'poke', 'poke around in the moss for odd things'),
      rec('crunched a dried beetle from the pantry', 'Crunched a dried beetle from the pantry; my spines settled.', 'snack', 'eat something from the pantry'),
      rec('curled up by the door while the rain came down', 'Curled into a tight ball by the door while the rain came down.', 'rain', 'curl up by the door'),
      rec('foraged in the woods and found a handful of berries', 'Berries, and wet paws.'),
    ],
  };
  assert.equal(migrateSave(saved), true);
  assert.equal(s.species, 'bunny');
  // Only what a bunny could have lived stays in the log, in today's menu words.
  assert.deepEqual(saved.log.map((r) => r.diary), ['Berries, and wet paws.']);
  assert.equal(saved.log[0]?.label, 'forage for clover and berries');
  for (const r of saved.log) assert.doesNotMatch(`${r.outcome} ${r.diary} ${r.label}`, HEDGEHOG_ONLY);
  // Once only: a bunny save is left as it is, log and all.
  const again = { s, log: [...saved.log, rec('found a beetle', 'A beetle.')] };
  assert.equal(migrateSave(again), false);
  assert.equal(again.log.length, 2);
});

test('the hedgehog words are caught, and bunny words are not', () => {
  const hedgehog = [
    'Curled into a tight ball by the door while the rain came down.',
    'Curled into a tight little ball by the door',
    'curled up in a little ball under the fern',
    'tucked into a ball until the heron left',
    'rolled myself into a ball',
    'Bristled all over when the heron came',
    'nosed through the leaf litter for grubs',
    'My spikes bristled',
    'Ate a caterpillar',
    'Old Wren is working there; quiet company, and maybe worms.',
  ];
  const bunny = [
    'Curled up by the door and listened to the rain',
    'Watched the worm-cast patterns in the mud',
    'Dozed curled up tight in the armchair',
    'sat tucked into a loaf by the door of the burrow, ears down',
    'Kicked a ball of moss down the path',
  ];
  for (const t of hedgehog) assert.match(t, HEDGEHOG_ONLY, t);
  for (const t of bunny) assert.doesNotMatch(t, HEDGEHOG_ONLY, t);
});

test('the live guard turns away a hedgehog Khina, not the things in a bunny world', () => {
  const hedgehogKhina = [
    'I am a hedgehog, after all.',
    'My spines went flat when the heron landed.',
    'Her quills bristled in the wind.',
    'The rain ran off the spines on my back.',
    'Curled into a tight little ball by the door.',
    'Ate three fat beetles from the pantry.',
    'Crunched a couple of worms by the patch.',
    'Snuffled through the leaves for something to eat.',
  ];
  const bunnyWorld = [
    'Watched a snail cross the path by the patch.',
    'Old Wren picked slugs off the lettuce.',
    'There was a caterpillar on the cabbage.',
    'The brambles were prickly, so I left the high berries.',
    'Holly leaves, spiky and dark, behind the well.',
    'Swept the step with the stiff bristles of the broom.',
    'A beetle crossed the path and I let it.',
    'Kicked a ball of moss down the path.',
  ];
  for (const t of hedgehogKhina) assert.match(t, HEDGEHOG_SELF, t);
  for (const t of bunnyWorld) assert.doesNotMatch(t, HEDGEHOG_SELF, t);
});

test('the old heron moment goes with the rest of her hedgehog days', () => {
  const s = hedgehogSave();
  const rec = (outcome: string, diary: string): Completed => ({
    kind: 'done', actionId: 'fish', label: 'watch the fish', gist: 'fish-watching', place: 'stream', start: s.t - 90, end: s.t - 60,
    detail: '', reason: 'Quiet.', origin: 'model', outcome, diary, diaryBy: 'model', moodBefore: 50, moodAfter: 40,
  });
  const saved = {
    s,
    log: [
      rec('was watching the fish when a heron landed close by; Khina curled up tight until it left', 'A heron landed close by, so I curled up tight and stayed still until it flew off.'),
      rec('watched a silver fish that kept coming back to the same stone', 'Same stone, same fish.'),
    ],
  };
  assert.equal(migrateSave(saved), true);
  assert.deepEqual(saved.log.map((r) => r.diary), ['Same stone, same fish.']);
});

test('what she made, read or posted as a hedgehog stays in the save but off the page', () => {
  const s = hedgehogSave();
  (s.posts ??= []).push({ t: s.t - 300, text: 'Rain all day. I stayed in and counted my spines.', about: 'the rain' });
  toBunny(s);
  assert.equal(s.bunnySince, s.t);
  assert.equal(s.readings.length, 1);
  assert.ok(fromHedgehogDays(s, s.readings[0]!.t, s.readings[0]!.question));
  assert.ok(fromHedgehogDays(s, s.posts![0]!.t, s.posts![0]!.text));
  // The poem called "Rain" is fine for a bunny too.
  assert.ok(!fromHedgehogDays(s, s.pieces[0]!.t, s.pieces[0]!.title));
  // A bunny's own post about a snail later on is hers, and shown.
  assert.ok(!fromHedgehogDays(s, s.t + 60, 'Watched a snail cross the path today.'));
  // A Khina born a bunny has no hedgehog days.
  assert.ok(!fromHedgehogDays(newState(3), 100, 'How far can a hedgehog walk in a night?'));
});

test('a bunny save the hedgehog build ran on again (a rollback) is brought over again', () => {
  const s = hedgehogSave();
  toBunny(s);
  const pantry = s.pantry as unknown as Record<string, number>;
  pantry.beetles = 3;
  s.thoughts.push({ key: 'find', text: 'Found a fat beetle', value: 3, at: s.t, until: s.t + 600 });
  assert.equal(toBunny(s), true);
  assert.equal(pantry.beetles, 0);
  assert.equal(pantry.clover, 10);
  assert.ok(!s.thoughts.some((t) => /beetle/.test(t.text)));
  assert.equal(toBunny(s), false);
});
