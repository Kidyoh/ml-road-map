import Link from "next/link";
import { ArrowRight, Clock, ListChecks } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { NodeSummary } from "@/lib/progress";

/**
 * The card a learner lands on. Answers, before they click anything: what is the
 * next thing, what will it actually involve, and how long will it take.
 *
 * The entry-track picker is the only question we ask - one decision, taken
 * once. Everything else that would have gone into an onboarding flow is
 * answered here instead, at the moment it is relevant, which is cheaper for the
 * learner than a wizard they have to sit through before seeing anything.
 */
const TIME_ESTIMATE: Record<string, string> = {
  easy: "an hour or two",
  medium: "an afternoon",
  hard: "a day, and expect to be wrong first",
};

export function StartHere({
  node,
  brief,
  difficulty,
  resuming,
}: {
  node: NodeSummary;
  brief: string | null;
  difficulty: string | null;
  resuming: boolean;
}) {
  const progress =
    node.checklistTotal > 0
      ? node.checklistDone + node.questionsRated
      : 0;
  const progressTotal = node.checklistTotal + node.questionsTotal;

  return (
    <Card className="border-primary/40">
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs tracking-widest uppercase">
            {resuming ? "Pick up where you left off" : "Start here"}
          </span>
          {difficulty ? (
            <Badge variant="outline" className="text-xs font-normal">
              {difficulty}
            </Badge>
          ) : null}
        </div>

        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            <span className="text-muted-foreground font-mono text-base">
              {node.id}
            </span>{" "}
            {node.title}
          </h2>
          <p className="text-muted-foreground mt-1.5 max-w-prose text-sm leading-relaxed">
            {node.goal}
          </p>
        </div>

        {brief ? (
          <p className="max-w-prose border-l-2 pl-4 text-sm leading-relaxed">
            {brief}
          </p>
        ) : null}

        <div className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          {difficulty ? (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" aria-hidden />
              {TIME_ESTIMATE[difficulty] ?? difficulty}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <ListChecks className="size-3.5" aria-hidden />
            {node.checklistTotal} checkpoint items, {node.questionsTotal} questions
          </span>
          {resuming && progress > 0 ? (
            <span className="tabular-nums">
              {progress} of {progressTotal} done
            </span>
          ) : null}
        </div>

        <Button asChild className="w-fit">
          <Link href={`/node/${node.slug}`}>
            {resuming ? "Keep going" : "Open this node"}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
