import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

import { db } from "@/db";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "@/db/schema";

/**
 * Auth.js v5. GitHub only for now - no password flows to build (spec section 3).
 * The build plan lists Google too. Adding it back is three edits: the provider
 * here, the union in components/auth-buttons.tsx, and a button on the landing
 * and map pages. The provider list is not read dynamically, so it is worth
 * knowing that the buttons are hardcoded rather than assuming otherwise.
 *
 * Database sessions rather than JWT, because the entry track and progress reads
 * want a real user row on every request anyway, and a stale JWT claim would be
 * one more thing that can silently lie.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  pages: {
    signIn: "/",
  },
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.entryTrack =
          (user as typeof user & { entryTrack: EntryTrack | null }).entryTrack ??
          null;
      }
      return session;
    },
  },
});

export type EntryTrack = "beginner" | "developer" | "practitioner";

/** Entry-track start nodes, per M4. Used by the picker on first login. */
export const ENTRY_TRACK_START_NODE: Record<EntryTrack, string> = {
  beginner: "0.1",
  developer: "1.1",
  practitioner: "3.1",
};
