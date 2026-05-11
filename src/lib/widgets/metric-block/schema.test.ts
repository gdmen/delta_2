import { describe, expect, it } from "vitest";
import { metricBlockSchema } from "./schema";

describe("metricBlockSchema", () => {
  it("defaults metric to empty string for fresh palette adds", () => {
    expect(metricBlockSchema.parse({}).metric).toBe("");
    expect(metricBlockSchema.parse({ metric: "" }).metric).toBe("");
  });

  it("accepts a minimal config", () => {
    const parsed = metricBlockSchema.parse({ metric: "bench_1rm" });
    expect(parsed.metric).toBe("bench_1rm");
    expect(parsed.windowDays).toBeUndefined();
    expect(parsed.headline).toBe("latest");
  });

  it("accepts a fully populated config", () => {
    const parsed = metricBlockSchema.parse({
      metric: "bench_1rm",
      title: "Bench Press 1RM",
      windowDays: [-89, 0],
      headline: "avg",
    });
    expect(parsed.title).toBe("Bench Press 1RM");
    expect(parsed.windowDays).toEqual([-89, 0]);
    expect(parsed.headline).toBe("avg");
  });

  it("strips legacy target / higherIsBetter / fallbackUnit keys from old configs", () => {
    // PR4-era seeds carried per-widget target / higherIsBetter / fallbackUnit;
    // all three moved to metric_types in 2026-05-04. Zod default-strips
    // unknown keys, which makes the migration painless: old configs parse,
    // dropped keys fall away, and metric_types becomes the sole truth.
    const parsed = metricBlockSchema.parse({
      metric: "sleep_hours",
      target: 8,
      higherIsBetter: true,
      fallbackUnit: "h",
    });
    expect("target" in parsed).toBe(false);
    expect("higherIsBetter" in parsed).toBe(false);
    expect("fallbackUnit" in parsed).toBe(false);
  });

  describe("windowDays range shape", () => {
    it("accepts [from, to] with from <= to", () => {
      expect(metricBlockSchema.parse({ metric: "x", windowDays: [-6, 0] }).windowDays).toEqual([-6, 0]);
      expect(metricBlockSchema.parse({ metric: "x", windowDays: [-7, -1] }).windowDays).toEqual([-7, -1]);
      expect(metricBlockSchema.parse({ metric: "x", windowDays: [0, 0] }).windowDays).toEqual([0, 0]); // today only
    });

    it("rejects from > to", () => {
      expect(() => metricBlockSchema.parse({ metric: "x", windowDays: [0, -1] })).toThrow();
      expect(() => metricBlockSchema.parse({ metric: "x", windowDays: [-3, -7] })).toThrow();
    });

    it("rejects non-integer offsets", () => {
      expect(() => metricBlockSchema.parse({ metric: "x", windowDays: [-1.5, 0] })).toThrow();
    });

    it("rejects scalar (legacy shape) — migration script must run first", () => {
      // Pre-2026-05-11 widgets stored `windowDays: N`. The migration
      // script (scripts/migrate-window-days-to-range.ts) rewrites them
      // before any code path tries to parse them through this schema.
      expect(() => metricBlockSchema.parse({ metric: "x", windowDays: 7 })).toThrow();
    });
  });
});
