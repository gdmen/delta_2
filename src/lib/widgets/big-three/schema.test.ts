import { describe, expect, it } from "vitest";
import { bigThreeSchema } from "./schema";
import { dataKey } from "./keys";
import { BIG_THREE_DEFAULT_NAMES } from "@/lib/strength-metrics";

describe("bigThreeSchema", () => {
  it("fills in defaults for an empty config (legacy DB rows)", () => {
    // Existing DB rows from the empty-schema era store `config: {}`.
    // The defaults must materialize on read so the data dep + classifier
    // still know which exercises to count.
    const parsed = bigThreeSchema.parse({});
    expect(parsed).toEqual(BIG_THREE_DEFAULT_NAMES);
  });

  it("preserves user-supplied names verbatim", () => {
    const custom = {
      squat: "Low Bar Squat",
      bench: "Pause Bench Press",
      deadlift: "Sumo Deadlift",
    };
    expect(bigThreeSchema.parse(custom)).toEqual(custom);
  });

  it("falls back to defaults per-field when only some are supplied", () => {
    const partial = bigThreeSchema.parse({ squat: "Low Bar Squat" });
    expect(partial).toEqual({
      squat: "Low Bar Squat",
      bench: BIG_THREE_DEFAULT_NAMES.bench,
      deadlift: BIG_THREE_DEFAULT_NAMES.deadlift,
    });
  });

  it("strips unknown keys (forward-compat with legacy `target` etc residue)", () => {
    const withResidue = bigThreeSchema.parse({
      squat: "Barbell Back Squat",
      bench: "Flat Barbell Bench Press",
      deadlift: "Barbell Deadlift",
      legacyKey: "ignore me",
    } as unknown);
    expect(parsed_has_no_legacy_key(withResidue)).toBe(true);
  });
});

function parsed_has_no_legacy_key(obj: unknown): boolean {
  return (
    typeof obj === "object" &&
    obj !== null &&
    !("legacyKey" in obj)
  );
}

describe("dataKey", () => {
  it("returns the same key for the same config (dedupes shared widgets)", () => {
    const cfg = {
      squat: "Barbell Back Squat",
      bench: "Flat Barbell Bench Press",
      deadlift: "Barbell Deadlift",
    };
    expect(dataKey(cfg)).toBe(dataKey(cfg));
  });

  it("returns different keys when any slot differs", () => {
    const a = {
      squat: "Barbell Back Squat",
      bench: "Flat Barbell Bench Press",
      deadlift: "Barbell Deadlift",
    };
    const bSquat = { ...a, squat: "Low Bar Squat" };
    const bBench = { ...a, bench: "Pause Bench Press" };
    const bDeadlift = { ...a, deadlift: "Sumo Deadlift" };
    expect(dataKey(a)).not.toBe(dataKey(bSquat));
    expect(dataKey(a)).not.toBe(dataKey(bBench));
    expect(dataKey(a)).not.toBe(dataKey(bDeadlift));
  });

  it("namespaces under big_three so it can't collide with other widget keys", () => {
    const cfg = {
      squat: "x",
      bench: "y",
      deadlift: "z",
    };
    expect(dataKey(cfg).startsWith("big_three:")).toBe(true);
  });
});
