/**
 * Prove the admin panel is closed.
 *
 * The panel reads every learner's private writing, so the only thing that
 * matters about it is who can open it. Three ways in are checked:
 *
 *   - signed out
 *   - signed in as an ordinary learner
 *   - signed in as an admin (must work, or the check proves nothing)
 *
 * And the per-learner page separately, because a route that is only linked from
 * a protected page is not itself protected.
 *
 * Needs the dev server running and ADMIN_EMAILS set.
 *
 *   pnpm check:admin
 */
import { config } from "dotenv";
import { eq } from "drizzle-orm";

config({ path: ".env.local", quiet: true });

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const LEARNER = "admin-check-learner";
const ADMIN = "admin-check-admin";
const LEARNER_TOKEN = "admin-check-learner-token";
const ADMIN_TOKEN = "admin-check-admin-token";

let failures = 0;

function expect(label: string, actual: unknown, wanted: unknown) {
  const ok = actual === wanted;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(56)} ${String(actual)}${ok ? "" : `  (wanted ${String(wanted)})`}`,
  );
}

async function main() {
  const { db } = await import("../db/index");
  const { users, sessions, reflections, nodeProgress } = await import("../db/schema");
  const { isAdminEmail } = await import("../lib/admin-emails");

  const adminList = (process.env.ADMIN_EMAILS ?? "").trim();
  if (!adminList) {
    console.error("\nADMIN_EMAILS is not set. Nothing to test.\n");
    process.exit(1);
  }
  const adminEmail = adminList.split(",")[0].trim();

  await db.delete(users).where(eq(users.id, LEARNER));
  await db.insert(users).values({
    id: LEARNER,
    name: "Ordinary Learner",
    email: "not-an-admin@example.invalid",
  });

  // The admin email may already belong to a real signed-up account, and email
  // is unique. Reuse that account and hand it a temporary session rather than
  // creating a duplicate - and make sure cleanup removes the session only,
  // never somebody's real user row.
  const [existingAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, adminEmail));

  const adminUserId = existingAdmin?.id ?? ADMIN;
  const createdAdminUser = !existingAdmin;

  if (createdAdminUser) {
    await db.insert(users).values({ id: ADMIN, name: "Admin", email: adminEmail });
  }
  console.log(
    createdAdminUser
      ? "\nadmin: created a throwaway account"
      : `\nadmin: reusing the existing account for ${adminEmail}`,
  );

  // A previous interrupted run may have left these behind.
  await db.delete(sessions).where(eq(sessions.sessionToken, LEARNER_TOKEN));
  await db.delete(sessions).where(eq(sessions.sessionToken, ADMIN_TOKEN));

  await db.insert(sessions).values([
    { sessionToken: LEARNER_TOKEN, userId: LEARNER, expires: new Date(Date.now() + 3600_000) },
    { sessionToken: ADMIN_TOKEN, userId: adminUserId, expires: new Date(Date.now() + 3600_000) },
  ]);

  // Something private for the panel to expose, so "admin can read it" is a real
  // assertion rather than an empty page returning 200.
  const SECRET = "PRIVATE-REFLECTION-CANARY-9f3a";
  await db.insert(nodeProgress).values({
    userId: LEARNER,
    nodeId: "0.1",
    state: "in_progress",
    openedAt: new Date(),
    lastOpenedAt: new Date(),
    attemptCount: 1,
  });
  await db.insert(reflections).values({
    userId: LEARNER,
    nodeId: "0.1",
    body: SECRET,
    isPublic: false,
  });

  try {
    console.log("\nisAdminEmail");
    expect("configured email is admin", isAdminEmail(adminEmail), true);
    expect("other email is not", isAdminEmail("not-an-admin@example.invalid"), false);
    expect("uppercase still matches", isAdminEmail(adminEmail.toUpperCase()), true);
    expect("empty is not", isAdminEmail(null), false);

    const get = async (path: string, token?: string) =>
      fetch(`${BASE}${path}`, {
        headers: token ? { cookie: `authjs.session-token=${token}` } : {},
        redirect: "manual",
      });

    console.log("\nGET /admin");
    const anon = await get("/admin");
    expect("signed out", anon.status, 404);

    const asLearner = await get("/admin", LEARNER_TOKEN);
    expect("as an ordinary learner", asLearner.status, 404);
    expect(
      "no private text leaked in the 404 body",
      (await asLearner.text()).includes(SECRET),
      false,
    );

    const asAdmin = await get("/admin", ADMIN_TOKEN);
    expect("as the admin", asAdmin.status, 200);
    const adminHtml = await asAdmin.text();
    expect("admin sees the learners table", adminHtml.includes("Ordinary Learner"), true);

    console.log("\nGET /admin/learner/[id] - separately protected");
    const detailAnon = await get(`/admin/learner/${LEARNER}`);
    expect("signed out", detailAnon.status, 404);

    const detailLearner = await get(`/admin/learner/${LEARNER}`, LEARNER_TOKEN);
    expect("as an ordinary learner", detailLearner.status, 404);
    expect(
      "own private reflection not served either",
      (await detailLearner.text()).includes(SECRET),
      false,
    );

    const detailAdmin = await get(`/admin/learner/${LEARNER}`, ADMIN_TOKEN);
    expect("as the admin", detailAdmin.status, 200);
    expect(
      "admin can read the private reflection",
      (await detailAdmin.text()).includes(SECRET),
      true,
    );
  } finally {
    // Only ever remove what this script created. The admin account is very
    // likely a real signed-up user, and deleting it would cascade away their
    // whole history to run a test.
    await db.delete(users).where(eq(users.id, LEARNER));
    await db.delete(sessions).where(eq(sessions.sessionToken, ADMIN_TOKEN));
    if (createdAdminUser) {
      await db.delete(users).where(eq(users.id, ADMIN));
    }
    console.log(
      createdAdminUser
        ? "\ntest accounts removed."
        : "\ntest learner removed; the real admin account was left alone.",
    );
  }

  console.log(
    failures === 0
      ? "\nAdmin panel is closed to everyone except ADMIN_EMAILS.\n"
      : `\n${failures} check(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
