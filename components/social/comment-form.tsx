"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Posting is optimistic-free on purpose: the comment appears after the server
 * confirms it. A comment that shows up instantly and then vanishes because the
 * write failed is worse than a moment of latency.
 */
export function CommentForm({
  post,
  placeholder = "Add to the discussion",
  submitLabel = "Post",
  compact = false,
  onDone,
}: {
  post: (body: string) => Promise<void>;
  placeholder?: string;
  submitLabel?: string;
  compact?: boolean;
  onDone?: () => void;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        await post(trimmed);
        setBody("");
        onDone?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not post");
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={placeholder}
        rows={compact ? 2 : 3}
        className="resize-y"
        aria-label={placeholder}
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={submit}
          disabled={pending || body.trim().length === 0}
        >
          {pending ? "Posting..." : submitLabel}
        </Button>
        {onDone ? (
          <Button size="sm" variant="ghost" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        ) : null}
        {error ? (
          <span className="text-destructive text-xs">{error}</span>
        ) : null}
      </div>
    </div>
  );
}
