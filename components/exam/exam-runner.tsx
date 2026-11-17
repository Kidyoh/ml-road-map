"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";

import { PromptText } from "@/components/exam/prompt-text";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type RunnerQuestion = {
  id: string;
  covers: string;
  prompt: string;
  answerType: "number" | "text";
};

const draftKey = (attemptId: string) => `exam-draft:${attemptId}`;

/** Storage can be unavailable (private windows, blocked site data). Never throw. */
function readDraft(attemptId: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(draftKey(attemptId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function writeDraft(attemptId: string, answers: Record<string, string>) {
  try {
    window.localStorage.setItem(draftKey(attemptId), JSON.stringify(answers));
  } catch {
    // The draft is a convenience. The answers still live in the inputs.
  }
}

function clearDraft(attemptId: string) {
  try {
    window.localStorage.removeItem(draftKey(attemptId));
  } catch {
    // Nothing to do.
  }
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * An attempt in progress.
 *
 * The clock that counts is on the server: `deadline_at` was fixed when the
 * attempt started, and a submit that arrives after it is not graded. The
 * countdown here exists so that nobody is surprised by that. It is driven by
 * `remainingMs` as the server computed it at render, measured forward on the
 * browser's monotonic clock - so a wrong system clock on the learner's machine
 * cannot make the timer lie in either direction.
 *
 * Answers are drafted to localStorage on every keystroke. A refresh, a closed
 * tab or a crashed browser costs time, not work.
 */
export function ExamRunner({
  attemptId,
  questions,
  remainingMs,
  needed,
  submit,
}: {
  attemptId: string;
  questions: RunnerQuestion[];
  remainingMs: number;
  needed: number;
  submit: (attemptId: string, responses: Record<string, string>) => Promise<void>;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const submittedRef = useRef(false);

  const [remaining, setRemaining] = useState(remainingMs);
  const [answered, setAnswered] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const collect = useCallback((): Record<string, string> => {
    const form = formRef.current;
    const out: Record<string, string> = {};
    if (!form) return out;
    for (const question of questions) {
      const input = form.elements.namedItem(question.id);
      if (input instanceof HTMLInputElement && input.value.trim() !== "") {
        out[question.id] = input.value.trim();
      }
    }
    return out;
  }, [questions]);

  const send = useCallback(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setError(null);

    const responses = collect();
    startTransition(async () => {
      try {
        await submit(attemptId, responses);
        clearDraft(attemptId);
        router.refresh();
      } catch {
        // Let them try again - the draft is still in the inputs.
        submittedRef.current = false;
        setError("That did not go through. Check your connection and submit again.");
      }
    });
  }, [attemptId, collect, router, submit]);

  // Restore a draft into the (uncontrolled) inputs, then start the clock.
  useEffect(() => {
    const form = formRef.current;
    const draft = readDraft(attemptId);
    let restored = 0;

    if (form) {
      for (const question of questions) {
        const input = form.elements.namedItem(question.id);
        const saved = draft[question.id];
        if (input instanceof HTMLInputElement && typeof saved === "string") {
          input.value = saved;
          if (saved.trim() !== "") restored++;
        }
      }
    }

    const endsAt = performance.now() + remainingMs;
    let fired = false;

    const tick = (first = false) => {
      const left = endsAt - performance.now();
      setRemaining(left);
      if (first) setAnswered(restored);
      if (left <= 0 && !fired) {
        fired = true;
        send();
      }
    };

    // The first tick is deferred so every state update happens in a callback.
    const kickoff = window.setTimeout(() => tick(true), 0);
    const interval = window.setInterval(() => tick(), 1000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [attemptId, questions, remainingMs, send]);

  const onInput = () => {
    const responses = collect();
    writeDraft(attemptId, responses);
    setAnswered(Object.keys(responses).length);
    setConfirming(false);
  };

  const unanswered = questions.length - answered;
  const low = remaining <= 5 * 60 * 1000;
  const out = remaining <= 0;

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-6"
      onInput={onInput}
      onSubmit={(event) => {
        event.preventDefault();
        if (unanswered > 0 && !confirming) {
          setConfirming(true);
          return;
        }
        send();
      }}
    >
      <div
        className={cn(
          "bg-background/95 sticky top-0 z-10 -mx-2 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 backdrop-blur",
          low && "border-amber-500/60",
        )}
      >
        <span
          className={cn(
            "flex items-center gap-2 font-mono text-lg tabular-nums",
            low && "text-amber-600 dark:text-amber-400",
          )}
          role="timer"
          aria-label={`Time remaining ${formatClock(remaining)}`}
        >
          <Clock className="size-4" aria-hidden />
          {formatClock(remaining)}
        </span>
        <span className="text-muted-foreground text-sm tabular-nums">
          {answered} of {questions.length} answered &middot; {needed} needed to pass
        </span>
      </div>

      <ol className="flex flex-col gap-4">
        {questions.map((question, index) => (
          <li key={question.id}>
            <Card>
              <CardHeader>
                <CardTitle className="text-muted-foreground flex items-center justify-between gap-3 text-xs font-medium tracking-widest uppercase">
                  <span>Question {index + 1}</span>
                  <span className="font-mono normal-case">node {question.covers}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <PromptText text={question.prompt} />
                <label className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground text-xs">
                    {question.answerType === "number"
                      ? "Your answer (a number, no units)"
                      : "Your answer"}
                  </span>
                  <input
                    name={question.id}
                    type="text"
                    inputMode={question.answerType === "number" ? "decimal" : "text"}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={120}
                    disabled={pending || out}
                    className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-9 w-full max-w-xs rounded-lg border bg-transparent px-2.5 font-mono text-sm transition-colors outline-none focus-visible:ring-3 disabled:opacity-50"
                  />
                </label>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-3 border-t pt-6">
        {confirming ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            {unanswered} question{unanswered === 1 ? " is" : "s are"} still
            blank and will be marked wrong. Submit anyway?
          </p>
        ) : null}
        {error ? (
          <p className="border-destructive/40 bg-destructive/10 rounded-md border px-4 py-3 text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending
              ? "Submitting…"
              : confirming
                ? "Yes, submit with blanks"
                : "Submit exam"}
          </Button>
          {confirming ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Keep working
            </Button>
          ) : null}
          <span className="text-muted-foreground text-xs">
            Submitting is final. When the clock reaches zero the exam submits
            itself with whatever is filled in.
          </span>
        </div>
      </div>
    </form>
  );
}
