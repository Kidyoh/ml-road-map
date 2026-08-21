# ML Roadmap Platform — Build Plan

A build spec for Claude Code. Work milestone by milestone. Do not skip ahead.

---

## 1. What we are building

An interactive, community-based platform where someone learns machine learning from zero to a deployed system by working through a gated graph of **40 nodes across 8 phases**.

Each node carries: a goal, one primary and one alternate resource, a hands-on coding session brief, a self-verifiable checkpoint checklist, short-answer concept questions with a revealable answer key, and a reflection prompt.

Nodes unlock based on prerequisites. Locked nodes are fogged, not hidden entirely — the learner can see the shape of the road ahead.

**This is not a code-execution platform in v1.** Verification is self-reported against deliberately falsifiable checklist items. Execution comes later, in M8, and only for the three nodes where self-verification is least trustworthy.

---

## 2. Non-negotiables

These constraints exist for reasons that are not obvious. Do not "improve" them without asking.

1. **Content lives in git as MDX. Runtime state lives in Postgres.** Fixing a dead link is a pull request, not a database migration.
2. **Node unlock state is derived, never stored as truth.** Recompute from prerequisites plus progress on every read. A stored graph state will drift and then silently lie.
3. **Checklist items must be numerically falsifiable.** `"My cleaned dataframe has 8,432 rows"` is acceptable. `"I understand joins"` is not. If a learner cannot be honestly wrong about an item, the item is worthless.
4. **Questions are short-answer with a reveal fold, never multiple choice.** Multiple choice tests recognition; we want recall and articulation.
5. **`struggle_events` is written from day one**, even with no code runner. It is the seed corpus for the adaptive model that comes much later.
6. **Content validation runs in CI.** A malformed prerequisite or a broken link fails the build. It must never surface as a broken graph in production.
7. **No adaptive/recommendation logic in v1.** It is useless before real usage data exists and it will eat the schedule.

---

## 3. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Server components for content-heavy pages |
| Database | Postgres (Neon) | Use DB branching for seed iteration |
| ORM | Drizzle | Readable migrations |
| Auth | Auth.js — GitHub + Google providers | No password flows to build |
| Content | MDX in `/content`, Zod-validated | Seeded into Postgres |
| Styling | Tailwind + shadcn/ui | Graph view is the only custom UI |
| Hosting | Vercel | Free tier carries the pilot |
| Package manager | pnpm | |

---

## 4. Repo structure

```
/app
  /(marketing)/page.tsx           landing
  /map/page.tsx                   phase graph — the default landed page
  /node/[slug]/page.tsx           node detail
  /profile/page.tsx               progress overview
  /api/...                        route handlers
/components
  /graph                          node map, fog, progress rings
  /node                           checklist, question fold, reflection box
  /ui                             shadcn
/content
  /phase-0/0.1-python-fundamentals.mdx
  ...
/db
  schema.ts                       drizzle schema
  migrations/
  seed.ts                         MDX -> Postgres
/lib
  content-schema.ts               zod schemas for MDX frontmatter
  progress.ts                     state derivation logic
  struggle.ts                     signal emitters
/scripts
  check-links.ts                  CI link checker
```

---

## 5. Data model

```sql
-- identity
users(id, email, name, image, entry_track, created_at)
-- entry_track: 'beginner' | 'developer' | 'practitioner'

-- seeded from /content. never hand-edited. wiped and rebuilt on seed.
nodes(id, phase, order_index, title, slug, goal, content_hash)
node_prereqs(node_id, prereq_id)
node_questions(id, node_id, prompt, answer_key, order_index)
node_checklist(id, node_id, item, order_index)

-- runtime state
node_progress(user_id, node_id, state, opened_at, completed_at,
              attempt_count, PRIMARY KEY(user_id, node_id))
checklist_state(user_id, checklist_item_id, checked, checked_at)
question_attempts(id, user_id, question_id, self_rating, revealed_at, created_at)
reflections(id, user_id, node_id, body, created_at)
artifacts(id, user_id, node_id, kind, url_or_body, created_at)
struggle_events(id, user_id, node_id, signal, value, created_at)
comments(id, user_id, node_id, parent_id, body, created_at)
```

**`node_progress.state` enum:** `hidden | fogged | open | in_progress | passed`

Derivation rules:
- `hidden` — more than one prerequisite level away from anything passed
- `fogged` — prerequisites not yet passed, but visible on the map
- `open` — all prerequisites passed, not yet started
- `in_progress` — opened, not yet passed
- `passed` — every checklist item ticked **and** every question self-rated

**`content_hash`** — hash of the MDX body. Lets you detect when a node changed under learners who already passed it, so you can flag it for review later.

**`question_attempts.self_rating`** — `got_it | partial | no_idea`, recorded *after* the reveal fold is opened. `revealed_at` before any rating is itself a struggle signal.

### Struggle signals available without a code runner

Emit these into `struggle_events`:

| Signal | Meaning |
|---|---|
| `time_to_first_check` | long gap between `opened_at` and first checklist tick |
| `revealed_before_attempt` | answer key opened with no prior reflection text |
| `node_abandoned` | opened, no activity for 14 days, not passed |
| `thin_reflection` | reflection under 20 words |
| `reopened_after_pass` | came back to a passed node — usually means it did not stick |

