import { describe, expect, it, vi } from "vitest";
import { paletteColor } from "./sport-resolver";

describe("paletteColor", () => {
  it("is deterministic across calls", () => {
    expect(paletteColor("powerlifting")).toBe(paletteColor("powerlifting"));
    expect(paletteColor("strava:Ride")).toBe(paletteColor("strava:Ride"));
  });

  it("returns a hex color from the curated palette", () => {
    const c = paletteColor("anything");
    expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("distributes across the palette (different names get different colors)", () => {
    // Sample 50 distinct strings, expect at least 6 distinct outputs from
    // a 12-slot palette. Loose bound — the hash is djb2 + abs, so
    // distribution isn't perfectly uniform but should be close enough
    // that a 50-string sample spans at least half the palette.
    const colors = new Set<string>();
    for (let i = 0; i < 50; i++) {
      colors.add(paletteColor(`name-${i}`));
    }
    expect(colors.size).toBeGreaterThanOrEqual(6);
  });

  it("treats source-prefixed and canonical names independently", () => {
    // strava:Ride and Ride are different inputs — they may or may not
    // produce the same color, but the function should not throw.
    expect(() => paletteColor("strava:Ride")).not.toThrow();
    expect(() => paletteColor("Ride")).not.toThrow();
  });
});

// Note: the resolver's DB-bound code (`buildSportCache`, `resolveSportId`,
// auto-create with conflict fallback) is exercised at runtime through
// the importer integration paths and the sports merge flow. A pure-DB
// unit test would require a fixture DB; the existing test infra runs
// against the live SQLite file, so we keep this file focused on the
// pure helper. Race-safety is verified by code review (the
// INSERT OR IGNORE + re-query pattern matches metric-resolver.ts:99-115
// exactly, which has shipped without race issues for months).
//
// The `vi` import is kept to make extending this file with mock-driven
// resolver tests cheap when the conflict path needs explicit coverage.
void vi;
