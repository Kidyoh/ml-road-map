import "server-only";

/**
 * Exam attempts: starting one, submitting one, and reading them back.
 *
 * The rules themselves are pure functions in lib/exam-rules.ts. This file is
 * the part that touches Postgres, and it is kept out of the actions module so
 * that scripts/check-exams.ts can drive it without booting Next - same split
 * as assertNodeUnlocked in lib/progress.ts.
 *
 * One invariant runs through everything here: an answer key or a worked
 * solution never leaves this file for an exam the learner has not passed.
 * Papers are stored whole, and `toAttemptView` is the only way out.
 */
import { randomBytes } from "node:crypto";

import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { certificates, examAttempts } from "@/db/schema";
import { loadAllExamsCached, type LoadedExam } from "@/lib/exam-content";
import {
  attemptStatus,
  buildPaper,
  gradePaper,
  sanitiseResponses,
  SUBMIT_GRACE_MS,
  type AttemptStatus,
} from "@/lib/exam-rules";
import { FINAL_EXAM_ID, type ExamAnswer } from "@/lib/exam-schema";
import { isGuestUser } from "@/lib/guest";
import { buildGraph, type EntryTrack, type Graph } from "@/lib/progress";
import { emitStruggle } from "@/lib/struggle";

type AttemptRow = typeof examAttempts.$inferSelect;

/** The capstone. A certificate needs it passed as well as the final exam. */
export const CAPSTONE_NODE_ID = "7.1";

/* ------------------------------------------------------------------ views */

export type QuestionView = {
  id: string;
  covers: string;
  phase: number;
  prompt: string;
  /** Tells the input which keyboard to offer. Says nothing about the answer. */
  answerType: ExamAnswer["type"];
  /** Present once the attempt is submitted. */
  response?: string | null;
  correct?: boolean;
  /** Present only when the learner has PASSED this exam. */
  answer?: string;
  explanation?: string;
};

export type AttemptView = {
  id: string;
  examId: string;
  status: AttemptStatus;
  startedAt: Date;
  deadlineAt: Date;
  submittedAt: Date | null;
  /** True when the deadline passed with nothing submitted. */
  timedOut: boolean;
  correct: number | null;
  total: number;
  needed: number;
  passMark: number;
  questions: QuestionView[];
};

function displayAnswer(answer: ExamAnswer): string {
  if (answer.type === "text") return answer.accept[0];
  return answer.tolerance > 0
    ? `${answer.value} (accepted within ±${answer.tolerance})`
    : String(answer.value);
}

/**
 * The only route from a stored attempt to anything a page may render.
 *
 *   open attempt      prompts only
 *   failed / expired  prompts, what was typed, right or wrong - NOT the key
 *   exam passed       everything, including the worked solutions
 *
 * Withholding the key after a fail is deliberate. The retake draws different
 * variants, but they test the same skills; handing over worked solutions would
 * turn the cooldown into a reading period.
 */
export function toAttemptView(
  row: AttemptRow,
  examPassed: boolean,
  now: Date,
): AttemptView {
  const status = attemptStatus(
    { ...row, total: row.paper.length },
    now,
  );
  const open = status === "active";
  const graded = gradePaper(row.paper, row.responses, row.passMark);
  const correctById = new Map(graded.questions.map((q) => [q.id, q.correct]));

  return {
    id: row.id,
    examId: row.examId,
    status,
    startedAt: row.startedAt,
    deadlineAt: row.deadlineAt,
    submittedAt: row.submittedAt,
    timedOut: status === "expired" || (row.submittedAt !== null && row.responses === null),
    correct: open ? null : status === "expired" ? 0 : row.correct,
    total: row.paper.length,
    needed: graded.needed,
    passMark: row.passMark,
    questions: row.paper.map((q): QuestionView => {
      const base: QuestionView = {
        id: q.id,
        covers: q.covers,
        phase: q.phase,
        prompt: q.prompt,
        answerType: q.answer.type,
      };
      if (open) return base;
      return {
        ...base,
        response: row.responses?.[q.id] ?? null,
        correct: correctById.get(q.id) ?? false,
        ...(examPassed
          ? { answer: displayAnswer(q.answer), explanation: q.explanation }
          : {}),
      };
    }),
  };
}

