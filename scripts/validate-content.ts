/**
 * Content validation. Runs in CI on every push (non-negotiable 6): a malformed
 * prerequisite or a duplicate id fails the build rather than surfacing as a
 * broken graph in production.
 *
 *   pnpm validate:content            warn on dangling prereqs, skip reachability
 *   pnpm validate:content --strict   both are errors
 *
 * Two modes because the roadmap is written in phase order. Node 2.3 declares
 * `prereqs: ["2.2"]` and 2.2 does not exist until M5; that is expected during
 * M1 through M4, and a hard error afterwards. Flipping CI to --strict is
 * literally M5's done-condition.
 */
import {
  ContentError,
  loadAllNodes,
  type LoadedNode,
} from "../lib/content";
import { auditChecklistItem, isPublished } from "../lib/content-schema";
import {
  ExamContentError,
  isFinalExam,
  isPhaseExam,
  loadAllExams,
  type LoadedExam,
} from "../lib/exam-content";
import { gradeResponse, normaliseText } from "../lib/exam-schema";

const STRICT = process.argv.includes("--strict");

type Finding = { level: "error" | "warn"; where: string; message: string };

const findings: Finding[] = [];

const error = (where: string, message: string) =>
  findings.push({ level: "error", where, message });

const warn = (where: string, message: string) =>
  findings.push({ level: "warn", where, message });

/** Dangling prereqs and unreachable nodes: errors under --strict, else warnings. */
const graphIssue = STRICT ? error : warn;

function checkUniqueness(nodes: LoadedNode[]) {
  const byId = new Map<string, string>();
  const bySlug = new Map<string, string>();

  for (const node of nodes) {
    const { id, slug } = node.frontmatter;

    const existingId = byId.get(id);
    if (existingId) {
      error(node.filePath, `duplicate id "${id}" - also declared in ${existingId}`);
    } else {
      byId.set(id, node.filePath);
    }

    const existingSlug = bySlug.get(slug);
    if (existingSlug) {
      error(
        node.filePath,
        `duplicate slug "${slug}" - also declared in ${existingSlug}`,
      );
    } else {
      bySlug.set(slug, node.filePath);
    }
  }

  return byId;
}

function checkPrereqs(nodes: LoadedNode[], byId: Map<string, string>) {
  for (const node of nodes) {
    const { id, prereqs } = node.frontmatter;

    if (prereqs.includes(id)) {
      error(node.filePath, `node "${id}" lists itself as a prerequisite`);
    }

    if (new Set(prereqs).size !== prereqs.length) {
      error(node.filePath, `duplicate entries in prereqs`);
    }

    for (const prereq of prereqs) {
      if (!byId.has(prereq)) {
        graphIssue(
          node.filePath,
          `prereq "${prereq}" does not exist${STRICT ? "" : " yet"}`,
        );
      }
    }
  }
}

/** Depth-first cycle detection. A cycle means nothing downstream ever unlocks. */
function checkCycles(nodes: LoadedNode[]) {
  const prereqsOf = new Map(
    nodes.map((n) => [n.frontmatter.id, n.frontmatter.prereqs] as const),
  );
  const fileOf = new Map(nodes.map((n) => [n.frontmatter.id, n.filePath] as const));

  const VISITING = 1;
  const DONE = 2;
  const marks = new Map<string, number>();

  const walk = (id: string, trail: string[]): boolean => {
    if (marks.get(id) === DONE) return false;
    if (marks.get(id) === VISITING) {
      const cycle = [...trail.slice(trail.indexOf(id)), id].join(" -> ");
      error(fileOf.get(id) ?? id, `prerequisite cycle: ${cycle}`);
      return true;
    }

    marks.set(id, VISITING);
    for (const prereq of prereqsOf.get(id) ?? []) {
      if (!prereqsOf.has(prereq)) continue; // dangling, already reported
      if (walk(prereq, [...trail, id])) {
        marks.set(id, DONE);
        return true;
      }
    }
    marks.set(id, DONE);
    return false;
  };

  for (const id of prereqsOf.keys()) walk(id, []);
}

/**
 * Every node must be reachable by walking forward from some entry point. An
 * unreachable node is content nobody can ever legitimately open.
 */
