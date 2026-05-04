import { describe, expect, it } from "vitest";
import { metricStripSchema } from "./schema";

describe("metricStripSchema", () => {
  it("accepts the seeded Today config", () => {
    const config = {
      metrics: [
        { label: "Sleep", metric: "sleep_hours", mode: "avg7", format: "hours" },
        { label: "Weight", metric: "bodyweight", mode: "latest", format: "raw" },
        { label: "Protein", metric: "protein_g", mode: "avg7", format: "int", unit: "g" },
        { label: "Sessions", metric: "sessions_this_week", mode: "raw", format: "int" },
        { label: "HRV", metric: "hrv_ms", mode: "latest", format: "int", unit: "ms", delta: "latest" },
      ],
    };
    expect(() => metricStripSchema.parse(config)).not.toThrow();
  });

  it("accepts an empty metrics array (fresh palette add, user fills cells later)", () => {
    expect(() => metricStripSchema.parse({ metrics: [] })).not.toThrow();
  });

  it("defaults metrics to [] when omitted entirely", () => {
    expect(metricStripSchema.parse({}).metrics).toEqual([]);
  });

  it("rejects more than 8 metrics", () => {
    const cells = Array.from({ length: 9 }, (_, i) => ({
      label: `m${i}`,
      metric: `metric_${i}`,
      mode: "latest",
      format: "raw",
    }));
    expect(() => metricStripSchema.parse({ metrics: cells })).toThrow();
  });

  it("rejects unknown mode", () => {
    expect(() =>
      metricStripSchema.parse({
        metrics: [{ label: "x", metric: "m", mode: "weekly", format: "raw" }],
      }),
    ).toThrow();
  });

  it("rejects unknown format", () => {
    expect(() =>
      metricStripSchema.parse({
        metrics: [{ label: "x", metric: "m", mode: "latest", format: "currency" }],
      }),
    ).toThrow();
  });

  it("accepts cells with empty label/metric (palette-added cell renders as 'no data')", () => {
    expect(() =>
      metricStripSchema.parse({
        metrics: [{ label: "", metric: "", mode: "latest", format: "raw" }],
      }),
    ).not.toThrow();
  });
});
