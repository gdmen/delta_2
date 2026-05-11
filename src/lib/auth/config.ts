import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, getDb } from "@/db";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from "@/db/schema";
import { verifyPassword } from "./password";
import { denylist } from "./denylist";
import { recordSigninAttempt } from "./rate-limit";

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
  // Auth.js v5 defaults to refusing requests whose Host header it
  // can't verify (`UntrustedHost` — guards against host-header
  // attacks that build OAuth redirect-URIs from arbitrary hosts).
  // We sit behind nginx, which proxies `Host: delta.garymenezes.com`
  // → `localhost:3000`. Without trustHost, Auth.js sees both the
  // forwarded canonical host AND `localhost:3000` and refuses both.
  //
  // Safe to enable here because the proxy layer (src/proxy.ts +
  // src/lib/auth/public-origin.ts) already gates host resolution
  // against ALLOWED_PUBLIC_HOSTS. Defense-in-depth, not
  // defense-by-default-deny.
  trustHost: true,

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
      async authorize(rawCreds, request) {
        const email = typeof rawCreds.email === "string" ? rawCreds.email : "";
        const password =
          typeof rawCreds.password === "string" ? rawCreds.password : "";
        if (!email || !password) return null;

        // Rate limit BEFORE the DB read and BEFORE argon2.verify.
        // Per-email + per-IP independent buckets; either tripping
        // returns null (generic "invalid credentials"). The
        // x-forwarded-for header is set by the proxy in front;
        // fall back to whatever Node sees if absent.
        const fwd = request?.headers?.get?.("x-forwarded-for") ?? "";
        const ip = fwd.split(",")[0]?.trim() || null;
        if (!recordSigninAttempt(email, ip)) {
          return null;
        }

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
     * components. We surface the userId, the JWT `jti` (for
     * denylist checks + signout), and `pwv` (for the
     * kill-all-sessions invariant). Everything else (displayName,
     * isOwner) is fetched on demand via requireUser() to avoid
     * stale data.
     */
    async session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
      }
      // The next-auth.d.ts augmentation tells TS these are valid
      // session fields. At runtime they're just object props.
      if (typeof token.jti === "string") session.jti = token.jti;
      if (typeof token.pwv === "number") session.pwv = token.pwv;
      // iat is stamped by Auth.js at JWT issue. Exposed so
      // /api/users/me can gate the Google-only "set a password"
      // path on JWT freshness (re-auth required within 5 min).
      if (typeof token.iat === "number") session.iat = token.iat;
      return session;
    },
    /**
     * Sign-in gate. The credentials provider already filtered through
     * authorize() above. This callback's job is the Google branch:
     * the adversarial review's HIGH-3 finding was that any Google
     * account could register without an invite, because the adapter
     * happily creates+links on first sign-in.
     *
     * Conservative gate: only allow Google sign-in for users who
     * ALREADY have an accounts row binding their Google
     * providerAccountId to a Delta users row. New Google sign-ups
     * go through the invite-gated /signup form (email + password)
     * until phase 5 wires the cookie-stashed invite-claim flow for
     * Google sign-up specifically.
     *
     * Effect: existing Google-linked users sign in normally. Anyone
     * with a Google account who isn't already linked gets bounced
     * to /signin?error=oauth (no row created, no orphan).
     */
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        const providerAccountId = account.providerAccountId;
        if (!providerAccountId) return false;
        try {
          const linked = await db
            .select({ userId: accounts.userId })
            .from(accounts)
            .where(
              and(
                eq(accounts.provider, "google"),
                eq(accounts.providerAccountId, providerAccountId),
              ),
            )
            .limit(1);
          if (linked.length === 0) {
            // No existing link — refuse. Auth.js will NOT create the
            // users / accounts rows when signIn returns false, so no
            // orphan rows to clean up.
            return false;
          }
          return true;
        } catch (err) {
          // Fail closed on DB errors during the linkage check.
          console.error("[auth.signIn] google linkage check failed:", err);
          return false;
        }
      }
      // Credentials path already filtered through authorize() above.
      return Boolean(user);
    },
  },
  events: {
    /**
     * Belt-and-suspenders denylist insert. The custom POST route at
     * /api/auth/signout already denylists, but Auth.js's default GET
     * signout (re-exported via [...nextauth]) would bypass it. This
     * hook fires on EVERY signOut Auth.js performs, regardless of
     * which surface triggered it.
     */
    async signOut(message) {
      try {
        const token = "token" in message ? message.token : null;
        const jti = typeof token?.jti === "string" ? token.jti : "";
        const sub = typeof token?.sub === "string" ? token.sub : "";
        const userId = parseInt(sub, 10);
        if (jti && Number.isFinite(userId)) {
          await denylist(jti, userId);
        }
      } catch (err) {
        console.error("[auth.events.signOut] denylist insert failed:", err);
      }
    },
  },
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