---

## 6. Content file schema

Path convention: `/content/phase-{n}/{id}-{slug}.mdx`

```yaml
---
id: "2.3"
phase: 2
order_index: 3
title: "Train/val/test, cross-validation, leakage"
slug: "validation-and-leakage"
prereqs: ["2.2"]
goal: "You can spot and fix data leakage before it flatters your metrics."
resources:
  primary:
    name: "scikit-learn user guide — model selection"
    url: "https://..."
    type: "docs"      # video | docs | book | course | article
    cost: "free"      # free | paid
  alt:
    name: "Hands-On ML, ch 2"
    url: "https://..."
    type: "book"
    cost: "paid"
session:
  brief: "You are given a deliberately leaky pipeline. Find and fix three leaks."
  dataset: "https://..."
  difficulty: "hard"   # easy | medium | hard
checklist:
  - "I found all three leaks"
  - "My cross-validated score DROPPED after fixing them"
  - "My CV score and held-out score now agree within 2%"
questions:
  - prompt: "Why did the score go DOWN after you fixed the pipeline?"
    answer_key: "..."
  - prompt: "Name a feature that could leak the future into training without being obviously wrong."
    answer_key: "..."
reflection_prompt: "What made the leaky version look convincing?"
struggle_signals:
  - "learner is pleased by the 0.99 score before the fix"
---

Body prose, worked examples, diagrams.
```

Validate every file with Zod at build time. Fail CI on: unknown prerequisite id, duplicate id, missing answer key, empty checklist, unreachable node (no path from any entry point).

---

## 7. Milestones

Complete each fully before starting the next. Commit at each milestone boundary.

### M0 — Skeleton
Repo init, Next.js + TypeScript, Tailwind, shadcn, Drizzle, Neon connection, Auth.js with GitHub + Google, deploy to Vercel with one placeholder page.

**Done when:** you can log in on the live Vercel URL and see your name.

### M1 — Content pipeline
MDX loader, Zod schemas, `pnpm seed` populating `nodes`, `node_prereqs`, `node_questions`, `node_checklist`. Write **three real nodes**: `0.1` (easy), `0.3` (messy), `2.3` (hardest). Those three are chosen deliberately to stress the schema — a simple node alone will hide gaps.

**Done when:** editing an MDX file and re-running seed changes what the DB returns.

### M2 — Node page
`/node/[slug]` renders everything: goal, both resources, session brief, checklist (non-persistent), questions with reveal fold, reflection box (non-persistent). No auth gating yet.

**Done when:** someone could genuinely learn from node 0.3 with the DB read-only.

### M3 — Progress and gating
State derivation in `lib/progress.ts`, checklist persistence, question self-rating, pass condition, prerequisite unlocking, `struggle_events` emitters.

**Done when:** passing 0.1 on a fresh second account unlocks 0.2, and 2.3 stays fogged.

### M4 — Graph view
`/map` as the default landing page for logged-in users. Nodes grouped by phase, fog on locked, progress ring per phase, "resume where you left off." Entry-track picker on first login sets the start node: beginner → 0.1, developer → 1.1, practitioner → 3.1.

**Done when:** the map is the page you would want to land on.

### M5 — Content fill
The remaining 37 nodes (full list in Appendix A). Every URL fetched and confirmed live. Every checklist item numerically falsifiable. Every answer key written properly, not stubbed.

**This is the longest milestone by a wide margin.** Write in phase order. Do not let M6 jump the queue.

**Done when:** zero TODOs in `/content` and the link-check CI job is green.

### M6 — Social layer
Per-node comments, optional public reflections, capstone peer review flow for node 7.1.

**Done when:** two accounts can hold a threaded discussion on node 2.3.

### M7 — Pilot
Onboard 3 to 5 real learners. Weekly check-ins. Watch `struggle_events` rather than asking people how it is going.

**Done when:** one person completes all of phase 0 without needing to be unblocked directly.

### M8 — Execution runtime
Pyodide in-browser for phases 0 through 3, starting with the three nodes where self-verification is least trustworthy: **2.3 (leakage), 4.1 (micrograd), 4.3 (overfit-one-batch)**. A learner who is wrong on those three usually does not know it.

Phase 4 onward will need a local CLI runner instead — Pyodide cannot carry PyTorch and learners need their own GPU at that point anyway.

**Do not start M8 before M7 proves people actually reach these nodes.**

---

## 8. Risks

**Content stalls at M5.** By far the most likely failure. Mitigation: ship publicly at the end of phase 1 with an honest "phases 0–1 available now" banner. A live partial roadmap beats a private complete one that never launches.

**Link rot.** Weekly CI link check. `resources.alt` is required on every node, never optional.

**Self-verification inflation.** People tick boxes they did not earn. This is why checklist items must be numeric, and part of why M8 exists.

**Scope creep toward the adaptive model.** Keep it out of v1 entirely.

---

## 9. Kill criteria

