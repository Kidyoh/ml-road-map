/**
 * MDX -> Postgres.
 *
 * An idempotent upsert on content-derived keys, not a truncate. The build plan
 * says the content tables are "wiped and rebuilt on seed"; taken literally that
 * cascade-deletes every learner's checklist_state and question_attempts every
 * time somebody fixes a typo, because those tables carry foreign keys into
 * node_checklist and node_questions.
 *
 * Deterministic keys give us the property the spec actually wanted - the DB is
 * reproducible from git, and hand-editing content rows is pointless because the
 * next seed overwrites them - without the data loss. The one thing to know: keys
 * encode order_index, so REORDERING a checklist item moves an existing tick to
 * whatever item now sits at that position. Appending is free; reordering is not.
 *
 *   pnpm seed
 *   pnpm seed --dry-run    report what would change, write nothing
 */
import { config } from "dotenv";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

config({ path: ".env.local", quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  // Imported after dotenv, because db/index.ts throws on a missing DATABASE_URL
  // at module scope and we want the friendly error, not a stack trace.
  const { db } = await import("./index");
  const {
    nodes,
    nodePrereqs,
    nodeChecklist,
    nodeQuestions,
  } = await import("./schema");
  const { ContentError, loadAllNodes, checklistItemId, questionId } =
    await import("../lib/content");
  const { isPublished } = await import("../lib/content-schema");

  let loaded;
  try {
    loaded = await loadAllNodes();
  } catch (err) {
    if (err instanceof ContentError) {
      console.error("\nRefusing to seed - content is invalid:\n");
      for (const issue of err.issues) {
        console.error(`  ${issue.filePath}\n    ${issue.message}`);
      }
      console.error("\nRun `pnpm validate:content` for the full report.\n");
      process.exit(1);
    }
    throw err;
  }

  const known = new Set(loaded.map((n) => n.frontmatter.id));

  const existing = await db
    .select({ id: nodes.id, contentHash: nodes.contentHash })
    .from(nodes);
  const existingHashes = new Map(existing.map((r) => [r.id, r.contentHash]));

  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const node of loaded) {
    const before = existingHashes.get(node.frontmatter.id);
    if (before === undefined) added.push(node.frontmatter.id);
    else if (before !== node.contentHash) changed.push(node.frontmatter.id);
    else unchanged.push(node.frontmatter.id);
  }

  const removed = existing
    .map((r) => r.id)
    .filter((id) => !known.has(id))
    .sort();

  // Prereq edges are only inserted where the target exists. Node 2.3 points at
  // 2.2, which is not written until M5; the validator warns about it and the FK
  // would fail here, so we skip the edge and let it appear when 2.2 lands.
  const skippedPrereqs: string[] = [];

  if (DRY_RUN) {
    report({ added, changed, unchanged, removed, skippedPrereqs: [] });
    console.log("Dry run - nothing was written.\n");
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    for (const { frontmatter, contentHash } of loaded) {
      const nodeId = frontmatter.id;

      const fields = {
        phase: frontmatter.phase,
        orderIndex: frontmatter.order_index,
        title: frontmatter.title,
        slug: frontmatter.slug,
        goal: frontmatter.goal,
        status: frontmatter.status,
        contentHash,
        updatedAt: new Date(),
      };

      await tx
        .insert(nodes)
        .values({ id: nodeId, ...fields })
        .onConflictDoUpdate({ target: nodes.id, set: fields });

      // A planned node has no checklist and no questions. Both loops below then
      // run over empty arrays and the delete clauses clear anything left over
      // from when it was published - which is what we want if a node is ever
      // reverted to planned.
      const checklist = isPublished(frontmatter) ? frontmatter.checklist : [];
      const questions = isPublished(frontmatter) ? frontmatter.questions : [];

      // --- checklist ----------------------------------------------------
      const checklistRows = checklist.map((item, orderIndex) => ({
        id: checklistItemId(nodeId, orderIndex),
        nodeId,
        item,
        orderIndex,
      }));

      for (const row of checklistRows) {
        await tx
          .insert(nodeChecklist)
          .values(row)
          .onConflictDoUpdate({
            target: nodeChecklist.id,
            set: { item: row.item, orderIndex: row.orderIndex },
          });
      }

      // Items removed from the MDX. Their checklist_state cascades away, which
      // is correct - the thing being tracked no longer exists.
      await tx.delete(nodeChecklist).where(
        checklistRows.length > 0
          ? and(
              eq(nodeChecklist.nodeId, nodeId),
              notInArray(
                nodeChecklist.id,
                checklistRows.map((r) => r.id),
              ),
            )
          : eq(nodeChecklist.nodeId, nodeId),
      );

      // --- questions ----------------------------------------------------
      const questionRows = questions.map((q, orderIndex) => ({
        id: questionId(nodeId, orderIndex),
        nodeId,
        prompt: q.prompt,
        answerKey: q.answer_key,
        orderIndex,
      }));

      for (const row of questionRows) {
        await tx
          .insert(nodeQuestions)
          .values(row)
          .onConflictDoUpdate({
            target: nodeQuestions.id,
            set: {
              prompt: row.prompt,
              answerKey: row.answerKey,
              orderIndex: row.orderIndex,
            },
          });
      }

      await tx.delete(nodeQuestions).where(
        questionRows.length > 0
          ? and(
              eq(nodeQuestions.nodeId, nodeId),
              notInArray(
                nodeQuestions.id,
                questionRows.map((r) => r.id),
              ),
            )
          : eq(nodeQuestions.nodeId, nodeId),
      );
    }

    // --- prereq edges, after every node exists ---------------------------
    for (const { frontmatter } of loaded) {
      await tx.delete(nodePrereqs).where(eq(nodePrereqs.nodeId, frontmatter.id));

      for (const prereqId of frontmatter.prereqs) {
        if (!known.has(prereqId)) {
          skippedPrereqs.push(`${frontmatter.id} -> ${prereqId}`);
          continue;
        }
        await tx
          .insert(nodePrereqs)
          .values({ nodeId: frontmatter.id, prereqId })
          .onConflictDoNothing();
      }
    }

    // --- nodes deleted from /content -------------------------------------
    if (removed.length > 0) {
      await tx.delete(nodes).where(inArray(nodes.id, removed));
    }
  });

  report({ added, changed, unchanged, removed, skippedPrereqs });

  const counts = await db
    .select({
      nodes: sql<number>`(select count(*) from ${nodes})`,
      prereqs: sql<number>`(select count(*) from ${nodePrereqs})`,
      checklist: sql<number>`(select count(*) from ${nodeChecklist})`,
      questions: sql<number>`(select count(*) from ${nodeQuestions})`,
    })
    .from(nodes)
    .limit(1);

  if (counts[0]) {
    const c = counts[0];
    console.log(
      `In the database: ${c.nodes} nodes, ${c.prereqs} prereq edges, ` +
        `${c.checklist} checklist items, ${c.questions} questions.\n`,
    );
  }

  process.exit(0);
}

function report(summary: {
  added: string[];
  changed: string[];
  unchanged: string[];
  removed: string[];
  skippedPrereqs: string[];
}) {
  const { added, changed, unchanged, removed, skippedPrereqs } = summary;

  console.log("\nSeed summary");
  console.log(`  added      ${added.length ? added.join(", ") : "-"}`);
  console.log(`  changed    ${changed.length ? changed.join(", ") : "-"}`);
  console.log(`  unchanged  ${unchanged.length ? unchanged.join(", ") : "-"}`);
  console.log(`  removed    ${removed.length ? removed.join(", ") : "-"}`);

  if (skippedPrereqs.length > 0) {
    console.log(
      `\n  ${skippedPrereqs.length} prereq edge(s) skipped - target not written yet:`,
    );
    for (const edge of skippedPrereqs) console.log(`    ${edge}`);
    console.log("  They will be created by the next seed after the target lands.");
  }

  console.log();
}

main().catch((err) => {
  console.error("\nSeed failed:\n", err);
  process.exit(1);
});
