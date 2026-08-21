/**
 * M3's done-condition, as an executable check:
 *
 *   "passing 0.1 on a fresh second account unlocks 0.2, and 2.3 stays fogged"
 *
 * Creates a throwaway user, walks it through passing node 0.1 the same way the
 * UI would, and asserts the derived states at each step. Removes the user
 * afterwards, whether or not the assertions held.
 *
 *   pnpm check:gating
 */
import { config } from "dotenv";
import { eq } from "drizzle-orm";

config({ path: ".env.local", quiet: true });

const TEST_USER_ID = "gating-check-user";

let failures = 0;

function expect(label: string, actual: unknown, wanted: unknown) {
  const ok = actual === wanted;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(52)} ${String(actual)}${ok ? "" : `  (wanted ${String(wanted)})`}`,
  );
}

async function main() {
  const { db } = await import("../db/index");
  const {
    users,
    nodeChecklist,
    nodeQuestions,
    checklistState,
    questionAttempts,
    nodeProgress,
    struggleEvents,
  } = await import("../db/schema");
  const { buildGraph } = await import("../lib/progress");

  // Clean slate, in case a previous run died mid-way.
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
  await db.insert(users).values({
    id: TEST_USER_ID,
    name: "Gating Check",
    email: "gating-check@example.invalid",
  });

  try {
    // --- fresh account, no entry track ------------------------------------
    let graph = await buildGraph(TEST_USER_ID, null);
    console.log("\nfresh account, no entry track");
    expect("0.1 state", graph.byId.get("0.1")?.state, "open");
    expect("0.2 state", graph.byId.get("0.2")?.state, "fogged");
    expect("0.3 state", graph.byId.get("0.3")?.state, "hidden");
    expect("2.3 state", graph.byId.get("2.3")?.state, "hidden");
    expect("resume node", graph.resumeNodeId, null);

    // --- tick every checklist item on 0.1 ---------------------------------
    const items = await db
      .select()
      .from(nodeChecklist)
      .where(eq(nodeChecklist.nodeId, "0.1"));

    await db.insert(nodeProgress).values({
      userId: TEST_USER_ID,
      nodeId: "0.1",
      state: "in_progress",
      openedAt: new Date(),
      attemptCount: 1,
    });

    for (const item of items) {
      await db.insert(checklistState).values({
        userId: TEST_USER_ID,
        checklistItemId: item.id,
        checked: true,
        checkedAt: new Date(),
      });
    }

    graph = await buildGraph(TEST_USER_ID, null);
    console.log("\nchecklist fully ticked, questions NOT yet rated");
    expect("0.1 state", graph.byId.get("0.1")?.state, "in_progress");
    expect("0.2 still locked", graph.byId.get("0.2")?.state, "fogged");
    expect("resume node", graph.resumeNodeId, "0.1");

    // --- rate every question, but leave one unrated first ------------------
    const questions = await db
      .select()
      .from(nodeQuestions)
      .where(eq(nodeQuestions.nodeId, "0.1"));

    for (const q of questions.slice(0, -1)) {
      await db.insert(questionAttempts).values({
        userId: TEST_USER_ID,
        questionId: q.id,
        response: "an answer",
        selfRating: "got_it",
        revealedAt: new Date(),
      });
    }

    graph = await buildGraph(TEST_USER_ID, null);
    console.log("\nall but one question rated");
    expect("0.1 state", graph.byId.get("0.1")?.state, "in_progress");
    expect("0.2 still locked", graph.byId.get("0.2")?.state, "fogged");

    // Revealing without writing anything is a struggle signal.
    const last = questions[questions.length - 1];
    await db.insert(questionAttempts).values({
      userId: TEST_USER_ID,
      questionId: last.id,
      response: null,
      selfRating: "partial",
      revealedAt: new Date(),
    });

    graph = await buildGraph(TEST_USER_ID, null);
    console.log("\n0.1 fully passed  <- M3's done-condition");
    expect("0.1 state", graph.byId.get("0.1")?.state, "passed");
    expect("0.2 UNLOCKED", graph.byId.get("0.2")?.state, "open");
    expect("0.4 UNLOCKED (also depends on 0.1)", graph.byId.get("0.4")?.state, "open");
    expect("0.3 now one level out", graph.byId.get("0.3")?.state, "fogged");
    expect("2.3 stays hidden", graph.byId.get("2.3")?.state, "hidden");

    // --- content coverage ---------------------------------------------------
    // These assertions moved when M5 landed: 0.2 used to be a planned node with
    // no checklist, and is now written. Asserting the current shape rather than
    // the historical one is the point of keeping the check.
    console.log("\ncontent coverage");
    const plannedNodes = graph.nodes.filter((n) => n.status === "planned");
    expect("all 40 nodes present", graph.nodes.length, 40);
    expect("planned nodes remaining", plannedNodes.length, 0);
    expect("0.2 is published", graph.byId.get("0.2")?.status, "published");

    /*
     * The invariant a planned node exercised is still worth asserting: a node
     * with nothing to verify can never be passed, or the whole roadmap would
     * unlock through nodes nobody wrote. Stated over the graph rather than over
     * one node, so it keeps holding as content changes.
     */
    const unverifiable = graph.nodes.filter(
      (n) => n.checklistTotal === 0 || n.questionsTotal === 0,
    );
    expect(
      "no node with nothing to verify is passed",
      unverifiable.every((n) => n.state !== "passed"),
      true,
    );
    console.log(
      `        (${unverifiable.length} node(s) currently have no checklist or no questions)`,
    );

    // --- entry tracks -------------------------------------------------------
    const developer = await buildGraph(TEST_USER_ID, "developer");
    console.log("\ndeveloper track (starts at 1.1)");
    expect("1.1 open", developer.byId.get("1.1")?.state, "open");
    expect("0.2 assumed passed", developer.byId.get("0.2")?.state, "passed");
    expect("0.2 marked assumed", developer.byId.get("0.2")?.assumedPassed, true);
    expect(
      "0.5 NOT assumed (not an ancestor of 1.1)",
      developer.byId.get("0.5")?.state === "passed",
      false,
    );

    const practitioner = await buildGraph(TEST_USER_ID, "practitioner");
    console.log("\npractitioner track (starts at 3.1)");
    expect("3.1 open", practitioner.byId.get("3.1")?.state, "open");
    expect("2.3 assumed passed", practitioner.byId.get("2.3")?.state, "passed");
    expect("2.2 assumed passed", practitioner.byId.get("2.2")?.state, "passed");
    expect(
      "2.4 open (depends only on 2.3)",
      practitioner.byId.get("2.4")?.state,
      "open",
    );

    // --- struggle events written -------------------------------------------
    const events = await db
      .select()
      .from(struggleEvents)
      .where(eq(struggleEvents.userId, TEST_USER_ID));
    console.log(`\nstruggle_events written directly by this script: ${events.length}`);
  } finally {
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
    console.log("\ntest user removed.");
  }

  console.log(
    failures === 0
      ? "\nAll gating assertions passed.\n"
      : `\n${failures} assertion(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