If M7 shows nobody finishes phase 0, the problem is content or motivation, not features. Stop building, go watch someone use it in person.

---

## Appendix A — The 40 nodes

Format: `id — title [prereqs]`

### Phase 0 — Tooling floor
- `0.1` — Python fundamentals `[]`
- `0.2` — Numpy and vectorized thinking `[0.1]`
- `0.3` — Pandas `[0.2]`
- `0.4` — Notebooks, environments, git `[0.1]`
- `0.5` — Plotting to see, not to decorate `[0.3]`

### Phase 1 — Math on demand
- `1.1` — Linear algebra intuition `[0.2]`
- `1.2` — Derivatives and the chain rule `[1.1]`
- `1.3` — Probability and distributions `[0.2]`
- `1.4` — Statistical inference and the p-value trap `[1.3]`
- `1.5` — Optimization: gradient descent by hand `[1.2]`

### Phase 2 — Supervised learning
- `2.1` — Framing an ML problem `[0.5, 1.5]`
- `2.2` — Linear and logistic regression `[1.5, 2.1]`
- `2.3` — Train/val/test, cross-validation, leakage `[2.2]`
- `2.4` — Metrics that match the problem `[2.3]`
- `2.5` — Decision trees and random forests `[2.3]`
- `2.6` — Gradient boosting `[2.5]`
- `2.7` — Model diagnosis: bias, variance, error analysis `[2.6]`

### Phase 3 — Unsupervised and feature work
- `3.1` — Feature engineering `[2.3]`
- `3.2` — Encoding and scaling `[3.1]`
- `3.3` — Clustering `[3.1]`
- `3.4` — Dimensionality reduction `[1.1, 3.3]`
- `3.5` — Anomaly detection `[3.3]`

### Phase 4 — Deep learning
- `4.1` — Why nets, and tensors (build micrograd) `[2.7]`
- `4.2` — MLP from scratch, then in PyTorch `[4.1]`
- `4.3` — Training dynamics `[4.2]`
- `4.4` — CNNs `[4.3]`
- `4.5` — Sequences and attention `[4.3]`
- `4.6` — Embeddings `[4.5]`

### Phase 5 — Applied LLM
- `5.1` — Using LLM APIs properly `[4.6]`
- `5.2` — Vector search and retrieval `[4.6]`
- `5.3` — RAG end to end `[5.1, 5.2]`
- `5.4` — Evaluating LLM systems `[5.3]`
- `5.5` — Agents and tool use `[5.4]`

### Phase 6 — Ship it
- `6.1` — Serving a model `[2.6]`
- `6.2` — Containerize and deploy `[6.1]`
- `6.3` — Experiment tracking and model registry `[2.7]`
- `6.4` — Pipelines and retraining `[6.3]`
- `6.5` — Monitoring and drift `[6.2, 6.4]`
- `6.6` — The system view `[6.5]`

### Phase 7 — Capstone
- `7.1` — Own problem, own data, shipped `[6.6]`

Capstone requirements: a self-sourced dataset, a baseline that was beaten, a hand-written eval set, a deployed endpoint, a monitoring dashboard, and a README explaining what they would do with ten times the data. Peer reviewed.

---

## Appendix B — Node content notes

Detail carried over from planning, to be expanded during M5.

**0.3 Pandas** — session is a deliberately messy CSV: mixed date formats, duplicate keys, numbers stored as strings, trailing whitespace. Checklist must include the exact post-dedup row count. Common wall: silent row explosion on merge.

**1.4 Inference** — session runs 100 A/A tests and counts false positives, expecting roughly 5% at alpha 0.05. This node exists to inoculate against p-hacking, so the reflection prompt matters more than the code.

**1.5 Gradient descent** — must include an intentional divergence run at a learning rate of 10, and the checklist should confirm the learner observed it. Common wall: not normalizing features, then blaming the algorithm.

**2.3 Leakage** — the highest-value node in the roadmap. Three planted leaks: target encoding applied before the split, scaler fit on the full dataset, and a feature computed from future data. The key struggle signal is a learner who is *pleased* by the pre-fix score.

**2.4 Metrics** — learner must identify the metric under which a majority-class-always classifier appears to win.

**3.1 Feature engineering** — RFM features on transactional data, with the leakage discipline from 2.3 carried forward across the cutoff date.

**3.4 Dimensionality reduction** — checklist must enforce that t-SNE output is used only for visualization, never as model input.

**4.1 Micrograd** — build the autograd engine from scratch, then verify gradients against the gradient-check helper written back in node 1.2. Explicitly not skippable.

**4.3 Training dynamics** — the overfit-one-batch discipline is the point. Checklist requires single-batch loss below 1e-3 before full training is attempted.

**5.1 LLM APIs** — session compares a prompted classifier against the gradient boosting model from 2.6 on the same data. The intended conclusion is often that the LLM is the wrong tool.

**5.4 LLM evals** — the deliverable is a hand-labeled 50-case eval set. Synthetic or model-generated eval sets do not count and the checklist should say so plainly.

**6.4 Retraining** — the pipeline must *refuse* to promote a model that fails the gate, and the checklist verifies this by deliberately feeding it a worse model.
