# Needs, drives, homeostasis and emotion models in autonomous (LLM-driven) agents

Notes current to 15 November 2026. Context: an always-on LLM-driven virtual pet in the style of "Pino" (two core parameters, mood and energy; decaying needs; a 7x repetition penalty; random outside events; masking of recent actions), as described in the creator's video transcript at `video-inspo/transcripts/how-to-make.txt`.

How to read the source labels used below:
- **[primary, full text]**: I read the paper's own text (HTML, or text extracted from the PDF).
- **[primary, abstract only]**: I saw only the abstract or landing page.
- **[snippet]**: I saw only a search-result summary; treat as a lead, not a verified fact.
- **[secondary]**: a summary by someone other than the authors.

## 1. Homeostatic / drive-reduction models of motivation: formal mechanism and resulting behaviour

### Takeaway
The best-specified model is Keramati & Gutkin's homeostatic reinforcement learning: reward is defined as the reduction in distance between internal state and a setpoint, and with a convex drive function this single definition yields satiation, deprivation-sensitivity, competition between needs and risk aversion for free. Its authors state it does not cover novelty or social reward, and the one LLM test of numeric homeostasis (BioBlue) found LLMs hold a single setpoint but drift into runaway maximisation and self-repetition once there are two.

### Cited Findings

**Hull (classical drive-reduction)**
- Hull's core idea is a multiplicative relation between drive and habit strength: reaction potential = D x H, with incentive K added in later versions. Secondary sources disagree on the exact 1943 and 1952 forms (e.g. `sEr = sHr x D x K - (Ir + sIr)` versus longer versions with V and J terms), and Spence later made D and K additive, `H x (D + K) - I`. I did not consult Hull's original text. [secondary] — [SimplyPsychology](https://www.simplypsychology.org/drive-reduction-theory.html); [TECFA Geneva](https://tecfa.unige.ch/themes/sa2/act-app-dos2-fic-drive.htm)
- Keramati & Gutkin list two classic failures of Hull's theory that their model is meant to fix: it could not explain anticipatory responding, and it "could not explain how secondary reinforcers (e.g., money, or a light...)" acquire value. [primary, full text] — [Keramati & Gutkin 2014, eLife](https://elifesciences.org/articles/04811)

**Keramati & Gutkin (2014), homeostatic RL** [primary, full text] — all from [eLife 3:e04811](https://elifesciences.org/articles/04811)
- Internal state is a vector `H_t = (h_1,t ... h_N,t)` with setpoint `H* = (h_1* ... h_N*)`.
- Drive (Eq. 1): `D(H_t) = ( Σ_i |h_i* − h_i,t|^n )^(1/m)`, with m and n free parameters.
- An outcome shifts the state, `H_t+1 = H_t + K_t`, and reward is drive reduction (Eq. 2): `r(H_t, K_t) = D(H_t) − D(H_t + K_t)`.
- Theorem (Eq. 5): for discount factor γ < 1, the policy that maximises the sum of discounted rewards is the same policy that minimises the sum of discounted deviations from the setpoint. With γ = 1 a policy's value depends only on start and end states, so discounting is what makes the agent take the shortest path to the setpoint.
- "Appropriate choice of m and n (n > m > 1)" gives four behavioural properties from the one definition:
  - reward increases with outcome dose (`∂r/∂k_j > 0`);
  - reward for an outcome increases with deprivation of the matching need (`∂r/∂|h_j* − h_j| > 0`);
  - deprivation on one need reduces the reward value of outcomes for other needs (`∂r/∂|h_i* − h_i| < 0`, i ≠ j). The paper's gloss: "one does not play chess, or even search for sex, on an empty stomach";
  - reward is concave in outcome size (`∂²r/∂k_j² < 0`), which produces risk aversion: frequent small deviations are preferred to rare drastic ones.
- Other reproduced phenomena: anticipatory (conditioned tolerance) responses to a cue that predicts a disturbance; a rise-then-fall response pattern as the state approaches the setpoint (satiation); reinforcement by oral but not intragastric water; over-eating of hyperpalatable food explained as a biased sensory estimate of drive reduction.
- Reported simulation settings: one figure supplement lists α = 0.4, β = 0.05, γ = 0.9, n = 4 (these four values come from a machine summary of the full-text XML and were not re-checked against the PDF; the paper elsewhere calls β "the rate of exploration" and uses 0.03 in a variant, and also runs an m = n = 1 variant). One simulation started 30 units from a setpoint of 0, and the maximum deviation across 10^5 agents over 1,500 trials was 61.
- Stated limitation: the theory "only applies to rewards that have a corresponding regulatory system. How to extend our theory to rewards without a corresponding homeostatic regulation system (e.g., social rewards, novelty-induced reward, etc.) remains a key challenge for the future." The optimality result also requires an unbiased estimate of each outcome's effect on the internal state.

**Later homeostatic-RL work**
- A 2025 review by Yoshida, Sprekeler & Gutkin names the framework Homeostatically Regulated RL (HRRL) and states that it "inherently produces multiple behaviors such as risk aversion, anticipatory regulation, and adaptive movement", and that deep-RL extensions allow autonomous exploration and hierarchical behaviour. [primary, abstract only] — [arXiv 2507.04998](https://arxiv.org/abs/2507.04998)
- The same review says homeostatic reward and curiosity-style intrinsic motivation "are not mutually exclusive but rather complementary; intrinsic motivation can be leveraged to enhance exploration in HRRL", and that pathologies (consummatory depression, addiction) have been modelled as distortions of the drive function. [primary, full text of PDF] — [arXiv 2507.04998](https://arxiv.org/abs/2507.04998)
- Yoshida, Daikoku, Nagai & Kuniyoshi, "Emergence of integrated behaviors through direct optimization for homeostasis", Neural Networks 177:106379 (2024) exists as a citation; I could not read it, so its results are unverified here. [snippet] — [arXiv 2411.12304 reference list](https://arxiv.org/html/2411.12304v1)

**Homeostasis as an objective for LLM agents (BioBlue)** [primary, full text] — all from [Pihlakas & Kuriakose, arXiv 2509.02655](https://arxiv.org/abs/2509.02655)
- Setup: Claude 3.5 Haiku and GPT-4o mini, 10 episodes of 100 steps per benchmark, each prompt carrying the full history of observations, actions and rewards. The homeostatic level and deviation were given as numeric "interoception" signals each step.
- Single-objective homeostasis: both models "largely succeeded".
- Multi-objective homeostasis (two variables, each with its own target): both models maximised one objective far beyond its target, sometimes neglected the other, and in one shown run a deviation rose from 309 at step 31 to 10,984 at step 99.
- Failures typically appeared after an initial stretch of sensible behaviour, with the context window far from full.
- "Self-imitation drift": the models "learn to simply repeat their past actions, disregarding consequences" (e.g. GPT-4o mini repeating the same action pair for several steps).
- Caveats: preprint by independent researchers, two small models, qualitative evaluation, no failure counts or aggregate scores reported, mechanisms explicitly untested.

**Game-engineering prior art (The Sims style)** [primary, full text] — all from [Zubek, "Needs-Based AI" draft chapter](https://robert.zubek.net/publications/Needs-based-AI-draft.pdf)
- Needs are an array of numbers in [0, 100] that decay over time; lower is worse and more urgent.
- Candidate actions are scored by their effect on needs. Three scoring rules of increasing quality: sum of future need values; sum of an attenuation function over future values, `score = Σ A_need(future value)`; and attenuated delta, `score = Σ (A_need(current) − A_need(future))`.
- Example attenuation `A(x) = 10/x`: raising hunger from 30 to 90 scores 1/3 − 1/9 = 2/9, far more than raising it from 60 to 90, and actions that worsen a need score negative. Zubek calls attenuation functions "a major tuning knob".
- Selection: winner-takes-all, or weighted-random among the top n (e.g. top 3) with probability proportional to score, described as "a good compromise" that avoids the agent looking "unpleasantly deterministic".
- Personality is done with per-agent, per-need multipliers on scores; per-need decay rates are the other tuning knob ("agents whose needs decay more quickly are harder to please").

### Inferences
- Pino's rule "a need past its threshold drags mood/energy down more the longer it is ignored" is a hand-built version of a convex drive function. The Keramati form `D = (Σ|h* − h|^n)^(1/m)` with n > m > 1 gives the same escalation without thresholds, and additionally makes a badly neglected need crowd out the others. Zubek's `A(x) = 10/x` is the same idea in game-AI clothing.
- Treating mood as (minus) the drive and "mood change" as the reward is the direct mapping: the pet's "only job is to self-regulate" is the sum-of-discounted-deviations objective. The optimality theorem does not transfer, because the LLM is a fixed policy that is not learning from that reward; only the shape of the signal transfers.
- Satiation is built in: an action that restores an already-satisfied need yields little or negative drive reduction. That removes the incentive to repeat need-restoring actions, but it does not penalise repeating an action whose need keeps decaying (eat, sleep, repeat), so a separate novelty mechanism is still needed (see section 5).
- BioBlue's result is a direct warning for a multi-need pet: with more than one regulated variable and a long action history in context, the LLM cannot be trusted to regulate from numbers alone. Keeping the arithmetic, clamping and action masking in code, and keeping the visible action history short, are defensible mitigations. Pino's "mask recent actions" step addresses the same self-imitation failure.
- Zubek's weighted-random-among-top-n is a cheap, tested-in-games way to avoid determinism that does not depend on the LLM at all.

### Gaps
- Hull's exact equations were not verified against his 1943/1952 books; only inconsistent secondary summaries were found.
- I found no paper that implements Keramati-Gutkin-style drive reduction as the explicit objective of an LLM-driven agent and measures behaviour over days or weeks. BioBlue is the closest and covers only 100 steps.
- Whether novelty and company can be treated as homeostatic variables with setpoints is, per Keramati & Gutkin themselves, an open problem; doing so in a pet is a design choice, not an established result.
- BioBlue reports no failure frequencies, so how often multi-objective regulation fails is unknown, and newer, larger models were not tested.
- Pino's actual implementation (decay rates, thresholds, exact formulae) is known only from the creator's video; none of it is independently verifiable.

## 2. Dimensional emotion models (circumplex, PAD) and appraisal theories (OCC, Scherer, EMA): computational implementations, including inside LLM agents, and what was measured

### Takeaway
The standard pre-LLM recipe is a layered one: an appraisal step turns events into short-lived emotions, which push a slower mood point in a low-dimensional space (PAD), which relaxes toward a personality-defined baseline. LLM-agent papers from 2023 to 2026 reuse that recipe with the LLM doing the appraisal; they report gains in judged continuity and naturalness, but the evidence is small-sample and mostly LLM-judged, and effects on believability depend on the model.

### Cited Findings

**The models themselves**
- Russell's 1980 circumplex places affect terms around a circle defined by pleasure-displeasure and arousal-sleep; Mehrabian & Russell's PAD (1974) adds dominance, which is what separates states like fear and anger. A 2023 review of emotion models for game NPCs says that for simple general-affect models valence-arousal is likely the better choice. I did not read the 1974/1980 originals. [secondary] — [Wikipedia, PAD emotional state model](https://en.wikipedia.org/wiki/PAD_emotional_state_model); [arXiv 2307.10031](https://arxiv.org/pdf/2307.10031)
- Appraisal theories derive emotion from an evaluation of an event against the agent's goals. EMA's appraisal variables are relevance, desirability, likelihood, causal attribution (credit/blame), controllability and changeability. [primary, full text] — [Marsella & Gratch 2009, EMA](https://www.cs.uky.edu/~sgware/reading/papers/marsella2009ema.pdf)

**Classical computational implementations**
- ALMA (Gebhard 2005) simulates three layers: emotions (short-term), moods (medium-term) and personality (long-term). Appraisal tags map to OCC emotion types (24 emotions); mood is a point in PAD space with each axis in [−1, 1], and the eight octants give eight named moods. [primary, full text] — [Gebhard 2005, ALMA](https://cs.huji.ac.il/course/2005/aisemin/articles2006/docs/pa1a3_29.pdf)
- ALMA's default mood is computed from Big Five traits: `Pleasure = 0.21·Extraversion + 0.59·Agreeableness + 0.19·Neuroticism`; `Arousal = 0.15·Openness + 0.30·Agreeableness − 0.57·Neuroticism`; `Dominance = 0.25·Openness + 0.17·Conscientiousness + 0.60·Extraversion − 0.32·Agreeableness`. [primary, full text] — [Gebhard 2005](https://cs.huji.ac.il/course/2005/aisemin/articles2006/docs/pa1a3_29.pdf)
- ALMA's "pull and push" mood function: all active emotions are averaged into a "virtual emotion center" in PAD space. If the current mood lies between the origin and that center it is pulled toward it; if it is at or beyond the center it is pushed further out in the same direction (moods intensify when experiences keep supporting them). The "usual mood change time" from one octant center to another is 10 minutes; with no active emotions the mood drifts back to the default, with a return time of 20 minutes for the longest octant distance. The example configuration decays an emotion linearly over 20,000 ms. [primary, full text] — [Gebhard 2005](https://cs.huji.ac.il/course/2005/aisemin/articles2006/docs/pa1a3_29.pdf)
- EMA's mood is an aggregate of appraisal frames: intensities of all frames with the same label (hope, joy, fear, ...) are summed and passed through a sigmoid into [0, 1]. Mood is "disassociated from the original eliciting event", changes slowly, and feeds back by adjusting the intensity of new appraisals. EMA's stated evaluation criterion is "process validity", i.e. whether the unfolding dynamics of emotion are captured. [primary, full text] — [Marsella & Gratch 2009](https://www.cs.uky.edu/~sgware/reading/papers/marsella2009ema.pdf)

**Inside LLM agents**
- Chain-of-Emotion (Croissant, Frister, Schofield & McCall, PLOS ONE 2024): a separate LLM call first appraises the situation ("Describe why they feel a certain way"); each emotion description is stored and the whole emotion history is fed into the dialogue prompt. Model: gpt-3.5-turbo at temperature 0. [primary, full text] — [PMC11086867](https://pmc.ncbi.nlm.nih.gov/articles/PMC11086867/)
  - Emotion-understanding test (STEU, 42 items, chance 0.20): no memory 24/42, memory 31/42, appraisal prompting 35/42.
  - Fixed-prompt content analysis: LIWC "authenticity" 82.6 for chain-of-emotion versus 61.9 (memory) and 61.5 (no memory), F = 5.10, p = .03.
  - User study, N = 30, within-subject: "reactions were natural" 5.71 versus 4.43 (no memory) and 4.89 (memory); "sensitive to the feelings and emotions of others" 6.25 versus 5.14 and 5.39. Only 3 of 12 questionnaire items reached significance; warmth and competence did not differ. Emotional tone was lower (less uniformly positive) in the chain-of-emotion condition: 73.0 versus 80.5 and 84.4.
  - Limits: one model, one short dating/breakup scenario, a convenience sample.
- Sentipolis (Fu et al., ACL Findings 2026): targets "emotional amnesia". Each agent holds a continuous PAD vector in [−1, 1]^3 that decays as `s(t+Δt) = s(t) · 2^(−Δt/T½)` with a 120-minute half-life and a 20-minute step. Fast updates follow each conversation round; slow updates happen during reflection, triggered when cumulative poignancy exceeds 150. The update deltas are produced by an LLM prompted with personality and current PAD, not by a closed-form appraisal equation. [primary, full text, first ~80% of page] — [arXiv 2601.18027](https://arxiv.org/abs/2601.18027)
  - Evaluation: 25 personas, 36 steps (12 simulated hours), six backbone models, three LLM judges; baseline is the original Generative Agents architecture.
  - Under the Claude Sonnet 4.5 judge, change versus baseline: GPT-4o-mini empathy +25.5%, continuity +68.3%, believability −25.9%; GPT-5.2 empathy +33.8%, continuity +222.0%, believability +85.0%; Grok-4 empathy −3.6%, continuity +29.7%, believability +60.5%.
  - Pattern across all three judges: continuity gains were largest; believability fell for the smallest model (GPT-4o-mini); empathy fell for Grok-4.
  - Human-human agreement (Krippendorff's α): continuity 0.871, believability 0.806, empathy 0.575; pooled human-LLM α = 0.825.
  - Authors' stated limits: small scale and short horizon (longer runs "might show emotional fatigue, norm drift"), ablations on one model and one judge, smaller models may over-express emotion and need calibration, and emotion-awareness lowered social-rule and appropriateness scores in most ablations.
- "Feeling First, Speaking Second" (Buscaroli & Tamburini, CAS workshop at LREC 2026): a dual-process design that separates Appraisal (the felt reaction) from Formulation (what gets said), running locally via Ollama. Judged by GPT-5 and Gemini 2.5 Pro, authenticity of the final response scored 4.20/5 in a therapy scenario and 3.50/5 in a police-interrogation scenario. The authors trace the drop to a "rational bias": the plan step ran before the appraisal step, so when appraisal produced "Terror" the formulation step followed the calm plan and suppressed the emotion. Their conclusion is that "enforcing affective primacy in the decision cycle is critical". They describe the evidence as anecdotal: 8 conversation logs in total. [primary, full text] — [ACL Anthology 2026.cas-1.7](https://aclanthology.org/2026.cas-1.7/)
- Emotional Cognitive Modeling Framework (Ma et al., Oct 2025): ties PAD directly to state variables, `Pleasure_t = k_p (I_t − I_t−1)` (income change), `Arousal_t = k_a (H_t − H_t−1)` (stamina change), and dominance from social rank. Tested with six delivery-rider agents over 30 simulated days; the reported fit to real data is trend-level, and the task-quality table was judged by the authors and one LLM. [primary, full text] — [arXiv 2510.13195](https://arxiv.org/abs/2510.13195)
- AgentSociety (Tsinghua, 2025): each agent rates six emotions (sadness, joy, fear, disgust, anger, surprise) on 0-10 plus a keyword and a thought sentence; needs follow a Maslow hierarchy and drive plans via the Theory of Planned Behavior. The portion I read reports no ablation or standalone validation of the emotion or needs modules. [primary, full text, first ~half of page] — [arXiv 2502.08691](https://arxiv.org/abs/2502.08691)
- "Can Generative Agents Predict Emotion?" (2024) measures agent mood with the PANAS questionnaire as events are perceived, with an appraisal-inspired "norm" summary of relevant memories. Details not verified. [snippet] — [arXiv 2402.04232](https://arxiv.org/pdf/2402.04232)

**What an emotional state does to an LLM's behaviour**
- E-STEER (Sun et al., April 2026) steers hidden states along valence, arousal and dominance directions in Qwen3-8B. Reported effects are non-monotonic (inverted-U or U-shaped): task success peaked at moderate arousal (+3), about 4.7% above neutral; positive valence gave 33.1% higher answer validity than negative; conciseness was 23.3% higher under negative valence; for agents, dominance improved task success most (28.0%), then arousal (16.7%) and valence (16.0%). One main model, greedy decoding, emotion treated as static. [primary, full text] — [arXiv 2604.00005](https://arxiv.org/abs/2604.00005)
- Anthropic's interpretability study of Claude Sonnet 4.5 (April 2026) derived vectors for 171 emotion words and found they causally affect behaviour: across 64 activities, vector activation "strongly predicted" preferences, and steering shifted them. In a blackmail test on an earlier snapshot (baseline rate 22%), steering "desperate" raised the rate and "calm" lowered it. The vectors are "primarily 'local' representations" that track the emotion relevant to the current output, not a persistent state. Steering toward desperation increased cheating on a coding task with "no emotional markers" in the text. The authors state that none of this shows the model feels anything. [primary, full text of the research summary page; effect sizes are in figures not text] — [Anthropic](https://www.anthropic.com/research/emotion-concepts-function)

### Inferences
- A two-speed design is the common denominator of ALMA, EMA, Sentipolis and Pino: fast event-driven emotion, slow mood that integrates it and relaxes to a baseline. Pino's "mood" and "energy" are a valence-like and an arousal-like axis, i.e. a circumplex without the dominance dimension; the NPC review's advice suggests that is adequate for a simple pet.
- ALMA's personality-to-default-mood mapping and Zubek's per-need multipliers are two cheap, concrete ways to make one pet differ from another without touching the prompt: change the baseline the mood returns to, and change the decay rates.
- ALMA's push phase (a mood that is already supported by events intensifies) is a positive-feedback term. Combined with a strong negativity weighting it could produce spirals; ALMA bounds it by clamping PAD to [−1, 1] and by the return-to-default drift.
- The "rational bias" finding and the Anthropic "local, not persistent" finding point the same way: the LLM will not carry affect forward on its own, and will plan around it if asked to plan first. Compute and inject the felt state before the action-selection call, every call.
- Emotion state can make small models worse (Sentipolis believability fell on GPT-4o-mini) and makes output less uniformly pleasant (lower LIWC tone, lower appropriateness scores). For a pet that is arguably the desired effect, but it is a cost if the pet also has to be agreeable.

### Gaps
- Primary texts for Russell (1980), Mehrabian & Russell (1974), OCC (1988) and Scherer's component process model were not read; statements about them here rest on secondary summaries, and nothing is recorded about Scherer's stimulus evaluation checks.
- No study found compares a two-variable (valence/arousal) state against PAD or discrete emotions inside an LLM agent.
- Every LLM-agent result above covers hours of simulated time or a handful of dialogue turns. None measures an always-on agent over weeks, where the Sentipolis authors themselves expect emotional fatigue and drift.
- Evaluation is dominated by LLM judges and questionnaires about believability; none measures whether behaviour becomes less repetitive.

## 3. LLM agents with explicit internal state (needs, drives, mood, energy, physiological variables), 2023-2026: architectures, results, failure modes

### Takeaway
Several systems give LLM agents decaying numeric needs that are tracked outside the model and described to it in words; the measured effect is that behaviour shifts toward the unmet need and activity becomes more varied than goal- or profile-driven baselines. The recurring failure modes are the LLM mis-scoring its own state changes, self-repetition over long histories, plans overriding feelings, and thin evaluation.

### Cited Findings

**Humanoid Agents (Wang, Chiu & Chiu, EMNLP 2023 demo)** [primary, full text] — all from [arXiv 2310.05418](https://arxiv.org/abs/2310.05418)
- Adds three "System 1" elements to Generative Agents: basic needs, emotion and relationship closeness.
- Five needs (fullness, fun, health, social, energy) on 0-10; all start at 5 except energy at 10. Needs decline over time at fixed rates identical for all agents (the paper's description of the rates is internally ambiguous: one section says a "set likelihood" of dropping by one, another gives fullness and health dropping by 1 every 5 hours and faster rates for social, fun and energy).
- The plan is reconsidered when emotion is non-neutral or any need is 3 or below.
- Needs reach the LLM as words: a modifier (3 = "slightly", 2 = none, 1 = "very", 0 = "extremely") plus an adjective (hungry, bored, unwell, tired, lonely).
- Emotion is one of seven labels (angry, sad, afraid, surprised, happy, neutral, disgusted) with no intensity. Closeness is an integer 0-30 moved by ±1 after each conversation depending on whether an LLM judges the agent enjoyed it.
- Behavioural effect of setting one need to 0 (mean change in time spent on activities that satisfy it): health +156%, energy +56%, fullness +35%, social +12%, fun −9%.
- Effect of setting an emotion (the paper's Table 3, mean change in activity count; I did not verify exactly which activities are counted): angry +15, sad +10, afraid +10, disgusted +4, surprised +1, happy −2.
- Agreement of the system's own judgments with three human annotators over one simulated day (Fleiss' κ among humans / micro-F1 of system): fullness 0.972/0.972, energy 0.88/0.861, emotion 0.823/0.84, social 0.833/0.743, health 0.917/0.694, fun 0.806/0.66.
- Failure mode: the LLM (ChatGPT 3.5) over-credited need satisfaction. It predicted a health benefit for 34% of activities versus 4.9% by annotators, fun 44.4% versus 10.4%, social 47.2% versus 24.3% (e.g. giving medication to someone else counted as improving one's own health; routine work counted as fun).
- Other stated limits: agents plan independently so plans conflict; dialogue is two-party only.

**D2A, Desire-driven Autonomous Agent (Wang et al., ICLR 2025)** [primary, full text] — all from [arXiv 2412.06435](https://arxiv.org/abs/2412.06435)
- Principle: "Act to Satisfy Intrinsic Desires" instead of acting from a goal or a profile.
- 11 desire dimensions indoors (hunger, thirst, sleepiness, cleanliness, comfort, health, safeness, social connectivity, joyness, passion, spiritual satisfaction), plus recognition, sense of control and sense of superiority in a multi-agent setting. Each is an integer on 0-10.
- Each agent has an expected (target) value per dimension, derived from profile adjectives (e.g. "extremely sociable" maps to 9 for social connectivity), so targets differ by personality.
- Decay: at each step each value drops by 1 with a probability set by the agent's profile.
- Loop: describe current values in words, propose N candidate activities (default 3), have the LLM imagine the resulting desire state for each, select the best, act, then have the LLM update the values.
- Metric: dissatisfaction `δ_t = Σ_d max(v*_d − v_d,t, 0)`.
- Results on LLaMA3.1-70B in the Concordia text simulator against ReAct, BabyAGI and LLMob: D2A had lower mean dissatisfaction and variance in the random-start setting; in a fixed-start setting human-controlled play reduced dissatisfaction most and D2A did not clearly beat baselines; baselines repeated profile-consistent or physiological actions while D2A covered more action categories (shown via word clouds and category distributions, not a single number).
- Naturalness was judged pairwise by GPT-4o; GPT-4o agreed with eight human annotators on 100% of 11 high-consensus pairs, 80% of 5 moderate pairs and 66.7% of 3 near-ties.
- Ablations: removing the verbal description of desire values slowed desire fulfilment; proposing 1 candidate converged slower than 5; adding a multi-step hourly planner slightly reduced performance (agents stuck to pre-set plans).
- Stated limits: linear decay "may miss the natural variability of human needs"; dimensions chosen heuristically; heavy dependence on a large LLM; 3 to 15 trials per condition.

**Other systems**
- Sentipolis (PAD mood with 120-minute half-life, emotion-tagged memory), "Feeling First, Speaking Second" (appraisal before formulation), the Emotional Cognitive Modeling Framework (PAD driven by income and stamina changes) and AgentSociety (six emotions on 0-10 plus Maslow needs, 10k+ agents) are described in section 2. — [arXiv 2601.18027](https://arxiv.org/abs/2601.18027); [ACL Anthology 2026.cas-1.7](https://aclanthology.org/2026.cas-1.7/); [arXiv 2510.13195](https://arxiv.org/abs/2510.13195); [arXiv 2502.08691](https://arxiv.org/abs/2502.08691)
- BioBlue (numeric homeostatic variables given to an LLM for 100 steps) is described in section 1; it is the only source found that documents long-horizon regulation failures directly. — [arXiv 2509.02655](https://arxiv.org/abs/2509.02655)
- "Motivation in Large Language Models" (Nahum et al., March 2026) reports that LLMs' self-reported motivation "aligns with different behavioral signatures, varies across task types, and can be modulated by external manipulations", linking "reports, choices, effort, and performance". [primary, abstract only] — [arXiv 2603.14347](https://arxiv.org/abs/2603.14347)
- Sophia (Dec 2025) describes an intrinsic-motivation module that lets a persistent agent set its own tasks from drives such as curiosity and mastery; PsychoAgent (Aug 2026) splits memory into factual and affective streams; DualMind (2026) separates a slowly evolving persona state from a fast affective state. Details not verified. [snippet] — [arXiv 2512.18202](https://arxiv.org/html/2512.18202v1); [arXiv 2608.07438](https://arxiv.org/abs/2608.07438v1); [arXiv 2602.02534](https://arxiv.org/html/2602.02534)
- On repetition in long-running agents: Lu et al. note that LLM agents in embodied environments are "frequently trapped in repetitive loops"; a 2026 preprint on within-episode drift reports failed episodes show an early, sustained rise in repeated text. Details not verified. [snippet] — [arXiv 2505.17616](https://arxiv.org/abs/2505.17616v1); [alphaXiv 2607.03441](https://www.alphaxiv.org/overview/2607.03441)

**Failure modes, collected** (each is sourced above)
- LLM as bookkeeper: over-credits need satisfaction by a factor of roughly 2 to 7 (Humanoid Agents). — [arXiv 2310.05418](https://arxiv.org/abs/2310.05418)
- Self-imitation and runaway maximisation over long numeric histories with multiple objectives (BioBlue). — [arXiv 2509.02655](https://arxiv.org/abs/2509.02655)
- Plan-before-feeling suppresses the emotion (Feeling First). — [ACL Anthology 2026.cas-1.7](https://aclanthology.org/2026.cas-1.7/)
- Pre-made multi-step plans reduce responsiveness to current desires (D2A ablation). — [arXiv 2412.06435](https://arxiv.org/abs/2412.06435)
- Smaller models over-express emotion and lose believability (Sentipolis). — [arXiv 2601.18027](https://arxiv.org/abs/2601.18027)
- Weak or absent response to some states: setting "fun" to zero changed behaviour by −9%, and "happy" by −2 activities (Humanoid Agents). — [arXiv 2310.05418](https://arxiv.org/abs/2310.05418)

### Inferences
- Pino's architecture is closest to D2A plus Humanoid Agents: decaying needs held in code, a per-agent target, verbal description of state, propose-then-select. What Pino adds that none of these papers test is the repetition penalty, exogenous shocks and action masking; what the papers add that Pino's description lacks is a per-dimension personality target (D2A) and a measurable objective (the dissatisfaction metric).
- D2A's dissatisfaction metric and a simple action-category entropy would give the user two cheap quantitative checks for the stated goals (self-regulation, and non-repetitive output). D2A itself only showed diversity qualitatively.
- The Humanoid Agents over-crediting numbers argue for fixed, code-side effect tables per action (as in Zubek's advertisements) rather than asking the LLM how much an action satisfied a need. D2A lets the LLM update values and did not measure the error of doing so.
- The weak response to "fun" and "happy" suggests that states with no obvious corrective action get ignored. Novelty and "urge to make" are of that kind, so they probably need explicit candidate actions attached, not only a described feeling.
- D2A's planner ablation supports choosing one action at a time from current state, as Pino does, over day plans.

### Gaps
- No peer-reviewed description of Pino or of any always-on LLM pet was found; the only source is the creator's video.
- No paper found uses exactly two aggregate variables (mood, energy) fed by a set of needs, and none tests whether aggregating needs into mood/energy changes behaviour relative to showing the needs directly.
- Long-horizon evidence is missing: the longest runs above are 30 simulated days with six agents (trend-level results only) and 100 steps (BioBlue).
- Sophia, PsychoAgent, DualMind and the two repetition papers were not read; their claims above are leads.
- The second half of the AgentSociety paper was not read, so a validation of its mind modules may exist there.

## 4. Negativity bias and loss aversion: what the ratios actually are, and whether 7:1 is defensible

### Takeaway
The direction is well supported (bad outweighs good), but no source gives 7:1: loss aversion in money choices averages about 2:1 (meta-analytic mean 1.955, with a stricter meta-analysis at 1.31), and the only famous larger number, Gottman's 5:1, is a count of interactions during marital conflict in one domain. A 7x penalty is a tuning choice, not a psychological constant.

### Cited Findings

**Baumeister, Bratslavsky, Finkenauer & Vohs (2001)** [primary, full text] — all from [Review of General Psychology 5(4):323-370](https://fbaum.unc.edu/teaching/articles/Baumeister_2001.pdf)
- A narrative review, not a meta-analysis; it argues for a general principle across domains (everyday events, close relationships, learning, impression formation, feedback) and does not derive a general numeric ratio.
- The one ratio it cites is Gottman's: "Gottman's index suggests that bad events are on average five times as powerful as good ones, at least with regard to close relationships."
- It repeats the figure as conditional: "if Gottman (1994) is correct, the ratio should be at least five goods for every bad."
- Relevant to mood dynamics: in a diary study the review cites (Sheldon, Ryan & Reis 1996), "having a good day did not have any noticeable effect on a person's well-being the following day, whereas having a bad day did carry over and influence the next day." The review notes the result is correlational.
- The review also argues good can prevail "by force of numbers", i.e. many small goods offset fewer bads.

**Gottman's 5:1**
- The 5:1 figure is attributed by Baumeister et al. to Gottman's 1994 book "Why Marriages Succeed or Fail". [primary for the attribution] — [Baumeister et al. 2001](https://fbaum.unc.edu/teaching/articles/Baumeister_2001.pdf)
- The Gottman Institute states the ratio applies to conflict discussions: about 5:1 positive to negative in stable, happy couples and 0.8:1 in couples heading for divorce. [secondary, institute's own site, search summary] — [Gottman Institute](https://www.gottman.com/blog/the-positive-perspective-dr-gottmans-magic-ratio/)
- The peer-reviewed Gottman & Levenson (1992) study of 73 couples does not state a 5:1 ratio. It classifies couples as "regulated" (both spouses' cumulative positive-minus-negative speech curves slope upward; 42 couples) or "nonregulated" (31 couples), and finds nonregulated couples at higher risk of dissolution. [primary, full text; no occurrence of "ratio" in the text] — [Gottman & Levenson 1992](https://bpl.studentorg.berkeley.edu/docs/41-Marital%20Processes92.pdf); [PubMed](https://pubmed.ncbi.nlm.nih.gov/1403613/)

**Loss aversion coefficients**
- Tversky & Kahneman (1992) reported median λ = 2.25 with value-function curvature α = β = 0.88; the estimate came from 25 graduate students. I did not read the original. [secondary] — [Healthcare Economist summary](https://healthcare-economist.com/2024/06/26/empirical-estimates-of-loss-aversion); [Brown et al. working paper](https://epub.ub.uni-muenchen.de/75121/1/275.pdf)
- Brown, Imai, Vieider & Camerer (Journal of Economic Literature, 2024): meta-analysis of 607 estimates from 150 articles; mean loss aversion coefficient 1.955, 95% probability interval [1.820, 2.102]. [primary, abstract only] — [AEA / JEL](https://www.aeaweb.org/doi/10.1257/jel.20221698)
- A stricter meta-analysis (Walasek and colleagues) found mean λ = 1.31, close to gain-loss neutrality; it is described as using narrower inclusion criteria than Brown et al. [secondary] — [Cambridge Core article](https://www.cambridge.org/core/product/5B1998E9F1E47F3006235CC57AB51AB7/core-reader)
- Critiques: Gal & Rucker (2018, "The loss of loss aversion") argue loss aversion has been overgeneralised; Yechiam and colleagues report that for small losses people often show gain-loss neutrality; Mrkva et al. (2020) defend it as robust. Primary papers not read. [secondary] — [Cambridge Core article](https://www.cambridge.org/core/product/5B1998E9F1E47F3006235CC57AB51AB7/core-reader); [Kitces summary](https://www.kitces.com/blog/loss-aversion-pain-loom-larger-than-gain-gal-rucker-journal-psychology/)

**A cautionary precedent for "magic ratios"**
- Fredrickson & Losada's "critical positivity ratio" of 2.9013 was shown by Brown, Sokal & Friedman (2013) to rest on a misapplied fluid-dynamics model; the journal retracted the mathematical modelling, including the 2.9013 value. [secondary for the retraction; primary abstract for the critique] — [Wikipedia](https://en.wikipedia.org/wiki/Critical_positivity_ratio); [Brown, Sokal & Friedman 2013](https://repository.uel.ac.uk/item/85wq1)

**What Pino's creator claims**
- The transcript says the penalty for repetition "is seven times stronger than the reward he gets when he's creative... because psychologically negative feelings have a stronger impact than positive ones". No source is given for the number. — local file `video-inspo/transcripts/how-to-make.txt` (no URL)

### Inferences
- The creator's justification supports the sign of the asymmetry, not its size. The defensible published range is roughly 1.3 to 2.3 for the weight of a loss against an equal gain, and 5 for one domain-specific count heuristic. Seven sits above all of them.
- The numbers are also not the same kind of quantity. λ is a per-unit weight on outcomes of equal size; Gottman's 5:1 is a frequency ratio at which relationships are stable. Pino's 7x is a per-event weight, so the closer analogue is λ (about 2), which makes 7 look even larger.
- Simple arithmetic shows what the multiplier does. If a novel action gives +g mood and a repeated one gives −k·g, mood drifts upward only when the share of actions flagged as repetitive is below 1/(1+k): 12.5% for k = 7, 16.7% for k = 5, 33% for k = 2. So 7x is not "realism"; it is a demand that at least seven of every eight actions be novel. That may be exactly the intended design pressure, but it should be chosen for that reason and tuned against the measured repetition rate.
- A harsh fixed multiplier interacts with the other mechanisms. With recent actions already masked, and with a small action set, the pet may be unable to avoid the penalty, producing a chronically low mood that reads as depression rather than personality. The Sheldon et al. carry-over finding suggests a more faithful asymmetry is in persistence (bad mood decays more slowly than good) rather than in a large instantaneous multiplier. This is my suggestion, not something any cited source tested in an agent.

### Gaps
- Tversky & Kahneman (1992), Gottman (1994), Rozin & Royzman (2001), Gal & Rucker (2018) and Walasek et al. were not read in the original; the Brown et al. JEL article was seen as an abstract only.
- Whether Rozin & Royzman state that no fixed ratio exists could not be confirmed.
- No study was found on how the size of a negativity multiplier affects an LLM agent's behaviour, or on whether LLMs respond asymmetrically to described negative versus positive internal states.
- No source for the specific figure 7 was found anywhere; I cannot rule out that the creator took it from a source I did not locate.

## 5. Hedonic adaptation, habituation and boredom models: making repeated stimuli less rewarding, and whether that can replace a hand-set repetition penalty

### Takeaway
Three well-specified mechanisms make repetition lose value without a hand-written penalty: reward relative to expectation (Rutledge; Dubey et al.), a novelty bonus that shrinks with exposure count (count-based exploration), and stimulus-specific habituation that recovers with time (Rankin et al.). Each is a plausible graded replacement for Pino's fixed 7x rule, but none has been tested inside an LLM agent.

### Cited Findings

**Happiness as expectation-relative and fast-forgetting**
- Rutledge, Skandali, Dayan & Dolan (PNAS 2014) model momentary happiness as `Happiness(t) = w0 + w1 Σ_j γ^(t−j) CR_j + w2 Σ_j γ^(t−j) EV_j + w3 Σ_j γ^(t−j) RPE_j`, where CR is a certain reward, EV the expected value of a chosen gamble, RPE the reward prediction error, and 0 ≤ γ ≤ 1 a forgetting factor. [primary, full text] — [PNAS 2014 PDF](https://digitalwellbeing.org/wp-content/uploads/2014/08/PNAS-2014-Rutledge-1407535111.pdf); [PMC4143018](https://pmc.ncbi.nlm.nih.gov/articles/PMC4143018)
- Fitted values in the lab sample: γ = 0.61 ± 0.30 (mean ± SD); fit r² = 0.47 ± 0.21; all three weights positive, EV weights lower than RPE weights. With γ = 0.61, a reward five trials ago has 8% of the impact of one just received; rewards more than 10 trials back have little effect. [primary, full text] — [PNAS 2014 PDF](https://digitalwellbeing.org/wp-content/uploads/2014/08/PNAS-2014-Rutledge-1407535111.pdf)
- Happiness was not explained by cumulative task earnings (e.g. P = 0.81, r² = 0.003 in one analysis). The model was replicated in a smartphone sample of 18,420 participants. [primary, full text] — [PNAS 2014 PDF](https://digitalwellbeing.org/wp-content/uploads/2014/08/PNAS-2014-Rutledge-1407535111.pdf)

**Habituation and comparison as a reward function**
- Dubey, Griffiths & Dayan (PLOS Computational Biology 2022) define a subjective reward `f = w1·Objective + w2·Expect + w3·Compare`, which they expand as `f = (w1 + w2 + w3)·r_t − w3·ρ − w2·Q(s_t, a_t)`, where ρ is an aspiration level and Q(s_t, a_t) is the agent's own learned expectation for that action in that state. [primary, full text] — [doi 10.1371/journal.pcbi.1010316](https://doi.org/10.1371/journal.pcbi.1010316)
- Result: agents with this reward "are less happy" but "learn faster and significantly outperform standard reward-based agents"; comparison acts as an exploration incentive and expectations help most in sparse-reward and non-stationary environments. Example: a "Compare only" agent (w3 = 0.4, ρ = 0.9) earned mean 2097.02 objective reward versus 1447.47 for an expectation-only agent. [primary, full text] — [doi 10.1371/journal.pcbi.1010316](https://doi.org/10.1371/journal.pcbi.1010316)
- Drawbacks they report: performance drops if the aspiration level is too high or too low; agents with very high aspirations "accumulate high negative" subjective reward (chronically unhappy and also performing poorly); and performance is sub-optimal "when there are too many similar options". [primary, full text] — [doi 10.1371/journal.pcbi.1010316](https://doi.org/10.1371/journal.pcbi.1010316)

**Novelty bonuses that decay with exposure**
- Bellemare et al. (NeurIPS 2016) add an exploration bonus `R+ = β · (N̂(x) + 0.01)^(−1/2)` with β = 0.05, where N̂ is a pseudo-count of how often a state has been seen, derived from a density model. With it an agent explored 15 of 24 rooms of Montezuma's Revenge within 50 million frames. [primary, full text] — [arXiv 1606.01868](https://arxiv.org/abs/1606.01868)
- A 2023 review of curiosity models (Modirshanechi et al., Trends in Neurosciences) and a review by Siddique et al. cover how novelty signals are turned into reward functions. [snippet] — [EPFL record](https://infosciences.epfl.ch/record/308417/files/1-s2.0-S0166223623002400-main.pdf)

**Behavioural characteristics of habituation**
- Rankin et al. (2009) restate the defining characteristics: response decrement with repeated stimulation; spontaneous recovery when the stimulus is withheld; faster recovery after high-frequency than low-frequency stimulation; faster or deeper decrement across repeated cycles of habituation and recovery; stimulus specificity (the response still occurs to other stimuli); and dishabituation (a different stimulus restores the response, with diminishing effect when the dishabituating stimulus is itself repeated). [primary, abstract and revised-wording excerpts via search summary] — [PMC2754195](https://pmc.ncbi.nlm.nih.gov/articles/PMC2754195); [PMC3885986 Table 1](https://pmc.ncbi.nlm.nih.gov/articles/PMC3885986/table/T1)
- Opponent-process theory (Solomon & Corbit 1974; Solomon 1980): an affective reaction (a-process) triggers a delayed opposing after-reaction (b-process) that strengthens with repeated exposure, producing hedonic habituation and withdrawal. Sources differ on whether the a-process itself weakens. [secondary] — [Wikipedia](https://en.wikipedia.org/wiki/Opponent-process_theory)

**Boredom as a signal**
- Yu, Chang & Kanai (Frontiers in Neurorobotics 2018) treat boredom as arising from predictive-model learning and curiosity from policy learning, and report their agents outperformed other curious or exploratory variants on model-building benchmarks. [snippet] — [Frontiers](https://www.frontiersin.org/journals/neurorobotics/articles/10.3389/fnbot.2018.00088/pdf)
- A Daw-lab preprint models fatigue and boredom as opportunity costs of continuing the current activity. [snippet] — [bioRxiv 2020.09.08.287276](https://www.biorxiv.org/content/10.1101/2020.09.08.287276v1.full-text)

**Satiation inside drive-reduction models**
- In Keramati & Gutkin's model responding falls as the internal state reaches the setpoint, and consuming beyond it overshoots and increases drive. In Zubek's attenuated-delta scoring, topping up an already high need scores near zero and worsening it scores negative. Both are satiation, i.e. need-specific diminishing returns, without any explicit repetition rule. [primary, full text] — [Keramati & Gutkin 2014](https://elifesciences.org/articles/04811); [Zubek](https://robert.zubek.net/publications/Needs-based-AI-draft.pdf)

**What Pino does instead**
- Pino reads previous actions; repetition lowers mood and non-repetition gives "a little mood boost", with the penalty seven times the boost; separately, the most recent actions are made unavailable. — local file `video-inspo/transcripts/how-to-make.txt` (no URL)

### Inferences
These are design suggestions derived from the findings; none is validated in an LLM agent.
- **Per-action habituation trace.** Keep a familiarity value per action (or per action category, or per embedding neighbourhood of what the pet said or made). On use, add 1; over time decay it with a half-life. Scale the mood/need benefit of the action by something like `1 / sqrt(1 + familiarity)`, the Bellemare form. This reproduces Rankin's properties that a binary penalty lacks: graded decrement, stimulus specificity, and spontaneous recovery after a rest, so a favourite activity becomes enjoyable again later instead of being punished forever or only masked for a few turns.
- **Expectation-relative mood.** Following Rutledge and Dubey, let the mood impact of an action be its outcome minus the pet's running expectation for that action. The tenth apple then lifts mood less than the first because it is fully expected, and an unexpectedly good or bad outcome moves mood more. This makes random outside events matter more than routine, which matches Pino's intent.
- **Novelty as a need.** The novelty need can be restored in proportion to (1 − familiarity) of whatever was done, which ties the "novelty" need to the same trace instead of a separate rule.
- **Calibrate with the fitted numbers.** Rutledge's γ = 0.61 per trial implies an emotional memory of only a handful of events; Sentipolis used a 120-minute half-life for mood. These give starting points for decay constants, with the caveat that both were fitted or chosen for different settings.
- **Known risk.** Dubey et al. show that expectation- and comparison-based reward makes agents less happy on average and that an aspiration level set too high produces chronic unhappiness. A habituating pet will trend toward low mood unless the world keeps supplying enough genuinely different actions; the size of the action repertoire is the binding constraint, more than the penalty constant.
- **Keep the mask.** Habituation changes the internal payoff, but BioBlue's self-imitation finding suggests the LLM may still repeat itself regardless of payoff. Masking recent actions is a hard guarantee that a soft signal cannot give, so the two are complements.

### Gaps
- No paper was found that implements habituation, expectation-relative reward or count-based novelty inside an LLM-driven agent and measures repetition. The replacement proposed above is unproven.
- No formal model of sensory-specific satiety (Rolls) or of hedonic adaptation in the Frederick & Loewenstein sense was retrieved; a "discounted utility with habituation and satiation state variables" paper appeared in search results but was not read.
- The Rankin, Yu et al., Daw-lab and curiosity-review items were not read in full.
- How to measure "familiarity" for open-ended LLM output (words, creations) is not addressed by any source here; embedding distance is my assumption.

## 6. Presenting numeric internal state to an LLM: numbers versus natural-language "felt" descriptions

### Takeaway
The available evidence favours converting numbers to a small set of verbal levels or a short felt description before prompting, and the two agent systems with measurable behavioural effects (Humanoid Agents, D2A) both do this; but the evidence is indirect, and no study directly compares numeric and verbal state on the long-horizon action choices of an autonomous agent.

### Cited Findings

**Direct comparisons of representation**
- Choudhury, Kumar & Martin (2025) compared four ways of specifying an emotion to GPT-4 and LLaMA-3 for text generation: emotion words, lexical VAD (scales expressed in English words), numeric VAD (scale −5 to +5) and emojis. Human participants then judged the outputs. [primary, full text] — [arXiv 2503.11881](https://arxiv.org/abs/2503.11881)
  - Participants picked the intended emotion at 61.9% (GPT-4) and 57.5% (LLaMA-3) for words, and 52.0% for lexical VAD with GPT-4, against 25% chance.
  - "Numeric VAD, by contrast, had poor alignment, with the worst entropy values for both LLMs."
  - On how well the output conveyed the emotion, words beat numeric VAD for GPT-4 (p = 0.002) and lexical VAD beat numeric VAD for LLaMA-3 (p = 0.018); the authors conclude "Numeric VAD scores under-perform".
  - Scope: single-shot keyword-guided generation judged by people, not agent behaviour over time.
- D2A keeps integers internally but shows the LLM words, using the prompt "How would one describe {agent_name}'s {value_name} state given the current value {numerical_value}? ... Please answer in descriptive words. Do not include the numerical value in your answer." The authors' stated reason is that "many studies have shown that large language models often struggle with interpreting numerical values". In their ablation, without the verbal description "the agent struggles to accurately interpret its current desire states, resulting in a slower rate of desire fulfillment". The result is shown as a curve, not a number. [primary, full text] — [arXiv 2412.06435](https://arxiv.org/abs/2412.06435)
- E-STEER's authors state that encoding emotion as continuous numbers in prompts is "often less effective than using textual emotion labels" and that LLMs are often insensitive to continuous prompt values, citing Choudhury et al. as their only support. Their own control test still found prompt-level methods tracked target VAD values with Pearson correlations of 0.9437 (valence), 0.9021 (arousal) and 0.7756 (dominance), against 0.9816, 0.9792 and 0.9206 for activation steering. [primary, full text] — [arXiv 2604.00005](https://arxiv.org/abs/2604.00005)

**Systems that verbalise state, and what happened**
- Humanoid Agents maps need levels to a modifier plus adjective ("slightly hungry", "very tired", "extremely lonely"); the mapping the paper gives covers values 0 to 3, which matches its plan-change trigger of 3 or below. With that format, a zeroed need changed time allocation by +156% (health), +56% (energy), +35% (fullness), +12% (social) and −9% (fun). [primary, full text] — [arXiv 2310.05418](https://arxiv.org/abs/2310.05418)
- Sentipolis deliberately avoids "exposing the LLM to raw continuous numbers": the PAD point is mapped by k-nearest-neighbours (k = 3) to emotion labels, and an LLM then writes a natural-language emotion paragraph from the labels, the profile and retrieved memories, which is what gets injected. In the single-model ablation, the paper reads removal of the open-vocabulary description and of emotion-memory coupling as hurting continuity, and removal of decay as hurting believability and communication. (I am reporting the authors' reading; the sign convention of the ablation table came through a machine summary and I did not verify individual cells.) [primary, full text, first ~80% of page] — [arXiv 2601.18027](https://arxiv.org/abs/2601.18027)
- "Feeling First, Speaking Second" stores the current emotional state as "a natural language description of the mood" and the relationship as "a qualitative assessment". [primary, full text] — [ACL Anthology 2026.cas-1.7](https://aclanthology.org/2026.cas-1.7/)

**Evidence about numbers specifically**
- BioBlue gave numeric interoception every step. It was enough for single-variable regulation but not for two variables over 100 steps, where models drifted and repeated their own past actions. The paper did not test a verbal alternative. [primary, full text] — [arXiv 2509.02655](https://arxiv.org/abs/2509.02655)
- A May 2026 preprint on Claude Haiku found that ten vague intensity words ("slightly" through "drastically") collapsed into five distinct numeric outputs, with the four lowest words mapping to the same value, and that the current system state explained more variance than the word. Single model, single domain; not read in full. [snippet] — [arXiv 2605.21827](https://arxiv.org/abs/2605.21827)

**Why state must be re-presented every turn**
- Anthropic reports emotion representations in Claude Sonnet 4.5 are "primarily 'local'", tracking the emotion relevant to the current or upcoming output and not the model's persistent state; and that steering can change behaviour (more cheating under "desperate") with "no emotional markers" in the text. [primary, full text of summary page] — [Anthropic](https://www.anthropic.com/research/emotion-concepts-function)
- When the plan was made before the appraisal, the plan won and the emotion was suppressed ("rational bias"). [primary, full text] — [ACL Anthology 2026.cas-1.7](https://aclanthology.org/2026.cas-1.7/)
- E-STEER found emotion effects on performance are non-monotonic, with moderate levels often best and extreme settings degrading output. [primary, full text] — [arXiv 2604.00005](https://arxiv.org/abs/2604.00005)

### Inferences
- Keep the numbers in code and show the model words. Three independent lines agree on direction (Choudhury's human judgments, D2A's ablation, and the design choices of Humanoid Agents and Sentipolis), though none is a controlled test on long-horizon behaviour.
- Use few levels. The intensity-word preprint suggests the model distinguishes about five tiers, and Humanoid Agents got large effects from four. Mapping a 0-100 need onto four or five named bands is likely to lose nothing the model could have used.
- Describe only what is salient. Humanoid Agents' verbal mapping is defined only for needs at 3 or below. Listing every need at every turn invites the model to treat the list as boilerplate; this is an inference, not a tested claim.
- A two-stage rendering (numbers to labels in code, then a short first-person "how I feel right now" paragraph written by a cheap LLM call that also sees recent memories) is the Sentipolis pattern and is the most "felt" option. It costs an extra call, and adds a risk that the paragraph itself becomes repetitive; varying it is an untested requirement.
- Order matters: inject the felt state before asking for candidate actions, and avoid a prior planning step that the feeling then has to fight (Feeling First).
- Do not rely on the model to remember how it felt: recompute and re-inject each turn (Anthropic's locality finding), and keep the long action history out of the prompt or summarised, since BioBlue links long self-histories to self-imitation.
- Expect that vivid negative descriptions may change behaviour more than intended and without visible signs (Anthropic; E-STEER's non-monotonic effects). Capping how extreme the verbal description can get is a reasonable safeguard, and is my suggestion.
- Whether to show the numbers alongside the words is undecided by the evidence. D2A explicitly forbids the number in the description; no source tested "words plus number".

### Gaps
- No head-to-head study was found that holds an agent architecture fixed and varies only the state format (numeric, verbal bands, first-person felt paragraph) while measuring action selection, need regulation or repetition over a long run. This is the central missing experiment for the user's design, and it is cheap to run in their own simulator.
- D2A's ablation result has no reported effect size; Choudhury et al. measure generation quality, not decisions.
- The claim that "LLMs struggle with numbers" is asserted by D2A and E-STEER with thin citation; with current frontier models it may be weaker than those papers assume. BioBlue used only two small 2024-era models.
- The intensity-word preprint (arXiv 2605.21827) was seen only as a search summary.
- No evidence was found on prompt placement (system prompt versus latest turn) or on first-person versus third-person phrasing of internal state.
