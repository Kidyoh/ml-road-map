import "server-only";

/**
 * Reads for the social layer.
 *
 * Two visibility rules are enforced here rather than in the UI, for the same
 * reason the content lock lives in the page rather than in CSS: a rule that only
 * exists in a component is a rule anyone can walk around.
 *
 *   1. Discussion of a node is not visible until the node is unlocked. A thread
 *      on node 2.3 is a list of the three leaks.
 *   2. Other people's reflections are not visible until you have PASSED the
 *      node. Reading someone's reflection before doing the work is the same
 *      failure as reading the answer key early - and the reflection prompts are
 *      deliberately the questions whose value is in answering them yourself.
 */
import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { artifacts, comments, reflections, users } from "@/db/schema";
import { isLockedState, type NodeSummary } from "@/lib/progress";

export type CommentAuthor = {
  id: string;
  name: string | null;
  image: string | null;
};

export type CommentNode = {
  id: string;
  body: string;
  /**
   * Pre-formatted here rather than in the component. A component that calls
   * Date.now() during render is not a pure function of its props, and the
   * relative label would differ between the server render and hydration.
   */
  createdAtLabel: string;
  author: CommentAuthor;
  isMine: boolean;
  replies: CommentNode[];
};

function relativeTime(then: Date): string {
  const seconds = Math.round((Date.now() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return then.toISOString().slice(0, 10);
}

export type PublicReflection = {
  id: string;
  body: string;
  createdAt: Date;
  author: CommentAuthor;
};

export type CapstoneSubmission = {
  id: string;
  kind: string;
  urlOrBody: string;
  createdAt: Date;
  author: CommentAuthor;
  isMine: boolean;
  reviews: CommentNode[];
};

/** Discussion is readable exactly when the node itself is. */
export function canSeeDiscussion(summary: NodeSummary | undefined): boolean {
  return Boolean(summary) && !isLockedState(summary!.state);
}

/**
 * Other people's reflections need an EARNED pass.
 *
 * Not merely an unlock, and specifically not an entry track's assumed pass. A
 * practitioner starting at 3.1 has 2.3 marked passed because they asserted they
 * already know it - which is a claim about prior knowledge, not evidence they
 * did this node's session. Reading the reflections is the reward for having
 * answered the prompt yourself, so skipping the node skips the reward.
 */
export function canSeeReflections(summary: NodeSummary | undefined): boolean {
  return summary?.state === "passed" && !summary.assumedPassed;
}

function toTree(
  rows: {
    id: string;
    body: string;
    createdAt: Date;
    parentId: string | null;
    authorId: string;
    authorName: string | null;
    authorImage: string | null;
  }[],
  viewerId: string | null,
): CommentNode[] {
  const byId = new Map<string, CommentNode>();

  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      body: row.body,
      createdAtLabel: relativeTime(row.createdAt),
      author: {
        id: row.authorId,
        name: row.authorName,
        image: row.authorImage,
      },
      isMine: viewerId === row.authorId,
      replies: [],
    });
  }

  const roots: CommentNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    // Threading is one level deep: a reply to a reply attaches to the same
    // root. Arbitrary nesting is unreadable at any width and produces threads
    // nobody follows.
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }

  return roots;
}

export async function loadComments(
  nodeId: string,
  viewerId: string | null,
): Promise<CommentNode[]> {
  const rows = await db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      parentId: comments.parentId,
      authorId: users.id,
      authorName: users.name,
      authorImage: users.image,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(and(eq(comments.nodeId, nodeId), isNull(comments.artifactId)))
    .orderBy(asc(comments.createdAt));

  return toTree(rows, viewerId);
}

export async function loadPublicReflections(
  nodeId: string,
  viewerId: string | null,
): Promise<PublicReflection[]> {
  const rows = await db
    .select({
      id: reflections.id,
      body: reflections.body,
      createdAt: reflections.createdAt,
      authorId: users.id,
      authorName: users.name,
      authorImage: users.image,
    })
    .from(reflections)
    .innerJoin(users, eq(users.id, reflections.userId))
    .where(and(eq(reflections.nodeId, nodeId), eq(reflections.isPublic, true)))
    .orderBy(desc(reflections.createdAt));

  // Your own reflection is already shown in the reflection box above.
  return rows
    .filter((r) => r.authorId !== viewerId)
    .map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.createdAt,
      author: { id: r.authorId, name: r.authorName, image: r.authorImage },
    }));
}

/** Capstone submissions on node 7.1, with their reviews. */
export async function loadCapstones(
  nodeId: string,
  viewerId: string | null,
): Promise<CapstoneSubmission[]> {
  const rows = await db
    .select({
      id: artifacts.id,
      kind: artifacts.kind,
      urlOrBody: artifacts.urlOrBody,
      createdAt: artifacts.createdAt,
      authorId: users.id,
      authorName: users.name,
      authorImage: users.image,
    })
    .from(artifacts)
    .innerJoin(users, eq(users.id, artifacts.userId))
    .where(eq(artifacts.nodeId, nodeId))
    .orderBy(desc(artifacts.createdAt));

  if (rows.length === 0) return [];

  const reviewRows = await db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      parentId: comments.parentId,
      artifactId: comments.artifactId,
      authorId: users.id,
      authorName: users.name,
      authorImage: users.image,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(eq(comments.nodeId, nodeId))
    .orderBy(asc(comments.createdAt));

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    urlOrBody: row.urlOrBody,
    createdAt: row.createdAt,
    author: { id: row.authorId, name: row.authorName, image: row.authorImage },
    isMine: viewerId === row.authorId,
    reviews: toTree(
      reviewRows.filter((r) => r.artifactId === row.id),
      viewerId,
    ),
  }));
}

/** Whether the viewer already has their own reflection marked public. */
export async function loadMyReflection(nodeId: string, userId: string) {
  const [row] = await db
    .select({ id: reflections.id, body: reflections.body, isPublic: reflections.isPublic })
    .from(reflections)
    .where(and(eq(reflections.userId, userId), eq(reflections.nodeId, nodeId)))
    .limit(1);
  return row ?? null;
}
