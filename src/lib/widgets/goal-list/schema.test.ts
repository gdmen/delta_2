import { describe, expect, it } from "vitest";
import { goalListSchema } from "./schema";

describe("goalListSchema", () => {
  it("accepts an empty config (activityFilter defaults to null)", () => {
    const parsed = goalListSchema.parse({});
    expect(parsed.activityFilter).toBeNull();
  });

  it("accepts an explicit activityFilter", () => {
    const parsed = goalListSchema.parse({ activityFilter: "powerlifting" });
    expect(parsed.activityFilter).toBe("powerlifting");
  });

  it("accepts null activityFilter", () => {
    const parsed = goalListSchema.parse({ activityFilter: null });
    expect(parsed.activityFilter).toBeNull();
  });

  it("rejects non-string activityFilter", () => {
    expect(() => goalListSchema.parse({ activityFilter: 42 })).toThrow();
  });
});
