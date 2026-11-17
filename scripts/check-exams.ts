/**
 * Exams end to end, against a real database:
 *
 *   "finishing phase 0 opens its exam and nothing in phase 1; a timed-out
 *    attempt and a failed attempt each leave phase 1 locked and never show an
 *    answer key; a pass opens phase 1"
 *
 * Creates a throwaway user, passes every phase 0 node the way the UI would,
 * then sits the phase 0 exam three times - late, wrong, right - asserting the
 * derived state at each step. Time is injected, so the cooldown is tested
 * without waiting for it. Removes the user afterwards either way.
 *
 *   pnpm check:exams
 */
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";

config({ path: ".env.local", quiet: true });

const TEST_USER_ID = "exam-check-user";
const HOUR = 60 * 60 * 1000;

let failures = 0;

function expect(label: string, actual: unknown, wanted: unknown) {
  const ok = actual === wanted;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(56)} ${String(actual)}${ok ? "" : `  (wanted ${String(wanted)})`}`,
  );
}

async function throws(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return false;
  } catch {
    return true;
  }
}

async function main() {
  const { db } = await import("../db/index");
  const {
    users,
    nodes,
    nodeChecklist,
    nodeQuestions,
    checklistState,
    questionAttempts,
    examAttempts,
    struggleEvents,
  } = await import("../db/schema");
  const { buildGraph } = await import("../lib/progress");
  const {
    startAttempt,
    submitAttempt,
    loadAttemptViews,
    issueCertificate,
    certificateStatus,
  } = await import("../lib/exams");

  await db.delete(users).where(eq(users.id, TEST_USER_ID));
  await db.insert(users).values({
    id: TEST_USER_ID,
    name: "Exam Check",
    email: "exam-check@example.invalid",
  });

  const passNode = async (nodeId: string) => {
    const items = await db.select().from(nodeChecklist).where(eq(nodeChecklist.nodeId, nodeId));
    const questions = await db.select().from(nodeQuestions).where(eq(nodeQuestions.nodeId, nodeId));
    for (const item of items) {
      await db.insert(checklistState).values({
        userId: TEST_USER_ID,
        checklistItemId: item.id,
        checked: true,
        checkedAt: new Date(),
      });
    }
    for (const q of questions) {
      await db.insert(questionAttempts).values({
        userId: TEST_USER_ID,
        questionId: q.id,
        response: "check",
        selfRating: "got_it",
        revealedAt: new Date(),
      });
    }
  };

  const paperOf = async (attemptId: string) => {
    const [row] = await db.select().from(examAttempts).where(eq(examAttempts.id, attemptId));
    return row.paper;
  };

  const leaks = (views: Awaited<ReturnType<typeof loadAttemptViews>>) =>
    views.some((v) => v.questions.some((q) => q.answer !== undefined || q.explanation !== undefined));

  try {
    let now = new Date("2026-03-01T09:00:00Z");
    const graphAt = () => buildGraph(TEST_USER_ID, null, now);

    // --- before the phase is finished --------------------------------------
    console.log("\nfresh account");
    let graph = await graphAt();
    expect("exam-0 state", graph.examById.get("exam-0")?.state, "locked");
    expect("starting a locked exam is refused", await throws(() => startAttempt(TEST_USER_ID, null, "phase-0", now)), true);

    const phaseZero = (await db.select().from(nodes).where(eq(nodes.phase, 0))).map((n) => n.id);
    const phaseOne = (await db.select().from(nodes).where(eq(nodes.phase, 1))).map((n) => n.id);
    for (const id of phaseZero) await passNode(id);

    console.log("\nevery phase 0 node passed");
    graph = await graphAt();
    expect("exam-0 state", graph.examById.get("exam-0")?.state, "open");
    expect(
      "no phase 1 node is open",
      phaseOne.every((id) => ["fogged", "hidden"].includes(graph.byId.get(id)!.state)),
      true,
    );
    const firstPhaseOne = phaseOne.find((id) => graph.byId.get(id)!.prereqs.every((p) => graph.byId.get(p)!.state === "passed"))!;
    expect(`${firstPhaseOne} is fogged, not hidden`, graph.byId.get(firstPhaseOne)?.state, "fogged");
    expect(`${firstPhaseOne} names exam-0 as its gate`, graph.byId.get(firstPhaseOne)?.examGates.join(), "exam-0");
    expect("exam-1 is refused", await throws(() => startAttempt(TEST_USER_ID, null, "phase-1", now)), true);
    expect("the final is refused", await throws(() => startAttempt(TEST_USER_ID, null, "final", now)), true);

    // --- attempt 1: runs out of time ---------------------------------------
    console.log("\nattempt 1 - submitted after the deadline");
    const first = await startAttempt(TEST_USER_ID, null, "phase-0", now);
    const again = await startAttempt(TEST_USER_ID, null, "phase-0", now);
    expect("a second start returns the same attempt", again.attemptId, first.attemptId);

    graph = await graphAt();
    expect("exam-0 state", graph.examById.get("exam-0")?.state, "in_progress");
    let views = await loadAttemptViews(TEST_USER_ID, "exam-0", false, now);
    expect("open attempt carries no answer keys", leaks(views), false);
    expect("open attempt carries no marks", views[0].questions.every((q) => q.correct === undefined), true);

    const firstPaper = await paperOf(first.attemptId);
    const rightAnswers = (paper: typeof firstPaper) =>
      Object.fromEntries(
        paper.map((q) => [q.id, q.answer.type === "number" ? String(q.answer.value) : q.answer.accept[0]]),
      );

    now = new Date(now.getTime() + 2 * HOUR);
    const lateResult = await submitAttempt(TEST_USER_ID, first.attemptId, rightAnswers(firstPaper), now);
    expect("late submit is not graded", lateResult.passed, false);
    expect("late submit is marked timed out", lateResult.timedOut, true);
    graph = await graphAt();
    expect("exam-0 state", graph.examById.get("exam-0")?.state, "cooldown");
    expect("starting during the cooldown is refused", await throws(() => startAttempt(TEST_USER_ID, null, "phase-0", now)), true);

    // --- attempt 2: wrong answers ------------------------------------------
    console.log("\nattempt 2 - after the cooldown, answered wrong");
    now = new Date(now.getTime() + 13 * HOUR);
    graph = await graphAt();
    expect("exam-0 state", graph.examById.get("exam-0")?.state, "open");

    const second = await startAttempt(TEST_USER_ID, null, "phase-0", now);
    const secondPaper = await paperOf(second.attemptId);
    const before = new Map(firstPaper.map((q) => [q.id, q.variant]));
    expect(
      "every question is a different variant",
      secondPaper.every((q) => before.get(q.id) !== q.variant),
      true,
    );

    const wrong = Object.fromEntries(secondPaper.map((q) => [q.id, "-987654321"]));
    const failResult = await submitAttempt(TEST_USER_ID, second.attemptId, wrong, now);
    expect("wrong answers fail", failResult.passed, false);
    expect("wrong answers score zero", failResult.correct, 0);

    const resubmit = await submitAttempt(TEST_USER_ID, second.attemptId, rightAnswers(secondPaper), now);
    expect("a second submit cannot change the result", resubmit.passed, false);

    views = await loadAttemptViews(TEST_USER_ID, "exam-0", false, now);
    expect("failed attempts carry no answer keys", leaks(views), false);
    expect("failed attempt shows what was wrong", views[0].questions.every((q) => q.correct === false), true);

    const misses = await db
      .select()
      .from(struggleEvents)
      .where(and(eq(struggleEvents.userId, TEST_USER_ID), eq(struggleEvents.signal, "exam_question_missed")));
    expect("one struggle event per missed question", misses.length, secondPaper.length);
    expect("the timed-out attempt logged none", misses.every((m) => phaseZero.includes(m.nodeId)), true);

    graph = await graphAt();
    expect(`${firstPhaseOne} still locked`, graph.byId.get(firstPhaseOne)?.state, "fogged");

    // --- attempt 3: right answers ------------------------------------------
    console.log("\nattempt 3 - answered right");
    now = new Date(now.getTime() + 13 * HOUR);
    const third = await startAttempt(TEST_USER_ID, null, "phase-0", now);
    const thirdPaper = await paperOf(third.attemptId);
    const passResult = await submitAttempt(TEST_USER_ID, third.attemptId, rightAnswers(thirdPaper), now);
    expect("right answers pass", passResult.passed, true);
    expect("full marks", passResult.correct, thirdPaper.length);

    graph = await graphAt();
    expect("exam-0 state", graph.examById.get("exam-0")?.state, "passed");
    expect("attempts counted", graph.examById.get("exam-0")?.attemptCount, 3);
    expect(`${firstPhaseOne} is open`, graph.byId.get(firstPhaseOne)?.state, "open");
    expect(`${firstPhaseOne} has no exam gate`, graph.byId.get(firstPhaseOne)?.examGates.length, 0);
    expect("a passed exam cannot be retaken", await throws(() => startAttempt(TEST_USER_ID, null, "phase-0", now)), true);

    views = await loadAttemptViews(TEST_USER_ID, "exam-0", true, now);
    expect("after passing, worked solutions are shown", views[0].questions.every((q) => Boolean(q.explanation)), true);

    // --- someone else's attempt, and the certificate -----------------------
    console.log("\nboundaries");
    expect(
      "another user cannot submit this attempt",
      await throws(() => submitAttempt("somebody-else", third.attemptId, {}, now)),
      true,
    );
    expect("certificate not eligible", certificateStatus(graph, TEST_USER_ID).eligible, false);
    expect("certificate is refused", await throws(() => issueCertificate(TEST_USER_ID, null, "Exam Check")), true);
  } finally {
    // Cascades to attempts, ticks, answers and struggle events.
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
  }

  console.log(failures === 0 ? "\nAll exam assertions passed.\n" : `\n${failures} exam assertion(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
