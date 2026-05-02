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

  it("rejects empty metrics array", () => {
    expect(() => metricStripSchema.parse({ metrics: [] })).toThrow();
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

  it("requires non-empty label and metric", () => {
    expect(() =>
      metricStripSchema.parse({
        metrics: [{ label: "", metric: "m", mode: "latest", format: "raw" }],
      }),
    ).toThrow();
    expect(() =>
      metricStripSchema.parse({
        metrics: [{ label: "x", metric: "", mode: "latest", format: "raw" }],
      }),
    ).toThrow();
  });
});
