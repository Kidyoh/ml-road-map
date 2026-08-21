import { config } from "dotenv";
import { asc, eq } from "drizzle-orm";
config({ path: ".env.local", quiet: true });
const ID = "grid-demo"; const TOKEN = "grid-demo-token";
(async () => {
  const { db } = await import("./db/index");
  const { users, sessions, nodeChecklist, nodeQuestions, checklistState, questionAttempts, reflections, nodeProgress } = await import("./db/schema");
  if (process.argv[2] === "--cleanup") { await db.delete(users).where(eq(users.id, ID)); console.log("removed"); process.exit(0); }
  await db.delete(users).where(eq(users.id, ID));
  await db.insert(users).values({ id: ID, name: "Grid Demo", email: "grid@example.invalid", entryTrack: "beginner" });
  await db.insert(sessions).values({ sessionToken: TOKEN, userId: ID, expires: new Date(Date.now() + 86400000) });
  const day = 86400000;
  // Activity across this month AND the two months before, to exercise the
  // "before the window" note as well as the in-window cells.
  const walk = ["0.1", "0.2", "0.4"];
  let offset = 70;
  for (const nodeId of walk) {
    const items = await db.select().from(nodeChecklist).where(eq(nodeChecklist.nodeId, nodeId)).orderBy(asc(nodeChecklist.orderIndex));
    const qs = await db.select().from(nodeQuestions).where(eq(nodeQuestions.nodeId, nodeId));
    const opened = new Date(Date.now() - offset * day);
    await db.insert(nodeProgress).values({ userId: ID, nodeId, state: "passed", openedAt: opened, lastOpenedAt: opened, completedAt: new Date(Date.now() - (offset - 2) * day), attemptCount: 1 });
    for (const [i, item] of items.entries()) await db.insert(checklistState).values({ userId: ID, checklistItemId: item.id, checked: true, checkedAt: new Date(Date.now() - (offset - (i % 3)) * day) });
    for (const q of qs) await db.insert(questionAttempts).values({ userId: ID, questionId: q.id, response: "x", selfRating: "got_it", revealedAt: new Date(Date.now() - (offset - 2) * day), createdAt: new Date(Date.now() - (offset - 2) * day) });
    await db.insert(reflections).values({ userId: ID, nodeId, body: "A reflection long enough to clear the thin threshold and be worth reading later on.", createdAt: new Date(Date.now() - (offset - 2) * day) });
    offset -= 30;
  }
  // A few ticks in the last few days so the current month has cells.
  const recent = await db.select().from(nodeChecklist).where(eq(nodeChecklist.nodeId, "0.3")).orderBy(asc(nodeChecklist.orderIndex));
  await db.insert(nodeProgress).values({ userId: ID, nodeId: "0.3", state: "in_progress", openedAt: new Date(Date.now() - 5 * day), lastOpenedAt: new Date(Date.now() - 5 * day), attemptCount: 1 });
  for (const [i, item] of recent.slice(0, 5).entries()) await db.insert(checklistState).values({ userId: ID, checklistItemId: item.id, checked: true, checkedAt: new Date(Date.now() - i * day) });
  console.log(TOKEN);
  process.exit(0);
})();
