import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";

import {
  openNode,
  saveQuestionAttempt,
  saveReflection,
  toggleChecklistItem,
} from "@/app/actions/progress";
import { Checklist } from "@/components/node/checklist";
import { LockedNode } from "@/components/node/locked-node";
import { MdxBody } from "@/components/node/mdx-body";
import { NodeHeader } from "@/components/node/node-header";
import { NodeStateBanner } from "@/components/node/node-state-banner";
import { PlannedNode } from "@/components/node/planned-node";
import { QuestionFold, type Question } from "@/components/node/question-fold";
import { ReflectionBox } from "@/components/node/reflection-box";
import { ResourceCards } from "@/components/node/resource-cards";
import { SessionBrief } from "@/components/node/session-brief";
import { CapstonePanel } from "@/components/social/capstone-panel";
import { CommentThread } from "@/components/social/comment-thread";
import { PublicReflections } from "@/components/social/public-reflections";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { db } from "@/db";
import {
  checklistState,
  nodeChecklist,
  nodeQuestions,
  nodes,
  questionAttempts,
  reflections,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { loadAllNodes, loadNodeBySlug } from "@/lib/content";
import { isPublished } from "@/lib/content-schema";
import { buildGraph } from "@/lib/progress";
import {
  canSeeDiscussion,
  canSeeReflections,
  loadCapstones,
  loadComments,
  loadMyReflection,
  loadPublicReflections,
} from "@/lib/social";
import {
  deleteComment,
  postComment,
  setReflectionVisibility,
  submitCapstone,
  withdrawCapstone,
} from "@/app/actions/social";

/**
 * The split between the two sources is deliberate.
 *
 *   Postgres   - node row, checklist items, questions, and the learner's state.
 *                These need stable ids because checklist_state and
 *                question_attempts hang off them.
 *   Filesystem - resources, session brief, reflection prompt, body prose.
 *                Nothing points at these, so git stays the single source of
 *                truth (non-negotiable 1) and fixing a typo is a pull request.
 */
export async function generateStaticParams() {
  const all = await loadAllNodes();
  return all.map((node) => ({ slug: node.frontmatter.slug }));
}

export async function generateMetadata({ params }: PageProps<"/node/[slug]">) {
  const { slug } = await params;
  const loaded = await loadNodeBySlug(slug);
  if (!loaded) return {};

  return {
    title: `${loaded.frontmatter.id} ${loaded.frontmatter.title}`,
    description: loaded.frontmatter.goal,
  };
}

export default async function NodePage({ params }: PageProps<"/node/[slug]">) {
  const { slug } = await params;

  const loaded = await loadNodeBySlug(slug);
  if (!loaded) notFound();

  const { frontmatter, body, contentHash } = loaded;
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const [row] = await db.select().from(nodes).where(eq(nodes.slug, slug)).limit(1);

  if (!row) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Not seeded yet</h1>
        <p className="text-muted-foreground mt-3 max-w-prose leading-relaxed">
          <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-sm">
            {loaded.filePath}
          </code>{" "}
          exists on disk but node{" "}
          <span className="font-mono">{frontmatter.id}</span> is not in the
          database. Run <span className="font-mono">pnpm seed</span>.
        </p>
      </main>
    );
  }

  const graph = await buildGraph(userId, session?.user?.entryTrack ?? null);
  const summary = graph.byId.get(row.id);

  /**
   * The gate.
   *
   * This applies signed-out as well as signed-in, and that is the whole point:
   * if "not signed in" meant "unlocked", opening a private window would defeat
   * the lock entirely. Signed out nothing is passed, so only the entry points
   * (nodes with no prerequisites) are readable - which still lets someone see
   * what node 0.1 is actually like before making an account.
   */
  const locked =
    summary?.state === "fogged" || summary?.state === "hidden";

  // Opening a node starts the clock that `time_to_first_check` measures
  // against. Only count it once the node is actually workable.
  if (userId && isPublished(frontmatter) && !locked) {
    await openNode(row.id);
  }

  const prereqTitles = frontmatter.prereqs.length
    ? (
        await db
          .select({
            id: nodes.id,
            title: nodes.title,
            slug: nodes.slug,
            status: nodes.status,
          })
          .from(nodes)
          .where(inArray(nodes.id, frontmatter.prereqs))
      )
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((p) => ({ ...p, written: p.status === "published" }))
    : [];

  // Not fetched at all when locked. Server-side enforcement rather than CSS:
  // the answer keys never enter the payload, so the lock survives view-source.
  const [checklistItems, questionRows] = locked
    ? [[], []]
    : await Promise.all([
        db
          .select({ id: nodeChecklist.id, item: nodeChecklist.item })
          .from(nodeChecklist)
          .where(eq(nodeChecklist.nodeId, row.id))
          .orderBy(asc(nodeChecklist.orderIndex)),
        db
          .select({
            id: nodeQuestions.id,
            prompt: nodeQuestions.prompt,
            answerKey: nodeQuestions.answerKey,
          })
          .from(nodeQuestions)
          .where(eq(nodeQuestions.nodeId, row.id))
          .orderBy(asc(nodeQuestions.orderIndex)),
      ]);

  // --- the learner's own state on this node --------------------------------
  let initialChecked: Record<string, boolean> = {};
  let attemptsByQuestion = new Map<
    string,
    { response: string | null; selfRating: Question["selfRating"]; revealed: boolean }
  >();
  let reflectionBody = "";

  if (userId && !locked) {
    const [checks, attempts, [reflection]] = await Promise.all([
      db
        .select({
          itemId: checklistState.checklistItemId,
          checked: checklistState.checked,
        })
        .from(checklistState)
        .innerJoin(
          nodeChecklist,
          eq(nodeChecklist.id, checklistState.checklistItemId),
        )
        .where(
          and(eq(checklistState.userId, userId), eq(nodeChecklist.nodeId, row.id)),
        ),
      db
        .select({
          questionId: questionAttempts.questionId,
          response: questionAttempts.response,
          selfRating: questionAttempts.selfRating,
          revealedAt: questionAttempts.revealedAt,
        })
        .from(questionAttempts)
        .innerJoin(
          nodeQuestions,
          eq(nodeQuestions.id, questionAttempts.questionId),
        )
        .where(
          and(eq(questionAttempts.userId, userId), eq(nodeQuestions.nodeId, row.id)),
        ),
      db
        .select({ body: reflections.body })
        .from(reflections)
        .where(and(eq(reflections.userId, userId), eq(reflections.nodeId, row.id)))
        .limit(1),
    ]);

    initialChecked = Object.fromEntries(checks.map((c) => [c.itemId, c.checked]));
    attemptsByQuestion = new Map(
      attempts.map((a) => [
        a.questionId,
        {
          response: a.response,
          selfRating: a.selfRating,
          revealed: a.revealedAt !== null,
        },
      ]),
    );
    reflectionBody = reflection?.body ?? "";
  }

  const questions: Question[] = questionRows.map((q) => {
    const attempt = attemptsByQuestion.get(q.id);
    return {
      ...q,
      response: attempt?.response ?? null,
      selfRating: attempt?.selfRating ?? null,
      revealed: attempt?.revealed ?? false,
    };
  });

  const isStale = row.contentHash !== contentHash;
  const signedIn = Boolean(userId);

  // --- social layer -------------------------------------------------------
  // Discussion follows the same gate as the content: a thread on node 2.3 is a
  // list of its three leaks. Reflections need a pass rather than an unlock.
  const showDiscussion = canSeeDiscussion(summary);
  const showReflections = canSeeReflections(summary);
  const isCapstone = frontmatter.id === "7.1";

  const [threadComments, othersReflections, myReflection, capstones] =
    await Promise.all([
      showDiscussion ? loadComments(row.id, userId) : Promise.resolve([]),
      showReflections
        ? loadPublicReflections(row.id, userId)
        : Promise.resolve([]),
      userId ? loadMyReflection(row.id, userId) : Promise.resolve(null),
      isCapstone && showDiscussion
        ? loadCapstones(row.id, userId)
        : Promise.resolve([]),
    ]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-12">
      <nav className="text-muted-foreground flex items-center justify-between gap-4 text-sm">
        <span>
          <Link href="/map" className="hover:text-foreground transition-colors">
            Map
          </Link>
          <span className="mx-2" aria-hidden>
            /
          </span>
          <span>Phase {frontmatter.phase}</span>
        </span>
        <ThemeToggle />
      </nav>

      <NodeHeader
        id={frontmatter.id}
        phase={frontmatter.phase}
        title={frontmatter.title}
        goal={frontmatter.goal}
      />

      {summary && !locked ? (
        <NodeStateBanner summary={summary} signedIn={signedIn} graph={graph} />
      ) : null}

      {isStale ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          The MDX file has changed since the last seed. Structure below is from
          the database; the prose is from disk. Run{" "}
          <span className="font-mono">pnpm seed</span> to reconcile them.
        </p>
      ) : null}

      {isPublished(frontmatter) && locked && summary ? (
        <LockedNode
          resources={frontmatter.resources}
          difficulty={frontmatter.session.difficulty}
          blockers={summary.prereqs
            .map((id) => graph.byId.get(id))
            .filter((n): n is NonNullable<typeof n> => Boolean(n))}
          signedIn={signedIn}
        />
      ) : isPublished(frontmatter) ? (
        <>
          <ResourceCards
            primary={frontmatter.resources.primary}
            alt={frontmatter.resources.alt}
          />

          <SessionBrief session={frontmatter.session} />

          <Separator />

          <article>
            <MdxBody source={body} />
          </article>

          <Separator />

          <Checklist
            items={checklistItems}
            initialChecked={initialChecked}
            passed={summary?.state === "passed"}
            persist={
              signedIn
                ? async (itemId: string, checked: boolean) => {
                    "use server";
                    await toggleChecklistItem(itemId, checked);
                  }
                : null
            }
          />

          <QuestionFold
            questions={questions}
            save={
              signedIn
                ? async (input) => {
                    "use server";
                    await saveQuestionAttempt(input);
                  }
                : null
            }
          />

          <ReflectionBox
            prompt={frontmatter.reflection_prompt}
            initialBody={reflectionBody}
            initialPublic={myReflection?.isPublic ?? false}
            save={
              signedIn
                ? async (text: string) => {
                    "use server";
                    await saveReflection(row.id, text);
                  }
                : null
            }
            setVisibility={
              signedIn && summary?.state === "passed" && !summary.assumedPassed
                ? async (isPublic: boolean) => {
                    "use server";
                    await setReflectionVisibility(slug, isPublic);
                  }
                : null
            }
          />

          {showReflections ? (
            <>
              <Separator />
              <PublicReflections reflections={othersReflections} />
            </>
          ) : null}

          {isCapstone && showDiscussion ? (
            <>
              <Separator />
              <CapstonePanel
                submissions={capstones}
                mine={capstones.find((c) => c.isMine) ?? null}
                signedIn={signedIn}
                submit={async (kind, urlOrBody) => {
                  "use server";
                  await submitCapstone({ slug, kind, urlOrBody });
                }}
                withdraw={async () => {
                  "use server";
                  await withdrawCapstone(slug);
                }}
                review={async (artifactId, body) => {
                  "use server";
                  await postComment({ slug, body, artifactId });
                }}
              />
            </>
          ) : null}

          <Separator />

          <CommentThread
            comments={threadComments}
            signedIn={signedIn}
            post={async (body: string, parentId?: string) => {
              "use server";
              await postComment({ slug, body, parentId });
            }}
            remove={async (id: string) => {
              "use server";
              await deleteComment(slug, id);
            }}
          />
        </>
      ) : (
        <PlannedNode
          id={frontmatter.id}
          goal={frontmatter.goal}
          notes={frontmatter.notes}
          prereqTitles={prereqTitles}
        />
      )}

      <footer className="text-muted-foreground border-t pt-6 text-xs">
        Node {frontmatter.id} &middot; content hash{" "}
        <span className="font-mono">{contentHash.slice(0, 12)}</span>
      </footer>
    </main>
  );
}
