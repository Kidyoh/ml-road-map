/**
 * The single exam loader - the exam-side twin of lib/content.ts.
 *
 * Exams never enter the database as content. Nodes need content rows because
 * runtime state carries foreign keys into them; an exam attempt instead stores
 * a snapshot of the exact paper it was given, so nothing has to point back at a
 * content row and a content edit can never rewrite a past attempt.
 *
 * Nothing in this file touches the DB, and it has no server-only import, so the
 * validator and the check scripts can use it directly.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import matter from "gray-matter";

import { CONTENT_DIR, type ContentIssue } from "./content";
import {
  examFrontmatterSchema,
  FINAL_EXAM_ID,
  phaseExamId,
  type ExamFrontmatter,
  type FinalExam,
  type PhaseExam,
} from "./exam-schema";

export const EXAMS_DIR = join(CONTENT_DIR, "exams");

export type LoadedExam = {
  /** "exam-0" ... "exam-6", or "exam-final". Derived from the frontmatter. */
  id: string;
  /** URL segment: "phase-0" ... "phase-6", or "final". Equals the filename. */
  slug: string;
  frontmatter: ExamFrontmatter;
  /** MDX body: what the exam covers and how to prepare. Shown before starting. */
  body: string;
  filePath: string;
};

export type LoadedPhaseExam = LoadedExam & { frontmatter: PhaseExam };
export type LoadedFinalExam = LoadedExam & { frontmatter: FinalExam };

export const isPhaseExam = (exam: LoadedExam): exam is LoadedPhaseExam =>
  exam.frontmatter.kind === "phase";

export const isFinalExam = (exam: LoadedExam): exam is LoadedFinalExam =>
  exam.frontmatter.kind === "final";

export class ExamContentError extends Error {
  constructor(readonly issues: ContentIssue[]) {
    super("Exam content failed validation");
    this.name = "ExamContentError";
  }
}

async function parseExamFile(
  absolutePath: string,
): Promise<{ exam: LoadedExam } | { issues: ContentIssue[] }> {
  const filePath = absolutePath
    .slice(process.cwd().length + 1)
    .replaceAll("\\", "/");
  const raw = (await readFile(absolutePath, "utf8")).replaceAll("\r\n", "\n");
  const { data, content } = matter(raw);

  const parsed = examFrontmatterSchema.safeParse(data);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => ({
        filePath,
        message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      })),
    };
  }

  const body = content.trim();
  if (body.length === 0) {
    return { issues: [{ filePath, message: "MDX body is empty" }] };
  }

  const fm = parsed.data;
  const slug = fm.kind === "phase" ? `phase-${fm.phase}` : "final";
  const fileName = filePath.split("/").pop()!;
  if (fileName !== `${slug}.mdx`) {
    return {
      issues: [
        { filePath, message: `filename should be "${slug}.mdx" to match its kind and phase` },
      ],
    };
  }

  return {
    exam: {
      id: fm.kind === "phase" ? phaseExamId(fm.phase) : FINAL_EXAM_ID,
      slug,
      frontmatter: fm,
      body,
      filePath,
    },
  };
}

/**
 * Load every exam, phase exams first in phase order, the final last. Throws
 * ExamContentError listing every per-file problem at once. A missing
 * content/exams directory is not an error - it means there are no exams, and
 * the roadmap then behaves exactly as it did before exams existed.
 */
export async function loadAllExams(): Promise<LoadedExam[]> {
  let files: string[];
  try {
    files = (await readdir(EXAMS_DIR)).filter((f) => f.endsWith(".mdx")).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const exams: LoadedExam[] = [];
  const issues: ContentIssue[] = [];

  for (const file of files) {
    const result = await parseExamFile(join(EXAMS_DIR, file));
    if ("exam" in result) exams.push(result.exam);
    else issues.push(...result.issues);
  }

  if (issues.length > 0) throw new ExamContentError(issues);

  const rank = (exam: LoadedExam) =>
    exam.frontmatter.kind === "phase" ? exam.frontmatter.phase : 99;
  return exams.sort((a, b) => rank(a) - rank(b));
}

export async function loadExamBySlug(slug: string): Promise<LoadedExam | null> {
  const exams = await loadAllExams();
  return exams.find((e) => e.slug === slug) ?? null;
}

/**
 * For request paths. Exam files only change with a deploy, so in production
 * they are read once per server instance; in development every call re-reads,
 * so editing a question shows up on the next refresh.
 */
let cached: Promise<LoadedExam[]> | null = null;

export function loadAllExamsCached(): Promise<LoadedExam[]> {
  if (process.env.NODE_ENV !== "production") return loadAllExams();
  cached ??= loadAllExams().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}
