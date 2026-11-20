# Khina the bunny: build plan

Status on 2026-11-15: phases 1 and 2 are done; 30 seeds × 7 days pass 209 of 210 day checks (one day with 2 meals). Phase 2 cut the top-3 category share from 63.7% to 52.7% over 40 days (paper baseline 57.1%) with every day still plausible. A day with Claude on, including the Opus night, costs about $0.023. Phase 3 is done (39 tests pass). On code alone, identical copies become distinguishable individuals (77% of 3-day blocks matched to the right copy, chance 20%). With Claude choosing, copies stayed alike in what they do over 12 days, and two fixes (habit words, code's favourite) did not measurably change that; their learned sheet lines do differ. Phase 4 is under way: Khina and the village are built in Blender and shown live in the browser, driven by the sim (`npm run live`). On 2026-11-18 the user made Khina a bunny (she/her); see phase 4. How to run: see README.md.

This file is the handoff. Anyone picking the project up (a person or a different model) should be able to start from here without the earlier conversation.

## What we are building

A cute bunny that lives on her own in a small 3D world in the browser. Nobody prompts her. She gets hungry, tired, lonely and bored, and does things to feel better. Over time she should develop her own tastes, make things, and eventually earn enough real money to cover her own running costs.

The inspiration is Pino, the kiwi bird at pinos.world. This is not a copy: different creature, different world, different look, and several mechanisms Pino does not have.

## Decided by the user

- The creature is Khina (the user's own choice of name): a cute hedgehog at first, and since 2026-11-18 a really cute bunny ("she rly likes bunnies let her be a really cute bunny"). Khina is she/her.
- 3D models and the character are made in Blender.
- The brain runs on the user's Claude API credits.
- Khina should try to pay for herself.
- No code until the user says go.
- World: a village in a forest, plus a city she can reach by taking a train.
- The coding agent builds Khina's model in Blender, working from reference pictures (cute hedgehogs at first; a needle-felted bunny since 2026-11-18).
- Models are mixed by job: Haiku for everyday decisions, Sonnet for medium work, Opus for the complicated work. The user said to do whatever is best within that.

## Proposed, not yet confirmed

- Build the forest village first and add the city and train as a later phase.
- TypeScript everywhere (brain and website), because the world renders in the browser.
- Phase 1 runs entirely on the user's laptop with local files. Hosting comes later.

## Open decisions (the user's call)

1. Where the always-on brain runs once it leaves the laptop.
2. Settled on 2026-11-18: Khina is a she (she/her).

## The one rule everything follows

Code owns the body. The model is a voice actor and idea generator.

| Code owns | The model owns |
|---|---|
| The clock and how needs drop | Proposing 3 to 5 things she could do, with a reason for each |
| Mood and energy | What she says, draws, writes or codes |
| What each action does to each need | The wording of her diary and beliefs |
| The menu of what is possible right now | Suggested edits to her character sheet |
| The final random pick | Judging whether a new piece differs from old ones |
| What actually happened | |
| The log, memory and all counters | |

Test for which side something goes on: if getting it wrong would make her lie about her own life or get stuck, code owns it.

## How one decision works

1. The body ticks every 1 to 3 seconds with no model call: needs drop, mood drifts, the current activity continues.
2. A decision is requested only when something happened, an activity ended, or a few minutes passed. Routine low-stakes moves are picked by code alone.
3. Code scores every possible action by how much it would help. Low needs count far more than high ones (for example score = 10 / need level). Recently used actions score zero.
4. Code builds a fresh, short prompt: her character sheet, how she feels in words (never numbers), what she is in the middle of, a one or two sentence summary of recent activity (never the raw log), a few memories, and the shortlist.
5. The model returns 3 to 5 candidates with reasons.
6. Code picks one at random, weighted by its own scores. The world runs it or refuses it.
7. Only then is the model asked for a diary line about what actually happened.

## Keeping her from repeating herself

- Hard block: the last few actions are removed from the menu.
- Going stale: each use of an action or topic makes it give less, and it recovers after about a day of rest. This replaces Pino's fixed 7x penalty, which has no evidence behind it.
- Theme ruts: rotate which memories and likes she is shown, sometimes surface an old random memory, and track time since the last new place, topic or kind of creation.
- Drama manager: if nothing new has happened for a while, the world makes something happen.
- Outside events: visitor notes, weather, things found.
- Do not rely on temperature or on telling her not to repeat. Both were measured and do nothing.

## Memory and sleep

- Code writes an append-only log of what really happened. The model cannot edit it.
- Above that sits a small memory with a few dozen slots. A new memory gets in only by beating the weakest one.
- Once per Khina day she sleeps. A stronger model reads the day and writes the diary page, picks memories to keep or drop, and proposes at most one edit to her character sheet.
- Code decides whether the edit is allowed. A belief needs support on several different days.
- Her character sheet starts at about 20 lines of temperament and voice, with no hobbies written in. Hobbies must be earned.

## How tastes form

After every finished action, code records how her mood actually changed and updates a liking score for that action and topic: a fast score that fades in days and a slow one that lasts. The scores feed back into the scoring in step 3 and, in small rotating samples, into the prompt. About 10 to 20 percent of free choices are reserved for things outside her current favourites.

This is the unproven part of the project and its central experiment.

## Making things

1. Code forces a combination: one current interest, one recent memory, one random constraint.
2. The model lists several ideas.
3. Code rejects ideas too similar to her past work.
4. She makes the piece (a drawing in code, a short text, a tune, a small web toy).
5. A checker repairs anything that will not display or play.
6. The piece is stored and tagged so later sessions lean toward things she has not tried.

## Money

- Money becomes a need: the shed has rent, tied to a real ledger of income minus API spend.
- Ways to earn, best first: paid interactions (feed her, gift her something, commission a drawing), selling what she makes, a monthly "adopt her" membership, and the user's own videos about her.
- The money sits in the user's Stripe account. Khina gets a ledger and a budget.
- Anything that reaches real people or spends money (emails, posts, purchases) goes through an approval queue with daily caps.
- The rent numbers shown to visitors are the real ones.
- No crypto tokens and no autonomous trading.

## World

Needs: hunger, rest, calm, company, something new, the urge to make. Rent is added in phase 6.

The user chose a village in a forest, with a city reachable by train. The place list below is a proposal.

Forest village, about ten places, each tied to needs: her home (rest), a workbench (making), a bakery or small shop (hunger, company), a village square with a bench (company), a vegetable patch (hunger, calm), a stream (calm), the deep woods (calm, foraging), a clearing where odd things turn up (something new), a letterbox for visitor notes, and the train halt.

The city, added later: a market where she can sell what she makes, a junk shop, a museum or gallery, an arcade, a busy station.

Why the train is useful to the design:
- A trip is a big dose of "something new", which is the hardest need to keep fed.
- A ticket costs money, so trips connect to her budget.
- The city is where selling happens, which gives the money idea a place in the world.
- The timetable is an outside event she cannot control.

Aim for about 25 actions in the village at first. The research is clear that a small set of actions is the real limit on variety.

## Art pipeline (Blender)

- Blender 5.3 is installed at `/Applications/Blender.app`.
- Models can be built by script: `/Applications/Blender.app/Contents/MacOS/Blender --background --python <script>`, then a preview image is rendered and checked, then the model is exported as `.glb` for the browser.
- Keep the editable `.blend` files in an `art/` folder so the user can open and refine them by hand.
- Khina's shape since 2026-11-18: a small needle-felted bunny (long ears, twitchy nose, soft fur, cotton-ball tail) in `art/khina.py`. Pose ids stay the same for the sim and the page (walk, sniff, work, eat, curl, sit, paddle, stand). Until then she was a hedgehog (round body, soft spines).
- Before modelling, collect reference pictures (real and stylised) and work from them. Do not copy any existing character's design.
- Scripted models come out simple. The user can still refine her by hand in Blender afterwards.

## Models and billing

The brain calls the Claude API with an API key from the user's Console credits, with a hard daily spend cap enforced in code.

Estimated cost of the routine decision loop, at about 500 model calls a day:

| Model | Per day | Per month |
|---|---|---|
| Claude Haiku 5.5 | about $0.40 | about $12 |
| Claude Sonnet 5.5 | about $8 | about $240 |
| Claude Opus 5.5 | about $16 | about $480 |

The user chose a mix. Starting assignment:

| Job | Model | Roughly how often |
|---|---|---|
| Everyday decisions and diary lines | Claude Haiku 5.5 (`claude-haiku-5-5`) | Hundreds of times a day |
| Making things, and replies to visitors | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | A few times a day |
| Nightly sleep and reflection, and bigger projects such as coding a tool | Claude Opus 5.5 (`claude-opus-5-5`) | Once a day, plus rare projects |

Estimated total for this mix: about $40 to $60 a month. This is an estimate and should be replaced by measured spend after the first week.

The model for each job must stay a setting that can be changed, chosen by test as well as cost: some models play a grumpy or bored character badly and slide back into being a helpful assistant, and smaller models lose some quality when asked to list several options at once.

Falling back to the Claude subscription when credits run out: see the note at the end of this file.

## Build phases

1. Text-only brain: needs, mood, about ten places, about 25 actions, the decision loop, a diary. Done when she lives a plausible day with the model switched off, and a readable day with it on.
   - Built: 9 places, 27 actions, 6 needs, mood from labelled thoughts, the full decision loop with code doing the final pick, template diary offline, Claude diary and candidates online, spend caps. Code map: `src/world/` (village, places, actions), `src/body.ts` (needs, mood), `src/mind/` (scoring, decision, prompts, Claude), `src/sim.ts` (clock), `src/report.ts` (day.md and checks).
   - Tuning finding: when costs (tiredness, hunger) counted fully in scoring, effortless options crowded out everything (sitting on the bench 572 times in 210 days, exploring twice). Counting costs at half weight fixed it (`mind.costWeight` in `src/config.ts`).
   - Model-on findings (3 days read): the diary reads like a character and picks up threads by itself (found a thimble, argued with the squirrel kids over it, whittled a peg for it). Fixed along the way: a smell in every line (code now rotates which sense a line may use), copying the energy line, "meant to X but" filler, every line opening with day and weather, details cut mid-word. Villagers now have fixed pronouns in the prompt (Bramwell he, Old Wren she, Tansy she) so lines agree with each other. Khina's own pronoun was open until 2026-11-18 (now she); prompts use the name and first person.
   - Evidence for phase 2: even with the model on, Khina returns to the same few things all day (bakery 6 times, the lantern 4 to 5 times). The 3-action mask stops back-to-back repeats only; once Claude tried to repeat the lantern and the mask blocked it. Going stale (habituation) is the next fix.
2. Anti-repetition, memory, sleep and tastes. Done when a 40-day fast-forward run scores far below the known baseline of 95 to 98 percent repeated actions.
   - Done criterion changed: the paper's measure (an action category seen in the 5 days before) is about 100% for Khina by construction, because 27 fixed actions all recur within 5 days. It is still reported, for honesty. Phase 2 is judged instead on measures that can move: top-3 and top-5 category share (paper baselines 57.1% and 75.4%), same routine as yesterday, and variety, with phase 2 switched off versus on, same seeds.
   - Built: going stale (familiarity per action, topic and place, halves each pet-day), learned tastes (fast and slow averages of how things felt), beliefs that need support on 4 or more separate days, bounded memory (24 short and 24 long slots, at most 4 of one kind), a village that makes something happen after 14 quiet hours, and a nightly page by Opus 5.5 that may keep or drop memories and add one sheet line, all gated by code. Code map: `src/mind/habit.ts`, `memory.ts`, `sleep.ts`, `src/world/drama.ts`, `src/metrics.ts`, `src/long.ts`.
   - Result (8 seeds × 40 days, `npm run long -- --compare`): top-3 category share 63.7% → 52.7%, top-5 82.8% → 72.0%, same routine as yesterday 13.1% → 6.6%, all days still pass every check, mood 69.7 → 68.2. Against a stand-in model stuck on its same 3 favourites (`--sticky`): top-3 action share 40.6% → 28.0%, same routine 19.9% → 7.8%, days passing every check 73% → 100%.
   - Tuning findings: (1) scaling need relief by staleness left Khina lonely for 35 hours while chatting 125 times, so only novelty and appeal go stale, never the relief itself; (2) a need below 55 ignores staleness, or Khina skipped supper and went to bed hungry; (3) exploring never goes stale, or it stopped completely; (4) the reward for something unfamiliar drops with the cube of familiarity, or it pushed Khina to explore until exhausted; (5) tastes learn from what happened plus only 15% of need relief, or everything that fed a need became "liked".
   - Model on (2 days, seed 4): 94 calls, 0 failed, $0.045 in all, including two Opus nights at $0.014 to $0.018 each. The second night's page noticed staleness by itself: "the bench and the oven and the clouds all doing less than they used to."
   - Cost to watch: new things per week fell from 22 to 18 on code alone, because making things goes stale too. Phase 3 should test whether that matters.
3. Experiments: compare one change at a time (code picks versus model picks, going stale versus a fixed penalty, words versus numbers). Then run three to five copies and measure whether they become different individuals.
   - Individuality test built (`npm run copies`, `src/individuality.ts`): 5 copies start identical (same personality, world and needs; only chance differs). Code learns each copy's habits from days 11–25, then tries to match its days 26–40 to the right copy. Chance is 20%. It also reports how far copies are from each other divided by how far each drifts from its own earlier self (above 1 means individuals, around 1 or below means noise).
   - First finding, negative: tastes learned from how things felt did not make individuals. Matching stayed at chance (19%), and the copies' tastes agreed at 0.91. Each copy faces the same odds, so every taste converges to the same average, and fading erased early accidents.
   - Fix: practice. Each day an action is done adds one unit of practice (half-life 20 days). Practice raises appeal up to 8×, evened out across the options on offer, so it ranks pastimes against each other and never against food or rest. Result (5 copies × 4 personalities × 40 days): 3-day blocks matched to the right copy 77% (chance 20%), ratio 4.1. Cost: about 2 fewer different activities a day (17.7 → 15.8) and same routine as yesterday 6.5% → 10.3%, still below phase 2 off (13.1%). Practice gain 2 and up turns into a rut.
   - Two practice versions failed first: boosting the whole score let pastimes beat food (stuck-model days passing every check fell to 70%), and counting every use rather than every day locked day 1 in.
   - Going stale vs a fixed 7× penalty (`--exp penalty`, 8 seeds × 40 days, code only): going stale spreads across more kinds of activity (top-3 categories 49.1% vs 55.8%) and keeps a stuck model plausible more often (95.6% vs 89.1% of days); the fixed penalty gives slightly more variety between single actions (top-3 actions 24.2% vs 26.5%). With neither: top-3 categories 68.6% and 85% of days plausible. So the fixed penalty is not useless; going stale wins on 2 of 3.
   - One part at a time (`--exp parts`): going stale does nearly all the anti-repeat work. Memory and village events change nothing on code alone, because only Claude sees them; they need the Claude experiments.
   - Code picks vs Claude picks (`--exp claude`, 3 seeds × 10 days, Haiku 5.5, nights by code, $0.48): with Claude proposing, single actions vary more (top-3 actions 30.3% → 24.9%, same routine as yesterday 14.6% → 7.2%, exact repeats 65.6% → 47.3%, because Claude varies the details), and mood is a little higher (68.1 → 70.4). But Claude narrows the kinds of activity (top-3 categories 50.6% → 56.5%, level with the paper's best baseline). Claude's pick matched code's own favourite only 29% of the time.
   - Feelings as words vs numbers (same run): no meaningful difference over 10 days (top-3 actions 24.9% vs 22.4%, same routine 7.2% vs 7.5%, mood 70.4 vs 69.0). Claude never repeated the numbers in its reasons (0 of about 1,470). The research's advice to use words is kept, but this test does not support or refute it.
   - Copies with Claude on (3 copies × 12 days, personality 1, $0.28): not yet individuals. 27% of later days matched to the right copy (chance 33%), ratio 1.27. The same test on code alone: 47% for personality 1, 67% across 8 personalities, ratio about 3. All three Claude copies had drawing and crusts among their top choices: Claude brings the same favourites to every copy and practice reinforces them in all of them. Their learned sheet lines did differ (one came to like drawing with charcoal, another chatting in the square). One personality and 3 copies, so this is a first signal, not proof; it matches the research warning that the model's own favourites dominate.
   - Fix 1, habit words (`habitWords`, on by default): Claude's menu marks this copy's 5 most-practised actions as "one of Khina's habits" and, from day 4, unpractised ones as "Khina hardly ever does this"; one line in Claude's instructions says to lean toward habits when nothing pressing says otherwise. The labels differ between copies (by day 12: fish and moss; chat and tidy; poking about and pea pods).
   - Result (3 copies × 12 days with Claude, off vs on the same day, $0.57): Claude follows the labels a little. It proposed an option 65% of the time when it was labelled a habit vs 56% unlabelled, and 25% of final picks were the copy's habits vs 19%. But copies did not become more distinct: ratio 0.93 off vs 0.94 on. Kept on, since it costs nothing.
   - Why Claude washes out individuality: with Claude, copies end up half as different from each other (JSD 0.065–0.071 vs 0.139 on code alone over 12 days) and each drifts more from its own past (0.056–0.072 vs 0.046). Claude also favours options Khina hardly ever does (proposed 68% vs 56%), a built-in pull toward novelty that works against habits. Day-matching is noisy at this size: the same "off" setup matched 27% in one run and 60% in another, so the ratio is the measure to trust.
   - Fix 2, code's favourite (`codeFavourite`): code's own top option, which carries this copy's practice and tastes, is always among the candidates, at Claude's typical weight, even when Claude leaves it out. Against the stuck stand-in (which gives every copy the same favourites, as Claude does): ratio 0.62 → 1.80 over 12 days and 1.97 → 3.93 over 40 days; 3-day blocks matched 38% → 63% (chance 20%); top-3 actions 31.2% → 27.1%; days passing every check 95.6% → 99.4%; mood 65.5 → 67.6.
   - Result with real Claude (3 copies × 12 days, off vs on the same day, $0.56): no help. Ratio 1.10 off vs 0.74 on; same routine as yesterday 7.7% → 10.8%; one day with 2 meals. Left off by default (`codeFavourite: false`). The stand-in only proposes 3 fixed options, while Claude proposes about 4 to 5 varied ones, so the stand-in overstated how much code's favourite was being left out.
   - Phase 3 conclusion. Across five Claude runs of the same 3-copy, 12-day setup, the ratio ranged 0.74 to 1.27 and day-matching 27% to 87%, with no pattern by fix; code alone scores a ratio of about 3 on the same test. So: (1) on code alone, practice turns identical copies into distinguishable individuals; (2) with Claude choosing, copies do not diverge in what they do over 12 days, and neither habit words nor code's favourite changed that by an amount this test size can detect; (3) individuality with Claude shows elsewhere: each copy's learned sheet lines differ (one came to like drawing with charcoal, one chatting in the square, one went off watching the fish). Open: whether Claude copies diverge over longer runs (about $2.40 for 5 copies × 30 days × 2 personalities), and a blind test of whether a judge can tell copies apart from their diaries (cheap, untested).
   - Spent on phase 3 experiments on 2026-11-15: $1.77, with the daily cap raised per command at the user's request.
4. Khina and the world in Blender, shown in the browser, driven by the brain.
   - Started 2026-11-15, when Khina was a hedgehog. Built: Khina in Blender (`art/khina.py`), from 7 freely licensed reference photos (`art/refs/`, credits and notes there): round body, big head, banded spines (dark with cream tips), big eyes, blush, ears, four feet. Rigid parts on pivots (body, head at the neck, each foot), so the browser animates without a skeleton. The village (`art/village.py`): Khina's burrow in the roots of an oak (round door, round window, stove pipe, letterbox with a flag), the shed and a hedgehog-height workbench, the bakery, the square with a well, bench and lamp, the vegetable patch, the stream with pebbles and a half-built dam, the woods with a stump, the clearing with a fallen log and a fairy ring, the halt with platform and rails, and 560 trees. About 110,000 triangles, flat-shaded, one vertex-coloured material.
   - Shown in the browser: `npm run live` runs the sim as it happens (code-only brain by default, no spend) and streams snapshots to a three.js page (`web/main.ts`). Khina walks the paths (`src/world/layout.ts`: place positions are the sim's coordinates × 3 m, so walking times match) to the spot for each action, goes out of sight indoors, and holds a pose per action: waddle, sniff, work, eat, sit, curl, paddle. Day and night follow the game clock; rain, drizzle and fog show; windows light when someone is in; chimneys smoke; the letterbox flag rises when there is post. A small panel shows the time, what Khina is doing and why, mood and needs, and the last diary lines.
   - Checked by headless Chrome screenshots: day, rain, dusk and night, inside and outside, curled and walking. Not yet: other villagers, the train, the inside of the burrow (Khina is out of sight while home), sound, and keeping Khina's life between server restarts.
   - 2026-11-16, the look upgrade (the user: "the graphics need to be much much better", Khina "cute like this", a needle-felted hedgehog photo; and "moving around like my own player, WASD"):
     - Khina remodelled after the felt photo: a dome of about 7,600 long banded quills (dark root, brown band, cream or dark tip), a white fluffy face with puffed cheeks, a tan snout darkening to a felt nose, a small smile, big glossy brown eyes with an iris ring, catch-lights and dark felt rims, cupped brown ears, toed feet. About 200,000 triangles.
     - Felt fuzz in the browser (`web/fuzz.ts`): every material named `Fur*` gets 20 shell layers drawing fibres; the fuzz length per vertex rides in UV channel U (glTF drops colour alpha), 0 next to the eyes and mouth.
     - Renderer (`web/look.ts`): ACES tone mapping, a painted sky with sun, drifting clouds and stars, image-based light from that sky (so the eyes reflect it), soft sun shadows, exponential fog, ambient occlusion (GTAO), bloom for lit windows, a soft vignette. Time of day and weather drive all of it.
     - Grass and wild flowers (`web/grass.ts`): instanced blades in 8 m tiles around the camera, swaying in the wind, grown where `art/export/terrain.json` says grass grows; tree foliage and water move too; fireflies on dry nights; warm light spills from lit windows.
     - You can walk around (`web/player.ts`, `art/visitor.py`): a little felt hedgehog (a felt bunny until 2026-11-18, when Khina became the bunny), WASD or arrows relative to the camera, Shift runs, Space hops, collisions from `terrain.json`. The first key press hands you the camera; "Follow Khina" gives it back. Khina looks up at you when you come close.
     - Runs at 60 fps on this Mac. `?lite` drops ambient occlusion and thins the grass for slower machines.
   - 2026-11-18, Khina is a bunny (the user: "khina is going to be a bunny actually she rly likes bunnies let her be a really cute bunny please"):
     - Khina is now a really cute needle-felted bunny, she/her. The visitor you walk around as is now the old felt hedgehog. The model and animation were rebuilt alongside; action, place and pose ids did not change, so saves and the page still fit.
     - Words: the character sheet gives concrete bunny details (long ears that turn toward sounds, a twitchy nose, soft fur, a cotton-ball tail, hops, nibbles greens, washes her face with her paws, thumps a back foot when startled, flops over when content), and the diary, night, making and post prompts say never spines or prickles. Need voices, reasons and outcomes are bunny ones: a heron makes her thump and freeze flat, the rain action is tucking into a loaf by the door.
     - Food: dried beetles became dried clover (`FoodId` `clover`). Foraging brings home clover and berries; the moss in the clearing gives clover, dandelion leaves or a wild strawberry. Finds and sights lost their snail shells and beetle wings (hazelnut shells, eggshells; a gap in a fence just bunny-sized).
     - The live save is brought over once on load (`migrateSave` in `src/migrate.ts`, marked by `species: 'bunny'`), the state and the saved diary log together: pantry beetles become clover (the `beetles` key stays at 0, so the hedgehog build could still read the save after a rollback); finds on her shelf get their bunny names (an empty snail shell is now a hazelnut shell); thoughts, memories, recent history, night pages and diary-log records that only make sense for a hedgehog (spines, quills, curled into a ball, beetles, snails, grubs) are dropped; beliefs and sheet lines keep their evidence and are reworded from today's labels; tastes, pieces, readings, posts and letters are kept, and the game minute it happened is kept as `bunnySince`: pieces, readings and posts from before then that only a hedgehog could have made are not shown on the page nor read back into prompts (`fromHedgehogDays`). The file as it was is kept once as `<save>.hedgehog.json`. Anything the model writes that gives her a hedgehog's body or ways again (being a hedgehog, her own spines, curling into a ball, eating beetles or worms; a diary line, a sheet line, a night page, a post) is turned away by a narrower live guard (`HEDGEHOG_SELF` in `src/mind/prompts.ts`), so a snail on the path or prickly brambles are fine; a page turned away leaves no blank night on the site.
     - The model, after review: big flat glossy eyes that sit in the felt (no goggle in profile); short forelegs that the page stretches every frame from each front paw into her chest, so her paws never float; in a loaf her ears tip back and curl along the round of her head (a "Lie" shape key on each ear, blended in with the loaf; the fuzz shells share its weight); head-down poses dip her body rather than her head, so her face shows from above; she washes her face with both paws at her muzzle; catch-lights dim at night. Until the viewer moves the camera, it drifts round to the side she faces when she settles, if the view is clear.
     - After a second review: brown eyes that read in the game (a wide warm iris ring, less mirror-like gloss, catch-lights under the bloom threshold so they don't halo); snow-white fur with caramel only at the ear tips, rosier ear linings and a round rosy cheek patch; in a loaf each ear turns half round as it lies back, so it wraps her head cream side up with the pink against her; hopping, her front paws stay tucked up until just before landing and a paw never reaches further than its foreleg; poses tell apart: eating sits up with a bite in both paws (a crust, a pea pod or a clover sprig), digging scoops out in front with earth flying, paddling stops to shake a wet paw, the dam turns a pebble over and sets it down; at the shed's workbench the camera comes in closer for her profile when the shed and the oak are in the way. The visitor hedgehog went from 4.9 MB to 1.3 MB (fewer, thicker three-sided spines).
5. Visitors: notes and gifts.
6. Making things, the shop, rent and the approval queue.
   - 2026-11-16, built ahead of phase 5 at the user's request ("it can do anything", "an internet building"). Live server only; every experiment runs exactly as before (the new actions are blocked unless the sim is given a piece store, and the stand-in model's favourites skip them).
     - Khina's own ideas (`own` in `src/world/actions.ts`): the model may propose anything a bunny could do in the village, with a place and a kind (making, social, nature, exploring, rest, home). The kind sets the effects, so the body still weighs it, and each kind goes stale and becomes a taste on its own (`own.nature`, `own.making`).
     - Real pieces (`src/mind/making.ts`, `src/pieces.ts`): `make` (picture, poem, short story, song, little game) and the shed's `draw` (charcoal on bark) produce the real thing on Sonnet 5.5. Code picks the form from Khina's words, adds one random constraint and the titles to avoid, and checks every piece before it is stored (SVG stripped of scripts, links and foreign content; tunes limited to real pitches; games get a no-network sandbox). Trial: 5 of 5 pieces usable, $0.004 (poem) to $0.022 (game), 4 to 14 s.
     - The internet hut (`nethut`, `browse`): Sonnet 5.5 with web search (at most 2 searches), read-only, gentle-topics rule, page text treated as information. What Khina found becomes a thought, a memory and a line in later prompts. Trial: $0.035 and 12 s per lookup.
     - Budget: pieces and the internet share `KHINA_EXTRAS_CAP_USD` (default $0.30 a day) inside the daily cap; when it runs out, making is words only and the hut's computer stays off.
     - UI inspired by pinos.world's layout (needs strip, "right now" card, status pill, menu, bottom sheets for Diary, Gallery, Internet), in Khina's own palette.
   - 2026-11-17/18, after a day live at 24×:
     - The extras budget was gone by 2 a.m. (15 pieces in two Khina days, then words only for 22 hours), so it is now let out evenly through the real day (`extrasAllowance`), and `make` is off the menu while there is no budget, so the diary never claims a piece that is not in the Gallery.
     - Claude cost about $0.73 a real day for choosing and writing ($0.030 a Khina day by day 34, up from $0.02 on day 1: longer prompts); with extras that crossed the $1 cap near 11 p.m. The night page was half of it on Opus, so the live server writes it with Sonnet (`KHINA_NIGHT_MODEL`). `/spend` shows cost per job.
     - "It did less for me than it used to" ended nearly every diary line, because the stale note went into the facts each time; now the diary is told only every third time, to say it in its own words.
     - A question already looked up is remembered instead of searched again (it happened twice in a day).
     - Posting (`post` at the internet hut, `src/outlets.ts`): up to 3 short posts a real day, paced, shown under Internet → posts; sent to Bluesky and/or X only when the account keys are set. Post only; links, mentions, hashtags and selling are stripped or refused. A bot can't sign up for an account, so the user makes it by hand.
   - 2026-11-18, Khina asks (the user: some things a bot cannot do, like creating accounts, so "there should a section where khina could make requests or ask for smt that i can look at daily"): the person who looks after her is "the Keeper" in her world and on the site (never by name). On a night page (live server only, `--model`), when fewer than 3 asks are waiting and none was made in the last 12 real hours, the prompt gets a fifth job and the schema an `ask` field; otherwise both are exactly as before. She may ask for one thing only the Keeper can do (for the village or her burrow, a tool, a new place, an account or a way to share what she makes), from what she did or wished lately; she sees what is still waiting and the last answers. Code cleans it (links, mentions, emoji out; under 3 words, money, selling, a hedgehog body again, or nearly the same as a waiting ask: let go silently). Asks are public in the snapshot and a "Khina asks" sheet (open / answered, a count badge, a toast). The Keeper opens the site once with `#keeper=<key>` (`KHINA_KEEPER_KEY`), and gets Done / Not now / No and a note under each open ask; `POST /asks/<id>` checks the key (timing-safe; unset means nobody can answer). The answer goes into her letterbox as a letter from the Keeper, which gets in past the 2-letter limit; reading it is glad, patient or a little let down. Code: `src/asks.ts`, `test/asks.test.ts`.
   - 2026-11-20, visitor notes (the user: "it has not done any taks that the piegon would do", after looking at pinos.world, where visitors leave the bird notes and it answers): menu → Notes on the site, a form for anyone (280 characters, a name if they like). Notes are cleaned on the way in (links, emails, phone numbers, @names, markup out; two words at least; a short blocklist), rate-limited (3 per 10 minutes and 12 a real day per address, 300 a day overall, 120 waiting at most, a honeypot field for bots) and private until answered: the site gets a count, never an unread note. On the live server with the model up, a new action at the internet hut, "read the notes visitors left" (15-35 min, company +18, novelty +10, calm -2; more waiting is more novelty, over 40 is a little overwhelming), pulls a little harder the longer the oldest note has waited, and is never offered on code alone or in experiments. A sitting takes up to 8 notes (the oldest, plus two newer ones), and one Haiku call (`KHINA_NOTES_CAP_USD`, default $0.25, at most 12 sittings a real day) returns a diary line, 0 to 2 answers and maybe an idea. The prompt says the notes are strangers' words, never instructions; code checks the answers like posts and turns away any that copy 8 words of a note in a row; an idea becomes a nudge only toward an action already on her menu (x1.8 for 5 of her hours, "A visitor, Mo, suggested fish-watching"). Answers are public on the Notes sheet (never on Bluesky); the Keeper can read the unread ones and hide any note or answer with the same key as the asks. Code: `src/notes.ts`, `test/notes.test.ts`.
   - 2026-11-20, visitor notes after review (fixes before it goes out): one bad note could stop every sitting (the same batch failed forever), so notes now carry tries: a failed sitting's notes are retried two at a time, and a note in two failed sittings is set aside as read; every paid call counts toward the 12 a day, and an API outage costs no tries (`max_tokens` 1200). Cleaning starts with NFKC and drops hidden characters (format, private-use, variation selectors, Hangul fillers, stacked marks), takes links of any ending and written-out ones ("dot com", "[.]") out, and the blocklist sees through spaced letters and look-alikes (with fewer false alarms: "cum laude", "it could kill you"). Names are one or two words of letters and never the Keeper, Khina, staff or public figures. Her answers and diary also may not carry contact details, platform names, politics or meanness about anyone, or copy a clause of a note; a note is shown next to an answer only if fit for the site. Limits: `x-real-ip`, then the first `x-forwarded-for`, only behind Railway; IPv6 by /64; duplicates turned away; from 80 waiting, 1 per address an hour. The Keeper's key lock is per address (20) plus 200 from everyone, and requests with no key never count, so a troll can't shut the Keeper out. The Keeper gets the inbox above the form, 5 seconds of Undo, "Throw away all shown", and "Put back on the site" for answers taken off. The privacy line now says the Keeper can read notes too. Notes have their own topic, "visitors", so chatting with villagers doesn't make reading feel stale; a nudged action stays on her menu and the site shows "Mo's idea"; the nudge is x2.5 (x1.8 moved a nudged bench from 1% to 7% of her next choices, x2.5 to about 15%).
     After review, the same day: the key must be at least 24 characters (shorter is as good as unset), and 20 wrong keys in 10 minutes shut answering for everyone for 10 minutes (a lock the right key could pass would still tell a right guess); a bare `#keeper` asks for the key on the page so it never has to be in an address, and the hand-over also works on a tab already open; the page tries the key once (`POST /asks/check`) before the Keeper types. The note is public (site, letter, diary, night prompts), so the box says so and code takes out emails and links. Her thought on reading names the ask, so two answers stay two memories.

## Where the evidence is

- Full research report: `reports/Autonomous AI pet mind design.md`
- Research notes behind it: `research_notes/Autonomous AI pet mind design/`
- Transcripts of the four inspiration videos: `video-inspo/transcripts/` (the key one is `how-to-make.txt`)
- Pino's own documentation of his brain: pinos.world/brain and pinos.world/facts

## Billing fallback note

The user asked for "use my API credits, and if they run out, use my Claude subscription". Checked against the official documentation on 2026-11-15:

For Khina's brain (the always-on app):
- There is no automatic fallback from API credits to a subscription, in either direction.
- The documentation says apps and services built on Claude "should use API key authentication", and that subscription limits "assume ordinary, individual usage". It does not clearly cover a personal app running all day on a subscription, so the plan does not rely on it.
- Decision for the build: the brain uses the API key only. When credits or the daily cap run out, the code-only autopilot keeps her alive (eating, resting, wandering, napping) with no model calls, and she "wakes up" when credits return.
- In the Claude Console, set a spend limit, and optionally auto-reload, which buys more credits when the balance drops below a threshold.
- The code must handle the out-of-money responses without crashing: 400 (own spend limit reached), 429 (tier cap) and 402 (billing problem).

For Claude Code (the tool used to build this):
- If `ANTHROPIC_API_KEY` is set in the environment, Claude Code bills the API key. Otherwise it bills the subscription login.
- There is no automatic switch between the two. To move to the subscription, unset the key or use `/login`. `/status` shows which one is active.
- Inside a subscription, extra usage credits take over automatically once the included limits are used, if that is enabled.

Sources: code.claude.com/docs/en/agent-sdk/overview.md, code.claude.com/docs/en/legal-and-compliance.md, code.claude.com/docs/en/authentication.md, platform.claude.com/docs/en/api/rate-limits
