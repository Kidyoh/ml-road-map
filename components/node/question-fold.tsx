"use client";

import { useState, useTransition } from "react";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { SELF_RATINGS, type SelfRating } from "@/lib/signals";

export type Question = {
  id: string;
  prompt: string;
  answerKey: string;
  response: string | null;
  selfRating: SelfRating | null;
  revealed: boolean;
};

export type SaveAttempt = (input: {
  questionId: string;
  response?: string;
  revealed?: boolean;
  selfRating?: SelfRating;
}) => Promise<void>;

const RATING_LABEL: Record<SelfRating, string> = {
  got_it: "Got it",
  partial: "Partly",
  no_idea: "No idea",
};

/**
 * Short answer with a reveal fold. Never multiple choice (non-negotiable 4):
 * multiple choice tests recognition, and we want recall and articulation.
 *
 * The ordering is the whole design. You write something, THEN you reveal, THEN
 * you rate yourself. Revealing before writing anything is recorded as
 * `revealed_before_attempt` - which is why the textarea sits above the fold and
 * the rating controls only appear once it is open.
 */
function QuestionCard({
  question,
  index,
  save,
}: {
  question: Question;
  index: number;
  save: SaveAttempt | null;
}) {
  const [response, setResponse] = useState(question.response ?? "");
  const [revealed, setRevealed] = useState(question.revealed);
  const [rating, setRating] = useState<SelfRating | null>(question.selfRating);
  const [, startTransition] = useTransition();

  const attempted = response.trim().length > 0;

  const onReveal = (open: boolean) => {
    setRevealed(open);
    if (!open || !save) return;
    // Send the response along with the reveal, so the server can tell whether
    // anything was written before the key was opened.
    startTransition(async () => {
      await save({ questionId: question.id, response, revealed: true });
    });
  };

  const onRate = (value: SelfRating) => {
    setRating(value);
    if (!save) return;
    startTransition(async () => {
      await save({ questionId: question.id, response, selfRating: value });
    });
  };

  const onBlur = () => {
    if (!save || response === (question.response ?? "")) return;
    startTransition(async () => {
      await save({ questionId: question.id, response });
    });
  };

  return (
    <Card className={rating ? "border-primary/30" : undefined}>
      <CardHeader>
        <CardTitle className="flex gap-3 text-base leading-relaxed font-medium text-pretty">
          <span className="text-muted-foreground font-mono text-sm">
            {index + 1}
          </span>
          <span>{question.prompt}</span>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <Textarea
          value={response}
          onChange={(event) => setResponse(event.target.value)}
          onBlur={onBlur}
          placeholder="Write your answer before you reveal. Even a bad one."
          rows={4}
          className="resize-y"
          aria-label={`Your answer to question ${index + 1}`}
        />

        <Collapsible open={revealed} onOpenChange={onReveal}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="w-fit">
              <ChevronRight
                className={
                  revealed
                    ? "size-4 rotate-90 transition-transform"
                    : "size-4 transition-transform"
                }
                aria-hidden
              />
              {revealed ? "Hide the answer" : "Reveal the answer"}
            </Button>
          </CollapsibleTrigger>

          {!revealed && !attempted ? (
            <p className="text-muted-foreground mt-2 text-xs">
              You have not written anything yet. Revealing now is recorded, and
              it is the single strongest predictor that a node did not stick.
            </p>
          ) : null}

          <CollapsibleContent className="mt-4 flex flex-col gap-4">
            <div className="bg-muted/50 rounded-md border p-4">
              <p className="text-muted-foreground mb-2 text-xs tracking-widest uppercase">
                Answer key
              </p>
              <p className="text-sm leading-relaxed text-pretty">
                {question.answerKey}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">
                How did yours compare?
              </span>
              {SELF_RATINGS.map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={rating === value ? "default" : "outline"}
                  onClick={() => onRate(value)}
                  disabled={!save}
                >
                  {RATING_LABEL[value]}
                </Button>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

export function QuestionFold({
  questions,
  save,
}: {
  questions: Question[];
  save: SaveAttempt | null;
}) {
  const rated = questions.filter((q) => q.selfRating).length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium tracking-widest uppercase">Concepts</h2>
        <span className="text-muted-foreground text-xs tabular-nums">
          {rated} of {questions.length} rated
        </span>
      </div>
      <p className="text-muted-foreground max-w-prose text-sm">
        Write first, reveal second, rate yourself third. Doing it in that order is
        the entire value of this section.
      </p>
      <div className="flex flex-col gap-4">
        {questions.map((question, index) => (
          <QuestionCard
            key={question.id}
            question={question}
            index={index}
            save={save}
          />
        ))}
      </div>
      {!save ? (
        <p className="text-muted-foreground text-xs">
          Sign in to save your answers and ratings.
        </p>
      ) : null}
    </section>
  );
}