function checkReachability(nodes: LoadedNode[]) {
  const known = new Set(nodes.map((n) => n.frontmatter.id));
  const entryPoints = nodes.filter((n) => n.frontmatter.prereqs.length === 0);

  if (entryPoints.length === 0) {
    error("content/", "no entry point - every node has a prerequisite");
    return;
  }

  const reachable = new Set<string>();
  const queue = entryPoints.map((n) => n.frontmatter.id);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);

    for (const node of nodes) {
      const prereqs = node.frontmatter.prereqs.filter((p) => known.has(p));
      if (prereqs.length > 0 && prereqs.every((p) => reachable.has(p))) {
        queue.push(node.frontmatter.id);
      }
    }
  }

  for (const node of nodes) {
    if (!reachable.has(node.frontmatter.id)) {
      graphIssue(
        node.filePath,
        `node "${node.frontmatter.id}" is unreachable from any entry point`,
      );
    }
  }
}

/** Non-negotiable 3, as far as a regex can enforce it. Published nodes only. */
function checkChecklists(nodes: LoadedNode[]) {
  for (const node of nodes) {
    if (!isPublished(node.frontmatter)) continue;
    node.frontmatter.checklist.forEach((item, i) => {
      const problem = auditChecklistItem(item);
      if (problem) error(node.filePath, `checklist[${i}] ${problem}`);
    });
  }
}

function checkResources(nodes: LoadedNode[]) {
  for (const node of nodes) {
    if (!isPublished(node.frontmatter)) continue;
    const { primary, alt } = node.frontmatter.resources;
    if (primary.url === alt.url) {
      error(node.filePath, "primary and alt resources are the same URL");
    }
    if (primary.cost === "paid" && alt.cost === "paid") {
      warn(node.filePath, "both resources are paid - no free path through this node");
    }
  }
}

/**
 * A planned node can never be passed - it has no checklist to tick. So anything
 * downstream of one is permanently unreachable in practice, even though the
 * graph says otherwise. Worth reporting, because it is the honest measure of how
 * much of the roadmap is actually walkable.
 */
function reportCoverage(nodes: LoadedNode[]) {
  const published = nodes.filter((n) => isPublished(n.frontmatter));
  const planned = nodes.length - published.length;
  console.log(
    `\n${published.length} published, ${planned} planned (${nodes.length} total).`,
  );
}

/**
 * Exams. Per-file shape is Zod's job (lib/exam-schema.ts); this is everything
 * that needs more than one file, plus the checks that keep an auto-graded
 * question honest - a question the grader cannot mark right is a question that
 * fails every learner who answers it correctly.
 */
