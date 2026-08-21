import Link from "next/link";

import type { Graph, NodeSummary } from "@/lib/progress";

/**
 * Says where this node sits for this learner, and - when it is locked - exactly
 * what is standing in the way.
 *
 * A locked node is readable rather than blocked. The build plan fogs nodes
 * instead of hiding them so a learner can see the shape of the road ahead;
 * refusing to render the page would undo that. What the banner does is remove
 * any doubt about whether you are supposed to be here yet.
 */
export function NodeStateBanner({
  summary,
  signedIn,
  graph,
}: {
  summary: NodeSummary;
  signedIn: boolean;
  graph: Graph;
}) {
  if (!signedIn) return null;
  if (summary.status === "planned") return null;

  if (summary.state === "passed") {
    return (
      <p className="border-primary/40 bg-primary/5 rounded-md border px-4 py-3 text-sm">
        {summary.assumedPassed
          ? "Your entry track assumes you already have this. Work through it anyway if you are not sure."
          : "Passed. Coming back here is fine — it is recorded, because returning to a passed node usually means it did not stick the first time."}
      </p>
    );
  }

  if (summary.state === "open" || summary.state === "in_progress") return null;

  const blockers = summary.prereqs
    .map((id) => graph.byId.get(id))
    .filter((n): n is NodeSummary => Boolean(n) && n!.state !== "passed");

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <p>
        This node is {summary.state === "fogged" ? "not open yet" : "well ahead of where you are"}.
        You can read it, but the ticks will not unlock anything until its
        prerequisites are passed.
      </p>
      {blockers.length > 0 ? (
        <p className="mt-2">
          Waiting on{" "}
          {blockers.map((b, i) => (
            <span key={b.id}>
              {i > 0 ? ", " : ""}
              <Link href={`/node/${b.slug}`} className="underline">
                {b.id} {b.title}
              </Link>
              {b.status === "planned" ? " (unwritten)" : ""}
            </span>
          ))}
          .
        </p>
      ) : null}
    </div>
  );
}
