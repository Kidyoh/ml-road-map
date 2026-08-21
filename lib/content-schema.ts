/**
 * Zod schemas for MDX frontmatter, mirroring section 6 of the build plan.
 *
 * This is the contract that keeps a malformed node out of production. Anything
 * that would surface as a broken graph should fail here first, in CI
 * (non-negotiable 6).
 */
import { z } from "zod";

export const RESOURCE_TYPES = [
  "video",
  "docs",
  "book",
  "course",
  "article",
] as const;

export const RESOURCE_COSTS = ["free", "paid"] as const;

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

/** Content ids look like "0.1" or "2.3". Phase, dot, index. */
export const NODE_ID_PATTERN = /^\d+\.\d+$/;

const nonEmpty = (label: string) =>
  z.string().trim().min(1, `${label} must not be empty`);

export const resourceSchema = z.strictObject({
  name: nonEmpty("resource name"),
  url: z.url("resource url must be an absolute URL"),
  type: z.enum(RESOURCE_TYPES),
  cost: z.enum(RESOURCE_COSTS),
});

export const sessionSchema = z.strictObject({
  brief: nonEmpty("session brief"),
  /**
   * Optional: not every session needs a file. Local paths under /datasets are
   * allowed alongside absolute URLs so generated datasets can be referenced
   * without hardcoding a host.
   */
  dataset: z
    .union([z.url(), z.string().regex(/^\/datasets\/[\w.\-/]+$/)])
    .optional(),
  difficulty: z.enum(DIFFICULTIES),
});

export const questionSchema = z.strictObject({
  prompt: nonEmpty("question prompt"),
  /**
   * Never optional, never a stub. A question with no answer key is a question
   * the learner cannot check themselves, which is the whole point of the fold.
   */
  answer_key: nonEmpty("answer_key")
    .refine(
      (value) => !/^\s*(TODO|TBD|FIXME|\.\.\.)\s*$/i.test(value),
      "answer_key is a stub - write the real answer",
    )
    .refine(
      (value) => value.trim().split(/\s+/).length >= 10,
      "answer_key is under 10 words - almost certainly not a real answer",
    ),
});

export const NODE_STATUSES = ["planned", "published"] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

/** Every node carries these, written or not. This is what the map draws. */
const baseFields = {
  id: z.string().regex(NODE_ID_PATTERN, 'id must look like "2.3"'),
  phase: z.number().int().min(0).max(7),
  order_index: z.number().int().min(1),
  title: nonEmpty("title"),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case"),
  prereqs: z.array(z.string().regex(NODE_ID_PATTERN)).default([]),
  /** Stated as a capability the learner will have, not a topic they will cover. */
  goal: nonEmpty("goal"),
};

/**
 * A node nobody has written yet. It exists so the graph is complete from day
 * one - the learner is meant to see the shape of the road ahead, and a map
 * missing most of its nodes shows the shape of nothing.
 *
 * It deliberately has no checklist and no questions, which means the pass
 * condition can never be satisfied for it. That is the honest outcome: this part
 * of the roadmap is not finished.
 */
export const plannedNodeSchema = z
  .object({
    ...baseFields,
    status: z.literal("planned"),
    /** Free-form planning notes carried over from Appendix B. Not learner-facing. */
    notes: z.string().optional(),
  })
  .strict();

/** A node that is finished, and held to the full standard. */
export const publishedNodeSchema = z
  .object({
    ...baseFields,
    status: z.literal("published"),
    resources: z.object({
      primary: resourceSchema,
      /**
       * Required, never optional. Section 8 lists link rot as a named risk and
       * makes `alt` the mitigation - an optional alt is not a mitigation.
       */
      alt: resourceSchema,
    }),
    session: sessionSchema,
    /**
     * Non-negotiable 3: every item must be something the learner can be
     * honestly wrong about. Enforced structurally below.
     */
    checklist: z.array(nonEmpty("checklist item")).min(1, "checklist is empty"),
    questions: z.array(questionSchema).min(1, "node has no questions"),
    reflection_prompt: nonEmpty("reflection_prompt"),
    /** Author notes on what failure looks like here. Feeds M8 and the pilot. */
    struggle_signals: z.array(z.string()).default([]),
  })
  .strict();

export const nodeFrontmatterSchema = z.discriminatedUnion("status", [
  plannedNodeSchema,
  publishedNodeSchema,
]);

export type PlannedNode = z.infer<typeof plannedNodeSchema>;
export type PublishedNode = z.infer<typeof publishedNodeSchema>;
export type NodeFrontmatter = PlannedNode | PublishedNode;
export type Resource = z.infer<typeof resourceSchema>;
export type NodeQuestion = z.infer<typeof questionSchema>;

export function isPublished(node: NodeFrontmatter): node is PublishedNode {
  return node.status === "published";
}

/**
 * Words that show up when a checklist item drifts from "verify this number"
 * back toward "did you feel like you learned it".
 */
const VAGUE_CHECKLIST_PATTERNS = [
  /\bi understand\b/i,
  /\bi learned\b/i,
  /\bi (?:am|feel) (?:comfortable|confident)\b/i,
  /\bi know (?:what|how|why)\b/i,
  /\bi read\b/i,
  /\bi watched\b/i,
];

/**
 * A weak proxy for non-negotiable 3, kept deliberately weak. It catches the
 * obvious regressions ("I understand joins") without pretending it can tell a
 * genuinely falsifiable item from a plausible-sounding one. That judgement
 * stays with the author; this just stops the worst of it reaching CI green.
 */
export function auditChecklistItem(item: string): string | null {
  for (const pattern of VAGUE_CHECKLIST_PATTERNS) {
    if (pattern.test(item)) {
      return `"${item}" states a feeling, not a fact. Give it a number or an observable outcome.`;
    }
  }
  return null;
}
