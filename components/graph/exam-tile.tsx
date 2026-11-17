import Link from "next/link";
import { Check, ClipboardCheck, Hourglass, Lock, Timer } from "lucide-react";

import type { ExamSummary } from "@/lib/progress";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<ExamSummary["state"], string> = {
  locked: "Locked",
  open: "Ready to take",
  in_progress: "In progress",
  cooldown: "Retake soon",
  passed: "Passed",
};

/**
 * A phase's exam, drawn at the end of the phase it closes.
 *
 * It spans the row rather than sitting in the grid as a tile among tiles,
 * because it is not one more node: it is the gate between this phase and the
 * next, and the map should say so at a glance.
 */
export function ExamTile({ exam }: { exam: ExamSummary }) {
  const waived = exam.waived && exam.state !== "passed";

  const detail =
    exam.state === "passed" && exam.bestCorrect !== null
      ? `${exam.bestCorrect}/${exam.bestTotal} correct`
      : waived
        ? "Not required for your entry track"
        : exam.state === "locked"
          ? exam.kind === "final"
            ? `${exam.blockingExamIds.length} phase exam${exam.blockingExamIds.length === 1 ? "" : "s"} to go`
            : `${exam.blockingNodeIds.length} node${exam.blockingNodeIds.length === 1 ? "" : "s"} to go`
          : `${exam.questionCount} questions · ${exam.timeLimitMinutes} min`;

  const Icon =
    exam.state === "passed"
      ? Check
      : exam.state === "in_progress"
        ? Timer
        : exam.state === "cooldown"
          ? Hourglass
          : exam.state === "locked"
            ? Lock
            : ClipboardCheck;

  return (
    <Link
      href={`/exam/${exam.slug}`}
      className={cn(
        "group flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-dashed px-4 py-3 transition-all",
        "hover:border-foreground/30 hover:shadow-sm",
        exam.state === "passed" && "border-primary/50 bg-primary/5 border-solid",
        exam.state === "open" && "border-foreground/40 border-solid",
        exam.state === "in_progress" && "border-solid border-amber-500/60 bg-amber-500/5",
        exam.state === "locked" && "opacity-60",
      )}
      aria-label={`${exam.title}, ${STATE_LABEL[exam.state]}`}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          exam.state === "passed" ? "text-primary" : "text-muted-foreground",
        )}
        aria-hidden
      />
      <span className="text-sm font-medium">{exam.title}</span>
      <span className="text-muted-foreground text-xs">{detail}</span>
      <span className="text-muted-foreground ml-auto font-mono text-[0.7rem] tracking-widest uppercase">
        {waived ? "Waived" : STATE_LABEL[exam.state]}
      </span>
    </Link>
  );
}
