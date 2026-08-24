/**
 * Who is an admin, with no framework imports.
 *
 * Split from lib/admin.ts so it can be tested without booting Next - that file
 * pulls in Auth.js, which pulls in Next's router context and will not load in a
 * plain Node process. Same reasoning as lib/signals.ts against lib/struggle.ts.
 *
 * Admins are listed in ADMIN_EMAILS rather than flagged in a database column.
 * There is then no code path in the application that can grant admin, so no bug
 * can escalate a learner into one, and the list lives in deployment config
 * where it is visible rather than in a row somebody has to go and look up.
 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}
