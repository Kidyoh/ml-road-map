/**
 * Zod schemas for exam frontmatter, plus the grader.
 *
 * Exams live in git as MDX, like nodes (non-negotiable 1):
 *
 *   content/exams/phase-{n}.mdx    one per phase 0-6
 *   content/exams/final.mdx        the comprehensive final
 *
 * Non-negotiable 4 says "never multiple choice", and exams keep to it. Every
 * question is answered by computing something and typing the result: a number
 * checked against a tolerance, or an exact short string. Nothing to recognise,
 * nothing to guess from a list, and - unlike a node's self-rated questions -
 * nothing the learner grades themselves.
 *
 * This file has no server-only imports on purpose. The grader runs in the
 * submit action, in the content validator and in scripts/check-exam-logic.ts,
 * so there is exactly one definition of what "correct" means.
 */
import { z } from "zod";

import { NODE_ID_PATTERN } from "./content-schema";

const nonEmpty = (label: string) =>
  z.string().trim().min(1, `${label} must not be empty`);

const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A number, accepted when |response - value| <= tolerance. */
export const numberAnswerSchema = z.strictObject({
  type: z.literal("number"),
  value: z.number(),
  /**
   * Absolute, not relative. 0 means the answer is an integer or otherwise
   * exact. For "to 3 decimal places" use 0.0005 - half a unit in the last
   * place - so honest rounding in either direction is accepted.
   */
  tolerance: z.number().min(0).default(0),
});

/**
 * A short exact string: a shape, a dtype, a method name. Compared after
 * lowercasing and removing ALL whitespace, so "(3, 4)" and "(3,4)" both match.
 */
export const textAnswerSchema = z.strictObject({
  type: z.literal("text"),
  accept: z.array(nonEmpty("accepted answer")).min(1),
});

export const examAnswerSchema = z.discriminatedUnion("type", [
  numberAnswerSchema,
  textAnswerSchema,
]);

export const examVariantSchema = z.strictObject({
  prompt: nonEmpty("variant prompt"),
  answer: examAnswerSchema,
  /**
   * The worked solution. Shown only once the exam is PASSED - showing it after
   * a fail would turn the retake into copying.
   */
  explanation: nonEmpty("explanation").refine(
    (value) => value.trim().split(/\s+/).length >= 8,
    "explanation is under 8 words - show the working, not just the answer",
  ),
});

export const examQuestionSchema = z.strictObject({
  /** Stable key, unique within the exam. Attempts refer to questions by it. */
  id: z.string().regex(kebab, "question id must be lowercase kebab-case"),
  /** The node this question tests. A miss is logged against that node. */
  covers: z.string().regex(NODE_ID_PATTERN, 'covers must look like "2.3"'),
  /**
   * The same skill with different numbers. Each attempt draws one variant per
   * question, so a retake is a new paper rather than a memory test. At least
   * two, or a failed attempt leaks the whole next attempt.
   */
  variants: z
    .array(examVariantSchema)
    .min(2, "a question needs at least 2 variants so retakes differ"),
});

const examBase = {
  title: nonEmpty("title"),
  time_limit_minutes: z.number().int().min(5).max(180),
  /** Percent of questions that must be correct, e.g. 70. */
  pass_mark: z.number().int().min(1).max(100),
  /** Wait after a failed or timed-out attempt before the next one. */
  cooldown_hours: z.number().min(0).max(168),
};

/** End-of-phase exam. Passing it opens the next phase. */
export const phaseExamSchema = z.strictObject({
  ...examBase,
  kind: z.literal("phase"),
  phase: z.number().int().min(0).max(6),
  questions: z.array(examQuestionSchema).min(5, "an exam needs at least 5 questions"),
});

/**
 * The final has no questions of its own. It draws fresh variants from every
 * phase exam, so it is comprehensive by construction and cannot drift out of
 * sync with the phases it claims to cover.
 */
export const finalExamSchema = z.strictObject({
  ...examBase,
  kind: z.literal("final"),
  draw_per_phase: z.number().int().min(1).max(10),
});

export const examFrontmatterSchema = z.discriminatedUnion("kind", [
  phaseExamSchema,
  finalExamSchema,
]);

export type ExamAnswer = z.infer<typeof examAnswerSchema>;
export type ExamVariant = z.infer<typeof examVariantSchema>;
export type ExamQuestion = z.infer<typeof examQuestionSchema>;
export type PhaseExam = z.infer<typeof phaseExamSchema>;
export type FinalExam = z.infer<typeof finalExamSchema>;
export type ExamFrontmatter = PhaseExam | FinalExam;

/** The final exam gates the capstone phase. */
export const CAPSTONE_PHASE = 7;

export const FINAL_EXAM_ID = "exam-final";
export const phaseExamId = (phase: number) => `exam-${phase}`;

/* ---------------------------------------------------------------- grading */

/**
 * Parse what a learner typed as a number, or null if it is not one.
 *
 * Forgiving about presentation - thousands separators, surrounding spaces, a
 * leading plus - and strict about everything else. "75%" is NOT read as 0.75
 * or as 75: the prompt says which form it wants, and guessing would mark a
 * wrong answer right.
 */
export function parseNumericResponse(raw: string): number | null {
  const cleaned = raw.trim().replace(/[\s_]/g, "").replace(/,(?=\d{3}(\D|$))/g, "");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export const normaliseText = (raw: string) =>
  raw.toLowerCase().replace(/\s+/g, "");

/** The one definition of "correct". An empty response is always wrong. */
export function gradeResponse(answer: ExamAnswer, response: string | undefined): boolean {
  if (response === undefined || response.trim() === "") return false;

  if (answer.type === "number") {
    const value = parseNumericResponse(response);
    if (value === null) return false;
    // The epsilon absorbs binary float noise (0.1 + 0.2), nothing more.
    return Math.abs(value - answer.value) <= answer.tolerance + 1e-9;
  }

  const given = normaliseText(response);
  return answer.accept.some((candidate) => normaliseText(candidate) === given);
}

/** Smallest number of correct answers that meets the pass mark. */
export function correctNeeded(total: number, passMark: number): number {
  return Math.ceil((total * passMark) / 100 - 1e-9);
}
