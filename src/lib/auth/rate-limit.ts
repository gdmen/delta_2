/**
 * Tiny in-process rate limiter for the credentials sign-in path.
 *
 * Threat: argon2id at production parameters takes ~150ms per attempt.
 * Without a limit, an attacker who learns a target email can run
 * ~6 attempts/sec against weak 8-char passwords — ~500k attempts/day,
 * enough to break weak passwords.
 *
 * Scope: single-instance EC2. In-process state is fine today; if Delta
 * ever runs multi-instance, move this behind Postgres or Redis.
 *
 * Counter resets on process restart — acceptable for the threat model
 * (a restart is a manual operation; doesn't help an attacker who isn't
 * the operator). The plan called this out specifically.
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const PER_EMAIL_MAX = 5;
const PER_IP_MAX = 30;
const SWEEP_THRESHOLD = 1000; // keep the map bounded

interface Bucket {
  count: number;
  resetAt: number;
}

const emailBuckets = new Map<string, Bucket>();
const ipBuckets = new Map<string, Bucket>();

function check(map: Map<string, Bucket>, key: string, max: number): boolean {
  const now = Date.now();
  const existing = map.get(key);
  if (!existing || existing.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + WINDOW_MS });
    sweep(map);
    return true;
  }
  if (existing.count >= max) {
    return false;
  }
  existing.count += 1;
  return true;
}

function sweep(map: Map<string, Bucket>): void {
  if (map.size < SWEEP_THRESHOLD) return;
  const now = Date.now();
  for (const [k, v] of map) {
    if (v.resetAt <= now) map.delete(k);
  }
}

/**
 * Returns true if the attempt is allowed, false if it should be
 * rejected. Always call on EVERY credentials authorize() entry —
 * tracking happens here, not at the caller.
 *
 * Email and IP are checked independently — per-email throttles a
 * targeted account attack; per-IP throttles a spray across emails.
 */
export function recordSigninAttempt(email: string, ip: string | null): boolean {
  const emailOk = check(emailBuckets, email.toLowerCase(), PER_EMAIL_MAX);
  const ipOk = ip ? check(ipBuckets, ip, PER_IP_MAX) : true;
  return emailOk && ipOk;
}

// Test-only hook so the cross-user-isolation harness can reset between
// cases. Not exported in any user-facing surface.
export function _resetRateLimitForTests(): void {
  emailBuckets.clear();
  ipBuckets.clear();
}
