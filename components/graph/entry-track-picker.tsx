"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { EntryTrack } from "@/lib/progress";

const TRACKS: {
  value: EntryTrack;
  label: string;
  start: string;
  blurb: string;
}[] = [
  {
    value: "beginner",
    label: "New to this",
    start: "0.1",
    blurb: "Start at Python fundamentals. Nothing is assumed.",
  },
  {
    value: "developer",
    label: "I can already code",
    start: "1.1",
    blurb:
      "Skip to linear algebra. Assumes Python and numpy — the earlier nodes stay open if you want them.",
  },
  {
    value: "practitioner",
    label: "I have trained models",
    start: "3.1",
    blurb:
      "Skip to feature engineering. Assumes everything through validation and leakage.",
  },
];

/**
 * Shown once, on first arrival at the map.
 *
 * Picking a track marks the transitive prerequisites of its start node as
 * passed — and nothing else. It is a claim about what you already know, not a
 * fast-forward through the roadmap, so the nodes it does not cover stay exactly
 * as available as they were.
 */
export function EntryTrackPicker({
  onPick,
}: {
  onPick: (track: EntryTrack) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where should you start?</CardTitle>
        <CardDescription>
          This only sets your starting point. Every node stays readable either
          way, and you can work through anything you skipped.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        {TRACKS.map((track) => (
          <button
            key={track.value}
            type="button"
            disabled={pending}
            onClick={() => startTransition(async () => onPick(track.value))}
            className="hover:border-foreground/40 hover:bg-accent/50 flex flex-col gap-2 rounded-md border p-4 text-left transition-colors disabled:opacity-50"
          >
            <span className="font-medium">{track.label}</span>
            <span className="text-muted-foreground text-xs leading-relaxed">
              {track.blurb}
            </span>
            <span className="text-muted-foreground mt-auto pt-2 font-mono text-[0.7rem]">
              starts at {track.start}
            </span>
          </button>
        ))}
      </CardContent>
      <CardContent className="pt-0">
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(async () => onPick("beginner"))}
        >
          Not sure — start from the beginning
        </Button>
      </CardContent>
    </Card>
  );
}
