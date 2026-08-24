import "server-only";

/**
 * Admin access and the aggregations behind the panel.
 *
 * Admins are designated by email in ADMIN_EMAILS, not by a database column.
 * That is deliberate: there is no code path in the application that can grant
 * admin, so no bug can escalate a learner into one, and the list is visible in
 * the deployment config rather than buried in a row somebody has to go and
 * look up. Changing it is a redeploy, which for a handful of people is correct.
 */
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  checklistState,
  nodeChecklist,
  nodeProgress,
  nodeQuestions,
  nodes,
  questionAttempts,
  reflections,
  struggleEvents,
  users,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { adminEmails, isAdminEmail } from "@/lib/admin-emails";

export { isAdminEmail };

/**
 * Throws unless the caller is an admin. Every admin page and action calls this
 * first - the panel is not protected by being at an unlinked URL.
 */
export async function requireAdmin() {
  const session = await auth();
  const email = session?.user?.email;
  if (!isAdminEmail(email)) {
    throw new Error("Not authorised");
  }
  return { userId: session!.user.id, email: email! };
}

export async function adminIsConfigured(): Promise<boolean> {
  return adminEmails().length > 0;
}

/* ------------------------------------------------------------------ types */

export type NodeFunnelRow = {
  id: string;
  phase: number;
  title: string;
  slug: string;
  opened: number;
  passed: number;
  /** Checklist ticks recorded against this node, across all learners. */
  ticks: number;
  checklistTotal: number;
};

export type LearnerRow = {
  id: string;
  name: string | null;
  email: string | null;
  entryTrack: string | null;
  createdAt: Date;
  nodesOpened: number;
  nodesPassed: number;
  ticks: number;
  answers: number;
  reflections: number;
  struggles: number;
  lastActiveAt: Date | null;
};

export type StruggleRow = {
  id: string;
  signal: string;
  value: number | null;
  createdAt: Date;
  nodeId: string;
  nodeTitle: string;
  userId: string;
  userName: string | null;
};

/* ------------------------------------------------------------ aggregates */

/*
 * These use grouped queries merged in JavaScript rather than correlated
 * subqueries. Drizzle renders an interpolated column unqualified inside a `sql`
 * template, so `where ${nodeProgress.userId} = ${users.id}` becomes
 * `where "user_id" = "id"` - and inside a subquery over a table that has its
 * own `id` column, that binds to the wrong one. It failed loudly here
 * (text = uuid) and would have failed silently on a table whose id happened to
 * be text. Not worth the risk for aggregates over a handful of rows.
 */

async function countBy<T extends string>(
  rows: { key: T | null; n: number }[],
): Promise<Map<T, number>> {
  const map = new Map<T, number>();
  for (const r of rows) if (r.key !== null) map.set(r.key, r.n);
  return map;
}

/**
 * Where people stop. This is the view the build plan's kill criterion needs -
 * "if M7 shows nobody finishes phase 0, the problem is content or motivation".
 *
 * Uses node_progress.completed_at rather than re-deriving each learner's graph.
 * That column is maintained on every write and is accurate for "did this person
 * complete this node"; the derived states answer the different question of what
 * is unlocked right now.
 */
export async function nodeFunnel(): Promise<NodeFunnelRow[]> {
  const [allNodes, opened, passed, ticks, totals] = await Promise.all([
    db
      .select({
        id: nodes.id,
        phase: nodes.phase,
        title: nodes.title,
        slug: nodes.slug,
        orderIndex: nodes.orderIndex,
      })
      .from(nodes)
      .orderBy(nodes.phase, nodes.orderIndex),

    db
      .select({ key: nodeProgress.nodeId, n: sql<number>`count(*)::int` })
      .from(nodeProgress)
      .where(isNotNull(nodeProgress.openedAt))
      .groupBy(nodeProgress.nodeId),

    db
      .select({ key: nodeProgress.nodeId, n: sql<number>`count(*)::int` })
      .from(nodeProgress)
      .where(isNotNull(nodeProgress.completedAt))
      .groupBy(nodeProgress.nodeId),

    db
      .select({ key: nodeChecklist.nodeId, n: sql<number>`count(*)::int` })
      .from(checklistState)
      .innerJoin(nodeChecklist, eq(nodeChecklist.id, checklistState.checklistItemId))
      .where(eq(checklistState.checked, true))
      .groupBy(nodeChecklist.nodeId),

    db
      .select({ key: nodeChecklist.nodeId, n: sql<number>`count(*)::int` })
      .from(nodeChecklist)
      .groupBy(nodeChecklist.nodeId),
  ]);

  const openedBy = await countBy(opened);
  const passedBy = await countBy(passed);
  const ticksBy = await countBy(ticks);
  const totalBy = await countBy(totals);

  return allNodes.map((n) => ({
    id: n.id,
    phase: n.phase,
    title: n.title,
    slug: n.slug,
    opened: openedBy.get(n.id) ?? 0,
    passed: passedBy.get(n.id) ?? 0,
    ticks: ticksBy.get(n.id) ?? 0,
    checklistTotal: totalBy.get(n.id) ?? 0,
  }));
}

