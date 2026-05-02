import { describe, expect, it } from "vitest";
import { goalListSchema } from "./schema";

describe("goalListSchema", () => {
  it("accepts an empty config (sportFilter defaults to null)", () => {
    const parsed = goalListSchema.parse({});
    expect(parsed.sportFilter).toBeNull();
  });

  it("accepts an explicit sportFilter", () => {
    const parsed = goalListSchema.parse({ sportFilter: "powerlifting" });
    expect(parsed.sportFilter).toBe("powerlifting");
  });

  it("accepts null sportFilter", () => {
    const parsed = goalListSchema.parse({ sportFilter: null });
    expect(parsed.sportFilter).toBeNull();
  });

  it("rejects non-string sportFilter", () => {
    expect(() => goalListSchema.parse({ sportFilter: 42 })).toThrow();
  });
});
