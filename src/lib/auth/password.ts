import argon2 from "argon2";

/**
 * Password hashing + verification using argon2id with OWASP 2024
 * recommended parameters. Never store anything but the hash; never
 * log the plaintext.
 *
 * Tuning: memoryCost is in KiB. 19456 = 19 MiB, the OWASP minimum
 * for argon2id as of 2024. Bumping further is fine on a single-user-
 * per-request server (Delta) but hurts CI test runtimes — tests pass
 * `LOW_MEMORY_ARGON_FOR_TESTS=1` to drop to 1024 KiB.
 *
 * Verify is constant-time at the algorithm level. Callers should
 * still gate by user existence with the explicit-guard pattern (see
 * the credentials provider's authorize() in src/lib/auth/index.ts) —
 * argon2.verify on a non-argon2 string throws and that throw must be
 * caught and turned into the same generic "invalid credentials" the
 * wrong-password path returns, otherwise the timing/error-shape leaks
 * "this user has a password" vs "this user is Google-only".
 */

const PROD_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

const TEST_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 1024,
  timeCost: 1,
  parallelism: 1,
};

function options(): argon2.Options {
  // LOW_MEMORY_ARGON_FOR_TESTS is a dev/CI convenience to skip the
  // 19 MiB argon2 work in tests. If it leaks into prod (operator
  // sets it during a deploy debug session and forgets), passwords
  // get re-hashed at weak parameters on rotation. Refuse to honor
  // it under NODE_ENV=production. Production = the only place this
  // env-var matters; dev/test = legitimate.
  if (
    process.env.LOW_MEMORY_ARGON_FOR_TESTS &&
    process.env.NODE_ENV !== "production"
  ) {
    return TEST_OPTIONS;
  }
  return PROD_OPTIONS;
}

export async function hashPassword(plaintext: string): Promise<string> {
  if (plaintext.length < 8 || plaintext.length > 256) {
    // Caller-side validation should have caught this — defense in depth.
    throw new Error("password must be 8-256 characters");
  }
  return argon2.hash(plaintext, options());
}

/**
 * Verify a plaintext password against a stored argon2 hash. Returns
 * false on mismatch OR on any throw (malformed hash, wrong format,
 * empty hash). Callers don't need to wrap this in try/catch — the
 * Boolean return absorbs the failure modes.
 *
 * Critical: returns false (not throws) on malformed input so the
 * authorize() callback doesn't 500 when handed the un-bootstrapped
 * owner sentinel ('!') or a Google-only user's NULL hash. The
 * recommended pattern is to GUARD before calling: if the hash is
 * NULL or '!', return null directly without invoking verify().
 */
export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}
