import "server-only";

/**
 * Node state derivation.
 *
 * Non-negotiable 2: unlock state is DERIVED, never stored as truth. Recompute
 * from prerequisites plus progress on every read. A stored graph state will
 * drift and then silently lie.
 *
 * `node_progress.state` exists as a column, but only as a cache of the learner's
 * own activity on a node (opened / completed). Whether a node is hidden, fogged
 * or open is a function of the whole graph and is computed here every time.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  checklistState,
  nodeChecklist,
  nodePrereqs,
  nodeProgress,
  nodeQuestions,
  nodes,
  questionAttempts,
} from "@/db/schema";
import { isGuestUser } from "@/lib/guest";

export type NodeState =
  | "hidden"
  | "fogged"
  | "open"
  | "in_progress"
  | "passed";

export type EntryTrack = "beginner" | "developer" | "practitioner";

/** M4's entry-track picker. Where each kind of learner starts. */
export const ENTRY_TRACK_START_NODE: Record<EntryTrack, string> = {
  beginner: "0.1",
  developer: "1.1",
  practitioner: "3.1",
};

export type NodeSummary = {
  id: string;
  phase: number;
  orderIndex: number;
  title: string;
  slug: string;
  goal: string;
  status: "planned" | "published";
  prereqs: string[];
  state: NodeState;
  /** Ticked checklist items over total. Zero total for a planned node. */
  checklistDone: number;
  checklistTotal: number;
  /** Self-rated questions over total. */
  questionsRated: number;
  questionsTotal: number;
  openedAt: Date | null;
  completedAt: Date | null;
  /** True when the entry track granted this rather than the learner earning it. */
  assumedPassed: boolean;
};

export type Graph = {
  nodes: NodeSummary[];
  byId: Map<string, NodeSummary>;
  /** Node to resume: most recently opened and not yet passed. */
  resumeNodeId: string | null;
};

/**
 * A node is passed when every checklist item is ticked AND every question is
 * self-rated.
 *
 * The guard on `checklistTotal` matters more than it looks. A planned node has
 * no checklist and no questions, so "every item ticked" is vacuously true and it
 * would be born passed - unlocking the entire roadmap through nodes nobody has
 * written. A node with nothing to verify can never be passed.
 */
function meetsPassCondition(row: {
  checklistTotal: number;
  checklistDone: number;
  questionsTotal: number;
  questionsRated: number;
}): boolean {
  if (row.checklistTotal === 0 || row.questionsTotal === 0) return false;
  return (
    row.checklistDone >= row.checklistTotal &&
    row.questionsRated >= row.questionsTotal
  );
}

/**
 * Everything the chosen entry track lets you skip: the transitive prerequisites
 * of its start node, and nothing else.
 *
 * A "developer" starting at 1.1 is asserting they already have 0.1 and 0.2 - the
 * things 1.1 actually requires. It says nothing about 0.4 or 0.5, which stay
 * open to them as normal. Anything more generous would be guessing on their
 * behalf about knowledge they never claimed.
 */
function ancestorsOf(startId: string, prereqsOf: Map<string, string[]>) {
  const seen = new Set<string>();
  const stack = [...(prereqsOf.get(startId) ?? [])];

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(prereqsOf.get(id) ?? []));
  }

  return seen;
}

/**
 * Distance from the passed frontier, which is what separates fogged from hidden.
 *
 *   0  every prerequisite is passed          -> open / in_progress / passed
 *   1  one level of unpassed prerequisites   -> fogged, visible on the map
 *   2+ further than that                     -> hidden
 *
 * The spec's wording: "hidden - more than one prerequisite level away from
 * anything passed". Fogging one level out is what lets a learner see the shape
 * of the road ahead without the map becoming a wall of everything at once.
 */
function distanceFromFrontier(
  id: string,
  prereqsOf: Map<string, string[]>,
  passed: Set<string>,
  memo: Map<string, number>,
  visiting = new Set<string>(),
): number {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;

  // The validator rejects cycles, but a bad seed should degrade rather than hang.
  if (visiting.has(id)) return 0;
  visiting.add(id);

  const prereqs = prereqsOf.get(id) ?? [];
  const unpassed = prereqs.filter((p) => !passed.has(p));

  const distance =
    unpassed.length === 0
      ? 0
      : 1 +
        Math.max(
          ...unpassed.map((p) =>
            distanceFromFrontier(p, prereqsOf, passed, memo, visiting),
          ),
        );

  visiting.delete(id);
  memo.set(id, distance);
  return distance;
}

