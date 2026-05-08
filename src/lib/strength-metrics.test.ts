import { describe, expect, it } from "vitest";
import {
  BIG_THREE_DEFAULT_NAMES,
  classifyLift,
  oconnorE1RM,
  type LiftNames,
} from "./strength-metrics";

/**
 * `classifyLift` is the kernel of the big-3 widget: rows whose
 * exercise_metric_type name matches one of the three configured slots
 * count toward that lift's stats; everything else gets dropped. The
 * old substring-based classifier was replaced with strict exact-match
 * (PR commit 5bcb364) — these tests pin down the new contract.
 */
describe("classifyLift — default names", () => {
  it("returns the slot for an exact case-insensitive match", () => {
    expect(classifyLift("Barbell Back Squat")).toBe("squat");
    expect(classifyLift("barbell back squat")).toBe("squat");
    expect(classifyLift("BARBELL BACK SQUAT")).toBe("squat");
    expect(classifyLift("Flat Barbell Bench Press")).toBe("bench");
    expect(classifyLift("Barbell Deadlift")).toBe("deadlift");
  });

  it("trims whitespace before comparing", () => {
    expect(classifyLift("  Barbell Back Squat  ")).toBe("squat");
    expect(classifyLift("\tFlat Barbell Bench Press\n")).toBe("bench");
  });

  it("returns null for empty / whitespace input", () => {
    expect(classifyLift("")).toBeNull();
    expect(classifyLift("   ")).toBeNull();
  });

  it("returns null for variant names that previously matched substring rules", () => {
    // Pattern-based classifier used to catch these via substring includes;
    // strict matching now drops them so the user gets exactly the lift
    // they configured.
    expect(classifyLift("Squat")).toBeNull();
    expect(classifyLift("Back Squat")).toBeNull();
    expect(classifyLift("High Bar Squat")).toBeNull();
    expect(classifyLift("Bench Press")).toBeNull();
    expect(classifyLift("Barbell Bench Press")).toBeNull();
    expect(classifyLift("Conventional Deadlift")).toBeNull();
    expect(classifyLift("Deadlift")).toBeNull();
  });

  it("returns null for variants that should never count (no excludes list to maintain)", () => {
    expect(classifyLift("Barbell Front Squat")).toBeNull();
    expect(classifyLift("Bulgarian Split Squat")).toBeNull();
    expect(classifyLift("Goblet Squat")).toBeNull();
    expect(classifyLift("Incline Barbell Bench Press")).toBeNull();
    expect(classifyLift("Close-Grip Bench Press")).toBeNull();
    expect(classifyLift("Dumbbell Bench Press")).toBeNull();
    expect(classifyLift("Romanian Deadlift")).toBeNull();
    expect(classifyLift("Sumo Deadlift")).toBeNull();
    expect(classifyLift("Stiff-Leg Deadlift")).toBeNull();
  });

  it("returns null for source-prefixed orphan rows that haven't been merged", () => {
    // `fitnotes_workouts:Barbell Back Squat` is what the importer creates
    // before the user merges it into the canonical `Barbell Back Squat`.
    // Until merged it shouldn't count toward squat.
    expect(classifyLift("fitnotes_workouts:Barbell Back Squat")).toBeNull();
    expect(classifyLift("teambuildr:Barbell Deadlift")).toBeNull();
  });
});

describe("classifyLift — custom names", () => {
  const sumoNames: LiftNames = {
    squat: "Low Bar Squat",
    bench: "Tempo Bench Press",
    deadlift: "Sumo Deadlift",
  };

  it("uses caller-supplied names instead of defaults", () => {
    expect(classifyLift("Low Bar Squat", sumoNames)).toBe("squat");
    expect(classifyLift("Tempo Bench Press", sumoNames)).toBe("bench");
    expect(classifyLift("Sumo Deadlift", sumoNames)).toBe("deadlift");
  });

  it("default-named exercises do NOT match when custom names are supplied", () => {
    expect(classifyLift("Barbell Back Squat", sumoNames)).toBeNull();
    expect(classifyLift("Flat Barbell Bench Press", sumoNames)).toBeNull();
    expect(classifyLift("Barbell Deadlift", sumoNames)).toBeNull();
  });

  it("matches a source-prefixed name when the user explicitly configured it", () => {
    // If the user wires the widget to a not-yet-merged orphan, that's
    // what they get — strict equality means no surprises.
    const prefixed: LiftNames = {
      squat: "teambuildr:1/2 + 1 Back Squat",
      bench: "teambuildr:Pause Barbell Bench Press",
      deadlift: "teambuildr:Pause Deadlift",
    };
    expect(classifyLift("teambuildr:1/2 + 1 Back Squat", prefixed)).toBe("squat");
    expect(classifyLift("teambuildr:Pause Deadlift", prefixed)).toBe("deadlift");
    expect(classifyLift("Barbell Deadlift", prefixed)).toBeNull();
  });

  it("compares case-insensitively even when the configured name has odd casing", () => {
    const oddCase: LiftNames = {
      squat: "BACK SQUAT",
      bench: "bench press",
      deadlift: "DeAdLiFt",
    };
    expect(classifyLift("back squat", oddCase)).toBe("squat");
    expect(classifyLift("BENCH PRESS", oddCase)).toBe("bench");
    expect(classifyLift("deadlift", oddCase)).toBe("deadlift");
  });
});

describe("BIG_THREE_DEFAULT_NAMES", () => {
  it("matches the historical canonical exercise names", () => {
    // These are what the Big 3 widget defaults to when the user hasn't
    // configured the slots. Locking the values in keeps a future
    // refactor from quietly changing what every blank widget points at.
    expect(BIG_THREE_DEFAULT_NAMES).toEqual({
      squat: "Barbell Back Squat",
      bench: "Flat Barbell Bench Press",
      deadlift: "Barbell Deadlift",
    });
  });
});

describe("oconnorE1RM (smoke)", () => {
  it("returns weight directly for a single", () => {
    expect(oconnorE1RM(225, 1)).toBe(225);
  });

  it("scales by 0.025 per rep", () => {
    // 200 * (1 + 0.025*5) = 200 * 1.125 = 225
    expect(oconnorE1RM(200, 5)).toBeCloseTo(225, 3);
  });

  it("guards bad inputs with 0 (formula degrades past 10 reps)", () => {
    expect(oconnorE1RM(0, 5)).toBe(0);
    expect(oconnorE1RM(200, 0)).toBe(0);
    expect(oconnorE1RM(200, 11)).toBe(0);
    expect(oconnorE1RM(NaN, 5)).toBe(0);
  });
});
