import Link from "next/link";
import { Check, X } from "lucide-react";

import { PromptText } from "@/components/exam/prompt-text";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttemptView } from "@/lib/exams";
import { cn } from "@/lib/utils";

/**
 * One finished attempt, question by question.
 *
 * What it shows depends on whether the exam has been passed, and the server
 * decides that - `answer` and `explanation` are simply absent from the data
 * for an exam that has not been (lib/exams.ts, toAttemptView). After a fail
 * the learner sees which questions were wrong and which node each one tests,
 * which is everything needed to know what to go back to and nothing that
 * would turn the retake into copying.
 */
export function ExamResults({
  attempt,
  nodeLinks,
}: {
  attempt: AttemptView;
  /** Node id to its slug and title, for the "go back to" links. */
  nodeLinks: Record<string, { slug: string; title: string }>;
}) {
  const passed = attempt.status === "passed";
  const correct = attempt.correct ?? 0;
  const percent = attempt.total > 0 ? Math.round((correct / attempt.total) * 100) : 0;

  // Nodes with at least one miss, in paper order, each listed once.
  const toRevisit = [
    ...new Set(attempt.questions.filter((q) => q.correct === false).map((q) => q.covers)),
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card
        className={cn(
          passed ? "border-primary/50 bg-primary/5" : "border-amber-500/40 bg-amber-500/5",
        )}
      >
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-widest uppercase">
            {passed ? "Passed" : attempt.timedOut ? "Timed out" : "Not passed"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-3xl font-semibold tabular-nums">
            {correct}/{attempt.total}
            <span className="text-muted-foreground ml-3 text-base font-normal">
              {percent}% &middot; {attempt.needed} needed
            </span>
          </p>
          {attempt.timedOut ? (
            <p className="max-w-prose text-sm leading-relaxed">
              The time limit passed before this attempt was submitted, so
              nothing was graded. An attempt that runs out of time counts as
              not passed.
            </p>
          ) : !passed && toRevisit.length > 0 ? (
            <div className="flex flex-col gap-2 text-sm">
              <p className="max-w-prose leading-relaxed">
                The questions you missed test these nodes. Go back to them
                before the retake &mdash; it will ask the same skills with
                different numbers.
              </p>
              <ul className="flex flex-col gap-1.5">
                {toRevisit.map((id) => (
                  <li key={id} className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">
                      {id}
                    </Badge>
                    {nodeLinks[id] ? (
                      <Link
                        href={`/node/${nodeLinks[id].slug}`}
                        className="text-primary hover:underline"
                      >
                        {nodeLinks[id].title}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {attempt.timedOut ? null : (
        <ol className="flex flex-col gap-3">
          {attempt.questions.map((q, index) => (
            <li
              key={q.id}
              className={cn(
                "rounded-md border p-4",
                q.correct ? "border-primary/30" : "border-amber-500/40",
              )}
            >
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                {q.correct ? (
                  <Check className="text-primary size-4" aria-hidden />
                ) : (
                  <X className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
                )}
                <span className="font-medium tracking-widest uppercase">
                  Question {index + 1} &middot; {q.correct ? "correct" : "incorrect"}
                </span>
                <span className="ml-auto font-mono">node {q.covers}</span>
              </div>

              <div className="mt-3">
                <PromptText text={q.prompt} />
              </div>

              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-muted-foreground">You answered</dt>
                <dd className="font-mono">
                  {q.response ?? <span className="text-muted-foreground italic">blank</span>}
                </dd>
                {q.answer !== undefined ? (
                  <>
                    <dt className="text-muted-foreground">Answer</dt>
                    <dd className="font-mono">{q.answer}</dd>
                  </>
                ) : null}
              </dl>

              {q.explanation ? (
                <p className="text-muted-foreground mt-3 max-w-prose border-t pt-3 text-sm leading-relaxed whitespace-pre-wrap">
                  {q.explanation}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {!passed && !attempt.timedOut ? (
        <p className="text-muted-foreground max-w-prose text-xs leading-relaxed">
          Correct answers and worked solutions are shown once you pass this
          exam, for every attempt you made.
        </p>
      ) : null}
    </div>
  );
}