/**
 * The whole graph for one learner, or for nobody.
 *
 * Six queries regardless of graph size - no per-node round trips. Called on
 * every map render and every node render, which is exactly the point: it is
 * cheap enough that there is never a reason to cache the answer and let it rot.
 */
export async function buildGraph(
  userId: string | null,
  entryTrack: EntryTrack | null = null,
): Promise<Graph> {
  const [allNodes, allPrereqs, checklistCounts, questionCounts] =
    await Promise.all([
      db.select().from(nodes),
      db.select().from(nodePrereqs),
      db.select({ id: nodeChecklist.id, nodeId: nodeChecklist.nodeId }).from(nodeChecklist),
      db.select({ id: nodeQuestions.id, nodeId: nodeQuestions.nodeId }).from(nodeQuestions),
    ]);

  const prereqsOf = new Map<string, string[]>();
  for (const node of allNodes) prereqsOf.set(node.id, []);
  for (const edge of allPrereqs) {
    prereqsOf.get(edge.nodeId)?.push(edge.prereqId);
  }

  const checklistByNode = new Map<string, string[]>();
  for (const item of checklistCounts) {
    const list = checklistByNode.get(item.nodeId) ?? [];
    list.push(item.id);
    checklistByNode.set(item.nodeId, list);
  }

  const questionsByNode = new Map<string, string[]>();
  for (const q of questionCounts) {
    const list = questionsByNode.get(q.nodeId) ?? [];
    list.push(q.id);
    questionsByNode.set(q.nodeId, list);
  }

  // --- the learner's own activity ----------------------------------------
  const checkedItems = new Set<string>();
  const ratedQuestions = new Set<string>();
  const progressByNode = new Map<
    string,
    { openedAt: Date | null; completedAt: Date | null }
  >();

  if (userId) {
    const [checks, attempts, progress] = await Promise.all([
      db
        .select({ itemId: checklistState.checklistItemId })
        .from(checklistState)
        .where(
          and(eq(checklistState.userId, userId), eq(checklistState.checked, true)),
        ),
      db
        .select({ questionId: questionAttempts.questionId, rating: questionAttempts.selfRating })
        .from(questionAttempts)
        .where(eq(questionAttempts.userId, userId)),
      db
        .select({
          nodeId: nodeProgress.nodeId,
          openedAt: nodeProgress.openedAt,
          completedAt: nodeProgress.completedAt,
        })
        .from(nodeProgress)
        .where(eq(nodeProgress.userId, userId)),
    ]);

    for (const c of checks) checkedItems.add(c.itemId);
    // Only a rated attempt counts. Revealing the answer and walking away does
    // not pass the node - that is the whole point of the self-rating step.
    for (const a of attempts) if (a.rating !== null) ratedQuestions.add(a.questionId);
    for (const p of progress) {
      progressByNode.set(p.nodeId, {
        openedAt: p.openedAt,
        completedAt: p.completedAt,
      });
    }
  }

  // --- who is passed ------------------------------------------------------
  const tallies = new Map<
    string,
    {
      checklistTotal: number;
      checklistDone: number;
      questionsTotal: number;
      questionsRated: number;
    }
  >();

  for (const node of allNodes) {
    const items = checklistByNode.get(node.id) ?? [];
    const qs = questionsByNode.get(node.id) ?? [];
    tallies.set(node.id, {
      checklistTotal: items.length,
      checklistDone: items.filter((id) => checkedItems.has(id)).length,
      questionsTotal: qs.length,
      questionsRated: qs.filter((id) => ratedQuestions.has(id)).length,
    });
  }

  const earned = new Set<string>();
  for (const node of allNodes) {
    if (meetsPassCondition(tallies.get(node.id)!)) earned.add(node.id);
  }

  const assumed = entryTrack
    ? ancestorsOf(ENTRY_TRACK_START_NODE[entryTrack], prereqsOf)
    : new Set<string>();

  const passed = new Set([...earned, ...assumed]);

  // --- derive every state -------------------------------------------------
  // The shared guest account (the 904 Advisory link) sees every node open.
  const unlockAll = isGuestUser(userId);
  const memo = new Map<string, number>();
  const summaries: NodeSummary[] = allNodes.map((node) => {
    const tally = tallies.get(node.id)!;
    const progress = progressByNode.get(node.id);
    const distance = distanceFromFrontier(node.id, prereqsOf, passed, memo);

    let state: NodeState;
    if (passed.has(node.id)) {
      state = "passed";
    } else if (distance === 0 || unlockAll) {
      state = progress?.openedAt ? "in_progress" : "open";
    } else if (distance === 1) {
      state = "fogged";
    } else {
      state = "hidden";
    }

    return {
      id: node.id,
      phase: node.phase,
      orderIndex: node.orderIndex,
      title: node.title,
      slug: node.slug,
      goal: node.goal,
      status: node.status,
      prereqs: prereqsOf.get(node.id) ?? [],
      state,
      checklistDone: tally.checklistDone,
      checklistTotal: tally.checklistTotal,
      questionsRated: tally.questionsRated,
      questionsTotal: tally.questionsTotal,
      openedAt: progress?.openedAt ?? null,
      completedAt: progress?.completedAt ?? null,
      assumedPassed: assumed.has(node.id) && !earned.has(node.id),
    };
  });

  summaries.sort((a, b) =>
    a.phase !== b.phase ? a.phase - b.phase : a.orderIndex - b.orderIndex,
  );

  const resumeCandidate = summaries
    .filter((n) => n.state === "in_progress" && n.openedAt)
    .sort((a, b) => b.openedAt!.getTime() - a.openedAt!.getTime())[0];

  return {
    nodes: summaries,
    byId: new Map(summaries.map((n) => [n.id, n])),
    resumeNodeId: resumeCandidate?.id ?? null,
  };
}

