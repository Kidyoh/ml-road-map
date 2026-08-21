/**
 * Full data model from ML_ROADMAP_BUILD_PLAN.md section 5.
 *
 * Three groups of tables, and the line between them matters:
 *
 *   1. Auth.js adapter tables - owned by @auth/drizzle-adapter, shape is fixed.
 *   2. Content tables - seeded from /content MDX. Primary keys are DERIVED FROM
 *      CONTENT (node "2.3", checklist "2.3:c:0", question "2.3:q:1") so that
 *      `pnpm seed` is an idempotent upsert rather than a truncate. The spec says
 *      "wiped and rebuilt"; a literal wipe would cascade-delete every learner's
 *      checklist_state on any content edit, so we keep the reproducibility and
 *      drop the data loss.
 *   3. Runtime tables - written by the app, never by seed.
 *
 * Only checklist items and questions get DB rows on the content side, because
 * only they have runtime state hanging off them. Resources, session brief and
 * reflection prompt are read from MDX frontmatter at render time - git stays the
 * source of truth for anything no foreign key points at.
 */
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

/* ------------------------------------------------------------------ enums */

export const entryTrackEnum = pgEnum("entry_track", [
  "beginner",
  "developer",
  "practitioner",
]);

/** node_progress.state. Derived on every read, never trusted as stored truth. */
export const nodeStateEnum = pgEnum("node_state", [
  "hidden",
  "fogged",
  "open",
  "in_progress",
  "passed",
]);

/** question_attempts.self_rating, recorded *after* the reveal fold opens. */
export const selfRatingEnum = pgEnum("self_rating", [
  "got_it",
  "partial",
  "no_idea",
]);

/** "Struggle signals available without a code runner" from section 5. */
export const struggleSignalEnum = pgEnum("struggle_signal", [
  "time_to_first_check",
  "revealed_before_attempt",
  "node_abandoned",
  "thin_reflection",
  "reopened_after_pass",
]);

export const artifactKindEnum = pgEnum("artifact_kind", [
  "link",
  "notebook",
  "repo",
  "text",
]);

/**
 * Whether a node has been written yet.
 *
 * All 40 nodes from Appendix A exist in /content from the start, because the map
 * is meaningless with only the handful that are finished - a learner is supposed
 * to "see the shape of the road ahead" (non-negotiable 3 on fogging), and you
 * cannot see the shape of a graph that is missing 37 of its vertices.
 *
 * A `planned` node carries only its title, goal and prerequisites. It has no
 * checklist and no questions, so it can never be passed, which is honest: the
 * roadmap really is incomplete. M5 turns them into `published` one at a time.
 */
export const nodeStatusEnum = pgEnum("node_status", ["planned", "published"]);

/* --------------------------------------------------------- 1. auth tables */

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", {
    mode: "date",
    withTimezone: true,
  }),
  image: text("image"),
  // Set by the entry-track picker on first login (M4): beginner -> 0.1,
  // developer -> 1.1, practitioner -> 3.1. Null until then.
  entryTrack: entryTrackEnum("entry_track"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/* ------------------------------------------------------ 2. content tables */

export const nodes = pgTable("nodes", {
  /** The content id from frontmatter, e.g. "2.3". Stable across reseeds. */
  id: text("id").primaryKey(),
  phase: integer("phase").notNull(),
  orderIndex: integer("order_index").notNull(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  goal: text("goal").notNull(),
  status: nodeStatusEnum("status").notNull().default("published"),
  /**
   * SHA-256 of the MDX body. Lets us detect that a node changed under learners
   * who already passed it, so it can be flagged for review later.
   */
  contentHash: text("content_hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const nodePrereqs = pgTable(
  "node_prereqs",
  {
    nodeId: text("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    prereqId: text("prereq_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.nodeId, t.prereqId] })],
);

export const nodeQuestions = pgTable(
  "node_questions",
  {
    /** Deterministic: `${nodeId}:q:${orderIndex}`. */
    id: text("id").primaryKey(),
    nodeId: text("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    answerKey: text("answer_key").notNull(),
    orderIndex: integer("order_index").notNull(),
  },
  (t) => [
    uniqueIndex("node_questions_node_order_idx").on(t.nodeId, t.orderIndex),
  ],
);

export const nodeChecklist = pgTable(
  "node_checklist",
  {
    /** Deterministic: `${nodeId}:c:${orderIndex}`. */
    id: text("id").primaryKey(),
    nodeId: text("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    item: text("item").notNull(),
    orderIndex: integer("order_index").notNull(),
  },
  (t) => [
    uniqueIndex("node_checklist_node_order_idx").on(t.nodeId, t.orderIndex),
  ],
);

/* ------------------------------------------------------ 3. runtime tables */

export const nodeProgress = pgTable(
  "node_progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nodeId: text("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    /**
     * Cached only. Unlock state is DERIVED on every read from prerequisites
     * plus progress (non-negotiable 2). Never read this column as authority for
     * hidden/fogged/open - those are a function of the whole graph.
     */
    state: nodeStateEnum("state").notNull().default("open"),
    /** First ever open. Never overwritten - `time_to_first_check` measures from here. */
    openedAt: timestamp("opened_at", { withTimezone: true }),
    /**
     * Most recent open. Rendering a page is not a user action - Next may render
     * it several times per visit - so this is what distinguishes a genuine
     * return visit from a refresh. Without it, `attempt_count` counts reloads
     * and `reopened_after_pass` fires on every render.
     */
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.nodeId] })],
);

export const checklistState = pgTable(
  "checklist_state",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    checklistItemId: text("checklist_item_id")
      .notNull()
      .references(() => nodeChecklist.id, { onDelete: "cascade" }),
    checked: boolean("checked").notNull().default(false),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.checklistItemId] })],
);

export const questionAttempts = pgTable("question_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  questionId: text("question_id")
    .notNull()
    .references(() => nodeQuestions.id, { onDelete: "cascade" }),
  /**
   * The learner's own short answer, written before the fold opens. Not in the
   * section 5 column list, but non-negotiable 4 wants recall and articulation -
   * without somewhere to put the typed answer the textarea is decorative, and
   * `revealed_before_attempt` has nothing to test against.
   */
  response: text("response"),
  /** Recorded *after* revealing. Null means revealed but never rated. */
  selfRating: selfRatingEnum("self_rating"),
  /** Set before any rating, this is itself a struggle signal. */
  revealedAt: timestamp("revealed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const reflections = pgTable("reflections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  nodeId: text("node_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  /** Opt-in for the M6 social layer. Private by default. */
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const artifacts = pgTable("artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  nodeId: text("node_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  kind: artifactKindEnum("kind").notNull(),
  urlOrBody: text("url_or_body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Non-negotiable 5: written from day one, even with no code runner. This is the
 * seed corpus for the adaptive model that comes much later. Emitters live in
 * lib/struggle.ts; call sites land in M3.
 */
export const struggleEvents = pgTable("struggle_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  nodeId: text("node_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  signal: struggleSignalEnum("signal").notNull(),
  /** Signal-specific magnitude: seconds, word count. Null where unitless. */
  value: real("value"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const comments = pgTable("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  nodeId: text("node_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, {
    onDelete: "cascade",
  }),
  /**
   * Set when this comment is a peer review of a capstone submission rather than
   * general discussion of the node. Node 7.1 requires a review, so reviews need
   * to attach to the thing being reviewed - the node id alone cannot say which
   * of several submissions a comment is about.
   */
  artifactId: uuid("artifact_id").references(() => artifacts.id, {
    onDelete: "cascade",
  }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
