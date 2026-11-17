/**
 * The exam rules, as an executable check that needs no database.
 *
 * Runs in CI. It covers the three things that would be expensive to get wrong
 * and invisible until a learner hit them:
 *
 *   1. The grader. Every answer key in content/exams must be accepted when
 *      typed in, and a near miss must not be.
 *   2. The paper. A retake must never repeat a variant; the final must draw
 *      from every phase.
 *   3. The state machine. Locked, open, in progress, cooldown, passed and
 *      waived, derived from attempts and node progress.
 *
 *   pnpm check:exam-logic
 */
import { isFinalExam, isPhaseExam, loadAllExams } from "../lib/exam-content";
import {
  attemptStatus,
  buildPaper,
  deriveExamSummaries,
  gradePaper,
  sanitiseResponses,
  SUBMIT_GRACE_MS,
  unmetExamGates,
  type AttemptFacts,
  type NodeFacts,
} from "../lib/exam-rules";
import {
  correctNeeded,
  gradeResponse,
  parseNumericResponse,
  type ExamAnswer,
} from "../lib/exam-schema";

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, wanted: unknown) {
  checks++;
  const ok = Object.is(actual, wanted);
  if (!ok) failures++;
  if (!ok || process.argv.includes("--verbose")) {
    console.log(
      `  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(58)} ${String(actual)}${ok ? "" : `  (wanted ${String(wanted)})`}`,
    );
  }
}

