import { timingSafeEqual } from "node:crypto";

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import { encode as encodeJwt } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";

import { db } from "@/db";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "@/db/schema";

/**
 * Guest pass: one shared account for people who will not (or cannot) connect
 * GitHub. The username is fixed to "guest@mlroadmap" (not a real email address);
 * the password comes from GUEST_PASSWORD. Without it there is no password
 * login at all.
 *
 * Everyone who uses the guest pass shares the same user row, and therefore the
 * same progress. That is the point - it is a way to look around, not a way to
 * own an account.
 */
export const GUEST_USERNAME = "guest@mlroadmap";

export function guestPassEnabled(): boolean {
  return Boolean(process.env.GUEST_PASSWORD);
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
 * Auth.js v5. GitHub, plus the optional guest pass above - no password flows to build (spec section 3).
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
      name: "Guest pass",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const guestPassword = process.env.GUEST_PASSWORD;
        if (!guestPassword) return null;

        const username = String(credentials?.username ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        // Evaluate both so a wrong username and a wrong password take equal time.
        const usernameOk = safeEqual(username, GUEST_USERNAME);
        const passwordOk = safeEqual(password, guestPassword);
        if (!usernameOk || !passwordOk) return null;

        // The guest row keys on the users.email column, which is just a
        // unique identifier here - nothing is ever sent to it.
        const email = GUEST_USERNAME;

        const [existing] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (existing) return existing;

        const [created] = await db
          .insert(users)
          .values({ email, name: "Guest" })
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
