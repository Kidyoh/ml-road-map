"use server";

/**
 * Everything a learner can write. All of it goes through here so that the
 * struggle-signal emission sits next to the state change that causes it, rather
 * than being bolted on at a call site somebody will forget.
 */
import { revalidatePath } from "next/cache";
import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import {
  checklistState,
  nodeChecklist,
  nodeProgress,
  nodeQuestions,
  reflections,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { assertNodeUnlocked } from "@/lib/progress";
import {
  THIN_REFLECTION_WORDS,
  countWords,
  type SelfRating,
} from "@/lib/signals";
import { emitStruggle } from "@/lib/struggle";

/** The session, resolved once per action rather than once per check. */
async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return { userId: session.user.id, entryTrack: session.user.entryTrack ?? null };
}

/**
 * A visit is only a new visit if the last one was this long ago. Anything
 * closer together is a refresh, a navigation back, or Next rendering the page
 * more than once - none of which is the learner attempting the node again.
 */
const NEW_VISIT_AFTER_MS = 30 * 60 * 1000;

/**
 * Record that the learner is looking at this node.
 *
 * Called from the page render, which means it runs more than once per actual
 * visit. Everything here therefore has to be idempotent within a visit:
 * `opened_at` is written once ever, and `attempt_count` and
 * `reopened_after_pass` only move when the gap since the last open is big
 * enough to be a real return.
 */
export async function openNode(nodeId: string) {
  const { userId } = await requireUser();
  const now = new Date();

  const [existing] = await db
    .select()
    .from(nodeProgress)
    .where(and(eq(nodeProgress.userId, userId), eq(nodeProgress.nodeId, nodeId)));

  if (!existing) {
    await db.insert(nodeProgress).values({
      userId,
      nodeId,
      state: "in_progress",
      openedAt: now,
      lastOpenedAt: now,
      attemptCount: 1,
    });
    return;
  }

  const sinceLast = existing.lastOpenedAt
    ? now.getTime() - existing.lastOpenedAt.getTime()
    : Number.POSITIVE_INFINITY;

  if (sinceLast < NEW_VISIT_AFTER_MS) {
    // Same visit. Touch nothing - not even lastOpenedAt, or a learner who keeps
    // the tab open would never register a return visit.
    return;
  }

  // Coming back to a node already passed usually means it did not stick.
  if (existing.completedAt) {
    const days =
      (now.getTime() - existing.completedAt.getTime()) / (1000 * 60 * 60 * 24);
    await emitStruggle({
      userId,
      nodeId,
      signal: "reopened_after_pass",
      value: Math.round(days * 10) / 10,
    });
  }

  await db
    .update(nodeProgress)
    .set({
      lastOpenedAt: now,
      attemptCount: existing.attemptCount + 1,
    })
    .where(and(eq(nodeProgress.userId, userId), eq(nodeProgress.nodeId, nodeId)));
}

export async function toggleChecklistItem(
  checklistItemId: string,
  checked: boolean,
) {
  const { userId, entryTrack } = await requireUser();

  const [item] = await db
    .select({ nodeId: nodeChecklist.nodeId })
    .from(nodeChecklist)
    .where(eq(nodeChecklist.id, checklistItemId));

  if (!item) throw new Error(`No checklist item ${checklistItemId}`);
  await assertNodeUnlocked(userId, entryTrack, item.nodeId);

  const now = new Date();

  await db
    .insert(checklistState)
    .values({ userId, checklistItemId, checked, checkedAt: checked ? now : null })
    .onConflictDoUpdate({
      target: [checklistState.userId, checklistState.checklistItemId],
      set: { checked, checkedAt: checked ? now : null },
    });

  if (checked) await recordFirstCheck(userId, item.nodeId, now);
  await refreshCompletion(userId, item.nodeId);

  revalidatePath("/map");
}

/**
 * `time_to_first_check`: a long gap between opening a node and the first thing
 * ticked. Emitted once, on the first tick only - a second emission would measure
 * nothing and pollute the corpus.
 */
async function recordFirstCheck(userId: string, nodeId: string, now: Date) {
  const [progress] = await db
    .select()
    .from(nodeProgress)
    .where(and(eq(nodeProgress.userId, userId), eq(nodeProgress.nodeId, nodeId)));

  if (!progress?.openedAt) return;

  const priorChecks = await db
    .select({ itemId: checklistState.checklistItemId })
    .from(checklistState)
    .innerJoin(nodeChecklist, eq(nodeChecklist.id, checklistState.checklistItemId))
    .where(
      and(
        eq(checklistState.userId, userId),
        eq(nodeChecklist.nodeId, nodeId),
        eq(checklistState.checked, true),
      ),
    );

  if (priorChecks.length !== 1) return; // not the first

  await emitStruggle({
    userId,
    nodeId,
    signal: "time_to_first_check",
    value: Math.round((now.getTime() - progress.openedAt.getTime()) / 1000),
  });
}