/* ------------------------------------------------------------- start exam */

export class ExamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExamError";
  }
}

const isUniqueViolation = (err: unknown) => {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    if ((current as { code?: string }).code === "23505") return true;
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

/**
 * Close attempts whose deadline has gone. Their status is already derived as
 * "expired" on every read; writing it down is only so the one-open-attempt
 * index stops counting them and a new attempt can begin.
 */
async function closeExpiredAttempts(userId: string, examId: string, now: Date) {
  await db
    .update(examAttempts)
    .set({
      submittedAt: sql`${examAttempts.deadlineAt}`,
      correct: 0,
      passed: false,
      responses: null,
    })
    .where(
      and(
        eq(examAttempts.userId, userId),
        eq(examAttempts.examId, examId),
        isNull(examAttempts.submittedAt),
        lt(examAttempts.deadlineAt, new Date(now.getTime() - SUBMIT_GRACE_MS)),
      ),
    );
}

async function openAttempt(userId: string, examId: string) {
  const [row] = await db
    .select()
    .from(examAttempts)
    .where(
      and(
        eq(examAttempts.userId, userId),
        eq(examAttempts.examId, examId),
        isNull(examAttempts.submittedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Start an attempt, or return the one already running.
 *
 * Refuses unless the derived state says the exam is open. Like
 * assertNodeUnlocked, this is the check that matters: the Start button is not
 * rendered for a locked exam, but a server action can be called by anyone.
 */
export async function startAttempt(
  userId: string,
  entryTrack: EntryTrack | null,
  slug: string,
  now: Date = new Date(),
  rand: () => number = Math.random,
): Promise<{ attemptId: string }> {
  const exams = await loadAllExamsCached();
  const exam = exams.find((e) => e.slug === slug);
  if (!exam) throw new ExamError(`No exam "${slug}"`);

  const graph = await buildGraph(userId, entryTrack, now);
  const summary = graph.examById.get(exam.id);
  if (!summary) throw new ExamError(`No exam "${slug}"`);

  if (summary.state === "in_progress" && summary.activeAttemptId) {
    return { attemptId: summary.activeAttemptId };
  }
  if (summary.state === "passed") {
    throw new ExamError("You have already passed this exam.");
  }
  if (summary.state === "locked") {
    throw new ExamError("This exam is locked - finish the phase first.");
  }
  if (summary.state === "cooldown") {
    throw new ExamError("This exam is cooling down after your last attempt.");
  }

  await closeExpiredAttempts(userId, exam.id, now);

  const [previous] = await db
    .select({ paper: examAttempts.paper })
    .from(examAttempts)
    .where(and(eq(examAttempts.userId, userId), eq(examAttempts.examId, exam.id)))
    .orderBy(desc(examAttempts.startedAt))
    .limit(1);

  const paper = buildPaper(exam, exams, previous?.paper ?? null, rand);
  if (paper.length === 0) throw new ExamError("This exam has no questions.");

  try {
    const [created] = await db
      .insert(examAttempts)
      .values({
        userId,
        examId: exam.id,
        paper,
        passMark: exam.frontmatter.pass_mark,
        startedAt: now,
        deadlineAt: new Date(
          now.getTime() + exam.frontmatter.time_limit_minutes * 60 * 1000,
        ),
      })
      .returning({ id: examAttempts.id });
    return { attemptId: created.id };
  } catch (err) {
    // Two tabs pressed Start together. The index let one through; hand the
    // other the same attempt rather than an error.
    if (!isUniqueViolation(err)) throw err;
    const existing = await openAttempt(userId, exam.id);
    if (!existing) throw err;
    return { attemptId: existing.id };
  }
}

/* ------------------------------------------------------------ submit exam */

export type SubmitResult = {
  examId: string;
  correct: number;
  total: number;
  passed: boolean;
  timedOut: boolean;
};

/**
 * Grade and close an attempt. Idempotent: a second submit of the same attempt
 * (the timer firing as the learner clicks) returns the first result and
 * changes nothing.
 */
export async function submitAttempt(
  userId: string,
  attemptId: string,
  rawResponses: unknown,
  now: Date = new Date(),
): Promise<SubmitResult> {
  const [attempt] = await db
    .select()
    .from(examAttempts)
    .where(and(eq(examAttempts.id, attemptId), eq(examAttempts.userId, userId)))
    .limit(1);

  if (!attempt) throw new ExamError("No such attempt.");

  const resultOf = (row: AttemptRow): SubmitResult => ({
    examId: row.examId,
    correct: row.correct ?? 0,
    total: row.paper.length,
    passed: row.passed === true,
    timedOut: row.responses === null,
  });

  if (attempt.submittedAt) return resultOf(attempt);

  // The deadline is the server's, not the browser's. Past it (plus the grace)
  // nothing that arrives is graded - otherwise the time limit is a suggestion.
  const late = now.getTime() > attempt.deadlineAt.getTime() + SUBMIT_GRACE_MS;
  const responses = late ? null : sanitiseResponses(attempt.paper, rawResponses);
  const graded = gradePaper(attempt.paper, responses, attempt.passMark);

  const [updated] = await db
    .update(examAttempts)
    .set({
      submittedAt: late ? attempt.deadlineAt : now,
      responses,
      correct: graded.correct,
      passed: graded.passed,
    })
    // The guard makes the write itself idempotent, not just the read above.
    .where(and(eq(examAttempts.id, attemptId), isNull(examAttempts.submittedAt)))
    .returning();

  if (!updated) {
    const [current] = await db
      .select()
      .from(examAttempts)
      .where(eq(examAttempts.id, attemptId))
      .limit(1);
    return resultOf(current);
  }

  // An auto-graded miss is the least self-reported struggle signal there is.
  // A timed-out attempt is skipped: "every question wrong" there measures the
  // clock, not the nodes.
  if (!late) {
    await Promise.all(
      graded.questions
        .filter((q) => !q.correct)
        .map((q) =>
          emitStruggle({
            userId,
            nodeId: q.covers,
            signal: "exam_question_missed",
            value: 1,
          }),
        ),
    );
  }

  return resultOf(updated);
}

/* ------------------------------------------------------------ read models */

/** Every attempt at one exam, newest first, safe to render. */
export async function loadAttemptViews(
  userId: string,
  examId: string,
  examPassed: boolean,
  now: Date = new Date(),
): Promise<AttemptView[]> {
  const rows = await db
    .select()
    .from(examAttempts)
    .where(and(eq(examAttempts.userId, userId), eq(examAttempts.examId, examId)))
    .orderBy(desc(examAttempts.startedAt));

  return rows.map((row) => toAttemptView(row, examPassed, now));
}

export async function findExam(slug: string): Promise<LoadedExam | null> {
  const exams = await loadAllExamsCached();
  return exams.find((e) => e.slug === slug) ?? null;
}

/* ------------------------------------------------------------ certificate */

export type CertificateStatus =
  | { eligible: true }
  | { eligible: false; missing: string[] };

/**
 * Derived, like everything else: the final exam passed, and the capstone
 * passed by the learner rather than assumed by an entry track. The shared
 * guest account is excluded - it is several people, with every lock removed.
 */
export function certificateStatus(
  graph: Graph,
  userId: string,
): CertificateStatus {
  const missing: string[] = [];

  if (isGuestUser(userId)) {
    return { eligible: false, missing: ["Certificates need a personal account."] };
  }

  const final = graph.examById.get(FINAL_EXAM_ID);
  if (!final) missing.push("There is no final exam yet.");
  else if (final.state !== "passed") missing.push("Pass the final exam.");

  const capstone = graph.byId.get(CAPSTONE_NODE_ID);
  if (!capstone || capstone.state !== "passed" || capstone.assumedPassed) {
    missing.push("Pass the capstone (node 7.1).");
  }

  return missing.length === 0 ? { eligible: true } : { eligible: false, missing };
}

export const MAX_CERTIFICATE_NAME = 80;

/** 16 characters, lowercase letters and digits, no lookalikes. */
function newCertificateId(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return [...randomBytes(16)].map((b) => alphabet[b % alphabet.length]).join("");
}

export async function loadCertificateForUser(userId: string) {
  const [row] = await db
    .select()
    .from(certificates)
    .where(eq(certificates.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Issue the certificate, once. Calling it again returns the one already
 * issued - the name and the date on a certificate do not change.
 */
export async function issueCertificate(
  userId: string,
  entryTrack: EntryTrack | null,
  name: string,
): Promise<{ id: string }> {
  const existing = await loadCertificateForUser(userId);
  if (existing) return { id: existing.id };

  const graph = await buildGraph(userId, entryTrack);
  const status = certificateStatus(graph, userId);
  if (!status.eligible) {
    throw new ExamError(`Not eligible yet: ${status.missing.join(" ")}`);
  }

  const printed = name.replace(/\s+/g, " ").trim().slice(0, MAX_CERTIFICATE_NAME);
  if (printed.length === 0) {
    throw new ExamError("A certificate needs a name on it.");
  }

  const [created] = await db
    .insert(certificates)
    .values({ id: newCertificateId(), userId, name: printed })
    .onConflictDoNothing({ target: certificates.userId })
    .returning({ id: certificates.id });

  if (created) return created;
  const raced = await loadCertificateForUser(userId);
  if (!raced) throw new ExamError("Could not issue the certificate.");
  return { id: raced.id };
}

export type CertificateView = {
  id: string;
  name: string;
  issuedAt: Date;
  /** Best passing score per exam, phase exams first. */
  exams: { title: string; correct: number; total: number; passedAt: Date }[];
};

/** Public: anyone with the link can read this, so it carries scores only. */
export async function loadCertificate(id: string): Promise<CertificateView | null> {
  if (!/^[a-z0-9]{8,40}$/.test(id)) return null;

  const [cert] = await db
    .select()
    .from(certificates)
    .where(eq(certificates.id, id))
    .limit(1);
  if (!cert) return null;

  const [passes, exams] = await Promise.all([
    db
      .select({
        examId: examAttempts.examId,
        correct: examAttempts.correct,
        total: sql<number>`jsonb_array_length(${examAttempts.paper})`,
        submittedAt: examAttempts.submittedAt,
      })
      .from(examAttempts)
      .where(and(eq(examAttempts.userId, cert.userId), eq(examAttempts.passed, true))),
    loadAllExamsCached(),
  ]);

  const passByExam = new Map(passes.map((p) => [p.examId, p]));

  return {
    id: cert.id,
    name: cert.name,
    issuedAt: cert.issuedAt,
    exams: exams.flatMap((exam) => {
      const pass = passByExam.get(exam.id);
      if (!pass || pass.correct === null || !pass.submittedAt) return [];
      return [
        {
          title: exam.frontmatter.title,
          correct: pass.correct,
          total: pass.total,
          passedAt: pass.submittedAt,
        },
      ];
    }),
  };
}

/* ------------------------------------------------------------------ admin */

export type ExamOverviewRow = {
  examId: string;
  title: string;
  slug: string;
  /** Learners with at least one attempt. */
  learners: number;
  attempts: number;
  passedLearners: number;
  timedOut: number;
  /** Mean share of questions correct across submitted attempts, 0-1. */
  meanScore: number | null;
};

export type MissedQuestionRow = {
  examTitle: string;
  questionId: string;
  covers: string;
  asked: number;
  missed: number;
};

/**
 * Per-exam funnel and the questions most often got wrong.
 *
 * Papers are aggregated in JavaScript rather than with jsonb SQL: the grader
 * is a TypeScript function, and having a second definition of "correct" in a
 * query is exactly the kind of thing that drifts.
 */
export async function examOverview(): Promise<{
  exams: ExamOverviewRow[];
  mostMissed: MissedQuestionRow[];
}> {
  const [rows, exams] = await Promise.all([
    db.select().from(examAttempts),
    loadAllExamsCached(),
  ]);
  const titleOf = new Map(exams.map((e) => [e.id, e.frontmatter.title]));

  const overview = exams.map((exam): ExamOverviewRow => {
    const mine = rows.filter((r) => r.examId === exam.id);
    const submitted = mine.filter((r) => r.submittedAt && r.responses !== null);
    const shares = submitted.map((r) => (r.correct ?? 0) / Math.max(1, r.paper.length));

    return {
      examId: exam.id,
      title: exam.frontmatter.title,
      slug: exam.slug,
      learners: new Set(mine.map((r) => r.userId)).size,
      attempts: mine.length,
      passedLearners: new Set(mine.filter((r) => r.passed).map((r) => r.userId)).size,
      timedOut: mine.filter((r) => r.submittedAt && r.responses === null).length,
      meanScore:
        shares.length > 0 ? shares.reduce((a, b) => a + b, 0) / shares.length : null,
    };
  });

  const tally = new Map<string, MissedQuestionRow>();
  for (const row of rows) {
    if (!row.submittedAt || row.responses === null) continue;
    const graded = gradePaper(row.paper, row.responses, row.passMark);
    for (const q of graded.questions) {
      const key = `${row.examId}|${q.id}`;
      const entry = tally.get(key) ?? {
        examTitle: titleOf.get(row.examId) ?? row.examId,
        questionId: q.id,
        covers: q.covers,
        asked: 0,
        missed: 0,
      };
      entry.asked++;
      if (!q.correct) entry.missed++;
      tally.set(key, entry);
    }
  }

  const mostMissed = [...tally.values()]
    .filter((q) => q.missed > 0)
    .sort((a, b) => b.missed / b.asked - a.missed / a.asked || b.missed - a.missed)
    .slice(0, 15);

  return { exams: overview, mostMissed };
}

export type LearnerAttemptRow = {
  id: string;
  examTitle: string;
  status: AttemptStatus;
  startedAt: Date;
  submittedAt: Date | null;
  timedOut: boolean;
  correct: number | null;
  total: number;
  /** Full detail: the admin scope already includes a learner's written answers. */
  questions: {
    id: string;
    covers: string;
    prompt: string;
    response: string | null;
    correct: boolean;
    answer: string;
  }[];
};

export async function learnerExamAttempts(
  userId: string,
  now: Date = new Date(),
): Promise<LearnerAttemptRow[]> {
  const [rows, exams] = await Promise.all([
    db
      .select()
      .from(examAttempts)
      .where(eq(examAttempts.userId, userId))
      .orderBy(desc(examAttempts.startedAt)),
    loadAllExamsCached(),
  ]);
  const titleOf = new Map(exams.map((e) => [e.id, e.frontmatter.title]));

  return rows.map((row) => {
    const view = toAttemptView(row, true, now);
    return {
      id: row.id,
      examTitle: titleOf.get(row.examId) ?? row.examId,
      status: view.status,
      startedAt: row.startedAt,
      submittedAt: row.submittedAt,
      timedOut: view.timedOut,
      correct: view.correct,
      total: view.total,
      questions: row.paper.map((q) => {
        const graded = view.questions.find((v) => v.id === q.id);
        return {
          id: q.id,
          covers: q.covers,
          prompt: q.prompt,
          response: row.responses?.[q.id] ?? null,
          correct: graded?.correct ?? false,
          answer: displayAnswer(q.answer),
        };
      }),
    };
  });
}

/** Per-learner exam counts for the admin table. */
export async function examCountsByLearner(): Promise<
  Map<string, { attempts: number; passed: number }>
> {
  const rows = await db
    .select({
      userId: examAttempts.userId,
      attempts: sql<number>`count(*)::int`,
      passed: sql<number>`count(distinct ${examAttempts.examId}) filter (where ${examAttempts.passed})::int`,
    })
    .from(examAttempts)
    .groupBy(examAttempts.userId);

  return new Map(rows.map((r) => [r.userId, { attempts: r.attempts, passed: r.passed }]));
}
