/**
 * Exam rules, as pure functions.
 *
 * No database and no server-only import: everything here takes plain data and
 * returns plain data, so scripts/check-exam-logic.ts can exercise the rules in
 * CI without a Postgres to talk to. lib/progress.ts feeds it rows.
 *
 * The rules, in one place:
 *
 *   - A phase exam opens when every published node in its phase is passed.
 *   - Passing the exam for phase N is required to open nodes in phase N+1 and
 *     beyond. The final exam is required for the capstone phase.
 *   - The final opens when every phase exam is passed or waived.
 *   - An entry track waives the exams for the phases it skips: someone who
 *     starts at 3.1 is not asked to sit the phase 0 exam first.
 *   - Attempts are timed. An attempt not submitted by its deadline (plus a
 *     short grace for the network) counts as a fail.
 *   - After a failed attempt there is a cooldown before the next one, and the
 *     next one draws different variants.
 *
 * All of it is derived on every read from attempts plus node progress. Nothing
 * here is ever stored as "this exam is unlocked" (non-negotiable 2).
 */
import type { PaperQuestion } from "@/db/schema";

import type { LoadedExam, LoadedPhaseExam } from "./exam-content";
import { isFinalExam, isPhaseExam } from "./exam-content";
import {
  CAPSTONE_PHASE,
  correctNeeded,
  gradeResponse,
} from "./exam-schema";

/** Accept a submit this long after the deadline: clock skew plus a slow request. */
export const SUBMIT_GRACE_MS = 60 * 1000;

export type AttemptStatus = "active" | "passed" | "failed" | "expired";

/** The columns of exam_attempts the rules need. */
export type AttemptFacts = {
  id: string;
  examId: string;
  startedAt: Date;
  deadlineAt: Date;
  submittedAt: Date | null;
  correct: number | null;
  passed: boolean | null;
  total: number;
};

/**
 * An attempt past its deadline and never submitted is "expired" whether or not
 * anything has got round to closing the row. Reading the clock here, rather
 * than relying on a job to flip a flag, means there is no window in which a
 * dead attempt still looks live.
 */
export function attemptStatus(attempt: AttemptFacts, now: Date): AttemptStatus {
  if (attempt.submittedAt) return attempt.passed ? "passed" : "failed";
  return now.getTime() <= attempt.deadlineAt.getTime() + SUBMIT_GRACE_MS
    ? "active"
    : "expired";
}

/** When the attempt stopped counting as open. */
export function attemptEndedAt(attempt: AttemptFacts): Date {
  return attempt.submittedAt ?? attempt.deadlineAt;
}

export type ExamState = "locked" | "open" | "in_progress" | "cooldown" | "passed";

export type ExamSummary = {
  id: string;
  slug: string;
  kind: "phase" | "final";
  /** The phase examined; null for the final. */
  phase: number | null;
  /** Nodes in this phase and later stay locked until this exam is passed. */
  gatesPhase: number;
  title: string;
  timeLimitMinutes: number;
  passMark: number;
  cooldownHours: number;
  questionCount: number;
  state: ExamState;
  /** The entry track skips this exam. It gates nothing for this learner. */
  waived: boolean;
  /** Published nodes of the phase not yet passed (phase exams). */
  blockingNodeIds: string[];
  /** Phase exams not yet passed (the final). */
  blockingExamIds: string[];
  attemptCount: number;
  /** Best submitted score, as a count of correct answers. */
  bestCorrect: number | null;
  bestTotal: number | null;
  passedAt: Date | null;
  activeAttemptId: string | null;
  /** While in cooldown: when the next attempt may start. */
  retryAt: Date | null;
};

export function examQuestionCount(exam: LoadedExam, all: LoadedExam[]): number {
  if (isPhaseExam(exam)) return exam.frontmatter.questions.length;
  if (!isFinalExam(exam)) return 0;
  return all.filter(isPhaseExam).length * exam.frontmatter.draw_per_phase;
}

export const examGatesPhase = (exam: LoadedExam): number =>
  isPhaseExam(exam) ? exam.frontmatter.phase + 1 : CAPSTONE_PHASE;

/**
 * Exams a node in `phase` sits behind: every phase exam for an earlier phase,
 * and the final once you reach the capstone phase.
 */
