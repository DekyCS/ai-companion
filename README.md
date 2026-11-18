# Khina

A small bunny who lives in a forest village and decides what to do by herself.
Watch Khina live in a 3D village in the browser, or run days as text: a diary, with a page written each night.

## Watch Khina

```sh
npm install
npm run live                      # then open http://127.0.0.1:5174 (code-only brain, free)
npm run live -- --speed 20        # 20 game minutes a second; --speed 0.0167 is real time
npm run live -- --model           # Claude chooses and writes (about $0.023 a game day, under the daily cap)
```

The server runs the sim and streams each event to the page, which walks Khina along the village paths
to the spot for each action. Drag to look around; "Follow Khina" keeps the camera on Khina.

Walk around yourself as a little felt hedgehog: **WASD** or the arrow keys (relative to the camera),
**Shift** to run, **Space** to hop. The first key press hands you the camera; "Follow Khina" gives it back.
Khina looks up at you when you come close. The villagers stand where the sim says they are, the little
train stops at the halt on its timetable, and the speaker button turns on the sound (wind, rain, the stream,
birds by day, crickets at night). The camera moves in front of trees and roofs that would hide Khina.

Debug views: `?pose=curl&dist=3` (or walk, sniff, work, eat, sit, paddle) holds a pose; `?hour=19.5`
and `?weather=rain` fix the light; `?clean` hides the panels; `?lite` is lighter for slow machines.

