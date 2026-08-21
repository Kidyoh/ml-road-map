/**
 * M6's done-condition, as an executable check:
 *
 *   "two accounts can hold a threaded discussion on node 2.3"
 *
 * Plus the two visibility rules the social layer adds, which are the parts most
 * likely to regress silently:
 *
 *   - discussion follows the content lock, so a thread on 2.3 is not readable
 *     by somebody who has not unlocked 2.3
 *   - published reflections need a PASS, not merely an unlock
 *
 * Creates two throwaway accounts, removes them afterwards either way.
 *
 *   pnpm check:social
 */
import { config } from "dotenv";
import { and, asc, eq } from "drizzle-orm";

config({ path: ".env.local", quiet: true });

const ALICE = "social-check-alice";
const BOB = "social-check-bob";

let failures = 0;

function expect(label: string, actual: unknown, wanted: unknown) {
  const ok = actual === wanted;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(54)} ${String(actual)}${ok ? "" : `  (wanted ${String(wanted)})`}`,
  );
}

async function main() {
  const { db } = await import("../db/index");
  const {
    users,
    comments,
    reflections,
    nodeChecklist,
    nodeQuestions,
    checklistState,
    questionAttempts,
    nodeProgress,
  } = await import("../db/schema");
  const { loadComments, loadPublicReflections, canSeeDiscussion, canSeeReflections } =
    await import("../lib/social");
  const { buildGraph } = await import("../lib/progress");

  for (const id of [ALICE, BOB]) {
    await db.delete(users).where(eq(users.id, id));
  }
  await db.insert(users).values([
    { id: ALICE, name: "Alice", email: "social-alice@example.invalid" },
    { id: BOB, name: "Bob", email: "social-bob@example.invalid" },
  ]);

  try {
    // --- both accounts need 2.3 unlocked -----------------------------------
    // Rather than walking the whole prerequisite chain, use the practitioner
    // entry track, which assumes everything up to and including 2.3's parents.
    const alicePre = await buildGraph(ALICE, "practitioner");
    console.log("\nfresh accounts, practitioner track");
    // The practitioner track starts at 3.1, so 2.3 is one of its ancestors and
    // is marked passed by assumption rather than by work.
    expect("2.3 reads as passed for Alice", alicePre.byId.get("2.3")?.state, "passed");
    expect("...but only by assumption", alicePre.byId.get("2.3")?.assumedPassed, true);

    // A fresh account with no track has 2.3 locked - the contrast the
    // visibility rule depends on.
    const noTrack = await buildGraph(BOB, null);
    expect("2.3 locked without a track", noTrack.byId.get("2.3")?.state, "hidden");
    expect(
      "discussion hidden when node is locked",
      canSeeDiscussion(noTrack.byId.get("2.3")),
      false,
    );
    expect(
      "discussion visible when node is unlocked",
      canSeeDiscussion(alicePre.byId.get("2.3")),
      true,
    );

    // --- the threaded discussion -------------------------------------------
    const [root] = await db
      .insert(comments)
      .values({
        userId: ALICE,
        nodeId: "2.3",
        body: "I found the scaler and the login column but I am stuck on the third leak.",
      })
      .returning({ id: comments.id });

    const [reply] = await db
      .insert(comments)
      .values({
        userId: BOB,
        nodeId: "2.3",
        parentId: root.id,
        body: "Look at how many distinct values promo_code has, and how many rows each one covers.",
      })
      .returning({ id: comments.id });

    await db.insert(comments).values({
      userId: ALICE,
      nodeId: "2.3",
      parentId: root.id,
      body: "That did it. Four rows per code, so the encoding is a quarter of the answer.",
    });

    const thread = await loadComments("2.3", ALICE);

    console.log("\nthreaded discussion on 2.3  <- M6's done-condition");
    expect("top-level comments", thread.length, 1);
    expect("replies under the root", thread[0].replies.length, 2);
    expect("root is Alice's", thread[0].author.name, "Alice");
    expect("first reply is Bob's", thread[0].replies[0].author.name, "Bob");
    expect("Alice sees her own as deletable", thread[0].isMine, true);
    expect("Alice does not own Bob's reply", thread[0].replies[0].isMine, false);
    expect("timestamps are pre-formatted", typeof thread[0].createdAtLabel, "string");

    const bobView = await loadComments("2.3", BOB);
    expect("Bob sees the same thread", bobView[0].replies.length, 2);
    expect("Bob owns his reply", bobView[0].replies[0].isMine, true);
    void reply;

    // --- reflections need a pass, not an unlock ----------------------------
    await db.insert(reflections).values({
      userId: BOB,
      nodeId: "2.3",
      body: "What made it convincing was that the held-out score agreed with cross-validation, which I had been taught to treat as the check that settles it.",
      isPublic: true,
    });

    console.log("\npublished reflections need an EARNED pass");
    expect(
      "not visible on an entry track assumed pass",
      canSeeReflections(alicePre.byId.get("2.3")),
      false,
    );

    // Pass 2.3 as Alice, the way the UI would.
    const items = await db
      .select()
      .from(nodeChecklist)
      .where(eq(nodeChecklist.nodeId, "2.3"))
      .orderBy(asc(nodeChecklist.orderIndex));
    const qs = await db
      .select()
      .from(nodeQuestions)
      .where(eq(nodeQuestions.nodeId, "2.3"));

    await db.insert(nodeProgress).values({
      userId: ALICE,
      nodeId: "2.3",
      state: "in_progress",
      openedAt: new Date(),
      lastOpenedAt: new Date(),
      attemptCount: 1,
    });
    for (const item of items) {
      await db.insert(checklistState).values({
        userId: ALICE,
        checklistItemId: item.id,
        checked: true,
        checkedAt: new Date(),
      });
    }
    for (const q of qs) {
      await db.insert(questionAttempts).values({
        userId: ALICE,
        questionId: q.id,
        response: "an answer",
        selfRating: "got_it",
        revealedAt: new Date(),
      });
    }

    const alicePost = await buildGraph(ALICE, "practitioner");
    expect("2.3 now passed for Alice", alicePost.byId.get("2.3")?.state, "passed");
    expect("...and earned this time", alicePost.byId.get("2.3")?.assumedPassed, false);
    expect(
      "reflections now visible",
      canSeeReflections(alicePost.byId.get("2.3")),
      true,
    );

    const published = await loadPublicReflections("2.3", ALICE);
    expect("Bob's reflection is readable", published.length, 1);
    expect("attributed to Bob", published[0].author.name, "Bob");

    const bobsOwnView = await loadPublicReflections("2.3", BOB);
    expect("Bob does not see his own listed", bobsOwnView.length, 0);

    // --- deletion is scoped to the author ----------------------------------
    const notMine = await db
      .delete(comments)
      .where(and(eq(comments.id, root.id), eq(comments.userId, BOB)))
      .returning({ id: comments.id });
    console.log("\ndeletion is scoped to the author");
    expect("Bob cannot delete Alice's comment", notMine.length, 0);

    const mine = await db
      .delete(comments)
      .where(and(eq(comments.id, root.id), eq(comments.userId, ALICE)))
      .returning({ id: comments.id });
    expect("Alice can delete her own", mine.length, 1);

    const afterDelete = await loadComments("2.3", ALICE);
    expect("replies cascaded with the root", afterDelete.length, 0);
  } finally {
    for (const id of [ALICE, BOB]) {
      await db.delete(users).where(eq(users.id, id));
    }
    console.log("\ntest accounts removed.");
  }

  console.log(
    failures === 0
      ? "\nAll social assertions passed.\n"
      : `\n${failures} assertion(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
