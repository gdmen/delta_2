import { describe, expect, it } from "vitest";
import { SLUG_PATTERN, RESERVED_SLUGS, slugSchema, slugify } from "./slug";

describe("SLUG_PATTERN", () => {
  it.each([
    ["today", true],
    ["powerlifting", true],
    ["my-dashboard-1", true],
    ["a", true],
    ["1abc", true],
    ["", false],
    ["-leading-dash", false],
    ["UPPERCASE", false],
    ["with space", false],
    ["with_underscore", false],
    ["with.dot", false],
    ["with/slash", false],
    [".", false],
    ["..", false],
    ["a".repeat(65), false],
  ])("matches %s = %s", (slug, expected) => {
    expect(SLUG_PATTERN.test(slug)).toBe(expected);
  });
});

describe("slugSchema", () => {
  it("accepts valid slugs", () => {
    expect(() => slugSchema.parse("powerlifting")).not.toThrow();
  });

  it("rejects reserved slugs", () => {
    for (const reserved of RESERVED_SLUGS) {
      expect(() => slugSchema.parse(reserved)).toThrow();
    }
  });

  it("rejects malformed slugs with a clear message", () => {
    const result = slugSchema.safeParse("UPPERCASE");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("lowercase");
    }
  });

  it("rejects reserved slugs with a clear message", () => {
    const result = slugSchema.safeParse("api");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("reserved");
    }
  });
});

describe("slugify", () => {
  it("lowercases and dashes spaces", () => {
    expect(slugify("Powerlifting")).toBe("powerlifting");
    expect(slugify("My Custom Dashboard")).toBe("my-custom-dashboard");
  });

  it("strips characters outside the safe set", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("a/b/c")).toBe("abc");
  });

  it("collapses runs of dashes and trims edges", () => {
    expect(slugify("---bjj---")).toBe("bjj");
    expect(slugify("foo  --  bar")).toBe("foo-bar");
  });

  it("caps at 64 chars", () => {
    const long = "a".repeat(100);
    expect(slugify(long)?.length).toBe(64);
  });

  it("returns null when the result would be empty", () => {
    expect(slugify("")).toBeNull();
    expect(slugify("   ")).toBeNull();
    expect(slugify("!!!")).toBeNull();
  });

  it("returns null when the result is reserved", () => {
    expect(slugify("API")).toBeNull();
    expect(slugify("Recovery")).toBeNull();
  });
});
