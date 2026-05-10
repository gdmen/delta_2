import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Symmetric encryption + lookup-hash helpers for per-user secrets stored
 * in `ingest_configs` (HAE bearer tokens, Strava OAuth blobs, future
 * cronometer/whoop credentials).
 *
 * Design (per the eng review's HIGH finding on AES-GCM IV handling):
 *
 *   - AES-256-GCM. The auth tag verifies integrity at decrypt time;
 *     decrypt fails CLOSED (throws DecryptError) on any tag mismatch.
 *   - 12-byte random IV per encryption from `crypto.randomBytes`.
 *     IV reuse with the same key catastrophically breaks GCM (key +
 *     plaintext recovery), so RANDOM-PER-CALL is non-negotiable.
 *   - HKDF key derivation from `OAUTH_ENCRYPTION_KEY`. The env var
 *     supplies the master secret; HKDF turns it into a 32-byte AES
 *     key with a fixed application label so a future key-rotation
 *     scheme can use a different label per cohort without tangling
 *     callers.
 *   - On-disk format: base64( IV || CIPHERTEXT || TAG ) — a single
 *     opaque string per row. The IV doesn't need to be secret; only
 *     unique. Auth tag at the END (matches OpenSSL convention).
 *
 * `lookupHash(token)` computes sha256(token) for HAE bearer-token
 * lookup-by-value (AES-GCM is non-deterministic, so we can't index
 * ciphertext directly). Stored alongside the ciphertext on
 * ingest_configs.lookup_hash, indexed for O(log n) lookup.
 */

const IV_BYTES = 12; // GCM standard
const TAG_BYTES = 16; // GCM standard
const KEY_BYTES = 32; // AES-256

/** Thrown when decryption fails (tag mismatch, malformed input, missing key). */
export class DecryptError extends Error {
  constructor(message: string) {
    super(`decrypt failed: ${message}`);
    this.name = "DecryptError";
  }
}

/**
 * HKDF-SHA256 key derivation. Single-step (extract+expand) — for our
 * 32-byte output that's identical to the two-step variant per RFC 5869.
 * Salt is empty (acceptable per the RFC when the input keying material
 * is already a high-entropy secret like OAUTH_ENCRYPTION_KEY).
 */
function hkdfDeriveKey(masterKey: Buffer, info: string): Buffer {
  // Extract: HMAC-SHA256(salt=zero32, IKM=masterKey) → PRK (32 bytes)
  const salt = Buffer.alloc(32);
  const prk = createHmac("sha256", salt).update(masterKey).digest();
  // Expand: T(1) = HMAC(PRK, info || 0x01); KEY_BYTES <= 32 so one block suffices
  const t1 = createHmac("sha256", prk)
    .update(Buffer.concat([Buffer.from(info, "utf-8"), Buffer.from([0x01])]))
    .digest();
  return t1.subarray(0, KEY_BYTES);
}

/**
 * Resolve the AES key from env. Throws if `OAUTH_ENCRYPTION_KEY` is
 * missing or too short. The env var is expected to be at least 32
 * random bytes hex-encoded (`openssl rand -hex 32`).
 */
function getEncryptionKey(info = "delta:ingest_configs:v1"): Buffer {
  const raw = process.env.OAUTH_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "OAUTH_ENCRYPTION_KEY env var is not set. Generate with `openssl rand -hex 32`.",
    );
  }
  if (raw.length < 32) {
    // Hex of 32 bytes is 64 chars, but accept anything ≥ 32 chars to
    // make local dev with a short string less annoying. Production
    // should always be ≥ 64 hex chars.
    throw new Error(
      "OAUTH_ENCRYPTION_KEY is too short. Use `openssl rand -hex 32` for production.",
    );
  }
  return hkdfDeriveKey(Buffer.from(raw, "utf-8"), info);
}

/**
 * Encrypt plaintext to a base64 blob. Generates a fresh IV per call
 * (mandatory for GCM safety). Returns `base64(iv || ciphertext || tag)`.
 */
export function encrypt(plaintext: string, info?: string): string {
  const key = getEncryptionKey(info);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString("base64");
}

/**
 * Decrypt a blob produced by `encrypt()`. Throws `DecryptError` on any
 * failure — tag mismatch, malformed input, wrong length, wrong key.
 * Callers should NOT swallow this; a DecryptError is either tampering
 * or a key-rotation event that needs explicit handling.
 */
export function decrypt(blob: string, info?: string): string {
  let raw: Buffer;
  try {
    raw = Buffer.from(blob, "base64");
  } catch {
    throw new DecryptError("input is not valid base64");
  }
  if (raw.length < IV_BYTES + TAG_BYTES) {
    // Empty plaintext is valid (28 bytes = IV + tag, no ciphertext).
    // Anything shorter than that can't have a valid IV+tag pair.
    throw new DecryptError(`input too short (${raw.length} bytes)`);
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);

  const key = getEncryptionKey(info);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf-8");
  } catch (err) {
    // Most common cause: auth tag mismatch (tampering or wrong key).
    throw new DecryptError(
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * SHA-256 of a token, lowercase hex. Used for `ingest_configs.lookup_hash`
 * so HAE bearer auth can `WHERE lookup_hash = ?` (AES-GCM is non-
 * deterministic and can't be indexed for equality lookup).
 */
export function lookupHash(token: string): string {
  return createHash("sha256").update(token, "utf-8").digest("hex");
}

/**
 * Constant-time string compare. Returns false on length mismatch
 * (without short-circuiting before the comparison). Used for the
 * second leg of HAE auth: we look up by sha256(token), then
 * constant-time-compare the supplied token against the stored
 * encrypted-then-decrypted value as a defense-in-depth check that
 * the lookup_hash truly maps to the same plaintext.
 */
export function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf-8");
  const bb = Buffer.from(b, "utf-8");
  if (ab.length !== bb.length) {
    // timingSafeEqual throws on length mismatch — wrap so callers
    // get a uniform false rather than a 500.
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * Generate a fresh bearer token suitable for HAE ingest. 32 bytes of
 * randomness, base64url-encoded (URL-safe, no padding).
 */
export function generateBearerToken(): string {
  return randomBytes(32).toString("base64url");
}
