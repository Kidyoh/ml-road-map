# ML Roadmap

An interactive, gated roadmap for learning machine learning from zero to a
deployed system — 40 nodes across 8 phases. The full specification lives in
[docs/ML_ROADMAP_BUILD_PLAN.md](docs/ML_ROADMAP_BUILD_PLAN.md); read it before
changing anything, especially section 2.

**Current state: M0–M6 complete.** Auth, the content pipeline, node pages,
progress persistence with prerequisite gating, the map, the profile page, all
40 nodes written, and the social layer.

What is left is not code. **M7** is a pilot — onboard 3 to 5 real learners and
watch `struggle_events` rather than asking them how it is going. **M8** is the
in-browser execution runtime, and the plan is explicit that it must not start
before M7 proves people actually reach nodes 2.3, 4.1 and 4.3.

## Setup

```bash
pnpm install
cp .env.example .env.local     # then fill it in — see the comments in the file
pnpm db:migrate
pnpm seed
pnpm dev
```

You need a [Neon](https://neon.tech) Postgres database and, for login, a GitHub
and/or Google OAuth app. `.env.example` has the exact callback URLs to register.

## How content works

Content lives in git as MDX (non-negotiable 1). Runtime state lives in Postgres.
Fixing a dead link is a pull request, not a migration.

```
content/phase-{n}/{id}-{slug}.mdx
```

Frontmatter is Zod-validated against [lib/content-schema.ts](lib/content-schema.ts).
`pnpm seed` pushes node structure — checklist items and questions — into
Postgres, because M3 needs stable row ids to hang learner state off. Everything
else (resources, session brief, reflection prompt, body prose) is read from disk
at render time and never enters the database.

### Seed is an upsert, not a wipe

The build plan says the content tables are "wiped and rebuilt on seed". Taken
literally that cascade-deletes every learner's `checklist_state` and
`question_attempts` on any content edit, because those carry foreign keys into
`node_checklist` and `node_questions`.

Instead, primary keys are derived from content — node `2.3`, checklist item
`2.3:c:0`, question `2.3:q:1` — so seed is idempotent and the database stays
reproducible from git, without the data loss. **One consequence to know:**
reordering a checklist item moves an existing tick to whatever now sits at that
position. Appending is free; reordering is not.

`pnpm check:seed-survival` is an executable proof of that property: `--setup`
creates a throwaway user with a ticked box, a rated question and a progress row;
re-seed; `--check` reports whether they survived; `--cleanup` removes them. Run
it if you ever change how seed writes.

### content_hash covers frontmatter, not just the body

The build plan calls `content_hash` a "hash of the MDX body", but its stated job
is detecting that a node changed under learners who already passed it — and a
changed checklist item or answer key matters more to such a learner than a
reworded paragraph. Body-only hashing also made `pnpm seed` report a node as
`unchanged` immediately after writing a frontmatter edit. So it hashes the whole
file, with line endings normalised so a Windows checkout and Linux CI agree.

### Planned nodes, and why all 40 exist

Every node in Appendix A has an MDX file from the start. Most carry
`status: "planned"` — a title, a goal and prerequisites, nothing else.

This is a deviation from writing them in phase order, and it buys three things.
The map shows the whole graph rather than three disconnected nodes, which is the
point of fogging rather than hiding. Every prerequisite resolves, so
`pnpm validate:content --strict` passes today instead of at M5, and CI runs it.
And M5 becomes "flip planned to published", not "create 37 files".

A planned node has no checklist, so it can never be passed and nothing behind it
unlocks. That is the honest outcome — the roadmap really is 3 of 40 done.

```bash
pnpm validate:content            # dangling prereqs are warnings
pnpm validate:content --strict   # ...and unreachable nodes are errors. CI uses this.
pnpm scaffold:planned            # write any Appendix A node missing from /content
```

## Datasets

Session datasets are generated, not downloaded:

```bash
pnpm gen:datasets
```

Checklist items must be numerically falsifiable (non-negotiable 3) — "my
dataframe has 8,432 rows", not "I understand joins". That only works if the true
number is known, so [scripts/gen-datasets.ts](scripts/gen-datasets.ts) builds the
data from a seeded PRNG and prints the ground truth to paste into the MDX. CI
re-runs the generator and fails if `public/datasets` has drifted.

If you change the generator, re-run it **and update the checklists**, or they
start lying to learners.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm typecheck` | `next typegen` then `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm validate:content` | Frontmatter, duplicate ids, cycles, reachability |
| `pnpm seed` | MDX → Postgres (`--dry-run` to preview) |
| `pnpm check:links` | Every resource URL (`--verbose` to list all) |
| `pnpm gen:datasets` | Rebuild `public/datasets` and print ground truth |
| `pnpm check:seed-survival` | Prove a re-seed does not destroy learner progress |
| `pnpm check:gating` | Assert M3's done-condition: passing 0.1 unlocks 0.2 |
| `pnpm check:locking` | Assert locked content never reaches the browser |
| `pnpm check:social` | Assert M6's done-condition: a threaded discussion on 2.3 |
| `pnpm scaffold:planned` | Create MDX for any Appendix A node not on disk |
| `pnpm db:generate` | New Drizzle migration from schema changes |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Drizzle Studio |

## Layout

```
app/(marketing)/     landing + sign-in
app/map/             the phase graph
app/profile/         activity, progress over time, per-phase breakdown
app/node/[slug]/     node detail page
app/actions/         server actions - every learner write goes through here
components/graph/    node tiles, phase rings, entry-track picker, start-here
components/node/     checklist, question fold, reflection box, MDX styling
components/profile/  activity heatmap, step chart, phase bars
components/social/   comment thread, public reflections, capstone review
content/             the roadmap itself
db/                  schema, migrations, seed
lib/                 content, auth, progress, activity, social, struggle signals
scripts/             validation, link check, datasets, executable checks
```

## The social layer

Three visibility rules, all enforced server-side because a rule that only
exists in a component is a rule anyone can walk around.

- **Discussion follows the content lock.** A thread on node 2.3 is a list of its
  three leaks, so it is not readable by anyone who has not unlocked 2.3.
- **Published reflections need an *earned* pass.** Not an unlock, and
  specifically not an entry track's assumed pass — a practitioner who skipped
  2.3 has claimed prior knowledge, not done the session. Reading how others
  answered the prompt is the reward for answering it yourself.
- **Comments are deletable only by their author**, and replies cascade.

Threading is one level deep, enforced on both sides. Node 7.1's capstone panel
hands reviewers the node's own checklist as a rubric, because "looks good" is
not a review.

## Progress views

`/profile` shows an activity heatmap, cumulative nodes passed as a step chart,
and per-phase bars. Deliberately descriptive: **no streaks and no targets.** A
streak is a direct incentive to tick a checklist item you did not earn in order
to keep a number alive, and section 8 names self-verification inflation as a
live risk. The page says so in as many words.

## How gating works

[lib/progress.ts](lib/progress.ts) derives every node's state on every read.
Nothing about the graph is stored (non-negotiable 2) — `node_progress.state` is
a cache of the learner's own activity, never authority for hidden/fogged/open.

- **passed** — every checklist item ticked AND every question self-rated.
  A node with no checklist can never be passed, which is what stops the 37
  planned nodes from being vacuously complete.
- **open / in_progress** — every prerequisite passed.
- **fogged** — one level of unpassed prerequisites out.
- **hidden** — further than that. Still rendered, just dimmer: locked nodes are
  fogged, not hidden entirely.

### What a locked node shows

Its id, title, goal, difficulty, both resources, and a linked list of what to
pass first. Withheld: the body prose, the session brief, the checklist, the
questions and the answer keys.

The line is drawn there for two reasons. Non-negotiable 4 wants recall and
articulation, and reading an answer key before ever attempting the question
destroys the only thing the reveal fold is for. And section 8 names
self-verification inflation as a live risk — studying the checkpoint for a node
you have not earned makes it easier to tick boxes you did not earn. Resources
are public links to other people's work, so hoarding them would be pointless.

**Enforced on the server.** A locked page never queries the checklist or
questions and never compiles the MDX body, so none of it enters the payload —
the lock survives view-source. The write actions run `assertNodeUnlocked` before
touching anything, because server actions are callable directly.

**The lock applies signed-out too.** If "not signed in" meant "unlocked", a
private window would defeat it entirely. Signed out, nothing is passed, so only
the entry points are readable — which still lets someone see what node 0.1 is
actually like before making an account.

`pnpm check:locking` asserts all of this against the running dev server.

Entry tracks mark the *transitive prerequisites* of their start node as passed
and nothing else. "Developer" starting at 1.1 asserts 0.1 and 0.2; it says
nothing about 0.4, which stays open as normal.

`pnpm check:gating` asserts all of this against the live database.

## Notes for whoever builds M5

- `lib/signals.ts` holds the struggle-signal vocabulary with no DB import, so
  client components can use it. `lib/struggle.ts` is the server-side writer.
- `question_attempts.response` is not in the spec's column list. It holds the
  learner's short answer, without which the textarea is decorative and
  `revealed_before_attempt` has nothing to test against.
- `node_progress.last_opened_at` is not in the spec either. Page renders are not
  user actions and Next runs them more than once per visit, so without it
  `attempt_count` counts refreshes and `reopened_after_pass` fires on every
  render. A visit is new after a 30-minute gap.
- To write a node: change `status` to `"published"`, add resources, session,
  checklist, questions and a reflection prompt, delete `notes`, then `pnpm seed`.
  The validator will tell you what is missing.

## Gotchas found the hard way

- **MDX needs `remark-gfm`.** Without it, pipe tables render as literal pipe
  characters. Nodes 0.3 and 2.3 both carry load-bearing tables, so it is wired
  into [components/node/mdx-body.tsx](components/node/mdx-body.tsx).
- **`next build` needs a reachable database.** Node pages are statically
  prerendered, so the build queries Postgres. That is fine on Vercel, but it is
  why CI runs typecheck, lint and content validation instead of a full build.
- **Dark mode needs the provider.** `globals.css` defines a `.dark` palette but
  nothing applies the class on its own; [components/theme-provider.tsx](components/theme-provider.tsx)
  does.