export function examsGating(phase: number, exams: LoadedExam[]): LoadedExam[] {
  return exams.filter((exam) =>
    isPhaseExam(exam)
      ? exam.frontmatter.phase < phase
      : phase >= CAPSTONE_PHASE,
  );
}

export type NodeFacts = {
  id: string;
  phase: number;
  status: "planned" | "published";
};

/**
 * Every exam's state for one learner.
 *
 *   passedNodes    earned or assumed-by-entry-track, as buildGraph computes it
 *   startPhase     phase of the entry track's start node, or 0 with no track
 *   unlockAll      the shared guest account: nothing is ever locked for it
 */
export function deriveExamSummaries({
  exams,
  nodes,
  passedNodes,
  attempts,
  startPhase,
  unlockAll,
  now,
}: {
  exams: LoadedExam[];
  nodes: NodeFacts[];
  passedNodes: Set<string>;
  attempts: AttemptFacts[];
  startPhase: number;
  unlockAll: boolean;
  now: Date;
}): ExamSummary[] {
  const attemptsByExam = new Map<string, AttemptFacts[]>();
  for (const attempt of attempts) {
    const list = attemptsByExam.get(attempt.examId) ?? [];
    list.push(attempt);
    attemptsByExam.set(attempt.examId, list);
  }

  const hasPassed = (examId: string) =>
    (attemptsByExam.get(examId) ?? []).some((a) => a.passed === true);

  const isWaived = (exam: LoadedExam) =>
    isPhaseExam(exam) && exam.frontmatter.phase < startPhase;

  return exams.map((exam) => {
    const mine = [...(attemptsByExam.get(exam.id) ?? [])].sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
    );
    const waived = isWaived(exam);

    let blockingNodeIds: string[] = [];
    let blockingExamIds: string[] = [];
    let available: boolean;

    if (isPhaseExam(exam)) {
      const published = nodes.filter(
        (n) => n.phase === exam.frontmatter.phase && n.status === "published",
      );
      blockingNodeIds = published
        .filter((n) => !passedNodes.has(n.id))
        .map((n) => n.id);
      // A phase with nothing published has nothing to examine - same guard as
      // the node pass condition, for the same reason.
      available = published.length > 0 && blockingNodeIds.length === 0;
    } else {
      const phaseExams = exams.filter(isPhaseExam);
      blockingExamIds = phaseExams
        .filter((e) => !hasPassed(e.id) && !isWaived(e))
        .map((e) => e.id);
      available = phaseExams.length > 0 && blockingExamIds.length === 0;
    }

    const passedAttempt = mine.find((a) => a.passed === true) ?? null;
    const last = mine.at(-1) ?? null;
    const lastStatus = last ? attemptStatus(last, now) : null;

    const retryAt =
      last && (lastStatus === "failed" || lastStatus === "expired")
        ? new Date(
            attemptEndedAt(last).getTime() +
              exam.frontmatter.cooldown_hours * 60 * 60 * 1000,
          )
        : null;
    const coolingDown = retryAt !== null && retryAt.getTime() > now.getTime();

    let state: ExamState;
    if (passedAttempt) state = "passed";
    else if (lastStatus === "active") state = "in_progress";
    else if (!available && !unlockAll) state = "locked";
    else if (coolingDown) state = "cooldown";
    else state = "open";

    const submitted = mine.filter((a) => a.submittedAt && a.correct !== null);
    const best = submitted.sort((a, b) => b.correct! - a.correct!)[0] ?? null;

    return {
      id: exam.id,
      slug: exam.slug,
      kind: exam.frontmatter.kind,
      phase: isPhaseExam(exam) ? exam.frontmatter.phase : null,
      gatesPhase: examGatesPhase(exam),
      title: exam.frontmatter.title,
      timeLimitMinutes: exam.frontmatter.time_limit_minutes,
      passMark: exam.frontmatter.pass_mark,
      cooldownHours: exam.frontmatter.cooldown_hours,
      questionCount: examQuestionCount(exam, exams),
      state,
      waived,
      blockingNodeIds,
      blockingExamIds,
      attemptCount: mine.length,
      bestCorrect: best?.correct ?? null,
      bestTotal: best?.total ?? null,
      passedAt: passedAttempt?.submittedAt ?? null,
      activeAttemptId: lastStatus === "active" ? last!.id : null,
      retryAt: coolingDown ? retryAt : null,
    };
  });
}

