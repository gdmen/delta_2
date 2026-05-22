import { describe, it, expect } from "vitest";
import { sessionIdLooksTooGranular, autoMatchHeaders } from "./import-mapping";

describe("sessionIdLooksTooGranular", () => {
  it("flags a per-exercise id (TeamBuildr: many ids per day)", () => {
    // 398 distinct WorkoutIds across 114 dates ≈ 3.5/day.
    expect(sessionIdLooksTooGranular(398, 114)).toBe(true);
  });

  it("accepts a true per-session id (~one per day)", () => {
    expect(sessionIdLooksTooGranular(114, 114)).toBe(false);
  });

  it("tolerates the occasional two-a-day without nagging", () => {
    expect(sessionIdLooksTooGranular(120, 114)).toBe(false); // ~1.05x
  });

  it("flags clearly-too-many (1.75x)", () => {
    expect(sessionIdLooksTooGranular(200, 114)).toBe(true);
  });

  it("guards against zero/empty inputs", () => {
    expect(sessionIdLooksTooGranular(0, 114)).toBe(false);
    expect(sessionIdLooksTooGranular(398, 0)).toBe(false);
  });
});

describe("autoMatchHeaders (workout_sets) no longer auto-picks WorkoutId", () => {
  it("does NOT map a per-exercise WorkoutId column to eventSourceId", () => {
    const m = autoMatchHeaders("workout_sets", [
      "Completed Date",
      "Exercise Name",
      "Set Number",
      "Reps",
      "Result",
      "WorkoutId",
    ]);
    expect(m.eventSourceId).toBeNull();
    // Still matches the obvious date / exercise / set columns.
    expect(m.startedAt).toEqual({ column: "Completed Date" });
    expect(m.exerciseName).toEqual({ column: "Exercise Name" });
  });

  it("still maps an explicit SessionId column to eventSourceId", () => {
    const m = autoMatchHeaders("workout_sets", [
      "Date",
      "Exercise",
      "SessionId",
      "Reps",
      "Weight",
    ]);
    expect(m.eventSourceId).toEqual({ column: "SessionId" });
  });
});