export async function saveQuestionAttempt({
  questionId,
  response,
  revealed,
  selfRating,
}: {
  questionId: string;
  response?: string;
  revealed?: boolean;
  selfRating?: SelfRating;
}) {
  const { userId, entryTrack } = await requireUser();

  const [question] = await db
    .select({ nodeId: nodeQuestions.nodeId })
    .from(nodeQuestions)
    .where(eq(nodeQuestions.id, questionId));

  if (!question) throw new Error(`No question ${questionId}`);
  await assertNodeUnlocked(userId, entryTrack, question.nodeId);

  const { questionAttempts } = await import("@/db/schema");

  const [existing] = await db
    .select()
    .from(questionAttempts)
    .where(
      and(
        eq(questionAttempts.userId, userId),
        eq(questionAttempts.questionId, questionId),
      ),
    );

  const revealedAt = revealed ? (existing?.revealedAt ?? new Date()) : existing?.revealedAt ?? null;

  if (!existing) {
    await db.insert(questionAttempts).values({
      userId,
      questionId,
      response: response ?? null,
      revealedAt,
      selfRating: selfRating ?? null,
    });
  } else {
    await db
      .update(questionAttempts)
      .set({
        response: response ?? existing.response,
        revealedAt,
        selfRating: selfRating ?? existing.selfRating,
      })
      .where(eq(questionAttempts.id, existing.id));
  }

  // Revealing the answer key having written nothing is the single clearest
  // signal that a node has not landed.
  if (revealed && !existing?.revealedAt) {
    const written = (response ?? existing?.response ?? "").trim();
    if (written.length === 0) {
      await emitStruggle({
        userId,
        nodeId: question.nodeId,
        signal: "revealed_before_attempt",
        value: 1,
      });
    }
  }

  if (selfRating) await refreshCompletion(userId, question.nodeId);

  revalidatePath("/map");
}

export async function saveReflection(nodeId: string, body: string) {
  const { userId, entryTrack } = await requireUser();
  await assertNodeUnlocked(userId, entryTrack, nodeId);

  const trimmed = body.trim();
  if (trimmed.length === 0) return;

  const [existing] = await db
    .select()
    .from(reflections)
    .where(and(eq(reflections.userId, userId), eq(reflections.nodeId, nodeId)));

  if (existing) {
    await db
      .update(reflections)
      .set({ body: trimmed })
      .where(eq(reflections.id, existing.id));
  } else {
    await db.insert(reflections).values({ userId, nodeId, body: trimmed });
  }

  const words = countWords(trimmed);
  if (words < THIN_REFLECTION_WORDS) {
    await emitStruggle({
      userId,
      nodeId,
      signal: "thin_reflection",
      value: words,
    });
  }
}

/**
 * Recompute whether this node now meets the pass condition and stamp
 * `completed_at` accordingly.
 *
 * This writes only the learner's own completion, never the graph state - hidden,
 * fogged and open stay derived (non-negotiable 2). Unticking an item clears the
 * stamp again, because a node you can no longer verify is not a node you passed.
 */
async function refreshCompletion(userId: string, nodeId: string) {
  const { questionAttempts } = await import("@/db/schema");

  const [items, checked, questions, rated] = await Promise.all([
    db.select({ id: nodeChecklist.id }).from(nodeChecklist).where(eq(nodeChecklist.nodeId, nodeId)),
    db
      .select({ id: checklistState.checklistItemId })
      .from(checklistState)
      .innerJoin(nodeChecklist, eq(nodeChecklist.id, checklistState.checklistItemId))
      .where(
        and(
          eq(checklistState.userId, userId),
          eq(nodeChecklist.nodeId, nodeId),
          eq(checklistState.checked, true),
        ),
      ),
    db.select({ id: nodeQuestions.id }).from(nodeQuestions).where(eq(nodeQuestions.nodeId, nodeId)),
    db
      .select({ id: questionAttempts.questionId })
      .from(questionAttempts)
      .innerJoin(nodeQuestions, eq(nodeQuestions.id, questionAttempts.questionId))
      .where(
        and(
          eq(questionAttempts.userId, userId),
          eq(nodeQuestions.nodeId, nodeId),
          // A rating, not merely an attempt. Revealing the answer and moving on
          // does not pass the node - the self-rating step is the point.
          isNotNull(questionAttempts.selfRating),
        ),
      ),
  ]);

  const ratedIds = new Set(rated.map((r) => r.id));
  const passes =
    items.length > 0 &&
    questions.length > 0 &&
    checked.length >= items.length &&
    questions.every((q) => ratedIds.has(q.id));

  await db
    .insert(nodeProgress)
    .values({
      userId,
      nodeId,
      state: passes ? "passed" : "in_progress",
      openedAt: new Date(),
      lastOpenedAt: new Date(),
      completedAt: passes ? new Date() : null,
      attemptCount: 1,
    })
    .onConflictDoUpdate({
      target: [nodeProgress.userId, nodeProgress.nodeId],
      set: {
        state: passes ? "passed" : "in_progress",
        completedAt: passes ? new Date() : null,
      },
    });
}

export async function setEntryTrack(
  track: "beginner" | "developer" | "practitioner",
) {
  const { userId } = await requireUser();
  const { users } = await import("@/db/schema");
  await db.update(users).set({ entryTrack: track }).where(eq(users.id, userId));
  revalidatePath("/map");
}