/** Deterministic PRNG so a failure reproduces. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 60 * 60 * 1000;

async function main() {
  // --- 1. the grader -------------------------------------------------------
  console.log("\ngrader");
  const num = (value: number, tolerance = 0): ExamAnswer => ({ type: "number", value, tolerance });

  expect("parse 1,033", parseNumericResponse("1,033"), 1033);
  expect("parse ' 0.50 '", parseNumericResponse(" 0.50 "), 0.5);
  expect("parse .5", parseNumericResponse(".5"), 0.5);
  expect("parse -8", parseNumericResponse("-8"), -8);
  expect("parse 1e3", parseNumericResponse("1e3"), 1000);
  expect("parse 275,754.46", parseNumericResponse("275,754.46"), 275754.46);
  expect("reject 75%", parseNumericResponse("75%"), null);
  expect("reject 12ms", parseNumericResponse("12ms"), null);
  expect("reject empty", parseNumericResponse("  "), null);
  expect("reject 1,2 (not a thousands separator)", parseNumericResponse("1,2"), null);
  expect("reject Infinity", parseNumericResponse("Infinity"), null);

  expect("exact integer", gradeResponse(num(12), "12"), true);
  expect("exact integer, 12.0", gradeResponse(num(12), "12.0"), true);
  expect("integer off by one", gradeResponse(num(12), "13"), false);
  expect("inside tolerance", gradeResponse(num(0.136, 0.0005), "0.1364"), true);
  expect("on the tolerance edge", gradeResponse(num(0.136, 0.0005), "0.1365"), true);
  expect("outside tolerance", gradeResponse(num(0.136, 0.0005), "0.137"), false);
  expect("float noise absorbed", gradeResponse(num(0.3), String(0.1 + 0.2)), true);
  expect("blank is wrong", gradeResponse(num(0), ""), false);
  expect("undefined is wrong", gradeResponse(num(0), undefined), false);
  expect("zero answered as 0", gradeResponse(num(0), "0"), true);

  const shape: ExamAnswer = { type: "text", accept: ["(3, 4)", "3x4"] };
  expect("text ignores spaces", gradeResponse(shape, "(3,4)"), true);
  expect("text ignores case", gradeResponse(shape, "3X4"), true);
  expect("text alternative", gradeResponse(shape, " 3 x 4 "), true);
  expect("text wrong", gradeResponse(shape, "(4, 3)"), false);

  expect("7 of 10 at 70%", correctNeeded(10, 70), 7);
  expect("6 of 8 at 70%", correctNeeded(8, 70), 6);
  expect("10 of 14 at 70%", correctNeeded(14, 70), 10);
  expect("all of 5 at 100%", correctNeeded(5, 100), 5);

  // --- every real answer key ------------------------------------------------
  console.log("\ncontent/exams answer keys");
  const exams = await loadAllExams();
  const phaseExams = exams.filter(isPhaseExam);
  const final = exams.find(isFinalExam);
  let keys = 0;

  for (const exam of phaseExams) {
    for (const q of exam.frontmatter.questions) {
      q.variants.forEach((v, i) => {
        keys++;
        const where = `${exam.slug} ${q.id}[${i}]`;
        if (v.answer.type === "number") {
          const { value, tolerance } = v.answer;
          if (!gradeResponse(v.answer, String(value))) expect(`${where} accepts its key`, false, true);
          // Three tolerances out (or 1 for exact answers) must be a miss.
          const miss = value + Math.max(tolerance * 3, tolerance === 0 ? 1 : 0);
          if (gradeResponse(v.answer, String(miss))) expect(`${where} rejects ${miss}`, true, false);
        } else {
          for (const accepted of v.answer.accept) {
            if (!gradeResponse(v.answer, accepted)) expect(`${where} accepts "${accepted}"`, false, true);
          }
          if (gradeResponse(v.answer, "definitely-not-the-answer")) expect(`${where} rejects junk`, true, false);
        }
      });
    }
  }
  checks += keys;
  expect("answer keys checked", keys > 0, true);
  console.log(`  ${keys} keys accepted, near misses rejected`);

  // --- 2. the paper ---------------------------------------------------------
  console.log("\npaper");
  for (const exam of phaseExams) {
    const rand = mulberry32(exam.frontmatter.phase + 1);
    let previous = buildPaper(exam, exams, null, rand);
    expect(
      `${exam.slug}: paper has every question`,
      previous.length,
      exam.frontmatter.questions.length,
    );
    let repeats = 0;
    for (let round = 0; round < 25; round++) {
      const next = buildPaper(exam, exams, previous, rand);
      const before = new Map(previous.map((q) => [q.id, q.variant]));
      repeats += next.filter((q) => before.get(q.id) === q.variant).length;
      previous = next;
    }
    expect(`${exam.slug}: no variant repeats across 25 retakes`, repeats, 0);
  }

  if (final) {
    const rand = mulberry32(99);
    const perPhase = final.frontmatter.draw_per_phase;
    let previous = buildPaper(final, exams, null, rand);
    expect("final: question count", previous.length, phaseExams.length * perPhase);
    expect("final: ids unique", new Set(previous.map((q) => q.id)).size, previous.length);
    for (const exam of phaseExams) {
      expect(
        `final: ${perPhase} from phase ${exam.frontmatter.phase}`,
        previous.filter((q) => q.phase === exam.frontmatter.phase).length,
        perPhase,
      );
    }
    let repeats = 0;
    const seenIds = new Set<string>();
    for (let round = 0; round < 40; round++) {
      const next = buildPaper(final, exams, previous, rand);
      const before = new Map(previous.map((q) => [q.id, q.variant]));
      repeats += next.filter((q) => before.get(q.id) === q.variant).length;
      for (const q of next) seenIds.add(q.id);
      previous = next;
    }
    expect("final: no (question, variant) repeats on a retake", repeats, 0);
    const pool = phaseExams.reduce((n, e) => n + e.frontmatter.questions.length, 0);
    expect("final: draws range over the whole pool", seenIds.size, pool);
  } else {
    expect("a final exam exists", false, true);
  }

  // grading a whole paper, and the response sanitiser
  const sample = buildPaper(phaseExams[0], exams, null, mulberry32(7));
  const perfect = Object.fromEntries(
    sample.map((q) => [q.id, q.answer.type === "number" ? String(q.answer.value) : q.answer.accept[0]]),
  );
  const passMark = phaseExams[0].frontmatter.pass_mark;
  expect("perfect paper passes", gradePaper(sample, perfect, passMark).passed, true);
  expect("blank paper fails", gradePaper(sample, {}, passMark).passed, false);
  expect("null responses fail", gradePaper(sample, null, passMark).correct, 0);
  expect("empty paper cannot pass", gradePaper([], {}, passMark).passed, false);

  const needed = correctNeeded(sample.length, passMark);
  const justEnough = Object.fromEntries(Object.entries(perfect).slice(0, needed));
  const oneShort = Object.fromEntries(Object.entries(perfect).slice(0, needed - 1));
  expect("exactly the pass mark passes", gradePaper(sample, justEnough, passMark).passed, true);
  expect("one short of the pass mark fails", gradePaper(sample, oneShort, passMark).passed, false);

  const dirty = sanitiseResponses(sample, {
    [sample[0].id]: "  42  ",
    "not-on-this-paper": "1",
    [sample[1].id]: 7,
    [sample[2].id]: "x".repeat(500),
  });
  expect("sanitise trims", dirty[sample[0].id], "42");
  expect("sanitise drops unknown ids", "not-on-this-paper" in dirty, false);
  expect("sanitise drops non-strings", sample[1].id in dirty, false);
  expect("sanitise bounds length", dirty[sample[2].id].length, 120);
  expect("sanitise survives junk input", Object.keys(sanitiseResponses(sample, "nope")).length, 0);

  // --- 3. the state machine -------------------------------------------------
  console.log("\nexam states");
  const nodes: NodeFacts[] = [];
  for (let phase = 0; phase <= 7; phase++) {
    for (let i = 1; i <= 2; i++) nodes.push({ id: `${phase}.${i}`, phase, status: "published" });
  }
  const t0 = new Date("2026-01-01T12:00:00Z");
  const at = (ms: number) => new Date(t0.getTime() + ms);

  const derive = (
    passedNodes: string[],
    attempts: AttemptFacts[],
    now: Date,
    opts: { startPhase?: number; unlockAll?: boolean } = {},
  ) => {
    const list = deriveExamSummaries({
      exams,
      nodes,
      passedNodes: new Set(passedNodes),
      attempts,
      startPhase: opts.startPhase ?? 0,
      unlockAll: opts.unlockAll ?? false,
      now,
    });
    return new Map(list.map((e) => [e.id, e]));
  };

  const attempt = (
    examId: string,
    startedAt: Date,
    outcome: "open" | "passed" | "failed",
    total = 10,
  ): AttemptFacts => ({
    id: `${examId}-${startedAt.getTime()}`,
    examId,
    startedAt,
    deadlineAt: new Date(startedAt.getTime() + 45 * 60 * 1000),
    submittedAt: outcome === "open" ? null : new Date(startedAt.getTime() + 20 * 60 * 1000),
    correct: outcome === "open" ? null : outcome === "passed" ? 9 : 3,
    passed: outcome === "open" ? null : outcome === "passed",
    total,
  });

  let s = derive([], [], t0);
  expect("fresh: exam-0 locked", s.get("exam-0")?.state, "locked");
  expect("fresh: exam-0 waits on 2 nodes", s.get("exam-0")?.blockingNodeIds.length, 2);
  expect("fresh: final locked", s.get("exam-final")?.state, "locked");
  expect("fresh: phase 1 gated by exam-0", unmetExamGates(1, exams, s).map((e) => e.id).join(), "exam-0");
  expect("fresh: phase 0 gated by nothing", unmetExamGates(0, exams, s).length, 0);
  expect(
    "fresh: phase 7 gated by every exam",
    unmetExamGates(7, exams, s).length,
    exams.length,
  );

  s = derive(["0.1"], [], t0);
  expect("half the phase: exam-0 still locked", s.get("exam-0")?.state, "locked");

  s = derive(["0.1", "0.2"], [], t0);
  expect("phase done: exam-0 open", s.get("exam-0")?.state, "open");
  expect("phase done: exam-1 still locked", s.get("exam-1")?.state, "locked");

  const running = attempt("exam-0", t0, "open");
  s = derive(["0.1", "0.2"], [running], at(10 * 60 * 1000));
  expect("running: in_progress", s.get("exam-0")?.state, "in_progress");
  expect("running: active attempt id", s.get("exam-0")?.activeAttemptId, running.id);

  expect("status inside the grace", attemptStatus(running, at(45 * 60 * 1000 + SUBMIT_GRACE_MS)), "active");
  expect("status past the grace", attemptStatus(running, at(45 * 60 * 1000 + SUBMIT_GRACE_MS + 1)), "expired");

  s = derive(["0.1", "0.2"], [running], at(2 * HOUR));
  expect("abandoned: cooldown, not in_progress", s.get("exam-0")?.state, "cooldown");
  expect("abandoned: phase 1 still gated", unmetExamGates(1, exams, s).length, 1);

  const cooldownMs = phaseExams[0].frontmatter.cooldown_hours * HOUR;
  const failed = attempt("exam-0", t0, "failed");
  s = derive(["0.1", "0.2"], [failed], at(HOUR));
  expect("failed: cooldown", s.get("exam-0")?.state, "cooldown");
  expect(
    "failed: retry time is end + cooldown",
    s.get("exam-0")?.retryAt?.getTime(),
    failed.submittedAt!.getTime() + cooldownMs,
  );
  s = derive(["0.1", "0.2"], [failed], at(20 * 60 * 1000 + cooldownMs + 1));
  expect("after the cooldown: open again", s.get("exam-0")?.state, "open");
  expect("after the cooldown: attempt counted", s.get("exam-0")?.attemptCount, 1);
  expect("after the cooldown: best score kept", s.get("exam-0")?.bestCorrect, 3);

  const passed = attempt("exam-0", at(13 * HOUR), "passed");
  s = derive(["0.1", "0.2"], [failed, passed], at(14 * HOUR));
  expect("passed: state", s.get("exam-0")?.state, "passed");
  expect("passed: best is the pass", s.get("exam-0")?.bestCorrect, 9);
  expect("passed: phase 1 open", unmetExamGates(1, exams, s).length, 0);
  expect("passed: phase 2 gated by exam-1", unmetExamGates(2, exams, s).map((e) => e.id).join(), "exam-1");

  // A pass is permanent: a later failed row must not undo it.
  s = derive(["0.1", "0.2"], [passed, attempt("exam-0", at(20 * HOUR), "failed")], at(21 * HOUR));
  expect("a pass survives a later fail", s.get("exam-0")?.state, "passed");

  // Entry track: practitioner starts in phase 3.
  s = derive([], [], t0, { startPhase: 3 });
  expect("track: exam-0 waived", s.get("exam-0")?.waived, true);
  expect("track: exam-2 waived", s.get("exam-2")?.waived, true);
  expect("track: exam-3 not waived", s.get("exam-3")?.waived, false);
  expect("track: phase 3 gated by nothing", unmetExamGates(3, exams, s).length, 0);
  expect("track: phase 4 gated by exam-3 only", unmetExamGates(4, exams, s).map((e) => e.id).join(), "exam-3");
  expect("track: final never waived", s.get("exam-final")?.waived, false);

  // The final opens on the last phase exam.
  const allPhasePasses = phaseExams.map((e, i) => attempt(e.id, at(i * HOUR), "passed"));
  s = derive([], allPhasePasses.slice(0, -1), at(100 * HOUR));
  expect("final: locked with one phase exam left", s.get("exam-final")?.state, "locked");
  expect("final: names the missing exam", s.get("exam-final")?.blockingExamIds.length, 1);
  s = derive([], allPhasePasses, at(100 * HOUR));
  expect("final: open once all are passed", s.get("exam-final")?.state, "open");
  expect("final: capstone still gated by it", unmetExamGates(7, exams, s).map((e) => e.id).join(), "exam-final");
  s = derive([], [...allPhasePasses, attempt("exam-final", at(101 * HOUR), "passed", 14)], at(102 * HOUR));
  expect("final passed: capstone open", unmetExamGates(7, exams, s).length, 0);

  // Waived exams count towards the final.
  s = derive([], allPhasePasses.slice(3), at(100 * HOUR), { startPhase: 3 });
  expect("final: waived exams do not block it", s.get("exam-final")?.state, "open");

  // The guest account.
  s = derive([], [], t0, { unlockAll: true });
  expect("guest: every exam open", [...s.values()].every((e) => e.state === "open"), true);

  console.log(
    failures === 0
      ? `\nAll ${checks} exam-logic assertions passed.\n`
      : `\n${failures} of ${checks} exam-logic assertions FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
