import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DecryptError,
  decrypt,
  encrypt,
  generateBearerToken,
  lookupHash,
  safeCompare,
} from "./secrets";

/**
 * Coverage for the AES-256-GCM secrets helper. The plan's eng-review
 * sidecar called out IV-reuse as a HIGH-severity crypto risk and
 * fail-closed-on-tag-mismatch as required behavior — both pinned here.
 */

const TEST_KEY = "0".repeat(64); // 64 hex chars = 32 bytes

beforeEach(() => {
  vi.stubEnv("OAUTH_ENCRYPTION_KEY", TEST_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("encrypt / decrypt round-trip", () => {
  it("S1: round-trips a short string", () => {
    const blob = encrypt("hello");
    expect(decrypt(blob)).toBe("hello");
  });

  it("S2: round-trips a JSON OAuth-token payload (longer string)", () => {
    const payload = JSON.stringify({
      access_token: "a".repeat(200),
      refresh_token: "b".repeat(200),
      expires_at: 1735689600,
      athlete_id: 12345,
    });
    expect(decrypt(encrypt(payload))).toBe(payload);
  });

  it("S3: round-trips Unicode without mangling", () => {
    const s = "ωειρδ ✨ 文字 🔐";
    expect(decrypt(encrypt(s))).toBe(s);
  });

  it("S4: round-trips empty string", () => {
    expect(decrypt(encrypt(""))).toBe("");
  });
});

describe("IV uniqueness — the most important crypto invariant", () => {
  it("S5: encrypting the same plaintext twice yields different ciphertext", () => {
    // GCM with a unique random IV per call MUST produce different
    // output for the same plaintext. If two encryptions of the same
    // string produced the same blob, the IV is being reused (or a
    // counter/derived nonce is leaking) — KEY+PLAINTEXT recovery
    // becomes possible. This test is the regression guard.
    const a = encrypt("same plaintext");
    const b = encrypt("same plaintext");
    expect(a).not.toBe(b);
    // And both still decrypt to the original.
    expect(decrypt(a)).toBe("same plaintext");
    expect(decrypt(b)).toBe("same plaintext");
  });

  it("S6: 100 successive encryptions of the same text produce 100 distinct blobs", () => {
    // Statistical sanity check on randomBytes (collision would be
    // astronomically improbable with a 96-bit IV; this catches a
    // counter-style bug where someone wires a deterministic IV).
    const s = "hello";
    const blobs = new Set<string>();
    for (let i = 0; i < 100; i++) blobs.add(encrypt(s));
    expect(blobs.size).toBe(100);
  });
});

describe("decrypt fails CLOSED on tampering / corruption", () => {
  it("S7: flipping one bit of the ciphertext throws DecryptError", () => {
    const blob = encrypt("payload");
    const buf = Buffer.from(blob, "base64");
    // Flip a bit in the middle (after the IV, before the tag).
    const target = 12 + Math.floor((buf.length - 12 - 16) / 2);
    buf[target] ^= 0x01;
    const tampered = buf.toString("base64");
    expect(() => decrypt(tampered)).toThrow(DecryptError);
  });

  it("S8: flipping one bit of the auth tag throws", () => {
    const blob = encrypt("payload");
    const buf = Buffer.from(blob, "base64");
    buf[buf.length - 1] ^= 0x01;
    expect(() => decrypt(buf.toString("base64"))).toThrow(DecryptError);
  });

  it("S9: flipping one bit of the IV throws", () => {
    const blob = encrypt("payload");
    const buf = Buffer.from(blob, "base64");
    buf[0] ^= 0x01;
    expect(() => decrypt(buf.toString("base64"))).toThrow(DecryptError);
  });

  it("S10: too-short input throws (no decrypt attempt)", () => {
    expect(() => decrypt("abc")).toThrow(DecryptError);
  });

  it("S11: random garbage throws", () => {
    expect(() => decrypt(Buffer.alloc(48).toString("base64"))).toThrow(DecryptError);
  });
});

describe("key separation via HKDF info label", () => {
  it("S12: encrypting with one info label can't be decrypted with another", () => {
    const blob = encrypt("payload", "label-A");
    expect(() => decrypt(blob, "label-B")).toThrow(DecryptError);
    expect(decrypt(blob, "label-A")).toBe("payload");
  });
});

describe("env-var validation", () => {
  it("S13: missing OAUTH_ENCRYPTION_KEY throws on encrypt", () => {
    vi.stubEnv("OAUTH_ENCRYPTION_KEY", "");
    expect(() => encrypt("anything")).toThrow(/OAUTH_ENCRYPTION_KEY/);
  });

  it("S14: too-short OAUTH_ENCRYPTION_KEY throws", () => {
    vi.stubEnv("OAUTH_ENCRYPTION_KEY", "tooshort");
    expect(() => encrypt("anything")).toThrow(/too short/);
  });
});

describe("lookupHash + safeCompare", () => {
  it("S15: lookupHash is deterministic and matches sha256 hex", () => {
    expect(lookupHash("token")).toBe(lookupHash("token"));
    // Known sha256("token") = "3c469e9d6c5875d37a43f353d4f88e61fcf812c66eee3457465a40b0da4153e0"
    expect(lookupHash("token")).toBe(
      "3c469e9d6c5875d37a43f353d4f88e61fcf812c66eee3457465a40b0da4153e0",
    );
  });

  it("S16: lookupHash differs for different inputs", () => {
    expect(lookupHash("a")).not.toBe(lookupHash("b"));
  });

  it("S17: safeCompare returns true for equal strings", () => {
    expect(safeCompare("hello", "hello")).toBe(true);
  });

  it("S18: safeCompare returns false for different strings", () => {
    expect(safeCompare("hello", "world")).toBe(false);
  });

  it("S19: safeCompare returns false for length mismatch (no throw)", () => {
    expect(safeCompare("short", "longer string")).toBe(false);
  });
});

describe("generateBearerToken", () => {
  it("S20: emits 43-char base64url tokens (32 bytes)", () => {
    const t = generateBearerToken();
    // 32 bytes base64url-encoded with no padding = 43 chars.
    expect(t).toHaveLength(43);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("S21: emits unique tokens across calls", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) tokens.add(generateBearerToken());
    expect(tokens.size).toBe(100);
  });
});
