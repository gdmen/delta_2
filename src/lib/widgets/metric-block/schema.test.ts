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
    expect(parsed.fallbackUnit).toBe("");
    expect(parsed.target).toBeUndefined();
    expect(parsed.windowDays).toBeUndefined();
  });

  it("accepts a fully populated config", () => {
    const parsed = metricBlockSchema.parse({
      metric: "bench_1rm",
      title: "Bench Press 1RM",
      fallbackUnit: "lb",
      target: 315,
      windowDays: 90,
    });
    expect(parsed.title).toBe("Bench Press 1RM");
    expect(parsed.target).toBe(315);
    expect(parsed.windowDays).toBe(90);
  });

  it("rejects negative or zero windowDays", () => {
    expect(() => metricBlockSchema.parse({ metric: "x", windowDays: 0 })).toThrow();
    expect(() => metricBlockSchema.parse({ metric: "x", windowDays: -7 })).toThrow();
  });

  it("rejects fractional windowDays", () => {
    expect(() => metricBlockSchema.parse({ metric: "x", windowDays: 1.5 })).toThrow();
  });
});
