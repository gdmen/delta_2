import "next-auth";
import "next-auth/jwt";

/**
 * Augment Auth.js's Session + JWT to surface the two fields the
 * kill-switch path depends on:
 *
 *   - jti: per-issue token id. Insert into session_denylist on
 *     sign-out, check against it on every authed request.
 *   - pwv: password_hash_version snapshot at token issue. Bumped by
 *     the password-change + admin-reset paths to invalidate every
 *     outstanding JWT for that user.
 */
declare module "next-auth" {
  interface Session {
    jti?: string;
    pwv?: number;
    iat?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    jti?: string;
    pwv?: number;
  }
}
