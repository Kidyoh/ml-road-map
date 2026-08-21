/**
 * Link checker. Section 8 names link rot as a live risk and makes a weekly CI
 * check the mitigation, so this runs on a cron rather than on every push - a
 * third-party outage should not block a merge.
 *
 *   pnpm check:links
 *   pnpm check:links --verbose   list every URL, not only the failures
 */
import { loadAllNodes } from "../lib/content";
import { isPublished } from "../lib/content-schema";

const VERBOSE = process.argv.includes("--verbose");
const CONCURRENCY = 6;
const TIMEOUT_MS = 20_000;

/**
 * Hosts that answer a bot with 403 no matter how politely it asks. A failure
 * here means "we could not check", not "the link is dead", and the two should
 * not be conflated - so they are reported separately rather than passed
 * silently. Keep this list short and justified.
 */
const BOT_HOSTILE_HOSTS = new Set([
  "www.oreilly.com",
  "learning.oreilly.com",
  "www.udemy.com",
  "www.coursera.org",
]);

const USER_AGENT =
  "Mozilla/5.0 (compatible; ml-roadmap-linkcheck/1.0; +https://github.com/)";

type Target = { url: string; where: string };
type Result = Target & {
  status: "ok" | "dead" | "unverifiable";
  detail: string;
};

async function probe(target: Target): Promise<Result> {
  const host = (() => {
    try {
      return new URL(target.url).host;
    } catch {
      return "";
    }
  })();

  const attempt = async (method: "HEAD" | "GET") => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(target.url, {
        method,
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "*/*" },
      });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    // HEAD first to avoid pulling whole pages; plenty of servers do not
    // implement it, so fall back to GET on anything non-2xx.
    let response = await attempt("HEAD");
    if (!response.ok) response = await attempt("GET");

    if (response.ok) {
      return { ...target, status: "ok", detail: String(response.status) };
    }

    if (BOT_HOSTILE_HOSTS.has(host) && [401, 403, 429].includes(response.status)) {
      return {
        ...target,
        status: "unverifiable",
        detail: `${response.status} from a host that blocks bots - check by hand`,
      };
    }

    return { ...target, status: "dead", detail: `HTTP ${response.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (BOT_HOSTILE_HOSTS.has(host)) {
      return { ...target, status: "unverifiable", detail: message };
    }
    return { ...target, status: "dead", detail: message };
  }
}

/** Fixed-size worker pool - politer to the hosts than firing everything at once. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

async function main() {
  const nodes = await loadAllNodes();
  const targets: Target[] = [];

  for (const node of nodes) {
    // Planned nodes have no resources yet - nothing to rot.
    if (!isPublished(node.frontmatter)) continue;
    const { id, resources, session } = node.frontmatter;
    targets.push({ url: resources.primary.url, where: `${id} resources.primary` });
    targets.push({ url: resources.alt.url, where: `${id} resources.alt` });

    // Local datasets are files in this repo, not links that can rot.
    if (session.dataset && !session.dataset.startsWith("/datasets/")) {
      targets.push({ url: session.dataset, where: `${id} session.dataset` });
    }
  }

  console.log(`\nChecking ${targets.length} URL(s) across ${nodes.length} node(s)...\n`);

  const results = await mapPool(targets, CONCURRENCY, probe);

  const dead = results.filter((r) => r.status === "dead");
  const unverifiable = results.filter((r) => r.status === "unverifiable");

  for (const result of results) {
    if (result.status === "ok" && !VERBOSE) continue;
    const label =
      result.status === "ok" ? "ok" : result.status === "dead" ? "DEAD" : "??";
    console.log(`  ${label.padEnd(5)} ${result.where}`);
    console.log(`        ${result.url}`);
    if (result.status !== "ok") console.log(`        ${result.detail}`);
  }

  console.log(
    `\n${results.length} checked: ${results.length - dead.length - unverifiable.length} ok, ` +
      `${dead.length} dead, ${unverifiable.length} unverifiable.\n`,
  );

  if (unverifiable.length > 0) {
    console.log("Unverifiable hosts block automated checks. Open them by hand.\n");
  }

  process.exit(dead.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