export async function learners(): Promise<LearnerRow[]> {
  const [people, opened, passed, ticks, answered, written, struggled, lastOpen, lastTick, lastAnswer] =
    await Promise.all([
      db.select().from(users).orderBy(desc(users.createdAt)),

      db
        .select({ key: nodeProgress.userId, n: sql<number>`count(*)::int` })
        .from(nodeProgress)
        .where(isNotNull(nodeProgress.openedAt))
        .groupBy(nodeProgress.userId),

      db
        .select({ key: nodeProgress.userId, n: sql<number>`count(*)::int` })
        .from(nodeProgress)
        .where(isNotNull(nodeProgress.completedAt))
        .groupBy(nodeProgress.userId),

      db
        .select({ key: checklistState.userId, n: sql<number>`count(*)::int` })
        .from(checklistState)
        .where(eq(checklistState.checked, true))
        .groupBy(checklistState.userId),

      db
        .select({ key: questionAttempts.userId, n: sql<number>`count(*)::int` })
        .from(questionAttempts)
        .groupBy(questionAttempts.userId),

      db
        .select({ key: reflections.userId, n: sql<number>`count(*)::int` })
        .from(reflections)
        .groupBy(reflections.userId),

      db
        .select({ key: struggleEvents.userId, n: sql<number>`count(*)::int` })
        .from(struggleEvents)
        .groupBy(struggleEvents.userId),

      db
        .select({ key: nodeProgress.userId, at: sql<Date | null>`max(${nodeProgress.lastOpenedAt})` })
        .from(nodeProgress)
        .groupBy(nodeProgress.userId),

      db
        .select({ key: checklistState.userId, at: sql<Date | null>`max(${checklistState.checkedAt})` })
        .from(checklistState)
        .groupBy(checklistState.userId),

      db
        .select({ key: questionAttempts.userId, at: sql<Date | null>`max(${questionAttempts.createdAt})` })
        .from(questionAttempts)
        .groupBy(questionAttempts.userId),
    ]);

  const openedBy = await countBy(opened);
  const passedBy = await countBy(passed);
  const ticksBy = await countBy(ticks);
  const answeredBy = await countBy(answered);
  const writtenBy = await countBy(written);
  const struggledBy = await countBy(struggled);

  const latest = new Map<string, number>();
  for (const set of [lastOpen, lastTick, lastAnswer]) {
    for (const row of set) {
      if (!row.key || !row.at) continue;
      const t = new Date(row.at).getTime();
      if (t > (latest.get(row.key) ?? 0)) latest.set(row.key, t);
    }
  }

  return people.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    entryTrack: u.entryTrack,
    createdAt: u.createdAt,
    nodesOpened: openedBy.get(u.id) ?? 0,
    nodesPassed: passedBy.get(u.id) ?? 0,
    ticks: ticksBy.get(u.id) ?? 0,
    answers: answeredBy.get(u.id) ?? 0,
    reflections: writtenBy.get(u.id) ?? 0,
    struggles: struggledBy.get(u.id) ?? 0,
    lastActiveAt: latest.has(u.id) ? new Date(latest.get(u.id)!) : null,
  }));
}

export async function recentStruggles(limit = 100): Promise<StruggleRow[]> {
  return db
    .select({
      id: struggleEvents.id,
      signal: struggleEvents.signal,
      value: struggleEvents.value,
      createdAt: struggleEvents.createdAt,
      nodeId: struggleEvents.nodeId,
      nodeTitle: nodes.title,
      userId: struggleEvents.userId,
      userName: users.name,
    })
    .from(struggleEvents)
    .innerJoin(nodes, eq(nodes.id, struggleEvents.nodeId))
    .innerJoin(users, eq(users.id, struggleEvents.userId))
    .orderBy(desc(struggleEvents.createdAt))
    .limit(limit);
}

