/**
 * Identity of the shared guest account behind the /join/<token> link.
 *
 * Kept free of imports so lib/progress can use it without pulling in Auth.js.
 * The user row is created with a fixed id, which lets the unlock check below be
 * a string comparison instead of a database lookup on every graph build.
 */
export const GUEST_USER_ID = "guest-mlroadmap";
/** Stored in users.email as a unique identifier only - never mailed. */
export const GUEST_USERNAME = "guest@mlroadmap";
export const GUEST_DISPLAY_NAME = "904 Advisory";

/**
 * The guest account is for reviewers (904 Advisory) who need to see every node,
 * so nothing is locked for it. Every other account keeps prerequisite gating.
 */
export function isGuestUser(userId: string | null | undefined): boolean {
  return userId === GUEST_USER_ID;
}
