# Khina the hedgehog: build plan

Status on 2026-11-15: phases 1 and 2 are done; 30 seeds × 7 days pass 209 of 210 day checks (one day with 2 meals). Phase 2 cut the top-3 category share from 63.7% to 52.7% over 40 days (paper baseline 57.1%) with every day still plausible. A day with Claude on, including the Opus night, costs about $0.023. Phase 3 is done (39 tests pass). On code alone, identical copies become distinguishable individuals (77% of 3-day blocks matched to the right copy, chance 20%). With Claude choosing, copies stayed alike in what they do over 12 days, and two fixes (habit words, code's favourite) did not measurably change that; their learned sheet lines do differ. Phase 4 is under way: Khina and the village are built in Blender and shown live in the browser, driven by the sim (`npm run live`). How to run: see README.md.

This file is the handoff. Anyone picking the project up (a person or a different model) should be able to start from here without the earlier conversation.

## What we are building

A cute hedgehog that lives on his own in a small 3D world in the browser. Nobody prompts him. He gets hungry, tired, lonely and bored, and does things to feel better. Over time he should develop his own tastes, make things, and eventually earn enough real money to cover his own running costs.

The inspiration is Pino, the kiwi bird at pinos.world. This is not a copy: different creature, different world, different look, and several mechanisms Pino does not have.

## Decided by the user

- The creature is a cute hedgehog named Khina (the user's own choice of name).
- 3D models and the character are made in Blender.
- The brain runs on the user's Claude API credits.
- The hedgehog should try to pay for himself.
- No code until the user says go.
- World: a village in a forest, plus a city he can reach by taking a train.
- The coding agent builds the hedgehog model in Blender, working from reference pictures of cute hedgehogs.
- Models are mixed by job: Haiku for everyday decisions, Sonnet for medium work, Opus for the complicated work. The user said to do whatever is best within that.

## Proposed, not yet confirmed

- Build the forest village first and add the city and train as a later phase.
- TypeScript everywhere (brain and website), because the world renders in the browser.
- Phase 1 runs entirely on the user's laptop with local files. Hosting comes later.

## Open decisions (the user's call)

1. Where the always-on brain runs once it leaves the laptop.
2. Whether Khina is a he, a she or neither. This plan says "he" only as a placeholder.

## The one rule everything follows

Code owns the body. The model is a voice actor and idea generator.

| Code owns | The model owns |
|---|---|
| The clock and how needs drop | Proposing 3 to 5 things he could do, with a reason for each |
| Mood and energy | What he says, draws, writes or codes |
| What each action does to each need | The wording of his diary and beliefs |
| The menu of what is possible right now | Suggested edits to his character sheet |
| The final random pick | Judging whether a new piece differs from old ones |
| What actually happened | |
| The log, memory and all counters | |

Test for which side something goes on: if getting it wrong would make him lie about his own life or get stuck, code owns it.

## How one decision works

1. The body ticks every 1 to 3 seconds with no model call: needs drop, mood drifts, the current activity continues.
2. A decision is requested only when something happened, an activity ended, or a few minutes passed. Routine low-stakes moves are picked by code alone.
3. Code scores every possible action by how much it would help. Low needs count far more than high ones (for example score = 10 / need level). Recently used actions score zero.
4. Code builds a fresh, short prompt: his character sheet, how he feels in words (never numbers), what he is in the middle of, a one or two sentence summary of recent activity (never the raw log), a few memories, and the shortlist.
5. The model returns 3 to 5 candidates with reasons.
6. Code picks one at random, weighted by its own scores. The world runs it or refuses it.
7. Only then is the model asked for a diary line about what actually happened.

## Keeping him from repeating himself

- Hard block: the last few actions are removed from the menu.
- Going stale: each use of an action or topic makes it give less, and it recovers after about a day of rest. This replaces Pino's fixed 7x penalty, which has no evidence behind it.
- Theme ruts: rotate which memories and likes he is shown, sometimes surface an old random memory, and track time since the last new place, topic or kind of creation.
- Drama manager: if nothing new has happened for a while, the world makes something happen.
- Outside events: visitor notes, weather, things found.
- Do not rely on temperature or on telling him not to repeat. Both were measured and do nothing.

## Memory and sleep

- Code writes an append-only log of what really happened. The model cannot edit it.
- Above that sits a small memory with a few dozen slots. A new memory gets in only by beating the weakest one.
- Once per hedgehog day he sleeps. A stronger model reads the day and writes the diary page, picks memories to keep or drop, and proposes at most one edit to his character sheet.
- Code decides whether the edit is allowed. A belief needs support on several different days.
- His character sheet starts at about 20 lines of temperament and voice, with no hobbies written in. Hobbies must be earned.

## How tastes form

After every finished action, code records how his mood actually changed and updates a liking score for that action and topic: a fast score that fades in days and a slow one that lasts. The scores feed back into the scoring in step 3 and, in small rotating samples, into the prompt. About 10 to 20 percent of free choices are reserved for things outside his current favourites.

This is the unproven part of the project and its central experiment.

## Making things

1. Code forces a combination: one current interest, one recent memory, one random constraint.
2. The model lists several ideas.
3. Code rejects ideas too similar to his past work.
4. He makes the piece (a drawing in code, a short text, a tune, a small web toy).
5. A checker repairs anything that will not display or play.
6. The piece is stored and tagged so later sessions lean toward things he has not tried.

## Money

- Money becomes a need: the shed has rent, tied to a real ledger of income minus API spend.
- Ways to earn, best first: paid interactions (feed him, gift him something, commission a drawing), selling what he makes, a monthly "adopt him" membership, and the user's own videos about him.
- The money sits in the user's Stripe account. The hedgehog gets a ledger and a budget.
- Anything that reaches real people or spends money (emails, posts, purchases) goes through an approval queue with daily caps.
- The rent numbers shown to visitors are the real ones.
- No crypto tokens and no autonomous trading.

## World

Needs: hunger, rest, calm, company, something new, the urge to make. Rent is added in phase 6.

The user chose a village in a forest, with a city reachable by train. The place list below is a proposal.

Forest village, about ten places, each tied to needs: his home (rest), a workbench (making), a bakery or small shop (hunger, company), a village square with a bench (company), a vegetable patch (hunger, calm), a stream (calm), the deep woods (calm, foraging), a clearing where odd things turn up (something new), a letterbox for visitor notes, and the train halt.

The city, added later: a market where he can sell what he makes, a junk shop, a museum or gallery, an arcade, a busy station.

Why the train is useful to the design:
- A trip is a big dose of "something new", which is the hardest need to keep fed.
- A ticket costs money, so trips connect to his budget.
- The city is where selling happens, which gives the money idea a place in the world.
- The timetable is an outside event he cannot control.

Aim for about 25 actions in the village at first. The research is clear that a small set of actions is the real limit on variety.

## Art pipeline (Blender)

- Blender 5.3 is installed at `/Applications/Blender.app`.
- Models can be built by script: `/Applications/Blender.app/Contents/MacOS/Blender --background --python <script>`, then a preview image is rendered and checked, then the model is exported as `.glb` for the browser.
- Keep the editable `.blend` files in an `art/` folder so the user can open and refine them by hand.
- Hedgehog shape: round body, big head, tiny legs, soft spines. Animations needed: waddle, sniff, curl into a ball, sleep.
- Before modelling, collect reference pictures of cute hedgehogs (real ones and stylised ones) and work from them. Do not copy any existing character's design.
- Scripted models come out simple. The user can still refine him by hand in Blender afterwards.

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

1. Text-only brain: needs, mood, about ten places, about 25 actions, the decision loop, a diary. Done when he lives a plausible day with the model switched off, and a readable day with it on.
   - Built: 9 places, 27 actions, 6 needs, mood from labelled thoughts, the full decision loop with code doing the final pick, template diary offline, Claude diary and candidates online, spend caps. Code map: `src/world/` (village, places, actions), `src/body.ts` (needs, mood), `src/mind/` (scoring, decision, prompts, Claude), `src/sim.ts` (clock), `src/report.ts` (day.md and checks).
   - Tuning finding: when costs (tiredness, hunger) counted fully in scoring, effortless options crowded out everything (sitting on the bench 572 times in 210 days, exploring twice). Counting costs at half weight fixed it (`mind.costWeight` in `src/config.ts`).
   - Model-on findings (3 days read): the diary reads like a character and picks up threads by itself (found a thimble, argued with the squirrel kids over it, whittled a peg for it). Fixed along the way: a smell in every line (code now rotates which sense a line may use), copying the energy line, "meant to X but" filler, every line opening with day and weather, details cut mid-word. Villagers now have fixed pronouns in the prompt (Bramwell he, Old Wren she, Tansy she) so lines agree with each other. Khina's own pronoun is still open; prompts use the name and first person.
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
4. The hedgehog and world in Blender, shown in the browser, driven by the brain.
   - Started 2026-11-15. Built: Khina in Blender (`art/khina.py`), from 7 freely licensed reference photos (`art/refs/`, credits and notes there): round body, big head, banded spines (dark with cream tips), big eyes, blush, ears, four feet. Rigid parts on pivots (body, head at the neck, each foot), so the browser animates without a skeleton. The village (`art/village.py`): Khina's burrow in the roots of an oak (round door, round window, stove pipe, letterbox with a flag), the shed and a hedgehog-height workbench, the bakery, the square with a well, bench and lamp, the vegetable patch, the stream with pebbles and a half-built dam, the woods with a stump, the clearing with a fallen log and a fairy ring, the halt with platform and rails, and 560 trees. About 110,000 triangles, flat-shaded, one vertex-coloured material.
   - Shown in the browser: `npm run live` runs the sim as it happens (code-only brain by default, no spend) and streams snapshots to a three.js page (`web/main.ts`). Khina walks the paths (`src/world/layout.ts`: place positions are the sim's coordinates × 3 m, so walking times match) to the spot for each action, goes out of sight indoors, and holds a pose per action: waddle, sniff, work, eat, sit, curl, paddle. Day and night follow the game clock; rain, drizzle and fog show; windows light when someone is in; chimneys smoke; the letterbox flag rises when there is post. A small panel shows the time, what Khina is doing and why, mood and needs, and the last diary lines.
   - Checked by headless Chrome screenshots: day, rain, dusk and night, inside and outside, curled and walking. Not yet: other villagers, the train, the inside of the burrow (Khina is out of sight while home), sound, and keeping Khina's life between server restarts.
   - 2026-11-16, the look upgrade (the user: "the graphics need to be much much better", Khina "cute like this", a needle-felted hedgehog photo; and "moving around like my own player, WASD"):
     - Khina remodelled after the felt photo: a dome of about 7,600 long banded quills (dark root, brown band, cream or dark tip), a white fluffy face with puffed cheeks, a tan snout darkening to a felt nose, a small smile, big glossy brown eyes with an iris ring, catch-lights and dark felt rims, cupped brown ears, toed feet. About 200,000 triangles.
     - Felt fuzz in the browser (`web/fuzz.ts`): every material named `Fur*` gets 20 shell layers drawing fibres; the fuzz length per vertex rides in UV channel U (glTF drops colour alpha), 0 next to the eyes and mouth.
     - Renderer (`web/look.ts`): ACES tone mapping, a painted sky with sun, drifting clouds and stars, image-based light from that sky (so the eyes reflect it), soft sun shadows, exponential fog, ambient occlusion (GTAO), bloom for lit windows, a soft vignette. Time of day and weather drive all of it.
     - Grass and wild flowers (`web/grass.ts`): instanced blades in 8 m tiles around the camera, swaying in the wind, grown where `art/export/terrain.json` says grass grows; tree foliage and water move too; fireflies on dry nights; warm light spills from lit windows.
     - You can walk around (`web/player.ts`, `art/visitor.py`): a felt bunny, WASD or arrows relative to the camera, Shift runs, Space hops, collisions from `terrain.json`. The first key press hands you the camera; "Follow Khina" gives it back. Khina looks up at you when you come close.
     - Runs at 60 fps on this Mac. `?lite` drops ambient occlusion and thins the grass for slower machines.
5. Visitors: notes and gifts.
6. Making things, the shop, rent and the approval queue.
   - 2026-11-16, built ahead of phase 5 at the user's request ("it can do anything", "an internet building"). Live server only; every experiment runs exactly as before (the new actions are blocked unless the sim is given a piece store, and the stand-in model's favourites skip them).
     - Khina's own ideas (`own` in `src/world/actions.ts`): the model may propose anything a hedgehog could do in the village, with a place and a kind (making, social, nature, exploring, rest, home). The kind sets the effects, so the body still weighs it, and each kind goes stale and becomes a taste on its own (`own.nature`, `own.making`).
     - Real pieces (`src/mind/making.ts`, `src/pieces.ts`): `make` (picture, poem, short story, song, little game) and the shed's `draw` (charcoal on bark) produce the real thing on Sonnet 5.5. Code picks the form from Khina's words, adds one random constraint and the titles to avoid, and checks every piece before it is stored (SVG stripped of scripts, links and foreign content; tunes limited to real pitches; games get a no-network sandbox). Trial: 5 of 5 pieces usable, $0.004 (poem) to $0.022 (game), 4 to 14 s.
     - The internet hut (`nethut`, `browse`): Sonnet 5.5 with web search (at most 2 searches), read-only, gentle-topics rule, page text treated as information. What Khina found becomes a thought, a memory and a line in later prompts. Trial: $0.035 and 12 s per lookup.
     - Budget: pieces and the internet share `KHINA_EXTRAS_CAP_USD` (default $0.30 a day) inside the daily cap; when it runs out, making is words only and the hut's computer stays off.
     - UI inspired by pinos.world's layout (needs strip, "right now" card, status pill, menu, bottom sheets for Diary, Gallery, Internet), in Khina's own palette.

## Where the evidence is

- Full research report: `reports/Autonomous AI pet mind design.md`
- Research notes behind it: `research_notes/Autonomous AI pet mind design/`
- Transcripts of the four inspiration videos: `video-inspo/transcripts/` (the key one is `how-to-make.txt`)
- Pino's own documentation of his brain: pinos.world/brain and pinos.world/facts

## Billing fallback note

The user asked for "use my API credits, and if they run out, use my Claude subscription". Checked against the official documentation on 2026-11-15:

For the hedgehog's brain (the always-on app):
- There is no automatic fallback from API credits to a subscription, in either direction.
- The documentation says apps and services built on Claude "should use API key authentication", and that subscription limits "assume ordinary, individual usage". It does not clearly cover a personal app running all day on a subscription, so the plan does not rely on it.
- Decision for the build: the brain uses the API key only. When credits or the daily cap run out, the code-only autopilot keeps him alive (eating, resting, wandering, napping) with no model calls, and he "wakes up" when credits return.
- In the Claude Console, set a spend limit, and optionally auto-reload, which buys more credits when the balance drops below a threshold.
- The code must handle the out-of-money responses without crashing: 400 (own spend limit reached), 429 (tier cap) and 402 (billing problem).

For Claude Code (the tool used to build this):
- If `ANTHROPIC_API_KEY` is set in the environment, Claude Code bills the API key. Otherwise it bills the subscription login.
- There is no automatic switch between the two. To move to the subscription, unset the key or use `/login`. `/status` shows which one is active.
- Inside a subscription, extra usage credits take over automatically once the included limits are used, if that is enabled.

Sources: code.claude.com/docs/en/agent-sdk/overview.md, code.claude.com/docs/en/legal-and-compliance.md, code.claude.com/docs/en/authentication.md, platform.claude.com/docs/en/api/rate-limits