export async function struggleTotals() {
  return db
    .select({
      signal: struggleEvents.signal,
      count: sql<number>`count(*)::int`,
      avgValue: sql<number | null>`avg(${struggleEvents.value})`,
    })
    .from(struggleEvents)
    .groupBy(struggleEvents.signal)
    .orderBy(desc(sql`count(*)`));
}

/* --------------------------------------------------------- one learner */

export async function learnerDetail(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return null;

  const [progress, ticks, answers, written, struggles] = await Promise.all([
    db
      .select({
        nodeId: nodeProgress.nodeId,
        title: nodes.title,
        slug: nodes.slug,
        phase: nodes.phase,
        state: nodeProgress.state,
        openedAt: nodeProgress.openedAt,
        lastOpenedAt: nodeProgress.lastOpenedAt,
        completedAt: nodeProgress.completedAt,
        attemptCount: nodeProgress.attemptCount,
      })
      .from(nodeProgress)
      .innerJoin(nodes, eq(nodes.id, nodeProgress.nodeId))
      .where(eq(nodeProgress.userId, userId))
      .orderBy(nodes.phase, nodes.orderIndex),

    db
      .select({
        nodeId: nodeChecklist.nodeId,
        item: nodeChecklist.item,
        checked: checklistState.checked,
        checkedAt: checklistState.checkedAt,
      })
      .from(checklistState)
      .innerJoin(nodeChecklist, eq(nodeChecklist.id, checklistState.checklistItemId))
      .where(eq(checklistState.userId, userId))
      .orderBy(nodeChecklist.nodeId, nodeChecklist.orderIndex),

    // Full answer text. The admin scope was chosen deliberately - see the note
    // on the panel itself.
    db
      .select({
        nodeId: nodeQuestions.nodeId,
        prompt: nodeQuestions.prompt,
        response: questionAttempts.response,
        selfRating: questionAttempts.selfRating,
        revealedAt: questionAttempts.revealedAt,
        createdAt: questionAttempts.createdAt,
      })
      .from(questionAttempts)
      .innerJoin(nodeQuestions, eq(nodeQuestions.id, questionAttempts.questionId))
      .where(eq(questionAttempts.userId, userId))
      .orderBy(nodeQuestions.nodeId, nodeQuestions.orderIndex),

    db
      .select({
        nodeId: reflections.nodeId,
        body: reflections.body,
        isPublic: reflections.isPublic,
        createdAt: reflections.createdAt,
      })
      .from(reflections)
      .where(eq(reflections.userId, userId))
      .orderBy(desc(reflections.createdAt)),

    db
      .select({
        signal: struggleEvents.signal,
        value: struggleEvents.value,
        nodeId: struggleEvents.nodeId,
        createdAt: struggleEvents.createdAt,
      })
      .from(struggleEvents)
      .where(eq(struggleEvents.userId, userId))
      .orderBy(desc(struggleEvents.createdAt)),
  ]);

  return { user, progress, ticks, answers, written, struggles };
}

/** Phase 0 completion - the build plan's kill criterion, as one number. */
export async function phaseZeroFunnel() {
  const [phaseZeroNodes, learnerCount, started, perUserPassed] = await Promise.all([
    db
      .select({ id: nodes.id })
      .from(nodes)
      .where(eq(nodes.phase, 0)),

    db.select({ id: users.id }).from(users),

    db
      .select({ key: nodeProgress.userId })
      .from(nodeProgress)
      .innerJoin(nodes, eq(nodes.id, nodeProgress.nodeId))
      .where(and(eq(nodes.phase, 0), isNotNull(nodeProgress.openedAt)))
      .groupBy(nodeProgress.userId),

    db
      .select({ key: nodeProgress.userId, n: sql<number>`count(*)::int` })
      .from(nodeProgress)
      .innerJoin(nodes, eq(nodes.id, nodeProgress.nodeId))
      .where(and(eq(nodes.phase, 0), isNotNull(nodeProgress.completedAt)))
      .groupBy(nodeProgress.userId),
  ]);

  const total = phaseZeroNodes.length;

  return {
    learners: learnerCount.length,
    startedPhaseZero: started.length,
    finishedPhaseZero: perUserPassed.filter((r) => r.n >= total && total > 0).length,
    phaseZeroNodes: total,
  };
}

