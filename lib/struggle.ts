import "server-only";

/**
 * Struggle signal writer.
 *
 * Non-negotiable 5: `struggle_events` is written from day one, even with no code
 * runner. It is the seed corpus for the adaptive model that comes much later,
 * and a corpus you start collecting once you need it is a corpus you do not
 * have.
 *
 * M2 defines the vocabulary (lib/signals.ts) and this writer. The call sites
 * land in M3, once there is a signed-in user and persisted progress to hang them
 * off. Settling the shape now means the first real event and the millionth share
 * a schema.
 */
import { db } from "@/db";
import { struggleEvents } from "@/db/schema";

import type { StruggleSignal } from "./signals";

export * from "./signals";

/**
 * Fire-and-forget. A failed signal write must never break the learner's page -
 * these are telemetry, not state, and losing one is cheaper than a 500 in the
 * middle of a session.
 */
export async function emitStruggle({
  userId,
  nodeId,
  signal,
  value,
}: {
  userId: string;
  nodeId: string;
  signal: StruggleSignal;
  value?: number;
}): Promise<void> {
  try {
    await db.insert(struggleEvents).values({
      userId,
      nodeId,
      signal,
      value: value ?? null,
    });
  } catch (error) {
    console.error(`struggle_events write failed (${signal}, ${nodeId})`, error);
  }
}