/** Exams this learner still has to pass before `phase` opens. */
export function unmetExamGates(
  phase: number,
  exams: LoadedExam[],
  summaries: Map<string, ExamSummary>,
): ExamSummary[] {
  return examsGating(phase, exams)
    .map((exam) => summaries.get(exam.id))
    .filter((s): s is ExamSummary => Boolean(s))
    .filter((s) => s.state !== "passed" && !s.waived);
}

/* ------------------------------------------------------------- the paper */

/** Fisher-Yates with an injected source of randomness, so tests can pin it. */
function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const paperQuestionId = (
  examKind: "phase" | "final",
  phase: number,
  questionId: string,
) => (examKind === "final" ? `${phase}:${questionId}` : questionId);

/**
 * Draw the paper for one attempt.
 *
 * `previous` is the paper of the learner's last attempt at this exam, if any.
 * Any question that appears in both gets a different variant this time, so a
 * retake can never be answered from memory of the last one - which is also why
 * the content validator insists on at least two variants per question.
 */
export function buildPaper(
  exam: LoadedExam,
  all: LoadedExam[],
  previous: PaperQuestion[] | null,
  rand: () => number = Math.random,
): PaperQuestion[] {
  const lastVariant = new Map((previous ?? []).map((q) => [q.id, q.variant]));
  const kind = exam.frontmatter.kind;

  const draw = (source: LoadedPhaseExam, questions = source.frontmatter.questions) =>
    questions.map((question): PaperQuestion => {
      const phase = source.frontmatter.phase;
      const id = paperQuestionId(kind, phase, question.id);
      const count = question.variants.length;
      const seen = lastVariant.get(id);

      let variant = Math.floor(rand() * count);
      if (seen !== undefined && count > 1 && variant === seen) {
        variant = (variant + 1) % count;
      }

      const chosen = question.variants[variant];
      return {
        id,
        covers: question.covers,
        phase,
        variant,
        prompt: chosen.prompt,
        answer: chosen.answer,
        explanation: chosen.explanation,
      };
    });

  if (isPhaseExam(exam)) return draw(exam);
  if (!isFinalExam(exam)) return [];

  const perPhase = exam.frontmatter.draw_per_phase;
  return all
    .filter(isPhaseExam)
    .flatMap((source) =>
      draw(
        source,
        // Shuffle, take the first few, then restore authored order so the
        // final reads phase by phase, node by node.
        shuffled(source.frontmatter.questions, rand)
          .slice(0, perPhase)
          .sort(
            (a, b) =>
              source.frontmatter.questions.indexOf(a) -
              source.frontmatter.questions.indexOf(b),
          ),
      ),
    );
}

/* ---------------------------------------------------------------- grading */

export type GradedQuestion = {
  id: string;
  covers: string;
  correct: boolean;
};

export type GradedPaper = {
  questions: GradedQuestion[];
  correct: number;
  total: number;
  needed: number;
  passed: boolean;
};

export function gradePaper(
  paper: PaperQuestion[],
  responses: Record<string, string> | null,
  passMark: number,
): GradedPaper {
  const questions = paper.map((q) => ({
    id: q.id,
    covers: q.covers,
    correct: gradeResponse(q.answer, responses?.[q.id]),
  }));
  const correct = questions.filter((q) => q.correct).length;
  const needed = correctNeeded(paper.length, passMark);

  return {
    questions,
    correct,
    total: paper.length,
    needed,
    // An empty paper cannot be passed, whatever the arithmetic says.
    passed: paper.length > 0 && correct >= needed,
  };
}

/** Longest response the submit action will store. Answers are a few characters. */
export const MAX_RESPONSE_LENGTH = 120;

/** Keep only answers to questions on this paper, trimmed and bounded. */
export function sanitiseResponses(
  paper: PaperQuestion[],
  raw: unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null) return out;
  const given = raw as Record<string, unknown>;

  for (const question of paper) {
    const value = given[question.id];
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, MAX_RESPONSE_LENGTH);
    if (trimmed.length > 0) out[question.id] = trimmed;
  }
  return out;
}