The models are made in Blender by script, from `art/khina.py`, `art/village.py`, `art/visitor.py` and
`art/villagers.py` (Bramwell, Old Wren, Tansy, Pip and Nettle, the voles and the traveller, shown wherever the
sim has them this hour; `?villagers=all` shows them all); `npm run art` rebuilds `art/export/*.glb`, `art/export/terrain.json` (ground height, where grass grows,
what you can't walk through), the editable `art/*.blend` files and preview pictures in `art/previews/`.
Where everything stands is in `src/world/layout.ts`, shared by Blender and the browser.

## Always on (Railway)

Live at https://khina-production.up.railway.app: Claude is the brain, and Khina lives a day every
real hour (`--rate 24`; `--rate 1` would put Khina on your wall clock, set by `TZ`). About $0.023 a
Khina day, so about $0.55 a real day, capped by `KHINA_DAILY_CAP_USD` (default $1).
The `Dockerfile` runs `src/live.ts --model --clock real --rate 24 --persist data/khina-state.json`; a volume at
`/app/data` keeps Khina's life and the spend ledger across redeploys, and after downtime the sim
catches up on the hours missed. A save from before 2026-11-18, when Khina was a hedgehog, is brought
over once on load (`src/migrate.ts`: dried beetles become clover, hedgehog-only memories and diary lines are let go; the file as it was is kept next to it as `<save>.hedgehog.json`). Redeploy with `railway up --detach`; logs with `railway logs`.

## Beyond the fixed village life (live server)

On `npm run live`, Khina can also:
- do anything of her own: Claude may propose an idea that is not on the menu, with where and what kind of thing it is; Khina's needs still weigh it;
- make real pieces: pictures (SVG), poems, short stories, songs (a tune the page plays) and little games, kept in `<save folder>/pieces/` and shown in the Gallery;
- look things up at the internet hut: a real web search, read-only; what Khina found shows under Internet and turns into memories.

- post a few short notes a day at the internet hut (`KHINA_POSTS_PER_DAY`, default 3), shown under Internet → posts.

These need `--model`. Pieces and lookups stay within `KHINA_EXTRAS_CAP_USD` (default $0.30 a day, $0.50 on the live server; inside the daily cap),
let out evenly through the day so a fast clock can't spend it all after midnight. `/spend` shows what Claude has cost per job.

### Giving Khina an account

Posts stay on the site until an account is connected. Someone makes the account by hand (a bot can't sign up),
marks it as automated, and sets its keys as Railway variables; `src/outlets.ts` only ever posts (no replies,
likes, follows or messages), with no links, mentions, hashtags or selling.

- Bluesky (free): `BSKY_HANDLE` and `BSKY_APP_PASSWORD` (Settings → Privacy and security → App passwords).
- X (X bills about $0.015 a post): `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` from a read+write app at developer.x.com.
- `KHINA_PUBLIC_URL` links a shared piece on Bluesky.
Pieces are served at `/pieces` (list), `/pieces/<id>.json`, `.svg` and `.html` (games run sandboxed, no network).

## Khina asks

Some things only a person can do for Khina: make an account, add a new place or tool to the village,
build a feature. So at night, while she writes her page, Khina may ask the Keeper (whoever looks after
her) for one such thing, in her own words with a short why. Code keeps it rare: fewer than 3 asks
waiting and none in the last 12 real hours, so at most about 2 a real day (most nights she asks for
nothing). It turns away anything about money, buying or selling, links and mentions, and repeats of an
ask still waiting. Asks need `--model` (the night page is Claude's job) and show on the site under
the menu → **Khina asks**, where anyone can read them.

Only the Keeper can answer, once a day or whenever:

1. Make a new random key with `openssl rand -hex 24` and set it as `KHINA_KEEPER_KEY` in
   Railway → the service → Variables (locally: `KHINA_KEEPER_KEY=... npm run live`). Use a new random
   key, never a password you use anywhere else (not the one for Khina's accounts). Without it, or with
   one shorter than 24 characters, nobody can answer. After 20 wrong keys in 10 minutes nobody can
   answer for 10 minutes, and the server log counts the wrong keys (it never prints them).
2. On your own browser, open `https://khina-production.up.railway.app/#keeper` and type the key in the
   box (your password manager can keep it). `/#keeper=<key>` works too, also on a tab that is already
   open, and the page takes the key out of the address bar, but that address stays in the browser's
   history. Either way the page keeps the key in that browser only.
3. Under each open ask there are three buttons, **Done**, **Not now** and **No**, and a box for a note
   (up to 300 characters). "forget key" at the bottom of the sheet takes the key off that browser.

Your note is public: it shows on the site and in her diary, and she reads it on later nights. Never
put passwords or emails in it (email addresses and links are taken out anyway).

The answer reaches Khina in the village: a letter from the Keeper lands in her letterbox
(`About "<her ask>": done. <your note>`), the flag goes up, and when she reads it she is glad, patient
or a little let down, and remembers which ask it was. She sees her answered asks on later nights, so
she doesn't ask again.
Behind the buttons: `POST /asks/<id>` with `{"status": "done" | "notnow" | "no", "note": "..."}` and
the header `x-keeper-key` (`src/asks.ts`); `POST /asks/check` with the header only tries the key
(204 good, 403 wrong, 503 answering is off).

## Run days as text

```sh
npm run day -- --offline          # one day on code alone, free
npm run day                       # one day with Claude choosing and writing (needs a key)
npm run long -- --compare         # 40 days × 3 seeds, phase 2 off vs on, repetition measures (free)
npm run copies -- --compare       # 5 identical copies × 40 days: do they become individuals? (free)
npm test                          # 90 tests
npm run check                     # type-check the sim and the page
```

`npm run long` changes one thing at a time between conditions. `--exp` picks the experiment:
`compare` (phase 2 off vs on), `penalty` (none vs fixed 7× vs going stale), `parts` (each part off alone), `favourite` (model candidates alone vs plus code's favourite),
`claude` (code picks vs Claude picks, and Claude seeing feelings as words vs numbers; needs a key).
Other flags: `--days`, `--seeds 1,2,3`, `--sticky` (a stand-in model stuck on its favourites),
`--model` (Claude for every condition), `--night code` (no Opus night page; cheaper) and `--max-spend`.
It writes `runs/long-<time>-<exp>-<days>d/summary.md` with the measures next to the paper's baselines.

`npm run copies` takes `--copies 5`, `--days 40`, `--personalities 1,2,3`, `--compare` (tastes off as control), `--habits` (Claude without vs with habit words), `--vs <switch>` (any switch in `Features` off vs on, e.g. `codeFavourite`),
`--model`, `--night` and `--max-spend`, and writes `runs/copies-<time>/summary.md`.

Each run writes `runs/<time>-seed<n>-<offline|model>/`:

- `day.md`: the diary, each night's page, what Khina has learned, the plausibility checks, and an hour-by-hour table
- `events.jsonl`: every decision, start and finish
- `calls.jsonl` and `prompts.md` (model runs only): every Claude call, its cost, and the exact prompt

## Options

| flag | default | what it does |
| --- | --- | --- |
| `--days` | 1 | how many days to live |
| `--seed` | 1 | which random world; the same seed replays the same day offline |
| `--offline` | off | never call Claude |
| `--max-spend` | 0.50 | most this run may spend, in US dollars |
| `--speed` | 0 | real milliseconds per game minute (0 = as fast as possible) |
| `--quiet` | off | print only the summary |

## Switching the model on

1. Copy `.env.example` to `.env`.
2. Paste your key from platform.claude.com after `ANTHROPIC_API_KEY=`.
3. Run `npm run day`.

`.env` is ignored by git. A simulated day cost about $0.023 in testing: about 47 Haiku 5.5 calls
plus one Opus 5.5 night page ($0.014 to $0.018).
Spending stops at `KHINA_DAILY_CAP_USD` per calendar day (default $1, tracked in `data/spend.json`)
and at `--max-spend` per run. When the money runs out or the API fails, Khina keeps living on code alone.

The full design and the reasons behind it are in `PLAN.md`.
