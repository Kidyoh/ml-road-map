/**
 * Verification step 7: the reason seed is an upsert rather than a truncate.
 *
 * Creates a throwaway user with a ticked checklist item and a node_progress row,
 * then leaves them in place for a re-seed. Run with --check afterwards to see
 * whether they survived, and --cleanup to remove them.
 */
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";

config({ path: ".env.local", quiet: true });

const TEST_USER_ID = "seed-survival-test-user";
const TEST_ITEM_ID = "0.3:c:4";
const TEST_QUESTION_ID = "0.3:q:0";

async function main() {
  const mode = process.argv[2] ?? "--setup";
  const { db } = await import("../db/index");
  const {
    users,
    nodeChecklist,
    nodeQuestions,
    checklistState,
    questionAttempts,
    nodeProgress,
  } = await import("../db/schema");

  if (mode === "--cleanup") {
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
    console.log("test user and all its cascaded rows removed.\n");
    process.exit(0);
  }

  if (mode === "--setup") {
    await db
      .insert(users)
      .values({
        id: TEST_USER_ID,
        name: "Seed Survival Test",
        email: "seed-survival@example.invalid",
        entryTrack: "beginner",
      })
      .onConflictDoNothing();

    await db
      .insert(nodeProgress)
      .values({
        userId: TEST_USER_ID,
        nodeId: "0.3",
        state: "in_progress",
        openedAt: new Date(),
        attemptCount: 1,
      })
      .onConflictDoNothing();

    await db
      .insert(checklistState)
      .values({
        userId: TEST_USER_ID,
        checklistItemId: TEST_ITEM_ID,
        checked: true,
        checkedAt: new Date(),
      })
      .onConflictDoNothing();

    await db
      .insert(questionAttempts)
      .values({
        userId: TEST_USER_ID,
        questionId: TEST_QUESTION_ID,
        response: "A merge is a cartesian product within each key group.",
        selfRating: "partial",
        revealedAt: new Date(),
      })
      .onConflictDoNothing();

    console.log(`\nSeeded test progress for ${TEST_USER_ID}:`);
    console.log(`  checklist_state    ${TEST_ITEM_ID} = checked`);
    console.log(`  question_attempts  ${TEST_QUESTION_ID} = partial`);
    console.log(`  node_progress      0.3 = in_progress\n`);
    process.exit(0);
  }

  // --check
  const [tick] = await db
    .select()
    .from(checklistState)
    .where(
      and(
        eq(checklistState.userId, TEST_USER_ID),
        eq(checklistState.checklistItemId, TEST_ITEM_ID),
      ),
    );

  const [attempt] = await db
    .select()
    .from(questionAttempts)
    .where(eq(questionAttempts.userId, TEST_USER_ID));

  const [progress] = await db
    .select()
    .from(nodeProgress)
    .where(eq(nodeProgress.userId, TEST_USER_ID));

  const [item] = await db
    .select()
    .from(nodeChecklist)
    .where(eq(nodeChecklist.id, TEST_ITEM_ID));

  const [question] = await db
    .select()
    .from(nodeQuestions)
    .where(eq(nodeQuestions.id, TEST_QUESTION_ID));

  console.log("\nAfter re-seed:\n");
  console.log(`  checklist_state row     ${tick ? "SURVIVED" : "LOST"}  ${tick ? `(checked=${tick.checked})` : ""}`);
  console.log(`  question_attempts row   ${attempt ? "SURVIVED" : "LOST"}  ${attempt ? `(rating=${attempt.selfRating})` : ""}`);
  console.log(`  node_progress row       ${progress ? "SURVIVED" : "LOST"}  ${progress ? `(state=${progress.state})` : ""}`);
  console.log();
  console.log(`  the item it points at:  "${item?.item ?? "MISSING"}"`);
  console.log(`  the question it points at:`);
  console.log(`    "${(question?.prompt ?? "MISSING").slice(0, 90)}..."`);
  console.log();

  const allSurvived = Boolean(tick && attempt && progress);
  process.exit(allSurvived ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
