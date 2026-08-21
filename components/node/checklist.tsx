"use client";

import { useOptimistic, useState, useTransition } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";

export type ChecklistItem = { id: string; item: string };

/**
 * Optimistic ticks: the box responds immediately and the write happens behind
 * it. A checklist that lags a round-trip per click feels broken, and these are
 * clicked in bursts as a learner works down the list.
 *
 * `persist` is null when nobody is signed in, which is the read-only case - the
 * boxes still tick so the page is usable, they just do not survive a reload.
 */
export function Checklist({
  items,
  initialChecked,
  persist,
  passed,
}: {
  items: ChecklistItem[];
  initialChecked: Record<string, boolean>;
  persist: ((itemId: string, checked: boolean) => Promise<void>) | null;
  passed: boolean;
}) {
  const [saved, setSaved] = useState(initialChecked);
  const [, startTransition] = useTransition();

  const [checked, setOptimistic] = useOptimistic(
    saved,
    (state, update: { id: string; value: boolean }) => ({
      ...state,
      [update.id]: update.value,
    }),
  );

  const doneCount = items.filter((i) => checked[i.id]).length;
  const allDone = items.length > 0 && doneCount === items.length;

  const toggle = (itemId: string, next: boolean) => {
    startTransition(async () => {
      setOptimistic({ id: itemId, value: next });
      if (persist) {
        await persist(itemId, next);
      }
      setSaved((prev) => ({ ...prev, [itemId]: next }));
    });
  };

  return (
    <Card className={allDone ? "border-primary/40" : undefined}>
      <CardHeader className="gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle className="text-sm font-medium tracking-widest uppercase">
            Checkpoint
          </CardTitle>
          <span className="text-muted-foreground text-xs tabular-nums">
            {doneCount} of {items.length}
          </span>
        </div>
        <Progress
          value={items.length ? (doneCount / items.length) * 100 : 0}
          aria-label={`${doneCount} of ${items.length} checkpoint items complete`}
        />
      </CardHeader>

      <CardContent className="flex flex-col gap-1">
        {items.map((item) => {
          const isChecked = Boolean(checked[item.id]);
          return (
            <label
              key={item.id}
              className="hover:bg-accent/50 flex cursor-pointer items-start gap-3 rounded-md p-2 transition-colors"
            >
              <Checkbox
                checked={isChecked}
                onCheckedChange={(next) => toggle(item.id, next === true)}
                className="mt-0.5 shrink-0"
              />
              <span
                className={
                  isChecked
                    ? "text-muted-foreground text-sm leading-relaxed line-through"
                    : "text-sm leading-relaxed"
                }
              >
                {item.item}
              </span>
            </label>
          );
        })}

        <p className="text-muted-foreground mt-3 border-t pt-3 text-xs leading-relaxed">
          {allDone
            ? "Every box ticked. Be honest about the ones you were tempted to round up - nobody else is checking these."
            : "Every item here is something you can be wrong about. That is deliberate. If you cannot verify one, you have not finished the session."}
        </p>

        {!persist ? (
          <p className="text-muted-foreground text-xs">
            Sign in to save your progress.
          </p>
        ) : allDone && !passed ? (
          <p className="text-muted-foreground text-xs">
            Checklist done. Rate yourself on every question below to pass this
            node.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