function checkExams(exams: LoadedExam[], nodes: LoadedNode[]) {
  const nodeById = new Map(nodes.map((n) => [n.frontmatter.id, n.frontmatter]));
  const phaseExams = exams.filter(isPhaseExam);
  const finals = exams.filter(isFinalExam);

  for (const exam of phaseExams) {
    const { phase, questions } = exam.frontmatter;
    const seen = new Set<string>();
    const covered = new Set<string>();

    for (const q of questions) {
      const where = `${exam.filePath} [${q.id}]`;

      if (seen.has(q.id)) error(where, `duplicate question id "${q.id}"`);
      seen.add(q.id);

      const node = nodeById.get(q.covers);
      if (!node) {
        error(where, `covers "${q.covers}", which does not exist`);
      } else if (node.phase !== phase) {
        error(where, `covers "${q.covers}", which is in phase ${node.phase}, not ${phase}`);
      } else if (!isPublished(node)) {
        error(where, `covers "${q.covers}", which is not published - nobody can have studied it`);
      } else {
        covered.add(q.covers);
      }

      const prompts = new Set<string>();
      const answers = new Set<string>();

      q.variants.forEach((variant, i) => {
        const at = `${where} variant ${i}`;
        const { answer } = variant;

        if (prompts.has(variant.prompt)) {
          error(at, "identical prompt to another variant - a retake would be the same paper");
        }
        prompts.add(variant.prompt);

        if (answer.type === "number") {
          // The key itself, typed in, must be accepted. Catches NaN and friends.
          if (!gradeResponse(answer, String(answer.value))) {
            error(at, `the grader rejects its own answer key (${answer.value})`);
          }
          // A tolerance as large as the answer accepts 0 - i.e. a blank guess.
          if (answer.value !== 0 && answer.tolerance >= Math.abs(answer.value)) {
            error(at, `tolerance ${answer.tolerance} is as large as the answer ${answer.value}`);
          }
          const decimals = (String(answer.value).split(".")[1] ?? "").length;
          if (decimals > 0 && answer.tolerance === 0) {
            warn(at, `answer ${answer.value} has decimals but tolerance is 0 - rounding will fail honest answers`);
          }
          answers.add(`n:${answer.value}`);
        } else {
          const normalised = answer.accept.map(normaliseText);
          if (normalised.some((a) => a.length === 0)) {
            error(at, "an accepted answer is empty after normalisation");
          }
          answers.add(`t:${normalised[0]}`);
        }
      });

      if (answers.size < q.variants.length) {
        warn(where, "two variants share an answer - the retake is easier than it looks");
      }
    }

    // An end-of-phase exam that skips a node is not an end-of-phase exam.
    for (const node of nodes) {
      const fm = node.frontmatter;
      if (fm.phase === phase && isPublished(fm) && !covered.has(fm.id)) {
        error(exam.filePath, `no question covers node ${fm.id} (${fm.title})`);
      }
    }
  }

  if (finals.length > 0) {
    const final = finals[0];
    if (phaseExams.length === 0) {
      error(final.filePath, "a final exam needs phase exams to draw from");
    }
    for (const exam of phaseExams) {
      if (exam.frontmatter.questions.length < final.frontmatter.draw_per_phase) {
        error(
          final.filePath,
          `draw_per_phase is ${final.frontmatter.draw_per_phase} but ${exam.filePath} has only ${exam.frontmatter.questions.length} questions`,
        );
      }
    }
    // The final gates the capstone, so a phase with no exam would be a hole in
    // the gate: every phase with published work must be examined.
    const examined = new Set(phaseExams.map((e) => e.frontmatter.phase));
    const phasesWithWork = new Set(
      nodes.filter((n) => isPublished(n.frontmatter) && n.frontmatter.phase < 7).map((n) => n.frontmatter.phase),
    );
    for (const phase of [...phasesWithWork].sort()) {
      if (!examined.has(phase)) {
        graphIssue(final.filePath, `phase ${phase} has published nodes but no exam`);
      }
    }
  }

  const questionCount = phaseExams.reduce((n, e) => n + e.frontmatter.questions.length, 0);
  const variantCount = phaseExams.reduce(
    (n, e) => n + e.frontmatter.questions.reduce((m, q) => m + q.variants.length, 0),
    0,
  );
  console.log(
    `${phaseExams.length} phase exam(s), ${finals.length} final: ` +
      `${questionCount} questions, ${variantCount} variants.`,
  );
}

async function main() {
  let nodes: LoadedNode[];

  try {
    nodes = await loadAllNodes();
  } catch (err) {
    if (err instanceof ContentError) {
      console.error("\nContent validation FAILED\n");
      for (const issue of err.issues) {
        console.error(`  error  ${issue.filePath}`);
        console.error(`         ${issue.message}`);
      }
      console.error(`\n${err.issues.length} problem(s).\n`);
      process.exit(1);
    }
    throw err;
  }

  if (nodes.length === 0) {
    console.error("\nNo content found under content/phase-*/.\n");
    process.exit(1);
  }

  const byId = checkUniqueness(nodes);
  checkPrereqs(nodes, byId);
  checkCycles(nodes);
  checkReachability(nodes);
  checkChecklists(nodes);
  checkResources(nodes);
  reportCoverage(nodes);

  try {
    checkExams(await loadAllExams(), nodes);
  } catch (err) {
    if (!(err instanceof ExamContentError)) throw err;
    for (const issue of err.issues) error(issue.filePath, issue.message);
  }

  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warn");

  for (const finding of findings) {
    const stream = finding.level === "error" ? console.error : console.warn;
    stream(`  ${finding.level.padEnd(5)}  ${finding.where}`);
    stream(`         ${finding.message}`);
  }

  const mode = STRICT ? "strict" : "default";
  console.log(
    `\n${nodes.length} node(s) validated in ${mode} mode: ` +
      `${errors.length} error(s), ${warnings.length} warning(s).`,
  );

  if (!STRICT && warnings.length > 0) {
    console.log(
      "Warnings are expected while content is partial. CI flips to --strict at M5.",
    );
  }

  console.log();
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
