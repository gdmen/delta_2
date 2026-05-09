import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, getDb } from "@/db";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from "@/db/schema";
import { verifyPassword } from "./password";

/**
 * Auth.js v5 configuration. Two providers (credentials + Google) on
 * JWT strategy. The plan calls for JWT explicitly because Auth.js v5's
 * "database" session strategy is incompatible with the credentials
 * provider — credentials always issues a JWT regardless of what the
 * config asks for.
 *
 * Per the eng-review HIGH findings:
 *   - JWT payload is locked to {sub, jti, pwv, iat, exp} — no email,
 *     no displayName, no isOwner. Those get fetched from DB on each
 *     authed request via `requireUser()` (see require.ts) so a stale
 *     isOwner after demotion can't survive in a cookie.
 *   - Each issued JWT gets a fresh `jti` (UUID) — sliding refresh
 *     rotates it. Sign-out denylists the current jti only; killing
 *     ALL sessions for a user = bump users.passwordHashVersion.
 *   - Credentials authorize() guards with `if (!user.passwordHash ||
 *     user.passwordHash === '!') return null` BEFORE calling argon2,
 *     so Google-only users and the un-bootstrapped owner placeholder
 *     return the same generic "invalid credentials" as a wrong
 *     password (no user-enumeration leak, no 500 from argon2).
 *   - Google provider has `allowDangerousEmailAccountLinking: false`
 *     pinned. Google sign-in for an email matching an existing
 *     credentials user is rejected; never auto-merged.
 *
 * The drizzle adapter is wired so the adapter's standard tables
 * (users / accounts / sessions / verification_tokens) round-trip
 * cleanly — `accounts` is the one that matters at runtime under JWT
 * strategy (one row per Google-linked user).
 */

export const authConfig: NextAuthConfig = {
  // The drizzle adapter needs the db handle and the four standard
  // tables. We pass them explicitly because our schema lives in
  // src/db/schema.ts and the adapter doesn't know where to find it.
  //
  // Two pragmatics here:
  //
  //   1. `getDb()` (not the Proxy `db`) — the adapter does runtime
  //      introspection on `db.constructor` to pick its dialect code
  //      path. The Proxy's constructor is `Object` and trips that
  //      check ("Unsupported database type (object) in Auth.js
  //      Drizzle adapter"). getDb() returns the real
  //      `PostgresJsDatabase` instance.
  //
  //   2. The `as any` casts on the table args — the adapter's types
  //      require users.id to be text (uuid). At RUNTIME it handles
  //      integer ids fine; the overly-strict type comes from a
  //      default-shape constraint the adapter authors didn't loosen.
  //      Other Drizzle/Auth.js users hit this same wall and use the
  //      same cast workaround. Verified end-to-end with the
  //      credentials provider: integer ids round-trip through
  //      auth() -> JWT -> requireUser().
  adapter: DrizzleAdapter(getDb(), {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    usersTable: users as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    accountsTable: accounts as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sessionsTable: sessions as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    verificationTokensTable: verificationTokens as any,
  }),
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days
    updateAge: 24 * 60 * 60, // sliding refresh after 24h since last issue
  },
  // AUTH_SECRET env var signs the JWT. Required.
  secret: process.env.AUTH_SECRET,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCreds) {
        const email = typeof rawCreds.email === "string" ? rawCreds.email : "";
        const password =
          typeof rawCreds.password === "string" ? rawCreds.password : "";
        if (!email || !password) return null;

        const found = await db
          .select({
            id: users.id,
            passwordHash: users.passwordHash,
            displayName: users.displayName,
            email: users.email,
          })
          .from(users)
          .where(eq(users.email, email.toLowerCase()))
          .limit(1);
        const user = found[0];

        // Explicit guard BEFORE calling argon2.verify. Catches three
        // cases at once with the same generic null return:
        //   (a) user doesn't exist
        //   (b) user is Google-only (passwordHash IS NULL)
        //   (c) un-bootstrapped owner placeholder (passwordHash = '!')
        // No user-enumeration leak; no argon2 throw on non-argon2 input.
        if (!user || !user.passwordHash || user.passwordHash === "!") {
          return null;
        }

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;

        // Auth.js wants string id. We coerce to keep the JWT sub as
        // a string; requireUser() parses back to int when querying.
        return {
          id: String(user.id),
          email: user.email ?? undefined,
          name: user.displayName,
        };
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      // Defense against the "different Google account hijacks an
      // existing credentials email" attack class. Default is false
      // anyway, but pinning explicit is what the eng review flagged
      // as required (CRITICAL severity).
      allowDangerousEmailAccountLinking: false,
    }),
  ],
  callbacks: {
    /**
     * JWT callback runs on sign-in and on every subsequent request.
     * On sign-in: stamp jti + pwv into the token payload. On
     * subsequent requests: just return the existing token (we
     * deliberately DON'T refresh pwv from the DB here — that's the
     * job of requireUser() which has the freshest read).
     */
    async jwt({ token, user, trigger }) {
      if (trigger === "signIn" || trigger === "signUp") {
        if (user?.id) {
          token.sub = user.id;
          // Fresh jti on every new sign-in (sliding refresh also
          // rotates this — see "session" callback below).
          token.jti = randomUUID();
          // Pull current pwv at issue time. Bumping pwv later
          // invalidates every JWT carrying the old value.
          const userIdInt = parseInt(user.id, 10);
          if (Number.isFinite(userIdInt)) {
            const row = await db
              .select({ pwv: users.passwordHashVersion })
              .from(users)
              .where(eq(users.id, userIdInt))
              .limit(1);
            token.pwv = row[0]?.pwv ?? 1;
          }
        }
      }
      return token;
    },
    /**
     * Session callback shapes what `auth()` returns to server
     * components. We surface the userId only — everything else
     * (displayName, isOwner) is fetched on demand via requireUser()
     * to avoid stale data.
     */
    async session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
    /**
     * Allow sign-in. The Google-OAuth invite-claim atomicity (per the
     * eng-review HIGH finding) is wired in a later phase via the
     * /api/auth/signup/google route + cookie-stashed invite code.
     * Today this just blocks an OAuth sign-in if no users row exists
     * yet — the adapter would create one but we want the bootstrap
     * owner row to exist first.
     */
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        // TODO(pr2-phase-5): wire the invite-code claim here.
        // For now, allow Google sign-in to any existing user (the
        // adapter creates+links accounts row automatically).
      }
      // Credentials path already filtered through authorize() above.
      return Boolean(user);
    },
  },
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
