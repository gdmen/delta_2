import { describe, expect, it } from "vitest";
import { focusListSchema } from "./schema";

describe("focusListSchema", () => {
  it("defaults sourceFilter to manual and activityFilter to null", () => {
    const parsed = focusListSchema.parse({});
    expect(parsed.activityFilter).toBeNull();
    expect(parsed.sourceFilter).toBe("manual");
  });

  it("accepts the seeded Today config", () => {
    const parsed = focusListSchema.parse({ activityFilter: null, sourceFilter: "manual" });
    expect(parsed.sourceFilter).toBe("manual");
  });

  it("accepts source filters: manual, llm, all", () => {
    expect(focusListSchema.parse({ sourceFilter: "manual" }).sourceFilter).toBe("manual");
    expect(focusListSchema.parse({ sourceFilter: "llm" }).sourceFilter).toBe("llm");
    expect(focusListSchema.parse({ sourceFilter: "all" }).sourceFilter).toBe("all");
  });

  it("rejects unknown sourceFilter", () => {
    expect(() => focusListSchema.parse({ sourceFilter: "everything" })).toThrow();
  });
});
