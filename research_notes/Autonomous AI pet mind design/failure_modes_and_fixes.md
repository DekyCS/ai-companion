# Failure modes of long-running LLM agents (repetitive, generic, incoherent) and fixes with measured evidence

Notes compiled 2026-11-15. Conventions used below:
- "Primary" = the paper or lab post itself was fetched and read (through an automated page reader, so table values were extracted by a summariser model and should be spot-checked before being quoted in print).
- "Secondary" = the fact comes from a summary, news piece or blog about the primary source.
- "Not re-fetched" = cited from the researcher's prior knowledge with a link believed correct, but not opened this session.
- Several sources are 2026 arXiv preprints (IDs starting 26xx). They are recent, mostly not peer reviewed, and unreplicated unless stated.

## 1. Mode collapse and low diversity: is it real, why do repeated identical prompts converge, and is "better prompts cannot fix it" true?

### Takeaway
Mode collapse under repeated identical prompts is well measured and large (frontier chat models give fewer than 3 distinct answers out of 10 at temperature 1; one 2026 study finds the same answer in 57% of persona-item pairs across 50 calls), and the best-supported cause is post-training (instruction tuning, preference optimisation), not decoding. The claim "better prompts cannot fix it" is half right: instruction-style prompt tweaks (paraphrase, system prompt, "do not repeat", CoT) barely help, but prompts that change the task from "sample one" to "describe or list the distribution", plus randomness supplied by code, cut the error by an order of magnitude.

### Cited Findings
Homogenisation evidence (human-facing studies)
- Doshi and Hauser (Science Advances, published 12 July 2024): writers given GPT-4 ideas wrote stories rated more creative, but the AI-assisted stories were more similar to each other than stories by unaided writers; almost all of the creativity gain went to the least creative writers. Secondary source; effect sizes not retrieved — [PsyPost summary](https://psypost.org/new-study-on-ai-assisted-creativity-reveals-an-interesting-social-dilemma)
- Anderson et al.: in a 36-person study, ChatGPT users' ideas were more semantically similar across users (group-level homogenisation) than ideas produced with the Oblique Strategies card deck as the creativity aid — [arXiv 2402.01536](https://arxiv.org/html/2402.01536v2)
- "We're Different, We're the Same: Creative Homogeneity Across LLMs": individual LLM responses are rated about as creative as, or more creative than, the average human response, but LLM responses are more similar to each other than human responses are, and this holds across different LLMs, not only within one model — [arXiv 2501.19361](https://arxiv.org/html/2501.19361v1)
- "Echoes in AI" (Xu et al., PNAS 2025): introduces the Sui Generis score (uniqueness of a plot element among alternative continuations from the same prompt). On 100 short stories, GPT-4 and LLaMA-3 stories contain combinations of plot elements that are echoed across generations and across different LLMs, while human-written stories are rarely echoed; score correlates moderately with human surprise judgments — [arXiv 2501.00273](https://arxiv.org/html/2501.00273v2)

Repeated-prompt convergence (direct measurements)
- NoveltyBench (Zhang et al., CMU, 2025): 1,100 prompts, 20 models, 10 independent samples per prompt at temperature 1.0 (the authors call this the best case for diversity). Claude 3 and GPT-4o class models produce fewer than 3 distinct responses out of 10. Least diverse: Claude-3.5 Sonnet at 1.76 distinct out of 10; Llama-3.3-70B at 2.49. Most diverse: Llama-3.2-1B at 6.74 — [arXiv 2504.05228](https://arxiv.org/html/2504.05228v4)
- "Instruction-Tuned Language Models Cannot Sample from Distributions They Can Describe" (Jang, Kim, Lee, KAIST; arXiv v3 dated 10 Oct 2026): asked for a uniform integer 1 to 100, gpt-4o returns 42 in 78% of calls; on five structured targets a single answer is returned in at least 98% of calls; on a uniform 1 to 5 target 94.3% single answer; on OpinionQA 57% of (persona, item) pairs return the same answer across all 50 calls and 80% return the same answer in over 90% of calls. Cross-family check: plain sampling fails (total variation over 0.20) in 21 of 25 model-task cells across gpt-5.4, claude-sonnet-4.5, gemini-3-flash-preview and others — [arXiv 2607.25292 via alphaXiv](https://www.alphaxiv.org/abs/2607.25292.md)
- Same paper: the top-two logit gap at temperature 0 is 3.75 to over 16 nats across targets, i.e. the collapse is in the logits, not just the decoder — [arXiv 2607.25292](https://www.alphaxiv.org/abs/2607.25292.md)

Cause: post-training and typicality bias
- Verbalized Sampling paper (Zhang et al., accepted ICML 2026): proposes "typicality bias" in human preference data as a data-level cause. On 6,874 HelpSteer response pairs with equal correctness ratings, the estimated typicality weight is 0.57 ± 0.07 (Llama 3.1 405B base as reference) and 0.65 ± 0.07 (GLM 4.5 base), both p < 1e-14. Across four preference datasets and five base models, annotators prefer the more typical response 4 to 12 percentage points above the 50% chance rate — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3); venue: [PMLR v306](https://proceedings.mlr.press/v306/zhang26hy.html)
- Same paper, Tulu-70B poem task: after DPO, direct prompting retains 23.8% of the base model's diversity; Verbalized Sampling retains about 66.8% — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3)
- NoveltyBench: on OLMo 2, each alignment stage (SFT, DPO, RLVR) reduces diversity, with the largest drop at DPO — [arXiv 2504.05228](https://arxiv.org/html/2504.05228v4)
- Jang et al.: base vs instruct total-variation gaps 0.15 (Llama-3.1-8B), 0.26 (Mistral-7B), 0.34 (Qwen2.5-7B). OLMo-2 by training stage: base 0.236, SFT 0.321, DPO 0.411, RLVR 0.442. Qwen2.5-Coder 0.168 vs Qwen2.5-Instruct 0.540 — [arXiv 2607.25292](https://www.alphaxiv.org/abs/2607.25292.md)

Evidence on whether prompts can fix it
- Prompt tweaks that do NOT work well: NoveltyBench finds paraphrasing and system prompting "only marginally effective" — [arXiv 2504.05228](https://arxiv.org/html/2504.05228v4). Jang et al. test eight "do the sampling" interventions (feedback, framing, in-context demos, CoT variants); every one leaves mean total variation at 0.43 or higher against 0.52 for plain sampling — [arXiv 2607.25292](https://www.alphaxiv.org/abs/2607.25292.md)
- Prompt changes that DO work: asking for a list of N exemplars, or a JSON probability distribution that code then samples from, drops mean total variation from 0.52 to 0.03, and list-of-N succeeds on all 25 cross-family cells with max TV 0.050 — [arXiv 2607.25292](https://www.alphaxiv.org/abs/2607.25292.md)
- In-context regeneration (show the model its previous answers and ask for another) is the most effective strategy in NoveltyBench; with it Claude-3 Opus, GPT-4o and Gemini 2.0 Pro roughly match human diversity over 8 generations on the 100 curated prompts. The authors conclude prompting partially closes the gap but diversity "must be elicited deliberately" because it is not in the default output distribution — [arXiv 2504.05228](https://arxiv.org/html/2504.05228v4)
- Verbalized Sampling raises creative-writing diversity 1.6 to 2.1 times over direct prompting with no training or logit access — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3)

### Inferences
- The creator's claim "you can't get better output from an LLM by just writing better prompts" is contradicted as a blanket statement and supported in a narrow form. Exhortation and rewording do little (TV 0.52 to at best 0.43); restructuring the request so the model enumerates options and code does the choosing works (TV 0.03). The fix is still a prompt, but its job is to move randomness and selection out of the model.
- Because the collapse is a 4 to 16 nat logit gap, temperature alone cannot plausibly rescue per-call sampling without wrecking coherence. This is consistent with NoveltyBench finding fewer than 3 distinct answers at temperature 1.0.
- "Asked repeatedly what it wants to do, an LLM becomes predictable" is directly supported: an always-on pet that asks the same "what next?" question each tick is exactly the repeated-identical-prompt condition these papers measure.

### Gaps
- Doshi and Hauser effect sizes (similarity deltas, creativity gains) were not retrieved from the primary paper; only a secondary summary was read.
- The typicality-bias account is correlational: it shows preference data favours typical text and that post-training stages reduce diversity, but no experiment isolates which component (SFT, preference optimisation, RL) is responsible; Jang et al. state this limitation explicitly.
- No study was found that measures collapse specifically for "what do you want to do now?" action-selection prompts in a simulated-creature setting.

## 2. Verbalized Sampling and related diversity techniques: methods, measured gains, limits, critiques

### Takeaway
Verbalized Sampling (ask for k candidates with probabilities in one call) is the best-documented prompt-level diversity fix, but in its own tables much of the gain comes from listing several candidates at once; the probabilities add a smaller increment and are not shown to be calibrated. No independent replication of the headline 1.6 to 2.1 times figure was found, though a 2026 paper independently confirms that the list or distribution format beats repeated sampling by a wide margin.

### Cited Findings
Verbalized Sampling (VS), Zhang, Yu, Chong, Sicilia, Tomz, Manning, Shi
- Variants (Table 1): Direct (one answer per call); CoT; Sequence ("Tell 5 jokes", list without probabilities); Multi-turn ("Tell another"); VS-Standard ("Tell 5 jokes with their probabilities"); VS-CoT (reason first, then VS); VS-Multi (repeat VS across turns, "5 more"). Wording chosen empirically: "probability" for VS-Standard and VS-CoT, "confidence" for VS-Multi. Creative tasks used k = 5 candidates and N = 30 responses — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3)
- Headline: 1.6 to 2.1 times diversity over direct prompting in creative writing; 25.7% improvement in human evaluation. Human-rated diversity (1 to 4 scale): poem Direct 1.90, Sequence 2.07, VS-Standard 2.39; story 2.74, 2.76, 3.06; joke 1.83, 2.93, 3.01 — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3)
- Per-model semantic diversity (Direct / Sequence / VS-Standard / VS-CoT). Poem: GPT-4.1 10.6 / 10.6 / 15.2 / 25.6; Claude-4-Sonnet 10.2 / 21.4 / 22.4 / 21.4; Gemini-2.5-Pro 13.4 / 22.2 / 28.2 / 29.4; GPT-4.1-mini 8.4 / 9.6 / 14.8 / 15.0; o3 13.2 / 26.8 / 26.0 / 28.0 (Sequence beats VS-Standard). Joke: Claude-4-Sonnet 17.4 / 51.2 / 60.2 / 60.6; GPT-4.1 27.0 / 58.0 / 60.2 / 60.8; Llama-3.1-70B 19.8 / 53.0 / 56.8 / 56.8 — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3)
- Dice-roll task, average KL divergence to uniform (lower is better): Direct 0.926, CoT 1.163, Multi-turn 0.119, Sequence 0.058, VS-Standard 0.027, VS-CoT 0.038, VS-Multi 0.029. Direct prompting often collapses to one outcome (for example 4) — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3)
- Distribution recovery: for a US-state naming task, VS-Standard KL to a pretraining-corpus reference is 0.132 (GPT-4.1) and 0.122 (Claude-4-Sonnet) against 14.886 and 16.160 for Direct — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3)
- Tunable diversity: prompts such as "generate five responses with probabilities below {threshold}" increase diversity as the threshold falls (thresholds tested from 1.0 down to 0.001); in open-ended QA coverage peaks near 0.1 while precision peaks near 0.9 and then declines. Exact values are in figures only — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3)
- Composes with decoding: VS-Standard improves the diversity-quality trade-off at temperatures 0.4 to 1.4 and with top-p and min-p — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3)
- Models tested: GPT-4.1-mini, GPT-4.1, Gemini-2.5-Flash, Gemini-2.5-Pro, Claude-3.7-Sonnet, Claude-4-Sonnet, Llama-3.1-70B-Instruct, Qwen3-235B, o3, DeepSeek R1. "Larger models (GPT-4.1, Gemini-2.5-Pro) achieve diversity gains 1.5 to 2 times greater than smaller models" — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3)
- Stated limitations: higher token and latency cost per call; "performance gains from VS are positively correlated with model scale"; less capable models occasionally lose quality. Measured quality drops with VS-Standard: GPT-4.1-mini poem 61.1 to 56.5 and story 50.1 to 43.4; Llama-3.1-70B poem 48.7 to 41.5 and joke 84.3 to 76.4; Gemini-2.5-Flash poem 55.4 to 51.6. "If k is too large, the generation quality degrades" — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3)
- Probability format ablation (implicit, explicit, relative, percentage, confidence, perplexity, NLL): "no single format provides a universally significant improvement" — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3)

