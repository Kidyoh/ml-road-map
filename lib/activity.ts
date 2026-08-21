import "server-only";

/**
 * Activity aggregation for the profile page.
 *
 * Deliberately descriptive: it reports what happened and does not score it.
 * No streaks, no targets, no "you are behind". Section 8 names
 * self-verification inflation as a live risk, and a streak counter is a direct
 * incentive to tick a box you did not earn in order to keep a number alive.
 *
 * Everything here is derived from timestamps the app already writes. Nothing
 * new is recorded to make these charts possible.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  checklistState,
  nodeProgress,
  questionAttempts,
  reflections,
} from "@/db/schema";

/** One cell in the activity grid. */
export type ActivityDay = {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  /** Number of recorded actions that day. Zero for a quiet day. */
  events: number;
  /**
   * The day has not happened yet. The grid runs a year forward from the start
   * of the current month, so most of it is future - and a future cell must not
   * render like a day you skipped, or the chart claims you missed 300 days.
   */
  isFuture: boolean;
};

export type PassedPoint = {
  date: string;
  /** Nodes passed on or before this date. */
  cumulative: number;
};

export type ActivitySummary = {
  /** One entry per day for the window, including empty and future days. */
  days: ActivityDay[];
  /** Days with at least one action, across all history. */
  activeDays: number;
  /** Total recorded actions, across all history. */
  totalEvents: number;
  /** Busiest single day, for scaling the grid. */
  busiestDay: number;
  /**
   * Actions that fall before the window starts. The grid begins at the first of
   * the current month, so a learner who started earlier has history off the left
   * edge - reported rather than silently dropped.
   */
  eventsBeforeWindow: number;
  firstActiveDate: string | null;
  lastActiveDate: string | null;
  /** Today, YYYY-MM-DD. The charts need it and must not read the clock. */
  today: string;
  /** Cumulative nodes passed, one point per day a node was passed. */
  passedOverTime: PassedPoint[];
};

const DAY_MS = 86_400_000;

/** UTC, so a grid cell means the same thing wherever it is rendered. */
function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Every timestamp the learner generated, bucketed by day.
 *
 * Four queries rather than one union, because the tables have nothing in common
 * beyond a user id and this stays readable. For one user's history the row
 * counts are small.
 */
export async function buildActivity(
  userId: string,
  /**
   * Longest window to show. The actual window shrinks to fit the learner's
   * history, because a year of empty cells for somebody two months in tells
   * them nothing and reads as a reproach.
   */
  maxWindowDays = 365,
): Promise<ActivitySummary> {
  const [checks, attempts, written, progress] = await Promise.all([
    db
      .select({ at: checklistState.checkedAt })
      .from(checklistState)
      .where(
        and(eq(checklistState.userId, userId), eq(checklistState.checked, true)),
      ),
    db
      .select({ at: questionAttempts.createdAt })
      .from(questionAttempts)
      .where(eq(questionAttempts.userId, userId)),
    db
      .select({ at: reflections.createdAt })
      .from(reflections)
      .where(eq(reflections.userId, userId)),
    db
      .select({
        openedAt: nodeProgress.openedAt,
        lastOpenedAt: nodeProgress.lastOpenedAt,
        completedAt: nodeProgress.completedAt,
      })
      .from(nodeProgress)
      .where(eq(nodeProgress.userId, userId)),
  ]);

  const counts = new Map<string, number>();
  const bump = (value: Date | null) => {
    if (!value) return;
    const key = toDateKey(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  for (const row of checks) bump(row.at);
  for (const row of attempts) bump(row.at);
  for (const row of written) bump(row.at);
  for (const row of progress) {
    bump(row.openedAt);
    // Only count a re-open when it is a distinct visit; openNode already
    // enforces the 30-minute gap before writing lastOpenedAt.
    if (
      row.lastOpenedAt &&
      (!row.openedAt || toDateKey(row.lastOpenedAt) !== toDateKey(row.openedAt))
    ) {
      bump(row.lastOpenedAt);
    }
  }

  // --- the grid: the year ahead, from the first of the current month ------
  const todayKey = toDateKey(new Date());
  const today = new Date(`${todayKey}T00:00:00.000Z`);

  // Clean month boundaries at both ends, so the first and last labels are whole
  // months rather than a ragged offset. 365 or 366 days depending on the leap
  // year the span happens to cross.
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );
  const endExclusive = new Date(
    Date.UTC(today.getUTCFullYear() + 1, today.getUTCMonth(), 1),
  );
  const windowDays = Math.round(
    (endExclusive.getTime() - start.getTime()) / DAY_MS,
  );
  void maxWindowDays;

  const days: ActivityDay[] = [];
  for (let i = 0; i < windowDays; i++) {
    const date = addDays(start, i);
    const key = toDateKey(date);
    days.push({
      date: key,
      events: counts.get(key) ?? 0,
      isFuture: date.getTime() > today.getTime(),
    });
  }

  // Totals are over ALL history, not over the window - a learner who started
  // three months ago should not see their day count reset when the calendar
  // rolls the window forward.
  const startKey = toDateKey(start);
  let eventsBeforeWindow = 0;
  let activeDays = 0;
  let totalEvents = 0;
  for (const [key, n] of counts) {
    activeDays++;
    totalEvents += n;
    if (key < startKey) eventsBeforeWindow += n;
  }

  const allActiveDates = [...counts.keys()].sort();

  // --- cumulative passes --------------------------------------------------
  const passDates = progress
    .map((p) => p.completedAt)
    .filter((d): d is Date => d !== null)
    .map(toDateKey)
    .sort();

  const passedOverTime: PassedPoint[] = [];
  let running = 0;
  for (const date of passDates) {
    running++;
    const last = passedOverTime[passedOverTime.length - 1];
    if (last && last.date === date) last.cumulative = running;
    else passedOverTime.push({ date, cumulative: running });
  }

  return {
    days,
    activeDays,
    totalEvents,
    busiestDay: Math.max(0, ...counts.values()),
    eventsBeforeWindow,
    firstActiveDate: allActiveDates[0] ?? null,
    lastActiveDate: allActiveDates[allActiveDates.length - 1] ?? null,
    today: todayKey,
    passedOverTime,
  };
}
