import { timingSafeEqual } from "node:crypto";

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import { encode as encodeJwt } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";

import { db } from "@/db";
import {
  GUEST_DISPLAY_NAME,
  GUEST_USER_ID,
  GUEST_USERNAME,
} from "@/lib/guest";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "@/db/schema";

/**
 * Guest link: one shared account (shown as "904 Advisory") for people who will
 * not connect GitHub. There is no password - whoever has the secret link
 * /join/<GUEST_LINK_TOKEN> can sign in. Unset the variable and the link stops
 * working; change it and every link shared so far stops working.
 *
 * Everyone who uses the link shares the same user row, and therefore the same
 * progress. Every node is unlocked for that account (see lib/guest.ts). The row keys on users.email = "guest@mlroadmap", which is only a
 * unique identifier - nothing is ever sent to it.
 */

/** True only for the configured token, compared in constant time. */
export function isValidGuestToken(token: string): boolean {
  const expected = process.env.GUEST_LINK_TOKEN;
  if (!expected) return false;
  return safeEqual(token, expected);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const adapter = DrizzleAdapter(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});

/**
 * Auth.js v5. GitHub, plus the optional guest link above. No password flows (spec section 3).
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
  adapter,
  session: { strategy: "database", maxAge: SESSION_MAX_AGE_SECONDS },
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      id: "guest",
      name: "Guest link",
      credentials: {
        token: { label: "Token", type: "text" },
      },
      async authorize(credentials) {
        if (!isValidGuestToken(String(credentials?.token ?? ""))) return null;
        const [existing] = await db
          .select()
          .from(users)
          .where(eq(users.id, GUEST_USER_ID))
          .limit(1);
        if (existing) return existing;

        const [created] = await db
          .insert(users)
          .values({
            id: GUEST_USER_ID,
            email: GUEST_USERNAME,
            name: GUEST_DISPLAY_NAME,
          })
          .returning();
        return created;
      },
    }),
  ],
  /**
   * Credentials sign-ins normally produce a JWT cookie, but this app reads
   * sessions from the database. So for a guest sign-in we write a real row to
   * `sessions` and put its token in the cookie instead - from then on a guest
   * session is indistinguishable from a GitHub one.
   */
  jwt: {
    async encode(params) {
      if (params.token?.guest && params.token.sub) {
        const sessionToken = crypto.randomUUID();
        await adapter.createSession!({
          sessionToken,
          userId: params.token.sub,
          expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
        });
        return sessionToken;
      }
      return encodeJwt(params);
    },
  },
  pages: {
    signIn: "/",
  },
  callbacks: {
    jwt({ token, account }) {
      if (account?.provider === "guest") token.guest = true;
      return token;
    },
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
