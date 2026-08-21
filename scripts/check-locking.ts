/**
 * Prove the lock is real.
 *
 * Two things are being checked, and the second matters more than the first:
 *
 *   1. A locked node's answer keys, checklist items and body prose never appear
 *      in the HTML the server sends. Not hidden with CSS - absent.
 *   2. The write actions refuse a locked node, so the lock cannot be walked
 *      around by calling them directly.
 *
 * Needs the dev server running on :3000.
 *
 *   pnpm check:locking
 */
import { config } from "dotenv";
import { eq } from "drizzle-orm";

config({ path: ".env.local", quiet: true });

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const USER_ID = "lock-check-user";
const TOKEN = "lock-check-session-token";

let failures = 0;

function expect(label: string, actual: unknown, wanted: unknown) {
  const ok = actual === wanted;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(58)} ${String(actual)}${ok ? "" : `  (wanted ${String(wanted)})`}`,
  );
}

/** Distinctive strings that must never reach a locked page. */
const SECRETS_2_3 = [
  ["answer key text", "The score did not go down"],
  ["checklist item", "cross-validated ROC AUC of 0.9966"],
  ["ablation table", "0.7495"],
  ["body prose", "highest-value node in the roadmap"],
  ["question prompt", "Why did the score go DOWN"],
] as const;

async function main() {
  const { db } = await import("../db/index");
  const { users, sessions } = await import("../db/schema");
  const { buildGraph } = await import("../lib/progress");

  await db.delete(users).where(eq(users.id, USER_ID));
  await db.insert(users).values({
    id: USER_ID,
    name: "Lock Check",
    email: "lock-check@example.invalid",
  });
  await db.insert(sessions).values({
    sessionToken: TOKEN,
    userId: USER_ID,
    expires: new Date(Date.now() + 3600_000),
  });

  try {
    const graph = await buildGraph(USER_ID, null);
    console.log(`\nfresh account: 2.3 is "${graph.byId.get("2.3")?.state}"`);

    const cookie = `authjs.session-token=${TOKEN}`;

    // --- 1. signed in, locked node ---------------------------------------
    const lockedHtml = await (
      await fetch(`${BASE}/node/validation-and-leakage`, { headers: { cookie } })
    ).text();

    console.log("\nlocked node 2.3, signed in as a fresh account");
    expect("page still renders", lockedHtml.length > 1000, true);
    expect('shows "Locked"', lockedHtml.includes("Locked"), true);
    expect("shows the goal", lockedHtml.includes("spot and fix data leakage"), true);
    expect("shows resources", lockedHtml.includes("scikit-learn User Guide"), true);
    for (const [label, secret] of SECRETS_2_3) {
      expect(`withholds ${label}`, lockedHtml.includes(secret), false);
    }

    // --- 2. signed OUT is not a bypass -------------------------------------
    const anonHtml = await (await fetch(`${BASE}/node/validation-and-leakage`)).text();
    console.log("\nlocked node 2.3, signed out (the obvious bypass)");
    for (const [label, secret] of SECRETS_2_3) {
      expect(`still withholds ${label}`, anonHtml.includes(secret), false);
    }

    // --- 3. an unlocked node is fully readable -----------------------------
    const openHtml = await (
      await fetch(`${BASE}/node/python-fundamentals`, { headers: { cookie } })
    ).text();
    console.log("\nunlocked node 0.1, same account");
    expect(
      "shows its answer key",
      openHtml.includes("Almost all of them"),
      true,
    );
    expect("shows its checklist", openHtml.includes("9592"), true);
    expect("no lock panel", openHtml.includes(">Locked<"), false);

    // --- 4. the write path refuses a locked node ---------------------------
    // The guard itself, which every write action runs before touching anything.
    // Tested here rather than through the actions module because that module
    // cannot be imported outside Next - which is exactly why the guard lives in
    // lib/progress.ts and takes its inputs as arguments.
    const { assertNodeUnlocked } = await import("../lib/progress");

    let refused = false;
    let message = "";
    try {
      await assertNodeUnlocked(USER_ID, null, "2.3");
    } catch (err) {
      refused = true;
      message = err instanceof Error ? err.message : String(err);
    }

    console.log("\nthe guard every write action runs first");
    expect("refuses a locked node", refused, true);
    if (refused) console.log(`        -> ${message}`);

    let allowed = true;
    try {
      await assertNodeUnlocked(USER_ID, null, "0.1");
    } catch {
      allowed = false;
    }
    expect("allows an unlocked node", allowed, true);

    // And the locked page ships no bound checklist action to call in the first
    // place, so there is nothing there for a curious reader to invoke.
    expect(
      "locked page renders no checkboxes",
      /role="checkbox"/.test(lockedHtml),
      false,
    );
  } finally {
    await db.delete(users).where(eq(users.id, USER_ID));
    console.log("\ntest user removed.");
  }

  console.log(
    failures === 0
      ? "\nLock holds on every path checked.\n"
      : `\n${failures} check(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
