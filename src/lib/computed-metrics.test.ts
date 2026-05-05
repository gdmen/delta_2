import { describe, expect, it } from "vitest";
import { matchComputed, slugifyExercise } from "./computed-metrics";

describe("matchComputed", () => {
  it("returns null for primitive metric names", () => {
    expect(matchComputed("sleep_hours")).toBeNull();
    expect(matchComputed("bench_1rm")).toBeNull();
    expect(matchComputed("bodyweight")).toBeNull();
  });

  it("matches sport_sessions_count_<sport>", () => {
    expect(matchComputed("sport_sessions_count_powerlifting")).toEqual({
      family: "sport_sessions_count",
      subject: "powerlifting",
    });
    expect(matchComputed("sport_sessions_count_bjj")).toEqual({
      family: "sport_sessions_count",
      subject: "bjj",
    });
  });

  it("matches sport_minutes_<sport>", () => {
    expect(matchComputed("sport_minutes_running")).toEqual({
      family: "sport_minutes",
      subject: "running",
    });
  });

  it("matches <exercise>_max", () => {
    expect(matchComputed("flat_barbell_bench_press_max")).toEqual({
      family: "exercise_max",
      subject: "flat_barbell_bench_press",
    });
  });

  it("matches <exercise>_max_12mo (longer suffix wins over _max)", () => {
    // Critical ordering: if _max matched first we'd get subject = "bench_max_12" + family=exercise_max,
    // which would route to the wrong resolver and silently return wrong data.
    expect(matchComputed("flat_barbell_bench_press_max_12mo")).toEqual({
      family: "exercise_max_12mo",
      subject: "flat_barbell_bench_press",
    });
  });

  it("matches <exercise>_e1rm", () => {
    expect(matchComputed("squat_e1rm")).toEqual({
      family: "exercise_e1rm",
      subject: "squat",
    });
  });

  it("matches <exercise>_volume_per_day", () => {
    expect(matchComputed("deadlift_volume_per_day")).toEqual({
      family: "exercise_volume_per_day",
      subject: "deadlift",
    });
  });
});

describe("slugifyExercise", () => {
  it("lowercases and replaces spaces with underscores", () => {
    expect(slugifyExercise("Flat Barbell Bench Press")).toBe("flat_barbell_bench_press");
    expect(slugifyExercise("Squat")).toBe("squat");
  });

  it("replaces non-alphanumerics with underscores and collapses runs", () => {
    expect(slugifyExercise("Bench Press (3-sec pause)")).toBe("bench_press_3_sec_pause");
    expect(slugifyExercise("Body-weight Pullup!!!")).toBe("body_weight_pullup");
  });

  it("trims leading/trailing underscores", () => {
    expect(slugifyExercise("   Wide Grip Bench   ")).toBe("wide_grip_bench");
    expect(slugifyExercise("!!!Push Press!!!")).toBe("push_press");
  });

  it("handles unicode by stripping it", () => {
    // The regex character class is [^a-z0-9]+, so unicode letters become
    // separators. Acceptable for the seed-time slugifier; metric_types
    // names are ASCII in practice.
    expect(slugifyExercise("Ø-machine row")).toBe("machine_row");
  });

  it("returns empty string for all-non-alphanumeric input (caller must guard)", () => {
    expect(slugifyExercise("///")).toBe("");
    expect(slugifyExercise("")).toBe("");
  });
});
