"use client";

import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";

import { CommentForm } from "@/components/social/comment-form";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { CapstoneSubmission } from "@/lib/social";

/**
 * Node 7.1's peer review flow.
 *
 * The capstone requires a review from another person, and the checklist item is
 * "their written feedback exists" - so this is the mechanism that makes that
 * item satisfiable rather than a note to go and find a friend. Submissions are
 * public to anyone who has reached 7.1, which is a small enough group that no
 * further gating is worth building.
 *
 * Reviewers are handed the node's own checklist as the rubric. A review that
 * says "looks good" is not a review, and the fastest way to prevent that is to
 * put the questions in front of the reviewer.
 */
const RUBRIC = [
  "Is the dataset genuinely self-sourced?",
  "Is there a baseline, established before modelling, with its number stated?",
  "Does the final number beat the baseline by more than the stated noise?",
  "Is the eval set at least 50 cases, labelled by a human?",
  "Does the deployed endpoint respond to the curl command in the README?",
  "Does the README name a weakness and a situation where it should not be used?",
  "Is the answer about ten times the data specific, or is it 'train a bigger model'?",
];

export function CapstonePanel({
  submissions,
  mine,
  signedIn,
  submit,
  withdraw,
  review,
}: {
  submissions: CapstoneSubmission[];
  mine: CapstoneSubmission | null;
  signedIn: boolean;
  submit: (kind: "link" | "repo", urlOrBody: string) => Promise<void>;
  withdraw: () => Promise<void>;
  review: (artifactId: string, body: string) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [reviewing, setReviewing] = useState<string | null>(null);

  const others = submissions.filter((s) => !s.isMine);

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-sm font-medium tracking-widest uppercase">
        Peer review
      </h2>

      {/* --- your submission ------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your capstone</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {mine ? (
            <>
              <a
                href={mine.urlOrBody}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary inline-flex w-fit items-center gap-1.5 text-sm hover:underline"
              >
                {mine.urlOrBody}
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
              <p className="text-muted-foreground text-xs">
                {mine.reviews.length === 0
                  ? "No reviews yet. The checklist needs one before this node is done."
                  : `${mine.reviews.length} review${mine.reviews.length === 1 ? "" : "s"} received.`}
              </p>

              {mine.reviews.map((r) => (
                <figure key={r.id} className="bg-muted/30 rounded-md border p-3">
                  <blockquote className="text-sm leading-relaxed whitespace-pre-wrap">
                    {r.body}
                  </blockquote>
                  <figcaption className="text-muted-foreground mt-2 text-xs">
                    {r.author.name ?? "A learner"}
                  </figcaption>
                </figure>
              ))}

              <Button
                variant="ghost"
                size="sm"
                className="w-fit"
                disabled={pending}
                onClick={() => startTransition(async () => withdraw())}
              >
                Withdraw
              </Button>
            </>
          ) : signedIn ? (
            <>
              <p className="text-muted-foreground text-sm">
                Submit a link to your repository or write-up. Another learner
                reviews it against the checklist.
              </p>
              <Textarea
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://github.com/you/your-capstone"
                rows={2}
                aria-label="Capstone URL"
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={pending || url.trim().length === 0}
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      try {
                        await submit("repo", url);
                        setUrl("");
                      } catch (err) {
                        setError(
                          err instanceof Error ? err.message : "Could not submit",
                        );
                      }
                    });
                  }}
                >
                  {pending ? "Submitting..." : "Submit for review"}
                </Button>
                {error ? (
                  <span className="text-destructive text-xs">{error}</span>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Sign in to submit a capstone.
            </p>
          )}
        </CardContent>
      </Card>

      {/* --- reviewing somebody else ------------------------------------ */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">
          Waiting for review{" "}
          <span className="text-muted-foreground tabular-nums">
            ({others.length})
          </span>
        </h3>

        {others.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nobody else has submitted yet. Reviewing someone teaches differently
            from building &mdash; it is worth coming back for.
          </p>
        ) : (
          others.map((submission) => (
            <Card key={submission.id}>
              <CardContent className="flex flex-col gap-3 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Avatar className="size-6">
                    <AvatarImage
                      src={submission.author.image ?? undefined}
                      alt={submission.author.name ?? "Learner"}
                    />
                    <AvatarFallback className="text-[10px]">
                      {(submission.author.name ?? "?").slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium">
                    {submission.author.name ?? "A learner"}
                  </span>
                  <Badge variant="outline" className="text-xs font-normal">
                    {submission.reviews.length} review
                    {submission.reviews.length === 1 ? "" : "s"}
                  </Badge>
                </div>

                <a
                  href={submission.urlOrBody}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary inline-flex w-fit items-center gap-1.5 text-sm break-all hover:underline"
                >
                  {submission.urlOrBody}
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                </a>

                {submission.reviews.map((r) => (
                  <figure key={r.id} className="bg-muted/30 rounded-md border p-3">
                    <blockquote className="text-sm leading-relaxed whitespace-pre-wrap">
                      {r.body}
                    </blockquote>
                    <figcaption className="text-muted-foreground mt-2 text-xs">
                      {r.author.name ?? "A learner"}
                    </figcaption>
                  </figure>
                ))}

                {signedIn ? (
                  reviewing === submission.id ? (
                    <div className="flex flex-col gap-2">
                      <details className="text-muted-foreground text-xs">
                        <summary className="cursor-pointer select-none">
                          The rubric
                        </summary>
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                          {RUBRIC.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </details>
                      <CommentForm
                        submitLabel="Post review"
                        placeholder="Go through the rubric. Name what is missing, not just what is good."
                        post={(body) => review(submission.id, body)}
                        onDone={() => setReviewing(null)}
                      />
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-fit"
                      onClick={() => setReviewing(submission.id)}
                    >
                      Review this
                    </Button>
                  )
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </section>
  );
}
