import { describe, expect, it, vi } from "vitest";
import { randomColor } from "./sport-resolver";

describe("randomColor", () => {
  it("returns a 6-digit hex color", () => {
    for (let i = 0; i < 20; i++) {
      expect(randomColor()).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("varies across calls", () => {
    // 50 random samples should produce more than 5 distinct colors. The
    // hue space is 360 — 50 draws clustering on <5 buckets would mean
    // RNG is broken.
    const colors = new Set<string>();
    for (let i = 0; i < 50; i++) colors.add(randomColor());
    expect(colors.size).toBeGreaterThan(5);
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