export function isLockedState(state: NodeState | undefined): boolean {
  return state === "fogged" || state === "hidden";
}

/**
 * Refuse a write to a node the learner has not unlocked.
 *
 * Hiding the checklist in the page is not enough - server actions are callable
 * directly, so without this you could tick every box on node 7.1 with a crafted
 * request and unlock the roadmap backwards. The page and the write path have to
 * agree, and the write path is the one that matters.
 *
 * It lives here rather than in the actions module so it can be tested without
 * booting Next, and so it takes the entry track as an argument instead of
 * reaching for the session a second time on every write.
 */
export async function assertNodeUnlocked(
  userId: string,
  entryTrack: EntryTrack | null,
  nodeId: string,
): Promise<void> {
  const graph = await buildGraph(userId, entryTrack);
  const state = graph.byId.get(nodeId)?.state;

  if (isLockedState(state)) {
    throw new Error(
      `Node ${nodeId} is locked - its prerequisites are not passed yet.`,
    );
  }
}

/** Per-phase rollup for the map's progress rings. */
export type PhaseSummary = {
  phase: number;
  name: string;
  total: number;
  passed: number;
  published: number;
  reachable: number;
};

export const PHASE_NAMES: Record<number, string> = {
  0: "Tooling floor",
  1: "Math on demand",
  2: "Supervised learning",
  3: "Unsupervised and feature work",
  4: "Deep learning",
  5: "Applied LLM",
  6: "Ship it",
  7: "Capstone",
};

export function summarisePhases(graph: Graph): PhaseSummary[] {
  const byPhase = new Map<number, NodeSummary[]>();
  for (const node of graph.nodes) {
    const list = byPhase.get(node.phase) ?? [];
    list.push(node);
    byPhase.set(node.phase, list);
  }

  return [...byPhase.entries()]
    .sort(([a], [b]) => a - b)
    .map(([phase, list]) => ({
      phase,
      name: PHASE_NAMES[phase] ?? `Phase ${phase}`,
      total: list.length,
      passed: list.filter((n) => n.state === "passed").length,
      published: list.filter((n) => n.status === "published").length,
      reachable: list.filter(
        (n) => n.state !== "hidden" && n.state !== "fogged",
      ).length,
    }));
}
