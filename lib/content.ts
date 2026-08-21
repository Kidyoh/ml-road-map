/**
 * The single MDX loader. Three consumers - the seed script, the content
 * validator, and the node page - all read through here, so there is exactly one
 * definition of what a node file means.
 *
 * Content lives in git (non-negotiable 1). Nothing in this file touches the DB.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import matter from "gray-matter";

import { nodeFrontmatterSchema, type NodeFrontmatter } from "./content-schema";

export const CONTENT_DIR = join(process.cwd(), "content");

export type LoadedNode = {
  frontmatter: NodeFrontmatter;
  /** MDX body with frontmatter stripped. Compiled at render time. */
  body: string;
  /**
   * SHA-256 of the whole file, stored as nodes.content_hash.
   *
   * The build plan calls this "hash of the MDX body", but its stated purpose is
   * to detect when a node changed under learners who already passed it - and a
   * changed checklist item or answer key matters more to such a learner than a
   * reworded paragraph. Body-only hashing also made `pnpm seed` report a node as
   * "unchanged" after a frontmatter edit it had just written. So it covers
   * frontmatter too.
   *
   * Line endings are normalised first, or the same commit hashes differently on
   * a Windows checkout than in Linux CI.
   */
  contentHash: string;
  /** Repo-relative, for error messages that a human can act on. */
  filePath: string;
};

export type ContentIssue = {
  filePath: string;
  message: string;
};

export class ContentError extends Error {
  constructor(
    readonly issues: ContentIssue[],
    message = "Content failed validation",
  ) {
    super(message);
    this.name = "ContentError";
  }
}

async function listMdxFiles(): Promise<string[]> {
  const entries = await readdir(CONTENT_DIR, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("phase-")) continue;
    const phaseDir = join(CONTENT_DIR, entry.name);
    for (const file of await readdir(phaseDir)) {
      if (file.endsWith(".mdx")) files.push(join(phaseDir, file));
    }
  }

  return files.sort();
}

/**
 * Parse one file. Returns either a node or the reasons it is not one - the
 * caller decides whether to throw, because the validator wants to report every
 * bad file at once rather than stopping at the first.
 */
async function parseFile(
  absolutePath: string,
): Promise<{ node: LoadedNode } | { issues: ContentIssue[] }> {
  const filePath = absolutePath
    .slice(process.cwd().length + 1)
    .replaceAll("\\", "/");
  const raw = (await readFile(absolutePath, "utf8")).replaceAll("\r\n", "\n");
  const { data, content } = matter(raw);

  const parsed = nodeFrontmatterSchema.safeParse(data);
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

  // The filename encodes id and slug. Keeping them in sync means a node can be
  // found on disk from its URL without an index.
  const fileName = filePath.split("/").pop()!;
  const expectedName = `${parsed.data.id}-${parsed.data.slug}.mdx`;
  if (fileName !== expectedName) {
    return {
      issues: [
        {
          filePath,
          message: `filename should be "${expectedName}" to match id and slug`,
        },
      ],
    };
  }

  const expectedDir = `content/phase-${parsed.data.phase}/`;
  if (!filePath.startsWith(expectedDir)) {
    return {
      issues: [
        { filePath, message: `should live in ${expectedDir} to match phase` },
      ],
    };
  }

  return {
    node: {
      frontmatter: parsed.data,
      body,
      contentHash: createHash("sha256").update(raw.trim()).digest("hex"),
      filePath,
    },
  };
}

/**
 * Load every node. Throws ContentError listing every per-file problem at once.
 * Cross-file checks (duplicate ids, cycles, reachability) live in
 * scripts/validate-content.ts so this stays usable from a request path.
 */
export async function loadAllNodes(): Promise<LoadedNode[]> {
  const files = await listMdxFiles();
  const nodes: LoadedNode[] = [];
  const issues: ContentIssue[] = [];

  for (const file of files) {
    const result = await parseFile(file);
    if ("node" in result) nodes.push(result.node);
    else issues.push(...result.issues);
  }

  if (issues.length > 0) throw new ContentError(issues);

  return nodes.sort((a, b) =>
    a.frontmatter.phase !== b.frontmatter.phase
      ? a.frontmatter.phase - b.frontmatter.phase
      : a.frontmatter.order_index - b.frontmatter.order_index,
  );
}

export async function loadNodeBySlug(slug: string): Promise<LoadedNode | null> {
  const nodes = await loadAllNodes();
  return nodes.find((n) => n.frontmatter.slug === slug) ?? null;
}

/** Deterministic primary keys - see the note at the top of db/schema.ts. */
export const checklistItemId = (nodeId: string, orderIndex: number) =>
  `${nodeId}:c:${orderIndex}`;

export const questionId = (nodeId: string, orderIndex: number) =>
  `${nodeId}:q:${orderIndex}`;
