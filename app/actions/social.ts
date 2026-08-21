"use server";

/**
 * Writes for the social layer.
 *
 * Every one of these re-derives the graph and refuses on a locked node, for the
 * same reason the progress actions do: server actions are callable directly, so
 * a rule enforced only in the page is not enforced.
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { artifacts, comments, nodes, reflections } from "@/db/schema";
import { auth } from "@/lib/auth";
import { assertNodeUnlocked, buildGraph } from "@/lib/progress";

const MAX_COMMENT = 4000;

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return { userId: session.user.id, entryTrack: session.user.entryTrack ?? null };
}

async function nodeIdFromSlug(slug: string) {
  const [row] = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(eq(nodes.slug, slug))
    .limit(1);
  if (!row) throw new Error(`No node with slug ${slug}`);
  return row.id;
}

export async function postComment({
  slug,
  body,
  parentId,
  artifactId,
}: {
  slug: string;
  body: string;
  parentId?: string;
  artifactId?: string;
}) {
  const { userId, entryTrack } = await requireUser();
  const nodeId = await nodeIdFromSlug(slug);
  await assertNodeUnlocked(userId, entryTrack, nodeId);

  const trimmed = body.trim();
  if (trimmed.length === 0) throw new Error("Comment is empty");
  if (trimmed.length > MAX_COMMENT) {
    throw new Error(`Comment is longer than ${MAX_COMMENT} characters`);
  }

  // A reply must belong to the same node, or a crafted request could graft a
  // reply from one node's thread onto another's.
  if (parentId) {
    const [parent] = await db
      .select({ nodeId: comments.nodeId })
      .from(comments)
      .where(eq(comments.id, parentId));
    if (!parent || parent.nodeId !== nodeId) {
      throw new Error("Parent comment does not belong to this node");
    }
  }

  await db.insert(comments).values({
    userId,
    nodeId,
    parentId: parentId ?? null,
    artifactId: artifactId ?? null,
    body: trimmed,
  });

  revalidatePath(`/node/${slug}`);
}

export async function deleteComment(slug: string, commentId: string) {
  const { userId } = await requireUser();

  // Own comments only. Replies cascade, which is the behaviour people expect
  // and which avoids orphaned replies to a deleted parent.
  const result = await db
    .delete(comments)
    .where(and(eq(comments.id, commentId), eq(comments.userId, userId)))
    .returning({ id: comments.id });

  if (result.length === 0) throw new Error("Not your comment");

  revalidatePath(`/node/${slug}`);
}

/**
 * Publishing a reflection is opt-in and reversible, and it is only offered once
 * the node is passed - a reflection written before doing the work is not one
 * anybody else benefits from reading.
 */
export async function setReflectionVisibility(slug: string, isPublic: boolean) {
  const { userId, entryTrack } = await requireUser();
  const nodeId = await nodeIdFromSlug(slug);
  await assertNodeUnlocked(userId, entryTrack, nodeId);

  if (isPublic) {
    const graph = await buildGraph(userId, entryTrack);
    const summary = graph.byId.get(nodeId);
    // Earned, not assumed - an entry track's assumed pass is a claim about
    // prior knowledge, and a reflection on a node you skipped helps nobody.
    if (summary?.state !== "passed" || summary.assumedPassed) {
      throw new Error("Pass the node yourself before publishing your reflection");
    }
  }

  await db
    .update(reflections)
    .set({ isPublic })
    .where(and(eq(reflections.userId, userId), eq(reflections.nodeId, nodeId)));

  revalidatePath(`/node/${slug}`);
}

/** Node 7.1: submit a capstone for peer review. */
export async function submitCapstone({
  slug,
  kind,
  urlOrBody,
}: {
  slug: string;
  kind: "link" | "repo" | "notebook" | "text";
  urlOrBody: string;
}) {
  const { userId, entryTrack } = await requireUser();
  const nodeId = await nodeIdFromSlug(slug);
  await assertNodeUnlocked(userId, entryTrack, nodeId);

  const trimmed = urlOrBody.trim();
  if (trimmed.length === 0) throw new Error("Nothing submitted");

  // One live submission per person per node. Resubmitting replaces it, so the
  // reviewers' comments follow the artifact rather than accumulating against
  // stale versions.
  await db
    .delete(artifacts)
    .where(and(eq(artifacts.userId, userId), eq(artifacts.nodeId, nodeId)));

  await db.insert(artifacts).values({ userId, nodeId, kind, urlOrBody: trimmed });

  revalidatePath(`/node/${slug}`);
}

export async function withdrawCapstone(slug: string) {
  const { userId } = await requireUser();
  const nodeId = await nodeIdFromSlug(slug);

  await db
    .delete(artifacts)
    .where(and(eq(artifacts.userId, userId), eq(artifacts.nodeId, nodeId)));

  revalidatePath(`/node/${slug}`);
}
