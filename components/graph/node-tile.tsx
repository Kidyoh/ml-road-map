import Link from "next/link";
import { Check, Lock, PenLine } from "lucide-react";

import type { NodeSummary } from "@/lib/progress";
import { cn } from "@/lib/utils";

/**
 * One node on the map.
 *
 * Fogged and hidden nodes are dimmed, not removed. Non-negotiable: "Locked nodes
 * are fogged, not hidden entirely - the learner can see the shape of the road
 * ahead." Hidden is dimmer than fogged, but still legible, and still a link -
 * curiosity about what is coming is worth more than the tidiness of hiding it.
 */
export function NodeTile({ node }: { node: NodeSummary }) {
  const isPlanned = node.status === "planned";
  const locked = node.state === "fogged" || node.state === "hidden";

  const progress =
    node.checklistTotal > 0
      ? (node.checklistDone + node.questionsRated) /
        (node.checklistTotal + node.questionsTotal)
      : 0;

  return (
    <Link
      href={`/node/${node.slug}`}
      className={cn(
        "group relative flex flex-col gap-1.5 rounded-md border p-3 transition-all",
        "hover:border-foreground/30 hover:shadow-sm",
        node.state === "passed" && "border-primary/50 bg-primary/5",
        node.state === "in_progress" && "border-foreground/30",
        node.state === "fogged" && "opacity-60",
        node.state === "hidden" && "opacity-35",
        isPlanned && "border-dashed",
      )}
      aria-label={`${node.id} ${node.title}, ${node.state.replace("_", " ")}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground font-mono text-[0.7rem]">
          {node.id}
        </span>

        <span className="ml-auto flex items-center gap-1">
          {node.state === "passed" ? (
            <Check className="text-primary size-3.5" aria-hidden />
          ) : locked ? (
            <Lock className="text-muted-foreground size-3" aria-hidden />
          ) : null}
          {isPlanned ? (
            <PenLine className="text-muted-foreground size-3" aria-hidden />
          ) : null}
        </span>
      </div>

      <span className="text-sm leading-snug font-medium text-pretty">
        {node.title}
      </span>

      {/* Partial progress is worth showing: it is the difference between
          "not started" and "three items from passing". */}
      {node.state === "in_progress" && progress > 0 ? (
        <span className="bg-muted mt-1 h-1 w-full overflow-hidden rounded-full">
          <span
            className="bg-foreground/60 block h-full rounded-full"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </span>
      ) : null}

      {isPlanned ? (
        <span className="text-muted-foreground text-[0.7rem]">Not written yet</span>
      ) : null}
    </Link>
  );
}
