/**
 * The struggle-signal vocabulary, with no database import.
 *
 * Split from lib/struggle.ts so client components (the question fold, the
 * checklist) can use the enums without dragging the Postgres driver into the
 * browser bundle. Anything here must stay free of server-only imports.
 */

export const SELF_RATINGS = ["got_it", "partial", "no_idea"] as const;
export type SelfRating = (typeof SELF_RATINGS)[number];

/** Section 5: "Struggle signals available without a code runner". */
export const STRUGGLE_SIGNALS = [
  "time_to_first_check",
  "revealed_before_attempt",
  "node_abandoned",
  "thin_reflection",
  "reopened_after_pass",
] as const;

export type StruggleSignal = (typeof STRUGGLE_SIGNALS)[number];

/** What `value` means for each signal, so the column is never ambiguous later. */
export const SIGNAL_UNITS: Record<StruggleSignal, string> = {
  /** Seconds between node_progress.opened_at and the first checklist tick. */
  time_to_first_check: "seconds",
  /** Questions revealed with an empty response on this node. */
  revealed_before_attempt: "count",
  /** Days of inactivity on an opened, unpassed node. */
  node_abandoned: "days",
  /** Word count of the reflection. */
  thin_reflection: "words",
  /** Days between passing and reopening. */
  reopened_after_pass: "days",
};

/** A reflection shorter than this is recorded as `thin_reflection`. */
export const THIN_REFLECTION_WORDS = 20;

/** A node untouched for this long is recorded as `node_abandoned`. */
export const ABANDONED_AFTER_DAYS = 14;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}