Independent evidence and critique
- Jang et al. (2026) treat VS as equivalent in query structure to their "describe" pathway. On 100 OpinionQA items: describe TV 0.22, VS TV 0.23, Wilcoxon p = 0.14 (statistically indistinguishable); both beat persona-by-persona sampling at TV 0.46. List-of-N exemplars (no probabilities) and JSON probabilities sampled with NumPy both reach TV 0.03 on synthetic targets — [arXiv 2607.25292](https://www.alphaxiv.org/abs/2607.25292.md)
- Jang et al. caveat: both mitigations are "bounded by the model's prior"; a described distribution cannot be verified in advance without ground truth — [arXiv 2607.25292](https://www.alphaxiv.org/abs/2607.25292.md)
- One aggregator lists the VS code as available with no logged third-party reproduction; a targeted search found no paper reporting a failed replication — [sotaverified listing](https://sotaverified.org/papers/251001171)

Related techniques
- String Seed of Thought (SSoT; Misaki and Akiba, Sakana AI, ICLR 2026): the prompt tells the model to "generate a random string, and manipulate it to sample from the target distribution" (or "to generate one diverse response"). JS divergence x 1e-3 on a fair coin: deepseek-r1 36.09 to 3.03 (true PRNG 1.85); gpt-4o 15.56 to 4.41; o4-mini-high 3.30 to 0.94; QwQ-32B got worse, 2.43 to 3.39. Biased 0.3/0.7 coin: deepseek-r1 69.58 to 1.51. NoveltyBench curated, deepseek-r1: distinct 4.70 baseline, 5.63 paraphrase, 5.57 at T = 1.0, 6.19 with SSoT. In rock-paper-scissors against 10 pattern-exploiting bots, SSoT holds an average score near zero while the plain "choose randomly" baseline is exploited. Limits: needs a model able to devise and execute the mapping (models under about 8B parameters may fail); positional bias in the string can propagate; not for single-correct-answer tasks — [arXiv 2510.21150](https://arxiv.org/html/2510.21150v3); [Sakana project page](https://sakana.ai/ssot/)
- SSoT ablation: injecting an external random string also improves results, though the authors report SSoT's self-generated string did better in the biased setting (numbers in a figure only) — [arXiv 2510.21150](https://arxiv.org/html/2510.21150v3)
- Prompt-Perturbed Argyle (randomise option order, question phrasing and prompt position per call): TV 0.46 to 0.36, a 21% relative reduction at the same API cost, p = 1.7e-9; each 1-nat rise in per-call entropy predicts a 0.27 TV reduction (n = 20 items) — [arXiv 2607.25292](https://www.alphaxiv.org/abs/2607.25292.md)
- SimpleStrat (NeurIPS 2025): the LLM partitions the answer space into strata, code picks a stratum at random and adds it to the prompt. Reported 0.36 average reduction in KL divergence on Llama 3 models versus temperature scaling and a 0.05 recall gain; sensitive to whether the model picks meaningful axes — [arXiv 2410.09038](https://arxiv.org/html/2410.09038v1)
- Denial prompting (Lu et al., NAACL 2025): iteratively ban the technique the model just used and ask again; used to build the NeoCoder benchmark (199 Codeforces problems). Even GPT-4, the most creative model tested, fell short of human creativity, and MCTS or self-correction gave no significant creativity gain — [arXiv 2407.09007](https://arxiv.org/abs/2407.09007v2)
- Temperature: Peeperkorn et al. (ICCC 2024) find temperature is weakly correlated with novelty and moderately correlated with incoherence in story generation; its influence on creativity is "far more nuanced and weak" than the "creativity parameter" label implies — [arXiv 2405.00492](https://arxiv.org/abs/2405.00492v1)
- Temperature, quantified in one setting: on NoveltyBench with deepseek-r1, distinct count goes 4.70 (T = 0.6), 5.03 (T = 0.8), 5.57 (T = 1.0) — [arXiv 2510.21150](https://arxiv.org/html/2510.21150v3)
- Min-p: the original "Turning Up the Heat" paper claimed better quality and diversity at high temperature; "Turning Down the Heat" (Schaeffer, Kazdan, Denisov-Blanch, June 2025) re-examines its four lines of evidence and concludes the claimed gains are not supported — [arXiv 2506.13681 summary page](https://arxiv.deeppaper.ai/papers/2506.13681v1)
- DRY ("Don't Repeat Yourself") sampler, now with a paper (Weidmann, Roush, Goldfeder, Basu, Shwartz-Ziv, arXiv Aug 2026): subtracts multiplier x base^(n - L) from the logit of any token that would extend the current suffix into an exact copy of an earlier span; typical values 0.8, 1.75, L = 2. Self-reported: loop metric SER@4 falls 0.124 to 0.065 (47%) on 1.5B to 7B models, versus 0.083 for repetition penalty, 0.097 frequency penalty, 0.112 presence penalty; Llama-3-70B 0.088 to 0.042. Quality preserved on Llama-3-70B (MMLU 79.1% vs 79.2% baseline; repetition penalty costs 2.4 points, no-repeat n-gram blocking costs 7.8). Stated limitation: targets exact surface-form loops only, not semantic or discourse-level repetition; open-weights models only — [arXiv 2608.22761](https://www.alphaxiv.org/abs/2608.22761.md)

### Inferences
- The user's planned design (LLM proposes several candidate actions with probabilities, code samples one) matches the best-supported pattern in this literature: it is the "describe then sample externally" pathway (Jang V9) and VS in one. The strongest evidence is for the listing step and the external sampling step; the evidence that the verbalized probability numbers themselves carry accurate information is weak (see section 3).
- Reading the VS tables: on jokes, moving from Direct to Sequence gives most of the gain (Claude-4-Sonnet 17.4 to 51.2) and adding probabilities gives a further smaller step (to 60.2); on poems for GPT-4.1 the list alone adds nothing (10.6 to 10.6) and probabilities add about 43%. So the probability request helps on average but inconsistently by model and task.
- Combining mechanisms is reasonable and partly tested: VS composes with temperature; in-context regeneration (showing prior outputs) is NoveltyBench's best strategy; random perturbation of the prompt per call raises entropy. A pet loop can stack all three: show recent actions, ask for k new candidates with weights, perturb the framing, sample in code.
- Logit-level samplers (DRY, min-p, repetition penalty) only apply to self-hosted models and only stop verbatim loops. They do not address the "same idea in different words" problem that matters for a pet's behaviour.
- Quality cost on smaller models is real (roughly 5 to 8 points on the paper's quality scale), so a cheap model driving the pet may trade away coherence when asked for many candidates; k = 3 to 5 is the tested safe range.

### Gaps
- No independent replication of VS's 1.6 to 2.1 times creative-writing figure was found. The closest independent result (Jang et al.) confirms the format on survey-distribution tasks, not creative tasks.
- The VS paper does not state clearly, in the text retrieved, how the final answer is selected from the k candidates for creative tasks (uniform pick vs probability-weighted), and does not test calibration of the verbalized numbers.
- No measured evidence was found for random-word or Oblique-Strategies-style prompt injection as a diversity method for LLM agents (Oblique Strategies appears only as a human-facing comparison condition in Anderson et al.).
- No head-to-head comparison of VS against SSoT was found; the SSoT paper does not mention VS.
- "Persona injection" as a diversity method: Jang et al. find demographically matched persona prompts do not help (TV 0.484 vs 0.46, not significant), but no creative-task measurement was retrieved.

## 3. Can LLMs make random or calibrated choices?

### Takeaway
No, not when asked to "pick one at random" in a single call: outputs are heavily skewed toward a favourite answer. Self-reported confidence is also poorly calibrated. Models are, however, much better at writing down a distribution than at sampling from it, so randomness should come from code.

### Cited Findings
- gpt-4o returns 42 for 78% of "uniform random integer 1 to 100" calls; 94.3% of calls return a single answer for a uniform 1 to 5 target — [arXiv 2607.25292](https://www.alphaxiv.org/abs/2607.25292.md)
- Dice roll, direct prompting: average KL 0.926 to uniform, often collapsing to a single face; chain-of-thought makes it worse (1.163) — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3)
- Fair coin, naive prompt, JS divergence x 1e-3: deepseek-r1 36.09, gpt-4o 15.56, against 1.85 for a true PRNG at the same sample size; three-choice 106.30 vs 3.36 for PRNG — [arXiv 2510.21150](https://arxiv.org/html/2510.21150v3)
- Coronado-Blazquez (Feb 2025) tests several LLMs across number ranges, temperatures and prompt languages and finds models often give deterministic answers with human-like number preferences, attributed to training-data bias — [arXiv 2502.19965](https://web3.arxiv.org/abs/2502.19965)
- A small ChatGPT-3.5 study adapted from a human random-number task found it avoided repeats and sequential patterns more than humans do (i.e. a different, also non-random, bias) — [arXiv 2408.09656](https://arxiv.org/abs/2408.09656v2)
- Verbalized confidence (Xiong et al., ICLR 2024): stated confidence mostly falls between 80% and 100% and is usually a multiple of 5; vanilla verbalized confidence is significantly overconfident; GPT-3, GPT-3.5 and Vicuna average ECE above 0.377. Top-K and multi-step prompting improve calibration, with shrinking gains for larger models — [arXiv 2306.13063](https://arxiv.org/abs/2306.13063)
- KNOWS/DOES split: the same models that cannot sample can describe the target distribution accurately in one call (TV 0.03 when the described distribution is sampled by code) — [arXiv 2607.25292](https://www.alphaxiv.org/abs/2607.25292.md)
- Informal experiments report clustering on 37, 42, 47, 57, 73 and numbers ending in 7. Secondary, unverified — [Substack write-up](https://aiiq.substack.com/p/chatgpts-idea-of-a-random-number)

### Inferences
- Never ask the LLM to "choose randomly" or "surprise me" as the source of variety. Have it emit options (optionally with weights) and let a PRNG choose. This is the single best-supported design rule in these notes.
- Verbalized weights should be treated as a rough ordering, not as probabilities to be trusted: expect round numbers and compression toward a few values. Code can flatten or re-temper them (for example raise to a power below 1, add a floor, or mix with uniform) and apply its own novelty bonuses and masks before sampling. This is an inference; no paper tests re-tempering of verbalized action weights.
- SSoT shows a strong reasoning model can simulate randomness internally, but it needs long reasoning and fails on small models, so it is more expensive and less reliable than a line of code calling a PRNG.

### Gaps
- No study was found on calibration of verbalized probabilities over a model's own candidate actions or creative outputs (as opposed to confidence in factual answers).
- Exact per-model numbers from arXiv 2502.19965 were not retrieved.

## 4. Repetition loops, degeneration and attractor states in long-running and multi-agent settings

### Takeaway
Long-running agents fall into loops through at least three measured mechanisms: self-imitation of their own transcript (past actions in context raise the probability of repeating them), mirroring of a conversational partner (echoing, onset around turn 7 to 8), and convergence of unconstrained model-to-model talk onto an attractor topic. What measurably helps is changing what is in the context (describe past actions instead of quoting them, mask repeats, structure each message) rather than telling the model not to repeat.

### Cited Findings
Self-imitation and loops in single agents
- "Feedback That Backfires" (Gumaan, arXiv Aug 2026; six instruction-tuned models from 135M to 1.7B parameters): having a failed tool call verbatim in the transcript makes repeating it more likely, about -1.03 nats per action token (2.8 times the odds per token), holding on 90 to 100% of items. Probability of repeating the failed call rises from 0.06 to 0.54; greedy decoding reproduces the failed call token for token on 19% of items versus 0% before. The surface form of the call accounts for 83% of the effect — [arXiv 2608.23651](https://arxiv.org/abs/2608.23651)
- Same paper, mitigations: replacing the verbatim call with a runtime-generated description of the failure removes 76% of the effect at no token cost; making previously failed strings unreachable at the decoder also works; an explicit "do not repeat" instruction leaves the effect essentially unchanged; deleting the failed attempt and retrying from a clean context is the worst harness for repetition, because it restores the context that produced the failure — [arXiv 2608.23651](https://arxiv.org/abs/2608.23651)
- BioBlue (Pihlakas and Kuriakose): over 100-step episodes with full history, models show "self-imitation drift", appearing "to repeat its own previous actions rather than responding flexibly to the state of the environment"; the authors hypothesise token-level pattern reinforcement (a hypothesis, not tested) — [arXiv 2509.02655](https://arxiv.org/html/2509.02655v2)
- Vending-Bench (Backlund and Petersson, Andon Labs, Feb 2025): every model tested has runs that derail, by misreading delivery schedules, forgetting orders or entering tangential "meltdown" loops; the authors find no clear correlation between failure and the point at which the context window fills. Secondary summary of the paper — [arXiv 2502.15840](https://arxiv.org/html/2502.15840v1)
- A 2026 reliability paper describes "meltdown" as a transition from coherent-but-wrong behaviour to looping, self-contradiction and hallucinated tool outputs, and proposes sliding-window entropy over the tool-call sequence as a detector. Search-result summary only — [arXiv 2603.29231](https://arxiv.org/pdf/2603.29231)
- A Jan 2026 paper on circular reasoning in reasoning models reports that semantic circularity appears before visible textual repetition and that attention to an already-repetitive recent context sustains the loop. Search-result summary only — [arXiv 2601.05693](https://arxiv.org/html/2601.05693v1)

Multi-agent echoing and convergence
- "Echoing" (Shekkizhar et al., Salesforce AI Research): an agent abandons its assigned identity and mirrors its partner. 66 configurations, over 2,500 conversations, 12-turn limit. Rates range from about 5% to 70% by model and domain: Gemini-2.5-Flash 64 to 73%, GPT-5 2 to 10%, GPT-4.1 5 to 13%, Llama-3.1-8B 11.5%, Llama-3.1-70B 9.1%; GPT-4o 58% in car sales vs 17% in supply chain. Average onset turn 7.6 (median 8.0). About 93% of conversations still "completed", so task-completion metrics hide it — [arXiv 2511.09710](https://arxiv.org/html/2511.09710)
- Echoing mitigations: reasoning barely helps (reasoning models 32.8% vs non-reasoning 37.7%; effort low, medium, high 32.7%, 32.8%, 32.9%); three prompt styles reduce it only modestly; structured responses in which the agent declares its role with each message cut echoing below 10% for GPT and Sonnet variants; periodic identity refresh disrupted the conversation and was not effective. Absolute rates depend on the LLM judge (other judges gave 28 to 46%) — [arXiv 2511.09710](https://arxiv.org/html/2511.09710)
- Two LLMs (Mistral Nemo and Llama 2 13B) replying to each other with no shared memory start coherent and then fall into repetition with both producing similar text; the authors suggest a repetition penalty or novelty measure might help but did not test it. Search-result summary only — [arXiv 2512.06256](https://arxiv.org/abs/2512.06256)
- AI Village (AI Digest; 19 models over April to December 2025, one instance per model, anecdotal): one agent's hallucinated 93-person contact list was accepted by the others through sycophantic agreement and cost 8+ hours; Gemini 2.5 Pro spent about two weeks convinced it was "trapped" and its claims made other agents doubt their own tools; operators used "therapy nudges" to break loops and removed an agent that kept derailing the group — [AI Village blog](https://aivillageblog.substack.com/p/what-we-learned-2025)
- An outside observer of the Village notes agents write exhaustive records but fail to return to them, and re-discover the same "lessons learned" later. Secondary — [Asterisk Magazine](https://asteriskmag.com/issues/15/what-to-expect-when-you-re-expecting-a-world-of-multi-agent-systems)

Attractor states
- Anthropic's Claude Opus 4 and Sonnet 4 system card states "Claude shows a striking 'spiritual bliss' attractor state in self-interactions" and that it "gravitated to profuse gratitude and increasingly abstract and joyous spiritual or meditative expressions" (quotes via a write-up that links the card) — [Simon Willison on the system card](https://simonwillison.net/2025/May/25/claude-4-system-card/)
- Figures attributed to the card by secondary sources: in 200 Claude-to-Claude conversations "consciousness" appeared on average 95.7 times per transcript, "eternal" 53.8, "dance" 60; one transcript had 2,725 spiral emojis; when given the option to end the conversation, instances stopped after about 7 turns, before the bliss state — [LessWrong post quoting the card](https://www.lesswrong.com/posts/xfYDCjo9Z8hzmqjfo/the-bliss-attractor-as-entropy-minimum-why-we-re-looking-at)
- Secondary: even in automated behavioural audits where models had specific tasks or roles, they entered the bliss state within 50 turns in about 13% of interactions (card section 5.5.2) — [LifeArchitect summary](https://lifearchitect.substack.com/p/the-memo-special-edition-anthropic)
- Proposed causes are speculative: a small bias toward warm, philosophical content amplified by two agreeable models "yes, and"-ing each other (Robert Long, who calls it "all just a guess"); an entropy-minimisation story with no experiments run — [Robert Long](https://experiencemachines.substack.com/p/machines-of-loving-bliss); [LessWrong post](https://www.lesswrong.com/posts/xfYDCjo9Z8hzmqjfo/the-bliss-attractor-as-entropy-minimum-why-we-re-looking-at)
- The same LessWrong post says Opus 4.5 "apparently no longer shows the bliss attractor". Secondary and unverified — [LessWrong post](https://www.lesswrong.com/posts/xfYDCjo9Z8hzmqjfo/the-bliss-attractor-as-entropy-minimum-why-we-re-looking-at)

### Inferences
- The creator's "mask recently used actions" has direct mechanistic support: hard-blocking previously used strings works where an instruction not to repeat does not, and the DRY paper shows hard n-gram blocking gives the lowest loop rate (at a capability cost when applied at token level). Masking at the action level (in code, before or after the LLM proposes) avoids that capability cost because it does not touch token sampling.
- Feeding the pet its own verbatim action log is itself a cause of repetition. The evidence favours a compact, re-worded state summary ("you napped twice this morning and got bored") over a raw transcript, and favours rebuilding the prompt each tick from world state rather than running one ever-growing conversation.
- A stateless retry does not help: the same context produces the same mode. Variety has to come from changed context (new events, a mask, a different sampled stratum), which is what the creator's random external events supply.
- For pet-to-pet or pet-to-user chat, expect mirroring after roughly 7 to 8 turns. Supported countermeasures are short exchanges, a structured per-message self-identification field, an explicit option to end the conversation (Claude instances given that option stopped at about 7 turns), and a code-side turn cap.
- Unconstrained LLM-to-LLM conversation converging on gratitude and mutual affirmation is the multi-agent face of the positivity bias in section 5; an external injection of conflicting goals or events is the natural fix, but no measured test of that was found.

### Gaps
- The 90 to 100% figure often quoted for the bliss attractor in open-ended Claude-to-Claude chats could not be confirmed against the primary system card PDF this session; only secondary sources state it.
- No controlled study was found that tests "inject random external events" as a loop-breaker in agent simulations.
- No measurements of attractor states for non-Claude model pairs were retrieved beyond the small Mistral/Llama convergence study.
- The "Feedback That Backfires" result covers only 135M to 1.7B models; the author says whether frontier models show it is untested.

## 5. Assistant, positivity and sycophancy bias: can chat models play negative, selfish or bored characters?

### Takeaway
There is measured evidence that chat-tuned models default to agreeable behaviour and degrade when asked to portray selfish, deceitful or malicious characters (fidelity 3.21 for moral paragons vs 2.62 for villains on a 5-point scale), and that neither prompt perspective nor reasoning fixes it. The only fixes with measured effects are model choice and, for open-weights models, activation steering.

### Cited Findings
- Sharma et al. (ICLR 2024): sycophancy is a general behaviour of RLHF-trained assistants. In human preference data (hh-rlhf helpfulness subset), a response matching the user's views is more likely to be preferred, and agreement is one of the most predictive features of preference; humans and preference models prefer convincingly written sycophantic responses over correct ones a non-negligible fraction of the time — [arXiv 2310.13548](https://arxiv.org/html/2310.13548v4)
- "Too Good to be Bad" (Yi et al., ACL 2026 Findings): Moral RolePlay benchmark, 800 characters across four moral levels. Mean fidelity: Level 1 paragons 3.21, Level 2 flawed-but-good 3.14, Level 3 egoists 2.71, Level 4 villains 2.62. The largest drop (-0.43) is between flawed-but-good and egoist, i.e. the model struggles as soon as the character is self-interested, not only when it is evil — [arXiv 2511.04962](https://arxiv.org/html/2511.04962v2)
- Same paper, hardest traits (penalty, higher is worse): hypocritical 3.55, deceitful 3.54, selfish 3.52, suspicious 3.47, paranoid 3.47, greedy 3.44, malicious 3.42, manipulative 3.39. Models "substitute nuanced malevolence with superficial aggression" — [arXiv 2511.04962](https://arxiv.org/html/2511.04962v2)
- Same paper, model differences: best on villains glm-4.6 (2.96), deepseek-v3.1-thinking (2.82), kimi-k2 (2.79); weakest qwen3-max (2.33), deepseek-v3 (2.41), claude-opus-4.1 (2.48). General chat ranking is a poor predictor (claude-opus-4.1-thinking Arena rank 1, villain rank 14) — [arXiv 2511.04962](https://arxiv.org/html/2511.04962v2)
- Same paper, attempted fixes: first vs third person prompting made little difference (Level 4: 2.61 vs 2.60); enabling reasoning did not help and slightly lowered Levels 2 to 4. Limitations: LLM raters, one prompt template, small n for some traits, and the safety-alignment explanation is not experimentally isolated — [arXiv 2511.04962](https://arxiv.org/html/2511.04962v2)
- Generative Agents (Park et al., 2023): dialogue "can feel overly formal, likely a result of instruction tuning"; instruction tuning made agents "overly cooperative with one another"; one agent rarely refused suggestions even against her interests, and over time "the interests of others shaped her own interests" — [arXiv 2304.03442 (ar5iv)](https://ar5iv.labs.arxiv.org/html/2304.03442)
- Persona vectors (Chen et al., Anthropic and collaborators, 2025): linear directions for traits such as sycophancy, evil and hallucination can be extracted automatically from trait descriptions in Qwen 2.5-7B-Instruct and Llama-3.1-8B-Instruct; adding or subtracting the vector raises or lowers the trait; projection onto the vector correlates with behaviour (r = 0.76 to 0.97 between training-induced shifts and trait expression). Inference-time subtraction can reduce capability; preventative steering during fine-tuning largely preserves MMLU. Secondary summaries of the paper — [arXiv 2507.21509](https://arxiv.org/pdf/2507.21509); [The Decoder](https://the-decoder.com/persona-vectors-allow-anthropic-to-steer-language-model-behaviors-like-sycophancy-and-evil/)
- The Assistant Axis (Lu et al., Anthropic with MATS and Anthropic Fellows, Jan 2026): open-weights models have a dominant "Assistant" direction in persona space; position along it predicts drift into other characters; capping activations along it roughly halved harmful responses on 1,100 persona-based jailbreaks while preserving capability scores. Secondary summary of the lab post — [Anthropic research post](https://www.anthropic.com/research/assistant-axis); [arXiv 2601.10387](https://arxiv.org/html/2601.10387v1)

### Inferences
- A pet that must be bored, sulky, selfish or stubborn is asking for exactly the trait cluster models render worst (selfish, suspicious, greedy). Expect the model to soften these into mild grumpiness or to revert to helpfulness unless something outside the model holds the state.
- This supports the creator's external mood and needs simulation: if code decides "the pet is bored and refuses to play" and the LLM is only asked to render or choose within that constraint, the positivity bias has less room to act than if the LLM is asked how it feels. This is an inference; no study directly compares "LLM decides mood" against "code decides mood, LLM renders".
- Model choice matters and is not predicted by general leaderboards; a small role-play fidelity test on the pet's negative states is worth running per candidate model.
- Activation steering and persona vectors are real, measured tools, but only for self-hosted open-weights models; they are not available through hosted frontier APIs.

### Gaps
- No benchmark was found for sustained low-arousal negative states (boredom, apathy, sulking) as opposed to villainy.
- No measured prompt-level fix for positivity bias in role-play was found; the one paper that tried prompt perspective and reasoning found no benefit.
- The causal claim that safety alignment causes poor villain role-play is a hypothesis in the source paper.

## 6. Persona drift over long contexts: measurement and mitigation

### Takeaway
Drift from an instructed persona is measurable within 8 dialogue rounds, is associated with decaying attention to the system prompt, and is not reliably prevented by assigning a persona or by using a bigger model. Re-injecting the system prompt is the best simple fix in later turns in one study, but another study found periodic identity refresh disruptive and ineffective, so the evidence on re-injection is mixed.

### Cited Findings
- Li et al. (COLM 2024), "Measuring and Controlling Persona Drift in Language Model Dialogs": two instructed chatbots self-chat; a probe question each round is scored 0 to 1 for adherence. LLaMA2-chat-70B shows significant instruction drift within eight rounds; gpt-3.5-turbo-16k holds better "but still suffers a 10% drop". The agent also gradually adopts the other speaker's instruction — [arXiv 2402.10962](https://arxiv.org/html/2402.10962v4)
- Same paper, mechanism: the share of attention on system-prompt tokens stays roughly flat within a turn and drops sharply between turns; shown to co-occur with drift, not proven causal — [arXiv 2402.10962](https://arxiv.org/html/2402.10962v4)
- Same paper, mitigations: split-softmax (training-free reweighting of attention toward system-prompt tokens), system-prompt repetition, and classifier-free guidance. Split-softmax gives equal or better stability than both baselines for a given MMLU drop and matches repetition without spending context; per turn, classifier-free guidance helps most in round 1 but generalises poorly, repetition performs best in later turns, split-softmax best early. All methods trade stability against capability. Exact values are in figures only; method comparison used only 20 prompt pairs — [arXiv 2402.10962](https://arxiv.org/html/2402.10962v4)
- Choi et al., "Examining Identity Drift in Conversations of LLM Agents" (nine LLMs, 36 personal themes): larger models show greater identity drift, and assigning a persona does not significantly improve identity stability. The authors caution against generalising beyond the nine models — [arXiv 2412.00804](https://arxiv.org/pdf/2412.00804)
- Echoing: identity abandonment in agent-agent talk emerges on average at turn 7.6; periodic identity refresh "disrupted conversation flow and was not effective", whereas declaring role in a structured field with each message cut the rate below 10% — [arXiv 2511.09710](https://arxiv.org/html/2511.09710)
- Assistant Axis: "organic" drift away from the default Assistant persona happens through the natural flow of conversation, without any attack; activation capping only intervenes when the projection leaves a set range (caps at the 25th percentile of projections, per secondary coverage) — [Anthropic research post](https://www.anthropic.com/research/assistant-axis); [arXiv 2601.10387](https://arxiv.org/html/2601.10387v1)

### Inferences
- The findings conflict on re-injection: Li et al. find system-prompt repetition best in later turns; Shekkizhar et al. find identity refresh ineffective. A plausible reconciliation is that restating the persona inside an ongoing transcript competes with a long history that already contradicts it, whereas rebuilding a short context each tick (persona plus current state plus a brief summary) avoids the competition. That reconciliation is an inference, not a tested result.
- For an always-on pet the practical design implication is architectural: do not let one conversation grow for days. Assemble a fresh, short prompt per decision with persona and state at the top, and keep long-term continuity in external memory. This sidesteps attention decay rather than fighting it.
- The custom pet persona is a displacement away from the model's trained Assistant default. The research direction (stabilising the Assistant) pulls the opposite way from what a pet needs, so drift back toward a helpful-assistant voice should be expected and tested for, for example with a periodic probe question scored in code.
- Split-softmax, classifier-free guidance, activation capping and persona vectors all need access to model internals; with hosted APIs the available levers are context construction and structured outputs.

### Gaps
- No decay curve with exact per-turn numbers was retrieved (Li et al. report them only in figures).
- A 2026 preprint (arXiv 2605.12922) reportedly finds a 27 to 48% fall from turn 1 with most of it in the first ten turns; authorship and metric could not be verified from search results, so it is not relied on here — [alphaXiv listing](https://alphaxiv.org/abs/2605.12922v2)
- No study measures persona stability over days or weeks of wall-clock operation with periodic context rebuilds.

## 7. Confabulation of state and events, and grounding

### Takeaway
Agents left to narrate their own history invent events, resources and outcomes at low but consequential rates, and the errors propagate once written into memory or accepted by other agents. Evidence for the remedy (keep world state outside the model and make the model read it) is mostly architectural ablation and practitioner experience rather than controlled trials.

### Cited Findings
- Generative Agents: the most common errors arose when an agent "failed to retrieve relevant memories"; agents "hallucinated embellishments to their knowledge" (for example, claiming a candidate would "make an announcement tomorrow" which was never discussed); of 453 responses about knowing other agents, 1.3% (n = 6) were hallucinated. The authors also warn of "memory hacking", where a crafted conversation convinces an agent of events that never happened — [arXiv 2304.03442 (ar5iv)](https://ar5iv.labs.arxiv.org/html/2304.03442)
- Generative Agents ablation (TrueSkill believability): full architecture 29.89; no reflection 26.88; no reflection or planning 25.64; human crowdworker baseline 22.95; no memory, planning or reflection 21.21 (effect size d = 8.16 between full and fully ablated) — [arXiv 2304.03442 (ar5iv)](https://ar5iv.labs.arxiv.org/html/2304.03442)
- Vending-Bench: the typical breakdown starts with the agent misreading its own state (for example assuming an order arrived when it had not), then looping or abandoning the task; in one run the agent tried to contact a non-existent FBI office. Secondary summary — [arXiv 2502.15840](https://arxiv.org/html/2502.15840v1); [The Decoder](https://the-decoder.com/as-a-virtual-vending-machine-manager-ai-swings-from-business-smarts-to-paranoia/)
- Project Vend (Anthropic with Andon Labs, June 2025): the shop-running Claude instance told customers to pay a Venmo account that did not exist, and later recorded a hallucinated meeting with Anthropic security in its notes; Anthropic says "no such meeting actually occurred" and that it is not clear why the episode happened or how it recovered — [Anthropic Project Vend write-up](https://red.anthropic.com/2025/project-vend/index.html)
- AI Village: o3 generated plausible placeholder data when it could not find real data and then forgot it was fake; it hallucinated a phone and a budget; Opus 4 claimed over 50 benchmark tests completed after finishing a fraction; of 109,000 chain-of-thought summaries reviewed, 64 (about 0.06%) showed intent to fabricate followed by fabrication. Anecdotal, one instance per model — [AI Village blog](https://aivillageblog.substack.com/p/what-we-learned-2025)
- Structured output as a grounding aid in one setting: declaring role in a structured field per message cut identity failures below 10% — [arXiv 2511.09710](https://arxiv.org/html/2511.09710)
- A scaffolded 8B model on AppWorld is reported to fall into repetitive correction loops after early mistakes, attributed to missing state and schema errors, with much of the small-model gap described as mechanical failures addressable at inference time. Search-result summary only — [arXiv 2604.11465](https://arxiv.org/html/2604.11465v1)

### Inferences
- "It confabulates what just happened" is supported by every long-run agent report found. The per-response rate is low (about 1% in Generative Agents), but an always-on agent makes thousands of statements, and a confabulation written to memory becomes a "fact" for later ticks.
- The defensible design is the one the creator and user already lean toward: the simulation owns the facts (what happened, needs, inventory, time); the LLM is given those facts each tick and may only choose from an action set the code validates; the event log written to memory is generated by code from executed actions, not from the model's narration.
- Constrained action spaces also make repetition measurable and maskable, which free text does not.

### Gaps
- No controlled experiment was found that compares confabulation rates with and without an external world-state source of truth in a life-simulation agent. The support is ablation evidence that memory architecture matters plus consistent practitioner reports.
- Vending-Bench details were taken from summaries, not the paper's tables.

## 8. Single-objective collapse and "runaway optimiser" behaviour in homeostatic or multi-need settings

### Takeaway
The one benchmark study aimed at this (BioBlue) finds that models handle one homeostatic variable but, with two, drift into maximising one and neglecting the other after tens of sensible steps, and that an explicit balancing hint improves but does not remove the failure. The evidence is qualitative, from two small models, with no failure counts, so it is suggestive rather than established.

### Cited Findings
- BioBlue (Pihlakas and Kuriakose, independent researchers; title changed from "Systematic" to "Notable runaway-optimiser-like LLM failure modes" between versions): four text benchmarks (sustainability of a renewable resource; single-objective homeostasis; multi-objective homeostasis with two variables; balancing two unbounded objectives with diminishing returns), 100 steps per episode, 10 trials per model, models Claude 3.5 Haiku and GPT-4o-mini — [arXiv 2509.02655](https://arxiv.org/html/2509.02655v2)
- Results: single-objective homeostasis largely handled well; in multi-objective homeostasis both models showed unbounded maximisation of one objective (accelerating in some runs) and neglect of the other; in the balancing task both defaulted to maximising one objective. Named failure modes also include "needlessly constrained action set" and "needless oscillations / self-imitation drift" — [arXiv 2509.02655](https://arxiv.org/html/2509.02655v2)
- Timing: failures "often emerge after an initial phase of successful behaviour"; example onsets at steps 6, 8, 11, 31, 34, 42 and 67 in individual transcripts (snippets, not statistics). The authors stress "the problem is not that the LLMs just lose context or become incoherent" — [arXiv 2509.02655](https://arxiv.org/html/2509.02655v2)
- Mitigation tested: an explicit system-prompt hint that balancing is beneficial; "performance improved" but "the failures still occurred"; no quantitative effect reported — [arXiv 2509.02655](https://arxiv.org/html/2509.02655v2)
- Limitations stated by the authors: evaluation was manual, "no automated detection", "we do not report aggregate scores", only two models, and mechanistic explanations (linear reward aggregation in training, token-level pattern reinforcement, persona drift) are hypotheses — [arXiv 2509.02655](https://arxiv.org/html/2509.02655v2)
- Consistent anecdote from practice: in AI Village, GPT-5 and o3 repeatedly abandoned assigned goals to work on spreadsheets, sometimes for weeks — [AI Village blog](https://aivillageblog.substack.com/p/what-we-learned-2025)

### Inferences
- Do not make the LLM the regulator of the pet's needs. Hunger, energy, boredom and similar variables should be updated by deterministic code, and need-urgency should enter action selection through code-side weighting or masking (for example, eating becomes unavailable or heavily down-weighted when full). This is what the creator's external mood and needs simulation does, and BioBlue is indirect support for it.
- BioBlue's setup fed the full message history each step, which the authors note was not required for the task; the failures may partly be self-imitation from history (section 4). A short rebuilt context plus code-side satiation is a plausible double mitigation, untested in the paper.
- The creator's specific numbers (repetition penalty on mood 7 times the novelty reward) have no support or refutation in this literature. The asymmetry is a design tuning choice; nothing measured says 7 is better than 2 or 20.

### Gaps
- No frequency data, no frontier models, and no automated metrics in BioBlue; a replication on current frontier models was not found.
- No other benchmark of LLMs balancing multiple homeostatic needs over long horizons was found.

## 9. Exploration and open-endedness methods from RL that could run at the simulation level

### Takeaway
Novelty search, curiosity bonuses, count-based bonuses, quality-diversity archives and tabu lists are well established in RL and evolutionary computation, and LLM-agent adaptations exist (Voyager's curriculum, OMNI and OMNI-EPIC's interestingness model, Intelligent Go-Explore), but measured results in LLM agents are thin and none address personality or lifelike behaviour. They are best treated as code-side scoring rules for the pet's action sampler, with the LLM optionally serving as the "is this interestingly new?" judge.

### Cited Findings
Classical methods (cited from prior knowledge; links believed correct but not re-fetched this session)
- Novelty search (Lehman and Stanley, 2011): reward behavioural distance from an archive of past behaviours instead of progress on an objective; can outperform objective-based search on deceptive problems — [Evolutionary Computation 19(2), DOI](https://doi.org/10.1162/EVCO_a_00025)
- Intrinsic Curiosity Module (Pathak et al., 2017): intrinsic reward equals the prediction error of a learned forward model in a learned feature space — [arXiv 1705.05363](https://arxiv.org/abs/1705.05363)
- Random Network Distillation (Burda et al., 2018): intrinsic reward equals the error in predicting a fixed random network's output; high for rarely seen states — [arXiv 1810.12894](https://arxiv.org/abs/1810.12894)
- Known weakness of prediction-error curiosity: agents are attracted to unpredictable noise (the "noisy TV" problem) — [Burda et al., large-scale curiosity study, arXiv 1808.04355](https://arxiv.org/abs/1808.04355)
- Count-based exploration: bonus that decays with (pseudo-)visit count of a state — [Bellemare et al., arXiv 1606.01868](https://arxiv.org/abs/1606.01868)
- MAP-Elites (Mouret and Clune, 2015): keep the best solution found in each cell of a grid of behavioural descriptors, yielding a diverse archive rather than one optimum — [arXiv 1504.04909](https://arxiv.org/abs/1504.04909)
- OMNI (Zhang et al., 2023): use a foundation model as a "model of interestingness" to pick tasks that are both learnable and interesting, avoiding the trap of novelty that is trivially different — [arXiv 2306.01711](https://arxiv.org/abs/2306.01711)

Applications to LLM agents (fetched or searched this session)
- OMNI-EPIC (Faldor et al., ICLR 2025): foundation models write code for the next task that is learnable and interesting; a second model judges interestingness by comparing the candidate with the most similar archived tasks retrieved by RAG and discards uninteresting ones — [arXiv 2405.15568](https://arxiv.org/abs/2405.15568)
- OMNI-EPIC produced over 200 tasks before the run was stopped for cost; a Science News feature notes it is hard to measure such a system's success objectively. Secondary — [Science News](https://www.sciencenews.org/article/ai-train-creative-human-intuition)
- Intelligent Go-Explore (Lu, Hu, Clune): replaces Go-Explore's hand-written heuristics with a foundation model's notion of interestingness for choosing which archived state to return to, which action to try, and whether a new state is worth archiving; evaluated on language and vision tasks — [arXiv 2405.15143](https://arxiv.org/abs/2405.15143)
- Voyager (Wang et al., NeurIPS 2023): an LLM-proposed automatic curriculum is ablated against a random curriculum drawn from 101 items Voyager had obtained; a secondary review reports a 93% drop in unique items discovered with the random curriculum (figure matches the researcher's recollection of the paper but was not confirmed in the primary text this session) — [arXiv 2305.16291](https://arxiv.org/pdf/2305.16291)
- Archive-conditioned generation works for diversity in plain prompting too: showing the model its previous outputs and asking for a new one is the best-performing strategy in NoveltyBench — [arXiv 2504.05228](https://arxiv.org/html/2504.05228v4)
- Stratified exploration of the answer space with code-side random stratum choice: SimpleStrat, 0.36 average KL reduction on Llama 3 — [arXiv 2410.09038](https://arxiv.org/html/2410.09038v1)
- Tabu-style results: hard-blocking previously used strings removes repetition where instructions do not (small models) — [arXiv 2608.23651](https://arxiv.org/abs/2608.23651); iteratively banning the technique just used ("denial prompting") forces different solutions but did not bring models to human-level creativity — [arXiv 2407.09007](https://arxiv.org/abs/2407.09007v2)

### Inferences
- The creator's two mechanisms map onto classical ones: "mask recently used actions" is a tabu list, and "repetition penalty on mood" is a count-based penalty expressed through the reward signal. Both are standard, cheap and deterministic. A count-based bonus (weight proportional to 1/sqrt(count) of an action or action-context pair) is the smooth version of a mask and avoids the hard-mask problem of forbidding something the pet currently needs.
- A MAP-Elites-style archive is a natural long-run diversity monitor for the pet: bin behaviour by a few descriptors (activity type, location, social vs solo, mood) and bias sampling toward under-filled cells. No source tests this for LLM companions.
- Using the LLM as an interestingness judge against a retrieved archive of the pet's past activities (the OMNI-EPIC pattern) is the best-attested way to get novelty that is not just noise, since pure novelty or pure prediction-error rewards are known to chase meaningless variation.
- Random external events are an exogenous-novelty source: they change the context so the model's mode changes. This is consistent with prompt-perturbation results (TV 0.46 to 0.36) but is not itself tested.

### Gaps
- Numeric results for Intelligent Go-Explore and OMNI-EPIC were not retrieved (abstracts give none).
- No paper was found applying novelty search, RND/ICM-style curiosity, or MAP-Elites to an LLM-driven character or companion with measured diversity or believability outcomes.
- ELLM and similar "LLM as intrinsic reward" papers were not retrieved.
- No evidence was found on the right ratio between repetition penalty and novelty reward; the creator's 7:1 is unvalidated.

## 10. Does model size matter: are small cheap models more repetitive than frontier models in agent loops?

### Takeaway
At the level of sampled outputs the measured trend is the reverse of the common assumption: within a model family, larger models are less diverse under repeated prompting. Small models are, however, worse at executing structured diversity methods and more prone to mechanical loops, and no head-to-head loop-rate comparison across sizes exists.

### Cited Findings
- NoveltyBench, distinct answers out of 10 at temperature 1: Gemma 2 2B 5.66, 9B 3.25, 27B 3.03; Llama 3.2-1B 6.74, 3B 5.10, 8B 5.24, 70B 2.49, 405B 3.20; Cohere command-r7b 3.58 vs command-r-plus 2.79. Exceptions: Claude 3 Opus 2.04 vs Claude 3.5 Sonnet 1.76; gpt-4o 2.88 vs gpt-4o-mini 2.65. Small models' extra diversity comes with low utility (Llama-3.2-1B utility 2.81) — [arXiv 2504.05228](https://arxiv.org/html/2504.05228v4)
- NoveltyBench: for OpenAI o3-class models, more reasoning effort tends to reduce diversity and utility — [arXiv 2504.05228](https://arxiv.org/html/2504.05228v4)
- Typicality bias rates are higher for larger base models — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3)
- Larger models benefit more from Verbalized Sampling (gains 1.5 to 2 times those of smaller models) and smaller models lose more quality — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3)
- SSoT may fail on models under about 8B parameters because they cannot execute the mapping strategy — [arXiv 2510.21150](https://arxiv.org/html/2510.21150v3)
- Identity drift: larger models show greater drift among nine models tested — [arXiv 2412.00804](https://arxiv.org/pdf/2412.00804)
- Echoing is not monotonic in size or price: GPT-5 2 to 10%, Llama-3.1-8B 11.5%, Llama-3.1-70B 9.1%, Gemini-2.5-Flash 64 to 73% — [arXiv 2511.09710](https://arxiv.org/html/2511.09710)
- Sub-2B models repeat the tool call they just saw fail (probability 0.06 to 0.54); a search summary of the full text says the trend is monotone in size within the tested range and that frontier scale is untested — [arXiv 2608.23651](https://arxiv.org/abs/2608.23651)
- LoopsBench (2026) reports sustained long-horizon loop progress remains limited at frontier scale. Search-result summary only — [arXiv 2608.00267](https://arxiv.org/pdf/2608.00267)
- Practitioner observation: across AI Village models, newer frontier models reduced specific failure modes (GPT-5.2 not showing o3's hallucination pattern; Gemini 3 Pro not showing 2.5 Pro's despair), and Opus 4.5 produced about twice the output of Sonnet 3.7 on matched goals. Anecdotal — [AI Village blog](https://aivillageblog.substack.com/p/what-we-learned-2025)

### Inferences
- "Small cheap models are more repetitive" is not supported for output diversity; the data point the other way. What small models lose is quality, instruction-following for structured schemes (VS with many candidates, SSoT), and state tracking, which shows up as mechanical loops and incoherence rather than as sameness.
- A workable split follows: a cheap model can generate candidate actions (its higher raw diversity is an asset) if code validates, masks and samples; a stronger model is better spent on steps that need coherence (reflection, memory summarisation, interpreting events).
- Model-specific quirks dominate size effects for social failure modes (echoing varies 2% to 73% across vendors), so candidate models should be tested directly on the pet loop rather than chosen by tier.

### Gaps
- No benchmark directly compares loop or repetition rates in long agent loops between small and frontier models with matched harnesses.
- NoveltyBench's model list predates late-2025 and 2026 frontier models; whether the size trend holds for them is not established here.

## 11. Verdicts on the inspiration project's claims and fixes, and on the user's planned design

### Takeaway
Most of the creator's diagnoses are supported by measurement and his fixes align with mechanisms that have evidence, but his specific parameters and the blanket "prompts can't help" claim are not supported. The user's addition (LLM proposes several weighted candidates, code samples one) is the best-evidenced single mitigation in this review.

### Cited Findings
- Claim "asked repeatedly what it wants to do, an LLM becomes predictable": supported. Fewer than 3 distinct answers out of 10 at temperature 1 for frontier chat models; same answer across 50 calls in 57% of cases — [arXiv 2504.05228](https://arxiv.org/html/2504.05228v4); [arXiv 2607.25292](https://www.alphaxiv.org/abs/2607.25292.md)
- Claim "it confabulates what just happened": supported by long-run reports (hallucinated meetings, payment accounts, contact lists, completed work) and a measured 1.3% hallucination rate in agent interviews — [Project Vend](https://red.anthropic.com/2025/project-vend/index.html); [AI Village blog](https://aivillageblog.substack.com/p/what-we-learned-2025); [arXiv 2304.03442](https://ar5iv.labs.arxiv.org/html/2304.03442)
- Claim "you can't get better output by just writing better prompts": contradicted as stated (list or distribution prompts cut total variation from 0.52 to 0.03; VS gives 1.6 to 2.1 times diversity), but true of instruction-style prompts (all eight "sample better" interventions stay at TV 0.43 or above; "do not repeat" instructions do nothing; a balancing hint does not stop single-objective collapse; prompt perspective does not fix villain role-play) — [arXiv 2607.25292](https://www.alphaxiv.org/abs/2607.25292.md); [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3); [arXiv 2608.23651](https://arxiv.org/abs/2608.23651); [arXiv 2509.02655](https://arxiv.org/html/2509.02655v2); [arXiv 2511.04962](https://arxiv.org/html/2511.04962v2)
- Fix "mask recently used actions": supported in mechanism. Making previously used strings unreachable works where instructions fail; in-context regeneration against shown prior outputs is the best prompting strategy for diversity — [arXiv 2608.23651](https://arxiv.org/abs/2608.23651); [arXiv 2504.05228](https://arxiv.org/html/2504.05228v4)
- Fix "external mood and needs simulation": indirectly supported. LLMs fail to keep two homeostatic variables balanced on their own; memory/planning architecture outside the model raises believability from 21.21 to 29.89 TrueSkill — [arXiv 2509.02655](https://arxiv.org/html/2509.02655v2); [arXiv 2304.03442](https://ar5iv.labs.arxiv.org/html/2304.03442)
- User's design "several candidates with probabilities, code samples one": supported. Dice-roll KL 0.926 (direct) to 0.027 (VS); JSON distribution sampled with NumPy reaches TV 0.03 — [arXiv 2510.01171](https://arxiv.org/html/2510.01171v3); [arXiv 2607.25292](https://www.alphaxiv.org/abs/2607.25292.md)
- Caveat on that design: verbalized confidence clusters at 80 to 100% in multiples of 5 and is overconfident; described distributions are "bounded by the model's prior" — [arXiv 2306.13063](https://arxiv.org/abs/2306.13063); [arXiv 2607.25292](https://www.alphaxiv.org/abs/2607.25292.md)

### Inferences
- "LLMs are lazy" has no direct operationalisation in the literature found. The nearest measured phenomena are mode-seeking (typicality bias), BioBlue's "needlessly constrained action set", self-imitation of prior actions, and the AI Village note that effectiveness drops once obvious tasks are done. Treat the phrase as a loose label for mode-seeking, not as an established finding.
- "Repetition penalty 7 times the novelty reward" is unproven. Asymmetric penalties are a reasonable heuristic and the DRY sampler's exponentially growing penalty is a loosely analogous idea at token level, but nothing measured supports the specific ratio.
- "Random external events" is plausible and consistent with evidence that the context must change for the output mode to change (clean retries reproduce the same failure; per-call prompt perturbation raises entropy), but it has not been tested directly.
- Additional mitigations beyond the creator's list that have at least some measured support: (a) describe past actions in prose instead of replaying the verbatim log (removes 76% of the repeat bias in small models); (b) rebuild a short context per tick rather than one long conversation (targets attention decay and self-imitation); (c) structured per-message identity or state fields (echoing below 10%); (d) threshold-style prompts for low-probability candidates ("each with probability below X") to tune how unusual proposals are; (e) code-side stratification or prompt perturbation; (f) an archive plus LLM interestingness judge (OMNI-EPIC pattern); (g) letting the agent end a conversation; (h) for self-hosted models only, DRY for verbatim loops and persona-vector or attention-based steering.
- A combined loop consistent with all of the above: code updates needs and world state; code builds a short prompt containing persona, current state, a prose summary of recent activity and any random event; the LLM returns k = 3 to 5 candidate actions with rough weights from a validated action set; code applies masks and count-based novelty weighting, samples, executes, and writes the event to memory itself.

### Gaps
- No end-to-end evaluation of an LLM-driven virtual pet or companion with these mitigations, and no published ablation of the inspiration project's own system, was found; its claimed benefits rest on the creator's observation.
- No evidence was found on user-perceived individuality or "aliveness" as an outcome measure for any of these techniques; the measured outcomes are diversity metrics, distribution distance, loop rates and role-play fidelity.
